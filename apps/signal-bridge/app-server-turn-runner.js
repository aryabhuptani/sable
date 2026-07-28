function buildAppServerThreadParams({
  codexCwd,
  threadId = null,
}) {
  const params = {
    cwd: codexCwd,
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "guardian_subagent",
    personality: "pragmatic",
  };

  if (threadId) {
    params.threadId = threadId;
  }

  return params;
}

function buildAppServerTurnParams({
  codexCwd,
  threadId,
  prompt,
  imagePaths = [],
}) {
  return {
    threadId,
    cwd: codexCwd,
    sandbox: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "guardian_subagent",
    personality: "pragmatic",
    input: [
      { type: "text", text: prompt },
      ...imagePaths.map((imagePath) => ({ type: "localImage", path: imagePath })),
    ],
  };
}

function getTurnFailureMessage(turn, normalizeText = (value) =>
  typeof value === "string" ? value.trim() : ""
) {
  if (!turn || normalizeText(turn.status).toLowerCase() !== "failed") {
    return "";
  }

  const rawMessage =
    normalizeText(turn.error?.message) ||
    normalizeText(turn.error) ||
    "The Codex runtime reported that the turn failed.";
  const normalizedError = rawMessage.toLowerCase();

  if (
    normalizedError.includes("token_expired") ||
    normalizedError.includes("refresh_token_reused") ||
    normalizedError.includes("authentication token is expired") ||
    normalizedError.includes("signing in again")
  ) {
    return "Sable's Codex login has expired and needs to be reauthenticated.";
  }

  return rawMessage;
}

function createAppServerTurnRunner({
  appServerMessages,
  codexCwd,
  codexSessionReader,
  createAppServerClient,
  createLiveUpdateChannel,
  formatProgressMessage,
  getActiveSender,
  isInvalidSessionError,
  logger = console,
  normalizeText,
  registerCancellationHandler,
  sendReply,
  testSupport,
  timestamp,
  truncateText,
  runtimeHooks,
}) {
  function buildThreadParams(threadId = null) {
    return buildAppServerThreadParams({ codexCwd, threadId });
  }

  function buildTurnParams(threadId, prompt, imagePaths = []) {
    return buildAppServerTurnParams({
      codexCwd,
      threadId,
      prompt,
      imagePaths,
    });
  }

  function runCodexViaAppServer(
    prompt,
    sessionId,
    imagePaths = [],
    jobControl = null,
    suppressLiveUpdates = false,
    onInvalidSession = null,
    replyRecipient = ""
  ) {
    return new Promise((resolve, reject) => {
      const startedAt = timestamp();
      const activeSender = normalizeText(replyRecipient) || getActiveSender();
      const liveUpdates = createLiveUpdateChannel({
        batchWindowMs: runtimeHooks.liveUpdateBatchWindowMs,
        duplicateWindowMs: runtimeHooks.liveUpdateDuplicateWindowMs,
        logger,
        normalizeText,
        recipient: suppressLiveUpdates ? "" : activeSender,
        sendReply,
        timestamp,
      });
      let parsedSessionId = sessionId || null;
      let pendingAgentMessage = null;
      let finalMessage = "";
      const subagentState = appServerMessages.createSubagentProgressState();
      let turnId = null;
      let toolSuggestion = null;
      let didFinish = false;
      let timeout = null;
      const toolSuggestionCalls = new Map();

      const client = createAppServerClient({
        onNotification: handleNotification,
        onServerRequest: handleServerRequest,
        replyRecipient: activeSender,
      });
      const unregisterCancellation = registerCancellationHandler(jobControl, (error) => {
        fail(error);
      });

      function resetTimeout() {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          fail(new Error("app-server turn timed out"));
        }, runtimeHooks.turnIdleTimeoutMs);
      }

      function cleanup() {
        clearTimeout(timeout);
        liveUpdates.stop();
        unregisterCancellation();
        client.close();
      }

      function fail(error) {
        if (didFinish) {
          return;
        }
        didFinish = true;
        cleanup();
        reject(error);
      }

      async function succeed() {
        if (didFinish) {
          return;
        }
        didFinish = true;

        if (pendingAgentMessage) {
          finalMessage = pendingAgentMessage;
          pendingAgentMessage = null;
        }

        try {
          await liveUpdates.flush();
        } catch (error) {
          logger.error(`[${timestamp()}] Failed flushing app-server live updates: ${error.message}`);
        }

        if (!toolSuggestion && parsedSessionId) {
          try {
            toolSuggestion = await codexSessionReader.findToolSuggestionForTurn(
              parsedSessionId,
              startedAt
            );
          } catch (error) {
            logger.error(
              `[${timestamp()}] Failed reading structured tool suggestions: ${error.message}`
            );
          }
        }

        if (!normalizeText(finalMessage) && parsedSessionId) {
          try {
            finalMessage = await codexSessionReader.findSessionErrorMessageForTurn(
              parsedSessionId,
              startedAt
            );
          } catch (error) {
            logger.error(
              `[${timestamp()}] Failed reading structured session error: ${error.message}`
            );
          }
        }

        cleanup();
        resolve({
          sessionId: parsedSessionId,
          message: finalMessage,
          toolSuggestion,
          startedFreshBecauseResumeFailed: false,
        });
      }

      function handleNotification(message) {
        resetTimeout();
        runtimeHooks.captureUsageSnapshot(message);
        runtimeHooks.captureRateLimitSnapshot(message);

        if (message.method === "turn/started") {
          turnId = normalizeText(message.params?.turn?.id) || turnId;
          runtimeHooks.noteTurnStarted();
          liveUpdates.queue("• Working...");
          return;
        }

        const rawSuggestion = appServerMessages.captureToolSuggestionFromNotification(
          message,
          toolSuggestionCalls
        );
        if (rawSuggestion) {
          toolSuggestion = rawSuggestion;
          return;
        }

        if (message.method === "item/started" || message.method === "item/completed") {
          appServerMessages.handleSubagentToolCallNotification(message, subagentState, liveUpdates);
          const parsed = appServerMessages.handleCodexAppServerItem(message.params?.item, {
            pendingAgentMessage,
            finalMessage,
            liveUpdates,
            subagentState,
          });
          pendingAgentMessage = parsed.pendingAgentMessage;
          finalMessage = parsed.finalMessage;
          return;
        }

        if (message.method === "item/mcpToolCall/progress") {
          const progress = normalizeText(message.params?.message);
          if (progress && !subagentState.activeCount) {
            liveUpdates.queue(formatProgressMessage(progress));
          }
          return;
        }

        if (message.method === "item/autoApprovalReview/started") {
          const summary =
            normalizeText(message.params?.review?.summary) || "Approval review in progress.";
          liveUpdates.queue(formatProgressMessage(summary));
          return;
        }

        if (message.method === "item/autoApprovalReview/completed") {
          const outcome =
            normalizeText(message.params?.review?.summary) ||
            normalizeText(message.params?.decisionSource) ||
            "Approval review completed.";
          liveUpdates.queue(formatProgressMessage(outcome));
          return;
        }

        if (message.method === "turn/completed") {
          if (normalizeText(message.params?.turn?.id) === turnId || !turnId) {
            runtimeHooks.noteTurnCompleted();
            finalMessage =
              finalMessage ||
              getTurnFailureMessage(message.params?.turn, normalizeText);
            void succeed();
          }
        }
      }

      async function handleServerRequest(message) {
        resetTimeout();

        if (message.method === "item/commandExecution/requestApproval") {
          return { decision: "approved" };
        }

        if (message.method === "item/fileChange/requestApproval") {
          return { decision: "approved" };
        }

        if (message.method === "item/permissions/requestApproval") {
          return {
            permissions: message.params?.permissions || {},
            scope: "turn",
          };
        }

        if (message.method === "item/tool/requestUserInput") {
          const promptText = appServerMessages.formatToolUserInputRequest(message.params);
          if (promptText && getActiveSender()) {
            await sendReply(getActiveSender(), promptText);
          }
          return { answers: {} };
        }

        if (message.method === "mcpServer/elicitation/request") {
          logger.log(
            `[${timestamp()}] MCP elicitation request: ${truncateText(
              JSON.stringify(message.params),
              600
            )}`
          );

          const autoResponse = appServerMessages.buildAutoAcceptedMcpElicitationResponse(
            message.params
          );
          if (autoResponse) {
            return autoResponse;
          }

          const promptText = appServerMessages.formatMcpElicitationRequest(message.params);
          if (promptText && getActiveSender()) {
            await sendReply(getActiveSender(), promptText);
          }
          return { action: "cancel" };
        }

        return {};
      }

      (async () => {
        try {
          await client.initialize();

          const threadMethod = sessionId ? "thread/resume" : "thread/start";
          const threadParams = buildThreadParams(sessionId);
          testSupport.appendAppServerLog({
            method: threadMethod,
            params: threadParams,
          });
          const threadResponse = await client.request(threadMethod, threadParams);

          parsedSessionId =
            normalizeText(threadResponse?.thread?.id) ||
            normalizeText(threadResponse?.threadId) ||
            parsedSessionId;

          const turnParams = {
            ...buildTurnParams(parsedSessionId, prompt, imagePaths),
          };
          testSupport.appendAppServerLog({
            method: "turn/start",
            params: turnParams,
          });
          const turnResponse = await client.request("turn/start", turnParams);

          turnId = normalizeText(turnResponse?.turn?.id) || turnId;
          resetTimeout();
        } catch (error) {
          if (sessionId && isInvalidSessionError(String(error?.message || error))) {
            if (typeof onInvalidSession === "function") {
              onInvalidSession();
            }
            client.close();
            try {
              const freshResult = await runCodexViaAppServer(
                prompt,
                null,
                imagePaths,
                null,
                suppressLiveUpdates,
                onInvalidSession,
                activeSender
              );
              resolve({
                ...freshResult,
                startedFreshBecauseResumeFailed: true,
              });
            } catch (freshError) {
              reject(freshError);
            }
            return;
          }

          fail(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }

  return {
    buildThreadParams,
    buildTurnParams,
    runCodexViaAppServer,
  };
}

module.exports = {
  buildAppServerThreadParams,
  buildAppServerTurnParams,
  createAppServerTurnRunner,
  getTurnFailureMessage,
};
