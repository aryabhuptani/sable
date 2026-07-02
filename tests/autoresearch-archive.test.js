const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  archiveCompletedAutoresearchRuns,
  findCompletedActiveRuns,
  parseArgs,
} = require("../tools/knowledge-base/archive-completed-autoresearch-runs");

test("archiveCompletedAutoresearchRuns moves completed active runs and preserves provenance", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-archive-"));
  const researchRoot = path.join(tempRoot, "research");
  const activeRun = path.join(researchRoot, "darkbloom", "autoresearch", "active", "finished-run");
  const archiveRun = path.join(researchRoot, "darkbloom", "autoresearch", "archive", "finished-run");

  try {
    await writeState(activeRun, {
      topicSlug: "darkbloom",
      runSlug: "finished-run",
      status: "completed",
      completedAt: "2026-05-09T12:00:00.000Z",
      pendingQuestions: [],
    });
    await write(path.join(activeRun, "LOG.md"), "# Run Log\n");

    const result = await archiveCompletedAutoresearchRuns({
      researchRoot,
      now: new Date("2026-05-09T13:00:00.000Z"),
    });

    assert.equal(result.summary.archived, 1);
    await assertRejectsStat(activeRun);
    await fs.stat(archiveRun);
    const archivedState = JSON.parse(await fs.readFile(path.join(archiveRun, "STATE.json"), "utf8"));
    assert.equal(archivedState.status, "completed");
    assert.equal(archivedState.archivedAt, "2026-05-09T13:00:00.000Z");
    assert.equal(archivedState.archivedFrom, activeRun);
    assert.equal(archivedState.archivePath, archiveRun);
    assert.match(await fs.readFile(path.join(archiveRun, "LOG.md"), "utf8"), /Archived completed autoresearch run/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("archiveCompletedAutoresearchRuns dry-run leaves completed runs in active", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-archive-dry-"));
  const researchRoot = path.join(tempRoot, "research");
  const activeRun = path.join(researchRoot, "darkbloom", "autoresearch", "active", "finished-run");

  try {
    await writeState(activeRun, { topicSlug: "darkbloom", runSlug: "finished-run", status: "completed" });

    const result = await archiveCompletedAutoresearchRuns({ researchRoot, dryRun: true });

    assert.equal(result.summary.archived, 1);
    await fs.stat(activeRun);
    assert.equal(findCompletedActiveRuns({ researchRoot }).length, 1);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("findCompletedActiveRuns treats complete as a completed status alias", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-archive-alias-"));
  const researchRoot = path.join(tempRoot, "research");
  const activeRun = path.join(researchRoot, "sable", "autoresearch", "active", "finished-run");

  try {
    await writeState(activeRun, { topicSlug: "sable", runSlug: "finished-run", status: "complete" });

    const runs = findCompletedActiveRuns({ researchRoot });

    assert.equal(runs.length, 1);
    assert.equal(runs[0].topicSlug, "sable");
    assert.equal(runs[0].runSlug, "finished-run");
    assert.equal(runs[0].status, "complete");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("archive command parser supports root, topic, format, and dry-run", () => {
  assert.deepEqual(parseArgs(["--root", "/tmp/research", "--topic", "Dark Bloom", "--dry-run", "--format", "json"]), {
    root: "/tmp/research",
    topic: "Dark Bloom",
    dryRun: true,
    format: "json",
    help: false,
  });
});

async function writeState(runRoot, state) {
  await write(path.join(runRoot, "STATE.json"), JSON.stringify(state));
}

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${content}\n`, "utf8");
}

async function assertRejectsStat(filePath) {
  await assert.rejects(fs.stat(filePath), { code: "ENOENT" });
}
