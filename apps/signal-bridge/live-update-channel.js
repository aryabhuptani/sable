function createLiveUpdateChannel(options = {}) {
  const {
    recipient,
    sendReply,
    normalizeText = defaultNormalizeText,
    batchWindowMs = 750,
    duplicateWindowMs = 5_000,
    logger = console,
    timestamp = () => new Date().toISOString(),
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimerFn = clearTimeout,
  } = options;
  let queue = [];
  let timer = null;
  let lastSentAt = 0;
  let lastSentText = "";

  async function flush() {
    if (!recipient || queue.length === 0) {
      queue = [];
      clearTimer();
      return;
    }

    const text = queue.join("\n");
    queue = [];
    clearTimer();

    if (shouldSuppressDuplicate(text)) {
      return;
    }

    await sendReply(recipient, text);
    markSent(text);
  }

  function queueMessage(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return;
    }

    if (queue.length > 0 && queue[queue.length - 1] === normalized) {
      return;
    }

    queue.push(normalized);

    if (!timer) {
      timer = setTimer(() => {
        void flush().catch((error) => {
          logger.error?.(`[${timestamp()}] Failed sending live update: ${error.message}`);
        });
      }, batchWindowMs);
    }
  }

  function clearTimer() {
    if (timer) {
      clearTimerFn(timer);
      timer = null;
    }
  }

  function shouldSuppressDuplicate(text) {
    return text === lastSentText && now() - lastSentAt < duplicateWindowMs;
  }

  function markSent(text) {
    lastSentText = text;
    lastSentAt = now();
  }

  function stop() {
    clearTimer();
  }

  return {
    queue: queueMessage,
    flush,
    markSent,
    stop,
  };
}

function defaultNormalizeText(text) {
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

module.exports = {
  createLiveUpdateChannel,
};
