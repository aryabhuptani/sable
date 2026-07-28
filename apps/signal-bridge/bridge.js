#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");
const {
  computeFollowingRunAt,
  formatScheduleList,
  loadSchedulerJobs,
  loadSchedulerState,
  normalizeJobTimezoneMode,
  saveSchedulerJobs,
} = require("./scheduler");
const { formatHelp, parseCommand } = require("./bridge-commands");
const { createAppServerMessageHelpers } = require("./app-server-message-helpers");
const { createAppServerTurnRunner } = require("./app-server-turn-runner");
const { createAutoresearchMonitor } = require("./autoresearch-monitor");
const { createBridgeLifecycle } = require("./bridge-lifecycle");
const { createBridgeOpsManager } = require("./bridge-ops");
const { createBridgeJobRuntime } = require("./bridge-job-runtime");
const { createBridgeRunCommands } = require("./bridge-run-commands");
const {
  createBridgeConfig,
  validateBridgeConfig,
} = require("./bridge-config");
const { createBridgeQueueRuntime } = require("./bridge-queue-runtime");
const { createBridgeSchedulerRuntime } = require("./bridge-scheduler-runtime");
const { createBridgeStateStore } = require("./bridge-state-store");
const { createBridgeTestSupport } = require("./bridge-test-support");
const { createCodexSessionReader } = require("./codex-session-reader");
const { createEmployeeRuntime } = require("./employee-runtime");
const { createEmployeeStore } = require("./employee-store");
const {
  createMattermostTransport,
  formatMattermostTarget,
  parseMattermostTarget,
} = require("./mattermost-transport");
const { createObsidianLinkPlugin } = require("./obsidian-link-plugin");
const {
  createPluginAuthManager,
  normalizePendingPluginAuth,
} = require("./plugin-auth-manager");
const { createPluginRuntime } = require("./plugin-runtime");
const { createHermesCliRunnerAdapter } = require("./hermes-cli-runner");
const { createCodexCliRunnerAdapter } = require("./runner-adapter");
const {
  cancelJobControl,
  createJobControl,
  isCancellationError,
  registerCancellationHandler,
} = require("./job-control");
const { createBackgroundJobRunStore } = require("../../tools/runtime/run-kernel");
const { createLiveUpdateChannel } = require("./live-update-channel");
const { createScheduledAttachmentDiscovery } = require("./scheduled-attachment-discovery");
const { createSignalAttachmentPlugin } = require("./signal-attachment-plugin");
const { createSignalInboundPlugin } = require("./signal-inbound-plugin");
const { createSignalProfilePlugin } = require("./signal-profile-plugin");
const { createSignalReplyChannel } = require("./signal-reply-channel");
const { createSignalRpcSession } = require("./signal-rpc-session");
const { createTelegramReviewPlugin } = require("./telegram-review-plugin");
const { createWhatsAppReviewPlugin } = require("./whatsapp-review-plugin");
const { createVoiceNotePlugin } = require("./voice-note-plugin");
const {
  delay,
  formatProgressMessage,
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
const {
  parseArgs: parseBackgroundJobArgs,
  startJob: startBackgroundJob,
} = require("../../tools/background-job/background-job");

require("dotenv").config();

const PROJECT_DIR = __dirname;
const INSTANCE_CONFIG = createInstanceConfig();
const BRIDGE_CONFIG = createBridgeConfig({
  env: process.env,
  execFileSync,
  fs,
  instanceConfig: INSTANCE_CONFIG,
  normalizeBooleanEnv,
  normalizeIntegerEnv,
  normalizeText,
  parseAllowedNumbers,
  projectDir: PROJECT_DIR,
});
const {
  APP_SERVER_CLIENT_VERSION,
  APP_SERVER_IDLE_TIMEOUT_MS,
  APP_SERVER_REQUEST_TIMEOUT_MS,
  ATTACHMENT_QUEUE_PENDING_DIR,
  ATTACHMENT_QUEUE_RESULTS_DIR,
  CHUNK_DELAY_MS,
  CODEX_CWD,
  CODEX_HOME_ROOT,
  CODEX_SESSIONS_DIR,
  DEFAULT_FILE_PROMPT,
  DEFAULT_IMAGE_PROMPT,
  DEFAULT_SCHEDULER_JOBS_PATH,
  EMPLOYEE_CODEX_CREDENTIAL_FILES,
  EMPLOYEE_CODEX_CREDENTIAL_SOURCE,
  EMPLOYEE_RUNTIME_ROOT,
  EMPLOYEES_ROOT,
  EXTRACT_PDF_SCRIPT_PATH,
  LIVE_UPDATE_BATCH_WINDOW_MS,
  LIVE_UPDATE_DUPLICATE_WINDOW_MS,
  MAX_COMMAND_TEXT_LENGTH,
  MAX_FAILURE_OUTPUT_LENGTH,
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_FILE_EXCERPT_CHARS,
  MAX_SIGNAL_MESSAGE_LENGTH,
  MAX_SCHEDULED_LOCAL_IMAGE_BYTES,
  MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES,
  MAX_SCHEDULED_LOCAL_IMAGES,
  MAX_TEXT_ATTACHMENT_BYTES,
  MAX_TOTAL_FILE_CONTEXT_CHARS,
  OPS_ALERT_BRIDGE_RSS_THRESHOLD_BYTES,
  OPS_ALERT_IN_FLIGHT_TURN_THRESHOLD_MS,
  OPS_ALERTS_ENABLED,
  OPS_ROOT,
  OPS_SNAPSHOT_INTERVAL_MS,
  OPS_STALLED_RUN_THRESHOLD_MS,
  MATTERMOST_ALLOWED_USERS,
  MATTERMOST_BASE_URL,
  MATTERMOST_BOT_USER_ID,
  MATTERMOST_CHANNEL_ID,
  MATTERMOST_CURSOR_PATH,
  MATTERMOST_DM_USER_IDS,
  MATTERMOST_ENABLED,
  MATTERMOST_PARENT_CHANNEL,
  MATTERMOST_POLL_INTERVAL_MS,
  MATTERMOST_TEAM,
  MATTERMOST_TOKEN,
  PDF_EXTRACT_PYTHON_BIN,
  PENDING_PLUGIN_AUTH_POLL_INTERVAL_MS,
  PRIMARY_RUNNER,
  RESEARCH_ROOT,
  RESTART_NOTICE_PATH,
  RESTART_REQUEST_PATH,
  SCHEDULED_NO_REPLY_MARKER,
  SCHEDULER_JOBS_PATH,
  SCHEDULER_POLL_INTERVAL_MS,
  SCHEDULER_STATE_PATH,
  SIGNAL_BRIDGE_DIR_ENV,
  SIGNAL_REPLY_TO_ENV,
  STATE_PATH,
  HERMES_CONTAINER,
  HERMES_CWD,
  HERMES_TIMEOUT_MS,
  TEST_APP_SERVER_LOG_PATH,
  TEST_RECEIVE_SCENARIO_PATH,
  TEST_SIGNAL_LOG_PATH,
  TEST_TURN_CURSOR_PATH,
  TEST_TURN_SCENARIO_PATH,
  TRANSCRIBE_PYTHON_BIN,
  TRANSCRIBE_SCRIPT_PATH,
  VOICE_NOTES_BEAM_SIZE,
  VOICE_NOTES_COMPUTE_TYPE,
  VOICE_NOTES_ECHO_TRANSCRIPT,
  VOICE_NOTES_ENABLED,
  VOICE_NOTES_LANGUAGE,
  VOICE_NOTES_MODEL,
  VOICE_NOTES_MODEL_PATH,
  VOICE_NOTES_TIMEOUT_SEC,
  allowedNumbers,
  allowedSenders,
  phoneNumber,
} = BRIDGE_CONFIG;
const telegramReview = createTelegramReviewPlugin({
  execFile,
  env: process.env,
  instanceConfig: INSTANCE_CONFIG,
  truncateText,
});
const TELEGRAM_TRIAGE_LIMIT = telegramReview.triageLimit;
const whatsappReview = createWhatsAppReviewPlugin({
  execFile,
  env: process.env,
  instanceConfig: INSTANCE_CONFIG,
  truncateText,
});
const WHATSAPP_TRIAGE_LIMIT = whatsappReview.triageLimit;
const obsidianLinks = createObsidianLinkPlugin({
  env: process.env,
  instanceConfig: INSTANCE_CONFIG,
  logger: console,
});
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
const employeeStore = createEmployeeStore({
  agentsRoot: EMPLOYEES_ROOT,
  runtimeRoot: EMPLOYEE_RUNTIME_ROOT,
});
const employeeRuntime = createEmployeeRuntime({
  employeeStore,
  repoRoot: INSTANCE_CONFIG.repoRoot,
  codexCredentialFiles: EMPLOYEE_CODEX_CREDENTIAL_FILES,
  codexCredentialSource: EMPLOYEE_CODEX_CREDENTIAL_SOURCE,
  dockerEnabled: normalizeBooleanEnv(process.env.SABLE_EMPLOYEE_DOCKER_ENABLED, true),
  dockerImage: normalizeText(process.env.SABLE_EMPLOYEE_DOCKER_IMAGE) || "node:22-bookworm",
});
const pluginRuntime = createPluginRuntime({
  env: process.env,
  instanceConfig: INSTANCE_CONFIG,
  logger: console,
  repoRoot: INSTANCE_CONFIG.repoRoot,
  services: {
    employeeRuntime,
    employeeStore,
  },
  sendReply,
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
  loadSchedulerState,
  normalizeText,
  normalizeJobTimezoneMode,
  saveSchedulerJobs,
  defaultSchedulerJobsPath: DEFAULT_SCHEDULER_JOBS_PATH,
  defaultScheduledSender: [...allowedNumbers][0] || [...allowedSenders][0] || "",
  schedulerJobsPath: SCHEDULER_JOBS_PATH,
  schedulerStatePath: SCHEDULER_STATE_PATH,
  timestamp,
  launchScheduledWorker: async (request) => {
    const args = [
      "start",
      "--name", request.name,
      "--cwd", INSTANCE_CONFIG.homeDir,
      "--prompt", request.prompt,
      "--agent-profile", request.agentProfile,
      "--trigger", request.trigger,
      "--visibility", request.visibility,
      "--delivery", request.delivery,
    ];
    if (request.model) args.push("--model", request.model);
    if (request.recipient) args.push("--recipient", request.recipient);
    return startBackgroundJob(parseBackgroundJobArgs(args));
  },
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
let jobRuntime;
let lifecycle;
let queueRuntime;
let signalReplyChannel;
let signalRpc;
let mattermostTransport;

let state = stateStore.loadState();
let restartRequested = false;
let shutdownRequested = false;
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
  getLiveState: () =>
    queueRuntime.getLiveState({
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
mattermostTransport = createMattermostTransport({
  allowedUsers: MATTERMOST_ALLOWED_USERS,
  baseUrl: MATTERMOST_BASE_URL,
  botUserId: MATTERMOST_BOT_USER_ID,
  cursorPath: MATTERMOST_CURSOR_PATH,
  dmUserIds: MATTERMOST_DM_USER_IDS,
  enabled: MATTERMOST_ENABLED,
  logger: console,
  onEnvelope: handleMattermostEnvelope,
  parentChannel: MATTERMOST_PARENT_CHANNEL,
  parentChannelId: MATTERMOST_CHANNEL_ID,
  pollIntervalMs: MATTERMOST_POLL_INTERVAL_MS,
  team: MATTERMOST_TEAM,
  token: MATTERMOST_TOKEN,
});
queueRuntime = createBridgeQueueRuntime({
  cancelJobControl,
  cleanupPaths,
  defaultFilePrompt: DEFAULT_FILE_PROMPT,
  defaultImagePrompt: DEFAULT_IMAGE_PROMPT,
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
  getJobRuntime: () => jobRuntime,
  getRestartRequested: () => restartRequested,
  getShutdownRequested: () => shutdownRequested,
  isCancellationError,
  logIncoming,
  logger: console,
  onQueueDrained: async () => {
    await lifecycle?.restartIfRequested();
  },
  parseCommand,
  pluginRuntime,
  schedulerRuntime,
  sendReply,
  signalAttachments,
  signalInbound,
  telegramTriageLimit: TELEGRAM_TRIAGE_LIMIT,
  whatsappTriageLimit: WHATSAPP_TRIAGE_LIMIT,
  timestamp,
  voiceNotes,
});
const codexRunner = createCodexCliRunnerAdapter({
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
const hermesRunner = createHermesCliRunnerAdapter({
  spawn,
  containerName: HERMES_CONTAINER,
  workspaceDir: HERMES_CWD,
  timeoutMs: HERMES_TIMEOUT_MS,
  normalizeText,
  timestamp,
  onLifecycle: testSupport.appendAppServerLog,
  onStderr(text) {
    ops.noteCodexAppServerStderr(text);
    console.error(`[${timestamp()}] hermes cli stderr: ${text}`);
  },
});
const runner = normalizeRunnerName(PRIMARY_RUNNER) === "hermes-cli" ? hermesRunner : codexRunner;
const {
  createAppServerClient,
  callCodexAppServer,
} = codexRunner;
const { recordTestLaunchArgs, probeRuntimeProfile } = runner;
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
  getActiveSender: () => queueRuntime.getActiveSender(),
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
  isInteractiveProcessing: () => queueRuntime.isInteractiveProcessing(),
  savePending: (pendingPluginAuth) => {
    state.pendingPluginAuth = pendingPluginAuth;
    saveState();
  },
  sendReply,
  timestamp,
});
const runStore = createBackgroundJobRunStore({
  jobsRoot: path.join(INSTANCE_CONFIG.runsRoot || path.dirname(INSTANCE_CONFIG.projectTasksPath), "background-jobs"),
});
const runCommands = createBridgeRunCommands({ runStore });
jobRuntime = createBridgeJobRuntime({
  appServerMessages,
  autoresearchMonitor,
  cleanupPaths,
  clearActiveJob: queueRuntime.clearActiveJob,
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
  getWhatsAppTriageReport,
  formatHelp,
  mergePromptSegments,
  normalizeText,
  pluginAuth,
  pluginRuntime,
  runCommands,
  runCodex,
  saveSessionId: (key, sessionId) => {
    state[key] = sessionId;
    saveState();
  },
  schedulerRuntime,
  scheduledNoReplyMarker: SCHEDULED_NO_REPLY_MARKER,
  sendReply,
  setActiveJob: queueRuntime.setActiveJob,
  setInFlightTurn,
  signalAttachments,
  signalProfile,
  timestamp,
  voiceNotes,
  voiceNotesEchoTranscript: VOICE_NOTES_ECHO_TRANSCRIPT,
});
lifecycle = createBridgeLifecycle({
  backgroundQueue: queueRuntime.backgroundQueue,
  broadcastAllowedMessage,
  clearInFlightTurn,
  closeServer: () => {
    obsidianLinks.closeServer();
    mattermostTransport?.stop?.();
  },
  fs,
  getInFlightTurn: () => state.inFlightTurn,
  getRestartRequested: () => restartRequested,
  getShutdownRequested: () => shutdownRequested,
  hasActiveWork: () => queueRuntime.hasActiveWork(),
  interactiveQueue: queueRuntime.interactiveQueue,
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
void mattermostTransport.start().catch((error) => {
  console.error(`[${timestamp()}] Failed starting Mattermost transport: ${error.message}`);
});
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
setInterval(() => queueRuntime.checkForDueScheduledJobs(), SCHEDULER_POLL_INTERVAL_MS);
setInterval(checkForPendingAttachmentCommands, 1_000);
setInterval(() => {
  void ops.writeOpsSnapshot();
}, OPS_SNAPSHOT_INTERVAL_MS);
setTimeout(() => {
  void queueRuntime.checkForDueScheduledJobs();
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
  const missing = validateBridgeConfig({ allowedNumbers, phoneNumber });

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
  await queueRuntime.handleReceiveEvent(message);
}

async function handleMattermostEnvelope(envelope) {
  await queueRuntime.handleTransportEnvelope({
    ...envelope,
    replyTarget: formatMattermostTarget(envelope.conversationId),
  });
}

async function handleCancelCommand(sender) {
  await queueRuntime.handleCancelCommand(sender);
}

async function processInteractiveQueue() {
  await queueRuntime.processInteractiveQueue();
}

async function processBackgroundQueue() {
  await queueRuntime.processBackgroundQueue();
}

async function checkForDueScheduledJobs() {
  await queueRuntime.checkForDueScheduledJobs();
}

async function runCodex(
  prompt,
  sessionId,
  imagePaths = [],
  jobControl = null,
  suppressLiveUpdates = false,
  onInvalidSession = null,
  replyRecipient = ""
) {
  recordTestLaunchArgs();

  if (TEST_TURN_SCENARIO_PATH && TEST_TURN_CURSOR_PATH) {
    return testSupport.runCodexViaTestScenario(
      prompt,
      sessionId,
      imagePaths,
      jobControl
    );
  }
  if (runner.id === "hermes-cli") {
    return runner.runTurn(prompt, null, imagePaths, jobControl, {
      suppressLiveUpdates,
      onInvalidSession,
    });
  }
  return runCodexViaAppServer(
    prompt,
    sessionId,
    imagePaths,
    jobControl,
    suppressLiveUpdates,
    onInvalidSession,
    replyRecipient
  );
}

function runCodexViaAppServer(
  prompt,
  sessionId,
  imagePaths = [],
  jobControl = null,
  suppressLiveUpdates = false,
  onInvalidSession = null,
  replyRecipient = ""
) {
  return appServerTurnRunner.runCodexViaAppServer(
    prompt,
    sessionId,
    imagePaths,
    jobControl,
    suppressLiveUpdates,
    onInvalidSession,
    replyRecipient
  );
}

function normalizeRunnerName(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["hermes", "hermes-cli", "hermes_cli"].includes(normalized)) {
    return "hermes-cli";
  }
  return "codex-cli";
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

function getWhatsAppTriageReport(limit = WHATSAPP_TRIAGE_LIMIT) {
  return whatsappReview.getTriageReport(limit);
}

async function sendReply(recipient, text) {
  if (parseMattermostTarget(recipient)) {
    await mattermostTransport.sendReply(recipient, text);
    return;
  }
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
