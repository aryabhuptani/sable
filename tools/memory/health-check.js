#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { createInstanceConfig } = require("../instance/instance-config");

const DEFAULT_STALE_DAYS = 14;
const DEFAULT_LARGE_FILE_LINES = 220;

function parseArgs(argv) {
  const options = {
    format: "text",
    memoryRoot: "",
    now: "",
    staleDays: DEFAULT_STALE_DAYS,
    largeFileLines: DEFAULT_LARGE_FILE_LINES,
    writeDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--memory-root") {
      options.memoryRoot = path.resolve(argv[++index] || "");
    } else if (arg === "--format") {
      options.format = argv[++index] || "text";
    } else if (arg === "--now") {
      options.now = argv[++index] || "";
    } else if (arg === "--stale-days") {
      options.staleDays = Number.parseInt(argv[++index] || "", 10);
    } else if (arg === "--large-file-lines") {
      options.largeFileLines = Number.parseInt(argv[++index] || "", 10);
    } else if (arg === "--write-dir") {
      options.writeDir = path.resolve(argv[++index] || "");
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json.");
  }
  if (!Number.isInteger(options.staleDays) || options.staleDays < 1) {
    throw new Error("--stale-days must be a positive integer.");
  }
  if (!Number.isInteger(options.largeFileLines) || options.largeFileLines < 1) {
    throw new Error("--large-file-lines must be a positive integer.");
  }

  return options;
}

function runHealthCheck({
  memoryRoot = createInstanceConfig().memoryRoot,
  now = new Date(),
  staleDays = DEFAULT_STALE_DAYS,
  largeFileLines = DEFAULT_LARGE_FILE_LINES,
} = {}) {
  const resolvedMemoryRoot = path.resolve(memoryRoot);
  const files = listFiles(resolvedMemoryRoot);
  const markdownFiles = files.filter((filePath) => filePath.endsWith(".md"));
  const completedRunsInActive = findCompletedRunsInActive(resolvedMemoryRoot);
  const staleActiveFiles = findStaleActiveFiles(markdownFiles, now, staleDays);
  const oversizedActiveFilesWithoutSummary = findOversizedActiveFilesWithoutSummary(
    markdownFiles,
    largeFileLines
  );
  const brokenLocalLinks = findBrokenLocalLinks(markdownFiles);
  const missingArchitectureFiles = findMissingArchitectureFiles(resolvedMemoryRoot);

  const summary = {
    completed_runs_in_active: completedRunsInActive.length,
    stale_active_files: staleActiveFiles.length,
    oversized_active_files_without_summary: oversizedActiveFilesWithoutSummary.length,
    broken_local_links: brokenLocalLinks.length,
    missing_architecture_files: missingArchitectureFiles.length,
    total_findings:
      completedRunsInActive.length +
      staleActiveFiles.length +
      oversizedActiveFilesWithoutSummary.length +
      brokenLocalLinks.length +
      missingArchitectureFiles.length,
  };

  return {
    checked_at: now.toISOString(),
    memory_root: resolvedMemoryRoot,
    thresholds: {
      stale_days: staleDays,
      large_file_lines: largeFileLines,
    },
    summary,
    findings: {
      completed_runs_in_active: completedRunsInActive,
      stale_active_files: staleActiveFiles,
      oversized_active_files_without_summary: oversizedActiveFilesWithoutSummary,
      broken_local_links: brokenLocalLinks,
      missing_architecture_files: missingArchitectureFiles,
    },
  };
}

function listFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const result = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".obsidian") {
        continue;
      }
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
      } else if (entry.isFile()) {
        result.push(target);
      }
    }
  }
  return result.sort();
}

function findCompletedRunsInActive(memoryRoot) {
  const researchRoot = path.join(memoryRoot, "knowledge", "research");
  const stateFiles = listFiles(researchRoot).filter((filePath) =>
    filePath.includes(`${path.sep}autoresearch${path.sep}active${path.sep}`) &&
    path.basename(filePath) === "STATE.json"
  );
  const findings = [];
  for (const statePath of stateFiles) {
    const state = readJson(statePath);
    if (normalizeText(state?.status).toLowerCase() !== "completed") {
      continue;
    }
    findings.push({
      path: statePath,
      run_dir: path.dirname(statePath),
      status: state.status,
      recommendation: "Move completed run from active to archive while preserving provenance.",
    });
  }
  return findings;
}

function findStaleActiveFiles(markdownFiles, now, staleDays) {
  const cutoffMs = now.getTime() - staleDays * 24 * 60 * 60 * 1000;
  return markdownFiles
    .filter(isActiveMemoryFile)
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        modified_at: stat.mtime.toISOString(),
        age_days: Math.floor((now.getTime() - stat.mtime.getTime()) / (24 * 60 * 60 * 1000)),
      };
    })
    .filter((item) => new Date(item.modified_at).getTime() < cutoffMs);
}

function findOversizedActiveFilesWithoutSummary(markdownFiles, largeFileLines) {
  return markdownFiles
    .filter(isActiveMemoryFile)
    .map((filePath) => {
      const text = readText(filePath);
      const lines = text.split(/\r?\n/).length;
      return {
        path: filePath,
        line_count: lines,
        has_summary: /^##\s+(Summary|Current State)\s*$/im.test(text),
      };
    })
    .filter((item) => item.line_count >= largeFileLines && !item.has_summary);
}

function findBrokenLocalLinks(markdownFiles) {
  const findings = [];
  const markdownIndex = buildMarkdownIndex(markdownFiles);
  for (const filePath of markdownFiles) {
    const text = readText(filePath);
    for (const link of extractMarkdownLinks(text)) {
      const resolution = resolveLocalLink(filePath, link, markdownIndex);
      if (!resolution || resolution.exists) {
        continue;
      }
      findings.push({ path: filePath, link, target: resolution.target });
    }
  }
  return findings;
}

function buildMarkdownIndex(markdownFiles) {
  const index = new Map();
  for (const filePath of markdownFiles) {
    const basename = path.basename(filePath).toLowerCase();
    const stem = basename.replace(/\.md$/i, "");
    addToIndex(index, basename, filePath);
    addToIndex(index, stem, filePath);
  }
  return index;
}

function addToIndex(index, key, filePath) {
  const existing = index.get(key) || [];
  existing.push(filePath);
  index.set(key, existing);
}

function extractMarkdownLinks(text) {
  const links = [];
  const markdownLinkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  const wikiLinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;

  while ((match = markdownLinkPattern.exec(text))) {
    links.push(match[1].trim());
  }
  while ((match = wikiLinkPattern.exec(text))) {
    links.push(`${match[1].trim()}.md`);
  }
  return links;
}

function resolveLocalLink(sourcePath, link, markdownIndex = new Map()) {
  if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("#")) {
    return null;
  }
  const withoutAnchor = link.split("#")[0].trim();
  if (!withoutAnchor || withoutAnchor.startsWith("mailto:")) {
    return null;
  }
  const decoded = stripLineSuffix(decodeURIComponent(withoutAnchor));
  const directTarget = path.isAbsolute(decoded)
    ? decoded
    : path.resolve(path.dirname(sourcePath), decoded);
  if (fs.existsSync(directTarget)) {
    return { exists: true, target: directTarget };
  }

  const lookupKey = path.basename(decoded.endsWith(".md") ? decoded : `${decoded}.md`).toLowerCase();
  const matches = markdownIndex.get(lookupKey) || markdownIndex.get(lookupKey.replace(/\.md$/i, ""));
  if (matches?.length) {
    return { exists: true, target: matches[0] };
  }

  return { exists: false, target: directTarget };
}

function stripLineSuffix(linkTarget) {
  return linkTarget.replace(/(:\d+)(?=$|[#?])/i, "");
}

function findMissingArchitectureFiles(memoryRoot) {
  return [
    path.join(memoryRoot, "README.md"),
    path.join(memoryRoot, "knowledge", "projects", "memory", "ARCHITECTURE.md"),
    path.join(memoryRoot, "knowledge", "projects", "memory", "ARCHITECTURE_LOG.md"),
  ]
    .filter((filePath) => !fs.existsSync(filePath))
    .map((filePath) => ({
      path: filePath,
      recommendation: "Create the memory architecture file so future agents can inspect the current memory protocol.",
    }));
}

function isActiveMemoryFile(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  if (!normalized.endsWith(".md")) {
    return false;
  }
  if (
    /\/(archive|archived|progress|raw|processed|outputs|run-logs|background-jobs)\//i.test(
      normalized
    )
  ) {
    return false;
  }
  if (/\/LOG\.md$/i.test(normalized)) {
    return false;
  }
  return /\/memory\/(tasks|knowledge)\//.test(normalized);
}

function renderMarkdownReport(report) {
  const lines = [
    "# Memory Health",
    "",
    `Checked: ${report.checked_at}`,
    `Memory root: ${report.memory_root}`,
    "",
    "## Summary",
    "",
  ];
  for (const [key, value] of Object.entries(report.summary)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");

  for (const [key, findings] of Object.entries(report.findings)) {
    lines.push(`## ${key}`);
    lines.push("");
    if (!findings.length) {
      lines.push("- none");
      lines.push("");
      continue;
    }
    for (const finding of findings.slice(0, 25)) {
      lines.push(`- ${finding.path || finding.run_dir}`);
      if (finding.recommendation) {
        lines.push(`  - ${finding.recommendation}`);
      }
      if (finding.link) {
        lines.push(`  - broken link: ${finding.link}`);
      }
      if (typeof finding.line_count === "number") {
        lines.push(`  - lines: ${finding.line_count}`);
      }
      if (typeof finding.age_days === "number") {
        lines.push(`  - age_days: ${finding.age_days}`);
      }
    }
    if (findings.length > 25) {
      lines.push(`- ... ${findings.length - 25} more`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function writeReportArtifacts(writeDir, report) {
  fs.mkdirSync(writeDir, { recursive: true });
  const jsonPath = path.join(writeDir, "latest.json");
  const markdownPath = path.join(writeDir, "latest.md");
  const historyPath = path.join(writeDir, "history.jsonl");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdownReport(report), "utf8");
  fs.appendFileSync(historyPath, `${JSON.stringify({ checked_at: report.checked_at, summary: report.summary })}\n`, "utf8");
  return { jsonPath, markdownPath, historyPath };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function usage() {
  return [
    "Usage:",
    "  node tools/memory/health-check.js [--memory-root PATH] [--format text|json] [--write-dir PATH]",
    "Options:",
    `  --stale-days N           default ${DEFAULT_STALE_DAYS}`,
    `  --large-file-lines N     default ${DEFAULT_LARGE_FILE_LINES}`,
    "  --now ISO_TIMESTAMP      deterministic test clock",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const memoryRoot = options.memoryRoot || createInstanceConfig().memoryRoot;
  const now = options.now ? new Date(options.now) : new Date();
  const report = runHealthCheck({
    memoryRoot,
    now,
    staleDays: options.staleDays,
    largeFileLines: options.largeFileLines,
  });
  const artifacts = options.writeDir ? writeReportArtifacts(options.writeDir, report) : null;

  if (options.format === "json") {
    console.log(JSON.stringify(artifacts ? { ...report, artifacts } : report, null, 2));
  } else {
    process.stdout.write(renderMarkdownReport(report));
    if (artifacts) {
      process.stdout.write(`Artifacts: ${artifacts.markdownPath}, ${artifacts.jsonPath}, ${artifacts.historyPath}\n`);
    }
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  extractMarkdownLinks,
  findBrokenLocalLinks,
  resolveLocalLink,
  parseArgs,
  renderMarkdownReport,
  runHealthCheck,
  writeReportArtifacts,
};
