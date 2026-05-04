#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");
const {
  computeFollowingRunAt,
  formatScheduleList,
  loadSchedulerJobs,
  saveSchedulerJobs,
} = require("./scheduler");
const { parseCommand } = require("./bridge-commands");
const { createAppServerMessageHelpers } = require("./app-server-message-helpers");
const { createAppServerTurnRunner } = require("./app-server-turn-runner");
const { createAutoresearchMonitor } = require("./autoresearch-monitor");
const { createBridgeLifecycle } = require("./bridge-lifecycle");
const { createBridgeOpsManager } = require("./bridge-ops");
const { createBridgeJobRuntime } = require("./bridge-job-runtime");
const { createBridgeSchedulerRuntime } = require("./bridge-scheduler-runtime");
const { createBridgeStateStore } = require("./bridge-state-store");
const { createBridgeTestSupport } = require("./bridge-test-support");
const { createCodexSessionReader } = require("./codex-session-reader");
const { createObsidianLinkPlugin } = require("./obsidian-link-plugin");
const {
  createPluginAuthManager,
  normalizePendingPluginAuth,
} = require("./plugin-auth-manager");
const { createCodexCliRunnerAdapter } = require("./runner-adapter");
const {
  cancelJobControl,
  createJobControl,
  isCancellationError,
  registerCancellationHandler,
} = require("./job-control");
const { createLiveUpdateChannel } = require("./live-update-channel");
const { createScheduledAttachmentDiscovery } = require("./scheduled-attachment-discovery");
const { createSignalAttachmentPlugin } = require("./signal-attachment-plugin");
const { createSignalInboundPlugin } = require("./signal-inbound-plugin");
const { createSignalProfilePlugin } = require("./signal-profile-plugin");
const { createSignalReplyChannel } = require("./signal-reply-channel");
const { createSignalRpcSession } = require("./signal-rpc-session");
const { createTelegramReviewPlugin } = require("./telegram-review-plugin");
const { createVoiceNotePlugin } = require("./voice-note-plugin");
const {
  dedupeStrings,
  delay,
  formatProgressMessage,
  formatSlugForDisplay,
  formatUnitSummary,
  isInvalidSessionError,
  mergePromptSegments,
  normalizeBooleanEnv,
  normalizeIntegerEnv,
  normalizeText,
  parseAllowedNumbers,
  parseSystemdShowOutput,
  splitIntoChunks,
  truncateText,
} = require("./bridge-utils");
const { createInstanceConfig } = require("../../tools/instance/instance-config");

require("dotenv").config();

const PROJECT_DIR = __dirname;
const INSTANCE_CONFIG = createInstanceConfig();
const CODEX_CWD = normalizeText(process.env.SABLE_CODEX_CWD) || INSTANCE_CONFIG.homeDir;
const STATE_PATH =
  normalizeText(process.env.SABLE_BRIDGE_STATE_PATH) ||
  path.join(PROJECT_DIR, ".bridge-state.json");
const RESTART_REQUEST_PATH =
  normalizeText(process.env.SABLE_RESTART_REQUEST_PATH) ||
  path.join(PROJECT_DIR, ".restart-requested");
const RESTART_NOTICE_PATH =
  normalizeText(process.env.SABLE_RESTART_NOTICE_PATH) ||
  path.join(PROJECT_DIR, ".restart-notice-pending");
const SCHEDULER_JOBS_PATH =
  normalizeText(process.env.SABLE_SCHEDULER_JOBS_PATH) ||
  INSTANCE_CONFIG.schedulerJobsPath;
const RESEARCH_ROOT =
  normalizeText(process.env.SABLE_RESEARCH_ROOT) ||
  INSTANCE_CONFIG.researchRoot;
const MAX_SIGNAL_MESSAGE_LENGTH = 1500;
const CHUNK_DELAY_MS = 500;
const LIVE_UPDATE_BATCH_WINDOW_MS = 750;
const LIVE_UPDATE_DUPLICATE_WINDOW_MS = 5_000;
const PENDING_PLUGIN_AUTH_POLL_INTERVAL_MS = 15_000;
const MAX_COMMAND_TEXT_LENGTH = 120;
const MAX_FAILURE_OUTPUT_LENGTH = 400;
const DEFAULT_IMAGE_PROMPT = "Please analyze the attached image.";
const DEFAULT_FILE_PROMPT = "Please analyze the attached files.";
const SCHEDULED_NO_REPLY_MARKER = "__SABLE_NO_REPLY__";
const MAX_FILE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_FILE_EXCERPT_CHARS = 20_000;
const MAX_TOTAL_FILE_CONTEXT_CHARS = 48_000;
const VOICE_NOTES_ENABLED = normalizeBooleanEnv(process.env.VOICE_NOTES_ENABLED, true);
const VOICE_NOTES_MODEL = normalizeText(process.env.VOICE_NOTES_MODEL) || "base.en";
const VOICE_NOTES_MODEL_PATH =
  normalizeText(process.env.VOICE_NOTES_MODEL_PATH) ||
  path.join(INSTANCE_CONFIG.homeDir, "models", "faster-whisper-base.en");
const VOICE_NOTES_LANGUAGE = normalizeText(process.env.VOICE_NOTES_LANGUAGE) || "en";
const VOICE_NOTES_BEAM_SIZE = normalizeIntegerEnv(process.env.VOICE_NOTES_BEAM_SIZE, 5);
const VOICE_NOTES_COMPUTE_TYPE =
  normalizeText(process.env.VOICE_NOTES_COMPUTE_TYPE) || "int8";
const VOICE_NOTES_TIMEOUT_SEC = normalizeIntegerEnv(
  process.env.VOICE_NOTES_TIMEOUT_SEC,
  900
);
const VOICE_NOTES_ECHO_TRANSCRIPT = normalizeBooleanEnv(
  process.env.VOICE_NOTES_ECHO_TRANSCRIPT,
  true
);
const CODEX_HOME_ROOT =
  normalizeText(process.env.CODEX_HOME) || path.join(INSTANCE_CONFIG.homeDir, ".codex");
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME_ROOT, "sessions");
const APP_SERVER_REQUEST_TIMEOUT_MS = normalizeIntegerEnv(
  process.env.APP_SERVER_REQUEST_TIMEOUT_MS,
  20_000
);
const APP_SERVER_IDLE_TIMEOUT_MS = normalizeIntegerEnv(
  process.env.APP_SERVER_IDLE_TIMEOUT_MS,
  10 * 60 * 1000
);
const APP_SERVER_CLIENT_VERSION = "1.1.0";
const SCHEDULER_POLL_INTERVAL_MS = normalizeIntegerEnv(
  process.env.SABLE_SCHEDULER_POLL_INTERVAL_MS,
  30_000
);
const MAX_SCHEDULED_LOCAL_IMAGES = normalizeIntegerEnv(
  process.env.SABLE_MAX_SCHEDULED_LOCAL_IMAGES,
  6
);
const MAX_SCHEDULED_LOCAL_IMAGE_BYTES = normalizeIntegerEnv(
  process.env.SABLE_MAX_SCHEDULED_LOCAL_IMAGE_BYTES,
  10 * 1024 * 1024
);
const MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES = normalizeIntegerEnv(
  process.env.SABLE_MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES,
  25 * 1024 * 1024
);
const TRANSCRIBE_SCRIPT_PATH = path.join(PROJECT_DIR, "transcribe_voice_note.py");
const EXTRACT_PDF_SCRIPT_PATH = path.join(PROJECT_DIR, "extract_pdf_text.py");
const VENV_PYTHON_PATH = path.join(PROJECT_DIR, ".venv", "bin", "python");
const VENV_PDF_PYTHON_PATH = path.join(PROJECT_DIR, ".venv-pdf", "bin", "python");
const TRANSCRIBE_PYTHON_BIN = selectTranscribePythonBin();
const PDF_EXTRACT_PYTHON_BIN = selectPdfExtractPythonBin();
const telegramReview = createTelegramReviewPlugin({
  execFile,
  env: process.env,
  instanceConfig: INSTANCE_CONFIG,
  truncateText,
});
const TELEGRAM_TRIAGE_LIMIT = telegramReview.triageLimit;
const TEST_RECEIVE_SCENARIO_PATH = normalizeText(process.env.SABLE_E2E_RECEIVE_SCENARIO_PATH);
const TEST_APP_SERVER_LOG_PATH = normalizeText(process.env.SABLE_E2E_APP_SERVER_LOG_PATH);
const TEST_TURN_SCENARIO_PATH = normalizeText(process.env.SABLE_E2E_TURN_SCENARIO_PATH);
const TEST_TURN_CURSOR_PATH = normalizeText(process.env.SABLE_E2E_TURN_CURSOR_PATH);
const TEST_SIGNAL_LOG_PATH = normalizeText(process.env.SABLE_E2E_SIGNAL_LOG_PATH);
const obsidianLinks = createObsidianLinkPlugin({
  env: process.env,
  instanceConfig: INSTANCE_CONFIG,
  logger: console,
});
const SIGNAL_REPLY_TO_ENV = "SABLE_SIGNAL_REPLY_TO";
const SIGNAL_BRIDGE_DIR_ENV = "SABLE_SIGNAL_BRIDGE_DIR";
const ATTACHMENT_QUEUE_ROOT =
  normalizeText(process.env.SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR) ||
  path.join(PROJECT_DIR, ".attachment-queue");
const ATTACHMENT_QUEUE_PENDING_DIR = path.join(ATTACHMENT_QUEUE_ROOT, "pending");
const ATTACHMENT_QUEUE_RESULTS_DIR = path.join(ATTACHMENT_QUEUE_ROOT, "results");
const OPS_ROOT =
  normalizeText(process.env.SABLE_OPS_STATE_DIR) || path.join(PROJECT_DIR, ".ops");
const OPS_SNAPSHOT_INTERVAL_MS = normalizeIntegerEnv(
  process.env.SABLE_OPS_SNAPSHOT_INTERVAL_MS,
  60_000
);
const OPS_STALLED_RUN_THRESHOLD_MS = normalizeIntegerEnv(
  process.env.SABLE_OPS_STALLED_RUN_THRESHOLD_MS,
  6 * 60 * 60 * 1000
);
const OPS_ALERTS_ENABLED = normalizeBooleanEnv(
  process.env.SABLE_OPS_ALERTS_ENABLED,
  !TEST_SIGNAL_LOG_PATH
);
const OPS_ALERT_BRIDGE_RSS_THRESHOLD_BYTES = normalizeIntegerEnv(
  process.env.SABLE_OPS_ALERT_BRIDGE_RSS_THRESHOLD_BYTES,
  1200 * 1024 * 1024
);
const OPS_ALERT_IN_FLIGHT_TURN_THRESHOLD_MS = normalizeIntegerEnv(
  process.env.SABLE_OPS_ALERT_IN_FLIGHT_TURN_THRESHOLD_MS,
  20 * 60 * 1000
);

const phoneNumber = process.env.PHONE_NUMBER?.trim();
const allowedNumbers = parseAllowedNumbers(process.env.ALLOWED_NUMBERS);
const allowedSenders = parseAllowedNumbers(process.env.ALLOWED_SENDERS);
const signalAttachments = createSignalAttachmentPlugin({
  allowedNumbers,
  extractPdfScriptPath: EXTRACT_PDF_SCRIPT_PATH,
  maxFileAttachmentBytes: MAX_FILE_ATTACHMENT_BYTES,
  maxFileExcerptChars: MAX_FILE_EXCERPT_CHARS,
  maxTextAttachmentBytes: MAX_TEXT_ATTACHMENT_BYTES,
  maxTotalFileContextChars: MAX_TOTAL_FILE_CONTEXT_CHARS,
  pdfExtractPythonBin: PDF_EXTRACT_PYTHON_BIN,
  pendingDir: ATTACHMENT_QUEUE_PENDING_DIR,
  projectDir: PROJECT_DIR,
  resultsDir: ATTACHMENT_QUEUE_RESULTS_DIR,
  sendSignalRequest,
  truncateText,
  logger: console,
});
const signalInbound = createSignalInboundPlugin({
  allowedNumbers,
  allowedSenders,
});
const voiceNotes = createVoiceNotePlugin({
  beamSize: VOICE_NOTES_BEAM_SIZE,
  computeType: VOICE_NOTES_COMPUTE_TYPE,
  enabled: VOICE_NOTES_ENABLED,
  language: VOICE_NOTES_LANGUAGE,
  model: VOICE_NOTES_MODEL,
  modelPath: VOICE_NOTES_MODEL_PATH,
  projectDir: PROJECT_DIR,
  pythonBin: TRANSCRIBE_PYTHON_BIN,
  registerCancellationHandler,
  scriptPath: TRANSCRIBE_SCRIPT_PATH,
  spawn,
  timeoutSec: VOICE_NOTES_TIMEOUT_SEC,
});
const signalProfile = createSignalProfilePlugin({
  sendSignalRequest,
});
const scheduledAttachmentDiscovery = createScheduledAttachmentDiscovery({
  maxImages: MAX_SCHEDULED_LOCAL_IMAGES,
  maxImageBytes: MAX_SCHEDULED_LOCAL_IMAGE_BYTES,
  maxTotalImageBytes: MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES,
});
const schedulerRuntime = createBridgeSchedulerRuntime({
  buildAttachmentContext: (...args) => signalAttachments.buildAttachmentContext(...args),
  computeFollowingRunAt,
  discoverFileAttachments: (prompt) =>
    scheduledAttachmentDiscovery.discoverFileAttachments(prompt),
  discoverImageAttachments: (prompt) =>
    scheduledAttachmentDiscovery.discoverImageAttachments(prompt),
  formatScheduleList,
  loadSchedulerJobs,
  normalizeText,
  saveSchedulerJobs,
  schedulerJobsPath: SCHEDULER_JOBS_PATH,
  timestamp,
});
const appServerMessages = createAppServerMessageHelpers({
  formatProgressMessage,
  logger: console,
  maxCommandTextLength: MAX_COMMAND_TEXT_LENGTH,
  maxFailureOutputLength: MAX_FAILURE_OUTPUT_LENGTH,
  normalizeText,
  timestamp,
  truncateText,
});
const codexSessionReader = createCodexSessionReader({
  normalizeText,
  sessionsDir: CODEX_SESSIONS_DIR,
});
const stateStore = createBridgeStateStore({
  logger: console,
  normalizePendingPluginAuth,
  normalizeText,
  statePath: STATE_PATH,
  timestamp,
  truncateText,
});
const testSupport = createBridgeTestSupport({
  appendTimestamp: timestamp,
  buildAppServerThreadParams,
  buildAppServerTurnParams,
  handleReceiveEvent,
  logger: console,
  normalizeText,
  registerCancellationHandler,
  testAppServerLogPath: TEST_APP_SERVER_LOG_PATH,
  testReceiveScenarioPath: TEST_RECEIVE_SCENARIO_PATH,
  testSignalLogPath: TEST_SIGNAL_LOG_PATH,
  testTurnCursorPath: TEST_TURN_CURSOR_PATH,
  testTurnScenarioPath: TEST_TURN_SCENARIO_PATH,
});

validateConfig();

let appServerTurnRunner;
let signalReplyChannel;
let signalRpc;

const interactiveQueue = [];
const backgroundQueue = [];
let isProcessingInteractive = false;
let isProcessingBackground = false;
let state = stateStore.loadState();
let restartRequested = false;
let shutdownRequested = false;
let activeJobControl = null;
let isProcessingAttachmentQueue = false;
const autoresearchMonitor = createAutoresearchMonitor({
  logger: console,
  researchRoot: RESEARCH_ROOT,
  stalledRunThresholdMs: OPS_STALLED_RUN_THRESHOLD_MS,
  timestamp,
});
const ops = createBridgeOpsManager({
  opsRoot: OPS_ROOT,
  attachmentQueuePendingDir: ATTACHMENT_QUEUE_PENDING_DIR,
  alertsEnabled: OPS_ALERTS_ENABLED,
  alertRecipient: allowedNumbers[0] || "",
  alertBridgeRssThresholdBytes: OPS_ALERT_BRIDGE_RSS_THRESHOLD_BYTES,
  alertInFlightTurnThresholdMs: OPS_ALERT_IN_FLIGHT_TURN_THRESHOLD_MS,
  stalledRunThresholdMs: OPS_STALLED_RUN_THRESHOLD_MS,
  snapshotAutoresearchRuns: () => autoresearchMonitor.snapshotRuns(),
  summarizeAutoresearchRuns: (runs, now) => autoresearchMonitor.summarizeRuns(runs, now),
  getSchedulerJobs: () => schedulerRuntime.getJobs(),
  getLiveState: () => ({
    interactiveQueueDepth: interactiveQueue.length,
    interactiveProcessing: isProcessingInteractive,
    backgroundQueueDepth: backgroundQueue.length,
    backgroundProcessing: isProcessingBackground,
    attachmentQueueProcessing: isProcessingAttachmentQueue,
    inFlightTurn: state.inFlightTurn,
  }),
  getSystemdUnitSummary,
  formatUnitSummary,
  normalizeText,
  truncateText,
  timestamp,
  sendReply,
  onError: (message) => {
    console.error(`[${timestamp()}] ${message}`);
  },
});
signalRpc = createSignalRpcSession({
  logger: console,
  onExit: (code) => process.exit(code ?? 1),
  onReceive: handleReceiveEvent,
  onStderr: (text) => ops.noteSignalCliStderr(text),
  phoneNumber,
  projectDir: PROJECT_DIR,
  spawn,
  testSignalLogPath: TEST_SIGNAL_LOG_PATH,
  testSupport,
  timestamp,
});
signalReplyChannel = createSignalReplyChannel({
  allowedNumbers,
  chunkDelayMs: CHUNK_DELAY_MS,
  delay,
  logger: console,
  maxMessageLength: MAX_SIGNAL_MESSAGE_LENGTH,
  noteIncoming: (sender) => ops.noteIncoming(sender),
  noteOutgoing: (recipient) => ops.noteOutgoing(recipient),
  rewriteText: (text) => obsidianLinks.rewriteMarkdownDocumentReferencesForSignal(text),
  sendSignalRequest,
  splitIntoChunks,
  timestamp,
});
const runner = createCodexCliRunnerAdapter({
  spawn,
  cwd: CODEX_CWD,
  projectDir: PROJECT_DIR,
  signalReplyToEnv: SIGNAL_REPLY_TO_ENV,
  signalBridgeDirEnv: SIGNAL_BRIDGE_DIR_ENV,
  appServerClientVersion: APP_SERVER_CLIENT_VERSION,
  appServerRequestTimeoutMs: APP_SERVER_REQUEST_TIMEOUT_MS,
  normalizeText,
  timestamp,
  appendTestAppServerLog: testSupport.appendAppServerLog,
  onStderr(text) {
    ops.noteCodexAppServerStderr(text);
    console.error(`[${timestamp()}] codex app-server stderr: ${text}`);
  },
});
const {
  createAppServerClient,
  callCodexAppServer,
  recordTestAppServerSpawnArgs,
  probeRuntimeProfile,
} = runner;
appServerTurnRunner = createAppServerTurnRunner({
  runtimeHooks: {
    turnIdleTimeoutMs: APP_SERVER_IDLE_TIMEOUT_MS,
    liveUpdateBatchWindowMs: LIVE_UPDATE_BATCH_WINDOW_MS,
    liveUpdateDuplicateWindowMs: LIVE_UPDATE_DUPLICATE_WINDOW_MS,
    captureUsageSnapshot: (message) => ops.captureUsageSnapshot(message),
    captureRateLimitSnapshot: (message) => ops.captureRateLimitSnapshot(message),
    noteTurnStarted: () => ops.noteTurnStarted(),
    noteTurnCompleted: () => ops.noteTurnCompleted(),
  },
  appServerMessages,
  codexCwd: CODEX_CWD,
  codexSessionReader,
  createAppServerClient,
  createLiveUpdateChannel,
  formatProgressMessage,
  getActiveSender: () => activeSender,
  isInvalidSessionError,
  logger: console,
  normalizeText,
  registerCancellationHandler,
  sendReply,
  testSupport,
  timestamp,
  truncateText,
});
const pluginAuth = createPluginAuthManager({
  callCodexAppServer,
  codexCwd: CODEX_CWD,
  getPending: () => state.pendingPluginAuth,
  isInteractiveProcessing: () => isProcessingInteractive,
  savePending: (pendingPluginAuth) => {
    state.pendingPluginAuth = pendingPluginAuth;
    saveState();
  },
  sendReply,
  timestamp,
});
const jobRuntime = createBridgeJobRuntime({
  appServerMessages,
  autoresearchMonitor,
  cleanupPaths,
  clearActiveJob: (jobControl) => {
    activeSender = null;
    if (activeJobControl === jobControl) {
      activeJobControl = null;
    }
  },
  clearInFlightTurn,
  clearSessionState,
  createJobControl,
  getBridgeStatusReport: () =>
    ops.getBridgeStatusReport({
      interactiveSessionId: state.interactiveSessionId,
      backgroundSessionId: state.backgroundSessionId,
      obsidianLinkServerAddress: obsidianLinks.getServerAddress(),
      obsidianLinkServerHost: obsidianLinks.host,
      obsidianLinksEnabled: obsidianLinks.enabled,
      obsidianBaseUrl: obsidianLinks.baseUrl,
      pendingPluginAuthSummary: pluginAuth.summarize(state.pendingPluginAuth),
    }),
  getOpsReport: () => ops.getOpsReport(),
  getPendingPluginAuth: () => state.pendingPluginAuth,
  getSessionId: (key) => state[key],
  getTelegramTriageReport,
  mergePromptSegments,
  normalizeText,
  pluginAuth,
  runCodex,
  saveSessionId: (key, sessionId) => {
    state[key] = sessionId;
    saveState();
  },
  schedulerRuntime,
  scheduledNoReplyMarker: SCHEDULED_NO_REPLY_MARKER,
  sendReply,
  setActiveJob: (sender, jobControl) => {
    activeSender = sender;
    activeJobControl = jobControl;
  },
  setInFlightTurn,
  signalAttachments,
  signalProfile,
  timestamp,
  voiceNotes,
  voiceNotesEchoTranscript: VOICE_NOTES_ECHO_TRANSCRIPT,
});
const lifecycle = createBridgeLifecycle({
  backgroundQueue,
  broadcastAllowedMessage,
  clearInFlightTurn,
  closeServer: () => obsidianLinks.closeServer(),
  fs,
  getInFlightTurn: () => state.inFlightTurn,
  getRestartRequested: () => restartRequested,
  getShutdownRequested: () => shutdownRequested,
  hasActiveWork: () =>
    isProcessingInteractive ||
    isProcessingBackground ||
    interactiveQueue.length > 0 ||
    backgroundQueue.length > 0,
  interactiveQueue,
  logger: console,
  processBackgroundQueue,
  processExit: (code) => process.exit(code),
  processInteractiveQueue,
  restartNoticePath: RESTART_NOTICE_PATH,
  restartRequestPath: RESTART_REQUEST_PATH,
  sendReply,
  setRestartRequested: (value) => {
    restartRequested = value;
  },
  setShutdownRequested: (value) => {
    shutdownRequested = value;
  },
  signalRpc,
  timestamp,
});

signalRpc.start();
obsidianLinks.startServer();
ensureAttachmentQueueDirs();
ops.ensureOpsDirs();
if (TEST_RECEIVE_SCENARIO_PATH) {
  void testSupport.startReceiveScenario(TEST_RECEIVE_SCENARIO_PATH);
}
setTimeout(() => {
  void lifecycle.maybeSendRestartReconnectNotice();
}, 1_500);
setTimeout(() => {
  void lifecycle.maybeSendInterruptedTurnNotice();
}, 1_900);
setInterval(() => lifecycle.checkForRestartRequest(), 2_000);
setInterval(checkForPendingPluginAuth, PENDING_PLUGIN_AUTH_POLL_INTERVAL_MS);
setInterval(checkForDueScheduledJobs, SCHEDULER_POLL_INTERVAL_MS);
setInterval(checkForPendingAttachmentCommands, 1_000);
setInterval(() => {
  void ops.writeOpsSnapshot();
}, OPS_SNAPSHOT_INTERVAL_MS);
setTimeout(() => {
  void checkForDueScheduledJobs();
}, 5_000);
setTimeout(() => {
  void ops.writeOpsSnapshot();
}, 2_500);
setTimeout(() => {
  void refreshCodexRuntimeProbe();
}, 3_500);
setInterval(() => {
  void refreshCodexRuntimeProbe();
}, 30 * 60 * 1000);

function validateConfig() {
  const missing = [];

  if (!phoneNumber) {
    missing.push("PHONE_NUMBER");
  }

  if (allowedNumbers.size === 0) {
    missing.push("ALLOWED_NUMBERS");
  }

  if (missing.length > 0) {
    console.error(
      `[${timestamp()}] Missing required environment variables: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

async function refreshCodexRuntimeProbe() {
  try {
    const probe = await probeRuntimeProfile();
    ops.noteCodexRuntimeProbe(probe);
  } catch (error) {
    ops.noteCodexRuntimeProbe({
      observedAt: timestamp(),
      error: error.message || String(error),
      codexHome: CODEX_HOME_ROOT,
    });
    console.error(`[${timestamp()}] Failed probing Codex runtime profile: ${error.message}`);
  }
}

function selectTranscribePythonBin() {
  const candidates = [VENV_PYTHON_PATH, "python3"];

  for (const candidate of candidates) {
    if (candidate !== "python3" && !fs.existsSync(candidate)) {
      continue;
    }

    try {
      execFileSync(
        candidate,
        ["-c", "import faster_whisper, ctranslate2, av"],
        {
          cwd: PROJECT_DIR,
          stdio: "ignore",
        }
      );
      return candidate;
    } catch (error) {
      continue;
    }
  }

  return "python3";
}

function selectPdfExtractPythonBin() {
  const candidates = [VENV_PDF_PYTHON_PATH, "python3"];

  for (const candidate of candidates) {
    if (candidate !== "python3" && !fs.existsSync(candidate)) {
      continue;
    }

    try {
      execFileSync(candidate, ["--version"], {
        cwd: PROJECT_DIR,
        stdio: "ignore",
      });
      return candidate;
    } catch (error) {
      continue;
    }
  }

  return "python3";
}

function saveState() {
  stateStore.saveState(state);
}

function clearState() {
  state = stateStore.clearState(state);
  saveState();
}

function clearSessionState(kind) {
  state = stateStore.clearSessionState(state, kind);
  saveState();
}

function setInFlightTurn(sender, prompt) {
  state = stateStore.setInFlightTurn(state, sender, prompt);
  saveState();
}

function clearInFlightTurn() {
  state = stateStore.clearInFlightTurn(state);
  saveState();
}

async function handleReceiveEvent(message) {
  const envelope = message.params?.envelope;
  const senderCandidates = signalInbound.extractSenderCandidates(envelope);
  const sender = senderCandidates[0] || null;
  const text = signalInbound.extractIncomingText(envelope);
  const imageAttachments = signalAttachments.extractIncomingImageAttachments(envelope);
  const audioAttachments = signalAttachments.extractIncomingAudioAttachments(envelope);
  const fileAttachments = signalAttachments.extractIncomingFileAttachments(envelope);

  if (
    !sender ||
    (!text &&
      imageAttachments.length === 0 &&
      audioAttachments.length === 0 &&
      fileAttachments.length === 0)
  ) {
    return;
  }

  if (!signalInbound.isAllowedSender(senderCandidates)) {
    console.log(
      `[${timestamp()}] Ignored message from disallowed sender ${senderCandidates.join(", ")}`
    );
    return;
  }

  const fallbackPreview = audioAttachments.length > 0
    ? "Voice note"
    : imageAttachments.length > 0
      ? DEFAULT_IMAGE_PROMPT
      : DEFAULT_FILE_PROMPT;
  logIncoming(
    sender,
    text || fallbackPreview,
    imageAttachments.length + audioAttachments.length + fileAttachments.length
  );

  const command = parseCommand(
    text ||
      (imageAttachments.length > 0
        ? DEFAULT_IMAGE_PROMPT
        : fileAttachments.length > 0
          ? DEFAULT_FILE_PROMPT
          : ""),
    {
      hasImages: imageAttachments.length > 0,
      hasAudio: audioAttachments.length > 0,
      hasFiles: fileAttachments.length > 0,
      telegramTriageLimit: TELEGRAM_TRIAGE_LIMIT,
    }
  );

  if (command.type === "cancel") {
    await handleCancelCommand(sender);
    return;
  }

  if (shutdownRequested || restartRequested) {
    if (command.type === "status") {
      await sendReply(
        sender,
        await ops.getBridgeStatusReport({
          interactiveSessionId: state.interactiveSessionId,
          backgroundSessionId: state.backgroundSessionId,
          obsidianLinkServerAddress: obsidianLinks.getServerAddress(),
          obsidianLinkServerHost: obsidianLinks.host,
          obsidianLinksEnabled: obsidianLinks.enabled,
          obsidianBaseUrl: obsidianLinks.baseUrl,
          pendingPluginAuthSummary: pluginAuth.summarize(state.pendingPluginAuth),
        })
      );
      return;
    }

    await sendReply(
      sender,
      "Restart in progress. I'm finishing the current task before reconnecting, so please resend after Sable is back."
    );
    return;
  }

  const job = {
    sender,
    command,
    context: signalAttachments.buildAttachmentContext(
      envelope,
      sender,
      imageAttachments,
      audioAttachments,
      fileAttachments
    ),
    queuedVoicePreparation: null,
  };

  if (audioAttachments.length > 0 && voiceNotes.isEnabled() && isProcessingInteractive) {
    job.queuedVoicePreparation = voiceNotes.startQueuedPreparation(job, {
      cleanupPaths,
      materializeIncomingAudio: (context) => signalAttachments.materializeIncomingAudio(context),
    });
  }

  interactiveQueue.push(job);

  if (isProcessingInteractive) {
    try {
      const queueMessage =
        audioAttachments.length > 0 && voiceNotes.isEnabled()
          ? "Queued, will process after current task. Transcribing the voice note in the background."
          : "Queued, will process after current task.";
      await sendReply(sender, queueMessage);
    } catch (error) {
      console.error(`[${timestamp()}] Failed sending queue acknowledgment: ${error.message}`);
    }
    return;
  }

  void processInteractiveQueue();
}

async function handleCancelCommand(sender) {
  if (!isProcessingInteractive || !activeJobControl) {
    await sendReply(sender, "No active task to cancel.");
    return;
  }

  const cancelled = cancelJobControl(activeJobControl, undefined, {
    logger: console,
    timestamp,
  });
  if (!cancelled) {
    await sendReply(sender, "The active task is already stopping.");
    return;
  }

  const pendingCount = interactiveQueue.length;
  const suffix =
    pendingCount > 0
      ? ` ${pendingCount} queued message${pendingCount === 1 ? "" : "s"} will stay queued.`
      : "";
  await sendReply(sender, `Cancelling current task.${suffix}`);
}

async function processInteractiveQueue() {
  if (isProcessingInteractive) {
    return;
  }

  isProcessingInteractive = true;

  while (interactiveQueue.length > 0) {
    const job = interactiveQueue.shift();

    try {
      await processJob(job);
    } catch (error) {
      if (isCancellationError(error)) {
        console.log(`[${timestamp()}] Cancelled task for ${job.sender}: ${error.message}`);
        continue;
      }

      console.error(
        `[${timestamp()}] Failed processing message from ${job.sender}: ${error.stack || error.message}`
      );
      await jobRuntime.sendJobReply(job, "Request failed before Sable could complete.");
    }
  }

  isProcessingInteractive = false;
    await lifecycle.restartIfRequested();
}

async function processBackgroundQueue() {
  if (isProcessingBackground) {
    return;
  }

  isProcessingBackground = true;

  while (backgroundQueue.length > 0) {
    const job = backgroundQueue.shift();

    try {
      await processJob(job);
    } catch (error) {
      if (isCancellationError(error)) {
        console.log(`[${timestamp()}] Cancelled background task for ${job.sender}: ${error.message}`);
        continue;
      }

      console.error(
        `[${timestamp()}] Failed processing background message from ${job.sender}: ${error.stack || error.message}`
      );
      await jobRuntime.sendJobReply(job, "Background workflow failed before Sable could complete.");
    }
  }

  isProcessingBackground = false;
    await lifecycle.restartIfRequested();
}

async function checkForDueScheduledJobs() {
  await schedulerRuntime.checkForDueScheduledJobs({
    enqueueBackgroundJob: (job) => backgroundQueue.push(job),
    ensureBackgroundProcessing: () => {
      if (!isProcessingBackground) {
        void processBackgroundQueue();
      }
    },
    isPaused: () => shutdownRequested || restartRequested,
  });
}

async function processJob(job) {
  await jobRuntime.processJob(job);
}

async function runCodex(
  prompt,
  sessionId,
  imagePaths = [],
  jobControl = null,
  suppressLiveUpdates = false,
  onInvalidSession = null
) {
  recordTestAppServerSpawnArgs();

  if (TEST_TURN_SCENARIO_PATH && TEST_TURN_CURSOR_PATH) {
    return testSupport.runCodexViaTestScenario(
      prompt,
      sessionId,
      imagePaths,
      jobControl
    );
  }
  return runCodexViaAppServer(
    prompt,
    sessionId,
    imagePaths,
    jobControl,
    suppressLiveUpdates,
    onInvalidSession
  );
}

function runCodexViaAppServer(
  prompt,
  sessionId,
  imagePaths = [],
  jobControl = null,
  suppressLiveUpdates = false,
  onInvalidSession = null
) {
  return appServerTurnRunner.runCodexViaAppServer(
    prompt,
    sessionId,
    imagePaths,
    jobControl,
    suppressLiveUpdates,
    onInvalidSession
  );
}

function buildAppServerThreadParams(threadId = null) {
  return appServerTurnRunner.buildThreadParams(threadId);
}

function buildAppServerTurnParams(threadId, prompt, imagePaths = []) {
  return appServerTurnRunner.buildTurnParams(threadId, prompt, imagePaths);
}

async function checkForPendingPluginAuth() {
  try {
    await pluginAuth.check();
  } catch (error) {
    console.error(`[${timestamp()}] ${error.message}`);
  }
}

let activeSender = null;

async function cleanupPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return;
  }

  const parentDir = path.dirname(paths[0]);
  await fs.promises.rm(parentDir, { recursive: true, force: true });
}

function getSystemdUnitSummary(unitName) {
  return new Promise((resolve) => {
    execFile(
      "systemctl",
      [
        "--user",
        "show",
        unitName,
        "--property=ActiveState,SubState,ActiveEnterTimestamp,ExecMainPID",
      ],
      { encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          resolve({
            activeState: "unknown",
            subState: "unknown",
            activeEnterTimestamp: "unavailable",
            execMainPid: "",
          });
          return;
        }

        resolve(parseSystemdShowOutput(stdout));
      }
    );
  });
}

function getTelegramTriageReport(limit = TELEGRAM_TRIAGE_LIMIT) {
  return telegramReview.getTriageReport(limit);
}

async function sendReply(recipient, text) {
  await signalReplyChannel.sendReply(recipient, text);
}

async function broadcastAllowedMessage(text) {
  await signalReplyChannel.broadcastAllowedMessage(text);
}

function sendSignalAttachmentMessage(recipient, message = "", attachmentPaths = []) {
  return signalAttachments.sendAttachmentMessage(recipient, message, attachmentPaths);
}

function ensureAttachmentQueueDirs() {
  signalAttachments.ensureQueueDirs();
}

function checkForPendingAttachmentCommands() {
  if (isProcessingAttachmentQueue || shutdownRequested) {
    return;
  }

  isProcessingAttachmentQueue = true;
  void processNextAttachmentCommand().finally(() => {
    isProcessingAttachmentQueue = false;
  });
}

async function processNextAttachmentCommand() {
  await signalAttachments.processNextQueuedCommand();
}

function sendSignalRequest(method, params) {
  return signalRpc.sendRequest(method, params);
}

function logIncoming(sender, message, imageCount = 0) {
  signalReplyChannel.logIncoming(sender, message, imageCount);
}

function timestamp() {
  return new Date().toISOString();
}

process.on("SIGINT", () => lifecycle.shutdown());
process.on("SIGTERM", () => lifecycle.shutdown());
