#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_RESEARCH_ROOT = "/home/arya/memory/knowledge/research";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.topic) {
    printUsage(options.help ? 0 : 1);
    return;
  }

  const topicTitle = normalizeWhitespace(options.topic);
  if (!topicTitle) {
    throw new Error("Topic title cannot be empty.");
  }

  const topicSlug = options.slug || slugify(topicTitle);
  if (!topicSlug) {
    throw new Error("Unable to derive a valid topic slug.");
  }

  const researchRoot = path.resolve(options.root || DEFAULT_RESEARCH_ROOT);
  const topicRoot = path.join(researchRoot, topicSlug);

  if (fs.existsSync(topicRoot)) {
    throw new Error(`Topic already exists: ${topicRoot}`);
  }

  await createTopicSkeleton({
    researchRoot,
    topicRoot,
    topicTitle,
    topicSlug,
  });

  process.stdout.write(
    [
      `Created knowledge-base topic: ${topicTitle}`,
      `Slug: ${topicSlug}`,
      `Path: ${topicRoot}`,
    ].join("\n") + "\n"
  );
}

async function createTopicSkeleton({ researchRoot, topicRoot, topicTitle, topicSlug }) {
  await fsp.mkdir(researchRoot, { recursive: true });
  await ensureResearchRootReadme(researchRoot);

  const directories = [
    "raw/inbox",
    "raw/processed",
    "wiki/notes",
    "outputs",
  ];

  for (const relativeDir of directories) {
    await fsp.mkdir(path.join(topicRoot, relativeDir), { recursive: true });
  }

  await writeFile(
    path.join(topicRoot, "KB.md"),
    buildKbContract({ topicTitle, topicSlug })
  );
  await writeFile(
    path.join(topicRoot, "wiki/index.md"),
    buildWikiIndex({ topicTitle })
  );
  await writeFile(
    path.join(topicRoot, "wiki/log.md"),
    buildWikiLog({ topicTitle })
  );
  await writeFile(
    path.join(topicRoot, "outputs/README.md"),
    buildOutputsReadme({ topicTitle })
  );
}

async function ensureResearchRootReadme(researchRoot) {
  await fsp.mkdir(researchRoot, { recursive: true });
  const readmePath = path.join(researchRoot, "README.md");
  if (fs.existsSync(readmePath)) {
    return;
  }

  await writeFile(
    readmePath,
    [
      "# Research Knowledge Bases",
      "",
      "This directory stores topic-local research knowledge bases for Sable.",
      "",
      "Each topic uses a minimal file-based layout:",
      "",
      "```text",
      "<topic>/",
      "  KB.md",
      "  raw/",
      "    inbox/",
      "    processed/",
      "  wiki/",
      "    index.md",
      "    log.md",
      "    notes/",
      "  outputs/",
      "```",
      "",
      "The canonical knowledge lives in `wiki/`. `raw/inbox/` is the single all-source drop zone. `raw/processed/` is the processed archive. `outputs/` is for derived artifacts such as reports and briefs, not canonical knowledge.",
      "",
    ].join("\n")
  );
}

async function writeFile(filePath, content) {
  await fsp.writeFile(filePath, `${content.trimEnd()}\n`, "utf8");
}

function buildKbContract({ topicTitle, topicSlug }) {
  return [
    `# ${topicTitle} KB`,
    "",
    "## Purpose",
    "",
    `This knowledge base stores research and compiled understanding for the topic \`${topicSlug}\`.`,
    "",
    "## Canonical Layers",
    "",
    "- `raw/inbox/`: the single drop zone for new sources, including markdown, PDFs, screenshots, and other research material waiting to be processed",
    "- `raw/processed/`: sources that have already been compiled into the wiki",
    "- `raw/assets/`: legacy compatibility only if an older topic still has it; prefer `raw/inbox/` for new material",
    "- `wiki/`: canonical compiled knowledge",
    "- `outputs/`: derived artifacts such as reports or summaries; not canonical knowledge",
    "",
    "## Wiki Rules",
    "",
    "- Keep wiki notes atomic and zettelkasten-like when practical.",
    "- Prefer one concept or tightly related idea per note.",
    "- One source may yield many notes if it covers multiple durable concepts, mechanisms, or claims.",
    "- Use descriptive titles and Obsidian-style wiki links such as `[[some-note-title]]`.",
    "- Update existing notes instead of creating near-duplicates.",
    "- Promote durable knowledge into `wiki/notes/`; keep long-form reports in `outputs/`.",
    "- If a note becomes too broad, split it into smaller notes and link them.",
    "",
    "## Retrieval Habit",
    "",
    "When answering questions about this topic:",
    "",
    "1. Read `wiki/index.md` first.",
    "2. Search `wiki/` for relevant note titles, links, and keywords.",
    "3. Read linked notes before falling back to `raw/` sources.",
    "4. Treat `wiki/` as canonical unless raw evidence clearly forces an update.",
    "",
    "## Ingest Workflow",
    "",
    "1. New sources land in `raw/inbox/`, regardless of whether they are text, PDFs, or screenshots.",
    "2. Compile useful ideas into atomic wiki notes or updates.",
    "   A dense source such as a white paper should often produce multiple linked notes rather than one giant compression blob.",
    "3. Update `wiki/index.md` when new notes materially change the map of the topic.",
    "4. Append a short entry to `wiki/log.md` describing the ingest/update pass.",
    "5. Move processed source files into `raw/processed/`.",
    "",
    "## Migration Note",
    "",
    "This V0 is intentionally markdown-first. If richer indexing or retrieval is added later, `raw/` remains the provenance layer and `wiki/` remains the human-readable canonical layer.",
    "",
  ].join("\n");
}

function buildWikiIndex({ topicTitle }) {
  return [
    `# ${topicTitle} Index`,
    "",
    "## Topic Overview",
    "",
    "- Add a short orientation paragraph here once the first ingest pass is complete.",
    "",
    "## Core Notes",
    "",
    "- Add canonical wiki notes here as they are created.",
    "",
    "## Open Questions",
    "",
    "- Track unresolved questions and promising follow-up threads here.",
    "",
    "## Source Intake Status",
    "",
    "- `raw/inbox/`: pending sources waiting for ingest",
    "- `raw/processed/`: sources already reflected in the wiki",
    "",
  ].join("\n");
}

function buildWikiLog({ topicTitle }) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `# ${topicTitle} Log`,
    "",
    `## ${today}`,
    "",
    "- Initialized the topic knowledge-base scaffold.",
    "",
  ].join("\n");
}

function buildOutputsReadme({ topicTitle }) {
  return [
    `# ${topicTitle} Outputs`,
    "",
    "Store derived artifacts here:",
    "",
    "- reports",
    "- briefs",
    "- comparisons",
    "- draft blog posts or tweet threads",
    "",
    "Do not treat this directory as canonical memory. Durable knowledge should be promoted into `wiki/`.",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    topic: "",
    slug: "",
    root: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
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
    if (!parsed.topic) {
      parsed.topic = token;
      continue;
    }
    parsed.topic = `${parsed.topic} ${token}`;
  }

  return parsed;
}

function printUsage(exitCode) {
  const output = [
    "Usage:",
    "  node tools/knowledge-base/init-topic.js <topic title> [--slug topic-slug] [--root /path/to/research]",
    "",
    "Examples:",
    "  node tools/knowledge-base/init-topic.js \"agent harness evaluation\"",
    "  node tools/knowledge-base/init-topic.js \"ethereum interoperability\" --slug eth-interoperability",
  ].join("\n");
  const writer = exitCode === 0 ? process.stdout : process.stderr;
  writer.write(`${output}\n`);
  process.exitCode = exitCode;
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_RESEARCH_ROOT,
  buildKbContract,
  buildOutputsReadme,
  buildWikiIndex,
  buildWikiLog,
  createTopicSkeleton,
  ensureResearchRootReadme,
  normalizeWhitespace,
  parseArgs,
  slugify,
};
