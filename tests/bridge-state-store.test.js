const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createBridgeStateStore,
  createEmptyState,
} = require("../apps/signal-bridge/bridge-state-store");

function makeStatePath(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sable-state-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, "state.json");
}

test("bridge state store loads legacy state and normalizes private auth and in-flight turns", (t) => {
  const statePath = makeStatePath(t);
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      lastSessionId: " legacy ",
      backgroundSessionId: " bg ",
      pendingPluginAuth: { id: "pending" },
      inFlightTurn: {
        sender: " arya ",
        startedAt: " now ",
        promptPreview: " hi ",
      },
    }),
    "utf8"
  );

  const store = createBridgeStateStore({
    normalizePendingPluginAuth: (value) => ({ normalized: value.id }),
    normalizeText: (value) => (typeof value === "string" && value.trim() ? value.trim() : ""),
    statePath,
  });

  assert.deepEqual(store.loadState(), {
    interactiveSessionId: "legacy",
    backgroundSessionId: "bg",
    pendingPluginAuth: { normalized: "pending" },
    inFlightTurn: {
      sender: "arya",
      startedAt: "now",
      promptPreview: "hi",
    },
  });
});

test("bridge state store persists session and in-flight state transitions", (t) => {
  const statePath = makeStatePath(t);
  const store = createBridgeStateStore({
    normalizeText: (value) => (typeof value === "string" && value.trim() ? value.trim() : ""),
    statePath,
    timestamp: () => "2026-05-04T10:00:00.000Z",
    truncateText: (value, maxLength) => value.slice(0, maxLength),
  });

  let state = {
    ...createEmptyState(),
    interactiveSessionId: "interactive",
    backgroundSessionId: "background",
  };
  state = store.clearSessionState(state, "background");
  state = store.setInFlightTurn(state, "+1555", "hello world");
  store.saveState(state);

  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), {
    interactiveSessionId: "interactive",
    backgroundSessionId: null,
    pendingPluginAuth: null,
    inFlightTurn: {
      sender: "+1555",
      startedAt: "2026-05-04T10:00:00.000Z",
      promptPreview: "hello world",
    },
  });

  assert.deepEqual(store.clearState(state), {
    ...state,
    interactiveSessionId: null,
    backgroundSessionId: null,
  });
  assert.equal(store.clearInFlightTurn(state).inFlightTurn, null);
});

test("bridge state store returns empty state for missing files", (t) => {
  const statePath = makeStatePath(t);
  const store = createBridgeStateStore({ statePath });
  assert.deepEqual(store.loadState(), createEmptyState());
});
