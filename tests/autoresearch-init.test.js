const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createAutoresearchRun,
  getDefaultResearchRoot,
  slugify,
} = require("../tools/knowledge-base/init-autoresearch-run");

test("autoresearch slugify produces stable slugs", () => {
  assert.equal(
    slugify("What is the core technical architecture of Darkbloom?"),
    "what-is-the-core-technical-architecture-of-darkbloom"
  );
});

test("autoresearch default research root follows instance config", () => {
  assert.equal(getDefaultResearchRoot({ env: {} }), "/home/arya/domains/research/projects");
  assert.equal(
    getDefaultResearchRoot({
      env: {
        SABLE_DOMAINS_ROOT: "/data/alex/domains",
      },
    }),
    "/data/alex/domains/research/projects"
  );
  assert.equal(
    getDefaultResearchRoot({
      env: {
        SABLE_RESEARCH_ROOT: "/data/research",
      },
    }),
    "/data/research"
  );
});

test("autoresearch run scaffold creates bounded run files with deep-audit defaults", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-test-"));
  const topicRoot = path.join(tempRoot, "research", "darkbloom");

  try {
    await fsp.mkdir(topicRoot, { recursive: true });
    await createAutoresearchRun({
      topicRoot,
      topicSlug: "darkbloom",
      runSlug: "darkbloom-architecture",
      rootQuestion: "What is the core technical architecture of Darkbloom?",
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
    assert.equal(state.mode, "deep_audit");
    assert.equal(state.maxDepth, 5);
    assert.equal(state.maxTotalQuestions, 15);
    assert.equal(state.maxFollowupsPerQuestion, 4);
    assert.equal(state.minProcessedQuestionsBeforeComplete, 4);
    assert.equal(state.minTicksBeforeComplete, 4);
    assert.equal(state.requireFrontierExpansionOnRoot, true);
    assert.equal(state.pendingQuestions.length, 1);
    assert.equal(
      state.pendingQuestions[0].question,
      "What is the core technical architecture of Darkbloom?"
    );

    const runBrief = await fsp.readFile(path.join(runRoot, "RUN.md"), "utf8");
    assert.match(runBrief, /Run mode: `deep_audit`/);
    assert.match(runBrief, /Prefer primary sources/);
    assert.match(runBrief, /Promote durable findings into the topic `wiki\/`/);
    assert.match(runBrief, /Min processed questions before complete: 4/);
    assert.match(runBrief, /Require frontier expansion on root: true/);

    const questionsLedger = await fsp.readFile(path.join(runRoot, "QUESTIONS.md"), "utf8");
    assert.match(questionsLedger, /## Pending/);
    assert.match(questionsLedger, /What is the core technical architecture of Darkbloom\?/);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

test("autoresearch run scaffold accepts explicit tighter or looser policy overrides", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-autoresearch-override-"));
  const topicRoot = path.join(tempRoot, "research", "darkbloom");

  try {
    await fsp.mkdir(topicRoot, { recursive: true });
    await createAutoresearchRun({
      topicRoot,
      topicSlug: "darkbloom",
      runSlug: "darkbloom-survey",
      rootQuestion: "What is the basic shape of the system?",
      mode: "survey",
      maxDepth: 2,
      maxTotalQuestions: 3,
      maxFollowupsPerQuestion: 1,
      minProcessedQuestionsBeforeComplete: 1,
      minTicksBeforeComplete: 1,
      requireFrontierExpansionOnRoot: false,
    });

    const runRoot = path.join(topicRoot, "autoresearch", "active", "darkbloom-survey");
    const state = JSON.parse(await fsp.readFile(path.join(runRoot, "STATE.json"), "utf8"));
    assert.equal(state.mode, "survey");
    assert.equal(state.maxDepth, 2);
    assert.equal(state.maxTotalQuestions, 3);
    assert.equal(state.maxFollowupsPerQuestion, 1);
    assert.equal(state.minProcessedQuestionsBeforeComplete, 1);
    assert.equal(state.minTicksBeforeComplete, 1);
    assert.equal(state.requireFrontierExpansionOnRoot, false);

    const runBrief = await fsp.readFile(path.join(runRoot, "RUN.md"), "utf8");
    assert.match(runBrief, /Run mode: `survey`/);
    assert.match(runBrief, /Max depth: 2/);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

async function assertPath(filePath) {
  await fsp.stat(filePath);
}
