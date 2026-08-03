#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  approvedChatsPath: defaultApprovedChatsPath,
  ensureState, isApprovedChat, loadApprovedChats, statePaths,
} = require("./config");
const { WhatsAppBrowserAdapter, loadPlaywright } = require("./browser-adapter");
const { WhatsAppStore } = require("./store");
const { syncApprovedChats } = require("./sync");
const { exportApproved, markdown } = require("./export");
const { directScan } = require("./direct-scan");

const DEFAULT_TRIAGE_LIMIT = 25;
const DEFAULT_STALE_DAYS = 21;

function defaultSessionPath(env = process.env) { return statePaths(env).root; }
function parseArgs(argv = process.argv.slice(2)) {
  const [command = "triage", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (!rest[index + 1] || rest[index + 1].startsWith("--")) args[key] = "true";
    else { args[key] = rest[index + 1]; index += 1; }
  }
  return args;
}
function approvedChatsPathFromArgs(args, env = process.env) {
  return args["approved-config"] || args["approved-chats"] || defaultApprovedChatsPath(env);
}

function normalizeSnapshot(raw) {
  const timestamp = raw.lastMessageAt || raw.last_message_at || raw.timestamp || "";
  return {
    id: text(raw.id || raw.chatId || raw.serializedId), name: text(raw.name || raw.title || raw.pushname),
    unreadCount: integer(raw.unreadCount ?? raw.unread_count, 0), isGroup: Boolean(raw.isGroup ?? raw.is_group),
    isMuted: Boolean(raw.isMuted ?? raw.is_muted), lastMessageAt: timestamp ? new Date(timestamp) : null,
    lastMessageFromMe: Boolean(raw.lastMessageFromMe ?? raw.last_message_from_me),
    snippet: text(raw.snippet || raw.body || raw.lastMessage || raw.last_message),
  };
}
function classifyChat(chat, { now = new Date(), staleDays = DEFAULT_STALE_DAYS } = {}) {
  if (chat.isMuted || chat.lastMessageFromMe) return "ignored";
  const age = validDate(chat.lastMessageAt) ? now.getTime() - chat.lastMessageAt.getTime() : null;
  if (age !== null && age > staleDays * 86_400_000) return "ignored";
  if (chat.unreadCount >= 1 && !chat.isGroup) return "now";
  if (chat.unreadCount > 0) return "today";
  return "low";
}
function formatTriageReport(chats, { approvedChats = [], limit = DEFAULT_TRIAGE_LIMIT, now = new Date(), staleDays = DEFAULT_STALE_DAYS } = {}) {
  if (!approvedChats.length) return `WhatsApp queue review: no approved chats configured.\n\nAdd approved chats in ${defaultApprovedChatsPath()} or SABLE_WHATSAPP_APPROVED_CHATS before running triage.\nNothing was surfaced.`;
  const buckets = { now: [], today: [], low: [], ignored: [] };
  for (const chat of chats.map(normalizeSnapshot)) {
    if (!isApprovedChat(chat, approvedChats)) buckets.ignored.push(chat);
    else buckets[classifyChat(chat, { now, staleDays })].push(chat);
  }
  const visible = buckets.now.length + buckets.today.length + buckets.low.length;
  const lines = [`WhatsApp queue review: ${visible} approved chat${visible === 1 ? "" : "s"} surfaced.`, `Needs reply now: ${buckets.now.length}`, `Reply today: ${buckets.today.length}`, `Low-priority / can wait: ${buckets.low.length}`, `Ignored / filtered: ${buckets.ignored.length}`];
  for (const [key, title] of [["now", "Needs reply now"], ["today", "Reply today"], ["low", "Low-priority / can wait"]]) {
    if (!buckets[key].length) continue;
    lines.push("", `${title}:`);
    for (const chat of buckets[key].slice(0, limit)) lines.push(`- ${chat.name || chat.id}${chat.isGroup ? " group" : ""}${chat.unreadCount ? ` unread=${chat.unreadCount}` : ""}${chat.snippet ? ` - ${truncate(chat.snippet, 160)}` : ""}`);
  }
  return lines.join("\n");
}

function openStore(env) {
  const paths = ensureState(statePaths(env));
  return { paths, store: new WhatsAppStore(paths.databasePath) };
}
function indexedSnapshots(store) {
  return store.listChats().map((chat) => ({
    id: chat.id, name: chat.name, isGroup: Boolean(chat.is_group), unreadCount: 0,
    lastMessageAt: chat.last_message_at, snippet: store.messagesForChat(chat.id).at(-1)?.text || "",
  }));
}
async function commandTriage(args, env = process.env) {
  const approvedChats = loadApprovedChats({ env, filePath: approvedChatsPathFromArgs(args, env) });
  let chats;
  if (args["input-json"]) chats = JSON.parse(fs.readFileSync(args["input-json"], "utf8"));
  else {
    const { store } = openStore(env);
    try { chats = indexedSnapshots(store); } finally { store.close(); }
  }
  console.log(formatTriageReport(chats, { approvedChats, limit: integer(args.limit, DEFAULT_TRIAGE_LIMIT), staleDays: integer(args["stale-days"], DEFAULT_STALE_DAYS) }));
  return 0;
}
async function commandListChats(args, env = process.env) {
  if (args["input-json"]) {
    for (const chat of JSON.parse(fs.readFileSync(args["input-json"], "utf8")).map(normalizeSnapshot).slice(0, integer(args.limit, 50))) console.log(`${chat.name || "(unnamed)"} | ${chat.id}${chat.isGroup ? " group" : ""}${chat.isMuted ? " muted" : ""}${chat.unreadCount ? ` unread=${chat.unreadCount}` : ""}`);
    return 0;
  }
  const { store } = openStore(env);
  try { for (const chat of store.listChats().slice(0, integer(args.limit, 50))) console.log(`${chat.name} | ${chat.id} messages=${chat.message_count}${chat.last_message_at ? ` last=${chat.last_message_at}` : ""}`); }
  finally { store.close(); }
  return 0;
}
function commandInitConfig(args, env = process.env) {
  const filePath = args.file || defaultApprovedChatsPath(env);
  if (fs.existsSync(filePath) && args.force !== "true") { console.error(`${filePath} already exists. Pass --force true to overwrite.`); return 1; }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ approvedChats: [{ id: "example-1234567890@c.us", name: "Example Person", notes: "Replace with a real WhatsApp chat id or exact chat name." }] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Wrote WhatsApp approved-chat config: ${filePath}`);
  return 0;
}
async function withAdapter(args, env, callback) {
  const paths = statePaths(env);
  if (args["artifact-dir"]) paths.artifactsDir = path.resolve(args["artifact-dir"]);
  ensureState(paths);
  const releaseLock = acquireWorkerLock(paths.lockPath);
  const adapter = new WhatsAppBrowserAdapter({ paths, headless: boolean(args.headless, true), timeoutMs: integer(args["ready-timeout-ms"], 300_000) });
  try { await adapter.connect(); return await callback(adapter, paths); }
  finally { await adapter.close(); releaseLock(); }
}
async function commandConnect(args, env = process.env) {
  return withAdapter(args, env, async (adapter, paths) => {
    const status = adapter.connectionStatus || await adapter.status();
    if (!status.connected && status.loginRequired) {
      await adapter.page.waitForTimeout(integer(args["login-settle-ms"], 3_000));
    }
    const loginArtifact = !status.connected && args["capture-login"] !== "false"
      ? await adapter.captureArtifact("whatsapp-login")
      : null;
    let stopRefreshing = () => {};
    if (loginArtifact && args.wait === "true") {
      loginArtifact.currentScreenshot = path.join(paths.artifactsDir, "current.png");
      stopRefreshing = await adapter.startRefreshingScreenshot(
        loginArtifact.currentScreenshot,
        integer(args["login-refresh-ms"], 10_000)
      );
    }
    console.log(JSON.stringify({ ...status, profileDir: paths.profileDir, loginArtifact }, null, 2));
    if (!status.connected && args.headless !== "false") console.error("Login required. Re-run with --headless false and scan the QR code.");
    if (args.wait === "true") {
      try { await adapter.waitUntilReady(); }
      finally { stopRefreshing(); }
    }
    return status.connected ? 0 : 2;
  });
}
async function commandSync(args, env = process.env) {
  const approvedChats = loadApprovedChats({ env, filePath: approvedChatsPathFromArgs(args, env) });
  if (!approvedChats.length) throw new Error(`No approved WhatsApp chats configured in ${approvedChatsPathFromArgs(args, env)}.`);
  return withAdapter(args, env, async (adapter, paths) => {
    await adapter.waitUntilReady();
    const store = new WhatsAppStore(paths.databasePath);
    const runId = store.beginSyncRun();
    try {
      const results = await syncApprovedChats({ adapter, store, approvedChats, limits: {
        until: args.until, maxMessages: args["max-messages"], maxScrolls: args["max-scrolls"],
        maxTimeMs: args["max-time-ms"], ignoreCheckpoint: args["ignore-checkpoint"] === "true",
      } });
      const failures = results.filter((result) => !result.ok);
      const successes = results.filter((result) => result.ok);
      for (const result of successes) console.log(`${result.chat.name}: indexed=${result.messages} scrolls=${result.scrolls} stopped=${result.stopReason}`);
      for (const result of failures) console.error(`${result.chat.name}: sync failed: ${result.error}`);
      store.finishSyncRun(runId, {
        status: failures.length ? "partial" : "ok",
        chatsOk: successes.length,
        chatsFailed: failures.length,
        messagesSeen: successes.reduce((sum, result) => sum + result.messages, 0),
        error: failures.map((result) => `${result.chat.name}: ${result.error}`).join("; ") || null,
      });
      return failures.length ? 1 : 0;
    } catch (error) {
      store.finishSyncRun(runId, { status: "failed", chatsFailed: approvedChats.length, error: error.message });
      throw error;
    } finally { store.close(); }
  });
}
async function commandDirectScan(args, env = process.env) {
  const chatTitle = text(args["chat-title"]);
  if (!chatTitle) throw new Error("Pass --chat-title with the exact approved chat title.");
  const approvedChats = loadApprovedChats({ env, filePath: approvedChatsPathFromArgs(args, env) });
  if (!approvedChats.some((chat) => chat.name === chatTitle)) throw new Error(`Exact chat title is not approved: ${chatTitle}`);
  return withAdapter(args, env, async (adapter, paths) => {
    await adapter.waitUntilReady();
    const workflow = text(args.workflow) || foldWorkflow(chatTitle);
    const checkpointPath = path.resolve(args.checkpoint || path.join(paths.root, "workflows", `${workflow}.json`));
    const outputDir = path.resolve(args["output-dir"] || path.join(paths.root, "downloads", workflow));
    const result = await directScan({ adapter, chatTitle, checkpointPath, outputDir });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  });
}
function commandSearch(args, env = process.env) {
  const query = args.query || args.q;
  if (!query) throw new Error("Pass --query for local search.");
  const { store } = openStore(env);
  try {
    const results = store.search(query, { chatId: args.chat, limit: integer(args.limit, 50) });
    if (args.json === "true") console.log(JSON.stringify(results, null, 2));
    else for (const row of results) console.log(`${row.timestamp || "(unknown time)"} | ${row.chat_name} | ${row.sender || "(unknown sender)"} | ${row.text}${row.attachment_type ? ` [${row.attachment_type}${row.filename ? `: ${row.filename}` : ""}]` : ""}`);
  } finally { store.close(); }
  return 0;
}
function commandExportApproved(args, env = process.env) {
  const approvedChats = loadApprovedChats({ env, filePath: approvedChatsPathFromArgs(args, env) });
  if (!approvedChats.length) throw new Error(`No approved WhatsApp chats configured in ${approvedChatsPathFromArgs(args, env)}.`);
  const outputPath = path.resolve(args.out || args.output || `whatsapp-approved-export.${args.format === "json" ? "json" : "md"}`);
  const { store } = openStore(env);
  try {
    const result = exportApproved(store, approvedChats, outputPath, args.format === "json" ? "json" : "markdown");
    console.log(`Wrote WhatsApp approved-chat export: ${result.outputPath}`);
    for (const chat of result.chats) console.log(`- ${chat.name}: ${chat.messages} messages`);
  } finally { store.close(); }
  return 0;
}
function commandStatus(args, env = process.env) {
  const paths = statePaths(env);
  const approved = loadApprovedChats({ env, filePath: approvedChatsPathFromArgs(args, env) });
  let playwright = true;
  try { loadPlaywright(); } catch { playwright = false; }
  let indexedChats = 0;
  let latestSync = null;
  if (fs.existsSync(paths.databasePath)) { const store = new WhatsAppStore(paths.databasePath); try { indexedChats = store.listChats().length; latestSync = store.latestSyncRun(); } finally { store.close(); } }
  console.log(JSON.stringify({ stateRoot: paths.root, profileDir: paths.profileDir, databasePath: paths.databasePath, databaseExists: fs.existsSync(paths.databasePath), approvedChats: approved.length, indexedChats, playwright, latestSync }, null, 2));
  return 0;
}
function commandDoctor(args, env = process.env) {
  const paths = statePaths(env);
  const checks = [];
  checks.push({ name: "approved-config", ok: fs.existsSync(approvedChatsPathFromArgs(args, env)), path: approvedChatsPathFromArgs(args, env) });
  try { loadApprovedChats({ env, filePath: approvedChatsPathFromArgs(args, env) }); checks.push({ name: "approved-config-json", ok: true }); } catch (error) { checks.push({ name: "approved-config-json", ok: false, detail: error.message }); }
  try { loadPlaywright(); checks.push({ name: "playwright", ok: true }); } catch (error) { checks.push({ name: "playwright", ok: false, detail: error.message }); }
  try { ensureState(paths); fs.accessSync(paths.root, fs.constants.R_OK | fs.constants.W_OK); checks.push({ name: "state-directory", ok: true, path: paths.root }); } catch (error) { checks.push({ name: "state-directory", ok: false, detail: error.message }); }
  try {
    const store = new WhatsAppStore(paths.databasePath);
    const latestSync = store.latestSyncRun();
    checks.push({ name: "sqlite", ok: store.schemaVersion() === 3, schemaVersion: store.schemaVersion(), fts: store.ftsAvailable });
    checks.push({
      name: "sync-health",
      ok: !latestSync || latestSync.status === "ok",
      detail: latestSync ? `${latestSync.status} at ${latestSync.finished_at || latestSync.started_at}` : "No sync has completed yet.",
    });
    store.close();
  } catch (error) { checks.push({ name: "sqlite", ok: false, detail: error.message }); }
  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({ ok, checks }, null, 2));
  return ok ? 0 : 1;
}
function formatApprovedChatExport(chats) { return markdown(chats.map((chat) => ({ chat: { name: chat.name }, messages: [{ timestamp: "", sender: "", text: chat.text }] }))); }

async function asyncMain(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const commands = {
    triage: commandTriage, "list-chats": commandListChats, "init-config": commandInitConfig,
    connect: commandConnect, status: commandStatus, sync: commandSync, "direct-scan": commandDirectScan, search: commandSearch,
    "search-messages": commandSearch,
    "export-approved": commandExportApproved, doctor: commandDoctor,
  };
  if (!commands[args.command]) { printUsage(); return 1; }
  return commands[args.command](args, env);
}
function printUsage() {
  console.error([
    "Usage: whatsapp_cli.js <command> [options]",
    "  init-config [--file path] [--force true]",
    "  connect [--headless false] [--wait] [--ready-timeout-ms 300000]",
    "  status",
    "  sync [--approved-config path] [--until ISO] [--max-messages 5000] [--max-scrolls 500] [--max-time-ms 600000]",
    "  direct-scan --chat-title exact --workflow name --output-dir private-dir [--checkpoint path]",
    "  search --query text [--chat id] [--limit 50] [--json]",
    "  list-chats [--limit 50]",
    "  triage [--limit 25] [--stale-days 21] [--input-json path]",
    "  export-approved --out path [--format markdown|json]",
    "  doctor",
  ].join("\n"));
}
function text(value) { return String(value || "").trim(); }
function integer(value, fallback) { const parsed = Number.parseInt(String(value ?? ""), 10); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function boolean(value, fallback) { const normalized = text(value).toLowerCase(); if (!normalized) return fallback; return ["1", "true", "yes"].includes(normalized); }
function validDate(value) { return value instanceof Date && !Number.isNaN(value.getTime()); }
function truncate(value, limit) { const input = String(value || ""); return input.length <= limit ? input : `${input.slice(0, limit - 1)}…`; }
function foldWorkflow(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "direct-scan"; }
function acquireWorkerLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    const fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
    fs.closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existingPid = Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);
    let running = Number.isFinite(existingPid);
    if (running) {
      try { process.kill(existingPid, 0); } catch (probeError) { if (probeError.code === "ESRCH") running = false; }
    }
    if (running) throw new Error(`Another WhatsApp browser worker is active (pid ${existingPid}).`);
    fs.unlinkSync(lockPath);
    return acquireWorkerLock(lockPath);
  }
  return () => { try { fs.unlinkSync(lockPath); } catch {} };
}

if (require.main === module) asyncMain().then((code) => process.exit(code)).catch((error) => { console.error(error.message); process.exit(1); });
module.exports = {
  asyncMain, approvedChatsPathFromArgs, classifyChat, commandListChats, defaultApprovedChatsPath,
  defaultSessionPath, formatApprovedChatExport, formatTriageReport, isApprovedChat, loadApprovedChats,
  normalizeSnapshot, parseArgs,
};
