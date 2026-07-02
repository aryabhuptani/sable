const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

test("employee run worker posts completion with employee Mattermost token", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-employee-worker-"));
  const runner = path.join(temp, "runner.sh");
  fs.writeFileSync(
    runner,
    ["#!/bin/sh", "cat >/dev/null", "exit 0", ""].join("\n"),
    "utf8"
  );
  fs.chmodSync(runner, 0o755);

  const tokenPath = path.join(temp, "mattermost-token");
  writeText(tokenPath, "employee-token\n");
  const promptPath = path.join(temp, "prompt.md");
  writeText(promptPath, "Do the thing.\n");
  const lastMessagePath = path.join(temp, "last-message.md");
  writeText(lastMessagePath, "Finished the thing.\n");
  const statusPath = path.join(temp, "status.json");
  const status = {
    id: "run-1",
    employeeId: "researcher",
    runDir: temp,
    stdoutPath: path.join(temp, "stdout.log"),
    stderrPath: path.join(temp, "stderr.log"),
    lastMessagePath,
    mattermostChannelId: "channel-research",
    mattermostTokenPath: tokenPath,
    invocation: {
      bin: runner,
      args: [],
      env: {},
    },
  };
  writeText(statusPath, `${JSON.stringify(status, null, 2)}\n`);

  const mattermost = await startFakeMattermost();

  try {
    const workerPath = path.join(__dirname, "..", "apps", "signal-bridge", "employee-run-worker.js");
    const child = spawn(process.execPath, [workerPath, "--status", statusPath, "--prompt", promptPath], {
      env: {
        ...process.env,
        MATTERMOST_BASE_URL: mattermost.baseUrl,
        MATTERMOST_TOKEN: "parent-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = await waitForExit(child);

    assert.equal(output.code, 0, output.stderr);
    assert.equal(mattermost.requests.length, 1);
    assert.equal(mattermost.requests[0].method, "POST");
    assert.equal(mattermost.requests[0].url, "/api/v4/posts");
    assert.equal(mattermost.requests[0].headers.authorization, "Bearer employee-token");
    const body = JSON.parse(mattermost.requests[0].body);
    assert.equal(body.channel_id, "channel-research");
    assert.match(body.message, /^\[researcher:run-1\]/);
    assert.match(body.message, /Finished the thing/);
    const finalStatus = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.equal(finalStatus.status, "completed");
  } finally {
    await mattermost.close();
  }
});

test("employee run worker records failed runner and posts failure summary", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sable-employee-worker-fail-"));
  const runner = path.join(temp, "runner.sh");
  fs.writeFileSync(
    runner,
    ["#!/bin/sh", "cat >/dev/null", "exit 42", ""].join("\n"),
    "utf8"
  );
  fs.chmodSync(runner, 0o755);

  const tokenPath = path.join(temp, "mattermost-token");
  writeText(tokenPath, "employee-token\n");
  const promptPath = path.join(temp, "prompt.md");
  writeText(promptPath, "Do the thing.\n");
  const statusPath = path.join(temp, "status.json");
  const status = {
    id: "run-fail",
    employeeId: "researcher",
    runDir: temp,
    stdoutPath: path.join(temp, "stdout.log"),
    stderrPath: path.join(temp, "stderr.log"),
    lastMessagePath: path.join(temp, "missing-last-message.md"),
    mattermostChannelId: "channel-research",
    mattermostTokenPath: tokenPath,
    invocation: {
      bin: runner,
      args: [],
      env: {},
    },
  };
  writeText(statusPath, `${JSON.stringify(status, null, 2)}\n`);

  const mattermost = await startFakeMattermost();

  try {
    const workerPath = path.join(__dirname, "..", "apps", "signal-bridge", "employee-run-worker.js");
    const child = spawn(process.execPath, [workerPath, "--status", statusPath, "--prompt", promptPath], {
      env: {
        ...process.env,
        MATTERMOST_BASE_URL: mattermost.baseUrl,
        MATTERMOST_TOKEN: "parent-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = await waitForExit(child);

    assert.equal(output.code, 0, output.stderr);
    assert.equal(mattermost.requests.length, 1);
    assert.equal(mattermost.requests[0].method, "POST");
    assert.equal(mattermost.requests[0].url, "/api/v4/posts");
    assert.equal(mattermost.requests[0].headers.authorization, "Bearer employee-token");
    const body = JSON.parse(mattermost.requests[0].body);
    assert.equal(body.channel_id, "channel-research");
    assert.match(body.message, /^\[researcher:run-fail\]/);
    assert.match(body.message, /Employee run failed\./);
    const finalStatus = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.equal(finalStatus.status, "failed");
    assert.equal(finalStatus.exitCode, 42);
  } finally {
    await mattermost.close();
  }
});

function startFakeMattermost() {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        body,
        headers: request.headers,
        method: request.method,
        url: request.url,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "post-id" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
        requests,
      });
    });
  });
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text, "utf8");
}

function waitForExit(child) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
