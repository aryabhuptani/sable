"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONFIG_PATH = "/home/arya/memory/knowledge/projects/sable/autotweet/CONFIG.md";
const DEFAULT_STYLE_GUIDE_PATH = "/home/arya/memory/knowledge/projects/sable/autotweet/STYLE_GUIDE.md";
const DEFAULT_QUESTION_BANK_PATH =
  "/home/arya/memory/knowledge/projects/sable/autotweet/QUESTION_BANK.md";
const DEFAULT_SUGGESTIONS_PATH =
  "/home/arya/memory/knowledge/projects/sable/autotweet/SUGGESTIONS.md";

function loadAutotweetConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = fs.readFileSync(configPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);

  return {
    path: configPath,
    body,
    enabled: toBoolean(frontmatter.enabled, false),
    draftCount: toInteger(frontmatter.draft_count, 5),
    maxFilesPerKb: toInteger(frontmatter.max_files_per_kb, 8),
    maxCharsPerFile: toInteger(frontmatter.max_chars_per_file, 4_000),
    platforms: toStringArray(frontmatter.platforms, ["x"]),
    knowledgeBases: toStringArray(frontmatter.knowledge_bases, []),
    questionFiles: toStringArray(frontmatter.question_files, [DEFAULT_QUESTION_BANK_PATH]),
    styleGuideFiles: toStringArray(frontmatter.style_guide_files, [DEFAULT_STYLE_GUIDE_PATH]),
    suggestionFiles: toStringArray(frontmatter.suggestion_files, [DEFAULT_SUGGESTIONS_PATH]),
    queueMode: normalizeText(frontmatter.queue_mode) || "draft",
  };
}

function parseFrontmatter(raw) {
  const normalized = typeof raw === "string" ? raw : "";
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5);
  return {
    frontmatter: parseSimpleYaml(frontmatterBlock),
    body,
  };
}

function parseSimpleYaml(raw) {
  const result = {};
  let currentListKey = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentListKey) {
      result[currentListKey].push(parseScalar(listMatch[1].trim()));
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      currentListKey = null;
      continue;
    }

    const [, key, value] = keyMatch;
    if (!value) {
      result[key] = [];
      currentListKey = key;
      continue;
    }

    result[key] = parseScalar(value.trim());
    currentListKey = null;
  }

  return result;
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return value.replace(/^["']|["']$/g, "");
}

function toBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function toInteger(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function toStringArray(value, fallback) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [...fallback];
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function discoverKbFiles(kbPath, { maxFilesPerKb, maxCharsPerFile }) {
  const resolvedKbPath = normalizeText(kbPath);
  if (!resolvedKbPath) {
    return [];
  }

  const candidates = [
    path.join(resolvedKbPath, "KB.md"),
    path.join(resolvedKbPath, "wiki", "index.md"),
    ...listMarkdownFiles(path.join(resolvedKbPath, "wiki", "notes")),
  ];

  return candidates
    .filter((filePath) => fs.existsSync(filePath))
    .slice(0, maxFilesPerKb)
    .map((filePath) => ({
      path: filePath,
      content: fs.readFileSync(filePath, "utf8").slice(0, maxCharsPerFile),
    }));
}

function listMarkdownFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort();
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_QUESTION_BANK_PATH,
  DEFAULT_SUGGESTIONS_PATH,
  DEFAULT_STYLE_GUIDE_PATH,
  discoverKbFiles,
  loadAutotweetConfig,
  parseFrontmatter,
};
