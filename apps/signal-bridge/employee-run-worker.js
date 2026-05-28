#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");

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
  updateStatus(args.status, {
    completedAt: new Date().toISOString(),
    error: exit.error || "",
    exitCode: exit.code,
    signal: exit.signal || "",
    status: exit.code === 0 ? "completed" : "failed",
  });
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

