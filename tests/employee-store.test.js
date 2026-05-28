const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createEmployeeStore,
  normalizeEmployeeId,
} = require("../apps/signal-bridge/employee-store");

test("employee store creates isolated state skeleton idempotently", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-employees-"));
  const store = createEmployeeStore({
    agentsRoot: path.join(temp, "memory", "agents"),
    runtimeRoot: path.join(temp, ".sable", "employees"),
    now: () => "2026-05-28T00:00:00.000Z",
  });

  const first = store.createEmployee({ id: "Researcher", role: "research" });
  assert.equal(first.created, true);
  assert.equal(first.employee.id, "researcher");
  assert.equal(first.employee.role, "research");
  assert.equal(fs.existsSync(first.employee.paths.agentsPath), true);
  assert.equal(fs.existsSync(first.employee.paths.schedulePath), true);
  assert.equal(fs.existsSync(first.employee.paths.codexHome), true);
  assert.match(
    fs.readFileSync(first.employee.paths.agentsPath, "utf8"),
    /must not hire, create, archive, start, or manage other Sable employees/
  );

  fs.writeFileSync(first.employee.paths.agentsPath, "custom prompt\n", "utf8");
  const second = store.createEmployee({ id: "researcher", role: "other" });
  assert.equal(second.created, false);
  assert.equal(fs.readFileSync(first.employee.paths.agentsPath, "utf8"), "custom prompt\n");
  assert.equal(store.listEmployees().length, 1);
});

test("employee store rejects unsafe ids", () => {
  assert.equal(normalizeEmployeeId("Review Bot"), "review-bot");
  assert.throws(() => normalizeEmployeeId("../oops"), /Unsafe|Employee id/);
  assert.throws(() => normalizeEmployeeId(""), /required/);
});

test("employee store updates employee metadata without moving paths", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-employees-update-"));
  const store = createEmployeeStore({
    agentsRoot: path.join(temp, "agents"),
    runtimeRoot: path.join(temp, "runtime"),
    now: () => "2026-05-28T00:00:00.000Z",
  });
  const created = store.createEmployee({ id: "reviewer" }).employee;
  const updated = store.updateEmployee("reviewer", {
    role: "review",
    mattermost: { channelId: "channel-reviewer" },
  });
  assert.equal(updated.role, "review");
  assert.equal(updated.mattermost.channelId, "channel-reviewer");
  assert.equal(updated.paths.home, created.paths.home);
  assert.throws(() => store.updateEmployee("missing", { role: "x" }), /Unknown employee/);
});
