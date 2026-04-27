"use strict";

const fs = require("node:fs");

const {
  DEFAULT_SUGGESTIONS_PATH,
} = require("./config");

function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseArgs(args);

  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "ready") {
    const suggestions = listReadySuggestions(options.filePath);
    const limited = suggestions.slice(0, options.limit);
    process.stdout.write(`${JSON.stringify(limited, null, 2)}\n`);
    return;
  }

  if (command === "mark-drafted") {
    if (options.ids.length === 0) {
      throw new Error("Missing required --ids <id1,id2,...> argument.");
    }

    const result = markSuggestionsDrafted(options.filePath, options.ids, {
      draftedAt: options.draftedAt || new Date().toISOString(),
      draftNotes: options.draftNotes,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function listReadySuggestions(filePath = DEFAULT_SUGGESTIONS_PATH) {
  const document = loadSuggestionsDocument(filePath);
  return document.suggestions.filter((suggestion) => suggestion.status === "ready_for_drafting");
}

function markSuggestionsDrafted(filePath, ids, { draftedAt, draftNotes }) {
  const document = loadSuggestionsDocument(filePath);
  const idSet = new Set(ids);
  let updatedCount = 0;

  const updatedSuggestions = document.suggestions.map((suggestion) => {
    if (!idSet.has(suggestion.id)) {
      return suggestion;
    }

    updatedCount += 1;
    return {
      ...suggestion,
      status: "drafted",
      drafted_at: normalizeText(draftedAt),
      draft_notes: normalizeText(draftNotes),
    };
  });

  const updatedDocument = {
    ...document,
    suggestions: updatedSuggestions,
  };

  fs.writeFileSync(filePath, renderSuggestionsDocument(updatedDocument), "utf8");

  return {
    ok: true,
    updatedCount,
    ids: [...idSet],
  };
}

function loadSuggestionsDocument(filePath = DEFAULT_SUGGESTIONS_PATH) {
  const raw = fs.readFileSync(filePath, "utf8");
  return parseSuggestionsDocument(raw);
}

function parseSuggestionsDocument(raw) {
  const normalized = typeof raw === "string" ? raw : "";
  const queueHeading = "## Queue\n";
  const templateHeading = "\n## Capture Template";
  const queueIndex = normalized.indexOf(queueHeading);
  const templateIndex = normalized.indexOf(templateHeading);

  if (queueIndex === -1 || templateIndex === -1 || templateIndex <= queueIndex) {
    throw new Error("Suggestions file is missing expected queue/template headings.");
  }

  const beforeQueue = normalized.slice(0, queueIndex + queueHeading.length);
  const queueBody = normalized.slice(queueIndex + queueHeading.length, templateIndex).trim();
  const afterQueue = normalized.slice(templateIndex).trimStart();
  const parts = queueBody.split(/^### `([^`]+)`\n\n/gm);
  const suggestions = [];

  for (let index = 1; index < parts.length; index += 2) {
    const id = parts[index];
    const block = parts[index + 1] || "";
    suggestions.push(parseSuggestionBlock(id, block.trim()));
  }

  return {
    beforeQueue,
    afterQueue,
    suggestions,
  };
}

function parseSuggestionBlock(id, block) {
  const lines = block.split("\n");
  const suggestion = {
    id,
    source_kbs: [],
    structure_hint: [],
    research_needed: [],
    constraints: [],
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const scalarMatch = line.match(/^- `([^`]+)`: (.*)$/);
    const listHeaderMatch = line.match(/^- `([^`]+)`:$/);

    if (scalarMatch) {
      const [, key, rawValue] = scalarMatch;
      suggestion[key] = unwrapValue(rawValue);
      continue;
    }

    if (!listHeaderMatch) {
      continue;
    }

    const [, key] = listHeaderMatch;
    const items = [];
    index += 1;
    while (index < lines.length && /^  - /.test(lines[index])) {
      items.push(unwrapValue(lines[index].replace(/^  - /, "").trim()));
      index += 1;
    }
    index -= 1;
    suggestion[key] = items;
  }

  return suggestion;
}

function renderSuggestionsDocument(document) {
  const sections = [document.beforeQueue.trimEnd(), ""];

  for (const suggestion of document.suggestions) {
    sections.push(renderSuggestion(suggestion));
    sections.push("");
  }

  sections.push(document.afterQueue.trimStart());
  sections.push("");
  return sections.join("\n");
}

function renderSuggestion(suggestion) {
  const sections = [`### \`${suggestion.id}\``, ""];

  appendScalarField(sections, "status", suggestion.status);
  appendScalarField(sections, "priority", suggestion.priority);
  appendScalarField(sections, "effort", suggestion.effort);
  appendScalarField(sections, "title", suggestion.title);
  appendListField(sections, "source_kbs", suggestion.source_kbs);
  appendScalarField(sections, "angle", suggestion.angle);
  appendScalarField(sections, "why_now", suggestion.why_now);
  appendListField(sections, "structure_hint", suggestion.structure_hint);
  appendListField(sections, "research_needed", suggestion.research_needed);
  appendListField(sections, "constraints", suggestion.constraints);
  appendScalarField(sections, "notes", suggestion.notes);

  if (normalizeText(suggestion.drafted_at)) {
    appendScalarField(sections, "drafted_at", suggestion.drafted_at);
  }
  if (normalizeText(suggestion.draft_notes)) {
    appendScalarField(sections, "draft_notes", suggestion.draft_notes);
  }

  return sections.join("\n");
}

function appendScalarField(sections, key, value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return;
  }

  sections.push(`- \`${key}\`: ${wrapValue(normalized)}`);
}

function appendListField(sections, key, values) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  if (normalizedValues.length === 0) {
    return;
  }

  sections.push(`- \`${key}\`:`);
  for (const value of normalizedValues) {
    sections.push(`  - ${value}`);
  }
}

function wrapValue(value) {
  if (/^[A-Za-z0-9_-]+$/.test(value)) {
    return `\`${value}\``;
  }
  return value;
}

function unwrapValue(value) {
  return normalizeText(value).replace(/^`|`$/g, "");
}

function parseArgs(args) {
  const options = {
    filePath: DEFAULT_SUGGESTIONS_PATH,
    limit: 5,
    ids: [],
    draftedAt: "",
    draftNotes: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file") {
      options.filePath = normalizeText(args[index + 1]) || DEFAULT_SUGGESTIONS_PATH;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = parsePositiveInteger(args[index + 1], 5);
      index += 1;
      continue;
    }
    if (arg === "--ids") {
      options.ids = (args[index + 1] || "")
        .split(",")
        .map((entry) => normalizeText(entry))
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === "--drafted-at") {
      options.draftedAt = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--draft-notes") {
      options.draftNotes = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
  }

  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Autotweet suggestions CLI",
      "",
      "Commands:",
      "  node tools/autotweet/suggestions.js ready [--limit 5]",
      "  node tools/autotweet/suggestions.js mark-drafted --ids id1,id2 [--draft-notes \"Queued in Typefully\"]",
      "",
      "Defaults:",
      `  suggestions file: ${DEFAULT_SUGGESTIONS_PATH}`,
    ].join("\n")
  );
  process.stdout.write("\n");
}

function parsePositiveInteger(rawValue, fallback) {
  const value = Number.parseInt(rawValue, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  listReadySuggestions,
  loadSuggestionsDocument,
  markSuggestionsDrafted,
  parseArgs,
  parseSuggestionsDocument,
  renderSuggestionsDocument,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
