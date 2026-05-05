const assert = require("node:assert/strict");
const test = require("node:test");

const {
  expectedProxyTarget,
  getLocalHealthUrl,
  isServeConfigured,
  normalizeServeHostname,
  parseArgs,
} = require("../tools/obsidian-link/ensure-serve");

test("obsidian serve helper builds local health and proxy targets", () => {
  assert.equal(getLocalHealthUrl({ host: "127.0.0.1", port: 4111 }), "http://127.0.0.1:4111/healthz");
  assert.equal(expectedProxyTarget({ host: "127.0.0.1", port: 4111 }), "http://127.0.0.1:4111");
});

test("obsidian serve helper normalizes tailscale hostnames", () => {
  assert.equal(normalizeServeHostname("homebrain.tail1d4ba0.ts.net.", "443"), "homebrain.tail1d4ba0.ts.net:443");
});

test("obsidian serve helper detects matching serve proxy", () => {
  const status = {
    Web: {
      "homebrain.tail1d4ba0.ts.net:443": {
        Handlers: {
          "/": {
            Proxy: "http://127.0.0.1:4111",
          },
        },
      },
    },
  };

  assert.equal(
    isServeConfigured(status, {
      dnsName: "homebrain.tail1d4ba0.ts.net.",
      host: "127.0.0.1",
      httpsPort: "443",
      port: 4111,
    }),
    true
  );
  assert.equal(
    isServeConfigured(status, {
      dnsName: "homebrain.tail1d4ba0.ts.net.",
      host: "127.0.0.1",
      httpsPort: "443",
      port: 4222,
    }),
    false
  );
});

test("obsidian serve helper parses repair options", () => {
  const options = parseArgs(["--dry-run", "--restart-bridge", "--port", "4222", "--https-port", "8443"]);
  assert.equal(options.dryRun, true);
  assert.equal(options.restartBridge, true);
  assert.equal(options.port, 4222);
  assert.equal(options.httpsPort, "8443");
});
