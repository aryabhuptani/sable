"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function createObsidianLinkPlugin({
  env = process.env,
  instanceConfig,
  logger = console,
} = {}) {
  if (!instanceConfig) {
    throw new Error("createObsidianLinkPlugin requires instanceConfig.");
  }

  const vaultRoot = path.resolve(normalizeText(env.SABLE_OBSIDIAN_VAULT_ROOT) || instanceConfig.memoryRoot);
  const vaultName =
    normalizeText(env.SABLE_OBSIDIAN_VAULT_NAME) ||
    discoverObsidianVaultName(vaultRoot, { logger }) ||
    path.basename(vaultRoot);
  const host = normalizeText(env.SABLE_OBSIDIAN_LINK_HOST) || "127.0.0.1";
  const port = normalizeIntegerEnv(env.SABLE_OBSIDIAN_LINK_PORT, 4111);
  const enabled = normalizeBooleanEnv(env.SABLE_OBSIDIAN_LINKS_ENABLED, true);
  const baseUrl = normalizeText(
    normalizeText(env.SABLE_OBSIDIAN_BASE_URL) || discoverTailscaleMagicDnsBaseUrl()
  );

  let server = null;
  let serverAddress = null;

  function startServer() {
    if (!enabled) {
      logger.log?.(`[${timestamp()}] Obsidian link server disabled by config`);
      return;
    }

    try {
      server = http.createServer(handleRequest);
      server.on("error", (error) => {
        logger.error?.(
          `[${timestamp()}] Obsidian link server failed on ${host}:${port}: ${error.message}`
        );
      });
      server.listen(port, host, () => {
        serverAddress = server.address();
        const boundPort =
          typeof serverAddress === "object" && serverAddress
            ? serverAddress.port
            : port;
        logger.log?.(`[${timestamp()}] Obsidian link server listening on ${host}:${boundPort}`);
      });
    } catch (error) {
      logger.error?.(`[${timestamp()}] Failed starting Obsidian link server: ${error.message}`);
    }
  }

  function closeServer() {
    if (!server) {
      return;
    }
    try {
      server.close();
    } catch (error) {
      logger.error?.(`[${timestamp()}] Failed closing Obsidian link server: ${error.message}`);
    }
    server = null;
    serverAddress = null;
  }

  function getServerAddress() {
    return serverAddress;
  }

  function handleRequest(req, res) {
    const method = normalizeText(req?.method || "GET").toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      respondHtml(
        res,
        405,
        buildObsidianRedirectPage({
          title: "Method not allowed",
          heading: "Method not allowed",
          body: "<p>This endpoint only supports GET.</p>",
        }),
        method
      );
      return;
    }

    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(method !== "HEAD" ? "ok" : undefined);
      return;
    }

    if (requestUrl.pathname !== "/obsidian/open") {
      respondHtml(
        res,
        404,
        buildObsidianRedirectPage({
          title: "Not found",
          heading: "Not found",
          body: "<p>This Sable link endpoint only serves Obsidian note redirects.</p>",
        }),
        method
      );
      return;
    }

    const requestedPath = normalizeText(requestUrl.searchParams.get("path"));
    const line = normalizeText(requestUrl.searchParams.get("line"));
    const normalizedNote = normalizeObsidianNotePath(requestedPath);
    if (!normalizedNote) {
      respondHtml(
        res,
        400,
        buildObsidianRedirectPage({
          title: "Invalid note path",
          heading: "Invalid note path",
          body: "<p>The requested markdown note is missing, outside the vault, or not supported.</p>",
        }),
        method
      );
      return;
    }

    const obsidianUri = buildObsidianUriForRelativePath(normalizedNote.relativePath);
    const lineHint = line ? `<p>Original line hint: ${escapeHtml(line)}</p>` : "";
    respondHtml(
      res,
      200,
      buildObsidianRedirectPage({
        title: `Open ${path.basename(normalizedNote.absolutePath)} in Obsidian`,
        heading: `Open ${path.basename(normalizedNote.absolutePath)} in Obsidian`,
        body: [
          `<p>If Obsidian does not launch automatically, tap the button below.</p>`,
          `<p><a href="${escapeHtml(obsidianUri)}">Open in Obsidian</a></p>`,
          `<p>Vault: ${escapeHtml(vaultName)}</p>`,
          `<p>Note: ${escapeHtml(normalizedNote.relativePath)}</p>`,
          lineHint,
        ].join(""),
        obsidianUri,
      }),
      method
    );
  }

  function buildObsidianUriForRelativePath(relativePath) {
    const params = new URLSearchParams({
      vault: vaultName,
      file: relativePath,
    });
    return `obsidian://open?${params.toString()}`;
  }

  function normalizeObsidianNotePath(filePath) {
    const normalized = normalizeText(filePath);
    if (!normalized) {
      return null;
    }

    const absolutePath = path.resolve(normalized);
    const relativePath = path.relative(vaultRoot, absolutePath);
    const normalizedRelativePath = relativePath.split(path.sep).join("/");
    const extension = path.extname(absolutePath).toLowerCase();

    if (
      (extension !== ".md" && extension !== ".markdown") ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      return null;
    }

    return {
      absolutePath,
      relativePath: normalizedRelativePath,
    };
  }

  function buildSignalObsidianLink(filePath, line = "") {
    if (!enabled || !baseUrl) {
      return "";
    }

    const normalized = normalizeObsidianNotePath(filePath);
    if (!normalized) {
      return "";
    }

    const params = new URLSearchParams({ path: normalized.absolutePath });
    const lineText = normalizeText(line);
    if (lineText) {
      params.set("line", lineText);
    }
    return `${baseUrl.replace(/\/+$/, "")}/obsidian/open?${params.toString()}`;
  }

  function rewriteMarkdownDocumentReferencesForSignal(text) {
    const input = String(text || "");
    if (!input || !enabled || !baseUrl) {
      return input;
    }

    return input.replace(/\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g, (match, label, rawTarget) => {
      const target = String(rawTarget || "").replace(/^<|>$/g, "");
      const parsed = parseMarkdownFileTarget(target);
      if (!parsed) {
        return match;
      }

      const link = buildSignalObsidianLink(parsed.filePath, parsed.line);
      if (!link) {
        return match;
      }

      const cleanedLabel = normalizeText(label) || path.basename(parsed.filePath);
      return `${cleanedLabel}: ${link}`;
    });
  }

  return {
    baseUrl,
    buildSignalObsidianLink,
    closeServer,
    enabled,
    getServerAddress,
    handleRequest,
    host,
    normalizeObsidianNotePath,
    port,
    rewriteMarkdownDocumentReferencesForSignal,
    startServer,
    vaultName,
    vaultRoot,
  };
}

function discoverTailscaleMagicDnsBaseUrl() {
  try {
    const stdout = execFileSync("tailscale", ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(stdout);
    const rawDnsName = normalizeText(parsed?.Self?.DNSName);
    if (!rawDnsName) {
      return "";
    }
    const dnsName = rawDnsName.replace(/\.+$/, "");
    return dnsName ? `https://${dnsName}` : "";
  } catch (error) {
    return "";
  }
}

function discoverObsidianVaultName(vaultRoot, { logger = console } = {}) {
  const normalizedRoot = normalizeText(vaultRoot);
  if (!normalizedRoot) {
    return "";
  }

  const syncRoot = path.join(os.homedir(), ".config", "obsidian-headless", "sync");
  if (!fs.existsSync(syncRoot)) {
    return "";
  }

  try {
    for (const entry of fs.readdirSync(syncRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const configPath = path.join(syncRoot, entry.name, "config.json");
      if (!fs.existsSync(configPath)) {
        continue;
      }

      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (path.resolve(parsed?.vaultPath || "") !== normalizedRoot) {
        continue;
      }

      return normalizeText(parsed?.vaultName);
    }
  } catch (error) {
    logger.error?.(
      `[${timestamp()}] Failed discovering Obsidian vault name for ${normalizedRoot}: ${error.message}`
    );
  }

  return "";
}

function parseMarkdownFileTarget(target) {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget || !normalizedTarget.startsWith("/")) {
    return null;
  }

  const lineMatch = normalizedTarget.match(/^(.*\.(?:md|markdown)):(\d+)$/i);
  if (lineMatch) {
    return {
      filePath: lineMatch[1],
      line: lineMatch[2],
    };
  }

  if (/\.(md|markdown)$/i.test(normalizedTarget)) {
    return {
      filePath: normalizedTarget,
      line: "",
    };
  }

  return null;
}

function respondHtml(res, statusCode, html, method = "GET") {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(html);
}

function buildObsidianRedirectPage({ title, heading, body, obsidianUri = "" }) {
  const escapedTitle = escapeHtml(title || "Open in Obsidian");
  const escapedHeading = escapeHtml(heading || "Open in Obsidian");
  const escapedUri = escapeHtml(obsidianUri);
  const redirectScript = escapedUri
    ? `<script>window.addEventListener("load", () => { window.location.replace(${JSON.stringify(
        obsidianUri
      )}); });</script>`
    : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapedTitle}</title>`,
    escapedUri ? `<meta http-equiv="refresh" content="0;url=${escapedUri}">` : "",
    "</head>",
    "<body>",
    `<h1>${escapedHeading}</h1>`,
    body || "",
    redirectScript,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("");
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBooleanEnv(value, defaultValue) {
  const normalized = normalizeText(String(value || ""));
  if (!normalized) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(normalized.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized.toLowerCase())) {
    return false;
  }

  return defaultValue;
}

function normalizeIntegerEnv(value, defaultValue) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function timestamp() {
  return new Date().toISOString();
}

module.exports = {
  createObsidianLinkPlugin,
  discoverObsidianVaultName,
  discoverTailscaleMagicDnsBaseUrl,
  parseMarkdownFileTarget,
};
