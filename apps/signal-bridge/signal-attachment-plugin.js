"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function createSignalAttachmentPlugin({
  allowedNumbers = [],
  pendingDir,
  resultsDir,
  sendSignalRequest,
  logger = console,
  projectDir = __dirname,
  extractPdfScriptPath = "",
  pdfExtractPythonBin = "python3",
  maxFileAttachmentBytes = 10 * 1024 * 1024,
  maxTextAttachmentBytes = 2 * 1024 * 1024,
  maxTotalFileContextChars = 120_000,
  maxFileExcerptChars = 40_000,
  truncateText = defaultTruncateText,
} = {}) {
  if (!pendingDir || !resultsDir) {
    throw new Error("createSignalAttachmentPlugin requires pendingDir and resultsDir.");
  }
  if (typeof sendSignalRequest !== "function") {
    throw new Error("createSignalAttachmentPlugin requires sendSignalRequest.");
  }

  function normalizeOutgoingAttachmentPaths(files) {
    if (!Array.isArray(files)) {
      return [];
    }

    return files
      .map((filePath) => normalizeText(filePath))
      .filter(Boolean)
      .map((filePath) => path.resolve(filePath))
      .filter((filePath, index, list) => list.indexOf(filePath) === index)
      .filter((filePath) => {
        try {
          return fs.statSync(filePath).isFile();
        } catch (error) {
          return false;
        }
      });
  }

  function sendAttachmentMessage(recipient, message = "", attachmentPaths = []) {
    const files = normalizeOutgoingAttachmentPaths(attachmentPaths);
    if (!recipient || files.length === 0) {
      return Promise.reject(new Error("Missing recipient or attachment paths."));
    }

    return sendSignalRequest("send", {
      recipient: [recipient],
      message: normalizeText(message),
      attachment: files,
    });
  }

  function sendTextMessage(recipient, message = "") {
    if (!recipient || !normalizeText(message)) {
      return Promise.reject(new Error("Missing recipient or message."));
    }

    return sendSignalRequest("send", {
      recipient: [recipient],
      message: normalizeText(message),
    });
  }

  function ensureQueueDirs() {
    try {
      fs.mkdirSync(pendingDir, { recursive: true });
      fs.mkdirSync(resultsDir, { recursive: true });
    } catch (error) {
      logger.error?.(`[${timestamp()}] Failed ensuring attachment queue dirs: ${error.message}`);
    }
  }

  function getQueueDepth() {
    try {
      return fs
        .readdirSync(pendingDir)
        .filter((entry) => entry.endsWith(".json")).length;
    } catch (error) {
      return 0;
    }
  }

  async function processNextQueuedCommand() {
    let requestPath = "";

    try {
      const entries = await fs.promises.readdir(pendingDir);
      const nextEntry = entries
        .filter((entry) => entry.endsWith(".json"))
        .sort()[0];

      if (!nextEntry) {
        return;
      }

      requestPath = path.join(pendingDir, nextEntry);
      const payload = JSON.parse(await fs.promises.readFile(requestPath, "utf8"));
      const requestId = normalizeText(payload?.id) || path.basename(nextEntry, ".json");
      const recipient = normalizeText(payload?.recipient) || allowedNumbers[0] || "";
      const message = normalizeText(payload?.message);
      const requestedFiles = Array.isArray(payload?.files)
        ? payload.files.map((filePath) => normalizeText(filePath)).filter(Boolean)
        : [];
      const files = normalizeOutgoingAttachmentPaths(payload?.files);

      if (!recipient) {
        throw new Error("Attachment request did not include a recipient.");
      }
      if (requestedFiles.length > 0 && files.length === 0) {
        throw new Error("Attachment request did not include any valid files.");
      }
      if (files.length === 0 && !message) {
        throw new Error("Message request did not include text or any valid files.");
      }

      if (files.length > 0) {
        await sendAttachmentMessage(recipient, message, files);
      } else {
        await sendTextMessage(recipient, message);
      }

      await writeCommandResult(requestId, {
        ok: true,
        recipient,
        message,
        files,
        completedAt: timestamp(),
      });
    } catch (error) {
      if (requestPath) {
        const requestId = path.basename(requestPath, ".json");
        await writeCommandResult(requestId, {
          ok: false,
          error: normalizeText(error?.message) || "Attachment send failed.",
          completedAt: timestamp(),
        });
      } else {
        logger.error?.(
          `[${timestamp()}] Attachment queue processing failed before reading a request: ${error.message}`
        );
      }
    } finally {
      if (requestPath) {
        await fs.promises.rm(requestPath, { force: true });
      }
    }
  }

  async function writeCommandResult(requestId, payload) {
    ensureQueueDirs();
    const resultPath = path.join(resultsDir, `${requestId}.json`);
    await fs.promises.writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  function extractIncomingImageAttachments(envelope) {
    return extractIncomingAttachmentsByPredicate(envelope, (attachment, contentType) => {
      return Boolean(attachment?.id) && contentType.startsWith("image/");
    });
  }

  function extractIncomingAudioAttachments(envelope) {
    return extractIncomingAttachmentsByPredicate(envelope, (attachment, contentType) => {
      return Boolean(attachment?.id) && contentType.startsWith("audio/");
    });
  }

  function extractIncomingFileAttachments(envelope) {
    return extractIncomingAttachmentsByPredicate(envelope, (attachment, contentType) => {
      return (
        Boolean(attachment?.id) &&
        !contentType.startsWith("image/") &&
        !contentType.startsWith("audio/")
      );
    });
  }

  function extractIncomingAttachmentsByPredicate(envelope, predicate) {
    const attachments = envelope?.dataMessage?.attachments;
    if (!Array.isArray(attachments)) {
      return [];
    }

    return attachments.filter((attachment) => {
      const contentType = normalizeText(attachment?.contentType).toLowerCase();
      return predicate(attachment, contentType);
    });
  }

  function buildAttachmentContext(
    envelope,
    sender,
    imageAttachments,
    audioAttachments,
    fileAttachments
  ) {
    return {
      groupId: normalizeText(envelope?.dataMessage?.groupInfo?.groupId),
      sender,
      imageAttachments,
      audioAttachments,
      fileAttachments,
    };
  }

  async function materializeIncomingImages(context) {
    if (!context || !Array.isArray(context.imageAttachments) || context.imageAttachments.length === 0) {
      return [];
    }

    return materializeIncomingAttachmentList(context, context.imageAttachments, "signal-codex-images-", {
      allowLocalPaths: true,
    });
  }

  async function materializeIncomingAudio(context) {
    if (!context || !Array.isArray(context.audioAttachments) || context.audioAttachments.length === 0) {
      return [];
    }

    return materializeIncomingAttachmentList(context, context.audioAttachments, "signal-codex-audio-");
  }

  async function materializeIncomingFiles(context) {
    if (!context || !Array.isArray(context.fileAttachments) || context.fileAttachments.length === 0) {
      return [];
    }

    return materializeIncomingAttachmentList(context, context.fileAttachments, "signal-codex-files-", {
      allowLocalPaths: true,
    });
  }

  async function materializeIncomingAttachmentList(
    context,
    attachments,
    tempPrefix,
    { allowLocalPaths = false } = {}
  ) {
    const attachmentDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), tempPrefix));
    const writtenPaths = [];

    try {
      for (const attachment of attachments) {
        const filePath = path.join(
          attachmentDir,
          buildAttachmentFilename(attachment, writtenPaths.length)
        );
        if (allowLocalPaths && isLocalAttachment(attachment)) {
          await fs.promises.copyFile(attachment.localPath, filePath);
        } else {
          const data = await fetchAttachmentData(context, attachment.id);
          await fs.promises.writeFile(filePath, Buffer.from(data, "base64"));
        }
        writtenPaths.push(filePath);
      }
    } catch (error) {
      await cleanupPaths(writtenPaths);
      await fs.promises.rm(attachmentDir, { recursive: true, force: true });
      throw error;
    }

    return writtenPaths;
  }

  async function buildFileAttachmentPromptContext(context, filePaths) {
    const attachments = Array.isArray(context?.fileAttachments) ? context.fileAttachments : [];
    if (attachments.length === 0 || filePaths.length === 0) {
      return { ok: true, promptText: "" };
    }

    const sections = [];
    let totalChars = 0;

    for (let index = 0; index < attachments.length && index < filePaths.length; index += 1) {
      const extracted = await extractSupportedAttachmentText(attachments[index], filePaths[index]);
      if (!extracted.ok) {
        return extracted;
      }

      if (!extracted.text) {
        continue;
      }

      const remainingChars = maxTotalFileContextChars - totalChars;
      if (remainingChars <= 0) {
        break;
      }

      const excerpt = truncateText(extracted.text, Math.min(maxFileExcerptChars, remainingChars));
      totalChars += excerpt.length;
      sections.push(formatExtractedAttachmentSection(extracted, excerpt));
    }

    if (sections.length === 0) {
      return {
        ok: false,
        message:
          "I received the file attachment, but could not extract usable text from it. PDFs need embedded text; scanned PDFs and unsupported binary files are not handled yet.",
      };
    }

    return {
      ok: true,
      promptText: `Attached file context:\n\n${sections.join("\n\n")}`,
    };
  }

  function buildLocalAttachmentPathPromptContext(
    context,
    { imagePaths = [], audioPaths = [], filePaths = [] } = {}
  ) {
    const lines = [
      "Local attachment paths for this turn only:",
      "These files are temporary and will be deleted automatically after the request completes.",
    ];

    appendAttachmentPathLines(lines, "Image", context?.imageAttachments, imagePaths);
    appendAttachmentPathLines(lines, "Audio", context?.audioAttachments, audioPaths);
    appendAttachmentPathLines(lines, "File", context?.fileAttachments, filePaths);

    return lines.length > 2 ? lines.join("\n") : "";
  }

  function appendAttachmentPathLines(lines, label, attachments, paths) {
    const attachmentList = Array.isArray(attachments) ? attachments : [];
    const pathList = Array.isArray(paths) ? paths : [];

    for (let index = 0; index < attachmentList.length && index < pathList.length; index += 1) {
      const attachment = attachmentList[index];
      const fileName = normalizeText(attachment?.filename) || path.basename(pathList[index]);
      const contentType = normalizeText(attachment?.contentType) || "unknown";
      lines.push(`[${label}] ${fileName} (${contentType}) -> ${pathList[index]}`);
    }
  }

  async function extractSupportedAttachmentText(attachment, filePath) {
    const fileName = normalizeText(attachment?.filename) || path.basename(filePath);
    const contentType = normalizeText(attachment?.contentType).toLowerCase();
    const stat = await fs.promises.stat(filePath);

    if (stat.size > maxFileAttachmentBytes) {
      return {
        ok: false,
        message: `Attached file is too large to process right now: ${fileName} (${formatBytes(
          stat.size
        )}). Limit is ${formatBytes(maxFileAttachmentBytes)}.`,
      };
    }

    if (isPdfAttachment(attachment, filePath)) {
      const pdfText = extractPdfText(filePath);
      if (!pdfText.ok) {
        return {
          ok: false,
          message: `${pdfText.message} File: ${fileName}.`,
        };
      }

      return {
        ok: true,
        fileName,
        contentType: contentType || "application/pdf",
        text: pdfText.text,
      };
    }

    if (isPlainTextAttachment(attachment, filePath)) {
      if (stat.size > maxTextAttachmentBytes) {
        return {
          ok: false,
          message: `Text attachment is too large to inline right now: ${fileName} (${formatBytes(
            stat.size
          )}). Limit is ${formatBytes(maxTextAttachmentBytes)}.`,
        };
      }

      const buffer = await fs.promises.readFile(filePath);
      if (looksBinary(buffer)) {
        return {
          ok: false,
          message: `Attached file looks binary and is not supported yet: ${fileName}.`,
        };
      }

      const text = normalizeAttachmentText(buffer.toString("utf8"));
      if (!text) {
        return {
          ok: false,
          message: `Attached text file was empty after decoding: ${fileName}.`,
        };
      }

      return {
        ok: true,
        fileName,
        contentType: contentType || "text/plain",
        text,
      };
    }

    return {
      ok: false,
      message: `Unsupported attachment type for now: ${fileName} (${contentType || "unknown type"}). Supported: PDF, text, markdown, JSON, YAML, CSV, XML, and similar plain-text files.`,
    };
  }

  function extractPdfText(filePath) {
    if (!fs.existsSync(extractPdfScriptPath)) {
      return {
        ok: false,
        message: "No local PDF text extractor helper is installed for this bridge",
      };
    }

    try {
      const output = execFileSync(pdfExtractPythonBin, [extractPdfScriptPath, filePath], {
        cwd: projectDir,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const parsed = JSON.parse(output);
      if (parsed?.ok && normalizeText(parsed.text)) {
        return { ok: true, text: normalizeAttachmentText(parsed.text) };
      }
      return {
        ok: false,
        message: normalizeText(parsed?.error) || "Failed to extract text from the PDF attachment.",
      };
    } catch (error) {
      try {
        const parsed = JSON.parse(String(error.stdout || ""));
        if (parsed?.error) {
          return {
            ok: false,
            message: normalizeText(parsed.error) || "Failed to extract text from the PDF attachment.",
          };
        }
      } catch (parseError) {
        // fall through to generic error below
      }

      return {
        ok: false,
        message: "Failed to extract text from the PDF attachment.",
      };
    }
  }

  function fetchAttachmentData(context, attachmentId) {
    const params = { id: attachmentId };
    if (context.groupId) {
      params.groupId = context.groupId;
    } else {
      params.recipient = context.sender;
    }

    return sendSignalRequest("getAttachment", params).then((result) => {
      const data = normalizeText(result?.data);
      if (!data) {
        throw new Error(`signal-cli returned no attachment data for attachment ${attachmentId}`);
      }
      return data;
    });
  }

  return {
    buildAttachmentContext,
    buildFileAttachmentPromptContext,
    buildLocalAttachmentPathPromptContext,
    ensureQueueDirs,
    extractIncomingAudioAttachments,
    extractIncomingFileAttachments,
    extractIncomingImageAttachments,
    extractSupportedAttachmentText,
    getQueueDepth,
    materializeIncomingAudio,
    materializeIncomingFiles,
    materializeIncomingImages,
    normalizeOutgoingAttachmentPaths,
    pendingDir,
    processNextQueuedCommand,
    resultsDir,
    sendAttachmentMessage,
    writeCommandResult,
  };
}

function buildAttachmentFilename(attachment, index) {
  const fileName = sanitizeFilename(attachment?.filename);
  if (fileName) {
    return `${index + 1}-${fileName}`;
  }

  const extension = guessExtensionFromContentType(attachment?.contentType);
  return `attachment-${index + 1}${extension}`;
}

function isLocalAttachment(attachment) {
  return Boolean(normalizeText(attachment?.localPath));
}

function sanitizeFilename(fileName) {
  const normalized = normalizeText(fileName);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function guessExtensionFromContentType(contentType) {
  const normalized = normalizeText(contentType).toLowerCase();
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized === "image/heic") {
    return ".heic";
  }
  if (normalized === "audio/aac") {
    return ".aac";
  }
  if (normalized === "audio/m4a" || normalized === "audio/mp4") {
    return ".m4a";
  }
  if (normalized === "audio/mpeg") {
    return ".mp3";
  }
  if (normalized === "audio/ogg" || normalized === "audio/opus") {
    return ".ogg";
  }
  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    return ".wav";
  }
  if (normalized === "audio/webm") {
    return ".webm";
  }
  if (normalized === "application/pdf") {
    return ".pdf";
  }
  if (normalized === "text/plain") {
    return ".txt";
  }
  if (normalized === "text/markdown") {
    return ".md";
  }
  if (normalized === "application/json") {
    return ".json";
  }
  if (normalized === "application/xml" || normalized === "text/xml") {
    return ".xml";
  }
  if (normalized === "text/csv") {
    return ".csv";
  }
  if (normalized === "application/x-yaml" || normalized === "application/yaml") {
    return ".yaml";
  }
  return ".bin";
}

async function cleanupPaths(paths) {
  await Promise.all(
    paths.map((filePath) => fs.promises.rm(filePath, { force: true }).catch(() => {}))
  );
}

function formatExtractedAttachmentSection(extracted, excerpt) {
  const header = `${extracted.fileName} (${extracted.contentType})`;
  return [`[File] ${header}`, excerpt].filter(Boolean).join("\n");
}

function isPdfAttachment(attachment, filePath) {
  const contentType = normalizeText(attachment?.contentType).toLowerCase();
  const fileName = normalizeText(attachment?.filename) || path.basename(filePath);
  return contentType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function isPlainTextAttachment(attachment, filePath) {
  const contentType = normalizeText(attachment?.contentType).toLowerCase();
  const fileName = normalizeText(attachment?.filename) || path.basename(filePath);
  const extension = path.extname(fileName).toLowerCase();
  const knownTextTypes = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".csv",
    ".tsv",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".sh",
    ".log",
    ".sql",
  ]);

  return (
    contentType.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/x-yaml",
      "application/yaml",
      "application/toml",
      "image/svg+xml",
    ].includes(contentType) ||
    knownTextTypes.has(extension)
  );
}

function normalizeAttachmentText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksBinary(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) {
    return true;
  }

  const decoded = sample.toString("utf8");
  const replacementCount = Array.from(decoded).filter((character) => character === "\uFFFD").length;
  if (replacementCount > 0 && replacementCount / Math.max(decoded.length, 1) > 0.05) {
    return true;
  }

  return /[\u0001-\u0008\u000B\u000C\u000E-\u001A]/.test(decoded);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 1024) {
    return `${value || 0} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function timestamp() {
  return new Date().toISOString();
}

function defaultTruncateText(value, limit) {
  const normalized = String(value || "");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

module.exports = {
  createSignalAttachmentPlugin,
};
