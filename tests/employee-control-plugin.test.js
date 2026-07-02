const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createEmployeeStore } = require("../apps/signal-bridge/employee-store");
const { handleEmployeeCommand } = require("../plugins/employee-control/handler");

function createTempEmployeeStore(prefix = "sable-employee-control-") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return createEmployeeStore({
    agentsRoot: path.join(temp, "agents"),
    runtimeRoot: path.join(temp, "runtime"),
    now: () => "2026-05-28T00:00:00.000Z",
  });
}

test("employee control plugin creates, lists, shows, and starts employees", async () => {
  const store = createTempEmployeeStore();
  const starts = [];
  const api = {
    services: {
      employeeStore: store,
      employeeRuntime: {
        startEmployeeRun: (id, prompt) => {
          starts.push({ id, prompt });
          return {
            employeeId: id,
            id: "run-1",
            runDir: "/tmp/run-1",
            status: "running",
          };
        },
      },
    },
  };

  assert.match(await handleEmployeeCommand("create researcher research", api), /Created/);
  assert.match(await handleEmployeeCommand("list", api), /researcher/);
  assert.match(await handleEmployeeCommand("show researcher", api), /role: research/);
  assert.match(await handleEmployeeCommand("logs researcher", api), /runs:/);
  assert.match(await handleEmployeeCommand("start researcher scan the KB", api), /Started employee run/);
  assert.deepEqual(starts, [{ id: "researcher", prompt: "scan the KB" }]);
});

test("employee control plugin rejects unknown employee starts without invoking runtime", async () => {
  const store = createTempEmployeeStore("sable-employee-control-missing-");
  let invoked = false;
  const api = {
    services: {
      employeeStore: store,
      employeeRuntime: {
        startEmployeeRun: () => {
          invoked = true;
          throw new Error("runtime should not be called");
        },
      },
    },
  };

  assert.equal(
    await handleEmployeeCommand("start researcher scan the KB", api),
    "No employee matched researcher."
  );
  assert.equal(invoked, false);
});
