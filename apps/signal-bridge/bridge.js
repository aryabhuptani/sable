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
const { createAutoresearchMonitor } = require("./autoresearch-monitor");
const { createBridgeOpsManager } = require("./bridge-ops");
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
const { createTelegramReviewPlugin } = require("./telegram-review-plugin");
const { createVoiceNotePlugin } = require("./voice-note-plugin");
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

let signalProcess;
let signalStdoutBuffer = "";
let nextSignalRequestId = 1;
const pendingSignalRequests = new Map();

const interactiveQueue = [];
const backgroundQueue = [];
let isProcessingInteractive = false;
let isProcessingBackground = false;
let state = stateStore.loadState();
let schedulerJobs = loadSchedulerJobs(SCHEDULER_JOBS_PATH);
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
  getSchedulerJobs: () => schedulerJobs,
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

startSignalRpc();
obsidianLinks.startServer();
ensureAttachmentQueueDirs();
ops.ensureOpsDirs();
if (TEST_RECEIVE_SCENARIO_PATH) {
  void testSupport.startReceiveScenario(TEST_RECEIVE_SCENARIO_PATH);
}
setTimeout(() => {
  void maybeSendRestartReconnectNotice();
}, 1_500);
setTimeout(() => {
  void maybeSendInterruptedTurnNotice();
}, 1_900);
setInterval(checkForRestartRequest, 2_000);
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

function parseAllowedNumbers(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function normalizeBooleanEnv(value, defaultValue) {
  const normalized = normalizeText(String(value || ""));
  if (!normalized) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(normalized.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized.toLowerCase())) {
    return false;
  }

  return defaultValue;
}

function normalizeIntegerEnv(value, defaultValue) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
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

function startSignalRpc() {
  signalProcess = spawn(
    "signal-cli",
    ["-a", phoneNumber, "jsonRpc", "--receive-mode=on-start"],
    {
      cwd: PROJECT_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  signalProcess.stdout.setEncoding("utf8");
  signalProcess.stdout.on("data", handleSignalStdout);

  signalProcess.stderr.setEncoding("utf8");
  signalProcess.stderr.on("data", (chunk) => {
    const text = chunk.trim();
    if (text) {
      ops.noteSignalCliStderr(text);
      console.error(`[${timestamp()}] signal-cli stderr: ${text}`);
    }
  });

  signalProcess.on("error", (error) => {
    console.error(`[${timestamp()}] Failed to start signal-cli: ${error.message}`);
    process.exit(1);
  });

  signalProcess.on("exit", (code, signal) => {
    rejectAllPendingSignalRequests(
      new Error(`signal-cli exited (code=${code}, signal=${signal || "none"})`)
    );
    console.error(
      `[${timestamp()}] signal-cli exited (code=${code}, signal=${signal || "none"})`
    );
    process.exit(code ?? 1);
  });

  console.log(`[${timestamp()}] Started signal-cli JSON-RPC listener for ${phoneNumber}`);
}

function handleSignalStdout(chunk) {
  signalStdoutBuffer += chunk;

  while (true) {
    const newlineIndex = signalStdoutBuffer.indexOf("\n");
    if (newlineIndex === -1) {
      return;
    }

    const line = signalStdoutBuffer.slice(0, newlineIndex).trim();
    signalStdoutBuffer = signalStdoutBuffer.slice(newlineIndex + 1);

    if (!line) {
      continue;
    }

    let message;

    try {
      message = JSON.parse(line);
    } catch (error) {
      console.error(`[${timestamp()}] Ignoring non-JSON signal-cli output: ${line}`);
      continue;
    }

    if (message.method === "receive") {
      void handleReceiveEvent(message);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = pendingSignalRequests.get(message.id);
      if (pending) {
        pendingSignalRequests.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(message.error.message || "signal-cli returned an unknown error")
          );
        } else {
          pending.resolve(message.result);
        }
      }
      continue;
    }

    console.log(`[${timestamp()}] signal-cli event: ${line}`);
  }
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
      await sendJobReply(job, "Request failed before Sable could complete.");
    }
  }

  isProcessingInteractive = false;
  await restartIfRequested();
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
      await sendJobReply(job, "Background workflow failed before Sable could complete.");
    }
  }

  isProcessingBackground = false;
  await restartIfRequested();
}

function persistSchedulerJobs() {
  saveSchedulerJobs(SCHEDULER_JOBS_PATH, schedulerJobs);
}

function refreshSchedulerJobs() {
  schedulerJobs = loadSchedulerJobs(SCHEDULER_JOBS_PATH);
}

function removeScheduledJob(scheduleId) {
  refreshSchedulerJobs();
  const normalizedId = normalizeText(scheduleId);
  if (!normalizedId) {
    return false;
  }

  const originalLength = schedulerJobs.length;
  schedulerJobs = schedulerJobs.filter((job) => job.id !== normalizedId);
  if (schedulerJobs.length === originalLength) {
    return false;
  }

  persistSchedulerJobs();
  return true;
}

async function checkForDueScheduledJobs() {
  if (shutdownRequested || restartRequested) {
    return;
  }

  refreshSchedulerJobs();

  if (!Array.isArray(schedulerJobs) || schedulerJobs.length === 0) {
    return;
  }

  const now = new Date();
  let changed = false;

  for (const scheduledJob of schedulerJobs) {
    if (!scheduledJob || scheduledJob.active === false) {
      continue;
    }

    const nextRunMs = Date.parse(scheduledJob.nextRunAt);
    if (Number.isNaN(nextRunMs) || nextRunMs > now.getTime()) {
      continue;
    }

    queueScheduledWorkflowRun(scheduledJob);
    scheduledJob.lastRunAt = now.toISOString();
    scheduledJob.nextRunAt = computeFollowingRunAt(scheduledJob, now);
    scheduledJob.updatedAt = timestamp();
    changed = true;
  }

  if (changed) {
    persistSchedulerJobs();
  }
}

function queueScheduledWorkflowRun(scheduledJob) {
  const executionPrompt = [
    scheduledJob.workflowPrompt,
    "",
    "This is a scheduled recurring workflow triggered automatically by Sable.",
  ].join("\n");
  const localImageAttachments = scheduledAttachmentDiscovery.discoverImageAttachments(
    scheduledJob.workflowPrompt
  );
  const localFileAttachments = scheduledAttachmentDiscovery.discoverFileAttachments(
    scheduledJob.workflowPrompt
  );

  backgroundQueue.push({
    sender: scheduledJob.sender,
    command: { type: "prompt", prompt: executionPrompt },
    context: signalAttachments.buildAttachmentContext(
      {},
      scheduledJob.sender,
      localImageAttachments,
      [],
      localFileAttachments
    ),
    queuedVoicePreparation: null,
    allowSilentNoReply: true,
    replyMode: scheduledJob.replyMode === "silent" ? "silent" : "default",
    origin: "scheduled",
  });

  if (!isProcessingBackground) {
    void processBackgroundQueue();
  }
}

function isBackgroundJob(job) {
  return job?.origin === "scheduled";
}

function getSessionStateKeyForJob(job) {
  return isBackgroundJob(job) ? "backgroundSessionId" : "interactiveSessionId";
}

function isAutoresearchTickJob(job) {
  const prompt = normalizeText(job?.command?.prompt);
  return prompt.includes("Run the bounded autoresearch tick for Sable.");
}

async function processJob(job) {
  if (job.command.type === "status") {
    await sendJobReply(
      job,
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

  if (job.command.type === "ops") {
    await sendJobReply(job, await ops.getOpsReport());
    return;
  }

  if (job.command.type === "list-schedules") {
    refreshSchedulerJobs();
    await sendJobReply(job, formatScheduleList(schedulerJobs));
    return;
  }

  if (job.command.type === "unschedule") {
    const removed = removeScheduledJob(job.command.scheduleId);
    await sendReply(
      job.sender,
      removed
        ? `Removed scheduled workflow ${job.command.scheduleId}.`
        : `No scheduled workflow matched ${job.command.scheduleId || "that id"}.`
    );
    return;
  }

  if (job.command.type === "remove-avatar") {
    await signalProfile.updateAvatar({ remove: true });
    await sendJobReply(job, "Removed Sable's Signal profile picture.");
    return;
  }

  if (job.command.type === "auth-status") {
    await sendJobReply(job, pluginAuth.formatStatus(state.pendingPluginAuth));
    return;
  }

  if (job.command.type === "auth-cancel") {
    if (!state.pendingPluginAuth) {
      await sendJobReply(job, "No plugin auth flow is currently pending.");
      return;
    }

    pluginAuth.clear();
    await sendJobReply(job, "Cleared the pending plugin auth flow.");
    return;
  }

  if (job.command.type === "auth-resume") {
    if (!state.pendingPluginAuth) {
      await sendJobReply(job, "No plugin auth flow is ready to resume.");
      return;
    }

    if (state.pendingPluginAuth.status !== "completed") {
      await sendJobReply(job, pluginAuth.formatStatus(state.pendingPluginAuth));
      return;
    }

    if (!state.pendingPluginAuth.sourcePrompt) {
      pluginAuth.clear();
      await sendJobReply(job, "The plugin connected, but there is no saved prompt to retry. Ask again normally.");
      return;
    }

    const resumePrompt = state.pendingPluginAuth.sourcePrompt;
    pluginAuth.clear();
    job.command = { type: "prompt", prompt: resumePrompt };
  }

  if (job.command.type === "telegram-triage") {
    await sendJobReply(job, await getTelegramTriageReport(job.command.limit));
    return;
  }

  if (job.command.type === "new" && !job.command.prompt) {
    clearSessionState("interactive");
    await sendJobReply(job, "Started a new Sable session. Your next message will use fresh context.");
    return;
  }

  const backgroundJob = isBackgroundJob(job);
  const sessionStateKey = getSessionStateKeyForJob(job);
  const sessionKind = backgroundJob ? "background" : "interactive";
  const shouldResume = Boolean(state[sessionStateKey]) && job.command.type !== "new";
  const imagePaths = await signalAttachments.materializeIncomingImages(job.context);
  const filePaths = await signalAttachments.materializeIncomingFiles(job.context);
  let audioPaths = [];
  let preparedVoiceNote = null;
  if (job.queuedVoicePreparation) {
    try {
      preparedVoiceNote = await job.queuedVoicePreparation;
      audioPaths = preparedVoiceNote.audioPaths;
    } catch (error) {
      console.error(
        `[${timestamp()}] Background voice-note preparation failed for ${job.sender}: ${error.message}`
      );
    }
  }

  if (audioPaths.length === 0) {
    audioPaths = await signalAttachments.materializeIncomingAudio(job.context);
  }
  const jobControl = createJobControl(job.sender);
  const autoresearchBefore =
    backgroundJob && isAutoresearchTickJob(job) ? autoresearchMonitor.snapshotRuns() : null;
  if (!backgroundJob) {
    activeSender = job.sender;
    activeJobControl = jobControl;
  }

  try {
    let prompt = job.command.prompt;

    if (job.command.type === "set-avatar") {
      if (imagePaths.length === 0) {
        await sendJobReply(job, "Attach an image with `/setavatar` and I'll use the first image as Sable's profile picture.");
        return;
      }

      await signalProfile.updateAvatar({ avatarPath: imagePaths[0] });
      const suffix =
        imagePaths.length > 1 ? ` Used the first attached image and ignored ${imagePaths.length - 1} extra image${imagePaths.length === 2 ? "" : "s"}.` : "";
      await sendJobReply(job, `Updated Sable's Signal profile picture.${suffix}`);
      return;
    }

    if (audioPaths.length > 0) {
      if (!voiceNotes.isEnabled()) {
        await sendJobReply(job, "Voice note transcription is disabled.");
        return;
      }

      let transcription = preparedVoiceNote?.transcription || null;
      if (!transcription) {
        await sendJobProgressReply(job, "Transcribing voice note...");
        transcription = await voiceNotes.transcribe(audioPaths[0], jobControl);
      }

      if (!normalizeText(transcription?.transcript)) {
        await sendJobReply(job, "Voice note transcription returned no text.");
        return;
      }

      if (VOICE_NOTES_ECHO_TRANSCRIPT) {
        await sendJobProgressReply(job, voiceNotes.formatTranscriptMessage(transcription));
      }

      prompt = transcription.transcript;
    }

    if (filePaths.length > 0) {
      await sendJobProgressReply(job, "Reading attached files...");
      const fileContext = await signalAttachments.buildFileAttachmentPromptContext(job.context, filePaths);
      if (!fileContext.ok) {
        await sendJobProgressReply(
          job,
          `${fileContext.message} I still exposed the local attachment path for this turn in case a tool can use the file directly.`
        );
      } else {
        prompt = mergePromptSegments(prompt, fileContext.promptText);
      }
    }

    const localAttachmentContext = signalAttachments.buildLocalAttachmentPathPromptContext(job.context, {
      imagePaths,
      audioPaths,
      filePaths,
    });
    prompt = mergePromptSegments(prompt, localAttachmentContext);

    if (!normalizeText(prompt)) {
      await sendJobReply(job, "There was no usable text prompt to send to Sable.");
      return;
    }

    if (!backgroundJob) {
      setInFlightTurn(job.sender, prompt);
    }
    const result = await runCodex(
      prompt,
      shouldResume ? state[sessionStateKey] : null,
      imagePaths,
      jobControl,
      backgroundJob || shouldSuppressJobReplies(job),
      () => clearSessionState(sessionKind)
    );

    if (result.sessionId) {
      state[sessionStateKey] = result.sessionId;
      saveState();
    }

    if (result.startedFreshBecauseResumeFailed) {
      await sendJobProgressReply(
        job,
        "Previous Sable session was unavailable, so I started a fresh session before answering."
      );
    }

    if (result.toolSuggestion) {
      const handled = await pluginAuth.maybeStart(job.sender, prompt, result.toolSuggestion);
      if (handled) {
        if (
          result.message &&
          appServerMessages.shouldForwardAgentMessageAlongsideToolSuggestion(result.message)
        ) {
          await sendJobReply(job, result.message);
        }
        return;
      }
    }

    if (
      job.allowSilentNoReply &&
      normalizeText(result.message) === SCHEDULED_NO_REPLY_MARKER
    ) {
      if (autoresearchBefore) {
        await autoresearchMonitor.sendCompletionNotices(autoresearchBefore, job.sender, sendReply);
      }
      return;
    }

    if (result.message) {
      await sendJobReply(job, result.message);
    } else if (!shouldSuppressJobReplies(job)) {
      await sendReply(job.sender, "Sable completed without a final message.");
    }

    if (autoresearchBefore) {
      await autoresearchMonitor.sendCompletionNotices(autoresearchBefore, job.sender, sendReply);
    }
  } finally {
    if (!backgroundJob) {
      clearInFlightTurn();
      activeSender = null;
      if (activeJobControl === jobControl) {
        activeJobControl = null;
      }
    }
    await cleanupPaths(imagePaths);
    await cleanupPaths(audioPaths);
    await cleanupPaths(filePaths);
  }
}

function shouldSuppressJobReplies(job) {
  return job?.replyMode === "silent";
}

async function sendJobReply(job, message) {
  if (shouldSuppressJobReplies(job)) {
    return;
  }
  await sendReply(job.sender, message);
}

async function sendJobProgressReply(job, message) {
  if (isBackgroundJob(job)) {
    return;
  }
  await sendJobReply(job, message);
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
  return new Promise((resolve, reject) => {
    const startedAt = timestamp();
    const liveUpdates = createLiveUpdateChannel({
      batchWindowMs: LIVE_UPDATE_BATCH_WINDOW_MS,
      duplicateWindowMs: LIVE_UPDATE_DUPLICATE_WINDOW_MS,
      logger: console,
      normalizeText,
      recipient: suppressLiveUpdates ? "" : activeSender,
      sendReply,
      timestamp,
    });
    let parsedSessionId = sessionId || null;
    let pendingAgentMessage = null;
    let finalMessage = "";
    const subagentState = appServerMessages.createSubagentProgressState();
    let turnId = null;
    let toolSuggestion = null;
    let didFinish = false;
    let timeout = null;
    const toolSuggestionCalls = new Map();

    const client = createAppServerClient({
      onNotification: handleNotification,
      onServerRequest: handleServerRequest,
      replyRecipient: activeSender,
    });
    const unregisterCancellation = registerCancellationHandler(jobControl, (error) => {
      fail(error);
    });

    function resetTimeout() {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        fail(new Error("app-server turn timed out"));
      }, APP_SERVER_IDLE_TIMEOUT_MS);
    }

    function cleanup() {
      clearTimeout(timeout);
      liveUpdates.stop();
      unregisterCancellation();
      client.close();
    }

    function fail(error) {
      if (didFinish) {
        return;
      }
      didFinish = true;
      cleanup();
      reject(error);
    }

    async function succeed() {
      if (didFinish) {
        return;
      }
      didFinish = true;

      if (pendingAgentMessage) {
        finalMessage = pendingAgentMessage;
        pendingAgentMessage = null;
      }

      try {
        await liveUpdates.flush();
      } catch (error) {
        console.error(`[${timestamp()}] Failed flushing app-server live updates: ${error.message}`);
      }

      if (!toolSuggestion && parsedSessionId) {
        try {
          toolSuggestion = await codexSessionReader.findToolSuggestionForTurn(
            parsedSessionId,
            startedAt
          );
        } catch (error) {
          console.error(
            `[${timestamp()}] Failed reading structured tool suggestions: ${error.message}`
          );
        }
      }

      if (!normalizeText(finalMessage) && parsedSessionId) {
        try {
          finalMessage = await codexSessionReader.findSessionErrorMessageForTurn(
            parsedSessionId,
            startedAt
          );
        } catch (error) {
          console.error(
            `[${timestamp()}] Failed reading structured session error: ${error.message}`
          );
        }
      }

      cleanup();
      resolve({
        sessionId: parsedSessionId,
        message: finalMessage,
        toolSuggestion,
        startedFreshBecauseResumeFailed: false,
      });
    }

    function handleNotification(message) {
      resetTimeout();
      ops.captureUsageSnapshot(message);
      ops.captureRateLimitSnapshot(message);

      if (message.method === "turn/started") {
        turnId = normalizeText(message.params?.turn?.id) || turnId;
        ops.noteTurnStarted();
        liveUpdates.queue("• Working...");
        return;
      }

      const rawSuggestion = appServerMessages.captureToolSuggestionFromNotification(
        message,
        toolSuggestionCalls
      );
      if (rawSuggestion) {
        toolSuggestion = rawSuggestion;
        return;
      }

      if (message.method === "item/started" || message.method === "item/completed") {
        appServerMessages.handleSubagentToolCallNotification(message, subagentState, liveUpdates);
        const parsed = appServerMessages.handleCodexAppServerItem(message.params?.item, {
          pendingAgentMessage,
          finalMessage,
          liveUpdates,
          subagentState,
        });
        pendingAgentMessage = parsed.pendingAgentMessage;
        finalMessage = parsed.finalMessage;
        return;
      }

      if (message.method === "item/mcpToolCall/progress") {
        const progress = normalizeText(message.params?.message);
        if (progress && !subagentState.activeCount) {
          liveUpdates.queue(formatProgressMessage(progress));
        }
        return;
      }

      if (message.method === "item/autoApprovalReview/started") {
        const summary = normalizeText(message.params?.review?.summary) || "Approval review in progress.";
        liveUpdates.queue(formatProgressMessage(summary));
        return;
      }

      if (message.method === "item/autoApprovalReview/completed") {
        const outcome =
          normalizeText(message.params?.review?.summary) ||
          normalizeText(message.params?.decisionSource) ||
          "Approval review completed.";
        liveUpdates.queue(formatProgressMessage(outcome));
        return;
      }

      if (message.method === "turn/completed") {
        if (normalizeText(message.params?.turn?.id) === turnId || !turnId) {
          ops.noteTurnCompleted();
          void succeed();
        }
      }
    }

    async function handleServerRequest(message) {
      resetTimeout();

      if (message.method === "item/commandExecution/requestApproval") {
        return { decision: "approved" };
      }

      if (message.method === "item/fileChange/requestApproval") {
        return { decision: "approved" };
      }

      if (message.method === "item/permissions/requestApproval") {
        return {
          permissions: message.params?.permissions || {},
          scope: "turn",
        };
      }

      if (message.method === "item/tool/requestUserInput") {
        const promptText = appServerMessages.formatToolUserInputRequest(message.params);
        if (promptText && activeSender) {
          await sendReply(activeSender, promptText);
        }
        return { answers: {} };
      }

      if (message.method === "mcpServer/elicitation/request") {
        console.log(
          `[${timestamp()}] MCP elicitation request: ${truncateText(
            JSON.stringify(message.params),
            600
          )}`
        );

        const autoResponse = appServerMessages.buildAutoAcceptedMcpElicitationResponse(
          message.params
        );
        if (autoResponse) {
          return autoResponse;
        }

        const promptText = appServerMessages.formatMcpElicitationRequest(message.params);
        if (promptText && activeSender) {
          await sendReply(activeSender, promptText);
        }
        return { action: "cancel" };
      }

      return {};
    }

    (async () => {
      try {
        await client.initialize();

        const threadMethod = sessionId ? "thread/resume" : "thread/start";
        const threadParams = buildAppServerThreadParams(sessionId);
        testSupport.appendAppServerLog({
          method: threadMethod,
          params: threadParams,
        });
        const threadResponse = await client.request(threadMethod, threadParams);

        parsedSessionId =
          normalizeText(threadResponse?.thread?.id) ||
          normalizeText(threadResponse?.threadId) ||
          parsedSessionId;

        const turnParams = {
          ...buildAppServerTurnParams(parsedSessionId, prompt, imagePaths),
        };
        testSupport.appendAppServerLog({
          method: "turn/start",
          params: turnParams,
        });
        const turnResponse = await client.request("turn/start", turnParams);

        turnId = normalizeText(turnResponse?.turn?.id) || turnId;
        resetTimeout();
      } catch (error) {
        if (sessionId && isInvalidSessionError(String(error?.message || error))) {
          if (typeof onInvalidSession === "function") {
            onInvalidSession();
          }
          client.close();
          try {
            const freshResult = await runCodexViaAppServer(
              prompt,
              null,
              imagePaths,
              null,
              suppressLiveUpdates,
              onInvalidSession
            );
            resolve({
              ...freshResult,
              startedFreshBecauseResumeFailed: true,
            });
          } catch (freshError) {
            reject(freshError);
          }
          return;
        }

        fail(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

function buildAppServerThreadParams(threadId = null) {
  const params = {
    cwd: CODEX_CWD,
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "guardian_subagent",
    personality: "pragmatic",
  };

  if (threadId) {
    params.threadId = threadId;
  }

  return params;
}

function buildAppServerTurnParams(threadId, prompt, imagePaths = []) {
  return {
    threadId,
    cwd: CODEX_CWD,
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "guardian_subagent",
    personality: "pragmatic",
    input: [
      { type: "text", text: prompt },
      ...imagePaths.map((imagePath) => ({ type: "localImage", path: imagePath })),
    ],
  };
}

async function checkForPendingPluginAuth() {
  try {
    await pluginAuth.check();
  } catch (error) {
    console.error(`[${timestamp()}] ${error.message}`);
  }
}

function normalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

function formatProgressMessage(text) {
  return `• ${normalizeText(text)}`;
}

function truncateText(text, maxLength) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatSlugForDisplay(value) {
  return normalizeText(value)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

let activeSender = null;

function mergePromptSegments(...segments) {
  const normalized = segments.map((segment) => normalizeText(segment)).filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }

  return normalized.join("\n\n");
}

async function cleanupPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return;
  }

  const parentDir = path.dirname(paths[0]);
  await fs.promises.rm(parentDir, { recursive: true, force: true });
}

function checkForRestartRequest() {
  if (!restartRequested && fs.existsSync(RESTART_REQUEST_PATH)) {
    restartRequested = true;
  }

  if (
    !isProcessingInteractive &&
    !isProcessingBackground &&
    interactiveQueue.length === 0 &&
    backgroundQueue.length === 0
  ) {
    void restartIfRequested();
  }
}

async function restartIfRequested() {
  if (!restartRequested) {
    return;
  }

  restartRequested = false;

  try {
    await broadcastAllowedMessage("🟡 Restarting Connection to Sable");
    await fs.promises.writeFile(RESTART_NOTICE_PATH, `${timestamp()}\n`, "utf8");
  } catch (error) {
    console.error(`[${timestamp()}] Failed sending restart notification: ${error.message}`);
  }

  try {
    await fs.promises.rm(RESTART_REQUEST_PATH, { force: true });
  } catch (error) {
    console.error(`[${timestamp()}] Failed clearing restart request: ${error.message}`);
  }

  console.log(`[${timestamp()}] Restart requested after completing current work`);
  if (signalProcess && !signalProcess.killed) {
    signalProcess.kill("SIGTERM");
  }
  process.exit(0);
}

async function maybeSendRestartReconnectNotice() {
  if (!fs.existsSync(RESTART_NOTICE_PATH)) {
    return;
  }

  try {
    await broadcastAllowedMessage("🟢 Reconnected to Sable");
    await fs.promises.rm(RESTART_NOTICE_PATH, { force: true });
  } catch (error) {
    console.error(`[${timestamp()}] Failed sending reconnect notification: ${error.message}`);
  }
}

async function maybeSendInterruptedTurnNotice() {
  if (!state.inFlightTurn) {
    return;
  }

  const interruptedTurn = state.inFlightTurn;
  clearInFlightTurn();

  try {
    await sendReply(interruptedTurn.sender, formatInterruptedTurnNotice(interruptedTurn));
  } catch (error) {
    console.error(
      `[${timestamp()}] Failed sending interrupted-turn notice: ${error.message}`
    );
  }
}

async function getBridgeStatusReport() {
  const [bridgeService, watcherService] = await Promise.all([
    getSystemdUnitSummary("signal-codex-bridge.service"),
    getSystemdUnitSummary("signal-codex-bridge-restart.service"),
  ]);

  const interactiveSessionLine = state.interactiveSessionId
    ? `interactive session: ${truncateText(state.interactiveSessionId, 20)}`
    : "interactive session: none";
  const backgroundSessionLine = state.backgroundSessionId
    ? `background session: ${truncateText(state.backgroundSessionId, 20)}`
    : "background session: none";
  const obsidianLinkServerAddress = obsidianLinks.getServerAddress();
  const obsidianServerLine = obsidianLinkServerAddress
    ? `obsidian links: listening on ${obsidianLinks.host}:${obsidianLinkServerAddress.port}`
    : `obsidian links: ${obsidianLinks.enabled ? "starting or unavailable" : "disabled"}`;
  const obsidianBaseUrlLine = obsidianLinks.baseUrl
    ? `obsidian base url: ${obsidianLinks.baseUrl}`
    : "obsidian base url: none";

  return [
    `bridge: ${formatUnitSummary(bridgeService)}`,
    `watcher: ${formatUnitSummary(watcherService)}`,
    `interactive queue: ${interactiveQueue.length} pending, processing=${isProcessingInteractive ? "yes" : "no"}`,
    `background queue: ${backgroundQueue.length} pending, processing=${isProcessingBackground ? "yes" : "no"}`,
    `scheduler: ${schedulerJobs.filter((job) => job?.active !== false).length} active workflow${schedulerJobs.filter((job) => job?.active !== false).length === 1 ? "" : "s"}`,
    interactiveSessionLine,
    backgroundSessionLine,
    obsidianServerLine,
    obsidianBaseUrlLine,
    `auth: ${pluginAuth.summarize(state.pendingPluginAuth)}`,
  ].join("\n");
}

function formatInterruptedTurnNotice(interruptedTurn) {
  const lines = [
    "Previous reply was interrupted by a bridge restart before Sable could finish.",
    "Ask me to continue and I'll pick it back up if the session survived.",
  ];

  if (interruptedTurn.promptPreview) {
    lines.push(`Last prompt: ${interruptedTurn.promptPreview}`);
  }

  return lines.join("\n");
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

function parseSystemdShowOutput(stdout) {
  const values = {};

  for (const line of String(stdout || "").split("\n")) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    values[key] = value;
  }

  return {
    activeState: values.ActiveState || "unknown",
    subState: values.SubState || "unknown",
    activeEnterTimestamp: values.ActiveEnterTimestamp || "unavailable",
    execMainPid: values.ExecMainPID || "",
  };
}

function formatUnitSummary(summary) {
  const state = `${summary.activeState}/${summary.subState}`;
  const pid = summary.execMainPid ? ` pid=${summary.execMainPid}` : "";
  const since = summary.activeEnterTimestamp && summary.activeEnterTimestamp !== "n/a"
    ? ` since=${summary.activeEnterTimestamp}`
    : "";
  return `${state}${pid}${since}`;
}

function isInvalidSessionError(stderr) {
  const text = stderr.toLowerCase();
  return (
    text.includes("session not found") ||
    text.includes("conversation not found") ||
    text.includes("no rollout found for thread id") ||
    (text.includes("thread") && text.includes("not found")) ||
    (text.includes("invalid") && text.includes("session"))
  );
}

function splitIntoChunks(text, limit = MAX_SIGNAL_MESSAGE_LENGTH) {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > limit) {
    let splitIndex = remaining.lastIndexOf("\n", limit);
    if (splitIndex <= 0) {
      splitIndex = limit;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    remaining = remaining.slice(splitIndex).replace(/^\s+/, "");
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.length > 0 ? chunks : ["No output from Sable."];
}

async function sendReply(recipient, text) {
  const formattedText = obsidianLinks.rewriteMarkdownDocumentReferencesForSignal(text);
  const chunks = splitIntoChunks(formattedText);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await sendSignalMessage(recipient, chunk);
    logOutgoing(recipient, chunk, index + 1, chunks.length);

    if (index < chunks.length - 1) {
      await delay(CHUNK_DELAY_MS);
    }
  }
}

async function broadcastAllowedMessage(text) {
  const recipients = [...allowedNumbers];

  for (const recipient of recipients) {
    await sendSignalMessage(recipient, text);
    logOutgoing(recipient, text, 1, 1);
  }
}

function sendSignalMessage(recipient, message) {
  return sendSignalRequest("send", {
    recipient: [recipient],
    message,
  });
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
  if (TEST_SIGNAL_LOG_PATH) {
    testSupport.appendSignalLog({
      direction: "request",
      message: {
        jsonrpc: "2.0",
        method,
        params,
      },
    });

    if (method === "getAttachment") {
      const attachment = testSupport.getAttachmentMap()[params?.id];
      return Promise.resolve(attachment ? { data: attachment.dataBase64 } : { data: "" });
    }

    if (method === "send") {
      return Promise.resolve({ timestamp: Date.now() });
    }

    if (method === "updateProfile") {
      return Promise.resolve({ ok: true });
    }
  }

  return new Promise((resolve, reject) => {
    const id = nextSignalRequestId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id,
    });

    pendingSignalRequests.set(id, { resolve, reject });

    signalProcess.stdin.write(`${payload}\n`, (error) => {
      if (error) {
        pendingSignalRequests.delete(id);
        reject(error);
      }
    });
  });
}

function rejectAllPendingSignalRequests(error) {
  for (const [id, pending] of pendingSignalRequests.entries()) {
    pendingSignalRequests.delete(id);
    pending.reject(error);
  }
}

function logIncoming(sender, message, imageCount = 0) {
  ops.noteIncoming(sender);
  const imageLabel = imageCount > 0 ? ` [images=${imageCount}]` : "";
  console.log(`[${timestamp()}] IN  ${sender}${imageLabel}: ${message}`);
}

function logOutgoing(recipient, message, chunkNumber, totalChunks) {
  ops.noteOutgoing(recipient);
  const label = totalChunks > 1 ? ` (${chunkNumber}/${totalChunks})` : "";
  console.log(
    `[${timestamp()}] OUT ${recipient}${label}: ${message.slice(0, 120).replace(/\n/g, "\\n")}`
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  if (shutdownRequested) {
    return;
  }

  shutdownRequested = true;

  if (
    isProcessingInteractive ||
    isProcessingBackground ||
    interactiveQueue.length > 0 ||
    backgroundQueue.length > 0
  ) {
    restartRequested = true;
    console.log(
      `[${timestamp()}] Shutdown requested while work is active; deferring exit until both queues drain`
    );
    if (!isProcessingInteractive && interactiveQueue.length > 0) {
      void processInteractiveQueue();
    }
    if (!isProcessingBackground && backgroundQueue.length > 0) {
      void processBackgroundQueue();
    }
    return;
  }

  console.log(`[${timestamp()}] Shutting down bridge`);
  obsidianLinks.closeServer();
  rejectAllPendingSignalRequests(new Error("Bridge shutting down"));
  if (signalProcess && !signalProcess.killed) {
    signalProcess.kill("SIGTERM");
  }
  process.exit(0);
}
