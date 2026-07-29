"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cli = require("../tools/whatsapp/whatsapp_cli");
const { normalizeDomMessage } = require("../tools/whatsapp/dom");
const { SelectorDiagnosticError, WhatsAppBrowserAdapter, firstVisible } = require("../tools/whatsapp/browser-adapter");
const { SCHEMA_VERSION, WhatsAppStore } = require("../tools/whatsapp/store");
const { crawlChat, syncApprovedChats } = require("../tools/whatsapp/sync");

async function tempState(name) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), name));
  return { root, env: { SABLE_INSTANCE_HOME: root, SABLE_WHATSAPP_STATE_DIR: path.join(root, "state") } };
}
async function capture(args, env) {
  const original = console.log;
  const lines = [];
  console.log = (...values) => lines.push(values.join(" "));
  try { return { code: await cli.asyncMain(args, env), output: lines.join("\n") }; }
  finally { console.log = original; }
}
function message(id, timestamp, text = id) {
  return { id, timestamp, text, sender: "Alice", fromMe: false };
}

test("defaults follow instance state and approved config", () => {
  assert.equal(cli.defaultApprovedChatsPath({ SABLE_INSTANCE_HOME: "/srv/alex" }), "/srv/alex/.config/sable/whatsapp-approved-chats.json");
  assert.equal(cli.defaultSessionPath({ SABLE_INSTANCE_HOME: "/srv/alex" }), "/srv/alex/.local/state/sable-whatsapp");
});

test("allowlist matches only exact id or exact name", () => {
  const approved = [{ id: "123@c.us", name: "Alice" }, { id: "", name: "Book Club" }];
  assert.equal(cli.isApprovedChat({ id: "123@c.us", name: "Other" }, approved), true);
  assert.equal(cli.isApprovedChat({ id: "x", name: "book club" }, approved), true);
  assert.equal(cli.isApprovedChat({ id: "x", name: "Book" }, approved), false);
});

test("DOM fixture normalization is stable and retains attachment metadata", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "whatsapp", "message.json"), "utf8"));
  const first = normalizeDomMessage(raw, { id: "alice", name: "Alice" });
  const second = normalizeDomMessage(raw, { id: "alice", name: "Alice" });
  assert.equal(first.id, second.id);
  assert.equal(first.timestamp, "2026-07-20T09:14:00.000Z");
  assert.equal(first.sender, "Alice");
  assert.equal(normalizeDomMessage({ ...raw, fromMe: true }, { id: "alice" }).sender, "You");
  assert.deepEqual(first.attachment, { type: "document", filename: "plans.pdf", mimeType: "application/pdf", sizeBytes: 42, caption: "Trip plans" });
});

test("SQLite migrations, idempotent upserts, FTS search, and attachments", async () => {
  const { root } = await tempState("sable-wa-store-");
  const store = new WhatsAppStore(path.join(root, "index.sqlite3"));
  try {
    assert.equal(store.schemaVersion(), SCHEMA_VERSION);
    const chat = { id: "alice", name: "Alice", approved: true };
    const item = normalizeDomMessage({ id: "m1", timestamp: "2026-07-20T09:14:00Z", sender: "Alice", text: "unique telescope phrase", attachment: { type: "image", filename: "sky.jpg" } }, chat);
    store.upsertMessages(chat, [item]);
    store.upsertMessages(chat, [{ ...item, text: "updated telescope phrase" }]);
    assert.equal(store.messagesForChat("alice").length, 1);
    assert.equal(store.search("telescope").length, 1);
    assert.equal(store.search("telescope")[0].filename, "sky.jpg");
    assert.equal(store.listChats()[0].message_count, 1);
  } finally { store.close(); await fsp.rm(root, { recursive: true, force: true }); }
});

test("SQLite migration upgrades an existing v1 index", async () => {
  const { root } = await tempState("sable-wa-migrate-");
  const databasePath = path.join(root, "index.sqlite3");
  let store = new WhatsAppStore(databasePath);
  store.db.exec("DROP TABLE messages_fts");
  store.db.prepare("UPDATE schema_meta SET value='1' WHERE key='schema_version'").run();
  store.close();
  store = new WhatsAppStore(databasePath);
  try {
    assert.equal(store.schemaVersion(), SCHEMA_VERSION);
    assert.equal(store.ftsAvailable, true);
  } finally { store.close(); await fsp.rm(root, { recursive: true, force: true }); }
});

test("crawl deduplicates and stops on known checkpoint", async () => {
  const { root } = await tempState("sable-wa-crawl-");
  const store = new WhatsAppStore(path.join(root, "index.sqlite3"));
  const chat = { id: "alice", name: "Alice", approved: true };
  store.upsertMessages(chat, [normalizeDomMessage(message("known", "2026-07-19T00:00:00Z"), chat)]);
  store.checkpoint("alice", { oldestMessageId: "known", oldestTimestamp: "2026-07-19T00:00:00Z" });
  let page = 0;
  const adapter = {
    readVisibleMessages: async () => page === 0
      ? [message("new", "2026-07-20T00:00:00Z"), message("dup", "2026-07-20T01:00:00Z")]
      : [message("dup", "2026-07-20T01:00:00Z"), message("known", "2026-07-19T00:00:00Z")],
    scrollHistoryUp: async () => { page += 1; },
  };
  try {
    const result = await crawlChat({ adapter, store, chat, approvedChats: [{ id: "alice" }], limits: { maxScrolls: 10 } });
    assert.equal(result.stopReason, "known-checkpoint");
    assert.equal(result.messages, 3);
    assert.equal(store.messagesForChat("alice").length, 3);
  } finally { store.close(); await fsp.rm(root, { recursive: true, force: true }); }
});

test("crawl enforces allowlist before browser reads", async () => {
  let read = false;
  const adapter = { readVisibleMessages: async () => { read = true; return []; } };
  await assert.rejects(() => crawlChat({ adapter, store: {}, chat: { id: "bob", name: "Bob" }, approvedChats: [{ id: "alice" }] }), /unapproved/);
  assert.equal(read, false);
});

test("crawl stops deterministically at max scrolls", async () => {
  const { root } = await tempState("sable-wa-bounds-");
  const store = new WhatsAppStore(path.join(root, "index.sqlite3"));
  let n = 0;
  const adapter = {
    readVisibleMessages: async () => [message(`m${n}`, `2026-07-2${n}T00:00:00Z`)],
    scrollHistoryUp: async () => { n += 1; },
  };
  try {
    const result = await crawlChat({ adapter, store, chat: { id: "alice", name: "Alice" }, approvedChats: [{ id: "alice" }], limits: { maxScrolls: 2 } });
    assert.equal(result.stopReason, "max-scrolls");
    assert.equal(result.scrolls, 2);
  } finally { store.close(); await fsp.rm(root, { recursive: true, force: true }); }
});

test("approved-chat sync isolates failures and continues with remaining chats", async () => {
  const { root } = await tempState("sable-wa-isolation-");
  const store = new WhatsAppStore(path.join(root, "index.sqlite3"));
  const approvedChats = [{ id: "bad", name: "Bad" }, { id: "good", name: "Good" }];
  const adapter = {
    findAndOpenChat: async (approved) => {
      if (approved.id === "bad") throw new Error("selector drift");
      return { ...approved, approved: true };
    },
    readVisibleMessages: async () => [message("m1", "2026-07-20T00:00:00Z")],
    scrollHistoryUp: async () => {},
  };
  try {
    const results = await syncApprovedChats({
      adapter,
      store,
      approvedChats,
      limits: { maxScrolls: 0 },
    });
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, false);
    assert.match(results[0].error, /selector drift/);
    assert.equal(results[1].ok, true);
    assert.equal(store.messagesForChat("good").length, 1);
  } finally { store.close(); await fsp.rm(root, { recursive: true, force: true }); }
});

test("CLI searches and exports the local index without live WhatsApp", async () => {
  const { root, env } = await tempState("sable-wa-cli-");
  const approvedPath = path.join(root, "approved.json");
  await fsp.writeFile(approvedPath, JSON.stringify({ approvedChats: [{ id: "alice", name: "Alice" }] }));
  env.SABLE_WHATSAPP_APPROVED_CHATS_PATH = approvedPath;
  const dbPath = path.join(env.SABLE_WHATSAPP_STATE_DIR, "messages.sqlite3");
  const store = new WhatsAppStore(dbPath);
  store.upsertMessages({ id: "alice", name: "Alice" }, [normalizeDomMessage(message("m1", "2026-07-20T00:00:00Z", "needle text"), { id: "alice" })]);
  store.close();
  const outputPath = path.join(root, "export.json");
  try {
    const search = await capture(["search", "--query", "needle"], env);
    assert.equal(search.code, 0);
    assert.match(search.output, /needle text/);
    const exported = await capture(["export-approved", "--out", outputPath, "--format", "json"], env);
    assert.equal(exported.code, 0);
    assert.equal(JSON.parse(await fsp.readFile(outputPath, "utf8"))[0].messages.length, 1);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test("CLI doctor is deterministic and validates config, Playwright, state, and SQLite", async () => {
  const { root, env } = await tempState("sable-wa-doctor-");
  const approvedPath = path.join(root, "approved.json");
  await fsp.writeFile(approvedPath, JSON.stringify({ approvedChats: [{ name: "Alice" }] }));
  env.SABLE_WHATSAPP_APPROVED_CHATS_PATH = approvedPath;
  try {
    const result = await capture(["doctor"], env);
    assert.equal(result.code, 0);
    const report = JSON.parse(result.output);
    assert.equal(report.ok, true);
    assert.deepEqual(report.checks.map((check) => check.name), ["approved-config", "approved-config-json", "playwright", "state-directory", "sqlite", "sync-health"]);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test("triage fixture remains allowlist-first for plugin compatibility", async () => {
  const { root, env } = await tempState("sable-wa-triage-");
  const approved = path.join(root, "approved.json");
  const input = path.join(root, "chats.json");
  await fsp.writeFile(approved, JSON.stringify({ approvedChats: [{ name: "Alice" }] }));
  await fsp.writeFile(input, JSON.stringify([{ name: "Alice", unreadCount: 1, lastMessageAt: "2999-01-01", snippet: "ping" }, { name: "Bob", unreadCount: 3, snippet: "hidden" }]));
  try {
    const result = await capture(["triage", "--approved-chats", approved, "--input-json", input], env);
    assert.match(result.output, /Alice/);
    assert.doesNotMatch(result.output, /Bob/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test("changed selectors produce actionable screenshot and HTML diagnostics", async () => {
  const { root } = await tempState("sable-wa-diag-");
  const artifactsDir = path.join(root, "artifacts");
  const fakePage = {
    locator: () => ({ first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    waitForTimeout: async () => {},
    screenshot: async ({ path: target }) => fsp.writeFile(target, "png"),
    content: async () => "<html>changed</html>",
    url: () => "https://web.whatsapp.com/",
  };
  const adapter = new WhatsAppBrowserAdapter({ paths: { artifactsDir } });
  adapter.page = fakePage;
  const error = await adapter.diagnosticError("chat list changed");
  assert.ok(error instanceof SelectorDiagnosticError);
  assert.match(error.message, /Diagnostic:/);
  assert.equal((await fsp.readdir(artifactsDir)).filter((name) => name.endsWith(".png")).length, 1);
  assert.equal(await firstVisible(fakePage, ["#missing"], 0), null);
  await fsp.rm(root, { recursive: true, force: true });
});

test("login wait refresh maintains a private current screenshot artifact", async () => {
  const { root } = await tempState("sable-wa-current-");
  const artifactsDir = path.join(root, "artifacts");
  const outputPath = path.join(artifactsDir, "current.png");
  const adapter = new WhatsAppBrowserAdapter({ paths: { artifactsDir } });
  adapter.page = {
    screenshot: async ({ path: target }) => {
      assert.match(target, /\.tmp\.png$/);
      await fsp.writeFile(target, "qr");
    },
  };

  const stopRefreshing = await adapter.startRefreshingScreenshot(outputPath, 60_000);
  stopRefreshing();

  assert.equal(await fsp.readFile(outputPath, "utf8"), "qr");
  assert.equal((fs.statSync(outputPath).mode & 0o777), 0o600);
  await fsp.rm(root, { recursive: true, force: true });
});
