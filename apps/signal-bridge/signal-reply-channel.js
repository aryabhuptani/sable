function createSignalReplyChannel(options = {}) {
  const {
    allowedNumbers = new Set(),
    chunkDelayMs = 500,
    delay,
    logger = console,
    maxMessageLength = 1500,
    noteIncoming = () => {},
    noteOutgoing = () => {},
    rewriteText = (text) => text,
    sendSignalRequest,
    splitIntoChunks,
    timestamp = () => new Date().toISOString(),
  } = options;

  async function sendReply(recipient, text) {
    const formattedText = rewriteText(text);
    const chunks = splitIntoChunks(formattedText, maxMessageLength);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      await sendSignalMessage(recipient, chunk);
      logOutgoing(recipient, chunk, index + 1, chunks.length);

      if (index < chunks.length - 1) {
        await delay(chunkDelayMs);
      }
    }
  }

  async function broadcastAllowedMessage(text) {
    const recipients = [...allowedNumbers];

    for (const recipient of recipients) {
      await sendSignalMessage(recipient, text);
      logOutgoing(recipient, text, 1, 1);
    }
  }

  function sendSignalMessage(recipient, message) {
    return sendSignalRequest("send", {
      recipient: [recipient],
      message,
    });
  }

  function logIncoming(sender, message, imageCount = 0) {
    noteIncoming(sender);
    const imageLabel = imageCount > 0 ? ` [images=${imageCount}]` : "";
    logger.log?.(`[${timestamp()}] IN  ${sender}${imageLabel}: ${message}`);
  }

  function logOutgoing(recipient, message, chunkNumber, totalChunks) {
    noteOutgoing(recipient);
    const label = totalChunks > 1 ? ` (${chunkNumber}/${totalChunks})` : "";
    logger.log?.(
      `[${timestamp()}] OUT ${recipient}${label}: ${String(message)
        .slice(0, 120)
        .replace(/\n/g, "\\n")}`
    );
  }

  return {
    broadcastAllowedMessage,
    logIncoming,
    logOutgoing,
    sendReply,
    sendSignalMessage,
  };
}

module.exports = {
  createSignalReplyChannel,
};
