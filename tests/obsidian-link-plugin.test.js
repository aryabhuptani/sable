const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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

test("obsidian link plugin builds and serves hosted artifact links under the vault", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sable-artifact-link-"));
  const artifactPath = path.join(tempDir, "knowledge", "projects", "darkbloom", "outputs", "report.html");
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, "<!doctype html><title>Report</title><h1>Report</h1>", "utf8");

  try {
    const plugin = createObsidianLinkPlugin({
      env: {
        SABLE_OBSIDIAN_BASE_URL: "https://sable.test.ts.net",
      },
      instanceConfig: createInstance({ memoryRoot: tempDir }),
    });

    assert.deepEqual(plugin.normalizeArtifactPath(artifactPath), {
      absolutePath: artifactPath,
      contentType: "text/html; charset=utf-8",
      relativePath: "knowledge/projects/darkbloom/outputs/report.html",
    });
    assert.equal(
      plugin.buildSignalArtifactLink(artifactPath),
      `https://sable.test.ts.net/artifact/view?path=${encodeURIComponent(artifactPath)}`
    );

    let statusCode = 0;
    let headers = {};
    let body = "";
    const res = {
      writeHead(code, nextHeaders = {}) {
        statusCode = code;
        headers = nextHeaders;
      },
      end(output = "") {
        body += output;
      },
      on() {},
      once() {},
      emit() {},
      write(chunk) {
        body += chunk;
      },
    };

    await new Promise((resolve, reject) => {
      res.end = (output = "") => {
        body += output;
        resolve();
      };
      res.emit = (event, error) => {
        if (event === "error") {
          reject(error);
          return true;
        }
        return false;
      };
      plugin.handleRequest(
        {
          method: "GET",
          url: `/artifact/view?path=${encodeURIComponent(artifactPath)}`,
        },
        res
      );
    });

    assert.equal(statusCode, 200);
    assert.equal(headers["Content-Type"], "text/html; charset=utf-8");
    assert.match(body, /<h1>Report<\/h1>/);
    assert.equal(plugin.buildSignalArtifactLink(path.join(os.tmpdir(), "outside.html")), "");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
