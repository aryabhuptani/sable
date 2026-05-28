#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");

const { createMattermostClient } = require("./mattermost-client");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const status = JSON.parse(fs.readFileSync(args.status, "utf8"));
  const prompt = fs.readFileSync(args.prompt, "utf8");
  const invocation = status.invocation;
  if (!invocation?.bin) {
    throw new Error("Employee run status is missing invocation.");
  }

  updateStatus(args.status, {
    workerPid: process.pid,
    runnerStartedAt: new Date().toISOString(),
    status: "running",
  });

  const stdout = fs.openSync(status.stdoutPath, "a");
  const stderr = fs.openSync(status.stderrPath, "a");
  const child = spawn(invocation.bin, invocation.args || [], {
    cwd: status.runDir,
    env: {
      ...process.env,
      ...(invocation.env || {}),
    },
    stdio: ["pipe", stdout, stderr],
  });
  if (child.stdin) {
    child.stdin.end(prompt);
  }
  updateStatus(args.status, {
    runnerPid: child.pid || null,
    updatedAt: new Date().toISOString(),
  });
  const exit = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", (error) => resolve({ code: 1, signal: "", error: error.message }));
  });
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const finalPatch = {
    completedAt: new Date().toISOString(),
    error: exit.error || "",
    exitCode: exit.code,
    signal: exit.signal || "",
    status: exit.code === 0 ? "completed" : "failed",
  };
  updateStatus(args.status, finalPatch);
  await maybePostMattermostCompletion({ ...status, ...finalPatch });
}

function parseArgs(argv) {
  const args = { prompt: "", status: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prompt") {
      args.prompt = argv[++index] || "";
    } else if (arg === "--status") {
      args.status = argv[++index] || "";
    }
  }
  if (!args.prompt || !args.status) {
    throw new Error("Usage: employee-run-worker.js --status FILE --prompt FILE");
  }
  return args;
}

function updateStatus(statusPath, patch) {
  const current = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  fs.writeFileSync(
    statusPath,
    `${JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

async function maybePostMattermostCompletion(status) {
  const channelId = status.mattermostChannelId;
  const token = readMattermostToken(status.mattermostTokenPath) || process.env.MATTERMOST_TOKEN;
  if (!channelId || !process.env.MATTERMOST_BASE_URL || !token) {
    return;
  }
  let message = "";
  try {
    message = fs.readFileSync(status.lastMessagePath, "utf8").trim();
  } catch {
    message = "";
  }
  if (!message) {
    message = status.status === "completed"
      ? "Employee run completed without a final message."
      : `Employee run failed${status.error ? `: ${status.error}` : "."}`;
  }
  const prefix = `[${status.employeeId || "employee"}:${status.id || "run"}]`;
  const body = `${prefix}\n${truncateForMattermost(message)}`;
  const client = createMattermostClient({
    baseUrl: process.env.MATTERMOST_BASE_URL,
    token,
  });
  await client.postMessage(channelId, body);
}

function readMattermostToken(tokenPath) {
  if (!tokenPath) {
    return "";
  }
  try {
    return fs.readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

function truncateForMattermost(text, maxLength = 3500) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 20)}\n...[truncated]`;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
