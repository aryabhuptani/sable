#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createInstanceConfig } = require("../instance/instance-config");

const DEFAULT_TRIAGE_LIMIT = 25;
const DEFAULT_STALE_DAYS = 21;
const DEFAULT_READY_TIMEOUT_MS = 5 * 60 * 1000;
const WHATSAPP_WEB_URL = "https://web.whatsapp.com/";
const MODERN_CHROME_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function defaultApprovedChatsPath(env = process.env) {
  const explicit = normalizeText(env.SABLE_WHATSAPP_APPROVED_CHATS_PATH);
  if (explicit) {
    return path.resolve(expandHome(explicit));
  }
  const instance = createInstanceConfig({ env });
  return path.join(instance.homeDir, ".config", "sable", "whatsapp-approved-chats.json");
}

function defaultSessionPath(env = process.env) {
  const explicit = normalizeText(env.SABLE_WHATSAPP_SESSION_PATH);
  if (explicit) {
    return path.resolve(expandHome(explicit));
  }
  const instance = createInstanceConfig({ env });
  return path.join(instance.homeDir, ".local", "state", "sable-whatsapp");
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "triage", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }
    args[token.slice(2)] = rest[index + 1] || "";
    index += 1;
  }
  return args;
}

function loadApprovedChats({ env = process.env, filePath = defaultApprovedChatsPath(env) } = {}) {
  const approved = [];
  for (const value of splitList(env.SABLE_WHATSAPP_APPROVED_CHATS)) {
    approved.push(normalizeApprovedChat({ id: value, name: value }));
  }
  if (fs.existsSync(filePath)) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : parsed.approvedChats;
    for (const entry of Array.isArray(entries) ? entries : []) {
      approved.push(normalizeApprovedChat(entry));
    }
  }
  return dedupeApprovedChats(approved.filter((entry) => entry.id || entry.name));
}

function normalizeApprovedChat(entry) {
  if (typeof entry === "string") {
    return { id: normalizeText(entry), name: normalizeText(entry) };
  }
  return {
    id: normalizeText(entry?.id || entry?.chatId || entry?.serializedId),
    name: normalizeText(entry?.name || entry?.title),
  };
}

function dedupeApprovedChats(entries) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = `${normalizeComparable(entry.id)}|${normalizeComparable(entry.name)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function isApprovedChat(chat, approvedChats) {
  if (!Array.isArray(approvedChats) || approvedChats.length === 0) {
    return false;
  }
  const id = normalizeComparable(chat.id);
  const name = normalizeComparable(chat.name);
  return approvedChats.some((approved) => {
    const approvedId = normalizeComparable(approved.id);
    const approvedName = normalizeComparable(approved.name);
    return (approvedId && approvedId === id) || (approvedName && approvedName === name);
  });
}

function normalizeSnapshot(raw) {
  const timestamp = raw.lastMessageAt || raw.last_message_at || raw.timestamp || "";
  return {
    id: normalizeText(raw.id || raw.chatId || raw.serializedId),
    name: normalizeText(raw.name || raw.title || raw.pushname),
    unreadCount: normalizeInteger(raw.unreadCount ?? raw.unread_count, 0),
    isGroup: Boolean(raw.isGroup ?? raw.is_group),
    isMuted: Boolean(raw.isMuted ?? raw.is_muted),
    lastMessageAt: timestamp ? new Date(timestamp) : null,
    lastMessageFromMe: Boolean(raw.lastMessageFromMe ?? raw.last_message_from_me),
    snippet: normalizeText(raw.snippet || raw.body || raw.lastMessage || raw.last_message),
  };
}

function classifyChat(chat, { now = new Date(), staleDays = DEFAULT_STALE_DAYS } = {}) {
  if (chat.isMuted) {
    return "ignored";
  }
  if (chat.lastMessageFromMe) {
    return "ignored";
  }
  const ageMs = chat.lastMessageAt instanceof Date && !Number.isNaN(chat.lastMessageAt.getTime())
    ? now.getTime() - chat.lastMessageAt.getTime()
    : null;
  if (ageMs !== null && ageMs > staleDays * 24 * 60 * 60 * 1000) {
    return "ignored";
  }
  if (chat.unreadCount >= 1 && !chat.isGroup) {
    return "now";
  }
  if (chat.unreadCount >= 3 && chat.isGroup) {
    return "today";
  }
  if (chat.unreadCount > 0) {
    return "today";
  }
  return "low";
}

function formatTriageReport(chats, {
  approvedChats = [],
  limit = DEFAULT_TRIAGE_LIMIT,
  now = new Date(),
  staleDays = DEFAULT_STALE_DAYS,
} = {}) {
  if (!approvedChats.length) {
    return [
      "WhatsApp queue review: no approved chats configured.",
      "",
      `Add approved chats in ${defaultApprovedChatsPath()} or SABLE_WHATSAPP_APPROVED_CHATS before running triage.`,
      "Nothing was surfaced.",
    ].join("\n");
  }

  const buckets = {
    now: [],
    today: [],
    low: [],
    ignored: [],
  };
  for (const rawChat of chats.map(normalizeSnapshot)) {
    if (!isApprovedChat(rawChat, approvedChats)) {
      buckets.ignored.push({ ...rawChat, reason: "not approved" });
      continue;
    }
    buckets[classifyChat(rawChat, { now, staleDays })].push(rawChat);
  }

  const visibleCount = buckets.now.length + buckets.today.length + buckets.low.length;
  const lines = [
    `WhatsApp queue review: ${visibleCount} approved chat${visibleCount === 1 ? "" : "s"} surfaced.`,
    `Needs reply now: ${buckets.now.length}`,
    `Reply today: ${buckets.today.length}`,
    `Low-priority / can wait: ${buckets.low.length}`,
    `Ignored / filtered: ${buckets.ignored.length}`,
  ];
  appendBucket(lines, "Needs reply now", buckets.now, limit);
  appendBucket(lines, "Reply today", buckets.today, limit);
  appendBucket(lines, "Low-priority / can wait", buckets.low, limit);
  return lines.join("\n");
}

function appendBucket(lines, title, chats, limit) {
  if (!chats.length) {
    return;
  }
  lines.push("", `${title}:`);
  for (const chat of chats.slice(0, limit)) {
    const unread = chat.unreadCount ? ` unread=${chat.unreadCount}` : "";
    const group = chat.isGroup ? " group" : "";
    const snippet = chat.snippet ? ` - ${truncate(chat.snippet, 160)}` : "";
    lines.push(`- ${chat.name || chat.id}${group}${unread}${snippet}`);
  }
}

async function commandTriage(args, env = process.env) {
  const approvedChats = loadApprovedChats({
    env,
    filePath: args["approved-chats"] || defaultApprovedChatsPath(env),
  });
  const limit = normalizeInteger(args.limit, DEFAULT_TRIAGE_LIMIT);
  const staleDays = normalizeInteger(args["stale-days"], DEFAULT_STALE_DAYS);
  const chats = args["input-json"]
    ? JSON.parse(fs.readFileSync(args["input-json"], "utf8"))
    : await fetchWhatsAppChats({ env, args });
  console.log(formatTriageReport(chats, { approvedChats, limit, staleDays }));
  return 0;
}

async function commandListChats(args, env = process.env) {
  const limit = normalizeInteger(args.limit, 50);
  const chats = args["input-json"]
    ? JSON.parse(fs.readFileSync(args["input-json"], "utf8"))
    : await fetchWhatsAppChats({ env, args });
  for (const chat of chats.map(normalizeSnapshot).slice(0, limit)) {
    const unread = chat.unreadCount ? ` unread=${chat.unreadCount}` : "";
    const group = chat.isGroup ? " group" : "";
    const muted = chat.isMuted ? " muted" : "";
    console.log(`${chat.name || "(unnamed)"} | ${chat.id}${group}${muted}${unread}`);
  }
  return 0;
}

async function commandExportApproved(args, env = process.env) {
  const approvedChats = loadApprovedChats({
    env,
    filePath: args["approved-chats"] || defaultApprovedChatsPath(env),
  });
  if (!approvedChats.length) {
    throw new Error(`No approved WhatsApp chats configured in ${defaultApprovedChatsPath(env)}.`);
  }
  const outputPath = path.resolve(expandHome(args.out || args.output || "whatsapp-approved-export.md"));
  const exportResult = await exportApprovedChatsWithBrowser({
    env,
    approvedChats,
    outputPath,
    timeoutMs: normalizeInteger(args["ready-timeout-ms"], DEFAULT_READY_TIMEOUT_MS),
  });
  console.log(`Wrote WhatsApp approved-chat export: ${exportResult.outputPath}`);
  for (const chat of exportResult.chats) {
    console.log(`- ${chat.name}: ${chat.characters} characters`);
  }
  return 0;
}

function commandInitConfig(args, env = process.env) {
  const filePath = args.file || defaultApprovedChatsPath(env);
  if (fs.existsSync(filePath) && args.force !== "true") {
    console.error(`${filePath} already exists. Pass --force true to overwrite.`);
    return 1;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({
      approvedChats: [
        {
          id: "example-1234567890@c.us",
          name: "Example Person",
          notes: "Replace with a real WhatsApp chat id or exact chat name.",
        },
      ],
    }, null, 2)}\n`,
    "utf8"
  );
  console.log(`Wrote WhatsApp approved-chat config: ${filePath}`);
  return 0;
}

async function fetchWhatsAppChats({ env = process.env, args = {} } = {}) {
  let whatsapp;
  try {
    whatsapp = require("whatsapp-web.js");
  } catch (error) {
    throw new Error(
      "whatsapp-web.js is not installed. Install it in the Sable repo with `npm install whatsapp-web.js qrcode-terminal` before running live WhatsApp triage."
    );
  }
  const { Client, LocalAuth } = whatsapp;
  const sessionPath = defaultSessionPath(env);
  const readyTimeoutMs = normalizeInteger(
    args["ready-timeout-ms"] || env.SABLE_WHATSAPP_READY_TIMEOUT_MS,
    DEFAULT_READY_TIMEOUT_MS
  );
  const qrFile = normalizeText(args["qr-file"] || env.SABLE_WHATSAPP_QR_FILE);
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    // whatsapp-web.js still defaults to a Chrome 101 UA, which WhatsApp Web now rejects.
    userAgent: MODERN_CHROME_USER_AGENT,
    webVersionCache: { type: "none" },
    puppeteer: {
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  });
  client.on("qr", (qr) => {
    if (qrFile) {
      fs.mkdirSync(path.dirname(path.resolve(qrFile)), { recursive: true });
      fs.writeFileSync(qrFile, `${qr}\n`, "utf8");
      console.error(`WhatsApp QR raw payload written to ${qrFile}`);
    }
    try {
      require("qrcode-terminal").generate(qr, { small: true });
    } catch {
      console.error(`WhatsApp QR login required. Install qrcode-terminal for terminal QR rendering. Raw QR: ${qr}`);
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WhatsApp Web to become ready.")), readyTimeoutMs);
    client.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
    client.once("auth_failure", (message) => {
      clearTimeout(timer);
      reject(new Error(`WhatsApp auth failed: ${message}`));
    });
    client.initialize().catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  try {
    const chats = await client.getChats();
    return chats.map((chat) => {
      const last = chat.lastMessage || {};
      return normalizeSnapshot({
        id: chat.id?._serialized || "",
        name: chat.name || chat.formattedTitle || "",
        unreadCount: chat.unreadCount || 0,
        isGroup: Boolean(chat.isGroup),
        isMuted: Boolean(chat.isMuted),
        lastMessageAt: last.timestamp ? new Date(last.timestamp * 1000).toISOString() : "",
        lastMessageFromMe: Boolean(last.fromMe),
        snippet: last.body || "",
      });
    });
  } finally {
    await client.destroy();
  }
}

async function exportApprovedChatsWithBrowser({
  env = process.env,
  approvedChats = [],
  outputPath,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
} = {}) {
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    throw new Error(
      "puppeteer is not installed. Install it in the Sable repo with `npm install puppeteer` before exporting WhatsApp messages."
    );
  }

  const sessionDir = path.join(defaultSessionPath(env), "session");
  clearChromiumSingletons(sessionDir);
  const browser = await puppeteer.launch({
    headless: "new",
    userDataDir: sessionDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      `--user-agent=${MODERN_CHROME_USER_AGENT}`,
    ],
  });
  const page = await browser.newPage();
  await page.setUserAgent(MODERN_CHROME_USER_AGENT);
  try {
    await page.goto(WHATSAPP_WEB_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForSelector("div[role=\"grid\"]", { timeout: timeoutMs });
    const exported = [];
    for (const approved of approvedChats) {
      const chatName = approved.name || approved.id;
      await openChatByTitle(page, chatName, timeoutMs);
      await delay(4000);
      const chat = await page.evaluate((name) => {
        const main = document.querySelector("#main");
        return {
          name,
          header: main?.querySelector("header")?.innerText || "",
          text: main?.innerText || "",
        };
      }, chatName);
      exported.push(chat);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, formatApprovedChatExport(exported), "utf8");
    return {
      outputPath,
      chats: exported.map((chat) => ({
        name: chat.name,
        characters: chat.text.length,
      })),
    };
  } finally {
    await browser.close();
  }
}

async function openChatByTitle(page, chatName, timeoutMs) {
  const selector = `span[title="${cssStringEscape(chatName)}"]`;
  await page.waitForSelector(selector, { timeout: timeoutMs });
  const handle = await page.$(selector);
  if (!handle) {
    throw new Error(`Approved WhatsApp chat not found in visible chat list: ${chatName}`);
  }
  await handle.click({ clickCount: 1 });
}

function formatApprovedChatExport(chats) {
  return `${chats.map((chat) => {
    return [
      `# ${chat.name}`,
      "",
      `Header: ${chat.header}`,
      "",
      "```text",
      chat.text.trim(),
      "```",
      "",
    ].join("\n");
  }).join("\n---\n")}\n`;
}

async function asyncMain(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.command === "triage") {
    return commandTriage(args, env);
  }
  if (args.command === "list-chats") {
    return commandListChats(args, env);
  }
  if (args.command === "init-config") {
    return commandInitConfig(args, env);
  }
  if (args.command === "export-approved") {
    return commandExportApproved(args, env);
  }
  printUsage();
  return 1;
}

function printUsage() {
  console.error([
    "Usage:",
    "  whatsapp_cli.js init-config [--file path] [--force true]",
    "  whatsapp_cli.js list-chats [--limit 50] [--input-json path] [--qr-file path] [--ready-timeout-ms 300000]",
    "  whatsapp_cli.js triage [--limit 25] [--stale-days 21] [--approved-chats path] [--input-json path] [--qr-file path] [--ready-timeout-ms 300000]",
    "  whatsapp_cli.js export-approved --out path [--approved-chats path] [--ready-timeout-ms 300000]",
  ].join("\n"));
}

function clearChromiumSingletons(sessionDir) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      fs.rmSync(path.join(sessionDir, name), { force: true });
    } catch {}
  }
}

function cssStringEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function truncate(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  asyncMain().then((code) => process.exit(code)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  asyncMain,
  classifyChat,
  defaultApprovedChatsPath,
  defaultSessionPath,
  formatTriageReport,
  isApprovedChat,
  loadApprovedChats,
  normalizeSnapshot,
  parseArgs,
  commandListChats,
  formatApprovedChatExport,
};
