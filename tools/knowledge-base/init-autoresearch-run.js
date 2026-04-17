#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_RESEARCH_ROOT = "/home/arya/memory/knowledge/research";
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_TOTAL_QUESTIONS = 7;
const DEFAULT_MAX_FOLLOWUPS_PER_QUESTION = 2;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.topic || !options.question) {
    printUsage(options.help ? 0 : 1);
    return;
  }

  const topicSlug = slugify(options.topic);
  if (!topicSlug) {
    throw new Error("Unable to derive a valid topic slug.");
  }

  const rootQuestion = normalizeWhitespace(options.question);
  if (!rootQuestion) {
    throw new Error("Research question cannot be empty.");
  }

  const researchRoot = path.resolve(options.root || DEFAULT_RESEARCH_ROOT);
  const topicRoot = path.join(researchRoot, topicSlug);
  if (!fs.existsSync(topicRoot)) {
    throw new Error(`Topic does not exist: ${topicRoot}`);
  }

  const runSlug = options.slug || slugify(rootQuestion).slice(0, 80);
  if (!runSlug) {
    throw new Error("Unable to derive a valid run slug.");
  }

  const maxDepth = parsePositiveInteger(options.maxDepth, DEFAULT_MAX_DEPTH, "max depth");
  const maxTotalQuestions = parsePositiveInteger(
    options.maxTotalQuestions,
    DEFAULT_MAX_TOTAL_QUESTIONS,
    "max total questions"
  );
  const maxFollowupsPerQuestion = parsePositiveInteger(
    options.maxFollowupsPerQuestion,
    DEFAULT_MAX_FOLLOWUPS_PER_QUESTION,
    "max followups per question"
  );

  const runRoot = path.join(topicRoot, "autoresearch", "active", runSlug);
  if (fs.existsSync(runRoot)) {
    throw new Error(`Autoresearch run already exists: ${runRoot}`);
  }

  await createAutoresearchRun({
    topicRoot,
    topicSlug,
    runSlug,
    rootQuestion,
    maxDepth,
    maxTotalQuestions,
    maxFollowupsPerQuestion,
  });

  process.stdout.write(
    [
      `Created autoresearch run: ${runSlug}`,
      `Topic: ${topicSlug}`,
      `Path: ${runRoot}`,
      `Question: ${rootQuestion}`,
    ].join("\n") + "\n"
  );
}

async function createAutoresearchRun({
  topicRoot,
  topicSlug,
  runSlug,
  rootQuestion,
  maxDepth,
  maxTotalQuestions,
  maxFollowupsPerQuestion,
}) {
  const autoresearchRoot = path.join(topicRoot, "autoresearch");
  const activeRoot = path.join(autoresearchRoot, "active");
  const archiveRoot = path.join(autoresearchRoot, "archive");
  const runRoot = path.join(activeRoot, runSlug);

  await fsp.mkdir(runRoot, { recursive: true });
  await fsp.mkdir(archiveRoot, { recursive: true });
  await ensureAutoresearchReadme(autoresearchRoot, topicSlug);

  const createdAt = new Date().toISOString();
  const budgets = {
    maxDepth,
    maxTotalQuestions,
    maxFollowupsPerQuestion,
  };

  await writeFile(
    path.join(runRoot, "RUN.md"),
    buildRunBrief({ topicSlug, runSlug, rootQuestion, createdAt, budgets })
  );
  await writeFile(
    path.join(runRoot, "STATE.json"),
    `${JSON.stringify(
      buildState({
        topicSlug,
        runSlug,
        rootQuestion,
        createdAt,
        budgets,
      }),
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(runRoot, "QUESTIONS.md"),
    buildQuestionsLedger({ rootQuestion, createdAt })
  );
  await writeFile(path.join(runRoot, "SOURCES.md"), buildSourcesLedger({ createdAt }));
  await writeFile(path.join(runRoot, "LOG.md"), buildRunLog({ createdAt, rootQuestion }));
}

async function ensureAutoresearchReadme(autoresearchRoot, topicSlug) {
  await fsp.mkdir(autoresearchRoot, { recursive: true });
  const readmePath = path.join(autoresearchRoot, "README.md");
  if (fs.existsSync(readmePath)) {
    return;
  }

  await writeFile(
    readmePath,
    [
      `# ${topicSlug} Autoresearch`,
      "",
      "This directory stores bounded autoresearch runs for this topic KB.",
      "",
      "Layout:",
      "",
      "```text",
      "autoresearch/",
      "  active/",
      "    <run-slug>/",
      "      RUN.md",
      "      STATE.json",
      "      QUESTIONS.md",
      "      SOURCES.md",
      "      LOG.md",
      "  archive/",
      "```",
      "",
      "Each active run should preserve a clear audit trail, respect the configured depth/question budgets, and promote durable knowledge into the topic wiki rather than letting research stay trapped inside the run folder.",
      "",
    ].join("\n")
  );
}

function buildRunBrief({ topicSlug, runSlug, rootQuestion, createdAt, budgets }) {
  return [
    `# Autoresearch Run: ${runSlug}`,
    "",
    "## Topic",
    "",
    `- Topic slug: \`${topicSlug}\``,
    `- Created at: \`${createdAt}\``,
    "",
    "## Root Question",
    "",
    rootQuestion,
    "",
    "## Operating Rules",
    "",
    "- Prefer primary sources: papers, specs, official docs, repos, code, and source materials from the system being studied.",
    "- Secondary sources are allowed only for orientation and should be labeled as such in `SOURCES.md`.",
    "- Each tick should execute one bounded step, persist state, and stop.",
    "- Promote durable findings into the topic `wiki/` as atomic, zettelkasten-like notes with semantic links.",
    "- Keep the original question intact while generating deeper follow-up questions; do not drift into adjacent fluff.",
    "",
    "## Budgets",
    "",
    `- Max depth: ${budgets.maxDepth}`,
    `- Max total questions: ${budgets.maxTotalQuestions}`,
    `- Max followups per question: ${budgets.maxFollowupsPerQuestion}`,
    "",
    "## Stop Conditions",
    "",
    "- The root question has been answered to the current evidence threshold.",
    "- The run has reached its configured depth budget.",
    "- The run has reached its configured total-question budget.",
    "- The loop is blocked on missing access, bad source quality, or contradictory evidence that needs human review.",
    "",
  ].join("\n");
}

function buildState({ topicSlug, runSlug, rootQuestion, createdAt, budgets }) {
  return {
    topicSlug,
    runSlug,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    rootQuestion,
    currentDepth: 0,
    maxDepth: budgets.maxDepth,
    maxTotalQuestions: budgets.maxTotalQuestions,
    maxFollowupsPerQuestion: budgets.maxFollowupsPerQuestion,
    pendingQuestions: [
      {
        id: `${runSlug}-q1`,
        question: rootQuestion,
        depth: 0,
        parentQuestionId: null,
        status: "pending",
        createdAt,
      },
    ],
    processedQuestions: [],
    completedQuestions: [],
    blockedReason: "",
    lastTickAt: "",
  };
}

function buildQuestionsLedger({ rootQuestion, createdAt }) {
  return [
    "# Questions",
    "",
    "## Root Question",
    "",
    `- ${rootQuestion}`,
    "",
    "## Pending",
    "",
    `- [ ] ${rootQuestion} (depth 0, created ${createdAt})`,
    "",
    "## Answered",
    "",
    "- None yet.",
    "",
    "## Dropped",
    "",
    "- None yet.",
    "",
  ].join("\n");
}

function buildSourcesLedger({ createdAt }) {
  return [
    "# Sources",
    "",
    "Track every source used by the loop here. Label each entry as primary or secondary and explain why it matters.",
    "",
    `Initialized: ${createdAt}`,
    "",
    "## Entries",
    "",
    "- None yet.",
    "",
  ].join("\n");
}

function buildRunLog({ createdAt, rootQuestion }) {
  return [
    "# Run Log",
    "",
    `## ${createdAt}`,
    "",
    `- Initialized autoresearch run with root question: ${rootQuestion}`,
    "",
  ].join("\n");
}

async function writeFile(filePath, content) {
  await fsp.writeFile(filePath, content, "utf8");
}

function parseArgs(argv) {
  const parsed = {
    topic: "",
    question: "",
    slug: "",
    root: "",
    maxDepth: "",
    maxTotalQuestions: "",
    maxFollowupsPerQuestion: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token === "--topic") {
      parsed.topic = normalizeWhitespace(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--question") {
      parsed.question = normalizeWhitespace(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--slug") {
      parsed.slug = normalizeWhitespace(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--root") {
      parsed.root = normalizeWhitespace(argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (token === "--max-depth") {
      parsed.maxDepth = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token === "--max-total-questions") {
      parsed.maxTotalQuestions = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (token === "--max-followups-per-question") {
      parsed.maxFollowupsPerQuestion = argv[index + 1] || "";
      index += 1;
      continue;
    }
  }

  return parsed;
}

function printUsage(exitCode) {
  const output = [
    "Usage:",
    "  node tools/knowledge-base/init-autoresearch-run.js --topic darkbloom --question \"What is the core technical architecture of Darkbloom?\" [--slug run-slug] [--max-depth 5] [--max-total-questions 15] [--max-followups-per-question 2] [--root /path/to/research]",
  ].join("\n");
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${output}\n`);
  process.exitCode = exitCode;
}

function parsePositiveInteger(value, fallback, label) {
  if (!normalizeWhitespace(value)) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWhitespace(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  createAutoresearchRun,
  slugify,
};
