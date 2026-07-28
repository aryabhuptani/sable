"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInstanceConfig } = require("../instance/instance-config");

function statePaths(env = process.env) {
  const instance = createInstanceConfig({ env });
  const root = path.resolve(expandHome(env.SABLE_WHATSAPP_STATE_DIR || env.SABLE_WHATSAPP_SESSION_PATH || path.join(instance.homeDir, ".local", "state", "sable-whatsapp")));
  return {
    root,
    profileDir: path.resolve(expandHome(env.SABLE_WHATSAPP_PROFILE_DIR || path.join(root, "profile"))),
    artifactsDir: path.join(root, "artifacts"),
    lockPath: path.join(root, "browser-worker.lock"),
    databasePath: path.resolve(expandHome(env.SABLE_WHATSAPP_DATABASE_PATH || path.join(root, "messages.sqlite3"))),
  };
}

function approvedChatsPath(env = process.env) {
  const instance = createInstanceConfig({ env });
  return path.resolve(expandHome(env.SABLE_WHATSAPP_APPROVED_CHATS_PATH || path.join(instance.homeDir, ".config", "sable", "whatsapp-approved-chats.json")));
}

function loadApprovedChats({ env = process.env, filePath = approvedChatsPath(env) } = {}) {
  const values = splitList(env.SABLE_WHATSAPP_APPROVED_CHATS).map((value) => ({ id: value, name: value }));
  if (fs.existsSync(filePath)) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : parsed.approvedChats;
    for (const entry of Array.isArray(entries) ? entries : []) values.push(normalizeApprovedChat(entry));
  }
  const seen = new Set();
  return values.map(normalizeApprovedChat).filter((entry) => entry.id || entry.name).filter((entry) => {
    const key = `${comparable(entry.id)}|${comparable(entry.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeApprovedChat(entry) {
  if (typeof entry === "string") return { id: entry.trim(), name: entry.trim() };
  return {
    id: text(entry?.id || entry?.chatId || entry?.serializedId),
    name: text(entry?.name || entry?.title),
  };
}

function isApprovedChat(chat, approved) {
  const id = comparable(chat?.id);
  const name = comparable(chat?.name);
  return approved.some((entry) => {
    const approvedId = comparable(entry.id);
    const approvedName = comparable(entry.name);
    return (approvedId && approvedId === id) || (approvedName && approvedName === name);
  });
}

function ensureState(paths) {
  for (const dir of [paths.root, paths.profileDir, paths.artifactsDir, path.dirname(paths.databasePath)]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return paths;
}

function expandHome(value) {
  const input = String(value || "");
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}
function text(value) { return String(value || "").trim(); }
function comparable(value) { return text(value).toLowerCase(); }
function splitList(value) { return String(value || "").split(",").map(text).filter(Boolean); }

module.exports = { approvedChatsPath, ensureState, isApprovedChat, loadApprovedChats, normalizeApprovedChat, statePaths };
