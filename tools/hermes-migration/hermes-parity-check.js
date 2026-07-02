#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const MATRIX_PATH = path.join(__dirname, "hermes-parity-matrix.json");

function loadMatrix(matrixPath = MATRIX_PATH) {
  const raw = fs.readFileSync(matrixPath, "utf8");
  const matrix = JSON.parse(raw);
  validateMatrix(matrix);
  return matrix;
}

function validateMatrix(matrix) {
  if (!matrix || typeof matrix !== "object") {
    throw new Error("Parity matrix must be an object");
  }
  if (!Number.isInteger(matrix.version) || matrix.version < 1) {
    throw new Error("Parity matrix must include a positive integer version");
  }
  if (!Array.isArray(matrix.checks) || matrix.checks.length === 0) {
    throw new Error("Parity matrix must include checks");
  }

  const ids = new Set();
  const requiredCategories = new Set([
    "signal",
    "attachments",
    "voice",
    "connectors",
    "scheduler",
    "local-integrations",
    "operations",
  ]);

  for (const check of matrix.checks) {
    for (const field of ["id", "category", "kind", "priority", "description", "evidence"]) {
      if (!check[field] || typeof check[field] !== "string") {
        throw new Error(`Parity check is missing string field: ${field}`);
      }
    }
    if (ids.has(check.id)) {
      throw new Error(`Duplicate parity check id: ${check.id}`);
    }
    ids.add(check.id);
    requiredCategories.delete(check.category);
    if (!["live", "manual"].includes(check.kind)) {
      throw new Error(`Unsupported parity check kind for ${check.id}: ${check.kind}`);
    }
    if (!["required", "recommended"].includes(check.priority)) {
      throw new Error(`Unsupported parity check priority for ${check.id}: ${check.priority}`);
    }
  }

  if (requiredCategories.size > 0) {
    throw new Error(`Parity matrix is missing categories: ${Array.from(requiredCategories).sort().join(", ")}`);
  }
}

function formatMarkdown(matrix) {
  const lines = [
    "# Hermes Native Parity Matrix",
    "",
    matrix.scope,
    "",
    "## Retired legacy surfaces",
    "",
    ...matrix.retiredLegacySurfaces.map((item) => `- ${item}`),
    "",
    "## Checks",
    "",
    "| ID | Category | Kind | Priority | Description | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const check of matrix.checks) {
    lines.push([
      check.id,
      check.category,
      check.kind,
      check.priority,
      check.description,
      check.evidence,
    ].map(escapeTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  return `${lines.join("\n")}\n`;
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function summarize(matrix) {
  const counts = {};
  for (const check of matrix.checks) {
    counts[check.category] = (counts[check.category] || 0) + 1;
  }
  return {
    version: matrix.version,
    checks: matrix.checks.length,
    required: matrix.checks.filter((check) => check.priority === "required").length,
    recommended: matrix.checks.filter((check) => check.priority === "recommended").length,
    categories: counts,
  };
}

function parseArgs(argv) {
  const options = { format: "markdown", summary: false };
  for (const arg of argv) {
    if (arg === "--json") {
      options.format = "json";
    } else if (arg === "--markdown") {
      options.format = "markdown";
    } else if (arg === "--summary") {
      options.summary = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage:
  tools/hermes-migration/hermes-parity-check.js [--markdown|--json] [--summary]

Validates and prints the Hermes-native parity matrix for the Sable migration.
This is the migration gate definition; live phone/OAuth canaries are run against
the listed checks during cutover.
`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const matrix = loadMatrix();
  const payload = options.summary ? summarize(matrix) : matrix;

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  if (options.summary) {
    const summary = summarize(matrix);
    process.stdout.write([
      `Hermes parity matrix v${summary.version}`,
      `checks: ${summary.checks}`,
      `required: ${summary.required}`,
      `recommended: ${summary.recommended}`,
      `categories: ${Object.keys(summary.categories).sort().map((key) => `${key}=${summary.categories[key]}`).join(", ")}`,
      "",
    ].join("\n"));
    return 0;
  }

  process.stdout.write(formatMarkdown(matrix));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  MATRIX_PATH,
  formatMarkdown,
  loadMatrix,
  main,
  summarize,
  validateMatrix,
};
