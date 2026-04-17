"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_CONFIG_PATH,
  discoverKbFiles,
  loadAutotweetConfig,
} = require("./config");

function main() {
  const configPath = process.argv[2] || DEFAULT_CONFIG_PATH;
  const config = loadAutotweetConfig(configPath);

  const sections = [
    "# Autotweet Context Packet",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Config: ${config.path}`,
    `Enabled: ${config.enabled ? "true" : "false"}`,
    `Queue mode: ${config.queueMode}`,
    `Platforms: ${config.platforms.join(", ") || "x"}`,
    `Target draft count: ${config.draftCount}`,
    "",
    "## Knowledge Bases",
  ];

  for (const kbPath of config.knowledgeBases) {
    sections.push("");
    sections.push(`### ${kbPath}`);

    const files = discoverKbFiles(kbPath, {
      maxFilesPerKb: config.maxFilesPerKb,
      maxCharsPerFile: config.maxCharsPerFile,
    });

    if (files.length === 0) {
      sections.push("- No readable KB files found.");
      continue;
    }

    for (const file of files) {
      sections.push("");
      sections.push(`#### ${path.relative(kbPath, file.path) || path.basename(file.path)}`);
      sections.push("```md");
      sections.push(file.content.trim());
      sections.push("```");
    }
  }

  sections.push("");
  sections.push("## Style Guide Files");
  appendFileSections(sections, config.styleGuideFiles, config.maxCharsPerFile);

  sections.push("");
  sections.push("## Question Files");
  appendFileSections(sections, config.questionFiles, config.maxCharsPerFile);

  process.stdout.write(`${sections.join("\n")}\n`);
}

function appendFileSections(sections, filePaths, maxCharsPerFile) {
  for (const filePath of filePaths) {
    sections.push("");
    sections.push(`### ${filePath}`);
    if (!fs.existsSync(filePath)) {
      sections.push("- Missing");
      continue;
    }

    sections.push("```md");
    sections.push(fs.readFileSync(filePath, "utf8").slice(0, maxCharsPerFile).trim());
    sections.push("```");
  }
}

if (require.main === module) {
  main();
}
