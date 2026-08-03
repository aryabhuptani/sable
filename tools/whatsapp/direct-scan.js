"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TARGET_PATTERN = /(exercicio|consolidacao)/i;

function fold(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function containsTarget(value) { return TARGET_PATTERN.test(fold(value)); }
function isPdf(message) {
  const attachment = message?.attachment || {};
  return attachment.mimeType === "application/pdf" || /\.pdf(?:$|[?#])/i.test(attachment.filename || "");
}
function messageKey(message) {
  if (message.id) return String(message.id);
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify([
    message.prePlainText || "", message.timestamp || "", message.sender || "", message.text || "",
    message.attachment?.filename || "",
  ])).digest("hex")}`;
}
function safeFilename(value, fallback) {
  const clean = path.basename(String(value || "")).replace(/[^\p{L}\p{N}._ -]+/gu, "_").trim();
  return clean && /\.pdf$/i.test(clean) ? clean : fallback;
}
function uniqueOutputPath(outputDir, filename, key) {
  const parsed = path.parse(filename);
  const suffix = crypto.createHash("sha256").update(key).digest("hex").slice(0, 10);
  return path.join(outputDir, `${parsed.name}-${suffix}${parsed.ext || ".pdf"}`);
}
function extractPdfText(filePath, { command = "pdftotext" } = {}) {
  const result = spawnSync(command, ["-layout", filePath, "-"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw new Error(`PDF text extraction failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`PDF text extraction failed (${result.status}): ${String(result.stderr || "").trim()}`);
  return result.stdout || "";
}
function readCheckpoint(checkpointPath, chatTitle) {
  if (!fs.existsSync(checkpointPath)) return { version: 1, chatTitle, lastMessageKey: null };
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  if (checkpoint.version !== 1 || checkpoint.chatTitle !== chatTitle) {
    throw new Error(`Checkpoint does not belong to exact chat "${chatTitle}".`);
  }
  return checkpoint;
}
function writeCheckpoint(checkpointPath, checkpoint) {
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true, mode: 0o700 });
  const temporary = `${checkpointPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, checkpointPath);
}

async function directScan({ adapter, chatTitle, checkpointPath, outputDir, extractText = extractPdfText }) {
  if (!chatTitle || !checkpointPath || !outputDir) throw new Error("directScan requires chatTitle, checkpointPath, and outputDir.");
  const checkpoint = readCheckpoint(checkpointPath, chatTitle);
  const chat = await adapter.findAndOpenChat({ name: chatTitle });
  if (chat.name !== chatTitle) throw new Error(`Exact-chat mismatch: opened "${chat.name}" instead of "${chatTitle}".`);
  const messages = await adapter.readVisibleDocumentMessages(chat);
  if (!Array.isArray(messages)) throw new Error("WhatsApp document selector returned an invalid result.");
  const keyed = messages.map((message) => ({ ...message, key: messageKey(message) }));
  const checkpointIndex = checkpoint.lastMessageKey ? keyed.findIndex((message) => message.key === checkpoint.lastMessageKey) : -1;
  if (checkpoint.lastMessageKey && checkpointIndex < 0) {
    throw new Error("Saved checkpoint is not visible; refusing an incomplete scan.");
  }
  const newer = checkpointIndex < 0 ? keyed : keyed.slice(checkpointIndex + 1);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const matches = [];
  for (const message of newer) {
    if (!isPdf(message)) continue;
    const filename = safeFilename(message.attachment.filename, `whatsapp-${message.key.replace(/[^a-z0-9]/gi, "").slice(-16)}.pdf`);
    const outputPath = uniqueOutputPath(outputDir, filename, message.key);
    await adapter.downloadDocument(message, outputPath);
    fs.chmodSync(outputPath, 0o600);
    let matchedBy = null;
    if (containsTarget(`${filename}\n${message.attachment.caption || ""}\n${message.text || ""}`)) matchedBy = "metadata";
    else if (containsTarget(extractText(outputPath))) matchedBy = "pdf-text";
    if (matchedBy) matches.push({ messageKey: message.key, filename, path: outputPath, matchedBy });
    else fs.unlinkSync(outputPath);
  }
  const newest = keyed.at(-1)?.key || checkpoint.lastMessageKey;
  writeCheckpoint(checkpointPath, { version: 1, chatTitle, lastMessageKey: newest });
  return { version: 1, chatTitle, scannedMessages: newer.length, matchingPdfs: matches };
}

module.exports = {
  containsTarget, directScan, extractPdfText, fold, isPdf, messageKey, readCheckpoint, writeCheckpoint,
};
