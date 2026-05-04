"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createScheduledAttachmentDiscovery({
  maxImages = 6,
  maxImageBytes = 10 * 1024 * 1024,
  maxTotalImageBytes = 25 * 1024 * 1024,
} = {}) {
  function discoverImageAttachments(workflowPrompt) {
    const prompt = normalizeText(workflowPrompt);
    if (!prompt) {
      return [];
    }

    const matchedPaths = extractExistingAbsolutePaths(prompt);
    if (matchedPaths.length === 0) {
      return [];
    }

    const discovered = [];
    let totalBytes = 0;

    for (const targetPath of matchedPaths) {
      for (const imagePath of expandWorkflowImagePaths(targetPath)) {
        if (discovered.length >= maxImages) {
          return discovered;
        }

        let stat;
        try {
          stat = fs.statSync(imagePath);
        } catch (error) {
          continue;
        }

        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > maxImageBytes) {
          continue;
        }
        if (totalBytes + stat.size > maxTotalImageBytes) {
          return discovered;
        }

        totalBytes += stat.size;
        discovered.push({
          id: `local:${imagePath}`,
          filename: path.basename(imagePath),
          contentType: guessContentTypeFromFilename(imagePath),
          localPath: imagePath,
        });
      }
    }

    return discovered;
  }

  function discoverFileAttachments(workflowPrompt) {
    const prompt = normalizeText(workflowPrompt);
    if (!prompt) {
      return [];
    }

    const matchedPaths = extractExistingAbsolutePaths(prompt);
    if (matchedPaths.length === 0) {
      return [];
    }

    const discovered = [];

    for (const targetPath of matchedPaths) {
      for (const filePath of expandWorkflowFilePaths(targetPath)) {
        discovered.push({
          id: `local:${filePath}`,
          filename: path.basename(filePath),
          contentType: guessContentTypeFromFilename(filePath),
          localPath: filePath,
        });
      }
    }

    return discovered;
  }

  return {
    discoverFileAttachments,
    discoverImageAttachments,
  };
}

function extractExistingAbsolutePaths(text) {
  const matches = text.match(/\/[A-Za-z0-9._~\-\/]+/g) || [];
  const uniquePaths = new Set();

  for (const match of matches) {
    const candidate = match.replace(/[.,;:)\]]+$/g, "");
    if (candidate && fs.existsSync(candidate)) {
      uniquePaths.add(candidate);
    }
  }

  return [...uniquePaths];
}

function expandWorkflowImagePaths(targetPath) {
  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (error) {
    return [];
  }

  if (stat.isFile()) {
    return isSupportedLocalImagePath(targetPath) ? [targetPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const assetDirectories = [];
  if (path.basename(targetPath) === "assets") {
    assetDirectories.push(targetPath);
  }

  const nestedAssetsPath = path.join(targetPath, "raw", "assets");
  if (fs.existsSync(nestedAssetsPath)) {
    assetDirectories.push(nestedAssetsPath);
  }
  const nestedInboxPath = path.join(targetPath, "raw", "inbox");
  if (fs.existsSync(nestedInboxPath)) {
    assetDirectories.push(nestedInboxPath);
  }

  const directChildren = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of directChildren) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childInboxPath = path.join(targetPath, entry.name, "raw", "inbox");
    if (fs.existsSync(childInboxPath)) {
      assetDirectories.push(childInboxPath);
    }
    const childAssetsPath = path.join(targetPath, entry.name, "raw", "assets");
    if (fs.existsSync(childAssetsPath)) {
      assetDirectories.push(childAssetsPath);
    }
  }

  const uniqueAssetDirectories = [...new Set(assetDirectories)];
  return uniqueAssetDirectories
    .flatMap((directoryPath) => listLocalImageFiles(directoryPath))
    .sort((left, right) => {
      try {
        return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
      } catch (error) {
        return 0;
      }
    });
}

function listLocalImageFiles(rootPath) {
  const results = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && isSupportedLocalImagePath(entryPath)) {
        results.push(entryPath);
      }
    }
  }

  return results;
}

function expandWorkflowFilePaths(targetPath) {
  let stat;
  try {
    stat = fs.statSync(targetPath);
  } catch (error) {
    return [];
  }

  if (stat.isFile()) {
    return isSupportedLocalFilePath(targetPath) ? [targetPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const inboxDirectories = [];
  if (path.basename(targetPath) === "inbox") {
    inboxDirectories.push(targetPath);
  }

  const nestedInboxPath = path.join(targetPath, "raw", "inbox");
  if (fs.existsSync(nestedInboxPath)) {
    inboxDirectories.push(nestedInboxPath);
  }

  const directChildren = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of directChildren) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childInboxPath = path.join(targetPath, entry.name, "raw", "inbox");
    if (fs.existsSync(childInboxPath)) {
      inboxDirectories.push(childInboxPath);
    }
  }

  const uniqueInboxDirectories = [...new Set(inboxDirectories)];
  return uniqueInboxDirectories
    .flatMap((directoryPath) => listLocalFiles(directoryPath))
    .filter((filePath) => isSupportedLocalFilePath(filePath))
    .sort((left, right) => {
      try {
        return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
      } catch (error) {
        return 0;
      }
    });
}

function listLocalFiles(rootPath) {
  const results = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(entryPath);
      }
    }
  }

  return results;
}

function isSupportedLocalImagePath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".jpg"
    || extension === ".jpeg"
    || extension === ".png"
    || extension === ".gif"
    || extension === ".webp"
    || extension === ".heic";
}

function isSupportedLocalFilePath(filePath) {
  if (isSupportedLocalImagePath(filePath)) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  const knownFileTypes = new Set([
    ".pdf",
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

  return knownFileTypes.has(extension);
}

function guessContentTypeFromFilename(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".heic") {
    return "image/heic";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }
  if (extension === ".txt" || extension === ".log") {
    return "text/plain";
  }
  if (extension === ".json" || extension === ".jsonl") {
    return "application/json";
  }
  if (extension === ".yaml" || extension === ".yml") {
    return "application/yaml";
  }
  if (extension === ".xml") {
    return "application/xml";
  }
  if (extension === ".csv" || extension === ".tsv") {
    return "text/csv";
  }
  return "image/png";
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  createScheduledAttachmentDiscovery,
  extractExistingAbsolutePaths,
  guessContentTypeFromFilename,
  isSupportedLocalFilePath,
  isSupportedLocalImagePath,
};
