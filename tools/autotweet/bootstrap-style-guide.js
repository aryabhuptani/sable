"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_STYLE_GUIDE_PATH,
} = require("./config");
const {
  extractPublishedXPosts,
  getDraft,
  listDrafts,
} = require("./typefully-cli");

const DEFAULT_FETCH_LIMIT = 40;
const MAX_PAGE_SIZE = 100;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const xDrafts = await fetchPublishedXDrafts({
    socialSetId: options.socialSetId || process.env.TYPEFULLY_SOCIAL_SET_ID || "",
    sampleSize: options.limit,
  });

  if (xDrafts.length === 0) {
    throw new Error("No published X drafts found to bootstrap the style guide.");
  }

  const markdown = renderStyleGuide(xDrafts, {
    generatedAt: new Date().toISOString(),
    sourceSocialSetId: options.socialSetId || process.env.TYPEFULLY_SOCIAL_SET_ID || "",
  });

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, markdown, "utf8");
  }

  process.stdout.write(markdown);
}

async function fetchPublishedXDrafts({ socialSetId, sampleSize }) {
  const normalizedSocialSetId = normalizeText(socialSetId);
  if (!normalizedSocialSetId) {
    throw new Error(
      "Missing Typefully social set id. Set TYPEFULLY_SOCIAL_SET_ID or pass --social-set-id."
    );
  }

  const targetCount = Number.isInteger(sampleSize) && sampleSize > 0 ? sampleSize : DEFAULT_FETCH_LIMIT;
  const collected = [];
  let offset = 0;

  while (collected.length < targetCount) {
    const remaining = targetCount - collected.length;
    const response = await listDrafts({
      socialSetId: normalizedSocialSetId,
      status: "published",
      limit: Math.min(remaining, MAX_PAGE_SIZE),
      offset,
    });

    const detailedDrafts = await hydrateDraftDetails({
      socialSetId: normalizedSocialSetId,
      drafts: Array.isArray(response?.results) ? response.results : [],
    });
    const page = extractPublishedXPosts(detailedDrafts);
    if (page.length === 0) {
      break;
    }

    collected.push(...page);
    if (!response?.next || !Array.isArray(response?.results) || response.results.length === 0) {
      break;
    }
    offset += response.results.length;
  }

  return collected.slice(0, targetCount);
}

async function hydrateDraftDetails({ socialSetId, drafts }) {
  const results = [];

  for (const draft of drafts) {
    const draftId = Number.isInteger(draft?.id) ? draft.id : 0;
    if (!draftId) {
      continue;
    }

    try {
      const detail = await getDraft({ socialSetId, draftId });
      results.push(mergeDraftSummaryAndDetail(draft, detail));
    } catch {
      results.push(draft);
    }
  }

  return results;
}

function mergeDraftSummaryAndDetail(summary, detail) {
  return {
    ...summary,
    ...detail,
    id: detail?.id || summary?.id,
    preview: normalizeText(detail?.preview) || normalizeText(summary?.preview),
    published_at:
      normalizeText(detail?.published_at) ||
      normalizeText(summary?.published_at) ||
      normalizeText(summary?.publishedAt),
    updated_at:
      normalizeText(detail?.updated_at) ||
      normalizeText(summary?.updated_at) ||
      normalizeText(summary?.updatedAt),
  };
}

function renderStyleGuide(xDrafts, { generatedAt, sourceSocialSetId }) {
  const stats = summarizeDrafts(xDrafts);
  const exampleSingles = pickExampleSingles(xDrafts, 5);
  const exampleThreads = pickExampleThreads(xDrafts, 3);

  return [
    "# Autotweet Style Guide",
    "",
    "This file is the canonical writing-style bootstrap for Arya's tweets.",
    "",
    "## Status",
    "",
    `- Bootstrapped automatically from ${stats.totalDrafts} recent published X drafts on ${generatedAt.slice(0, 10)}`,
    `- Source social set id: ${sourceSocialSetId || "unknown"}`,
    "- This is a first-pass guide. Edit for taste before enabling the scheduler.",
    "",
    "## Source Summary",
    "",
    `- Drafts sampled: ${stats.totalDrafts}`,
    `- Total posts sampled: ${stats.totalPosts}`,
    `- Single-post drafts: ${stats.singleDrafts}`,
    `- Thread drafts: ${stats.threadDrafts}`,
    `- Average post length: ${stats.averagePostLength} characters`,
    `- Question-style posts: ${stats.questionRate}%`,
    `- Numbered/list-style posts: ${stats.listRate}%`,
    `- First-person posts: ${stats.firstPersonRate}%`,
    "",
    "## Voice Read",
    "",
    ...renderVoiceRead(stats),
    "",
    "## Do",
    "",
    ...renderDoBullets(stats),
    "",
    "## Avoid",
    "",
    "- generic productivity sludge",
    "- obvious LLM cadence",
    "- fake certainty",
    "- engagement-bait emptiness",
    "- turning every take into a thread if one strong post will do",
    "",
    "## Representative Single Posts",
    "",
    ...exampleSingles.map((text) => `- ${quoteForMarkdown(text)}`),
    "",
    "## Representative Thread Openers",
    "",
    ...exampleThreads.map((text) => `- ${quoteForMarkdown(text)}`),
    "",
    "## Notes For Future Editing",
    "",
    "- Keep tightening this toward the tweets Arya actually likes, not just statistical averages.",
    "- If certain examples feel off-brand, remove them and rerun the bootstrap with a curated sample later.",
    "- When daily draft quality improves, flip `enabled: true` in `CONFIG.md`.",
    "",
  ].join("\n");
}

function summarizeDrafts(xDrafts) {
  const posts = xDrafts.flatMap((draft) => draft.posts.map((post) => post.text));
  const totalPosts = posts.length;
  const singleDrafts = xDrafts.filter((draft) => !draft.isThread).length;
  const threadDrafts = xDrafts.length - singleDrafts;
  const averagePostLength =
    totalPosts > 0
      ? Math.round(posts.reduce((sum, text) => sum + text.length, 0) / totalPosts)
      : 0;
  const questionRate = percentage(posts.filter((text) => /[?]/.test(text)).length, totalPosts);
  const listRate = percentage(
    posts.filter((text) => /^\s*(\d+[\.\)]|-|\*|[A-Za-z]\))\s/.test(text)).length,
    totalPosts
  );
  const firstPersonRate = percentage(
    posts.filter((text) => /\b(I|I'm|I’ve|I've|my|me)\b/i.test(text)).length,
    totalPosts
  );

  return {
    totalDrafts: xDrafts.length,
    totalPosts,
    singleDrafts,
    threadDrafts,
    averagePostLength,
    questionRate,
    listRate,
    firstPersonRate,
  };
}

function renderVoiceRead(stats) {
  const lines = [];

  if (stats.threadDrafts > stats.singleDrafts) {
    lines.push("- Threads are common enough to be a native format, not a special event.");
  } else {
    lines.push("- Strong compact posts appear to be the default; threads are secondary tools.");
  }

  if (stats.questionRate <= 20) {
    lines.push("- The voice leans more declarative than interrogative. Say the thing instead of fishing for replies.");
  } else {
    lines.push("- Questions show up often enough that rhetorical or framing questions are part of the toolkit.");
  }

  if (stats.firstPersonRate >= 30) {
    lines.push("- Personal framing is normal here. Direct first-person takes are part of the voice.");
  } else {
    lines.push("- The voice does not depend on autobiographical framing. Personal reference should stay earned.");
  }

  if (stats.averagePostLength <= 140) {
    lines.push("- Posts skew concise. Compression and payoff matter more than ornamental scene-setting.");
  } else {
    lines.push("- Posts are willing to spend some runway when the idea needs setup, but should still land cleanly.");
  }

  return lines;
}

function renderDoBullets(stats) {
  const lines = [
    "- Prefer crisp assertions, strong framing, and concrete claims over vague inspiration sludge.",
    "- Keep the center of gravity technical, strategic, or sharply observed rather than performatively motivational.",
  ];

  if (stats.threadDrafts > 0) {
    lines.push("- Use threads when the idea actually unfolds in steps; otherwise keep it to one clean post.");
  }

  if (stats.listRate >= 10) {
    lines.push("- Structured enumerations are fair game when they sharpen the point instead of padding it.");
  }

  if (stats.firstPersonRate >= 25) {
    lines.push("- First-person framing is fine when it carries real conviction or experience, not therapy-speak mush.");
  } else {
    lines.push("- Default to idea-first framing; only pivot to personal framing when it adds signal.");
  }

  return lines;
}

function pickExampleSingles(xDrafts, count) {
  return xDrafts
    .filter((draft) => !draft.isThread)
    .flatMap((draft) => draft.posts.map((post) => post.text))
    .filter(Boolean)
    .slice(0, count);
}

function pickExampleThreads(xDrafts, count) {
  return xDrafts
    .filter((draft) => draft.isThread)
    .map((draft) => draft.posts[0]?.text || "")
    .filter(Boolean)
    .slice(0, count);
}

function quoteForMarkdown(text) {
  return text.replace(/\n+/g, " ").trim();
}

function percentage(count, total) {
  if (!total) {
    return 0;
  }
  return Math.round((count / total) * 100);
}

function parseArgs(args) {
  const options = {
    limit: DEFAULT_FETCH_LIMIT,
    outputPath: DEFAULT_STYLE_GUIDE_PATH,
    socialSetId: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      options.limit = parsePositiveInteger(args[index + 1], DEFAULT_FETCH_LIMIT);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = normalizeText(args[index + 1]) || DEFAULT_STYLE_GUIDE_PATH;
      index += 1;
      continue;
    }
    if (arg === "--social-set-id") {
      options.socialSetId = normalizeText(args[index + 1]);
      index += 1;
      continue;
    }
  }

  return options;
}

function parsePositiveInteger(rawValue, fallback) {
  const value = Number.parseInt(rawValue, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  fetchPublishedXDrafts,
  mergeDraftSummaryAndDetail,
  parseArgs,
  renderStyleGuide,
  summarizeDrafts,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
