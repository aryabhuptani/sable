"use strict";

const BUILT_IN_COMMANDS = [
  ["/help", "Show available Sable slash commands."],
  ["/new", "Start a fresh interactive Sable session; with attachments, asks Sable to inspect them."],
  ["/cancel", "Cancel the current active turn for this sender."],
  ["/ops", "Show bridge, scheduler, research, queue, and runtime health."],
  ["/bridgestatus", "Show concise bridge status."],
  ["/plugins", "Show discovered official/local plugins and runtime plugin commands."],
  ["/schedules", "List recurring Sable workflows."],
  ["/unschedule <id>", "Remove a recurring workflow by id."],
  ["/telegram [limit]", "Review Telegram inbound queue when Telegram is configured."],
  ["/whatsapp [limit]", "Review approved WhatsApp chats when WhatsApp is configured."],
  ["/setavatar", "Use the first attached image as Sable's Signal profile picture."],
  ["/removeavatar", "Remove Sable's Signal profile picture."],
  ["/authstatus", "Show pending plugin connector auth state."],
  ["/authresume", "Resume the saved prompt after connector auth completes."],
  ["/authcancel", "Clear a pending connector auth flow."],
];

function parseCommand(
  text,
  {
    hasImages = false,
    hasAudio = false,
    hasFiles = false,
    pluginRuntime = null,
    telegramTriageLimit = 25,
    whatsappTriageLimit = 25,
  } = {}
) {
  const trimmed = normalizeText(text).trim();
  if (trimmed === "/help") {
    return { type: "help" };
  }

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

  if (trimmed === "/whatsapp") {
    return { type: "whatsapp-triage", limit: whatsappTriageLimit };
  }

  if (trimmed.startsWith("/whatsapp ")) {
    const rawLimit = trimmed.slice("/whatsapp ".length).trim();
    const parsedLimit = Number.parseInt(rawLimit, 10);
    return {
      type: "whatsapp-triage",
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : whatsappTriageLimit,
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

function formatHelp(pluginRuntime = null) {
  const lines = ["Sable commands:", ""];
  for (const [command, description] of BUILT_IN_COMMANDS) {
    lines.push(`- ${command} - ${description}`);
  }
  const pluginCommands = pluginRuntime?.commands
    ? [...pluginRuntime.commands.values()].sort((a, b) => a.commandName.localeCompare(b.commandName))
    : [];
  if (pluginCommands.length > 0) {
    lines.push("", "Plugin commands:");
    for (const command of pluginCommands) {
      const suffix = command.description ? ` - ${command.description}` : "";
      lines.push(`- ${command.commandName} (${command.pluginId})${suffix}`);
    }
  }
  return lines.join("\n");
}

function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

module.exports = {
  BUILT_IN_COMMANDS,
  formatHelp,
  parseCommand,
};
