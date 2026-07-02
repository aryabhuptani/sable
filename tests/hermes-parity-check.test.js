const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  formatMarkdown,
  loadMatrix,
  main,
  summarize,
} = require("../tools/hermes-migration/hermes-parity-check");

const REPO_ROOT = path.resolve(__dirname, "..");

test("Hermes parity matrix covers the migration-critical native surfaces", () => {
  const matrix = loadMatrix();
  const ids = new Set(matrix.checks.map((check) => check.id));

  [
    "signal.text.dm",
    "signal.session.followup",
    "signal.attachment.image",
    "signal.attachment.pdf",
    "signal.voice.incoming",
    "connector.gmail.read",
    "connector.calendar.roundtrip",
    "scheduler.hermes.cron.canary",
    "local.homeassistant.readonly",
    "cutover.rollback",
  ].forEach((id) => assert.equal(ids.has(id), true, `${id} should be present`));

  assert.equal(matrix.retiredLegacySurfaces.includes("Sable slash commands"), true);
  assert.equal(matrix.retiredLegacySurfaces.includes("Sable scheduler"), true);
  assert.equal(matrix.retiredLegacySurfaces.includes("Sable /ops observability"), true);
});

test("Hermes parity summary is stable and category-complete", () => {
  const summary = summarize(loadMatrix());

  assert.equal(summary.checks, 11);
  assert.equal(summary.required, 10);
  assert.equal(summary.recommended, 1);
  assert.deepEqual(Object.keys(summary.categories).sort(), [
    "attachments",
    "connectors",
    "local-integrations",
    "operations",
    "scheduler",
    "signal",
    "voice",
  ]);
});

test("Hermes parity markdown renders the live canary evidence table", () => {
  const markdown = formatMarkdown(loadMatrix());

  assert.match(markdown, /^# Hermes Native Parity Matrix/m);
  assert.match(markdown, /signal\.attachment\.image/);
  assert.match(markdown, /voice-note canary/);
  assert.match(markdown, /Hermes-native connector auth/);
  assert.match(markdown, /Documented rollback command path/);
});

test("Hermes parity CLI entrypoint prints JSON summary", () => {
  const originalWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };

  try {
    assert.equal(main(["--json", "--summary"]), 0);
    const summary = JSON.parse(stdout);
    assert.equal(summary.checks, 11);
    assert.equal(summary.categories.attachments, 3);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("Hermes Home Assistant read-only skill documents the first local integration port", () => {
  const skillPath = path.join(
    REPO_ROOT,
    "tools",
    "hermes-migration",
    "skills",
    "home-assistant-readonly",
    "SKILL.md"
  );
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /tools\/hermes-migration\/hermes-ha-readonly\.sh summary/);
  assert.match(skill, /Do not call `activate-scene`/);
  assert.match(skill, /local\.homeassistant\.readonly/);
});
