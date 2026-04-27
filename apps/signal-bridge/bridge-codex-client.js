function createBridgeCodexClient({
  spawn,
  cwd,
  projectDir,
  signalReplyToEnv,
  signalBridgeDirEnv,
  appServerClientVersion,
  appServerRequestTimeoutMs,
  normalizeText,
  timestamp,
  appendTestAppServerLog,
  onStderr,
  envSource = process.env,
}) {
  function buildCodexAppServerArgs() {
    return [
      "--search",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      cwd,
      "-c",
      "shell_environment_policy.inherit=all",
      "app-server",
      "--listen",
      "stdio://",
    ];
  }

  function buildCodexChildEnv(replyRecipient = "") {
    const env = { ...envSource };
    // Let Codex use its default home; the bridge's dedicated home can carry a
    // sandbox profile that hides Codex's own vendored runtime under /usr/lib.
    delete env.CODEX_HOME;
    env[signalBridgeDirEnv] = projectDir;

    const normalizedRecipient = normalizeText(replyRecipient);
    if (normalizedRecipient) {
      env[signalReplyToEnv] = normalizedRecipient;
    } else {
      delete env[signalReplyToEnv];
    }

    return env;
  }

  function recordTestAppServerSpawnArgs() {
    appendTestAppServerLog({
      method: "spawn",
      params: {
        args: buildCodexAppServerArgs(),
      },
    });
  }

  function createAppServerClient({
    onNotification,
    onServerRequest,
    replyRecipient = "",
  }) {
    const child = spawn("codex", buildCodexAppServerArgs(), {
      cwd,
      env: buildCodexChildEnv(replyRecipient),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    let nextRequestId = 1;
    const pending = new Map();
    let closed = false;

    function rejectPending(error) {
      for (const [id, entry] of pending.entries()) {
        pending.delete(id);
        entry.reject(error);
      }
    }

    function close() {
      if (closed) {
        return;
      }
      closed = true;
      rejectPending(new Error("app-server client closed"));
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    function request(method, params) {
      const id = nextRequestId++;
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${payload}\n`, (error) => {
          if (error) {
            pending.delete(id);
            reject(error);
          }
        });
      });
    }

    async function initialize() {
      return request("initialize", {
        clientInfo: {
          name: "signal-codex-bridge",
          version: appServerClientVersion,
        },
        capabilities: {
          experimentalApi: true,
        },
      });
    }

    async function handleServerRequestMessage(message) {
      let result = {};

      try {
        if (typeof onServerRequest === "function") {
          result = (await onServerRequest(message)) || {};
        }
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`
        );
      } catch (error) {
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: error.message || "Bridge server request failed" },
          })}\n`
        );
      }
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
          const entry = pending.get(message.id);
          if (!entry) {
            continue;
          }

          pending.delete(message.id);
          if (message.error) {
            entry.reject(new Error(message.error.message || "Unknown app-server error"));
          } else {
            entry.resolve(message.result);
          }
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
          void handleServerRequestMessage(message);
          continue;
        }

        if (typeof onNotification === "function") {
          onNotification(message);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const text = chunk.trim();
      if (text) {
        onStderr(text);
      }
    });

    child.on("error", (error) => {
      rejectPending(error);
    });

    child.on("exit", (code) => {
      if (!closed && code !== 0) {
        rejectPending(new Error(`codex app-server exited with code ${code}`));
      }
    });

    return {
      initialize,
      request,
      close,
    };
  }

  function callCodexAppServer(method, params, { replyRecipient = "" } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn("codex", buildCodexAppServerArgs(), {
        cwd,
        env: buildCodexChildEnv(replyRecipient),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let buffer = "";
      let nextRequestId = 1;
      const pending = new Map();
      let settled = false;
      const timeout = setTimeout(() => {
        fail(new Error(`app-server request timed out for ${method}`));
      }, appServerRequestTimeoutMs);

      function cleanup() {
        clearTimeout(timeout);
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

      function succeed(result) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      }

      function sendRequest(requestMethod, requestParams) {
        const id = nextRequestId++;
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: requestMethod,
          params: requestParams,
        });

        return new Promise((innerResolve, innerReject) => {
          pending.set(id, { resolve: innerResolve, reject: innerReject });
          child.stdin.write(`${payload}\n`, (error) => {
            if (error) {
              pending.delete(id);
              innerReject(error);
            }
          });
        });
      }

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) {
            break;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          let message;
          try {
            message = JSON.parse(line);
          } catch (error) {
            continue;
          }

          if (Object.prototype.hasOwnProperty.call(message, "id")) {
            const entry = pending.get(message.id);
            if (!entry) {
              continue;
            }

            pending.delete(message.id);
            if (message.error) {
              entry.reject(new Error(message.error.message || "Unknown app-server error"));
            } else {
              entry.resolve(message.result);
            }
          }
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        const text = chunk.trim();
        if (text) {
          onStderr(text);
        }
      });

      child.on("error", fail);
      child.on("exit", (code) => {
        if (!settled && code !== 0) {
          fail(new Error(`codex app-server exited with code ${code}`));
        }
      });

      (async () => {
        try {
          await sendRequest("initialize", {
            clientInfo: {
              name: "signal-codex-bridge",
              version: appServerClientVersion,
            },
            capabilities: {
              experimentalApi: true,
            },
          });

          const result = await sendRequest(method, params);
          succeed(result);
        } catch (error) {
          fail(error);
        }
      })();
    });
  }

  async function probeRuntimeProfile({ replyRecipient = "" } = {}) {
    const client = createAppServerClient({
      onNotification: () => {},
      onServerRequest: () => ({}),
      replyRecipient,
    });

    try {
      const init = await client.initialize();
      const thread = await client.request("thread/start", {
        cwd,
        approvalPolicy: "never",
        approvalsReviewer: "guardian_subagent",
        personality: "pragmatic",
      });

      return {
        observedAt: new Date().toISOString(),
        codexHome: init?.codexHome || "",
        sandbox: thread?.sandbox || null,
        permissionProfile: thread?.permissionProfile || null,
        model: thread?.model || "",
      };
    } finally {
      client.close();
    }
  }

  return {
    buildCodexAppServerArgs,
    buildCodexChildEnv,
    recordTestAppServerSpawnArgs,
    createAppServerClient,
    callCodexAppServer,
    probeRuntimeProfile,
  };
}

module.exports = {
  createBridgeCodexClient,
};
