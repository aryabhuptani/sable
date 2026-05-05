"use strict";

function parseCommand(
  text,
  {
    hasImages = false,
    hasAudio = false,
    hasFiles = false,
    pluginRuntime = null,
    telegramTriageLimit = 25,
  } = {}
) {
  const trimmed = normalizeText(text).trim();
  if (trimmed === "/plugins" || trimmed === "/pluginstatus") {
    return { type: "plugin-status" };
  }

  if (trimmed === "/bridgestatus") {
    return { type: "status" };
  }

  if (trimmed === "/ops") {
    return { type: "ops" };
  }

  if (trimmed === "/schedules") {
    return { type: "list-schedules" };
  }

  if (trimmed.startsWith("/unschedule ")) {
    return { type: "unschedule", scheduleId: trimmed.slice("/unschedule ".length).trim() };
  }

  if (trimmed === "/cancel") {
    return { type: "cancel" };
  }

  if (trimmed === "/setavatar") {
    return { type: "set-avatar" };
  }

  if (trimmed === "/removeavatar") {
    return { type: "remove-avatar" };
  }

  if (trimmed === "/authstatus") {
    return { type: "auth-status" };
  }

  if (trimmed === "/authcancel") {
    return { type: "auth-cancel" };
  }

  if (trimmed === "/authresume") {
    return { type: "auth-resume" };
  }

  if (trimmed === "/telegram") {
    return { type: "telegram-triage", limit: telegramTriageLimit };
  }

  if (trimmed.startsWith("/telegram ")) {
    const rawLimit = trimmed.slice("/telegram ".length).trim();
    const parsedLimit = Number.parseInt(rawLimit, 10);
    return {
      type: "telegram-triage",
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : telegramTriageLimit,
    };
  }

  const pluginCommand = pluginRuntime?.parsePluginCommand?.(trimmed);
  if (pluginCommand) {
    return pluginCommand;
  }

  if (trimmed !== "/new" && !trimmed.startsWith("/new ")) {
    return { type: "prompt", prompt: trimmed };
  }

  if (hasAudio) {
    return { type: "prompt", prompt: null };
  }

  const remainder = trimmed.slice(4).trim();
  return {
    type: "new",
    prompt:
      remainder ||
      (hasImages
        ? "Please analyze the attached image."
        : hasFiles
          ? "Please analyze the attached files."
          : null),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

module.exports = {
  parseCommand,
};
