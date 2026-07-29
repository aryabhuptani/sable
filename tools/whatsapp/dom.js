"use strict";

const crypto = require("node:crypto");

function normalizeDomMessage(raw, chat) {
  const text = normalizeText(raw.text || raw.body);
  const timestamp = normalizeTimestamp(raw.prePlainText) || normalizeTimestamp(raw.timestamp);
  const sender = normalizeSender(raw.sender, raw.prePlainText, raw.fromMe);
  const id = normalizeText(raw.id) || stableMessageId({ chatId: chat.id, sender, timestamp, text, attachment: raw.attachment });
  return {
    id,
    chatId: normalizeText(chat.id),
    sender,
    fromMe: Boolean(raw.fromMe),
    timestamp,
    text,
    kind: normalizeText(raw.kind) || (raw.attachment ? "attachment" : "text"),
    attachment: normalizeAttachment(raw.attachment),
  };
}

function normalizeTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = normalizeText(value);
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
  const bracket = text.match(/\[([^\]]+)\]/)?.[1];
  const whatsapp = String(bracket || text).match(/^(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (whatsapp) {
    const [, hour, minute, day, month, year] = whatsapp;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))).toISOString();
  }
  const parsed = Date.parse(bracket || text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeSender(sender, prePlainText, fromMe) {
  if (fromMe) return "You";
  const direct = normalizeText(sender);
  if (direct) return direct;
  const match = normalizeText(prePlainText).match(/\]\s*([^:]+):/);
  return match ? match[1].trim() : "";
}

function normalizeAttachment(value) {
  if (!value) return null;
  return {
    type: normalizeText(value.type || value.kind) || "unknown",
    filename: normalizeText(value.filename || value.name),
    mimeType: normalizeText(value.mimeType || value.mime),
    sizeBytes: Number.isFinite(Number(value.sizeBytes || value.size)) ? Number(value.sizeBytes || value.size) : null,
    caption: normalizeText(value.caption),
  };
}

function stableMessageId(value) {
  return `dom:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
}
function normalizeText(value) { return String(value || "").trim(); }

module.exports = { normalizeAttachment, normalizeDomMessage, normalizeTimestamp, stableMessageId };
