"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  discoverKbFiles,
  loadAutotweetConfig,
} = require("./config");
const { createInstanceConfig } = require("../instance/instance-config");
const {
  buildDraftPayload,
  typefullyRequest,
} = require("./typefully-cli");
const {
  listReadySuggestions,
  markSuggestionsDrafted,
} = require("./suggestions");
const {
  createBridgeCodexClient,
} = require("../../apps/signal-bridge/bridge-codex-client");

const DEFAULT_RUNTIME_PATHS = getDefaultAutotweetRuntimePaths({ env: {} });
const DEFAULT_CODEX_CWD = DEFAULT_RUNTIME_PATHS.codexCwd;
const DEFAULT_PROJECT_DIR = DEFAULT_RUNTIME_PATHS.projectDir;
const DEFAULT_APP_SERVER_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RUN_LOG_DIR = DEFAULT_RUNTIME_PATHS.runLogDir;
const DEFAULT_HISTORY_PATH = path.join(DEFAULT_RUN_LOG_DIR, "history.jsonl");
const DEFAULT_LAST_RUN_PATH = path.join(DEFAULT_RUN_LOG_DIR, "last-run.json");
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_CODEX_STATE_ROOT = "/tmp/sable-autotweet-codex";

async function main() {
  const startedAt = new Date().toISOString();
  const runRecord = {
    startedAt,
    completedAt: "",
    ok: false,
    skipped: false,
    reason: "",
    selectedSuggestionIds: [],
    queuedDraftCount: 0,
    queuedTypefullyIds: [],
    errors: [],
  };

  try {
    const config = loadAutotweetConfig();
    if (!config.enabled) {
      runRecord.skipped = true;
      runRecord.reason = "config disabled";
      return;
    }

    const socialSetId = normalizeText(process.env.TYPEFULLY_SOCIAL_SET_ID);
    const apiKey = normalizeText(process.env.TYPEFULLY_API_KEY);
    if (!socialSetId || !apiKey) {
      runRecord.skipped = true;
      runRecord.reason = "missing Typefully credentials";
      return;
    }

    if (styleGuideLooksPlaceholder(config.styleGuideFiles)) {
      runRecord.skipped = true;
      runRecord.reason = "style guide still looks placeholder-only";
      return;
    }

    const suggestionFilePath = config.suggestionFiles[0];
    const readySuggestions = listReadySuggestions(suggestionFilePath);
    if (readySuggestions.length === 0) {
      runRecord.skipped = true;
      runRecord.reason = "no ready suggestions";
      return;
    }

    const selectedSuggestions = readySuggestions.slice(0, Math.max(1, Math.min(readySuggestions.length, config.draftCount)));
    runRecord.selectedSuggestionIds = selectedSuggestions.map((entry) => entry.id);

    const prompt = buildDraftPrompt({
      config,
      selectedSuggestions,
      contextPacket: buildContextPacket(config, selectedSuggestions),
    });

    const responseText = await runCodexPrompt(prompt);
    const generatedDrafts = normalizeGeneratedDrafts(extractJsonArrayFromText(responseText));
    if (generatedDrafts.length === 0) {
      throw new Error("Codex returned no valid drafts.");
    }

    const queuedTypefullyIds = [];
    for (const draft of generatedDrafts) {
      const payload = buildDraftPayload(draft, {
        platforms: config.platforms,
      });
      const response = await typefullyRequest(
        `/v2/social-sets/${socialSetId}/drafts`,
        {
          method: "POST",
          body: payload,
        }
      );
      if (response?.id) {
        queuedTypefullyIds.push(response.id);
      }
    }

    const consumedSuggestionIds = dedupeStrings(
      generatedDrafts.map((draft) => draft.suggestion_id).filter(Boolean)
    );
    if (consumedSuggestionIds.length > 0) {
      markSuggestionsDrafted(suggestionFilePath, consumedSuggestionIds, {
        draftedAt: new Date().toISOString(),
        draftNotes: queuedTypefullyIds.length
          ? `Queued in Typefully: ${queuedTypefullyIds.join(", ")}`
          : "Queued in Typefully",
      });
    }

    runRecord.ok = true;
    runRecord.queuedDraftCount = generatedDrafts.length;
    runRecord.queuedTypefullyIds = queuedTypefullyIds;
    runRecord.reason = "queued drafts successfully";
  } catch (error) {
    runRecord.errors.push(error.message || String(error));
    runRecord.reason = runRecord.reason || "draft cycle failed";
    throw error;
  } finally {
    runRecord.completedAt = new Date().toISOString();
    await writeRunLog(runRecord);
  }
}

function getDefaultAutotweetRuntimePaths({ env = process.env, homeDir = "", repoRoot = "" } = {}) {
  const instance = createInstanceConfig({ env, homeDir, repoRoot });
  const runLogDir = path.join(instance.autotweetRoot, "run-logs");
  return {
    codexCwd: instance.repoRoot,
    projectDir: path.join(instance.repoRoot, "apps", "signal-bridge"),
    runLogDir,
    historyPath: path.join(runLogDir, "history.jsonl"),
    lastRunPath: path.join(runLogDir, "last-run.json"),
  };
}

function buildContextPacket(config, selectedSuggestions) {
  const sections = [
    "# Autotweet Context Packet",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Queue mode: ${config.queueMode}`,
    `Platforms: ${config.platforms.join(", ") || "x"}`,
    `Target draft count: ${config.draftCount}`,
    "",
    "## Selected Suggestions",
  ];

  for (const suggestion of selectedSuggestions) {
    sections.push("");
    sections.push(`### ${suggestion.id}`);
    sections.push(`- title: ${suggestion.title}`);
    sections.push(`- angle: ${suggestion.angle}`);
    if (normalizeText(suggestion.why_now)) {
      sections.push(`- why_now: ${suggestion.why_now}`);
    }
    appendListBlock(sections, "structure_hint", suggestion.structure_hint);
    appendListBlock(sections, "research_needed", suggestion.research_needed);
    appendListBlock(sections, "constraints", suggestion.constraints);
  }

  sections.push("");
  sections.push("## Knowledge Bases");

  for (const kbPath of filterKnowledgeBasesForSuggestions(config.knowledgeBases, selectedSuggestions)) {
    sections.push("");
    sections.push(`### ${kbPath}`);
    const files = discoverKbFiles(kbPath, {
      maxFilesPerKb: config.maxFilesPerKb,
      maxCharsPerFile: config.maxCharsPerFile,
    });

    if (files.length === 0) {
      sections.push("- No readable KB files found.");
      continue;
    }

    for (const file of files) {
      sections.push("");
      sections.push(`#### ${path.relative(kbPath, file.path) || path.basename(file.path)}`);
      sections.push("```md");
      sections.push(file.content.trim());
      sections.push("```");
    }
  }

  sections.push("");
  sections.push("## Style Guide Files");
  appendFileSections(sections, config.styleGuideFiles, config.maxCharsPerFile);

  sections.push("");
  sections.push("## Question Files");
  appendFileSections(sections, config.questionFiles, config.maxCharsPerFile);

  return sections.join("\n");
}

function filterKnowledgeBasesForSuggestions(knowledgeBases, selectedSuggestions) {
  const preferredSlugs = new Set(
    selectedSuggestions.flatMap((suggestion) => Array.isArray(suggestion.source_kbs) ? suggestion.source_kbs : [])
  );
  if (preferredSlugs.size === 0) {
    return knowledgeBases;
  }

  const filtered = knowledgeBases.filter((kbPath) => preferredSlugs.has(path.basename(kbPath)));
  return filtered.length > 0 ? filtered : knowledgeBases;
}

function appendFileSections(sections, filePaths, maxCharsPerFile) {
  for (const filePath of filePaths) {
    sections.push("");
    sections.push(`### ${filePath}`);
    if (!fs.existsSync(filePath)) {
      sections.push("- Missing");
      continue;
    }

    sections.push("```md");
    sections.push(fs.readFileSync(filePath, "utf8").slice(0, maxCharsPerFile).trim());
    sections.push("```");
  }
}

function appendListBlock(sections, key, values) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  if (normalizedValues.length === 0) {
    return;
  }

  sections.push(`- ${key}:`);
  for (const value of normalizedValues) {
    sections.push(`  - ${value}`);
  }
}

function buildDraftPrompt({ config, selectedSuggestions, contextPacket }) {
  return [
    "You are generating draft tweets for Arya.",
    "",
    "Requirements:",
    "- Use only the supplied context packet and selected suggestions.",
    "- Be truthful, technically precise, and balanced about tradeoffs.",
    "- Do not sound like AI slop.",
    "- Return JSON only. No markdown fences. No prose before or after the JSON.",
    "- Generate up to the configured draft count total, not per suggestion.",
    "- Every returned draft must include `suggestion_id` matching one of the selected suggestions.",
    "- Use either `{ \"suggestion_id\": \"...\", \"text\": \"...\" }` for a single post or `{ \"suggestion_id\": \"...\", \"posts\": [{\"text\":\"...\"}, ...] }` for a thread.",
    "- Do not include any keys other than `suggestion_id`, `text`, and `posts`.",
    "",
    `Selected suggestion ids: ${selectedSuggestions.map((entry) => entry.id).join(", ")}`,
    `Draft count ceiling: ${config.draftCount}`,
    "",
    contextPacket,
  ].join("\n");
}

async function runCodexPrompt(prompt) {
  const envSource = buildCodexEnvSource();
  const runtimePaths = getDefaultAutotweetRuntimePaths();
  const codexClient = createBridgeCodexClient({
    spawn,
    cwd: runtimePaths.codexCwd,
    projectDir: runtimePaths.projectDir,
    signalReplyToEnv: "SABLE_SIGNAL_REPLY_TO",
    signalBridgeDirEnv: "SABLE_SIGNAL_BRIDGE_DIR",
    appServerClientVersion: "1.0.0",
    appServerRequestTimeoutMs: DEFAULT_APP_SERVER_TIMEOUT_MS,
    normalizeText,
    timestamp: () => new Date().toISOString(),
    appendTestAppServerLog: () => {},
    onStderr: () => {},
    envSource,
  });

  let finalMessage = "";
  let turnCompleted = false;
  const timeoutMs = DEFAULT_APP_SERVER_TIMEOUT_MS;

  return new Promise(async (resolve, reject) => {
    const client = codexClient.createAppServerClient({
      onNotification: handleCodexNotification,
      onServerRequest: handleCodexServerRequest,
      replyRecipient: "",
    });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("autotweet Codex turn timed out"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      client.close();
    }

    function handleCodexNotification(message) {
      if (message.method === "item/started" || message.method === "item/completed") {
        finalMessage = handleDraftingItem(message?.params?.item, finalMessage);
      }

      if (message.method === "turn/completed") {
        turnCompleted = true;
        cleanup();
        resolve(finalMessage);
      }
    }

    async function handleCodexServerRequest(message) {
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
        return { answers: {} };
      }
      if (message.method === "mcpServer/elicitation/request") {
        return { action: "cancel" };
      }
      return {};
    }

    try {
      await client.initialize();
      const threadResponse = await client.request("thread/start", {
        cwd: runtimePaths.codexCwd,
        approvalPolicy: "never",
        approvalsReviewer: "guardian_subagent",
        personality: "pragmatic",
        model: DEFAULT_MODEL,
      });
      const threadId = normalizeText(threadResponse?.thread?.id) || normalizeText(threadResponse?.threadId);
      if (!threadId) {
        throw new Error("Failed to obtain Codex thread id for autotweet drafting.");
      }

      await client.request("turn/start", {
        threadId,
        cwd: runtimePaths.codexCwd,
        approvalPolicy: "never",
        approvalsReviewer: "guardian_subagent",
        personality: "pragmatic",
        model: DEFAULT_MODEL,
        input: [{ type: "text", text: prompt }],
      });
    } catch (error) {
      if (!turnCompleted) {
        cleanup();
        reject(error);
      }
    }
  });
}

function handleDraftingItem(item, currentFinalMessage) {
  if (!item || typeof item !== "object") {
    return currentFinalMessage;
  }

  if (item.type !== "agentMessage") {
    return currentFinalMessage;
  }

  const text = normalizeText(item.text);
  return text || currentFinalMessage;
}

function buildCodexEnvSource() {
  const explicitCodexHome = normalizeText(process.env.CODEX_HOME);
  if (explicitCodexHome) {
    return { ...process.env };
  }

  const root = DEFAULT_CODEX_STATE_ROOT;
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  fs.mkdirSync(path.join(root, "xdg", "state"), { recursive: true });
  fs.mkdirSync(path.join(root, "xdg", "cache"), { recursive: true });
  fs.mkdirSync(path.join(root, "xdg", "config"), { recursive: true });
  return {
    ...process.env,
    CODEX_HOME: path.join(root, "home"),
    XDG_STATE_HOME: path.join(root, "xdg", "state"),
    XDG_CACHE_HOME: path.join(root, "xdg", "cache"),
    XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
  };
}

function extractJsonArrayFromText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    throw new Error("Codex returned an empty draft payload.");
  }

  const fenceMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : normalized;
  const startIndex = candidate.indexOf("[");
  const endIndex = candidate.lastIndexOf("]");
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Codex did not return a JSON array: ${truncateText(normalized, 400)}`);
  }

  const jsonSlice = candidate.slice(startIndex, endIndex + 1);
  return JSON.parse(jsonSlice);
}

function normalizeGeneratedDrafts(value) {
  if (!Array.isArray(value)) {
    throw new Error("Codex draft output must be a JSON array.");
  }

  return value
    .map((entry) => {
      const suggestionId = normalizeText(entry?.suggestion_id);
      const text = normalizeText(entry?.text);
      const posts = Array.isArray(entry?.posts)
        ? entry.posts
            .map((post) => ({ text: normalizeText(post?.text) }))
            .filter((post) => post.text)
        : [];

      if (!suggestionId) {
        return null;
      }

      if (text) {
        return { suggestion_id: suggestionId, text };
      }

      if (posts.length > 0) {
        return { suggestion_id: suggestionId, posts };
      }

      return null;
    })
    .filter(Boolean);
}

function styleGuideLooksPlaceholder(styleGuideFiles) {
  return styleGuideFiles.some((filePath) => {
    if (!fs.existsSync(filePath)) {
      return true;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return /placeholder only/i.test(raw);
  });
}

async function writeRunLog(runRecord) {
  const runtimePaths = getDefaultAutotweetRuntimePaths();
  fs.mkdirSync(runtimePaths.runLogDir, { recursive: true });
  fs.writeFileSync(runtimePaths.lastRunPath, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
  fs.appendFileSync(runtimePaths.historyPath, `${JSON.stringify(runRecord)}\n`, "utf8");
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

function truncateText(text, maxLength) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  buildContextPacket,
  buildDraftPrompt,
  extractJsonArrayFromText,
  getDefaultAutotweetRuntimePaths,
  handleDraftingItem,
  normalizeGeneratedDrafts,
  styleGuideLooksPlaceholder,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
