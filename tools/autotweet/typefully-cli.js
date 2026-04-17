"use strict";

const fs = require("node:fs");

const DEFAULT_API_BASE_URL = "https://api.typefully.com";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "social-sets") {
    const response = await typefullyRequest("/v2/social-sets", { method: "GET" });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  if (command === "queue") {
    const options = parseArgs(args);
    const inputPath = options.input;
    if (!inputPath) {
      throw new Error("Missing required --input <drafts.json> argument.");
    }

    const drafts = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    if (!Array.isArray(drafts) || drafts.length === 0) {
      throw new Error("Draft input must be a non-empty JSON array.");
    }

    const summary = [];
    for (const draft of drafts) {
      const payload = buildDraftPayload(draft, {
        platforms: options.platforms,
        publishAt: options.publishAt,
      });

      if (options.dryRun) {
        summary.push({ ok: true, dryRun: true, payload });
        continue;
      }

      const response = await typefullyRequest(
        `/v2/social-sets/${getSocialSetId(options)}/drafts`,
        {
          method: "POST",
          body: payload,
        }
      );
      summary.push({ ok: true, response });
    }

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function buildDraftPayload(draft, defaults = {}) {
  const normalized = normalizeDraft(draft, defaults.platforms || ["x"]);
  const payload = {
    platforms: normalized.platforms,
  };

  if (defaults.publishAt) {
    payload.publish_at = defaults.publishAt;
  }

  return payload;
}

function normalizeDraft(draft, defaultPlatforms) {
  if (!draft || typeof draft !== "object") {
    throw new Error("Each draft must be an object.");
  }

  const platforms = Array.isArray(draft.platforms) && draft.platforms.length > 0
    ? draft.platforms
    : defaultPlatforms;
  const posts = Array.isArray(draft.posts) && draft.posts.length > 0
    ? draft.posts
    : [{ text: normalizeText(draft.text) }];

  if (!posts.every((post) => post && typeof post.text === "string" && post.text.trim())) {
    throw new Error("Each draft needs either text or a posts array with text.");
  }

  return {
    platforms: Object.fromEntries(
      platforms.map((platform) => [
        normalizePlatform(platform),
        {
          enabled: true,
          posts: posts.map((post) => ({ text: post.text.trim() })),
        },
      ])
    ),
  };
}

function normalizePlatform(platform) {
  const value = normalizeText(platform).toLowerCase();
  if (!value) {
    throw new Error("Platform names must be non-empty.");
  }
  return value;
}

function getSocialSetId(options) {
  const value = normalizeText(options.socialSetId || process.env.TYPEFULLY_SOCIAL_SET_ID);
  if (!value) {
    throw new Error(
      "Missing Typefully social set id. Set TYPEFULLY_SOCIAL_SET_ID or pass --social-set-id."
    );
  }
  return value;
}

async function typefullyRequest(pathname, { method, body }) {
  const apiKey = normalizeText(process.env.TYPEFULLY_API_KEY);
  if (!apiKey) {
    throw new Error("Missing TYPEFULLY_API_KEY.");
  }

  const response = await fetch(`${DEFAULT_API_BASE_URL}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Typefully API error ${response.status}: ${text}`);
  }

  return response.json();
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    platforms: ["x"],
    publishAt: "",
    input: "",
    socialSetId: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--input") {
      options.input = args[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--publish-at") {
      options.publishAt = args[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--platforms") {
      options.platforms = (args[index + 1] || "x")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === "--social-set-id") {
      options.socialSetId = args[index + 1] || "";
      index += 1;
      continue;
    }
  }

  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Typefully CLI",
      "",
      "Commands:",
      "  node tools/autotweet/typefully-cli.js social-sets",
      "  node tools/autotweet/typefully-cli.js queue --input drafts.json [--dry-run]",
      "",
      "Env:",
      "  TYPEFULLY_API_KEY",
      "  TYPEFULLY_SOCIAL_SET_ID",
    ].join("\n")
  );
  process.stdout.write("\n");
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  buildDraftPayload,
  normalizeDraft,
  parseArgs,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
