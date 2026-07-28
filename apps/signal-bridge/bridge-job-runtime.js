function createBridgeJobRuntime(options = {}) {
  const {
    appServerMessages,
    autoresearchMonitor,
    cleanupPaths,
    clearActiveJob,
    clearInFlightTurn,
    clearSessionState,
    createJobControl,
    getBridgeStatusReport,
    getOpsReport,
    getPendingPluginAuth,
    getSessionId,
    getTelegramTriageReport,
    getWhatsAppTriageReport,
    formatHelp,
    mergePromptSegments,
    normalizeText,
    pluginAuth,
    pluginRuntime = null,
    runCommands = null,
    runCodex,
    saveSessionId,
    schedulerRuntime,
    sendReply,
    setActiveJob,
    setInFlightTurn,
    signalAttachments,
    signalProfile,
    scheduledNoReplyMarker,
    timestamp,
    voiceNotes,
    voiceNotesEchoTranscript = true,
  } = options;

  function isBackgroundJob(job) {
    return job?.origin === "scheduled";
  }

  function getSessionStateKeyForJob(job) {
    return isBackgroundJob(job) ? "backgroundSessionId" : "interactiveSessionId";
  }

  function isAutoresearchTickJob(job) {
    const prompt = normalizeText(job?.command?.prompt);
    return prompt.includes("Run the bounded autoresearch tick for Sable.");
  }

  function shouldSuppressJobReplies(job) {
    return job?.replyMode === "silent";
  }

  async function sendJobReply(job, message) {
    if (shouldSuppressJobReplies(job)) {
      return;
    }
    await sendReply(job.sender, message);
  }

  async function sendJobProgressReply(job, message) {
    if (isBackgroundJob(job)) {
      return;
    }
    await sendJobReply(job, message);
  }

  async function processJob(job) {
    if (job.command.type === "help") {
      await sendJobReply(job, formatHelp ? formatHelp(pluginRuntime) : "Help is not available.");
      return;
    }

    if (job.command.type === "status") {
      await sendJobReply(job, await getBridgeStatusReport());
      return;
    }

    if (job.command.type === "ops") {
      await sendJobReply(job, await getOpsReport());
      return;
    }

    if (["list-runs", "list-run-blockers", "show-run", "control-run", "run-usage"].includes(job.command.type)) {
      const message = runCommands
        ? await runCommands.handle(job.command, { actor: "signal" })
        : "Run controls are not available in this Sable runtime yet.";
      await sendJobReply(job, message);
      return;
    }

    if (job.command.type === "plugin-status") {
      await sendJobReply(job, pluginRuntime?.formatStatus?.() || "Plugin runtime is not available.");
      return;
    }

    if (job.command.type === "plugin-command") {
      const handled = await pluginRuntime?.dispatch?.(job);
      if (!handled) {
        await sendJobReply(job, `No runtime plugin handled ${job.command.commandName || "that command"}.`);
      }
      return;
    }

    if (job.command.type === "list-schedules") {
      await sendJobReply(job, schedulerRuntime.listSchedules());
      return;
    }

    if (job.command.type === "unschedule") {
      const result = schedulerRuntime.removeScheduledJob(job.command.scheduleId);
      await sendReply(
        job.sender,
        result.removed
          ? `Removed scheduled workflow ${job.command.scheduleId}.`
          : result.protectedDefault
            ? `Default workflow ${job.command.scheduleId} is managed by Sable's default scheduler file. Disable or edit it there instead of using /unschedule.`
            : `No local scheduled workflow matched ${job.command.scheduleId || "that id"}.`
      );
      return;
    }

    if (job.command.type === "remove-avatar") {
      await signalProfile.updateAvatar({ remove: true });
      await sendJobReply(job, "Removed Sable's Signal profile picture.");
      return;
    }

    if (job.command.type === "auth-status") {
      await sendJobReply(job, pluginAuth.formatStatus(getPendingPluginAuth()));
      return;
    }

    if (job.command.type === "auth-cancel") {
      if (!getPendingPluginAuth()) {
        await sendJobReply(job, "No plugin auth flow is currently pending.");
        return;
      }

      pluginAuth.clear();
      await sendJobReply(job, "Cleared the pending plugin auth flow.");
      return;
    }

    if (job.command.type === "auth-resume") {
      const pendingPluginAuth = getPendingPluginAuth();
      if (!pendingPluginAuth) {
        await sendJobReply(job, "No plugin auth flow is ready to resume.");
        return;
      }

      if (pendingPluginAuth.status !== "completed") {
        await sendJobReply(job, pluginAuth.formatStatus(pendingPluginAuth));
        return;
      }

      if (!pendingPluginAuth.sourcePrompt) {
        pluginAuth.clear();
        await sendJobReply(job, "The plugin connected, but there is no saved prompt to retry. Ask again normally.");
        return;
      }

      const resumePrompt = pendingPluginAuth.sourcePrompt;
      pluginAuth.clear();
      job.command = { type: "prompt", prompt: resumePrompt };
    }

    if (job.command.type === "telegram-triage") {
      await sendJobReply(job, await getTelegramTriageReport(job.command.limit));
      return;
    }

    if (job.command.type === "whatsapp-triage") {
      await sendJobReply(job, await getWhatsAppTriageReport(job.command.limit));
      return;
    }

    if (job.command.type === "new" && !job.command.prompt) {
      clearSessionState("interactive");
      await sendJobReply(job, "Started a new Sable session. Your next message will use fresh context.");
      return;
    }

    const backgroundJob = isBackgroundJob(job);
    const sessionStateKey = getSessionStateKeyForJob(job);
    const sessionKind = backgroundJob ? "background" : "interactive";
    const shouldResume = Boolean(getSessionId(sessionStateKey)) && job.command.type !== "new";
    const imagePaths = await signalAttachments.materializeIncomingImages(job.context);
    const filePaths = await signalAttachments.materializeIncomingFiles(job.context);
    let audioPaths = [];
    let preparedVoiceNote = null;
    if (job.queuedVoicePreparation) {
      try {
        preparedVoiceNote = await job.queuedVoicePreparation;
        audioPaths = preparedVoiceNote.audioPaths;
      } catch (error) {
        console.error(
          `[${timestamp()}] Background voice-note preparation failed for ${job.sender}: ${error.message}`
        );
      }
    }

    if (audioPaths.length === 0) {
      audioPaths = await signalAttachments.materializeIncomingAudio(job.context);
    }
    const jobControl = createJobControl(job.sender);
    const autoresearchBefore =
      backgroundJob && isAutoresearchTickJob(job) ? autoresearchMonitor.snapshotRuns() : null;
    if (!backgroundJob) {
      setActiveJob(job.sender, jobControl);
    }

    try {
      let prompt = job.command.prompt;

      if (job.command.type === "set-avatar") {
        if (imagePaths.length === 0) {
          await sendJobReply(job, "Attach an image with `/setavatar` and I'll use the first image as Sable's profile picture.");
          return;
        }

        await signalProfile.updateAvatar({ avatarPath: imagePaths[0] });
        const suffix =
          imagePaths.length > 1 ? ` Used the first attached image and ignored ${imagePaths.length - 1} extra image${imagePaths.length === 2 ? "" : "s"}.` : "";
        await sendJobReply(job, `Updated Sable's Signal profile picture.${suffix}`);
        return;
      }

      if (audioPaths.length > 0) {
        if (!voiceNotes.isEnabled()) {
          await sendJobReply(job, "Voice note transcription is disabled.");
          return;
        }

        let transcription = preparedVoiceNote?.transcription || null;
        if (!transcription) {
          await sendJobProgressReply(job, "Transcribing voice note...");
          transcription = await voiceNotes.transcribe(audioPaths[0], jobControl);
        }

        if (!normalizeText(transcription?.transcript)) {
          await sendJobReply(job, "Voice note transcription returned no text.");
          return;
        }

        if (voiceNotesEchoTranscript) {
          await sendJobProgressReply(job, voiceNotes.formatTranscriptMessage(transcription));
        }

        prompt = transcription.transcript;
      }

      if (filePaths.length > 0) {
        await sendJobProgressReply(job, "Reading attached files...");
        const fileContext = await signalAttachments.buildFileAttachmentPromptContext(job.context, filePaths);
        if (!fileContext.ok) {
          await sendJobProgressReply(
            job,
            `${fileContext.message} I still exposed the local attachment path for this turn in case a tool can use the file directly.`
          );
        } else {
          prompt = mergePromptSegments(prompt, fileContext.promptText);
        }
      }

      const localAttachmentContext = signalAttachments.buildLocalAttachmentPathPromptContext(job.context, {
        imagePaths,
        audioPaths,
        filePaths,
      });
      prompt = mergePromptSegments(prompt, localAttachmentContext);

      if (!normalizeText(prompt)) {
        await sendJobReply(job, "There was no usable text prompt to send to Sable.");
        return;
      }

      if (!backgroundJob) {
        setInFlightTurn(job.sender, prompt);
      }
      const result = await runCodex(
        prompt,
        shouldResume ? getSessionId(sessionStateKey) : null,
        imagePaths,
        jobControl,
        backgroundJob || shouldSuppressJobReplies(job),
        () => clearSessionState(sessionKind),
        job.sender
      );

      if (result.sessionId) {
        saveSessionId(sessionStateKey, result.sessionId);
      }

      if (result.startedFreshBecauseResumeFailed) {
        await sendJobProgressReply(
          job,
          "Previous Sable session was unavailable, so I started a fresh session before answering."
        );
      }

      if (result.toolSuggestion) {
        const handled = await pluginAuth.maybeStart(job.sender, prompt, result.toolSuggestion);
        if (handled) {
          if (
            result.message &&
            appServerMessages.shouldForwardAgentMessageAlongsideToolSuggestion(result.message)
          ) {
            await sendJobReply(job, result.message);
          }
          return;
        }
      }

      if (
        job.allowSilentNoReply &&
        normalizeText(result.message) === scheduledNoReplyMarker
      ) {
        if (autoresearchBefore) {
          await autoresearchMonitor.sendCompletionNotices(autoresearchBefore, job.sender, sendReply);
        }
        return;
      }

      if (result.message) {
        await sendJobReply(job, result.message);
      } else if (!shouldSuppressJobReplies(job)) {
        await sendReply(job.sender, "Sable completed without a final message.");
      }

      if (autoresearchBefore) {
        await autoresearchMonitor.sendCompletionNotices(autoresearchBefore, job.sender, sendReply);
      }
    } finally {
      if (!backgroundJob) {
        clearInFlightTurn();
        clearActiveJob(jobControl);
      }
      await cleanupPaths(imagePaths);
      await cleanupPaths(audioPaths);
      await cleanupPaths(filePaths);
    }
  }

  return {
    isBackgroundJob,
    processJob,
    sendJobProgressReply,
    sendJobReply,
    shouldSuppressJobReplies,
  };
}

module.exports = {
  createBridgeJobRuntime,
};
