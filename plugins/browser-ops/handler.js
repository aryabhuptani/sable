"use strict";

const { execFile } = require("node:child_process");

function registerPlugin(api) {
  api.registerCommand("/browser", async ({ args }) => {
    const parsed = parseBrowserArgs(args);
    if (parsed.subcommand === "status") {
      return runBrowserCli(["status"]);
    }
    if (parsed.subcommand === "calendar-link-plan") {
      const cliArgs = [
        "calendar-link-plan",
        "--timezone",
        parsed.options.timezone || "America/Los_Angeles",
      ];
      if (parsed.options.link) {
        cliArgs.push("--link", parsed.options.link);
      }
      if (parsed.options.start) {
        cliArgs.push("--start", parsed.options.start);
      }
      if (parsed.options.end) {
        cliArgs.push("--end", parsed.options.end);
      }
      return runBrowserCli(cliArgs);
    }
    return [
      "Browser ops debug commands:",
      "- /browser status",
      "- /browser calendar-link-plan --timezone America/Los_Angeles --link https://calendar.app.google/...",
      "",
      "For normal use, ask in natural language. The slash command exists so Sable has an escape hatch, not because we enjoy making you type tiny bureaucratic spells.",
    ].join("\n");
  }, {
    description: "Inspect or prepare browser automation tasks.",
  });
}

function parseBrowserArgs(input) {
  const tokens = tokenize(input);
  const subcommand = tokens[0] || "help";
  const options = {};
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      continue;
    }
    options[token.slice(2)] = tokens[index + 1] || "";
    index += 1;
  }
  return { options, subcommand };
}

function tokenize(input) {
  return String(input || "").match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) || [];
}

async function runBrowserCli(args) {
  const result = await execFilePromise(process.execPath, [
    "tools/browser/browser_cli.js",
    ...args,
  ], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 60_000,
  });
  if (result.exitCode !== 0) {
    return `Browser ops failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`;
  }
  return result.stdout.trim() || "Browser ops completed.";
}

function execFilePromise(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({
        exitCode: error?.code || 0,
        stderr: String(stderr || "").trim(),
        stdout: String(stdout || "").trim(),
      });
    });
  });
}

module.exports = {
  parseBrowserArgs,
  registerPlugin,
  tokenize,
};
