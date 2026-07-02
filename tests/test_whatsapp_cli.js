const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const whatsapp = require("../tools/whatsapp/whatsapp_cli");

function exportApprovedArgs({ approvedPath, outputPath }) {
  return ["export-approved", "--approved-chats", approvedPath, "--out", outputPath];
}

async function assertFileMissing(filePath) {
  await assert.rejects(() => fs.access(filePath), { code: "ENOENT" });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runCliCapturingLog(args, env) {
  const originalLog = console.log;
  let output = "";
  try {
    console.log = (message) => {
      output = message;
    };
    const code = await whatsapp.asyncMain(args, env);
    return { code, output };
  } finally {
    console.log = originalLog;
  }
}

async function withMissingPuppeteer(callback) {
  const originalLoad = Module._load;
  try {
    Module._load = function loadWithMissingPuppeteer(request) {
      if (request === "puppeteer") {
        const error = new Error("Cannot find module 'puppeteer'");
        error.code = "MODULE_NOT_FOUND";
        throw error;
      }
      return originalLoad.apply(this, arguments);
    };
    return await callback();
  } finally {
    Module._load = originalLoad;
  }
}

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

test("whatsapp approved-chat config merges env and file entries without duplicates", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-whatsapp-approved-"));
  const approvedPath = path.join(tempDir, "approved.json");

  try {
    await fs.writeFile(
      approvedPath,
      JSON.stringify({
        approvedChats: [
          "Bob",
          { id: "book@g.us", name: "Book Club" },
        ],
      }),
      "utf8"
    );

    const approved = whatsapp.loadApprovedChats({
      env: { SABLE_WHATSAPP_APPROVED_CHATS: "Alice, Bob" },
      filePath: approvedPath,
    });

    assert.deepEqual(approved, [
      { id: "Alice", name: "Alice" },
      { id: "Bob", name: "Bob" },
      { id: "book@g.us", name: "Book Club" },
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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

  try {
    await fs.writeFile(
      approvedPath,
      JSON.stringify({ approvedChats: [{ name: "Alice" }] }),
      "utf8"
    );
    await fs.writeFile(
      inputPath,
      JSON.stringify([
        { name: "Alice", unreadCount: 1, lastMessageAt: "2999-05-12T11:30:00Z", snippet: "ping" },
        { name: "Bob", unreadCount: 1, lastMessageAt: "2999-05-12T11:30:00Z", snippet: "hidden" },
      ]),
      "utf8"
    );

    const { code, output } = await runCliCapturingLog([
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
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("whatsapp triage honors approved-config alias over default config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-whatsapp-triage-approved-config-"));
  const instanceHome = path.join(tempDir, "instance");
  const defaultApprovedPath = path.join(instanceHome, ".config", "sable", "whatsapp-approved-chats.json");
  const explicitApprovedPath = path.join(tempDir, "travel-approved.json");
  const inputPath = path.join(tempDir, "chats.json");

  try {
    await fs.mkdir(path.dirname(defaultApprovedPath), { recursive: true });
    await fs.writeFile(
      defaultApprovedPath,
      JSON.stringify({ approvedChats: [{ name: "Default Chat" }] }),
      "utf8"
    );
    await fs.writeFile(
      explicitApprovedPath,
      JSON.stringify({ approvedChats: [{ name: "Travel Chat" }] }),
      "utf8"
    );
    await fs.writeFile(
      inputPath,
      JSON.stringify([
        { name: "Default Chat", unreadCount: 1, lastMessageAt: "2999-05-12T11:30:00Z", snippet: "hidden" },
        { name: "Travel Chat", unreadCount: 1, lastMessageAt: "2999-05-12T11:30:00Z", snippet: "surface" },
      ]),
      "utf8"
    );

    const { code, output } = await runCliCapturingLog(
      [
        "triage",
        "--approved-config",
        explicitApprovedPath,
        "--input-json",
        inputPath,
        "--limit",
        "5",
      ],
      { SABLE_INSTANCE_HOME: instanceHome }
    );

    assert.equal(code, 0);
    assert.match(output, /Travel Chat/);
    assert.doesNotMatch(output, /Default Chat/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("whatsapp export-approved refuses empty approved-chat config before opening browser", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-whatsapp-export-"));
  const approvedPath = path.join(tempDir, "approved.json");
  const outputPath = path.join(tempDir, "export.md");

  try {
    await fs.writeFile(approvedPath, JSON.stringify({ approvedChats: [] }), "utf8");

    await assert.rejects(
      () =>
        whatsapp.asyncMain(exportApprovedArgs({ approvedPath, outputPath })),
      /No approved WhatsApp chats configured/
    );

    await assertFileMissing(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("whatsapp export-approved honors approved-config alias over default config", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-whatsapp-approved-config-"));
  const instanceHome = path.join(tempDir, "instance");
  const defaultApprovedPath = path.join(instanceHome, ".config", "sable", "whatsapp-approved-chats.json");
  const explicitApprovedPath = path.join(tempDir, "admin-approved.json");
  const outputPath = path.join(tempDir, "export.md");

  try {
    await fs.mkdir(path.dirname(defaultApprovedPath), { recursive: true });
    await fs.writeFile(
      defaultApprovedPath,
      JSON.stringify({ approvedChats: [{ name: "Default Chat" }] }),
      "utf8"
    );
    await fs.writeFile(explicitApprovedPath, JSON.stringify({ approvedChats: [] }), "utf8");

    await assert.rejects(
      () =>
        whatsapp.asyncMain(
          ["export-approved", "--approved-config", explicitApprovedPath, "--out", outputPath],
          { SABLE_INSTANCE_HOME: instanceHome }
        ),
      new RegExp(`No approved WhatsApp chats configured in ${escapeRegExp(explicitApprovedPath)}`)
    );

    await assertFileMissing(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("whatsapp export-approved uses approved-config alias before browser dependency loading", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-whatsapp-approved-config-browser-"));
  const instanceHome = path.join(tempDir, "instance");
  const defaultApprovedPath = path.join(instanceHome, ".config", "sable", "whatsapp-approved-chats.json");
  const explicitApprovedPath = path.join(tempDir, "admin-approved.json");
  const outputPath = path.join(tempDir, "export.md");

  try {
    await fs.mkdir(path.dirname(defaultApprovedPath), { recursive: true });
    await fs.writeFile(defaultApprovedPath, JSON.stringify({ approvedChats: [] }), "utf8");
    await fs.writeFile(
      explicitApprovedPath,
      JSON.stringify({ approvedChats: [{ name: "Bhuptani admin" }] }),
      "utf8"
    );

    await assert.rejects(
      () =>
        withMissingPuppeteer(() =>
          whatsapp.asyncMain(
            ["export-approved", "--approved-config", explicitApprovedPath, "--out", outputPath],
            { SABLE_INSTANCE_HOME: instanceHome }
          )
        ),
      /puppeteer is not installed/
    );

    await assertFileMissing(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("whatsapp export-approved fails clearly before writing output when puppeteer is unavailable", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sable-whatsapp-export-dep-"));
  const approvedPath = path.join(tempDir, "approved.json");
  const outputPath = path.join(tempDir, "export.md");

  try {
    await fs.writeFile(
      approvedPath,
      JSON.stringify({ approvedChats: [{ name: "Arjun's passport application" }] }),
      "utf8"
    );

    await assert.rejects(
      () =>
        withMissingPuppeteer(() =>
          whatsapp.asyncMain(exportApprovedArgs({ approvedPath, outputPath }))
        ),
      /puppeteer is not installed/
    );

    await assertFileMissing(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("whatsapp approved-chat export formats bounded chat text", () => {
  const output = whatsapp.formatApprovedChatExport([
    {
      name: "Arjun's passport application",
      header: "Arjun's passport application\nAndreia, Dad, You",
      text: "Today\nAndreia Cruz\nthank you\n09:59",
    },
  ]);

  assert.match(output, /# Arjun's passport application/);
  assert.match(output, /Header: Arjun's passport application/);
  assert.match(output, /```text\nToday/);
});
