#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");
const {
  computeFollowingRunAt,
  formatScheduleList,
  loadSchedulerJobs,
  saveSchedulerJobs,
} = require("./scheduler");

require("dotenv").config();

const PROJECT_DIR = __dirname;
const CODEX_CWD = "/home/arya";
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
  "/home/arya/memory/tasks/projects/sable/scheduler-jobs.json";
const RESEARCH_ROOT =
  normalizeText(process.env.SABLE_RESEARCH_ROOT) ||
  "/home/arya/memory/knowledge/research";
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
  "/home/arya/models/faster-whisper-base.en";
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
const CODEX_SESSIONS_DIR = path.join("/home/arya/.codex", "sessions");
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
const TEST_RECEIVE_SCENARIO_PATH = normalizeText(process.env.SABLE_E2E_RECEIVE_SCENARIO_PATH);
const TEST_APP_SERVER_LOG_PATH = normalizeText(process.env.SABLE_E2E_APP_SERVER_LOG_PATH);
const TEST_TURN_SCENARIO_PATH = normalizeText(process.env.SABLE_E2E_TURN_SCENARIO_PATH);
const TEST_TURN_CURSOR_PATH = normalizeText(process.env.SABLE_E2E_TURN_CURSOR_PATH);
const TEST_SIGNAL_LOG_PATH = normalizeText(process.env.SABLE_E2E_SIGNAL_LOG_PATH);
const OBSIDIAN_VAULT_ROOT = path.resolve(
  normalizeText(process.env.SABLE_OBSIDIAN_VAULT_ROOT) || "/home/arya/memory"
);
const OBSIDIAN_VAULT_NAME =
  normalizeText(process.env.SABLE_OBSIDIAN_VAULT_NAME) ||
  discoverObsidianVaultName(OBSIDIAN_VAULT_ROOT) ||
  path.basename(OBSIDIAN_VAULT_ROOT);
const OBSIDIAN_LINK_SERVER_HOST =
  normalizeText(process.env.SABLE_OBSIDIAN_LINK_HOST) || "127.0.0.1";
const OBSIDIAN_LINK_SERVER_PORT = normalizeIntegerEnv(
  process.env.SABLE_OBSIDIAN_LINK_PORT,
  4111
);
const OBSIDIAN_LINKS_ENABLED = normalizeBooleanEnv(
  process.env.SABLE_OBSIDIAN_LINKS_ENABLED,
  true
);
const OBSIDIAN_BASE_URL_OVERRIDE = normalizeText(process.env.SABLE_OBSIDIAN_BASE_URL);
const OBSIDIAN_BASE_URL = normalizeText(
  OBSIDIAN_BASE_URL_OVERRIDE || discoverTailscaleMagicDnsBaseUrl()
);

const phoneNumber = process.env.PHONE_NUMBER?.trim();
const allowedNumbers = parseAllowedNumbers(process.env.ALLOWED_NUMBERS);
const allowedSenders = parseAllowedNumbers(process.env.ALLOWED_SENDERS);

validateConfig();

let signalProcess;
let signalStdoutBuffer = "";
let nextSignalRequestId = 1;
const pendingSignalRequests = new Map();

const interactiveQueue = [];
const backgroundQueue = [];
let isProcessingInteractive = false;
let isProcessingBackground = false;
let state = loadState();
let schedulerJobs = loadSchedulerJobs(SCHEDULER_JOBS_PATH);
let restartRequested = false;
let shutdownRequested = false;
let activeJobControl = null;
let obsidianLinkServer = null;
let obsidianLinkServerAddress = null;

startSignalRpc();
startObsidianLinkServer();
if (TEST_RECEIVE_SCENARIO_PATH) {
  void startTestReceiveScenario(TEST_RECEIVE_SCENARIO_PATH);
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
setTimeout(() => {
  void checkForDueScheduledJobs();
}, 5_000);

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

function parseAllowedNumbers(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

async function startTestReceiveScenario(filePath) {
  try {
    const payload = await fs.promises.readFile(filePath, "utf8");
    const scenario = JSON.parse(payload);
    const events = Array.isArray(scenario?.receive) ? scenario.receive : [];

    for (const event of events) {
      const delayMs = Number.isFinite(event?.delayMs) ? event.delayMs : 0;
      setTimeout(() => {
        void handleReceiveEvent({
          params: {
            envelope: buildTestReceiveEnvelope(event),
          },
        });
      }, delayMs);
    }
  } catch (error) {
    console.error(
      `[${timestamp()}] Failed loading Sable e2e receive scenario: ${error.stack || error.message}`
    );
  }
}

function buildTestReceiveEnvelope(event) {
  const sender = normalizeText(event?.sender) || "+15550000001";
  const attachments = Array.isArray(event?.attachments) ? event.attachments : [];
  const message = typeof event?.message === "string" ? event.message : "";

  return {
    sourceNumber: sender,
    source: sender,
    dataMessage: {
      message,
      attachments,
    },
  };
}

function appendTestAppServerLog(entry) {
  if (!TEST_APP_SERVER_LOG_PATH) {
    return;
  }

  try {
    fs.appendFileSync(
      TEST_APP_SERVER_LOG_PATH,
      `${JSON.stringify({ at: timestamp(), ...entry })}\n`,
      "utf8"
    );
  } catch (error) {
    console.error(`[${timestamp()}] Failed writing Sable e2e app-server log: ${error.message}`);
  }
}

function appendTestSignalLog(entry) {
  if (!TEST_SIGNAL_LOG_PATH) {
    return;
  }

  try {
    fs.appendFileSync(
      TEST_SIGNAL_LOG_PATH,
      `${JSON.stringify({ at: timestamp(), ...entry })}\n`,
      "utf8"
    );
  } catch (error) {
    console.error(`[${timestamp()}] Failed writing Sable e2e signal log: ${error.message}`);
  }
}

function getTestAttachmentMap() {
  if (!TEST_RECEIVE_SCENARIO_PATH) {
    return {};
  }

  try {
    const payload = fs.readFileSync(TEST_RECEIVE_SCENARIO_PATH, "utf8");
    const scenario = JSON.parse(payload);
    return scenario?.attachments && typeof scenario.attachments === "object"
      ? scenario.attachments
      : {};
  } catch (error) {
    console.error(`[${timestamp()}] Failed reading Sable e2e attachment map: ${error.message}`);
    return {};
  }
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

function discoverTailscaleMagicDnsBaseUrl() {
  try {
    const stdout = execFileSync("tailscale", ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(stdout);
    const rawDnsName = normalizeText(parsed?.Self?.DNSName);
    if (!rawDnsName) {
      return "";
    }
    const dnsName = rawDnsName.replace(/\.+$/, "");
    return dnsName ? `https://${dnsName}` : "";
  } catch (error) {
    return "";
  }
}

function discoverObsidianVaultName(vaultRoot) {
  const normalizedRoot = normalizeText(vaultRoot);
  if (!normalizedRoot) {
    return "";
  }

  const syncRoot = path.join(os.homedir(), ".config", "obsidian-headless", "sync");
  if (!fs.existsSync(syncRoot)) {
    return "";
  }

  try {
    for (const entry of fs.readdirSync(syncRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const configPath = path.join(syncRoot, entry.name, "config.json");
      if (!fs.existsSync(configPath)) {
        continue;
      }

      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (path.resolve(parsed?.vaultPath || "") !== normalizedRoot) {
        continue;
      }

      return normalizeText(parsed?.vaultName);
    }
  } catch (error) {
    console.error(
      `[${timestamp()}] Failed discovering Obsidian vault name for ${normalizedRoot}: ${error.message}`
    );
  }

  return "";
}

function startObsidianLinkServer() {
  if (!OBSIDIAN_LINKS_ENABLED) {
    console.log(`[${timestamp()}] Obsidian link server disabled by config`);
    return;
  }

  try {
    obsidianLinkServer = http.createServer(handleObsidianLinkRequest);
    obsidianLinkServer.on("error", (error) => {
      console.error(
        `[${timestamp()}] Obsidian link server failed on ${OBSIDIAN_LINK_SERVER_HOST}:${OBSIDIAN_LINK_SERVER_PORT}: ${error.message}`
      );
    });
    obsidianLinkServer.listen(OBSIDIAN_LINK_SERVER_PORT, OBSIDIAN_LINK_SERVER_HOST, () => {
      obsidianLinkServerAddress = obsidianLinkServer.address();
      const boundPort =
        typeof obsidianLinkServerAddress === "object" && obsidianLinkServerAddress
          ? obsidianLinkServerAddress.port
          : OBSIDIAN_LINK_SERVER_PORT;
      console.log(
        `[${timestamp()}] Obsidian link server listening on ${OBSIDIAN_LINK_SERVER_HOST}:${boundPort}`
      );
    });
  } catch (error) {
    console.error(`[${timestamp()}] Failed starting Obsidian link server: ${error.message}`);
  }
}

function handleObsidianLinkRequest(req, res) {
  const method = normalizeText(req?.method || "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    respondHtml(
      res,
      405,
      buildObsidianRedirectPage({
        title: "Method not allowed",
        heading: "Method not allowed",
        body: "<p>This endpoint only supports GET.</p>",
      }),
      method
    );
    return;
  }

  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    if (method !== "HEAD") {
      res.end("ok");
    } else {
      res.end();
    }
    return;
  }

  if (requestUrl.pathname !== "/obsidian/open") {
    respondHtml(
      res,
      404,
      buildObsidianRedirectPage({
        title: "Not found",
        heading: "Not found",
        body: "<p>This Sable link endpoint only serves Obsidian note redirects.</p>",
      }),
      method
    );
    return;
  }

  const requestedPath = normalizeText(requestUrl.searchParams.get("path"));
  const line = normalizeText(requestUrl.searchParams.get("line"));
  const normalizedNote = normalizeObsidianNotePath(requestedPath);
  if (!normalizedNote) {
    respondHtml(
      res,
      400,
      buildObsidianRedirectPage({
        title: "Invalid note path",
        heading: "Invalid note path",
        body: "<p>The requested markdown note is missing, outside the vault, or not supported.</p>",
      }),
      method
    );
    return;
  }

  const obsidianUri = buildObsidianUriForRelativePath(normalizedNote.relativePath);
  const lineHint = line ? `<p>Original line hint: ${escapeHtml(line)}</p>` : "";
  respondHtml(
    res,
    200,
    buildObsidianRedirectPage({
      title: `Open ${path.basename(normalizedNote.absolutePath)} in Obsidian`,
      heading: `Open ${path.basename(normalizedNote.absolutePath)} in Obsidian`,
      body: [
        `<p>If Obsidian does not launch automatically, tap the button below.</p>`,
        `<p><a href="${escapeHtml(obsidianUri)}">Open in Obsidian</a></p>`,
        `<p>Vault: ${escapeHtml(OBSIDIAN_VAULT_NAME)}</p>`,
        `<p>Note: ${escapeHtml(normalizedNote.relativePath)}</p>`,
        lineHint,
      ].join(""),
      obsidianUri,
    }),
    method
  );
}

function respondHtml(res, statusCode, html, method = "GET") {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(html);
}

function buildObsidianRedirectPage({ title, heading, body, obsidianUri = "" }) {
  const escapedTitle = escapeHtml(title || "Open in Obsidian");
  const escapedHeading = escapeHtml(heading || "Open in Obsidian");
  const escapedUri = escapeHtml(obsidianUri);
  const redirectScript = escapedUri
    ? `<script>window.addEventListener("load", () => { window.location.replace(${JSON.stringify(
        obsidianUri
      )}); });</script>`
    : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapedTitle}</title>`,
    escapedUri ? `<meta http-equiv="refresh" content="0;url=${escapedUri}">` : "",
    "</head>",
    "<body>",
    `<h1>${escapedHeading}</h1>`,
    body || "",
    redirectScript,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("");
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildObsidianUriForRelativePath(relativePath) {
  const params = new URLSearchParams({
    vault: OBSIDIAN_VAULT_NAME,
    file: relativePath,
  });
  return `obsidian://open?${params.toString()}`;
}

function normalizeObsidianNotePath(filePath) {
  const normalized = normalizeText(filePath);
  if (!normalized) {
    return null;
  }

  const absolutePath = path.resolve(normalized);
  const relativePath = path.relative(OBSIDIAN_VAULT_ROOT, absolutePath);
  const normalizedRelativePath = relativePath.split(path.sep).join("/");
  const extension = path.extname(absolutePath).toLowerCase();

  if (
    (extension !== ".md" && extension !== ".markdown") ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return {
    absolutePath,
    relativePath: normalizedRelativePath,
  };
}

function buildSignalObsidianLink(filePath, line = "") {
  if (!OBSIDIAN_LINKS_ENABLED || !OBSIDIAN_BASE_URL) {
    return "";
  }

  const normalized = normalizeObsidianNotePath(filePath);
  if (!normalized) {
    return "";
  }

  const params = new URLSearchParams({ path: normalized.absolutePath });
  const lineText = normalizeText(line);
  if (lineText) {
    params.set("line", lineText);
  }
  return `${OBSIDIAN_BASE_URL.replace(/\/+$/, "")}/obsidian/open?${params.toString()}`;
}

function rewriteMarkdownDocumentReferencesForSignal(text) {
  const input = String(text || "");
  if (!input || !OBSIDIAN_LINKS_ENABLED || !OBSIDIAN_BASE_URL) {
    return input;
  }

  return input.replace(/\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g, (match, label, rawTarget) => {
    const target = String(rawTarget || "").replace(/^<|>$/g, "");
    const parsed = parseMarkdownFileTarget(target);
    if (!parsed) {
      return match;
    }

    const link = buildSignalObsidianLink(parsed.filePath, parsed.line);
    if (!link) {
      return match;
    }

    const cleanedLabel = normalizeText(label) || path.basename(parsed.filePath);
    return `${cleanedLabel}: ${link}`;
  });
}

function parseMarkdownFileTarget(target) {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget || !normalizedTarget.startsWith("/")) {
    return null;
  }

  const lineMatch = normalizedTarget.match(/^(.*\.(?:md|markdown)):(\d+)$/i);
  if (lineMatch) {
    return {
      filePath: lineMatch[1],
      line: lineMatch[2],
    };
  }

  if (/\.(md|markdown)$/i.test(normalizedTarget)) {
    return {
      filePath: normalizedTarget,
      line: "",
    };
  }

  return null;
}

class CancellationError extends Error {
  constructor(message = "Request cancelled.") {
    super(message);
    this.name = "CancellationError";
  }
}

function isCancellationError(error) {
  return error instanceof CancellationError || error?.name === "CancellationError";
}

function createJobControl(sender) {
  return {
    sender,
    cancelled: false,
    reason: null,
    handlers: new Set(),
  };
}

function registerCancellationHandler(jobControl, handler) {
  if (!jobControl || typeof handler !== "function") {
    return () => {};
  }

  if (jobControl.cancelled) {
    handler(jobControl.reason || new CancellationError());
    return () => {};
  }

  jobControl.handlers.add(handler);
  return () => {
    jobControl.handlers.delete(handler);
  };
}

function cancelJobControl(jobControl, message = "Cancelled by /cancel.") {
  if (!jobControl || jobControl.cancelled) {
    return false;
  }

  const reason = new CancellationError(message);
  jobControl.cancelled = true;
  jobControl.reason = reason;

  for (const handler of [...jobControl.handlers]) {
    try {
      handler(reason);
    } catch (error) {
      console.error(`[${timestamp()}] Cancellation handler failed: ${error.message}`);
    }
  }

  return true;
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

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const legacyLastSessionId =
      typeof parsed.lastSessionId === "string" && parsed.lastSessionId.trim()
        ? parsed.lastSessionId.trim()
        : null;
    return {
      interactiveSessionId:
        typeof parsed.interactiveSessionId === "string" && parsed.interactiveSessionId.trim()
          ? parsed.interactiveSessionId.trim()
          : legacyLastSessionId,
      backgroundSessionId:
        typeof parsed.backgroundSessionId === "string" && parsed.backgroundSessionId.trim()
          ? parsed.backgroundSessionId.trim()
          : null,
      pendingPluginAuth: normalizePendingPluginAuth(parsed.pendingPluginAuth),
      inFlightTurn: normalizeInFlightTurn(parsed.inFlightTurn),
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`[${timestamp()}] Failed to read state file: ${error.message}`);
    }

    return {
      interactiveSessionId: null,
      backgroundSessionId: null,
      pendingPluginAuth: null,
      inFlightTurn: null,
    };
  }
}

function saveState() {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function clearState() {
  state = {
    ...state,
    interactiveSessionId: null,
    backgroundSessionId: null,
  };
  saveState();
}

function clearSessionState(kind) {
  const key = kind === "background" ? "backgroundSessionId" : "interactiveSessionId";
  state = {
    ...state,
    [key]: null,
  };
  saveState();
}

function setInFlightTurn(sender, prompt) {
  state = {
    ...state,
    inFlightTurn: {
      sender,
      startedAt: timestamp(),
      promptPreview: truncateText(normalizeText(prompt) || "", 160),
    },
  };
  saveState();
}

function clearInFlightTurn() {
  if (!state.inFlightTurn) {
    return;
  }

  state = {
    ...state,
    inFlightTurn: null,
  };
  saveState();
}

function normalizeInFlightTurn(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const sender = normalizeText(value.sender);
  const startedAt = normalizeText(value.startedAt);
  const promptPreview = normalizeText(value.promptPreview);

  if (!sender || !startedAt) {
    return null;
  }

  return {
    sender,
    startedAt,
    promptPreview,
  };
}

function normalizePendingPluginAuth(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const sender = normalizeText(value.sender);
  const pluginId = normalizeText(value.pluginId);
  const pluginName = normalizeText(value.pluginName);
  const marketplacePath = normalizeText(value.marketplacePath);
  const installUrl = normalizeText(value.installUrl);

  if (!sender || !pluginId || !pluginName || !marketplacePath || !installUrl) {
    return null;
  }

  return {
    sender,
    pluginId,
    pluginName,
    displayName: normalizeText(value.displayName) || pluginName,
    marketplacePath,
    installUrl,
    sourcePrompt: normalizeText(value.sourcePrompt),
    status: normalizePendingPluginAuthStatus(value.status),
    startedAt: normalizeText(value.startedAt) || timestamp(),
    completedAt: normalizeText(value.completedAt),
    lastCheckedAt: normalizeText(value.lastCheckedAt),
  };
}

function normalizePendingPluginAuthStatus(value) {
  return value === "completed" ? "completed" : "pending";
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
  const senderCandidates = extractSenderCandidates(envelope);
  const sender = senderCandidates[0] || null;
  const text = extractIncomingText(envelope);
  const imageAttachments = extractIncomingImageAttachments(envelope);
  const audioAttachments = extractIncomingAudioAttachments(envelope);
  const fileAttachments = extractIncomingFileAttachments(envelope);

  if (
    !sender ||
    (!text &&
      imageAttachments.length === 0 &&
      audioAttachments.length === 0 &&
      fileAttachments.length === 0)
  ) {
    return;
  }

  if (!isAllowedSender(senderCandidates)) {
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
    imageAttachments.length > 0,
    audioAttachments.length > 0,
    fileAttachments.length > 0
  );

  if (command.type === "cancel") {
    await handleCancelCommand(sender);
    return;
  }

  if (shutdownRequested || restartRequested) {
    if (command.type === "status") {
      await sendReply(sender, await getBridgeStatusReport());
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
    context: buildAttachmentContext(
      envelope,
      sender,
      imageAttachments,
      audioAttachments,
      fileAttachments
    ),
    queuedVoicePreparation: null,
  };

  if (audioAttachments.length > 0 && VOICE_NOTES_ENABLED && isProcessingInteractive) {
    job.queuedVoicePreparation = startQueuedVoicePreparation(job);
  }

  interactiveQueue.push(job);

  if (isProcessingInteractive) {
    try {
      const queueMessage =
        audioAttachments.length > 0 && VOICE_NOTES_ENABLED
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

function extractSenderCandidates(envelope) {
  const candidates = [
    envelope?.sourceNumber,
    envelope?.source,
    envelope?.sourceUuid,
    envelope?.sourceName,
  ];

  return candidates
    .filter((candidate) => typeof candidate === "string" && candidate.trim())
    .map((candidate) => candidate.trim());
}

function isAllowedSender(senderCandidates) {
  return senderCandidates.some(
    (candidate) => allowedNumbers.has(candidate) || allowedSenders.has(candidate)
  );
}

function extractIncomingText(envelope) {
  const candidates = [
    envelope?.dataMessage?.message,
    envelope?.message,
    envelope?.body,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function extractIncomingImageAttachments(envelope) {
  return extractIncomingAttachmentsByPredicate(envelope, (attachment, contentType) => {
    return Boolean(attachment?.id) && contentType.startsWith("image/");
  });
}

function extractIncomingAudioAttachments(envelope) {
  return extractIncomingAttachmentsByPredicate(envelope, (attachment, contentType) => {
    return Boolean(attachment?.id) && contentType.startsWith("audio/");
  });
}

function extractIncomingFileAttachments(envelope) {
  return extractIncomingAttachmentsByPredicate(envelope, (attachment, contentType) => {
    return (
      Boolean(attachment?.id) &&
      !contentType.startsWith("image/") &&
      !contentType.startsWith("audio/")
    );
  });
}

function extractIncomingAttachmentsByPredicate(envelope, predicate) {
  const attachments = envelope?.dataMessage?.attachments;
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.filter((attachment) => {
    const contentType = normalizeText(attachment?.contentType).toLowerCase();
    return predicate(attachment, contentType);
  });
}

function buildAttachmentContext(
  envelope,
  sender,
  imageAttachments,
  audioAttachments,
  fileAttachments
) {
  const groupId = envelope?.dataMessage?.groupInfo?.groupId;
  return {
    sender,
    groupId: typeof groupId === "string" && groupId.trim() ? groupId.trim() : null,
    imageAttachments,
    audioAttachments,
    fileAttachments,
  };
}

function parseCommand(text, hasImages = false, hasAudio = false, hasFiles = false) {
  const trimmed = text.trim();
  if (trimmed === "/bridgestatus") {
    return { type: "status" };
  }

  if (trimmed === "/schedules") {
    return { type: "list-schedules" };
  }

  if (trimmed.startsWith("/unschedule ")) {
    return { type: "unschedule", scheduleId: trimmed.slice("/unschedule ".length).trim() };
  }

  if (trimmed === "/cancel") {
    return { type: "cancel" };
  }

  if (trimmed === "/setavatar") {
    return { type: "set-avatar" };
  }

  if (trimmed === "/removeavatar") {
    return { type: "remove-avatar" };
  }

  if (trimmed === "/authstatus") {
    return { type: "auth-status" };
  }

  if (trimmed === "/authcancel") {
    return { type: "auth-cancel" };
  }

  if (trimmed === "/authresume") {
    return { type: "auth-resume" };
  }

  if (trimmed !== "/new" && !trimmed.startsWith("/new ")) {
    return { type: "prompt", prompt: trimmed };
  }

  if (hasAudio) {
    return { type: "prompt", prompt: null };
  }

  const remainder = trimmed.slice(4).trim();
  return {
    type: "new",
    prompt:
      remainder ||
      (hasImages ? DEFAULT_IMAGE_PROMPT : hasFiles ? DEFAULT_FILE_PROMPT : null),
  };
}

async function handleCancelCommand(sender) {
  if (!isProcessingInteractive || !activeJobControl) {
    await sendReply(sender, "No active task to cancel.");
    return;
  }

  const cancelled = cancelJobControl(activeJobControl);
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
    scheduledJob.nextRunAt = computeFollowingRunAt(scheduledJob, new Date(nextRunMs + 60_000));
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
  const localImageAttachments = discoverScheduledWorkflowImageAttachments(
    scheduledJob.workflowPrompt
  );
  const localFileAttachments = discoverScheduledWorkflowFileAttachments(
    scheduledJob.workflowPrompt
  );

  backgroundQueue.push({
    sender: scheduledJob.sender,
    command: { type: "prompt", prompt: executionPrompt },
    context: buildAttachmentContext(
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

function snapshotAutoresearchRuns() {
  const snapshots = new Map();

  if (!fs.existsSync(RESEARCH_ROOT)) {
    return snapshots;
  }

  for (const topicEntry of fs.readdirSync(RESEARCH_ROOT, { withFileTypes: true })) {
    if (!topicEntry.isDirectory()) {
      continue;
    }

    const activeDir = path.join(
      RESEARCH_ROOT,
      topicEntry.name,
      "autoresearch",
      "active"
    );

    if (!fs.existsSync(activeDir)) {
      continue;
    }

    for (const runEntry of fs.readdirSync(activeDir, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) {
        continue;
      }

      const runRoot = path.join(activeDir, runEntry.name);
      const statePath = path.join(runRoot, "STATE.json");
      if (!fs.existsSync(statePath)) {
        continue;
      }

      try {
        const raw = fs.readFileSync(statePath, "utf8");
        const parsed = JSON.parse(raw);
        const pendingQuestions = Array.isArray(parsed?.pendingQuestions)
          ? parsed.pendingQuestions
          : [];
        snapshots.set(runRoot, {
          runRoot,
          topicSlug: normalizeText(parsed?.topicSlug) || topicEntry.name,
          runSlug: normalizeText(parsed?.runSlug) || runEntry.name,
          rootQuestion: normalizeText(parsed?.rootQuestion),
          status: normalizeText(parsed?.status) || "unknown",
          pendingCount: pendingQuestions.length,
          statePath,
          logPath: path.join(runRoot, "LOG.md"),
          wikiIndexPath: path.join(RESEARCH_ROOT, topicEntry.name, "wiki", "index.md"),
        });
      } catch (error) {
        console.error(
          `[${timestamp()}] Failed reading autoresearch state at ${statePath}: ${error.message}`
        );
      }
    }
  }

  return snapshots;
}

function collectCompletedAutoresearchRuns(beforeRuns, afterRuns) {
  const completed = [];

  for (const [runRoot, before] of beforeRuns.entries()) {
    if (before.status !== "active" || before.pendingCount === 0) {
      continue;
    }

    const after = afterRuns.get(runRoot);
    if (!after) {
      continue;
    }

    if (after.status === "completed" || after.pendingCount === 0) {
      completed.push(after);
    }
  }

  return completed;
}

function loadAutoresearchRunState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    console.error(`[${timestamp()}] Failed reading completed autoresearch run state at ${statePath}: ${error.message}`);
    return null;
  }
}

function buildAutoresearchCompletionSummary(run) {
  const state = loadAutoresearchRunState(run.statePath);
  const processedQuestions = Array.isArray(state?.processedQuestions)
    ? state.processedQuestions
    : [];
  const evidenceText = [
    normalizeText(state?.rootQuestion),
    ...processedQuestions
      .slice(-3)
      .flatMap((question) => [normalizeText(question?.question), ...(Array.isArray(question?.notes) ? question.notes : [])]),
  ]
    .map((text) => normalizeText(text).toLowerCase())
    .filter(Boolean)
    .join(" ");

  const conclusions = [];
  const followUps = [];

  if (evidenceText.includes("plaintext") && evidenceText.includes("request")) {
    conclusions.push(
      "Request delivery is better than a plain-JSON baseline, but plaintext-compatible request shapes still exist in the protocol surface."
    );
    followUps.push(
      "Exercise downgrade and legacy request paths to prove plaintext prompts cannot be reintroduced through compatibility routes."
    );
  }

  if (evidenceText.includes("response") && evidenceText.includes("plaintext")) {
    conclusions.push(
      "Response confidentiality is still the weakest live boundary: the provider response path remains plaintext to the coordinator today."
    );
    followUps.push(
      "Close or explicitly de-scope the live response plaintext path, including streaming, retry, and logging branches."
    );
  }

  if (
    evidenceText.includes("open mode") ||
    evidenceText.includes("missing hash") ||
    evidenceText.includes("trust tier") ||
    evidenceText.includes("routing floor") ||
    evidenceText.includes("runtime verified") ||
    evidenceText.includes("attestation")
  ) {
    conclusions.push(
      "Attestation and trust enforcement still have downgrade or fail-open edges, so privacy depends on operator policy staying strict."
    );
    followUps.push(
      "Audit Open Mode, missing-hash handling, and trust-floor overrides with proof-of-concept attempts to confirm they fail closed where the privacy story expects them to."
    );
  }

  if (conclusions.length === 0) {
    const fallbackNotes = processedQuestions
      .slice(-2)
      .flatMap((question) => Array.isArray(question?.notes) ? question.notes : [])
      .map((note) => truncateText(note, 220))
      .filter(Boolean);
    conclusions.push(
      fallbackNotes[0] || "The run completed without preserving a machine-readable synthesis in the artifacts."
    );
    if (fallbackNotes[1]) {
      conclusions.push(fallbackNotes[1]);
    }
  }

  if (followUps.length === 0) {
    followUps.push(
      "Review the most recent completed branches and pick the next deepest path with a downgrade, plaintext, or fail-open surface."
    );
  }

  return {
    conclusions: dedupeStrings(conclusions),
    followUps: dedupeStrings(followUps),
  };
}

function formatAutoresearchCompletionNotice(run) {
  const topicLabel = formatSlugForDisplay(run.topicSlug);
  const summary = buildAutoresearchCompletionSummary(run);
  const lines = [`Autoresearch completed for ${topicLabel}.`];

  if (run.rootQuestion) {
    lines.push(`Question: ${truncateText(run.rootQuestion, 220)}`);
  }

  if (summary.conclusions.length > 0) {
    lines.push("Conclusions:");
    for (const conclusion of summary.conclusions) {
      lines.push(`- ${conclusion}`);
    }
  }

  if (summary.followUps.length > 0) {
    lines.push("Follow-ups:");
    for (const followUp of summary.followUps) {
      lines.push(`- ${followUp}`);
    }
  }

  lines.push(`Wiki index: ${run.wikiIndexPath}`);
  lines.push(`Run log: ${run.logPath}`);
  return lines.join("\n");
}

async function processJob(job) {
  if (job.command.type === "status") {
    await sendJobReply(job, await getBridgeStatusReport());
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
    await updateSignalProfileAvatar({ remove: true });
    await sendJobReply(job, "Removed Sable's Signal profile picture.");
    return;
  }

  if (job.command.type === "auth-status") {
    await sendJobReply(job, formatPendingPluginAuthStatus(state.pendingPluginAuth));
    return;
  }

  if (job.command.type === "auth-cancel") {
    if (!state.pendingPluginAuth) {
      await sendJobReply(job, "No plugin auth flow is currently pending.");
      return;
    }

    clearPendingPluginAuth();
    await sendJobReply(job, "Cleared the pending plugin auth flow.");
    return;
  }

  if (job.command.type === "auth-resume") {
    if (!state.pendingPluginAuth) {
      await sendJobReply(job, "No plugin auth flow is ready to resume.");
      return;
    }

    if (state.pendingPluginAuth.status !== "completed") {
      await sendJobReply(job, formatPendingPluginAuthStatus(state.pendingPluginAuth));
      return;
    }

    if (!state.pendingPluginAuth.sourcePrompt) {
      clearPendingPluginAuth();
      await sendJobReply(job, "The plugin connected, but there is no saved prompt to retry. Ask again normally.");
      return;
    }

    const resumePrompt = state.pendingPluginAuth.sourcePrompt;
    clearPendingPluginAuth();
    job.command = { type: "prompt", prompt: resumePrompt };
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
  const imagePaths = await materializeIncomingImages(job.context);
  const filePaths = await materializeIncomingFiles(job.context);
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
    audioPaths = await materializeIncomingAudio(job.context);
  }
  const jobControl = createJobControl(job.sender);
  const autoresearchBefore =
    backgroundJob && isAutoresearchTickJob(job) ? snapshotAutoresearchRuns() : null;
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

      await updateSignalProfileAvatar({ avatarPath: imagePaths[0] });
      const suffix =
        imagePaths.length > 1 ? ` Used the first attached image and ignored ${imagePaths.length - 1} extra image${imagePaths.length === 2 ? "" : "s"}.` : "";
      await sendJobReply(job, `Updated Sable's Signal profile picture.${suffix}`);
      return;
    }

    if (audioPaths.length > 0) {
      if (!VOICE_NOTES_ENABLED) {
        await sendJobReply(job, "Voice note transcription is disabled.");
        return;
      }

      let transcription = preparedVoiceNote?.transcription || null;
      if (!transcription) {
        await sendJobProgressReply(job, "Transcribing voice note...");
        transcription = await transcribeVoiceNote(audioPaths[0], jobControl);
      }

      if (!normalizeText(transcription?.transcript)) {
        await sendJobReply(job, "Voice note transcription returned no text.");
        return;
      }

      if (VOICE_NOTES_ECHO_TRANSCRIPT) {
        await sendJobProgressReply(job, formatVoiceTranscriptMessage(transcription));
      }

      prompt = transcription.transcript;
    }

    if (filePaths.length > 0) {
      await sendJobProgressReply(job, "Reading attached files...");
      const fileContext = await buildFileAttachmentPromptContext(job.context, filePaths);
      if (!fileContext.ok) {
        await sendJobProgressReply(
          job,
          `${fileContext.message} I still exposed the local attachment path for this turn in case a tool can use the file directly.`
        );
      } else {
        prompt = mergePromptSegments(prompt, fileContext.promptText);
      }
    }

    const localAttachmentContext = buildLocalAttachmentPathPromptContext(job.context, {
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
      const handled = await maybeStartPendingPluginAuth(job.sender, prompt, result.toolSuggestion);
      if (handled) {
        if (result.message && shouldForwardAgentMessageAlongsideToolSuggestion(result.message)) {
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
        const completedRuns = collectCompletedAutoresearchRuns(
          autoresearchBefore,
          snapshotAutoresearchRuns()
        );
        for (const completedRun of completedRuns) {
          await sendReply(job.sender, formatAutoresearchCompletionNotice(completedRun));
        }
      }
      return;
    }

    if (result.message) {
      await sendJobReply(job, result.message);
    } else if (!shouldSuppressJobReplies(job)) {
      await sendReply(job.sender, "Sable completed without a final message.");
    }

    if (autoresearchBefore) {
      const completedRuns = collectCompletedAutoresearchRuns(
        autoresearchBefore,
        snapshotAutoresearchRuns()
      );
      for (const completedRun of completedRuns) {
        await sendReply(job.sender, formatAutoresearchCompletionNotice(completedRun));
      }
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
    return runCodexViaTestScenario(
      prompt,
      sessionId,
      imagePaths,
      jobControl,
      suppressLiveUpdates,
      onInvalidSession
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

async function runCodexViaTestScenario(
  prompt,
  sessionId,
  imagePaths = [],
  jobControl = null,
  suppressLiveUpdates = false
) {
  const threadMethod = sessionId ? "thread/resume" : "thread/start";
  const threadParams = buildAppServerThreadParams(sessionId || undefined);
  appendTestAppServerLog({
    method: threadMethod,
    params: threadParams,
  });

  const scenario = await loadTestTurnScenario();
  const index = takeNextTestTurnIndex();
  const turnConfig = scenario[index] || {};
  const resolvedSessionId = sessionId || turnConfig.threadId || `thread-${index + 1}`;
  const turnParams = {
    ...buildAppServerTurnParams(resolvedSessionId, prompt, imagePaths),
  };
  appendTestAppServerLog({
    method: "turn/start",
    params: turnParams,
  });

  const delayMs = Number.isFinite(turnConfig.messageDelayMs) ? turnConfig.messageDelayMs : 120;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unregister();
      resolve();
    }, delayMs);
    const unregister = registerCancellationHandler(jobControl, (error) => {
      clearTimeout(timer);
      unregister();
      reject(error);
    });
  });

  return {
    sessionId: resolvedSessionId,
    message:
      typeof turnConfig.message === "string" ? turnConfig.message : `fake reply ${index + 1}`,
    toolSuggestion: null,
    startedFreshBecauseResumeFailed: false,
  };
}

async function loadTestTurnScenario() {
  const payload = await fs.promises.readFile(TEST_TURN_SCENARIO_PATH, "utf8");
  const parsed = JSON.parse(payload);
  return Array.isArray(parsed?.turns) ? parsed.turns : [];
}

function takeNextTestTurnIndex() {
  let index = 0;

  try {
    index = Number.parseInt(fs.readFileSync(TEST_TURN_CURSOR_PATH, "utf8"), 10) || 0;
  } catch (error) {
    index = 0;
  }

  try {
    fs.writeFileSync(TEST_TURN_CURSOR_PATH, String(index + 1), "utf8");
  } catch (error) {
    console.error(`[${timestamp()}] Failed advancing Sable e2e turn cursor: ${error.message}`);
  }

  return index;
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
    const liveUpdates = createLiveUpdateChannel(
      suppressLiveUpdates ? "" : activeSender
    );
    let parsedSessionId = sessionId || null;
    let pendingAgentMessage = null;
    let finalMessage = "";
    const subagentState = createSubagentProgressState();
    let turnId = null;
    let toolSuggestion = null;
    let didFinish = false;
    let timeout = null;
    const toolSuggestionCalls = new Map();

    const client = createAppServerClient({
      onNotification: handleNotification,
      onServerRequest: handleServerRequest,
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
          toolSuggestion = await findToolSuggestionForTurn(parsedSessionId, startedAt);
        } catch (error) {
          console.error(
            `[${timestamp()}] Failed reading structured tool suggestions: ${error.message}`
          );
        }
      }

      if (!normalizeText(finalMessage) && parsedSessionId) {
        try {
          finalMessage = await findSessionErrorMessageForTurn(parsedSessionId, startedAt);
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

      if (message.method === "turn/started") {
        turnId = normalizeText(message.params?.turn?.id) || turnId;
        liveUpdates.queue("• Working...");
        return;
      }

      const rawSuggestion = captureToolSuggestionFromNotification(message, toolSuggestionCalls);
      if (rawSuggestion) {
        toolSuggestion = rawSuggestion;
        return;
      }

      if (message.method === "item/started" || message.method === "item/completed") {
        handleSubagentToolCallNotification(message, subagentState, liveUpdates);
        const parsed = handleCodexAppServerItem(message.params?.item, {
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
        const promptText = formatToolUserInputRequest(message.params);
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

        const autoResponse = buildAutoAcceptedMcpElicitationResponse(message.params);
        if (autoResponse) {
          return autoResponse;
        }

        const promptText = formatMcpElicitationRequest(message.params);
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
        appendTestAppServerLog({
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
        appendTestAppServerLog({
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

function captureToolSuggestionFromNotification(message, callsById) {
  const item = message?.params?.item;
  if (!item || typeof item !== "object") {
    return null;
  }

  if (item.type === "function_call" && item.name === "tool_suggest") {
    callsById.set(item.call_id, {
      arguments: safeJsonParse(item.arguments),
      output: null,
    });
    return null;
  }

  if (item.type !== "function_call_output" || !item.call_id) {
    return null;
  }

  const existing = callsById.get(item.call_id) || {
    arguments: null,
    output: null,
  };
  existing.output = safeJsonParse(item.output);
  callsById.set(item.call_id, existing);

  const toolId =
    normalizeText(existing.output?.tool_id) || normalizeText(existing.arguments?.tool_id);
  const toolType =
    normalizeText(existing.output?.tool_type) || normalizeText(existing.arguments?.tool_type);

  if (!toolId || !toolType) {
    return null;
  }

  return {
    actionType:
      normalizeText(existing.output?.action_type) ||
      normalizeText(existing.arguments?.action_type),
    suggestReason:
      normalizeText(existing.output?.suggest_reason) ||
      normalizeText(existing.arguments?.suggest_reason),
    toolId,
    toolName:
      normalizeText(existing.output?.tool_name) || normalizeText(toolId.split("@")[0]),
    toolType,
    completed: Boolean(existing.output?.completed),
    userConfirmed: Boolean(existing.output?.user_confirmed),
  };
}

function handleCodexAppServerItem(item, stateSnapshot) {
  let { pendingAgentMessage, finalMessage, liveUpdates, subagentState } = stateSnapshot;

  if (!item || typeof item !== "object") {
    return { pendingAgentMessage, finalMessage };
  }

  if (item.type === "agentMessage") {
    if (subagentState?.activeCount) {
      pendingAgentMessage = null;
      return { pendingAgentMessage, finalMessage };
    }

    const text = normalizeText(item.text);
    if (text) {
      if (pendingAgentMessage) {
        liveUpdates.queue(formatProgressMessage(pendingAgentMessage));
      }
      pendingAgentMessage = text;
      finalMessage = text;
    }
    return { pendingAgentMessage, finalMessage };
  }

  if (item.type === "commandExecution") {
    if (pendingAgentMessage && !subagentState?.activeCount) {
      liveUpdates.queue(formatProgressMessage(pendingAgentMessage));
      pendingAgentMessage = null;
    } else if (subagentState?.activeCount) {
      pendingAgentMessage = null;
    }

    if (item.status !== "completed" || item.exitCode !== 0) {
      const command = truncateText(item.command || "", MAX_COMMAND_TEXT_LENGTH) || "(empty command)";
      const snippet = normalizeText(item.aggregatedOutput).slice(0, MAX_FAILURE_OUTPUT_LENGTH);
      console.error(
        `[${timestamp()}] Suppressed command failure relay: exitCode=${
          item.exitCode ?? "unknown"
        } command=${JSON.stringify(command)} output=${JSON.stringify(snippet)}`
      );
    }

    return { pendingAgentMessage, finalMessage };
  }

  if (item.type === "mcpToolCall" && item.status === "failed") {
    const errorText = normalizeText(item.error?.message);
    if (errorText) {
      liveUpdates.queue(formatProgressMessage(errorText));
    }
  }

  return { pendingAgentMessage, finalMessage };
}

function createSubagentProgressState() {
  return {
    activeToolCalls: new Set(),
    activeCount: 0,
    announcedInTurn: false,
  };
}

function handleSubagentToolCallNotification(message, subagentState, liveUpdates) {
  if (!subagentState || !liveUpdates) {
    return;
  }

  const item = message?.params?.item;
  if (!item || item.type !== "mcpToolCall") {
    return;
  }

  const toolName = extractMcpToolCallName(item);
  if (!isSubagentToolName(toolName)) {
    return;
  }

  const toolCallKey = extractMcpToolCallKey(item, toolName);
  if (!toolCallKey) {
    return;
  }

  if (message.method === "item/started") {
    const wasIdle = subagentState.activeCount === 0;
    if (!subagentState.activeToolCalls.has(toolCallKey)) {
      subagentState.activeToolCalls.add(toolCallKey);
      subagentState.activeCount = subagentState.activeToolCalls.size;
    }

    if (wasIdle && !subagentState.announcedInTurn) {
      liveUpdates.queue("• Kicking off a subagent for a bounded task...");
      subagentState.announcedInTurn = true;
    }
    return;
  }

  if (message.method === "item/completed") {
    subagentState.activeToolCalls.delete(toolCallKey);
    subagentState.activeCount = subagentState.activeToolCalls.size;
  }
}

function extractMcpToolCallName(item) {
  return normalizeText(
    item.toolName ||
      item.name ||
      item.tool?.name ||
      item.call?.toolName ||
      item.call?.name ||
      item.metadata?.toolName
  ).toLowerCase();
}

function extractMcpToolCallKey(item, toolName) {
  return normalizeText(
    item.id ||
      item.callId ||
      item.toolCallId ||
      item.invocationId ||
      item.call?.id ||
      item.call?.callId ||
      toolName
  );
}

function isSubagentToolName(toolName) {
  return (
    toolName === "spawn_agent" ||
    toolName === "wait_agent" ||
    toolName === "send_input" ||
    toolName === "resume_agent" ||
    toolName === "close_agent"
  );
}

function buildAppServerThreadParams(threadId = null) {
  const params = {
    cwd: CODEX_CWD,
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
    approvalPolicy: "never",
    approvalsReviewer: "guardian_subagent",
    personality: "pragmatic",
    input: [
      { type: "text", text: prompt },
      ...imagePaths.map((imagePath) => ({ type: "localImage", path: imagePath })),
    ],
  };
}

function formatToolUserInputRequest(params) {
  const questions = Array.isArray(params?.questions) ? params.questions : [];
  if (questions.length === 0) {
    return "Sable requested user input for a tool, but the bridge cannot answer it yet.";
  }

  const lines = ["Sable requested tool input that this bridge cannot answer yet:"];
  for (const question of questions.slice(0, 3)) {
    const prompt = normalizeText(question?.question);
    const header = normalizeText(question?.header);
    if (header && prompt) {
      lines.push(`${header}: ${prompt}`);
    } else if (prompt) {
      lines.push(prompt);
    }
  }
  return lines.join("\n");
}

function formatMcpElicitationRequest(params) {
  const message = normalizeText(params?.message);
  const url = normalizeText(params?.url);
  if (!message && !url) {
    return "Sable requested MCP input that this bridge cannot answer yet.";
  }

  return [message, url].filter(Boolean).join("\n");
}

function buildAutoAcceptedMcpElicitationResponse(params) {
  const promptText = normalizeText(params?.message);
  const schema = params?.requestedSchema;

  const optimisticContent = buildAutoAcceptedMcpElicitationContent(schema);
  if (promptText && /^allow\b.+\?$/i.test(promptText) && optimisticContent) {
    return {
      action: "accept",
      content: optimisticContent,
    };
  }

  if (normalizeText(params?.mode) !== "form" || !optimisticContent) {
    return null;
  }

  return {
    action: "accept",
    content: optimisticContent,
  };
}

function buildAutoAcceptedMcpElicitationContent(schema) {
  if (!schema) {
    return {};
  }

  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    return null;
  }

  const content = {};

  for (const [key, definition] of Object.entries(schema.properties)) {
    const value = buildAutoAcceptedMcpElicitationValue(definition);
    if (typeof value === "undefined") {
      return null;
    }
    content[key] = value;
  }

  return content;
}

function buildAutoAcceptedMcpElicitationValue(definition) {
  if (!definition || typeof definition !== "object") {
    return undefined;
  }

  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return definition.enum[0];
  }

  if (definition.type === "boolean") {
    return true;
  }

  if (definition.type === "string") {
    return typeof definition.default === "string" ? definition.default : "";
  }

  if (definition.type === "number" || definition.type === "integer") {
    return Number.isFinite(definition.default) ? definition.default : 0;
  }

  return undefined;
}

function createAppServerClient({ onNotification, onServerRequest }) {
  const child = spawn("codex", buildCodexAppServerArgs(), {
    cwd: CODEX_CWD,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  let nextRequestId = 1;
  const pending = new Map();
  let closed = false;

  function rejectPending(error) {
    for (const [id, entry] of pending.entries()) {
      pending.delete(id);
      entry.reject(error);
    }
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    rejectPending(new Error("app-server client closed"));
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  function request(method, params) {
    const id = nextRequestId++;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async function initialize() {
    return request("initialize", {
      clientInfo: {
        name: "signal-codex-bridge",
        version: APP_SERVER_CLIENT_VERSION,
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  }

  async function handleServerRequestMessage(message) {
    let result = {};

    try {
      if (typeof onServerRequest === "function") {
        result = (await onServerRequest(message)) || {};
      }
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`
      );
    } catch (error) {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: error.message || "Bridge server request failed" },
        })}\n`
      );
    }
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
        const entry = pending.get(message.id);
        if (!entry) {
          continue;
        }

        pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(message.error.message || "Unknown app-server error"));
        } else {
          entry.resolve(message.result);
        }
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
        void handleServerRequestMessage(message);
        continue;
      }

      if (typeof onNotification === "function") {
        onNotification(message);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    const text = chunk.trim();
    if (text) {
      console.error(`[${timestamp()}] codex app-server stderr: ${text}`);
    }
  });

  child.on("error", (error) => {
    rejectPending(error);
  });

  child.on("exit", (code) => {
    if (!closed && code !== 0) {
      rejectPending(new Error(`codex app-server exited with code ${code}`));
    }
  });

  return {
    initialize,
    request,
    close,
  };
}

async function findToolSuggestionForTurn(threadId, startedAtIso) {
  const sessionPath = await findSessionFileForThread(threadId);
  if (!sessionPath) {
    return null;
  }

  const raw = await fs.promises.readFile(sessionPath, "utf8");
  const callsById = new Map();

  for (const line of String(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (error) {
      continue;
    }

    if (!isTimestampOnOrAfter(entry.timestamp, startedAtIso)) {
      continue;
    }

    if (entry.type !== "response_item" || !entry.payload) {
      continue;
    }

    if (entry.payload.type === "function_call" && entry.payload.name === "tool_suggest") {
      const record = {
        callId: entry.payload.call_id,
        arguments: safeJsonParse(entry.payload.arguments),
        output: null,
      };
      callsById.set(record.callId, record);
    }

    if (entry.payload.type === "function_call_output" && entry.payload.call_id) {
      const existing = callsById.get(entry.payload.call_id) || {
        callId: entry.payload.call_id,
        arguments: null,
        output: null,
      };
      existing.output = safeJsonParse(entry.payload.output);
      callsById.set(existing.callId, existing);
    }
  }

  for (const record of callsById.values()) {
    const toolId =
      normalizeText(record.output?.tool_id) || normalizeText(record.arguments?.tool_id);
    const toolType =
      normalizeText(record.output?.tool_type) || normalizeText(record.arguments?.tool_type);

    if (!toolId || !toolType) {
      continue;
    }

    return {
      actionType:
        normalizeText(record.output?.action_type) ||
        normalizeText(record.arguments?.action_type),
      suggestReason:
        normalizeText(record.output?.suggest_reason) ||
        normalizeText(record.arguments?.suggest_reason),
      toolId,
      toolName:
        normalizeText(record.output?.tool_name) || normalizeText(toolId.split("@")[0]),
      toolType,
      completed: Boolean(record.output?.completed),
      userConfirmed: Boolean(record.output?.user_confirmed),
    };
  }

  return null;
}

async function findSessionFileForThread(threadId) {
  const segments = await fs.promises.readdir(CODEX_SESSIONS_DIR, { withFileTypes: true });

  for (const yearEntry of segments) {
    if (!yearEntry.isDirectory()) {
      continue;
    }

    const yearPath = path.join(CODEX_SESSIONS_DIR, yearEntry.name);
    const monthEntries = await fs.promises.readdir(yearPath, { withFileTypes: true });

    for (const monthEntry of monthEntries) {
      if (!monthEntry.isDirectory()) {
        continue;
      }

      const monthPath = path.join(yearPath, monthEntry.name);
      const dayEntries = await fs.promises.readdir(monthPath, { withFileTypes: true });

      for (const dayEntry of dayEntries) {
        if (!dayEntry.isDirectory()) {
          continue;
        }

        const dayPath = path.join(monthPath, dayEntry.name);
        const fileEntries = await fs.promises.readdir(dayPath, { withFileTypes: true });

        for (const fileEntry of fileEntries) {
          if (!fileEntry.isFile()) {
            continue;
          }

          if (fileEntry.name.includes(threadId) && fileEntry.name.endsWith(".jsonl")) {
            return path.join(dayPath, fileEntry.name);
          }
        }
      }
    }
  }

  return null;
}

async function findSessionErrorMessageForTurn(threadId, startedAtIso) {
  const sessionPath = await findSessionFileForThread(threadId);
  if (!sessionPath) {
    return "";
  }

  const raw = await fs.promises.readFile(sessionPath, "utf8");
  let latestError = "";

  for (const line of String(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (error) {
      continue;
    }

    if (!isTimestampOnOrAfter(entry.timestamp, startedAtIso)) {
      continue;
    }

    if (entry.type !== "event_msg" || entry.payload?.type !== "error") {
      continue;
    }

    latestError = normalizeText(entry.payload?.message) || latestError;
  }

  return latestError;
}

function isTimestampOnOrAfter(candidate, reference) {
  const candidateMs = Date.parse(candidate);
  const referenceMs = Date.parse(reference);

  if (Number.isNaN(candidateMs) || Number.isNaN(referenceMs)) {
    return false;
  }

  return candidateMs >= referenceMs;
}

function safeJsonParse(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

async function maybeStartPendingPluginAuth(sender, sourcePrompt, toolSuggestion) {
  if (
    toolSuggestion.toolType !== "plugin" ||
    toolSuggestion.actionType !== "install" ||
    !toolSuggestion.toolId
  ) {
    return false;
  }

  const installInfo = await getPluginInstallInfo(toolSuggestion.toolId);
  if (!installInfo || !installInfo.installUrl) {
    return false;
  }

  state.pendingPluginAuth = {
    sender,
    pluginId: installInfo.pluginId,
    pluginName: installInfo.pluginName,
    displayName: installInfo.displayName,
    marketplacePath: installInfo.marketplacePath,
    installUrl: installInfo.installUrl,
    sourcePrompt: normalizeText(sourcePrompt),
    status: "pending",
    startedAt: timestamp(),
    completedAt: "",
    lastCheckedAt: "",
  };
  saveState();

  await sendReply(sender, formatPendingPluginAuthPrompt(state.pendingPluginAuth));
  return true;
}

function clearPendingPluginAuth() {
  state.pendingPluginAuth = null;
  saveState();
}

function shouldForwardAgentMessageAlongsideToolSuggestion(message) {
  const normalized = normalizeText(message).toLowerCase();
  if (!normalized) {
    return false;
  }

  return !normalized.includes("install `");
}

async function checkForPendingPluginAuth() {
  if (
    !state.pendingPluginAuth ||
    state.pendingPluginAuth.status !== "pending" ||
    isProcessingInteractive
  ) {
    return;
  }

  const pending = state.pendingPluginAuth;

  try {
    const status = await getPluginInstallStatus(pending);
    pending.lastCheckedAt = timestamp();

    if (!pending.installUrl && status.installUrl) {
      pending.installUrl = status.installUrl;
    }

    if (status.installed) {
      pending.status = "completed";
      pending.completedAt = timestamp();
      saveState();
      await sendReply(pending.sender, formatPendingPluginAuthCompleted(pending));
      return;
    }

    saveState();
  } catch (error) {
    console.error(`[${timestamp()}] Pending plugin auth poll failed: ${error.message}`);
  }
}

async function getPluginInstallInfo(pluginId) {
  const { pluginName } = splitPluginId(pluginId);
  const pluginSummary = await findPluginSummary(pluginId);

  if (!pluginSummary) {
    return null;
  }

  const detail = await callCodexAppServer("plugin/read", {
    marketplacePath: pluginSummary.marketplacePath,
    pluginName,
  });

  const appWithInstallUrl = Array.isArray(detail?.plugin?.apps)
    ? detail.plugin.apps.find((app) => normalizeText(app.installUrl))
    : null;

  return {
    pluginId,
    pluginName,
    displayName:
      normalizeText(detail?.plugin?.summary?.interface?.displayName) ||
      normalizeText(pluginSummary.displayName) ||
      pluginName,
    marketplacePath: pluginSummary.marketplacePath,
    installUrl: normalizeText(appWithInstallUrl?.installUrl),
  };
}

async function getPluginInstallStatus(pendingPluginAuth) {
  const pluginSummary = await findPluginSummary(pendingPluginAuth.pluginId, true);

  if (pluginSummary) {
    return {
      installed: Boolean(pluginSummary.installed),
      enabled: Boolean(pluginSummary.enabled),
      installUrl: normalizeText(pluginSummary.installUrl),
    };
  }

  const detail = await callCodexAppServer("plugin/read", {
    marketplacePath: pendingPluginAuth.marketplacePath,
    pluginName: pendingPluginAuth.pluginName,
  });

  const appWithInstallUrl = Array.isArray(detail?.plugin?.apps)
    ? detail.plugin.apps.find((app) => normalizeText(app.installUrl))
    : null;

  return {
    installed: Boolean(detail?.plugin?.summary?.installed),
    enabled: Boolean(detail?.plugin?.summary?.enabled),
    installUrl: normalizeText(appWithInstallUrl?.installUrl),
  };
}

async function findPluginSummary(pluginId, forceRemoteSync = false) {
  const response = await callCodexAppServer("plugin/list", {
    cwds: [CODEX_CWD],
    forceRemoteSync,
  });

  for (const marketplace of response?.marketplaces || []) {
    for (const plugin of marketplace.plugins || []) {
      if (plugin.id !== pluginId) {
        continue;
      }

      return {
        ...plugin,
        displayName: normalizeText(plugin.interface?.displayName),
        installUrl: "",
        marketplacePath: marketplace.path,
      };
    }
  }

  return null;
}

function splitPluginId(pluginId) {
  const normalized = normalizeText(pluginId);
  const atIndex = normalized.indexOf("@");

  if (atIndex === -1) {
    return { pluginName: normalized, marketplaceName: "" };
  }

  return {
    pluginName: normalized.slice(0, atIndex),
    marketplaceName: normalized.slice(atIndex + 1),
  };
}

function callCodexAppServer(method, params) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", buildCodexAppServerArgs(), {
      cwd: CODEX_CWD,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    let nextRequestId = 1;
    const pending = new Map();
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new Error(`app-server request timed out for ${method}`));
    }, APP_SERVER_REQUEST_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    }

    function succeed(result) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    }

    function sendRequest(requestMethod, requestParams) {
      const id = nextRequestId++;
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: requestMethod,
        params: requestParams,
      });

      return new Promise((innerResolve, innerReject) => {
        pending.set(id, { resolve: innerResolve, reject: innerReject });
        child.stdin.write(`${payload}\n`, (error) => {
          if (error) {
            pending.delete(id);
            innerReject(error);
          }
        });
      });
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(message, "id")) {
          const entry = pending.get(message.id);
          if (!entry) {
            continue;
          }

          pending.delete(message.id);
          if (message.error) {
            entry.reject(new Error(message.error.message || "Unknown app-server error"));
          } else {
            entry.resolve(message.result);
          }
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const text = chunk.trim();
      if (text) {
        console.error(`[${timestamp()}] codex app-server stderr: ${text}`);
      }
    });

    child.on("error", fail);
    child.on("exit", (code) => {
      if (!settled && code !== 0) {
        fail(new Error(`codex app-server exited with code ${code}`));
      }
    });

    (async () => {
      try {
        await sendRequest("initialize", {
          clientInfo: {
            name: "signal-codex-bridge",
            version: "1.0.0",
          },
          capabilities: {
            experimentalApi: true,
          },
        });

        const result = await sendRequest(method, params);
        succeed(result);
      } catch (error) {
        fail(error);
      }
    })();
  });
}

function buildCodexAppServerArgs() {
  return [
    "--search",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    CODEX_CWD,
    "-c",
    "shell_environment_policy.inherit=all",
    "app-server",
    "--listen",
    "stdio://",
  ];
}

function recordTestAppServerSpawnArgs() {
  appendTestAppServerLog({
    method: "spawn",
    params: {
      args: buildCodexAppServerArgs(),
    },
  });
}

function formatPendingPluginAuthPrompt(pendingPluginAuth) {
  return [
    `${pendingPluginAuth.displayName} needs a browser auth step.`,
    pendingPluginAuth.installUrl,
    "Open the link on your phone, finish the connector flow, and I will poll for completion automatically.",
    "Commands: /authstatus, /authcancel, /authresume",
  ].join("\n");
}

function formatPendingPluginAuthStatus(pendingPluginAuth) {
  if (!pendingPluginAuth) {
    return "No plugin auth flow is currently pending.";
  }

  const lines = [
    `${pendingPluginAuth.displayName}: ${pendingPluginAuth.status}`,
    `started: ${pendingPluginAuth.startedAt}`,
  ];

  if (pendingPluginAuth.lastCheckedAt) {
    lines.push(`last checked: ${pendingPluginAuth.lastCheckedAt}`);
  }

  if (pendingPluginAuth.completedAt) {
    lines.push(`completed: ${pendingPluginAuth.completedAt}`);
  }

  lines.push(pendingPluginAuth.installUrl);

  if (pendingPluginAuth.status === "completed") {
    lines.push("Reply /authresume to retry the request that triggered the connection.");
  } else {
    lines.push("Still waiting for the browser-side connector flow to finish.");
  }

  return lines.join("\n");
}

function formatPendingPluginAuthCompleted(pendingPluginAuth) {
  return [
    `${pendingPluginAuth.displayName} now looks connected.`,
    "Reply /authresume to retry the request that triggered this auth flow, or just ask normally.",
  ].join("\n");
}

function createLiveUpdateChannel(recipient) {
  let queue = [];
  let timer = null;
  let lastSentAt = 0;
  let lastSentText = "";

  async function flush() {
    if (!recipient || queue.length === 0) {
      queue = [];
      clearTimer();
      return;
    }

    const text = queue.join("\n");
    queue = [];
    clearTimer();

    if (shouldSuppressDuplicate(text)) {
      return;
    }

    await sendReply(recipient, text);
    markSent(text);
  }

  function queueMessage(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }

    if (queue.length > 0 && queue[queue.length - 1] === normalized) {
      return;
    }

    queue.push(normalized);

    if (!timer) {
      timer = setTimeout(() => {
        void flush().catch((error) => {
          console.error(`[${timestamp()}] Failed sending live update: ${error.message}`);
        });
      }, LIVE_UPDATE_BATCH_WINDOW_MS);
    }
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function shouldSuppressDuplicate(text) {
    return (
      text === lastSentText &&
      Date.now() - lastSentAt < LIVE_UPDATE_DUPLICATE_WINDOW_MS
    );
  }

  function markSent(text) {
    lastSentText = text;
    lastSentAt = Date.now();
  }

  function stop() {
    clearTimer();
  }

  return {
    queue: queueMessage,
    flush,
    markSent,
    stop,
  };
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

async function materializeIncomingImages(context) {
  if (!context || !Array.isArray(context.imageAttachments) || context.imageAttachments.length === 0) {
    return [];
  }

  const attachmentDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "signal-codex-images-")
  );
  const writtenPaths = [];

  try {
    for (const attachment of context.imageAttachments) {
      const filePath = path.join(
        attachmentDir,
        buildAttachmentFilename(attachment, writtenPaths.length)
      );
      if (isLocalImageAttachment(attachment)) {
        await fs.promises.copyFile(attachment.localPath, filePath);
      } else {
        const data = await fetchAttachmentData(context, attachment.id);
        await fs.promises.writeFile(filePath, Buffer.from(data, "base64"));
      }
      writtenPaths.push(filePath);
    }
  } catch (error) {
    await cleanupPaths(writtenPaths);
    await fs.promises.rm(attachmentDir, { recursive: true, force: true });
    throw error;
  }

  return writtenPaths;
}

function startQueuedVoicePreparation(job) {
  return (async () => {
    const audioPaths = await materializeIncomingAudio(job.context);
    try {
      const transcription = await transcribeVoiceNote(audioPaths[0], null);
      return { audioPaths, transcription };
    } catch (error) {
      await cleanupPaths(audioPaths);
      throw error;
    }
  })();
}

async function materializeIncomingAudio(context) {
  if (!context || !Array.isArray(context.audioAttachments) || context.audioAttachments.length === 0) {
    return [];
  }

  const attachmentDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "signal-codex-audio-")
  );
  const writtenPaths = [];

  try {
    for (const attachment of context.audioAttachments) {
      const data = await fetchAttachmentData(context, attachment.id);
      const filePath = path.join(
        attachmentDir,
        buildAttachmentFilename(attachment, writtenPaths.length)
      );
      await fs.promises.writeFile(filePath, Buffer.from(data, "base64"));
      writtenPaths.push(filePath);
    }
  } catch (error) {
    await cleanupPaths(writtenPaths);
    await fs.promises.rm(attachmentDir, { recursive: true, force: true });
    throw error;
  }

  return writtenPaths;
}

async function materializeIncomingFiles(context) {
  if (!context || !Array.isArray(context.fileAttachments) || context.fileAttachments.length === 0) {
    return [];
  }

  const attachmentDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "signal-codex-files-")
  );
  const writtenPaths = [];

  try {
    for (const attachment of context.fileAttachments) {
      const filePath = path.join(
        attachmentDir,
        buildAttachmentFilename(attachment, writtenPaths.length)
      );
      if (isLocalFileAttachment(attachment)) {
        await fs.promises.copyFile(attachment.localPath, filePath);
      } else {
        const data = await fetchAttachmentData(context, attachment.id);
        await fs.promises.writeFile(filePath, Buffer.from(data, "base64"));
      }
      writtenPaths.push(filePath);
    }
  } catch (error) {
    await cleanupPaths(writtenPaths);
    await fs.promises.rm(attachmentDir, { recursive: true, force: true });
    throw error;
  }

  return writtenPaths;
}

async function buildFileAttachmentPromptContext(context, filePaths) {
  const attachments = Array.isArray(context?.fileAttachments) ? context.fileAttachments : [];
  if (attachments.length === 0 || filePaths.length === 0) {
    return { ok: true, promptText: "" };
  }

  const sections = [];
  let totalChars = 0;

  for (let index = 0; index < attachments.length && index < filePaths.length; index += 1) {
    const extracted = await extractSupportedAttachmentText(attachments[index], filePaths[index]);
    if (!extracted.ok) {
      return extracted;
    }

    if (!extracted.text) {
      continue;
    }

    const remainingChars = MAX_TOTAL_FILE_CONTEXT_CHARS - totalChars;
    if (remainingChars <= 0) {
      break;
    }

    const excerpt = truncateText(extracted.text, Math.min(MAX_FILE_EXCERPT_CHARS, remainingChars));
    totalChars += excerpt.length;
    sections.push(formatExtractedAttachmentSection(extracted, excerpt));
  }

  if (sections.length === 0) {
    return {
      ok: false,
      message:
        "I received the file attachment, but could not extract usable text from it. PDFs need embedded text; scanned PDFs and unsupported binary files are not handled yet.",
    };
  }

  return {
    ok: true,
    promptText: `Attached file context:\n\n${sections.join("\n\n")}`,
  };
}

function buildLocalAttachmentPathPromptContext(
  context,
  { imagePaths = [], audioPaths = [], filePaths = [] } = {}
) {
  const lines = [
    "Local attachment paths for this turn only:",
    "These files are temporary and will be deleted automatically after the request completes.",
  ];

  appendAttachmentPathLines(lines, "Image", context?.imageAttachments, imagePaths);
  appendAttachmentPathLines(lines, "Audio", context?.audioAttachments, audioPaths);
  appendAttachmentPathLines(lines, "File", context?.fileAttachments, filePaths);

  return lines.length > 2 ? lines.join("\n") : "";
}

function appendAttachmentPathLines(lines, label, attachments, paths) {
  const attachmentList = Array.isArray(attachments) ? attachments : [];
  const pathList = Array.isArray(paths) ? paths : [];

  for (let index = 0; index < attachmentList.length && index < pathList.length; index += 1) {
    const attachment = attachmentList[index];
    const fileName = normalizeText(attachment?.filename) || path.basename(pathList[index]);
    const contentType = normalizeText(attachment?.contentType) || "unknown";
    lines.push(
      `[${label}] ${fileName} (${contentType}) -> ${pathList[index]}`
    );
  }
}

async function extractSupportedAttachmentText(attachment, filePath) {
  const fileName = normalizeText(attachment?.filename) || path.basename(filePath);
  const contentType = normalizeText(attachment?.contentType).toLowerCase();
  const stat = await fs.promises.stat(filePath);

  if (stat.size > MAX_FILE_ATTACHMENT_BYTES) {
    return {
      ok: false,
      message: `Attached file is too large to process right now: ${fileName} (${formatBytes(
        stat.size
      )}). Limit is ${formatBytes(MAX_FILE_ATTACHMENT_BYTES)}.`,
    };
  }

  if (isPdfAttachment(attachment, filePath)) {
    const pdfText = extractPdfText(filePath);
    if (!pdfText.ok) {
      return {
        ok: false,
        message: `${pdfText.message} File: ${fileName}.`,
      };
    }

    return {
      ok: true,
      fileName,
      contentType: contentType || "application/pdf",
      text: pdfText.text,
    };
  }

  if (isPlainTextAttachment(attachment, filePath)) {
    if (stat.size > MAX_TEXT_ATTACHMENT_BYTES) {
      return {
        ok: false,
        message: `Text attachment is too large to inline right now: ${fileName} (${formatBytes(
          stat.size
        )}). Limit is ${formatBytes(MAX_TEXT_ATTACHMENT_BYTES)}.`,
      };
    }

    const buffer = await fs.promises.readFile(filePath);
    if (looksBinary(buffer)) {
      return {
        ok: false,
        message: `Attached file looks binary and is not supported yet: ${fileName}.`,
      };
    }

    const text = normalizeAttachmentText(buffer.toString("utf8"));
    if (!text) {
      return {
        ok: false,
        message: `Attached text file was empty after decoding: ${fileName}.`,
      };
    }

    return {
      ok: true,
      fileName,
      contentType: contentType || "text/plain",
      text,
    };
  }

  return {
    ok: false,
    message: `Unsupported attachment type for now: ${fileName} (${contentType || "unknown type"}). Supported: PDF, text, markdown, JSON, YAML, CSV, XML, and similar plain-text files.`,
  };
}

function extractPdfText(filePath) {
  if (!fs.existsSync(EXTRACT_PDF_SCRIPT_PATH)) {
    return {
      ok: false,
      message: "No local PDF text extractor helper is installed for this bridge",
    };
  }

  try {
    const output = execFileSync(PDF_EXTRACT_PYTHON_BIN, [EXTRACT_PDF_SCRIPT_PATH, filePath], {
      cwd: PROJECT_DIR,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    if (parsed?.ok && normalizeText(parsed.text)) {
      return { ok: true, text: normalizeAttachmentText(parsed.text) };
    }
    return {
      ok: false,
      message: normalizeText(parsed?.error) || "Failed to extract text from the PDF attachment.",
    };
  } catch (error) {
    try {
      const parsed = JSON.parse(String(error.stdout || ""));
      if (parsed?.error) {
        return {
          ok: false,
          message: normalizeText(parsed.error) || "Failed to extract text from the PDF attachment.",
        };
      }
    } catch (parseError) {
      // fall through to generic error below
    }

    return {
      ok: false,
      message: `Failed to extract text from the PDF attachment.`,
    };
  }
}

function mergePromptSegments(...segments) {
  const normalized = segments.map((segment) => normalizeText(segment)).filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }

  return normalized.join("\n\n");
}

function formatExtractedAttachmentSection(extracted, excerpt) {
  const header = `${extracted.fileName} (${extracted.contentType})`;
  return [`[File] ${header}`, excerpt].filter(Boolean).join("\n");
}

function isPdfAttachment(attachment, filePath) {
  const contentType = normalizeText(attachment?.contentType).toLowerCase();
  const fileName = normalizeText(attachment?.filename) || path.basename(filePath);
  return contentType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function isPlainTextAttachment(attachment, filePath) {
  const contentType = normalizeText(attachment?.contentType).toLowerCase();
  const fileName = normalizeText(attachment?.filename) || path.basename(filePath);
  const extension = path.extname(fileName).toLowerCase();
  const knownTextTypes = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".csv",
    ".tsv",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".sh",
    ".log",
    ".sql",
  ]);

  return (
    contentType.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/x-yaml",
      "application/yaml",
      "application/toml",
      "image/svg+xml",
    ].includes(contentType) ||
    knownTextTypes.has(extension)
  );
}

function normalizeAttachmentText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksBinary(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) {
    return true;
  }

  const decoded = sample.toString("utf8");
  const replacementCount = Array.from(decoded).filter((character) => character === "\uFFFD").length;
  if (replacementCount > 0 && replacementCount / Math.max(decoded.length, 1) > 0.05) {
    return true;
  }

  return /[\u0001-\u0008\u000B\u000C\u000E-\u001A]/.test(decoded);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 1024) {
    return `${value || 0} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fetchAttachmentData(context, attachmentId) {
  const params = { id: attachmentId };
  if (context.groupId) {
    params.groupId = context.groupId;
  } else {
    params.recipient = context.sender;
  }

  return sendSignalRequest("getAttachment", params).then((result) => {
    const data = normalizeText(result?.data);
    if (!data) {
      throw new Error(`signal-cli returned no attachment data for attachment ${attachmentId}`);
    }
    return data;
  });
}

function buildAttachmentFilename(attachment, index) {
  const fileName = sanitizeFilename(attachment?.filename);
  if (fileName) {
    return `${index + 1}-${fileName}`;
  }

  const extension = guessExtensionFromContentType(attachment?.contentType);
  return `attachment-${index + 1}${extension}`;
}

function isLocalImageAttachment(attachment) {
  return Boolean(normalizeText(attachment?.localPath));
}

function isLocalFileAttachment(attachment) {
  return Boolean(normalizeText(attachment?.localPath));
}

function sanitizeFilename(fileName) {
  const normalized = normalizeText(fileName);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function guessExtensionFromContentType(contentType) {
  const normalized = normalizeText(contentType).toLowerCase();
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized === "image/heic") {
    return ".heic";
  }
  if (normalized === "audio/aac") {
    return ".aac";
  }
  if (normalized === "audio/m4a" || normalized === "audio/mp4") {
    return ".m4a";
  }
  if (normalized === "audio/mpeg") {
    return ".mp3";
  }
  if (normalized === "audio/ogg" || normalized === "audio/opus") {
    return ".ogg";
  }
  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    return ".wav";
  }
  if (normalized === "audio/webm") {
    return ".webm";
  }
  if (normalized === "application/pdf") {
    return ".pdf";
  }
  if (normalized === "text/plain") {
    return ".txt";
  }
  if (normalized === "text/markdown") {
    return ".md";
  }
  if (normalized === "application/json") {
    return ".json";
  }
  if (normalized === "application/xml" || normalized === "text/xml") {
    return ".xml";
  }
  if (normalized === "text/csv") {
    return ".csv";
  }
  if (normalized === "application/x-yaml" || normalized === "application/yaml") {
    return ".yaml";
  }
  return ".bin";
}

function discoverScheduledWorkflowImageAttachments(workflowPrompt) {
  const prompt = normalizeText(workflowPrompt);
  if (!prompt) {
    return [];
  }

  const matchedPaths = extractExistingAbsolutePaths(prompt);
  if (matchedPaths.length === 0) {
    return [];
  }

  const discovered = [];
  let totalBytes = 0;

  for (const targetPath of matchedPaths) {
    for (const imagePath of expandWorkflowImagePaths(targetPath)) {
      if (discovered.length >= MAX_SCHEDULED_LOCAL_IMAGES) {
        return discovered;
      }

      let stat;
      try {
        stat = fs.statSync(imagePath);
      } catch (error) {
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }
      if (stat.size > MAX_SCHEDULED_LOCAL_IMAGE_BYTES) {
        continue;
      }
      if (totalBytes + stat.size > MAX_SCHEDULED_LOCAL_IMAGE_TOTAL_BYTES) {
        return discovered;
      }

      totalBytes += stat.size;
      discovered.push({
        id: `local:${imagePath}`,
        filename: path.basename(imagePath),
        contentType: guessContentTypeFromFilename(imagePath),
        localPath: imagePath,
      });
    }
  }

  return discovered;
}

function discoverScheduledWorkflowFileAttachments(workflowPrompt) {
  const prompt = normalizeText(workflowPrompt);
  if (!prompt) {
    return [];
  }

  const matchedPaths = extractExistingAbsolutePaths(prompt);
  if (matchedPaths.length === 0) {
    return [];
  }

  const discovered = [];

  for (const targetPath of matchedPaths) {
    for (const filePath of expandWorkflowFilePaths(targetPath)) {
      discovered.push({
        id: `local:${filePath}`,
        filename: path.basename(filePath),
        contentType: guessContentTypeFromFilename(filePath),
        localPath: filePath,
      });
    }
  }

  return discovered;
}

function extractExistingAbsolutePaths(text) {
  const matches = text.match(/\/[A-Za-z0-9._~\-\/]+/g) || [];
  const uniquePaths = new Set();

  for (const match of matches) {
    const candidate = match.replace(/[.,;:)\]]+$/g, "");
    if (candidate && fs.existsSync(candidate)) {
      uniquePaths.add(candidate);
    }
  }

  return [...uniquePaths];
}

function expandWorkflowImagePaths(targetPath) {
  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (error) {
    return [];
  }

  if (stat.isFile()) {
    return isSupportedLocalImagePath(targetPath) ? [targetPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const assetDirectories = [];
  if (path.basename(targetPath) === "assets") {
    assetDirectories.push(targetPath);
  }

  const nestedAssetsPath = path.join(targetPath, "raw", "assets");
  if (fs.existsSync(nestedAssetsPath)) {
    assetDirectories.push(nestedAssetsPath);
  }
  const nestedInboxPath = path.join(targetPath, "raw", "inbox");
  if (fs.existsSync(nestedInboxPath)) {
    assetDirectories.push(nestedInboxPath);
  }

  const directChildren = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of directChildren) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childInboxPath = path.join(targetPath, entry.name, "raw", "inbox");
    if (fs.existsSync(childInboxPath)) {
      assetDirectories.push(childInboxPath);
    }
    const childAssetsPath = path.join(targetPath, entry.name, "raw", "assets");
    if (fs.existsSync(childAssetsPath)) {
      assetDirectories.push(childAssetsPath);
    }
  }

  const uniqueAssetDirectories = [...new Set(assetDirectories)];
  return uniqueAssetDirectories
    .flatMap((directoryPath) => listLocalImageFiles(directoryPath))
    .sort((left, right) => {
      try {
        return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
      } catch (error) {
        return 0;
      }
    });
}

function listLocalImageFiles(rootPath) {
  const results = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && isSupportedLocalImagePath(entryPath)) {
        results.push(entryPath);
      }
    }
  }

  return results;
}

function expandWorkflowFilePaths(targetPath) {
  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (error) {
    return [];
  }

  if (stat.isFile()) {
    return isSupportedLocalFilePath(targetPath) ? [targetPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const inboxDirectories = [];
  if (path.basename(targetPath) === "inbox") {
    inboxDirectories.push(targetPath);
  }

  const nestedInboxPath = path.join(targetPath, "raw", "inbox");
  if (fs.existsSync(nestedInboxPath)) {
    inboxDirectories.push(nestedInboxPath);
  }

  const directChildren = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of directChildren) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childInboxPath = path.join(targetPath, entry.name, "raw", "inbox");
    if (fs.existsSync(childInboxPath)) {
      inboxDirectories.push(childInboxPath);
    }
  }

  const uniqueInboxDirectories = [...new Set(inboxDirectories)];
  return uniqueInboxDirectories
    .flatMap((directoryPath) => listLocalFiles(directoryPath))
    .filter((filePath) => isSupportedLocalFilePath(filePath))
    .sort((left, right) => {
      try {
        return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
      } catch (error) {
        return 0;
      }
    });
}

function listLocalFiles(rootPath) {
  const results = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(entryPath);
      }
    }
  }

  return results;
}

function isSupportedLocalImagePath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".jpg"
    || extension === ".jpeg"
    || extension === ".png"
    || extension === ".gif"
    || extension === ".webp"
    || extension === ".heic";
}

function isSupportedLocalFilePath(filePath) {
  if (isSupportedLocalImagePath(filePath)) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  const knownFileTypes = new Set([
    ".pdf",
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".csv",
    ".tsv",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".sh",
    ".log",
    ".sql",
  ]);

  return knownFileTypes.has(extension);
}

function guessContentTypeFromFilename(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".heic") {
    return "image/heic";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }
  if (extension === ".txt" || extension === ".log") {
    return "text/plain";
  }
  if (extension === ".json" || extension === ".jsonl") {
    return "application/json";
  }
  if (extension === ".yaml" || extension === ".yml") {
    return "application/yaml";
  }
  if (extension === ".xml") {
    return "application/xml";
  }
  if (extension === ".csv" || extension === ".tsv") {
    return "text/csv";
  }
  return "image/png";
}

function transcribeVoiceNote(audioPath, jobControl = null) {
  return new Promise((resolve, reject) => {
    const modelArg =
      VOICE_NOTES_MODEL_PATH && fs.existsSync(VOICE_NOTES_MODEL_PATH)
        ? VOICE_NOTES_MODEL_PATH
        : VOICE_NOTES_MODEL;
    const child = spawn(
      TRANSCRIBE_PYTHON_BIN,
      [
        TRANSCRIBE_SCRIPT_PATH,
        "--input",
        audioPath,
        "--model",
        modelArg,
        "--language",
        VOICE_NOTES_LANGUAGE,
        "--beam-size",
        String(VOICE_NOTES_BEAM_SIZE),
        "--compute-type",
        VOICE_NOTES_COMPUTE_TYPE,
        "--local-only",
      ],
      {
        cwd: PROJECT_DIR,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    let didFinish = false;
    let timeout = null;

    const unregisterCancellation = registerCancellationHandler(jobControl, (error) => {
      if (didFinish) {
        return;
      }
      didFinish = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      reject(error);
    });

    function cleanup() {
      clearTimeout(timeout);
      unregisterCancellation();
    }

    timeout = setTimeout(() => {
      if (didFinish) {
        return;
      }
      didFinish = true;
      child.kill("SIGTERM");
      cleanup();
      reject(new Error("Voice transcription timed out."));
    }, VOICE_NOTES_TIMEOUT_SEC * 1000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (didFinish) {
        return;
      }
      didFinish = true;
      cleanup();
      reject(new Error(`Voice transcription failed: ${error.message}`));
    });

    child.on("exit", (code, signal) => {
      if (didFinish) {
        cleanup();
        return;
      }

      didFinish = true;
      cleanup();

      if (signal === "SIGTERM" && jobControl?.cancelled) {
        reject(jobControl.reason || new CancellationError());
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Voice transcription failed: ${
              normalizeText(stderr) || `process exited with code ${code}`
            }`
          )
        );
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (parseError) {
        reject(new Error("Voice transcription returned invalid JSON."));
        return;
      }

      if (!parsed?.ok) {
        reject(new Error(normalizeText(parsed?.error) || "Voice transcription failed."));
        return;
      }

      resolve(parsed);
    });
  });
}

function formatVoiceTranscriptMessage(transcription) {
  return normalizeText(transcription?.transcript);
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
  const obsidianServerLine = obsidianLinkServerAddress
    ? `obsidian links: listening on ${OBSIDIAN_LINK_SERVER_HOST}:${obsidianLinkServerAddress.port}`
    : `obsidian links: ${OBSIDIAN_LINKS_ENABLED ? "starting or unavailable" : "disabled"}`;
  const obsidianBaseUrlLine = OBSIDIAN_BASE_URL
    ? `obsidian base url: ${OBSIDIAN_BASE_URL}`
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
    `auth: ${summarizePendingPluginAuth(state.pendingPluginAuth)}`,
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

function summarizePendingPluginAuth(pendingPluginAuth) {
  if (!pendingPluginAuth) {
    return "none";
  }

  return `${pendingPluginAuth.displayName} ${pendingPluginAuth.status}`;
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
  const formattedText = rewriteMarkdownDocumentReferencesForSignal(text);
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

function updateSignalProfileAvatar({ avatarPath = "", remove = false } = {}) {
  if (remove) {
    return sendSignalRequest("updateProfile", {
      removeAvatar: true,
    });
  }

  const normalizedPath = normalizeText(avatarPath);
  if (!normalizedPath) {
    return Promise.reject(new Error("Missing avatar path."));
  }

  return sendSignalRequest("updateProfile", {
    avatar: normalizedPath,
  });
}

function sendSignalRequest(method, params) {
  if (TEST_SIGNAL_LOG_PATH) {
    appendTestSignalLog({
      direction: "request",
      message: {
        jsonrpc: "2.0",
        method,
        params,
      },
    });

    if (method === "getAttachment") {
      const attachment = getTestAttachmentMap()[params?.id];
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
  const imageLabel = imageCount > 0 ? ` [images=${imageCount}]` : "";
  console.log(`[${timestamp()}] IN  ${sender}${imageLabel}: ${message}`);
}

function logOutgoing(recipient, message, chunkNumber, totalChunks) {
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
  if (obsidianLinkServer) {
    try {
      obsidianLinkServer.close();
    } catch (error) {
      console.error(`[${timestamp()}] Failed closing Obsidian link server: ${error.message}`);
    }
  }
  rejectAllPendingSignalRequests(new Error("Bridge shutting down"));
  if (signalProcess && !signalProcess.killed) {
    signalProcess.kill("SIGTERM");
  }
  process.exit(0);
}
