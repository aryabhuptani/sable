#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const { createInstanceConfig } = require("../instance/instance-config");

async function archiveCompletedAutoresearchRuns({
  researchRoot = createInstanceConfig().researchRoot,
  topic = "",
  dryRun = false,
  now = new Date(),
} = {}) {
  const resolvedResearchRoot = path.resolve(researchRoot);
  const runs = findCompletedActiveRuns({ researchRoot: resolvedResearchRoot, topic });
  const archived = [];
  const skipped = [];

  for (const run of runs) {
    const destination = path.join(run.archiveRoot, run.runSlug);
    if (fs.existsSync(destination)) {
      skipped.push({ ...run, destination, reason: "archive destination already exists" });
      continue;
    }

    if (dryRun) {
      archived.push({ ...run, destination, dryRun: true });
      continue;
    }

    await fsp.mkdir(run.archiveRoot, { recursive: true });
    await markRunArchived(run, { destination, now });
    await fsp.rename(run.runRoot, destination);
    archived.push({ ...run, destination, dryRun: false });
  }

  return {
    researchRoot: resolvedResearchRoot,
    topic: topic || "",
    dryRun,
    archived,
    skipped,
    summary: {
      archived: archived.length,
      skipped: skipped.length,
      candidates: runs.length,
    },
  };
}

function findCompletedActiveRuns({ researchRoot, topic = "" } = {}) {
  const resolvedResearchRoot = path.resolve(researchRoot || createInstanceConfig().researchRoot);
  const topicDirs = listTopicDirs(resolvedResearchRoot, topic);
  const runs = [];

  for (const topicDir of topicDirs) {
    const topicSlug = path.basename(topicDir);
    const activeRoot = path.join(topicDir, "autoresearch", "active");
    const archiveRoot = path.join(topicDir, "autoresearch", "archive");
    if (!fs.existsSync(activeRoot)) {
      continue;
    }

    for (const entry of fs.readdirSync(activeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const runRoot = path.join(activeRoot, entry.name);
      const statePath = path.join(runRoot, "STATE.json");
      const state = readJson(statePath);
      if (normalizeText(state?.status).toLowerCase() !== "completed") {
        continue;
      }
      runs.push({
        topicSlug: normalizeText(state?.topicSlug) || topicSlug,
        runSlug: normalizeText(state?.runSlug) || entry.name,
        runRoot,
        activeRoot,
        archiveRoot,
        statePath,
        status: state.status,
        completedAt: normalizeText(state?.completedAt),
        updatedAt: normalizeText(state?.updatedAt),
      });
    }
  }

  return runs.sort((left, right) => left.runRoot.localeCompare(right.runRoot));
}

function listTopicDirs(researchRoot, topic = "") {
  if (!fs.existsSync(researchRoot)) {
    return [];
  }
  const normalizedTopic = normalizeTopic(topic);
  if (normalizedTopic) {
    const topicDir = path.join(researchRoot, normalizedTopic);
    return fs.existsSync(topicDir) ? [topicDir] : [];
  }
  return fs
    .readdirSync(researchRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(researchRoot, entry.name))
    .sort();
}

async function markRunArchived(run, { destination, now }) {
  const archivedAt = now.toISOString();
  const state = readJson(run.statePath) || {};
  state.archivedAt = archivedAt;
  state.archivedFrom = run.runRoot;
  state.archivePath = destination;
  await fsp.writeFile(run.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const logPath = path.join(run.runRoot, "LOG.md");
  const logEntry = [
    "",
    `## ${archivedAt}`,
    "",
    `- Archived completed autoresearch run from \`${run.runRoot}\` to \`${destination}\` after completion notice handling.`,
    "",
  ].join("\n");
  await fsp.appendFile(logPath, logEntry, "utf8").catch(async (error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await fsp.writeFile(logPath, `# Run Log\n${logEntry}`, "utf8");
  });
}

function parseArgs(argv) {
  const options = {
    root: "",
    topic: "",
    dryRun: false,
    format: "text",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[++index] || "";
    } else if (arg === "--topic") {
      options.topic = argv[++index] || "";
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--format") {
      options.format = argv[++index] || "text";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json.");
  }

  return options;
}

function renderResult(result) {
  const lines = [
    `Autoresearch archive ${result.dryRun ? "dry run" : "run"}`,
    `Research root: ${result.researchRoot}`,
    `Archived: ${result.summary.archived}`,
    `Skipped: ${result.summary.skipped}`,
  ];
  for (const run of result.archived.slice(0, 25)) {
    lines.push(`- ${run.runRoot} -> ${run.destination}`);
  }
  if (result.archived.length > 25) {
    lines.push(`- ... ${result.archived.length - 25} more`);
  }
  for (const run of result.skipped.slice(0, 25)) {
    lines.push(`- skipped ${run.runRoot}: ${run.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTopic(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function usage() {
  return [
    "Usage:",
    "  node tools/knowledge-base/archive-completed-autoresearch-runs.js [--root PATH] [--topic TOPIC] [--dry-run] [--format text|json]",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
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

  const result = await archiveCompletedAutoresearchRuns({
    researchRoot: options.root || createInstanceConfig().researchRoot,
    topic: options.topic,
    dryRun: options.dryRun,
  });

  if (options.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(renderResult(result));
  }
  return 0;
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  archiveCompletedAutoresearchRuns,
  findCompletedActiveRuns,
  parseArgs,
  renderResult,
};
