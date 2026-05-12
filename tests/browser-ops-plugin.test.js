const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseBrowserArgs,
  registerPlugin,
  tokenize,
} = require("../plugins/browser-ops/handler");

test("browser ops tokenizes quoted arguments", () => {
  assert.deepEqual(tokenize('calendar-link-plan --link "https://calendar.app.google/abc def"'), [
    "calendar-link-plan",
    "--link",
    "https://calendar.app.google/abc def",
  ]);
});

test("browser ops parser extracts subcommand and options", () => {
  assert.deepEqual(parseBrowserArgs("calendar-link-plan --timezone America/Los_Angeles"), {
    subcommand: "calendar-link-plan",
    options: {
      timezone: "America/Los_Angeles",
    },
  });
});

test("browser ops registers debug command", () => {
  const commands = [];
  registerPlugin({
    registerCommand: (name, handler, metadata) => commands.push({ handler, metadata, name }),
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "/browser");
  assert.match(commands[0].metadata.description, /browser automation/);
});
