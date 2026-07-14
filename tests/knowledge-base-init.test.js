const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  createTopicSkeleton,
  ensureResearchRootReadme,
  getDefaultResearchRoot,
  slugify,
} = require("../tools/knowledge-base/init-topic");

test("slugify normalizes topic titles into stable slugs", () => {
  assert.equal(slugify(" Agent Harness Evaluation "), "agent-harness-evaluation");
  assert.equal(slugify("ETH / Interop + Research"), "eth-interop-research");
});

test("knowledge-base default research root follows instance config", () => {
  assert.equal(getDefaultResearchRoot({ env: {} }), "/home/arya/domains/research/projects");
  assert.equal(
    getDefaultResearchRoot({
      env: {
        SABLE_INSTANCE_HOME: "/srv/alex",
      },
    }),
    "/srv/alex/domains/research/projects"
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

test("topic skeleton creates the minimal knowledge-base layout with outputs", async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "sable-kb-test-"));
  const researchRoot = path.join(tempRoot, "research");
  const topicRoot = path.join(researchRoot, "agent-harness-evaluation");

  try {
    await ensureResearchRootReadme(researchRoot);
    await createTopicSkeleton({
      researchRoot,
      topicRoot,
      topicTitle: "Agent Harness Evaluation",
      topicSlug: "agent-harness-evaluation",
    });

    await assertPath(path.join(researchRoot, "README.md"));
    await assertPath(path.join(topicRoot, "KB.md"));
    await assertPath(path.join(topicRoot, "raw/inbox"));
    await assertPath(path.join(topicRoot, "raw/processed"));
    await assertPath(path.join(topicRoot, "wiki/index.md"));
    await assertPath(path.join(topicRoot, "wiki/log.md"));
    await assertPath(path.join(topicRoot, "wiki/notes"));
    await assertPath(path.join(topicRoot, "outputs/README.md"));

    const kbContract = await fsp.readFile(path.join(topicRoot, "KB.md"), "utf8");
    assert.match(kbContract, /Keep wiki notes atomic and zettelkasten-like when practical\./);
    assert.match(kbContract, /Use descriptive titles and Obsidian-style wiki links/);
    assert.match(kbContract, /single drop zone for new sources/);

    const wikiIndex = await fsp.readFile(path.join(topicRoot, "wiki/index.md"), "utf8");
    assert.match(wikiIndex, /# Agent Harness Evaluation Index/);

    const outputsReadme = await fsp.readFile(path.join(topicRoot, "outputs/README.md"), "utf8");
    assert.match(outputsReadme, /Do not treat this directory as canonical memory\./);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});

async function assertPath(filePath) {
  await fsp.stat(filePath);
}
