const path = require("path");

function createBridgeConfig({
  env = process.env,
  execFileSync,
  fs,
  instanceConfig,
  normalizeBooleanEnv,
  normalizeIntegerEnv,
  normalizeText,
  parseAllowedNumbers,
  projectDir,
}) {
  const CODEX_CWD = normalizeText(env.SABLE_CODEX_CWD) || instanceConfig.homeDir;
  const STATE_PATH =
    normalizeText(env.SABLE_BRIDGE_STATE_PATH) ||
    path.join(projectDir, ".bridge-state.json");
  const RESTART_REQUEST_PATH =
    normalizeText(env.SABLE_RESTART_REQUEST_PATH) ||
    path.join(projectDir, ".restart-requested");
  const RESTART_NOTICE_PATH =
    normalizeText(env.SABLE_RESTART_NOTICE_PATH) ||
    path.join(projectDir, ".restart-notice-pending");
  const SCHEDULER_JOBS_PATH =
    normalizeText(env.SABLE_SCHEDULER_JOBS_PATH) ||
    instanceConfig.schedulerJobsPath;
  const DEFAULT_SCHEDULER_JOBS_PATH =
    normalizeText(env.SABLE_DEFAULT_SCHEDULER_JOBS_PATH) ||
    instanceConfig.defaultSchedulerJobsPath;
  const SCHEDULER_STATE_PATH =
    normalizeText(env.SABLE_SCHEDULER_STATE_PATH) ||
    instanceConfig.schedulerStatePath;
  const RESEARCH_ROOT =
    normalizeText(env.SABLE_RESEARCH_ROOT) ||
    instanceConfig.researchRoot;
  const VOICE_NOTES_ENABLED = normalizeBooleanEnv(env.VOICE_NOTES_ENABLED, true);
  const VOICE_NOTES_MODEL = normalizeText(env.VOICE_NOTES_MODEL) || "base.en";
  const VOICE_NOTES_MODEL_PATH =
    normalizeText(env.VOICE_NOTES_MODEL_PATH) ||
    path.join(instanceConfig.homeDir, "models", "faster-whisper-base.en");
  const VOICE_NOTES_LANGUAGE = normalizeText(env.VOICE_NOTES_LANGUAGE) || "en";
  const VOICE_NOTES_BEAM_SIZE = normalizeIntegerEnv(env.VOICE_NOTES_BEAM_SIZE, 5);
  const VOICE_NOTES_COMPUTE_TYPE =
    normalizeText(env.VOICE_NOTES_COMPUTE_TYPE) || "int8";
  const VOICE_NOTES_TIMEOUT_SEC = normalizeIntegerEnv(env.VOICE_NOTES_TIMEOUT_SEC, 900);
  const VOICE_NOTES_ECHO_TRANSCRIPT = normalizeBooleanEnv(
    env.VOICE_NOTES_ECHO_TRANSCRIPT,
    true
  );
  const CODEX_HOME_ROOT =
    normalizeText(env.CODEX_HOME) || path.join(instanceConfig.homeDir, ".codex");
  const CODEX_SESSIONS_DIR = path.join(CODEX_HOME_ROOT, "sessions");
  const APP_SERVER_REQUEST_TIMEOUT_MS = normalizeIntegerEnv(
    env.APP_SERVER_REQUEST_TIMEOUT_MS,
    20_000
  );
  const APP_SERVER_IDLE_TIMEOUT_MS = normalizeIntegerEnv(
    env.APP_SERVER_IDLE_TIMEOUT_MS,
    10 * 60 * 1000
  );
  const SCHEDULER_POLL_INTERVAL_MS = normalizeIntegerEnv(
    env.SABLE_SCHEDULER_POLL_INTERVAL_MS,
    30_000
  );
  const MAX_SCHEDULED_LOCAL_IMAGES = normalizeIntegerEnv(
    env.SABLE_MAX_SCHEDULED_LOCAL_IMAGES,
    6
  );
  const MAX_SCHEDULED_LOCAL_IMAGE_BYTES = normalizeIntegerEnv(
    env.SABLE_MAX_SCHEDULED_LOCAL_IMAGE_BYTES,
    10 * 1024 * 1024
  );
  const MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES = normalizeIntegerEnv(
    env.SABLE_MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES,
    25 * 1024 * 1024
  );
  const TRANSCRIBE_SCRIPT_PATH = path.join(projectDir, "transcribe_voice_note.py");
  const EXTRACT_PDF_SCRIPT_PATH = path.join(projectDir, "extract_pdf_text.py");
  const VENV_PYTHON_PATH = path.join(projectDir, ".venv", "bin", "python");
  const VENV_PDF_PYTHON_PATH = path.join(projectDir, ".venv-pdf", "bin", "python");
  const TRANSCRIBE_PYTHON_BIN = selectPythonBin({
    candidates: [VENV_PYTHON_PATH, "python3"],
    cwd: projectDir,
    execFileSync,
    fs,
    validationArgs: ["-c", "import faster_whisper, ctranslate2, av"],
  });
  const PDF_EXTRACT_PYTHON_BIN = selectPythonBin({
    candidates: [VENV_PDF_PYTHON_PATH, "python3"],
    cwd: projectDir,
    execFileSync,
    fs,
    validationArgs: ["--version"],
  });
  const TEST_RECEIVE_SCENARIO_PATH = normalizeText(env.SABLE_E2E_RECEIVE_SCENARIO_PATH);
  const TEST_APP_SERVER_LOG_PATH = normalizeText(env.SABLE_E2E_APP_SERVER_LOG_PATH);
  const TEST_TURN_SCENARIO_PATH = normalizeText(env.SABLE_E2E_TURN_SCENARIO_PATH);
  const TEST_TURN_CURSOR_PATH = normalizeText(env.SABLE_E2E_TURN_CURSOR_PATH);
  const TEST_SIGNAL_LOG_PATH = normalizeText(env.SABLE_E2E_SIGNAL_LOG_PATH);
  const ATTACHMENT_QUEUE_ROOT =
    normalizeText(env.SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR) ||
    path.join(projectDir, ".attachment-queue");
  const ATTACHMENT_QUEUE_PENDING_DIR = path.join(ATTACHMENT_QUEUE_ROOT, "pending");
  const ATTACHMENT_QUEUE_RESULTS_DIR = path.join(ATTACHMENT_QUEUE_ROOT, "results");
  const OPS_ROOT =
    normalizeText(env.SABLE_OPS_STATE_DIR) || path.join(projectDir, ".ops");
  const OPS_SNAPSHOT_INTERVAL_MS = normalizeIntegerEnv(
    env.SABLE_OPS_SNAPSHOT_INTERVAL_MS,
    60_000
  );
  const OPS_STALLED_RUN_THRESHOLD_MS = normalizeIntegerEnv(
    env.SABLE_OPS_STALLED_RUN_THRESHOLD_MS,
    6 * 60 * 60 * 1000
  );
  const OPS_ALERTS_ENABLED = normalizeBooleanEnv(
    env.SABLE_OPS_ALERTS_ENABLED,
    !TEST_SIGNAL_LOG_PATH
  );
  const OPS_ALERT_BRIDGE_RSS_THRESHOLD_BYTES = normalizeIntegerEnv(
    env.SABLE_OPS_ALERT_BRIDGE_RSS_THRESHOLD_BYTES,
    1200 * 1024 * 1024
  );
  const OPS_ALERT_IN_FLIGHT_TURN_THRESHOLD_MS = normalizeIntegerEnv(
    env.SABLE_OPS_ALERT_IN_FLIGHT_TURN_THRESHOLD_MS,
    20 * 60 * 1000
  );
  const EMPLOYEES_ROOT =
    normalizeText(env.SABLE_EMPLOYEES_ROOT) ||
    path.join(instanceConfig.memoryRoot || path.join(instanceConfig.homeDir, "memory"), "agents");
  const EMPLOYEE_RUNTIME_ROOT =
    normalizeText(env.SABLE_EMPLOYEE_RUNTIME_ROOT) ||
    path.join(instanceConfig.homeDir, ".sable", "employees");
  const EMPLOYEE_CODEX_CREDENTIAL_SOURCE =
    normalizeText(env.SABLE_EMPLOYEE_CODEX_CREDENTIAL_SOURCE) || CODEX_HOME_ROOT;
  const EMPLOYEE_CODEX_CREDENTIAL_FILES = splitList(
    env.SABLE_EMPLOYEE_CODEX_CREDENTIAL_FILES || "auth.json,config.toml,installation_id"
  );
  const MATTERMOST_ENABLED = normalizeBooleanEnv(env.MATTERMOST_ENABLED, false);
  const MATTERMOST_POLL_INTERVAL_MS = normalizeIntegerEnv(
    env.MATTERMOST_POLL_INTERVAL_MS,
    5_000
  );
  const MATTERMOST_CURSOR_PATH =
    normalizeText(env.MATTERMOST_CURSOR_PATH) ||
    path.join(OPS_ROOT, "mattermost-cursors.json");

  return {
    APP_SERVER_CLIENT_VERSION: "1.1.0",
    APP_SERVER_IDLE_TIMEOUT_MS,
    APP_SERVER_REQUEST_TIMEOUT_MS,
    ATTACHMENT_QUEUE_PENDING_DIR,
    ATTACHMENT_QUEUE_RESULTS_DIR,
    ATTACHMENT_QUEUE_ROOT,
    CHUNK_DELAY_MS: 500,
    CODEX_CWD,
    CODEX_HOME_ROOT,
    CODEX_SESSIONS_DIR,
    DEFAULT_FILE_PROMPT: "Please analyze the attached files.",
    DEFAULT_IMAGE_PROMPT: "Please analyze the attached image.",
    DEFAULT_SCHEDULER_JOBS_PATH,
    EMPLOYEE_CODEX_CREDENTIAL_FILES,
    EMPLOYEE_CODEX_CREDENTIAL_SOURCE,
    EMPLOYEE_RUNTIME_ROOT,
    EMPLOYEES_ROOT,
    EXTRACT_PDF_SCRIPT_PATH,
    LIVE_UPDATE_BATCH_WINDOW_MS: 750,
    LIVE_UPDATE_DUPLICATE_WINDOW_MS: 5_000,
    MAX_COMMAND_TEXT_LENGTH: 120,
    MAX_FAILURE_OUTPUT_LENGTH: 400,
    MAX_FILE_ATTACHMENT_BYTES: 10 * 1024 * 1024,
    MAX_FILE_EXCERPT_CHARS: 20_000,
    MAX_SIGNAL_MESSAGE_LENGTH: 1500,
    MAX_SCHEDULED_LOCAL_IMAGE_BYTES,
    MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES,
    MAX_SCHEDULED_LOCAL_IMAGES,
    MAX_TEXT_ATTACHMENT_BYTES: 2 * 1024 * 1024,
    MAX_TOTAL_FILE_CONTEXT_CHARS: 48_000,
    OPS_ALERT_BRIDGE_RSS_THRESHOLD_BYTES,
    OPS_ALERT_IN_FLIGHT_TURN_THRESHOLD_MS,
    OPS_ALERTS_ENABLED,
    OPS_ROOT,
    OPS_SNAPSHOT_INTERVAL_MS,
    OPS_STALLED_RUN_THRESHOLD_MS,
    MATTERMOST_ALLOWED_USERS: splitList(env.MATTERMOST_ALLOWED_USERS),
    MATTERMOST_BASE_URL: normalizeText(env.MATTERMOST_BASE_URL),
    MATTERMOST_BOT_USER_ID: normalizeText(env.MATTERMOST_BOT_USER_ID),
    MATTERMOST_CHANNEL_ID: normalizeText(env.MATTERMOST_CHANNEL_ID),
    MATTERMOST_CURSOR_PATH,
    MATTERMOST_DM_USER_IDS: splitList(env.MATTERMOST_DM_USER_IDS),
    MATTERMOST_ENABLED,
    MATTERMOST_PARENT_CHANNEL: normalizeText(env.MATTERMOST_PARENT_CHANNEL),
    MATTERMOST_POLL_INTERVAL_MS,
    MATTERMOST_TEAM: normalizeText(env.MATTERMOST_TEAM),
    MATTERMOST_TOKEN: normalizeText(env.MATTERMOST_TOKEN),
    PDF_EXTRACT_PYTHON_BIN,
    PENDING_PLUGIN_AUTH_POLL_INTERVAL_MS: 15_000,
    RESEARCH_ROOT,
    RESTART_NOTICE_PATH,
    RESTART_REQUEST_PATH,
    SCHEDULED_NO_REPLY_MARKER: "__SABLE_NO_REPLY__",
    SCHEDULER_JOBS_PATH,
    SCHEDULER_POLL_INTERVAL_MS,
    SCHEDULER_STATE_PATH,
    SIGNAL_BRIDGE_DIR_ENV: "SABLE_SIGNAL_BRIDGE_DIR",
    SIGNAL_REPLY_TO_ENV: "SABLE_SIGNAL_REPLY_TO",
    STATE_PATH,
    TELEGRAM_TRIAGE_LIMIT: null,
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
    allowedNumbers: parseAllowedNumbers(env.ALLOWED_NUMBERS),
    allowedSenders: parseAllowedNumbers(env.ALLOWED_SENDERS),
    phoneNumber: env.PHONE_NUMBER?.trim(),
  };
}

function selectPythonBin({
  candidates,
  cwd,
  execFileSync,
  fs,
  validationArgs,
}) {
  for (const candidate of candidates) {
    if (candidate !== "python3" && !fs.existsSync(candidate)) {
      continue;
    }

    try {
      execFileSync(candidate, validationArgs, {
        cwd,
        stdio: "ignore",
      });
      return candidate;
    } catch (error) {
      continue;
    }
  }

  return "python3";
}

function validateBridgeConfig({
  allowedNumbers,
  phoneNumber,
}) {
  const missing = [];

  if (!phoneNumber) {
    missing.push("PHONE_NUMBER");
  }

  if (!allowedNumbers || allowedNumbers.size === 0) {
    missing.push("ALLOWED_NUMBERS");
  }

  return missing;
}

function splitList(value) {
  return String(value || "")
    .split(/[,:]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

module.exports = {
  createBridgeConfig,
  selectPythonBin,
  validateBridgeConfig,
};
