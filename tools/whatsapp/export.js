"use strict";

const fs = require("node:fs");
const path = require("node:path");

function exportApproved(store, approvedChats, outputPath, format = "json") {
  const chats = store.listChats().filter((chat) => approvedChats.some((approved) =>
    (approved.id && approved.id.toLowerCase() === chat.id.toLowerCase()) ||
    (approved.name && approved.name.toLowerCase() === chat.name.toLowerCase())
  ));
  const data = chats.map((chat) => ({ chat, messages: store.messagesForChat(chat.id) }));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, format === "json" ? `${JSON.stringify(data, null, 2)}\n` : markdown(data), "utf8");
  return { outputPath, chats: data.map((item) => ({ name: item.chat.name, messages: item.messages.length })) };
}

function markdown(data) {
  return `${data.map(({ chat, messages }) => [
    `# ${chat.name}`, "",
    ...messages.map((message) => {
      const attachment = message.attachment_type ? ` [${message.attachment_type}${message.filename ? `: ${message.filename}` : ""}]` : "";
      return `- ${message.timestamp || "(unknown time)"} ${message.sender || "(unknown sender)"}: ${message.text}${attachment}`;
    }), "",
  ].join("\n")).join("\n---\n")}\n`;
}

module.exports = { exportApproved, markdown };
