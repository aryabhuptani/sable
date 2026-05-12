const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const whatsapp = require("../tools/whatsapp/whatsapp_cli");

test("whatsapp approved-chat defaults follow instance config", () => {
  assert.equal(
    whatsapp.defaultApprovedChatsPath({}),
    "/home/arya/.config/sable/whatsapp-approved-chats.json"
  );
  assert.equal(
    whatsapp.defaultApprovedChatsPath({ SABLE_INSTANCE_HOME: "/srv/alex" }),
    "/srv/alex/.config/sable/whatsapp-approved-chats.json"
  );
  assert.equal(
    whatsapp.defaultSessionPath({ SABLE_INSTANCE_HOME: "/srv/alex" }),
    "/srv/alex/.local/state/sable-whatsapp"
  );
});

test("whatsapp allowlist matches by id or exact chat name", () => {
  const approved = [
    { id: "123@c.us", name: "Alice" },
    { name: "Book Club" },
  ];

  assert.equal(whatsapp.isApprovedChat({ id: "123@c.us", name: "Someone" }, approved), true);
  assert.equal(whatsapp.isApprovedChat({ id: "other@g.us", name: "Book Club" }, approved), true);
  assert.equal(whatsapp.isApprovedChat({ id: "other@g.us", name: "Unapproved" }, approved), false);
});

test("whatsapp triage report surfaces only approved chats", () => {
  const now = new Date("2026-05-12T12:00:00Z");
  const report = whatsapp.formatTriageReport(
    [
      {
        id: "a@c.us",
        name: "Alice",
        unreadCount: 1,
        lastMessageAt: "2026-05-12T11:30:00Z",
        snippet: "are you around?",
      },
      {
        id: "spam@g.us",
        name: "Noisy Group",
        unreadCount: 99,
        lastMessageAt: "2026-05-12T11:30:00Z",
        snippet: "ignored",
      },
    ],
    {
      approvedChats: [{ id: "a@c.us" }],
      now,
    }
  );

  assert.match(report, /1 approved chat surfaced/);
  assert.match(report, /Alice/);
  assert.doesNotMatch(report, /Noisy Group/);
  assert.match(report, /Ignored \/ filtered: 1/);
});

test("whatsapp cli can triage a fixture with approved-chat config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-whatsapp-"));
  const approvedPath = path.join(tempDir, "approved.json");
  const inputPath = path.join(tempDir, "chats.json");
  const originalLog = console.log;
  let output = "";

  try {
    await fs.writeFile(
      approvedPath,
      JSON.stringify({ approvedChats: [{ name: "Alice" }] }),
      "utf8"
    );
    await fs.writeFile(
      inputPath,
      JSON.stringify([
        { name: "Alice", unreadCount: 1, lastMessageAt: "2026-05-12T11:30:00Z", snippet: "ping" },
        { name: "Bob", unreadCount: 1, lastMessageAt: "2026-05-12T11:30:00Z", snippet: "hidden" },
      ]),
      "utf8"
    );
    console.log = (message) => {
      output = message;
    };

    const code = await whatsapp.asyncMain([
      "triage",
      "--approved-chats",
      approvedPath,
      "--input-json",
      inputPath,
      "--limit",
      "5",
    ]);

    assert.equal(code, 0);
    assert.match(output, /Alice/);
    assert.doesNotMatch(output, /Bob/);
  } finally {
    console.log = originalLog;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
