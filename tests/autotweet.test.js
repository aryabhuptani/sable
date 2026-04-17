const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  discoverKbFiles,
  loadAutotweetConfig,
} = require("../tools/autotweet/config");
const { buildDraftPayload } = require("../tools/autotweet/typefully-cli");

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
