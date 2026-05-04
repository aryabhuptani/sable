function createBridgeLifecycle(options = {}) {
  const {
    backgroundQueue,
    broadcastAllowedMessage,
    clearInFlightTurn,
    closeServer,
    fs,
    getInFlightTurn,
    hasActiveWork,
    interactiveQueue,
    logger = console,
    processBackgroundQueue,
    processExit = (code) => process.exit(code),
    processInteractiveQueue,
    restartNoticePath,
    restartRequestPath,
    sendReply,
    setRestartRequested,
    setShutdownRequested,
    signalRpc,
    timestamp = () => new Date().toISOString(),
    getRestartRequested,
    getShutdownRequested,
  } = options;

  function checkForRestartRequest() {
    if (!getRestartRequested() && fs.existsSync(restartRequestPath)) {
      setRestartRequested(true);
    }

    if (!hasActiveWork()) {
      void restartIfRequested();
    }
  }

  async function restartIfRequested() {
    if (!getRestartRequested()) {
      return;
    }

    setRestartRequested(false);

    try {
      await broadcastAllowedMessage("🟡 Restarting Connection to Sable");
      await fs.promises.writeFile(restartNoticePath, `${timestamp()}\n`, "utf8");
    } catch (error) {
      logger.error?.(`[${timestamp()}] Failed sending restart notification: ${error.message}`);
    }

    try {
      await fs.promises.rm(restartRequestPath, { force: true });
    } catch (error) {
      logger.error?.(`[${timestamp()}] Failed clearing restart request: ${error.message}`);
    }

    logger.log?.(`[${timestamp()}] Restart requested after completing current work`);
    signalRpc.kill("SIGTERM");
    processExit(0);
  }

  async function maybeSendRestartReconnectNotice() {
    if (!fs.existsSync(restartNoticePath)) {
      return;
    }

    try {
      await broadcastAllowedMessage("🟢 Reconnected to Sable");
      await fs.promises.rm(restartNoticePath, { force: true });
    } catch (error) {
      logger.error?.(`[${timestamp()}] Failed sending reconnect notification: ${error.message}`);
    }
  }

  async function maybeSendInterruptedTurnNotice() {
    const inFlightTurn = getInFlightTurn();
    if (!inFlightTurn) {
      return;
    }

    clearInFlightTurn();

    try {
      await sendReply(inFlightTurn.sender, formatInterruptedTurnNotice(inFlightTurn));
    } catch (error) {
      logger.error?.(
        `[${timestamp()}] Failed sending interrupted-turn notice: ${error.message}`
      );
    }
  }

  function shutdown() {
    if (getShutdownRequested()) {
      return;
    }

    setShutdownRequested(true);

    if (hasActiveWork()) {
      setRestartRequested(true);
      logger.log?.(
        `[${timestamp()}] Shutdown requested while work is active; deferring exit until both queues drain`
      );
      if (interactiveQueue.length > 0) {
        void processInteractiveQueue();
      }
      if (backgroundQueue.length > 0) {
        void processBackgroundQueue();
      }
      return;
    }

    logger.log?.(`[${timestamp()}] Shutting down bridge`);
    closeServer();
    signalRpc.rejectAllPendingRequests(new Error("Bridge shutting down"));
    signalRpc.kill("SIGTERM");
    processExit(0);
  }

  return {
    checkForRestartRequest,
    formatInterruptedTurnNotice,
    maybeSendInterruptedTurnNotice,
    maybeSendRestartReconnectNotice,
    restartIfRequested,
    shutdown,
  };
}

function formatInterruptedTurnNotice(interruptedTurn) {
  const lines = [
    "Previous reply was interrupted by a bridge restart before Sable could finish.",
    "Ask me to continue and I'll pick it back up if the session survived.",
  ];

  if (interruptedTurn.promptPreview) {
    lines.push(`Last prompt: ${interruptedTurn.promptPreview}`);
  }

  return lines.join("\n");
}

module.exports = {
  createBridgeLifecycle,
  formatInterruptedTurnNotice,
};
