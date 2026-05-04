function createSignalRpcSession(options = {}) {
  const {
    logger = console,
    onExit = () => {},
    onReceive = () => {},
    onStderr = () => {},
    phoneNumber,
    projectDir,
    spawn,
    testSignalLogPath = "",
    testSupport = null,
    timestamp = () => new Date().toISOString(),
  } = options;

  let signalProcess = null;
  let stdoutBuffer = "";
  let nextRequestId = 1;
  const pendingRequests = new Map();

  function start() {
    signalProcess = spawn(
      "signal-cli",
      ["-a", phoneNumber, "jsonRpc", "--receive-mode=on-start"],
      {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    signalProcess.stdout.setEncoding("utf8");
    signalProcess.stdout.on("data", handleStdout);

    signalProcess.stderr.setEncoding("utf8");
    signalProcess.stderr.on("data", (chunk) => {
      const text = chunk.trim();
      if (text) {
        onStderr(text);
        logger.error?.(`[${timestamp()}] signal-cli stderr: ${text}`);
      }
    });

    signalProcess.on("error", (error) => {
      logger.error?.(`[${timestamp()}] Failed to start signal-cli: ${error.message}`);
      onExit(1, null, error);
    });

    signalProcess.on("exit", (code, signal) => {
      rejectAllPendingRequests(
        new Error(`signal-cli exited (code=${code}, signal=${signal || "none"})`)
      );
      logger.error?.(
        `[${timestamp()}] signal-cli exited (code=${code}, signal=${signal || "none"})`
      );
      onExit(code ?? 1, signal || null);
    });

    logger.log?.(`[${timestamp()}] Started signal-cli JSON-RPC listener for ${phoneNumber}`);
  }

  function handleStdout(chunk) {
    stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      let message;

      try {
        message = JSON.parse(line);
      } catch (error) {
        logger.error?.(`[${timestamp()}] Ignoring non-JSON signal-cli output: ${line}`);
        continue;
      }

      if (message.method === "receive") {
        void onReceive(message);
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(message, "id")) {
        const pending = pendingRequests.get(message.id);
        if (pending) {
          pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(
              new Error(message.error.message || "signal-cli returned an unknown error")
            );
          } else {
            pending.resolve(message.result);
          }
        }
        continue;
      }

      logger.log?.(`[${timestamp()}] signal-cli event: ${line}`);
    }
  }

  function sendRequest(method, params) {
    if (testSignalLogPath) {
      testSupport?.appendSignalLog?.({
        direction: "request",
        message: {
          jsonrpc: "2.0",
          method,
          params,
        },
      });

      if (method === "getAttachment") {
        const attachment = testSupport?.getAttachmentMap?.()[params?.id];
        return Promise.resolve(attachment ? { data: attachment.dataBase64 } : { data: "" });
      }

      if (method === "send") {
        return Promise.resolve({ timestamp: Date.now() });
      }

      if (method === "updateProfile") {
        return Promise.resolve({ ok: true });
      }
    }

    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id,
      });

      pendingRequests.set(id, { resolve, reject });

      signalProcess.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          pendingRequests.delete(id);
          reject(error);
        }
      });
    });
  }

  function rejectAllPendingRequests(error) {
    for (const [id, pending] of pendingRequests.entries()) {
      pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  function kill(signal = "SIGTERM") {
    if (signalProcess && !signalProcess.killed) {
      signalProcess.kill(signal);
      return true;
    }
    return false;
  }

  function isRunning() {
    return Boolean(signalProcess && !signalProcess.killed);
  }

  return {
    handleStdout,
    isRunning,
    kill,
    rejectAllPendingRequests,
    sendRequest,
    start,
  };
}

module.exports = {
  createSignalRpcSession,
};
