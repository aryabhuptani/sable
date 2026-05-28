function createBridgeQueueRuntime({
  cancelJobControl,
  cleanupPaths,
  defaultFilePrompt,
  defaultImagePrompt,
  getBridgeStatusReport,
  getJobRuntime,
  getRestartRequested,
  getShutdownRequested,
  isCancellationError,
  logIncoming,
  logger = console,
  onQueueDrained = async () => {},
  parseCommand,
  pluginRuntime = null,
  schedulerRuntime,
  sendReply,
  signalAttachments,
  signalInbound,
  telegramTriageLimit,
  whatsappTriageLimit,
  timestamp,
  voiceNotes,
}) {
  const interactiveQueue = [];
  const backgroundQueue = [];
  let isProcessingInteractive = false;
  let isProcessingBackground = false;
  let activeJobControl = null;
  let activeSender = null;

  async function handleReceiveEvent(message) {
    const envelope = message.params?.envelope;
    const senderCandidates = signalInbound.extractSenderCandidates(envelope);
    const sender = senderCandidates[0] || null;
    const text = signalInbound.extractIncomingText(envelope);
    const imageAttachments = signalAttachments.extractIncomingImageAttachments(envelope);
    const audioAttachments = signalAttachments.extractIncomingAudioAttachments(envelope);
    const fileAttachments = signalAttachments.extractIncomingFileAttachments(envelope);

    if (
      !sender ||
      (!text &&
        imageAttachments.length === 0 &&
        audioAttachments.length === 0 &&
        fileAttachments.length === 0)
    ) {
      return;
    }

    if (!signalInbound.isAllowedSender(senderCandidates)) {
      logger.log?.(
        `[${timestamp()}] Ignored message from disallowed sender ${senderCandidates.join(", ")}`
      );
      return;
    }

    const fallbackPreview = audioAttachments.length > 0
      ? "Voice note"
      : imageAttachments.length > 0
        ? defaultImagePrompt
        : defaultFilePrompt;
    logIncoming(
      sender,
      text || fallbackPreview,
      imageAttachments.length + audioAttachments.length + fileAttachments.length
    );

    const command = parseCommand(
      text ||
        (imageAttachments.length > 0
          ? defaultImagePrompt
          : fileAttachments.length > 0
            ? defaultFilePrompt
            : ""),
      {
        hasImages: imageAttachments.length > 0,
        hasAudio: audioAttachments.length > 0,
        hasFiles: fileAttachments.length > 0,
        pluginRuntime,
        telegramTriageLimit,
        whatsappTriageLimit,
      }
    );

    if (command.type === "cancel") {
      await handleCancelCommand(sender);
      return;
    }

    if (getShutdownRequested() || getRestartRequested()) {
      if (command.type === "status") {
        await sendReply(sender, await getBridgeStatusReport());
        return;
      }

      await sendReply(
        sender,
        "Restart in progress. I'm finishing the current task before reconnecting, so please resend after Sable is back."
      );
      return;
    }

    const job = {
      sender,
      command,
      context: signalAttachments.buildAttachmentContext(
        envelope,
        sender,
        imageAttachments,
        audioAttachments,
        fileAttachments
      ),
      queuedVoicePreparation: null,
    };

    if (audioAttachments.length > 0 && voiceNotes.isEnabled() && isProcessingInteractive) {
      job.queuedVoicePreparation = voiceNotes.startQueuedPreparation(job, {
        cleanupPaths,
        materializeIncomingAudio: (context) => signalAttachments.materializeIncomingAudio(context),
      });
    }

    interactiveQueue.push(job);

    if (isProcessingInteractive) {
      try {
        const queueMessage =
          audioAttachments.length > 0 && voiceNotes.isEnabled()
            ? "Queued, will process after current task. Transcribing the voice note in the background."
            : "Queued, will process after current task.";
        await sendReply(sender, queueMessage);
      } catch (error) {
        logger.error?.(`[${timestamp()}] Failed sending queue acknowledgment: ${error.message}`);
      }
      return;
    }

    void processInteractiveQueue();
  }

  async function handleTransportEnvelope(envelope) {
    const transport = String(envelope?.transport || "").trim();
    const conversationId = String(envelope?.conversationId || "").trim();
    const sender = String(envelope?.sender || "").trim();
    const text = String(envelope?.text || "").trim();
    const replyTarget = String(envelope?.replyTarget || "").trim() || `${transport}:${conversationId}`;

    if (!transport || !conversationId || !sender || !text) {
      return;
    }

    logIncoming(replyTarget, text, 0);

    const command = parseCommand(text, {
      hasImages: false,
      hasAudio: false,
      hasFiles: false,
      pluginRuntime,
      telegramTriageLimit,
      whatsappTriageLimit,
    });

    if (command.type === "cancel") {
      await handleCancelCommand(replyTarget);
      return;
    }

    if (command.type === "prompt" || (command.type === "new" && command.prompt)) {
      command.prompt = [
        `Incoming ${transport} message.`,
        `Conversation id: ${conversationId}`,
        `Sender: ${sender}`,
        "",
        command.prompt || text,
      ].join("\n");
    }

    if (getShutdownRequested() || getRestartRequested()) {
      if (command.type === "status") {
        await sendReply(replyTarget, await getBridgeStatusReport());
        return;
      }

      await sendReply(
        replyTarget,
        "Restart in progress. I'm finishing the current task before reconnecting, so please resend after Sable is back."
      );
      return;
    }

    interactiveQueue.push({
      sender: replyTarget,
      command,
      context: signalAttachments.buildAttachmentContext({}, replyTarget, [], [], []),
      queuedVoicePreparation: null,
      sourceEnvelope: envelope,
    });

    if (isProcessingInteractive) {
      try {
        await sendReply(replyTarget, "Queued, will process after current task.");
      } catch (error) {
        logger.error?.(`[${timestamp()}] Failed sending queue acknowledgment: ${error.message}`);
      }
      return;
    }

    void processInteractiveQueue();
  }

  async function handleCancelCommand(sender) {
    if (!isProcessingInteractive || !activeJobControl) {
      await sendReply(sender, "No active task to cancel.");
      return;
    }

    const cancelled = cancelJobControl(activeJobControl, undefined, {
      logger,
      timestamp,
    });
    if (!cancelled) {
      await sendReply(sender, "The active task is already stopping.");
      return;
    }

    const pendingCount = interactiveQueue.length;
    const suffix =
      pendingCount > 0
        ? ` ${pendingCount} queued message${pendingCount === 1 ? "" : "s"} will stay queued.`
        : "";
    await sendReply(sender, `Cancelling current task.${suffix}`);
  }

  async function processInteractiveQueue() {
    if (isProcessingInteractive) {
      return;
    }

    isProcessingInteractive = true;

    while (interactiveQueue.length > 0) {
      const job = interactiveQueue.shift();

      try {
        await getJobRuntime().processJob(job);
      } catch (error) {
        if (isCancellationError(error)) {
          logger.log?.(`[${timestamp()}] Cancelled task for ${job.sender}: ${error.message}`);
          continue;
        }

        logger.error?.(
          `[${timestamp()}] Failed processing message from ${job.sender}: ${error.stack || error.message}`
        );
        await getJobRuntime().sendJobReply(job, "Request failed before Sable could complete.");
      }
    }

    isProcessingInteractive = false;
    await onQueueDrained();
  }

  async function processBackgroundQueue() {
    if (isProcessingBackground) {
      return;
    }

    isProcessingBackground = true;

    while (backgroundQueue.length > 0) {
      const job = backgroundQueue.shift();

      try {
        await getJobRuntime().processJob(job);
      } catch (error) {
        if (isCancellationError(error)) {
          logger.log?.(`[${timestamp()}] Cancelled background task for ${job.sender}: ${error.message}`);
          continue;
        }

        logger.error?.(
          `[${timestamp()}] Failed processing background message from ${job.sender}: ${error.stack || error.message}`
        );
        await getJobRuntime().sendJobReply(job, "Background workflow failed before Sable could complete.");
      }
    }

    isProcessingBackground = false;
    await onQueueDrained();
  }

  async function checkForDueScheduledJobs() {
    await schedulerRuntime.checkForDueScheduledJobs({
      enqueueBackgroundJob: (job) => backgroundQueue.push(job),
      ensureBackgroundProcessing: () => {
        if (!isProcessingBackground) {
          void processBackgroundQueue();
        }
      },
      isPaused: () => getShutdownRequested() || getRestartRequested(),
    });
  }

  function clearActiveJob(jobControl) {
    activeSender = null;
    if (activeJobControl === jobControl) {
      activeJobControl = null;
    }
  }

  function getLiveState({ attachmentQueueProcessing = false, inFlightTurn = null } = {}) {
    return {
      interactiveQueueDepth: interactiveQueue.length,
      interactiveProcessing: isProcessingInteractive,
      backgroundQueueDepth: backgroundQueue.length,
      backgroundProcessing: isProcessingBackground,
      attachmentQueueProcessing,
      inFlightTurn,
    };
  }

  function hasActiveWork() {
    return (
      isProcessingInteractive ||
      isProcessingBackground ||
      interactiveQueue.length > 0 ||
      backgroundQueue.length > 0
    );
  }

  function setActiveJob(sender, jobControl) {
    activeSender = sender;
    activeJobControl = jobControl;
  }

  return {
    backgroundQueue,
    checkForDueScheduledJobs,
    clearActiveJob,
    getActiveSender: () => activeSender,
    getLiveState,
    handleCancelCommand,
    handleReceiveEvent,
    handleTransportEnvelope,
    hasActiveWork,
    interactiveQueue,
    isInteractiveProcessing: () => isProcessingInteractive,
    processBackgroundQueue,
    processInteractiveQueue,
    setActiveJob,
  };
}

module.exports = {
  createBridgeQueueRuntime,
};
