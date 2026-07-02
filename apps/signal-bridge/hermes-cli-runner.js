"use strict";

function createHermesCliRunnerAdapter({
  spawn,
  containerName = "hermes-sable-trial",
  workspaceDir = "/opt/data/workspace",
  timeoutMs = 600_000,
  normalizeText,
  timestamp = () => new Date().toISOString(),
  onStderr = () => {},
  onLifecycle = () => {},
}) {
  function buildLaunchArgs() {
    return [
      "exec",
      "-i",
      "-u",
      "hermes",
      containerName,
      "sh",
      "-lc",
      [
        "export HOME=/opt/data/home",
        "export HERMES_HOME=/opt/data",
        "export PYTHONPATH=/opt/data/home/python-packages:${PYTHONPATH:-}",
        "export PATH=/opt/data/home/.npm-global/bin:/opt/hermes/.venv/bin:${PATH:-}",
        "export CODEX_HOME=/opt/data/home/.codex",
        `cd ${shellQuote(workspaceDir)}`,
        'prompt="$(cat)"',
        '/opt/hermes/.venv/bin/hermes -z "$prompt" --accept-hooks',
      ].join("; "),
    ];
  }

  function buildChildEnv() {
    return { ...process.env };
  }

  function recordTestLaunchArgs() {
    onLifecycle({
      method: "hermes-cli/launch",
      params: {
        runner: "hermes-cli",
        containerName,
        workspaceDir,
        args: buildLaunchArgs(),
      },
    });
  }

  function runTurn(
    prompt,
    _sessionId = null,
    _imagePaths = [],
    jobControl = null
  ) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", buildLaunchArgs(), {
        cwd: process.cwd(),
        env: buildChildEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        fail(new Error("Hermes CLI turn timed out"));
      }, timeoutMs);

      const unregisterCancellation = registerCancellationHandler(jobControl, () => {
        fail(new Error("Hermes CLI turn cancelled"));
      });

      function cleanup() {
        clearTimeout(timeout);
        unregisterCancellation();
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      }

      function fail(error) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }

      function succeed() {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve({
          sessionId: null,
          message: normalizeText(stdout),
          toolSuggestion: null,
          startedFreshBecauseResumeFailed: false,
        });
      }

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const text = normalizeText(chunk);
        if (text) {
          onStderr(text);
        }
      });

      child.on("error", fail);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          succeed();
          return;
        }

        const suffix = stderr ? `: ${normalizeText(stderr)}` : "";
        fail(new Error(`Hermes CLI exited with code ${code ?? "null"} signal ${signal || "none"}${suffix}`));
      });

      child.stdin.end(String(prompt || ""), (error) => {
        if (error) {
          fail(error);
        }
      });
    });
  }

  async function probeRuntimeProfile() {
    return {
      observedAt: timestamp(),
      runner: "hermes-cli",
      containerName,
      workspaceDir,
      model: "hermes-profile-default",
      codexHome: "/opt/data/home/.codex",
    };
  }

  return {
    id: "hermes-cli",
    kind: "runner",
    displayName: "Hermes CLI",
    buildLaunchArgs,
    buildChildEnv,
    recordTestLaunchArgs,
    runTurn,
    probeRuntimeProfile,
  };
}

function registerCancellationHandler(jobControl, handler) {
  if (!jobControl || typeof handler !== "function") {
    return () => {};
  }
  if (jobControl.cancelled) {
    handler(jobControl.reason || new Error("Hermes CLI turn cancelled"));
    return () => {};
  }
  if (!jobControl.handlers || typeof jobControl.handlers.add !== "function") {
    return () => {};
  }
  jobControl.handlers.add(handler);
  return () => {
    jobControl.handlers.delete(handler);
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

module.exports = {
  createHermesCliRunnerAdapter,
};
