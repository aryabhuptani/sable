#!/usr/bin/env node
"use strict";

const http = require("node:http");
const { execFileSync, spawnSync } = require("node:child_process");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4111;
const DEFAULT_HTTPS_PORT = "443";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    healthTimeoutMs: 2_000,
    host: process.env.SABLE_OBSIDIAN_LINK_HOST || DEFAULT_HOST,
    port: parseInteger(process.env.SABLE_OBSIDIAN_LINK_PORT, DEFAULT_PORT),
    httpsPort: process.env.SABLE_OBSIDIAN_TAILSCALE_HTTPS_PORT || DEFAULT_HTTPS_PORT,
    restartBridge: process.env.SABLE_OBSIDIAN_RESTART_BRIDGE_ON_UNHEALTHY === "1",
    serviceName: process.env.SABLE_SIGNAL_BRIDGE_SERVICE || "signal-codex-bridge.service",
    systemctl: process.env.SYSTEMCTL_BIN || "systemctl",
    tailscale: process.env.TAILSCALE_BIN || "tailscale",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--host") {
      options.host = argv[++index] || options.host;
    } else if (arg === "--port") {
      options.port = parseInteger(argv[++index], options.port);
    } else if (arg === "--https-port") {
      options.httpsPort = argv[++index] || options.httpsPort;
    } else if (arg === "--restart-bridge") {
      options.restartBridge = true;
    } else if (arg === "--health-timeout-ms") {
      options.healthTimeoutMs = parseInteger(argv[++index], options.healthTimeoutMs);
    } else if (arg === "--service-name") {
      options.serviceName = argv[++index] || options.serviceName;
    } else if (arg === "--systemctl") {
      options.systemctl = argv[++index] || options.systemctl;
    } else if (arg === "--tailscale") {
      options.tailscale = argv[++index] || options.tailscale;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getLocalHealthUrl({ host, port }) {
  return `http://${host}:${port}/healthz`;
}

function expectedProxyTarget({ host, port }) {
  return `http://${host}:${port}`;
}

function isServeConfigured(status, { dnsName = "", host, httpsPort, port }) {
  const web = status?.Web || {};
  const expectedProxy = expectedProxyTarget({ host, port });
  const hostnames = Object.keys(web);
  const candidateHosts = dnsName ? [normalizeServeHostname(dnsName, httpsPort)] : [];
  const hostsToCheck = candidateHosts.length ? candidateHosts : hostnames;

  return hostsToCheck.some((hostname) => {
    const handlers = web?.[hostname]?.Handlers || {};
    return Object.values(handlers).some((handler) => handler?.Proxy === expectedProxy);
  });
}

function normalizeServeHostname(dnsName, httpsPort = DEFAULT_HTTPS_PORT) {
  const hostname = String(dnsName || "").replace(/\.+$/, "");
  return `${hostname}:${httpsPort}`;
}

function readTailscaleStatus({ tailscale = "tailscale" } = {}) {
  const stdout = execFileSync(tailscale, ["status", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function readServeStatus({ tailscale = "tailscale" } = {}) {
  const stdout = execFileSync(tailscale, ["serve", "status", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

function checkLocalHealth({ host, port, timeoutMs }) {
  const url = getLocalHealthUrl({ host, port });
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      response.on("end", () => {
        resolve({
          ok: response.statusCode === 200,
          statusCode: response.statusCode,
          url,
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    request.on("error", (error) => {
      resolve({
        error: error.message,
        ok: false,
        url,
      });
    });
  });
}

function run(command, args, { dryRun = false } = {}) {
  const rendered = [command, ...args].join(" ");
  if (dryRun) {
    return { command: rendered, status: 0 };
  }
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    command: rendered,
    error: result.error?.message || "",
    status: result.status || 0,
    stderr: result.stderr || "",
    stdout: result.stdout || "",
  };
}

async function ensureObsidianServe(options) {
  const actions = [];
  const localHealth = await checkLocalHealth({
    host: options.host,
    port: options.port,
    timeoutMs: options.healthTimeoutMs,
  });

  if (!localHealth.ok && options.restartBridge) {
    const restart = run(options.systemctl, ["--user", "restart", options.serviceName], {
      dryRun: options.dryRun,
    });
    actions.push(restart);
    if ((restart.status || 0) === 0 && !options.dryRun) {
      await sleep(3_000);
      const retryHealth = await checkLocalHealth({
        host: options.host,
        port: options.port,
        timeoutMs: options.healthTimeoutMs,
      });
      localHealth.retryAfterRestart = retryHealth;
      localHealth.ok = retryHealth.ok;
      localHealth.statusCode = retryHealth.statusCode;
      localHealth.error = retryHealth.error;
    }
  }

  let tailscaleStatus = null;
  let serveStatus = null;
  let serveConfigured = false;
  let tailscaleError = "";

  try {
    tailscaleStatus = readTailscaleStatus({ tailscale: options.tailscale });
    serveStatus = readServeStatus({ tailscale: options.tailscale });
    serveConfigured = isServeConfigured(serveStatus, {
      dnsName: tailscaleStatus?.Self?.DNSName || "",
      host: options.host,
      httpsPort: options.httpsPort,
      port: options.port,
    });
  } catch (error) {
    tailscaleError = error.message;
  }

  if (!serveConfigured && !tailscaleError) {
    const serve = run(
      options.tailscale,
      [
        "serve",
        "--bg",
        "--yes",
        `--https=${options.httpsPort}`,
        expectedProxyTarget({ host: options.host, port: options.port }),
      ],
      { dryRun: options.dryRun }
    );
    actions.push(serve);
    if ((serve.status || 0) === 0 && !options.dryRun) {
      try {
        serveStatus = readServeStatus({ tailscale: options.tailscale });
        serveConfigured = isServeConfigured(serveStatus, {
          dnsName: tailscaleStatus?.Self?.DNSName || "",
          host: options.host,
          httpsPort: options.httpsPort,
          port: options.port,
        });
      } catch (error) {
        tailscaleError = error.message;
      }
    }
  }

  return {
    actions,
    dnsName: tailscaleStatus?.Self?.DNSName || "",
    localHealth,
    ok: Boolean(localHealth.ok && serveConfigured && !tailscaleError),
    serveConfigured,
    tailscaleBackendState: tailscaleStatus?.BackendState || "",
    tailscaleError,
    tailscaleIps: tailscaleStatus?.Self?.TailscaleIPs || [],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  return [
    "Usage: node tools/obsidian-link/ensure-serve.js [--dry-run] [--restart-bridge]",
    "",
    "Checks the local Obsidian redirect endpoint and repairs Tailscale Serve forwarding.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const result = await ensureObsidianServe(options);
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  ensureObsidianServe,
  expectedProxyTarget,
  getLocalHealthUrl,
  isServeConfigured,
  normalizeServeHostname,
  parseArgs,
};
