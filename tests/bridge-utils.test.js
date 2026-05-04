const assert = require("node:assert/strict");
const test = require("node:test");

const {
  dedupeStrings,
  formatProgressMessage,
  formatSlugForDisplay,
  formatUnitSummary,
  isInvalidSessionError,
  mergePromptSegments,
  normalizeBooleanEnv,
  normalizeIntegerEnv,
  normalizeText,
  parseAllowedNumbers,
  parseSystemdShowOutput,
  splitIntoChunks,
  truncateText,
} = require("../apps/signal-bridge/bridge-utils");

test("bridge utils normalize env and text values", () => {
  assert.equal(normalizeText(" hi "), "hi");
  assert.equal(normalizeText(" "), "");
  assert.equal(normalizeBooleanEnv("yes", false), true);
  assert.equal(normalizeBooleanEnv("off", true), false);
  assert.equal(normalizeBooleanEnv("wat", true), true);
  assert.equal(normalizeIntegerEnv("42", 1), 42);
  assert.equal(normalizeIntegerEnv("bad", 1), 1);
  assert.deepEqual([...parseAllowedNumbers(" +1, +2 ,,")], ["+1", "+2"]);
});

test("bridge utils format and merge user-visible text", () => {
  assert.equal(formatProgressMessage(" Working "), "• Working");
  assert.equal(truncateText("abcdef", 5), "ab...");
  assert.equal(formatSlugForDisplay("dark_bloom-test"), "Dark Bloom Test");
  assert.deepEqual(dedupeStrings([" a ", "a", "", "b"]), ["a", "b"]);
  assert.equal(mergePromptSegments(" a ", "", "b"), "a\n\nb");
});

test("bridge utils parse systemd output and invalid session errors", () => {
  const summary = parseSystemdShowOutput(
    "ActiveState=active\nSubState=running\nActiveEnterTimestamp=now\nExecMainPID=123\n"
  );
  assert.deepEqual(summary, {
    activeState: "active",
    subState: "running",
    activeEnterTimestamp: "now",
    execMainPid: "123",
  });
  assert.equal(formatUnitSummary(summary), "active/running pid=123 since=now");
  assert.equal(isInvalidSessionError("No rollout found for thread id abc"), true);
  assert.equal(isInvalidSessionError("ordinary failure"), false);
});

test("bridge utils split signal-sized chunks", () => {
  assert.deepEqual(splitIntoChunks("aa\nbb\ncc", 5), ["aa\nbb", "cc"]);
  assert.deepEqual(splitIntoChunks("", 5), ["No output from Sable."]);
});
