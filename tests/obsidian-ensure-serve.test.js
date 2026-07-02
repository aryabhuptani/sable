const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ensureObsidianServe,
  expectedProxyTarget,
  getLocalHealthUrl,
  hasFunnelExposure,
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

test("obsidian serve helper rejects matching proxy when Tailscale Funnel is enabled", () => {
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
    AllowFunnel: {
      "homebrain.tail1d4ba0.ts.net:443": true,
    },
  };

  const options = {
    dnsName: "homebrain.tail1d4ba0.ts.net.",
    host: "127.0.0.1",
    httpsPort: "443",
    port: 4111,
  };

  assert.equal(hasFunnelExposure(status, options), true);
  assert.equal(isServeConfigured(status, options), false);
});

test("obsidian serve helper parses repair options", () => {
  const options = parseArgs(["--dry-run", "--restart-bridge", "--port", "4222", "--https-port", "8443"]);
  assert.equal(options.dryRun, true);
  assert.equal(options.restartBridge, true);
  assert.equal(options.port, 4222);
  assert.equal(options.httpsPort, "8443");
});

async function createFakeTailscaleBin(tempDir) {
  const tailscaleBin = path.join(tempDir, "tailscale");
  await fs.writeFile(
    tailscaleBin,
    [
      "#!/bin/sh",
      'if [ "$1" = "status" ]; then',
      '  printf \'{"Self":{"DNSName":"homebrain.tail.test.","TailscaleIPs":["100.64.0.1"]},"BackendState":"Running"}\\n\'',
      'elif [ "$1" = "serve" ] && [ "$2" = "status" ]; then',
      "  printf '{\"Web\":{}}\\n'",
      "else",
      "  exit 9",
      "fi",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return tailscaleBin;
}

async function createFakeFunnelTailscaleBin(tempDir, port) {
  const tailscaleBin = path.join(tempDir, "tailscale-funnel");
  await fs.writeFile(
    tailscaleBin,
    [
      "#!/bin/sh",
      'if [ "$1" = "status" ]; then',
      '  printf \'{"Self":{"DNSName":"homebrain.tail.test.","TailscaleIPs":["100.64.0.1"]},"BackendState":"Running"}\\n\'',
      'elif [ "$1" = "serve" ] && [ "$2" = "status" ]; then',
      `  printf '{"Web":{"homebrain.tail.test:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:${port}"}}}},"AllowFunnel":{"homebrain.tail.test:443":true}}\\n'`,
      "else",
      "  exit 9",
      "fi",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return tailscaleBin;
}

function buildEnsureOptions(overrides = {}) {
  return {
    dryRun: true,
    healthTimeoutMs: 500,
    host: "127.0.0.1",
    httpsPort: "443",
    restartBridge: false,
    serviceName: "signal-codex-bridge.service",
    systemctl: "systemctl",
    ...overrides,
  };
}

test("obsidian serve helper dry-runs tailscale serve repair when proxy is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-obsidian-serve-"));
  const tailscaleBin = await createFakeTailscaleBin(tempDir);

  const server = http.createServer((request, response) => {
    response.writeHead(request.url === "/healthz" ? 200 : 404);
    response.end();
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const result = await ensureObsidianServe(
      buildEnsureOptions({
        port,
        tailscale: tailscaleBin,
      })
    );

    assert.equal(result.localHealth.ok, true);
    assert.equal(result.serveConfigured, false);
    assert.equal(result.ok, false);
    assert.deepEqual(result.actions, [
      {
        command: `${tailscaleBin} serve --bg --yes --https=443 http://127.0.0.1:${port}`,
        status: 0,
      },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("obsidian serve helper reports public Funnel exposure without repairing it", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-obsidian-serve-funnel-"));
  const server = http.createServer((request, response) => {
    response.writeHead(request.url === "/healthz" ? 200 : 404);
    response.end();
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const tailscaleBin = await createFakeFunnelTailscaleBin(tempDir, port);
    const result = await ensureObsidianServe(
      buildEnsureOptions({
        port,
        tailscale: tailscaleBin,
      })
    );

    assert.equal(result.localHealth.ok, true);
    assert.equal(result.funnelExposed, true);
    assert.equal(result.serveConfigured, false);
    assert.equal(result.ok, false);
    assert.deepEqual(result.actions, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("obsidian serve helper can dry-run bridge restart before repairing serve", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-obsidian-serve-"));
  const tailscaleBin = await createFakeTailscaleBin(tempDir);

  try {
    const result = await ensureObsidianServe(
      buildEnsureOptions({
        healthTimeoutMs: 50,
        port: 9,
        restartBridge: true,
        tailscale: tailscaleBin,
      })
    );

    assert.equal(result.localHealth.ok, false);
    assert.equal(result.serveConfigured, false);
    assert.equal(result.ok, false);
    assert.deepEqual(result.actions, [
      {
        command: "systemctl --user is-active --quiet signal-codex-bridge.service",
        status: 0,
      },
      {
        command: `write ${path.resolve(__dirname, "..", "apps", "signal-bridge", ".restart-requested")}`,
        status: 0,
      },
      {
        command: "systemctl --user start signal-codex-bridge.service",
        status: 0,
      },
      {
        command: `${tailscaleBin} serve --bg --yes --https=443 http://127.0.0.1:9`,
        status: 0,
      },
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
