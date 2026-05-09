const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  extractMarkdownLinks,
  findBrokenLocalLinks,
  resolveLocalLink,
  runHealthCheck,
  writeReportArtifacts,
} = require("../tools/memory/health-check");

test("memory health detects completed active runs, stale files, missing summaries, and broken links", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-memory-health-"));
  const memoryRoot = path.join(tempRoot, "memory");
  const now = new Date("2026-05-09T10:00:00.000Z");

  try {
    await write(
      path.join(memoryRoot, "README.md"),
      "# Memory\n\n## Summary\nCurrent.\n"
    );
    await write(
      path.join(memoryRoot, "knowledge", "projects", "memory", "ARCHITECTURE.md"),
      "# Architecture\n"
    );
    await write(
      path.join(memoryRoot, "knowledge", "projects", "memory", "ARCHITECTURE_LOG.md"),
      "# Architecture Log\n"
    );
    await write(
      path.join(memoryRoot, "knowledge", "research", "darkbloom", "autoresearch", "active", "done-run", "STATE.json"),
      JSON.stringify({ status: "completed" })
    );
    await write(
      path.join(memoryRoot, "tasks", "projects", "sable", "TODO.md"),
      ["# Tasks", "", "[broken](missing.md)", "", ...Array.from({ length: 12 }, (_, index) => `line ${index}`)].join("\n")
    );

    const stalePath = path.join(memoryRoot, "tasks", "projects", "sable", "TODO.md");
    await fs.utimes(stalePath, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));

    const report = runHealthCheck({
      memoryRoot,
      now,
      staleDays: 14,
      largeFileLines: 10,
    });

    assert.equal(report.summary.completed_runs_in_active, 1);
    assert.equal(report.summary.stale_active_files, 1);
    assert.equal(report.summary.oversized_active_files_without_summary, 1);
    assert.equal(report.summary.broken_local_links, 1);
    assert.equal(report.summary.missing_architecture_files, 0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("memory health writes latest markdown, latest json, and history jsonl", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-memory-health-artifacts-"));
  const memoryRoot = path.join(tempRoot, "memory");
  const writeDir = path.join(tempRoot, "metrics");

  try {
    await write(path.join(memoryRoot, "README.md"), "# Memory\n");
    const report = runHealthCheck({
      memoryRoot,
      now: new Date("2026-05-09T10:00:00.000Z"),
    });
    const artifacts = writeReportArtifacts(writeDir, report);

    assert.match(await fs.readFile(artifacts.markdownPath, "utf8"), /# Memory Health/);
    assert.equal(JSON.parse(await fs.readFile(artifacts.jsonPath, "utf8")).checked_at, "2026-05-09T10:00:00.000Z");
    assert.match(await fs.readFile(artifacts.historyPath, "utf8"), /missing_architecture_files/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("extractMarkdownLinks handles markdown and wiki links", () => {
  assert.deepEqual(
    extractMarkdownLinks("[A](a.md) ![img](ignored.png) [[Project Note]] [[Other#Heading|Alias]]"),
    ["a.md", "Project Note.md", "Other.md"]
  );
});

test("local link resolution accepts line suffixes and indexed wiki-style note names", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-memory-health-links-"));
  try {
    const sourcePath = path.join(tempRoot, "memory", "knowledge", "projects", "source.md");
    const targetPath = path.join(tempRoot, "memory", "knowledge", "research", "AUTORESEARCH.md");
    const wikiPath = path.join(tempRoot, "memory", "knowledge", "research", "wiki", "Project Note.md");
    await write(sourcePath, `[line](${targetPath}:1)\n[[Project Note]]\n[bad](missing.md)\n`);
    await write(targetPath, "# Autoresearch\n");
    await write(wikiPath, "# Project Note\n");

    const markdownFiles = [sourcePath, targetPath, wikiPath];
    const lineResolution = resolveLocalLink(sourcePath, `${targetPath}:1`);
    assert.equal(lineResolution.exists, true);
    assert.equal(lineResolution.target, targetPath);

    const brokenLinks = findBrokenLocalLinks(markdownFiles);
    assert.equal(brokenLinks.length, 1);
    assert.equal(brokenLinks[0].link, "missing.md");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
