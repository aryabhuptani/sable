const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  discoverKbFiles,
  loadAutotweetConfig,
} = require("../tools/autotweet/config");
const {
  buildDraftListQuery,
  buildDraftPayload,
  extractPublishedXPosts,
  parseArgs: parseTypefullyArgs,
} = require("../tools/autotweet/typefully-cli");
const {
  parseArgs: parseBootstrapArgs,
  renderStyleGuide,
  summarizeDrafts,
} = require("../tools/autotweet/bootstrap-style-guide");

test("loadAutotweetConfig parses markdown frontmatter config", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-autotweet-config-"));
  const configPath = path.join(tempRoot, "CONFIG.md");
  await fs.writeFile(
    configPath,
    `---
enabled: true
draft_count: 7
max_files_per_kb: 4
max_chars_per_file: 1500
platforms:
  - x
  - linkedin
knowledge_bases:
  - /tmp/kb-a
queue_mode: draft
---

# Notes
`,
    "utf8"
  );

  try {
    const config = loadAutotweetConfig(configPath);
    assert.equal(config.enabled, true);
    assert.equal(config.draftCount, 7);
    assert.deepEqual(config.platforms, ["x", "linkedin"]);
    assert.deepEqual(config.knowledgeBases, ["/tmp/kb-a"]);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("discoverKbFiles returns KB.md, index, and note files with truncation", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-autotweet-kb-"));
  const kbRoot = path.join(tempRoot, "kb");
  await fs.mkdir(path.join(kbRoot, "wiki", "notes"), { recursive: true });
  await fs.writeFile(path.join(kbRoot, "KB.md"), "# KB\nhello world", "utf8");
  await fs.writeFile(path.join(kbRoot, "wiki", "index.md"), "# Index\nhello world", "utf8");
  await fs.writeFile(path.join(kbRoot, "wiki", "notes", "a.md"), "# Note\nhello world", "utf8");

  try {
    const files = discoverKbFiles(kbRoot, { maxFilesPerKb: 3, maxCharsPerFile: 5 });
    assert.equal(files.length, 3);
    assert.equal(files[0].content.length <= 5, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("buildDraftPayload creates a Typefully-compatible X draft payload", () => {
  const payload = buildDraftPayload(
    {
      text: "Hello from Sable",
    },
    {
      platforms: ["x"],
    }
  );

  assert.deepEqual(payload, {
    platforms: {
      x: {
        enabled: true,
        posts: [{ text: "Hello from Sable" }],
      },
    },
  });
});

test("buildDraftListQuery encodes published draft filters", () => {
  assert.equal(
    buildDraftListQuery({ status: "published", limit: 40, offset: 20 }),
    "status=published&limit=40&offset=20"
  );
});

test("extractPublishedXPosts normalizes only X drafts with text", () => {
  const normalized = extractPublishedXPosts({
    results: [
      {
        id: 1,
        status: "published",
        published_at: "2026-04-27T12:00:00Z",
        platforms: {
          x: {
            posts: [{ text: "hello world" }, { text: "second post" }],
          },
        },
      },
      {
        id: 2,
        status: "published",
        platforms: {
          linkedin: {
            posts: [{ text: "ignore me" }],
          },
        },
      },
      {
        id: 3,
        status: "published",
        platforms: {
          x: {
            posts: [{ text: "   " }],
          },
        },
      },
    ],
  });

  assert.deepEqual(normalized, [
    {
      draftId: 1,
      status: "published",
      publishedAt: "2026-04-27T12:00:00Z",
      updatedAt: "",
      preview: "",
      postCount: 2,
      isThread: true,
      posts: [
        { text: "hello world", mediaIds: [] },
        { text: "second post", mediaIds: [] },
      ],
    },
  ]);
});

test("typefully parseArgs accepts published-drafts pagination options", () => {
  const options = parseTypefullyArgs(["--limit", "15", "--offset", "30", "--social-set-id", "55737"]);
  assert.equal(options.limit, 15);
  assert.equal(options.offset, 30);
  assert.equal(options.socialSetId, "55737");
});

test("summarizeDrafts derives basic post stats", () => {
  const stats = summarizeDrafts([
    {
      isThread: false,
      posts: [{ text: "I think this matters." }],
    },
    {
      isThread: true,
      posts: [{ text: "1. first" }, { text: "2. second?" }],
    },
  ]);

  assert.equal(stats.totalDrafts, 2);
  assert.equal(stats.totalPosts, 3);
  assert.equal(stats.singleDrafts, 1);
  assert.equal(stats.threadDrafts, 1);
  assert.equal(stats.questionRate, 33);
  assert.equal(stats.listRate, 67);
  assert.equal(stats.firstPersonRate, 33);
});

test("renderStyleGuide creates a usable markdown bootstrap", () => {
  const markdown = renderStyleGuide(
    [
      {
        isThread: false,
        posts: [{ text: "One crisp single post." }],
      },
      {
        isThread: true,
        posts: [{ text: "Thread opener here." }, { text: "Second thread post." }],
      },
    ],
    {
      generatedAt: "2026-04-27T12:00:00.000Z",
      sourceSocialSetId: "55737",
    }
  );

  assert.match(markdown, /Bootstrapped automatically from 2 recent published X drafts/);
  assert.match(markdown, /Source social set id: 55737/);
  assert.match(markdown, /Representative Single Posts/);
  assert.match(markdown, /Representative Thread Openers/);
});

test("bootstrap parseArgs uses style guide path by default", () => {
  const options = parseBootstrapArgs(["--limit", "10", "--social-set-id", "55737"]);
  assert.equal(options.limit, 10);
  assert.equal(options.socialSetId, "55737");
  assert.equal(options.outputPath.endsWith("/autotweet/STYLE_GUIDE.md"), true);
});
