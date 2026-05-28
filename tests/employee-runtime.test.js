const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createEmployeeRuntime } = require("../apps/signal-bridge/employee-runtime");
const { createEmployeeStore } = require("../apps/signal-bridge/employee-store");

test("employee runtime prepares dockerized employee runs", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-employee-runtime-"));
  const store = createEmployeeStore({
    agentsRoot: path.join(temp, "memory", "agents"),
    runtimeRoot: path.join(temp, ".sable", "employees"),
    now: () => "2026-05-28T00:00:00.000Z",
  });
  store.createEmployee({ id: "researcher", role: "research" });
  const runtime = createEmployeeRuntime({
    employeeStore: store,
    repoRoot: "/repo/sable",
    dockerEnabled: true,
    now: () => "2026-05-28T00:00:00.000Z",
  });

  const status = runtime.startEmployeeRun("researcher", "Summarize the KB.", {
    dryRun: true,
    runId: "run-1",
  });

  assert.equal(status.status, "prepared");
  assert.equal(status.employeeId, "researcher");
  assert.equal(status.dockerEnabled, true);
  assert.equal(status.invocation.type, "docker");
  assert.equal(status.invocation.bin, "docker");
  assert.ok(status.invocation.args.includes("-v"));
  assert.equal(fs.existsSync(status.promptPath), true);
  assert.match(fs.readFileSync(status.promptPath, "utf8"), /Summarize the KB/);
});

test("employee runtime can prepare host fallback runs", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-employee-runtime-host-"));
  const store = createEmployeeStore({
    agentsRoot: path.join(temp, "agents"),
    runtimeRoot: path.join(temp, "runtime"),
  });
  store.createEmployee({ id: "reviewer" });
  const runtime = createEmployeeRuntime({
    employeeStore: store,
    repoRoot: "/repo/sable",
    dockerEnabled: false,
  });
  const status = runtime.startEmployeeRun("reviewer", "Review this.", {
    dryRun: true,
    runId: "run-2",
  });
  assert.equal(status.invocation.type, "host");
  assert.equal(status.invocation.env.SABLE_EMPLOYEE_ID, "reviewer");
});

