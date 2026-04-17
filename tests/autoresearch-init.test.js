const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createAutoresearchRun,
  slugify,
} = require("../tools/knowledge-base/init-autoresearch-run");

test("autoresearch slugify produces stable slugs", () => {
  assert.equal(
    slugify("What is the core technical architecture of Darkbloom?"),
    "what-is-the-core-technical-architecture-of-darkbloom"
  );
});

test("autoresearch run scaffold creates bounded run files", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-test-"));
  const topicRoot = path.join(tempRoot, "research", "darkbloom");

  try {
    await fsp.mkdir(topicRoot, { recursive: true });
    await createAutoresearchRun({
      topicRoot,
      topicSlug: "darkbloom",
      runSlug: "darkbloom-architecture",
      rootQuestion: "What is the core technical architecture of Darkbloom?",
      maxDepth: 5,
      maxTotalQuestions: 15,
      maxFollowupsPerQuestion: 2,
    });

    const runRoot = path.join(
      topicRoot,
      "autoresearch",
      "active",
      "darkbloom-architecture"
    );
    await assertPath(path.join(topicRoot, "autoresearch", "README.md"));
    await assertPath(path.join(runRoot, "RUN.md"));
    await assertPath(path.join(runRoot, "STATE.json"));
    await assertPath(path.join(runRoot, "QUESTIONS.md"));
    await assertPath(path.join(runRoot, "SOURCES.md"));
    await assertPath(path.join(runRoot, "LOG.md"));

    const state = JSON.parse(await fsp.readFile(path.join(runRoot, "STATE.json"), "utf8"));
    assert.equal(state.status, "active");
    assert.equal(state.maxDepth, 5);
    assert.equal(state.maxTotalQuestions, 15);
    assert.equal(state.maxFollowupsPerQuestion, 2);
    assert.equal(state.pendingQuestions.length, 1);
    assert.equal(
      state.pendingQuestions[0].question,
      "What is the core technical architecture of Darkbloom?"
    );

    const runBrief = await fsp.readFile(path.join(runRoot, "RUN.md"), "utf8");
    assert.match(runBrief, /Prefer primary sources/);
    assert.match(runBrief, /Promote durable findings into the topic `wiki\/`/);

    const questionsLedger = await fsp.readFile(path.join(runRoot, "QUESTIONS.md"), "utf8");
    assert.match(questionsLedger, /## Pending/);
    assert.match(questionsLedger, /What is the core technical architecture of Darkbloom\?/);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

async function assertPath(filePath) {
  await fsp.stat(filePath);
}
