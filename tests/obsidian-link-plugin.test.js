const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildObsidianUri,
  createObsidianLinkPlugin,
  parseMarkdownFileTarget,
} = require("../apps/signal-bridge/obsidian-link-plugin");

function createInstance(overrides = {}) {
  return {
    memoryRoot: "/srv/sable-user/memory",
    ...overrides,
  };
}

test("obsidian link plugin rewrites vault markdown links for Signal", () => {
  const plugin = createObsidianLinkPlugin({
    env: {
      SABLE_OBSIDIAN_BASE_URL: "https://sable.test.ts.net/",
      SABLE_OBSIDIAN_LINKS_ENABLED: "true",
      SABLE_OBSIDIAN_VAULT_NAME: "Arya Memory",
    },
    instanceConfig: createInstance(),
  });

  const notePath = "/srv/sable-user/memory/knowledge/research/darkbloom/note.md";
  const output = plugin.rewriteMarkdownDocumentReferencesForSignal(
    `Read [privacy note](${notePath}:12)`
  );

  assert.equal(
    output,
    "Read privacy note: https://sable.test.ts.net/obsidian/open?path=%2Fsrv%2Fsable-user%2Fmemory%2Fknowledge%2Fresearch%2Fdarkbloom%2Fnote.md&line=12"
  );
});

test("obsidian link plugin leaves non-vault or disabled links unchanged", () => {
  const disabled = createObsidianLinkPlugin({
    env: {
      SABLE_OBSIDIAN_BASE_URL: "https://sable.test.ts.net",
      SABLE_OBSIDIAN_LINKS_ENABLED: "false",
    },
    instanceConfig: createInstance(),
  });
  assert.equal(
    disabled.rewriteMarkdownDocumentReferencesForSignal(
      "Read [note](/srv/sable-user/memory/note.md)"
    ),
    "Read [note](/srv/sable-user/memory/note.md)"
  );

  const enabled = createObsidianLinkPlugin({
    env: {
      SABLE_OBSIDIAN_BASE_URL: "https://sable.test.ts.net",
    },
    instanceConfig: createInstance(),
  });
  assert.equal(
    enabled.rewriteMarkdownDocumentReferencesForSignal("Read [outside](/tmp/note.md)"),
    "Read [outside](/tmp/note.md)"
  );
});

test("obsidian link plugin normalizes only markdown notes under the vault", () => {
  const plugin = createObsidianLinkPlugin({
    env: {},
    instanceConfig: createInstance(),
  });

  assert.deepEqual(
    plugin.normalizeObsidianNotePath("/srv/sable-user/memory/folder/note.markdown"),
    {
      absolutePath: path.resolve("/srv/sable-user/memory/folder/note.markdown"),
      relativePath: "folder/note.markdown",
    }
  );
  assert.equal(plugin.normalizeObsidianNotePath("/srv/sable-user/memory/folder/file.txt"), null);
  assert.equal(plugin.normalizeObsidianNotePath("/srv/sable-user/other/note.md"), null);
});

test("parseMarkdownFileTarget supports markdown paths with optional line hints", () => {
  assert.deepEqual(parseMarkdownFileTarget("/tmp/note.md:42"), {
    filePath: "/tmp/note.md",
    line: "42",
  });
  assert.deepEqual(parseMarkdownFileTarget("/tmp/note.markdown"), {
    filePath: "/tmp/note.markdown",
    line: "",
  });
  assert.equal(parseMarkdownFileTarget("relative.md"), null);
  assert.equal(parseMarkdownFileTarget("/tmp/not-markdown.txt"), null);
});

test("obsidian URI uses percent encoding for vault names with spaces", () => {
  const relativeNotePath = "knowledge/projects/travel/kb/2026-05-california/README.md";
  const expectedUri =
    "obsidian://open?vault=Sable%20Memory&file=knowledge%2Fprojects%2Ftravel%2Fkb%2F2026-05-california%2FREADME.md";

  assert.equal(
    buildObsidianUri("Sable Memory", relativeNotePath),
    expectedUri
  );
});

test("obsidian redirect page uses percent-encoded vault name in launch URI", () => {
  const plugin = createObsidianLinkPlugin({
    env: {
      SABLE_OBSIDIAN_BASE_URL: "https://sable.test.ts.net",
      SABLE_OBSIDIAN_VAULT_NAME: "Sable Memory",
    },
    instanceConfig: createInstance(),
  });
  let statusCode = 0;
  let body = "";
  const res = {
    writeHead(code) {
      statusCode = code;
    },
    end(output = "") {
      body = output;
    },
  };

  plugin.handleRequest(
    {
      method: "GET",
      url: `/obsidian/open?path=${encodeURIComponent("/srv/sable-user/memory/folder/note.md")}`,
    },
    res
  );

  assert.equal(statusCode, 200);
  assert.match(body, /obsidian:\/\/open\?vault=Sable%20Memory&amp;file=folder%2Fnote\.md/);
  assert.doesNotMatch(body, /Sable\+Memory/);
});
