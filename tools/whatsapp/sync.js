"use strict";

const { normalizeDomMessage } = require("./dom");
const { isApprovedChat } = require("./config");

async function crawlChat({ adapter, store, chat, approvedChats, limits = {}, now = () => Date.now() }) {
  if (!isApprovedChat(chat, approvedChats)) throw new Error(`Refusing to sync unapproved WhatsApp chat: ${chat.name || chat.id}`);
  const maxMessages = integer(limits.maxMessages, 5_000);
  const maxScrolls = integer(limits.maxScrolls, 500);
  const maxTimeMs = integer(limits.maxTimeMs, 10 * 60_000);
  const until = limits.until ? Date.parse(limits.until) : null;
  const known = store.getCheckpoint(chat.id);
  const knownOldestId = limits.ignoreCheckpoint ? null : known?.oldest_message_id;
  const started = now();
  const seen = new Set();
  let all = [];
  let scrolls = 0;
  let stopReason = "no-progress";
  let stagnant = 0;

  while (true) {
    const visible = (await adapter.readVisibleMessages(chat)).map((raw) => normalizeDomMessage(raw, chat));
    const before = seen.size;
    for (const message of visible) {
      if (!seen.has(message.id)) { seen.add(message.id); all.push(message); }
    }
    store.upsertMessages(chat, visible);
    const oldest = oldestMessage(all);
    if (knownOldestId && seen.has(knownOldestId)) { stopReason = "known-checkpoint"; break; }
    if (until && oldest?.timestamp && Date.parse(oldest.timestamp) <= until) { stopReason = "until"; break; }
    if (seen.size >= maxMessages) { stopReason = "max-messages"; break; }
    if (scrolls >= maxScrolls) { stopReason = "max-scrolls"; break; }
    if (now() - started >= maxTimeMs) { stopReason = "max-time"; break; }
    stagnant = seen.size === before ? stagnant + 1 : 0;
    if (stagnant >= 3) { stopReason = "no-progress"; break; }
    await adapter.scrollHistoryUp();
    scrolls += 1;
  }
  all = all.sort(compareMessages);
  const oldest = all[0];
  const newest = all[all.length - 1];
  store.checkpoint(chat.id, {
    oldestMessageId: oldest?.id || known?.oldest_message_id,
    oldestTimestamp: oldest?.timestamp || known?.oldest_timestamp,
    newestMessageId: newest?.id || known?.newest_message_id,
    newestTimestamp: newest?.timestamp || known?.newest_timestamp,
    completed: stopReason === "no-progress",
  });
  return { chat, messages: seen.size, scrolls, stopReason };
}

async function syncApprovedChats({ adapter, store, approvedChats, limits }) {
  if (!approvedChats.length) throw new Error("No approved WhatsApp chats configured.");
  const results = [];
  for (const approved of approvedChats) {
    try {
      const chat = await adapter.findAndOpenChat(approved);
      if (!isApprovedChat(chat, [approved])) throw new Error(`Browser resolved an unapproved chat: ${chat.name}`);
      results.push({ ok: true, ...(await crawlChat({ adapter, store, chat, approvedChats: [approved], limits })) });
    } catch (error) {
      results.push({
        ok: false,
        chat: { id: approved.id || "", name: approved.name || approved.id || "(unknown)" },
        error: error.message,
      });
    }
  }
  return results;
}

function oldestMessage(messages) { return messages.slice().sort(compareMessages)[0]; }
function compareMessages(a, b) { return String(a.timestamp || "").localeCompare(String(b.timestamp || "")) || a.id.localeCompare(b.id); }
function integer(value, fallback) { const parsed = Number.parseInt(String(value ?? ""), 10); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }

module.exports = { crawlChat, syncApprovedChats };
