function createAppServerMessageHelpers(options = {}) {
  const {
    formatProgressMessage = (text) => `• ${defaultNormalizeText(text)}`,
    logger = console,
    maxCommandTextLength = 120,
    maxFailureOutputLength = 400,
    normalizeText = defaultNormalizeText,
    timestamp = () => new Date().toISOString(),
    truncateText = defaultTruncateText,
  } = options;

  function captureToolSuggestionFromNotification(message, callsById) {
    const item = message?.params?.item;
    if (!item || typeof item !== "object") {
      return null;
    }

    if (item.type === "function_call" && item.name === "tool_suggest") {
      callsById.set(item.call_id, {
        arguments: safeJsonParse(item.arguments),
        output: null,
      });
      return null;
    }

    if (item.type !== "function_call_output" || !item.call_id) {
      return null;
    }

    const existing = callsById.get(item.call_id) || {
      arguments: null,
      output: null,
    };
    existing.output = safeJsonParse(item.output);
    callsById.set(item.call_id, existing);

    return normalizeToolSuggestion(existing.arguments, existing.output);
  }

  function handleCodexAppServerItem(item, stateSnapshot) {
    let { pendingAgentMessage, finalMessage, liveUpdates, subagentState } = stateSnapshot;

    if (!item || typeof item !== "object") {
      return { pendingAgentMessage, finalMessage };
    }

    if (item.type === "agentMessage") {
      if (subagentState?.activeCount) {
        pendingAgentMessage = null;
        return { pendingAgentMessage, finalMessage };
      }

      const text = normalizeText(item.text);
      if (text) {
        if (pendingAgentMessage) {
          liveUpdates.queue(formatProgressMessage(pendingAgentMessage));
        }
        pendingAgentMessage = text;
        finalMessage = text;
      }
      return { pendingAgentMessage, finalMessage };
    }

    if (item.type === "commandExecution") {
      if (pendingAgentMessage && !subagentState?.activeCount) {
        liveUpdates.queue(formatProgressMessage(pendingAgentMessage));
        pendingAgentMessage = null;
      } else if (subagentState?.activeCount) {
        pendingAgentMessage = null;
      }

      if (item.status !== "completed" || item.exitCode !== 0) {
        const command = truncateText(item.command || "", maxCommandTextLength) || "(empty command)";
        const snippet = normalizeText(item.aggregatedOutput).slice(0, maxFailureOutputLength);
        logger.error?.(
          `[${timestamp()}] Suppressed command failure relay: exitCode=${
            item.exitCode ?? "unknown"
          } command=${JSON.stringify(command)} output=${JSON.stringify(snippet)}`
        );
      }

      return { pendingAgentMessage, finalMessage };
    }

    if (item.type === "mcpToolCall" && item.status === "failed") {
      const errorText = normalizeText(item.error?.message);
      if (errorText) {
        liveUpdates.queue(formatProgressMessage(errorText));
      }
    }

    return { pendingAgentMessage, finalMessage };
  }

  function createSubagentProgressState() {
    return {
      activeToolCalls: new Set(),
      activeCount: 0,
      announcedInTurn: false,
    };
  }

  function handleSubagentToolCallNotification(message, subagentState, liveUpdates) {
    if (!subagentState || !liveUpdates) {
      return;
    }

    const item = message?.params?.item;
    if (!item || item.type !== "mcpToolCall") {
      return;
    }

    const toolName = extractMcpToolCallName(item);
    if (!isSubagentToolName(toolName)) {
      return;
    }

    const toolCallKey = extractMcpToolCallKey(item, toolName);
    if (!toolCallKey) {
      return;
    }

    if (message.method === "item/started") {
      const wasIdle = subagentState.activeCount === 0;
      if (!subagentState.activeToolCalls.has(toolCallKey)) {
        subagentState.activeToolCalls.add(toolCallKey);
        subagentState.activeCount = subagentState.activeToolCalls.size;
      }

      if (wasIdle && !subagentState.announcedInTurn) {
        liveUpdates.queue("• Kicking off a subagent for a bounded task...");
        subagentState.announcedInTurn = true;
      }
      return;
    }

    if (message.method === "item/completed") {
      subagentState.activeToolCalls.delete(toolCallKey);
      subagentState.activeCount = subagentState.activeToolCalls.size;
    }
  }

  function extractMcpToolCallName(item) {
    return normalizeText(
      item.toolName ||
        item.name ||
        item.tool?.name ||
        item.call?.toolName ||
        item.call?.name ||
        item.metadata?.toolName
    ).toLowerCase();
  }

  function extractMcpToolCallKey(item, toolName) {
    return normalizeText(
      item.id ||
        item.callId ||
        item.toolCallId ||
        item.invocationId ||
        item.call?.id ||
        item.call?.callId ||
        toolName
    );
  }

  function isSubagentToolName(toolName) {
    return (
      toolName === "spawn_agent" ||
      toolName === "wait_agent" ||
      toolName === "send_input" ||
      toolName === "resume_agent" ||
      toolName === "close_agent"
    );
  }

  function formatToolUserInputRequest(params) {
    const questions = Array.isArray(params?.questions) ? params.questions : [];
    if (questions.length === 0) {
      return "Sable requested user input for a tool, but the bridge cannot answer it yet.";
    }

    const lines = ["Sable requested tool input that this bridge cannot answer yet:"];
    for (const question of questions.slice(0, 3)) {
      const prompt = normalizeText(question?.question);
      const header = normalizeText(question?.header);
      if (header && prompt) {
        lines.push(`${header}: ${prompt}`);
      } else if (prompt) {
        lines.push(prompt);
      }
    }
    return lines.join("\n");
  }

  function formatMcpElicitationRequest(params) {
    const message = normalizeText(params?.message);
    const url = normalizeText(params?.url);
    if (!message && !url) {
      return "Sable requested MCP input that this bridge cannot answer yet.";
    }

    return [message, url].filter(Boolean).join("\n");
  }

  function buildAutoAcceptedMcpElicitationResponse(params) {
    const promptText = normalizeText(params?.message);
    const schema = params?.requestedSchema;

    const optimisticContent = buildAutoAcceptedMcpElicitationContent(schema);
    if (promptText && /^allow\b.+\?$/i.test(promptText) && optimisticContent) {
      return {
        action: "accept",
        content: optimisticContent,
      };
    }

    if (normalizeText(params?.mode) !== "form" || !optimisticContent) {
      return null;
    }

    return {
      action: "accept",
      content: optimisticContent,
    };
  }

  function shouldForwardAgentMessageAlongsideToolSuggestion(message) {
    const normalized = normalizeText(message).toLowerCase();
    if (!normalized) {
      return false;
    }

    return !normalized.includes("install `");
  }

  return {
    buildAutoAcceptedMcpElicitationResponse,
    captureToolSuggestionFromNotification,
    createSubagentProgressState,
    formatMcpElicitationRequest,
    formatToolUserInputRequest,
    handleCodexAppServerItem,
    handleSubagentToolCallNotification,
    shouldForwardAgentMessageAlongsideToolSuggestion,
  };
}

function buildAutoAcceptedMcpElicitationContent(schema) {
  if (!schema) {
    return {};
  }

  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    return null;
  }

  const content = {};

  for (const [key, definition] of Object.entries(schema.properties)) {
    const value = buildAutoAcceptedMcpElicitationValue(definition);
    if (typeof value === "undefined") {
      return null;
    }
    content[key] = value;
  }

  return content;
}

function buildAutoAcceptedMcpElicitationValue(definition) {
  if (!definition || typeof definition !== "object") {
    return undefined;
  }

  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return definition.enum[0];
  }

  if (definition.type === "boolean") {
    return true;
  }

  if (definition.type === "string") {
    return typeof definition.default === "string" ? definition.default : "";
  }

  if (definition.type === "number" || definition.type === "integer") {
    return Number.isFinite(definition.default) ? definition.default : 0;
  }

  return undefined;
}

function normalizeToolSuggestion(args, output) {
  const toolId = defaultNormalizeText(output?.tool_id) || defaultNormalizeText(args?.tool_id);
  const toolType = defaultNormalizeText(output?.tool_type) || defaultNormalizeText(args?.tool_type);

  if (!toolId || !toolType) {
    return null;
  }

  return {
    actionType:
      defaultNormalizeText(output?.action_type) || defaultNormalizeText(args?.action_type),
    suggestReason:
      defaultNormalizeText(output?.suggest_reason) || defaultNormalizeText(args?.suggest_reason),
    toolId,
    toolName: defaultNormalizeText(output?.tool_name) || defaultNormalizeText(toolId.split("@")[0]),
    toolType,
    completed: Boolean(output?.completed),
    userConfirmed: Boolean(output?.user_confirmed),
  };
}

function safeJsonParse(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function defaultNormalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

function defaultTruncateText(text, maxLength) {
  const normalized = defaultNormalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

module.exports = {
  buildAutoAcceptedMcpElicitationContent,
  buildAutoAcceptedMcpElicitationValue,
  createAppServerMessageHelpers,
  safeJsonParse,
};
