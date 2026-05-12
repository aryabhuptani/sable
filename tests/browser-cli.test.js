const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCalendarLinkPlan,
  commandCalendarLinkPlan,
  commandInit,
  defaultBrowserPaths,
  formatCalendarLinkPlan,
  parseArgs,
} = require("../tools/browser/browser_cli");

test("browser paths default to private instance state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sable-browser-home-"));
  const paths = defaultBrowserPaths({ SABLE_INSTANCE_HOME: home });

  assert.equal(paths.root, path.join(home, ".local", "state", "sable-browser"));
  assert.equal(paths.profileDir, path.join(paths.root, "profile"));
  assert.equal(paths.downloadsDir, path.join(paths.root, "downloads"));
  assert.equal(paths.artifactsDir, path.join(paths.root, "artifacts"));
});

test("browser init creates state directories", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sable-browser-init-"));
  commandInit({}, { SABLE_INSTANCE_HOME: home });
  const paths = defaultBrowserPaths({ SABLE_INSTANCE_HOME: home });

  assert.ok(fs.existsSync(paths.profileDir));
  assert.ok(fs.existsSync(paths.downloadsDir));
  assert.ok(fs.existsSync(paths.artifactsDir));
});

test("calendar link plan captures approval-gated browser workflow", () => {
  const plan = buildCalendarLinkPlan({
    bookingLink: "https://calendar.app.google/example",
    endDate: "2026-06-03",
    startDate: "2026-05-12",
    timezone: "America/Los_Angeles",
  });

  assert.equal(plan.bookingLink, "https://calendar.app.google/example");
  assert.equal(plan.timezone, "America/Los_Angeles");
  assert.match(plan.approvalGate, /Do not save/);
  assert.ok(plan.browserSteps.some((step) => step.includes("public booking link")));
});

test("calendar link command writes task state and artifact", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sable-browser-plan-"));
  const output = path.join(home, "plan.json");
  commandCalendarLinkPlan({
    end: "2026-06-03",
    link: "https://calendar.app.google/example",
    output,
    start: "2026-05-12",
    timezone: "America/Los_Angeles",
  }, { SABLE_INSTANCE_HOME: home });
  const task = JSON.parse(fs.readFileSync(output, "utf8"));
  const state = JSON.parse(fs.readFileSync(defaultBrowserPaths({ SABLE_INSTANCE_HOME: home }).taskStatePath, "utf8"));

  assert.equal(task.kind, "calendar-link-management");
  assert.equal(task.status, "needs_browser_run");
  assert.equal(task.approvalRequired, true);
  assert.equal(state.id, task.id);
  assert.match(formatCalendarLinkPlan(task), /America\/Los_Angeles/);
});

test("browser argument parser supports command options", () => {
  assert.deepEqual(parseArgs(["calendar-link-plan", "--timezone", "America/Los_Angeles"]), {
    command: "calendar-link-plan",
    timezone: "America/Los_Angeles",
  });
});
