const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CancellationError,
  cancelJobControl,
  createJobControl,
  isCancellationError,
  registerCancellationHandler,
} = require("../apps/signal-bridge/job-control");

test("job control notifies cancellation handlers once", () => {
  const jobControl = createJobControl("+15551112222");
  const seen = [];
  registerCancellationHandler(jobControl, (error) => {
    seen.push(error);
  });

  assert.equal(cancelJobControl(jobControl, "stop"), true);
  assert.equal(cancelJobControl(jobControl, "again"), false);
  assert.equal(jobControl.cancelled, true);
  assert.equal(jobControl.reason.message, "stop");
  assert.equal(seen.length, 1);
  assert.equal(seen[0], jobControl.reason);
  assert.equal(isCancellationError(seen[0]), true);
});

test("job control unregisters handlers and immediately reports already-cancelled jobs", () => {
  const jobControl = createJobControl("sender");
  let calls = 0;
  const unregister = registerCancellationHandler(jobControl, () => {
    calls += 1;
  });
  unregister();

  assert.equal(cancelJobControl(jobControl), true);
  assert.equal(calls, 0);

  registerCancellationHandler(jobControl, (error) => {
    calls += 1;
    assert.equal(error, jobControl.reason);
  });
  assert.equal(calls, 1);
});

test("job control logs handler failures without blocking other handlers", () => {
  const jobControl = createJobControl("sender");
  const logs = [];
  let observed = false;
  registerCancellationHandler(jobControl, () => {
    throw new Error("handler boom");
  });
  registerCancellationHandler(jobControl, () => {
    observed = true;
  });

  assert.equal(
    cancelJobControl(jobControl, "stop", {
      logger: { error: (line) => logs.push(line) },
      timestamp: () => "now",
    }),
    true
  );
  assert.equal(observed, true);
  assert.deepEqual(logs, ["[now] Cancellation handler failed: handler boom"]);
});

test("CancellationError has the bridge cancellation name", () => {
  const error = new CancellationError();
  assert.equal(error.name, "CancellationError");
  assert.equal(isCancellationError({ name: "CancellationError" }), true);
});
