const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  parseArgs,
  runShareabilityCheck,
  scanContent,
  scanPath,
} = require("../tools/shareability/check");

test("shareability path scanner rejects tracked runtime and secret files", () => {
  assert.equal(scanPath("apps/signal-bridge/.env").length, 1);
  assert.equal(scanPath("apps/signal-bridge/.env.example").length, 0);
  assert.equal(scanPath("apps/signal-bridge/.bridge-state.json").length, 1);
  assert.equal(scanPath("tools/telegram/telethon.session").length, 1);
  assert.equal(scanPath("apps/signal-bridge/.ops/history/run.jsonl").length, 1);
});

test("shareability content scanner allows fake examples and rejects likely private values", () => {
  assert.equal(scanContent("apps/signal-bridge/.env.example", "PHONE=+15551112222").length, 0);
  assert.ok(scanContent("README.md", "call me at +351912345678").some((finding) => finding.message.includes("phone")));
  assert.ok(scanContent("plugins/bad/plugin.json", "/home/arya/private").some((finding) => finding.message.includes("Arya-specific")));
  assert.ok(scanContent("docs/example.md", "/home/arya/example").length === 0);
  const fakeOpenAiKey = `sk-${"abcdefghijklmnopqrstuvwx"}`;
  assert.ok(scanContent("README.md", `OPENAI_API_KEY=${fakeOpenAiKey}`).length > 0);
});

test("shareability check scans tracked files from git", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-shareability-"));
  fs.writeFileSync(path.join(temp, "README.md"), "hello\n");
  fs.mkdirSync(path.join(temp, "apps", "signal-bridge"), { recursive: true });
  fs.writeFileSync(path.join(temp, "apps", "signal-bridge", ".env"), "SECRET=1\n");

  const report = runShareabilityCheck({
    repoRoot: temp,
    spawn: () => ({
      status: 0,
      stdout: "README.md\0apps/signal-bridge/.env\0",
      stderr: "",
    }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.checkedFiles, 2);
  assert.ok(report.findings.some((finding) => finding.file.endsWith(".env")));
});

test("shareability parser supports json and repo root", () => {
  assert.deepEqual(parseArgs(["--json", "--repo-root", "/tmp/sable"]), {
    json: true,
    repoRoot: "/tmp/sable",
  });
});
