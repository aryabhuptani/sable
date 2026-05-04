"use strict";

const fs = require("node:fs");

function createVoiceNotePlugin({
  beamSize = 5,
  computeType = "int8",
  enabled = true,
  language = "en",
  model = "base.en",
  modelPath = "",
  projectDir,
  pythonBin = "python3",
  registerCancellationHandler = () => () => {},
  scriptPath,
  spawn,
  timeoutSec = 900,
} = {}) {
  if (typeof spawn !== "function") {
    throw new Error("createVoiceNotePlugin requires spawn.");
  }
  if (!scriptPath) {
    throw new Error("createVoiceNotePlugin requires scriptPath.");
  }
  if (!projectDir) {
    throw new Error("createVoiceNotePlugin requires projectDir.");
  }

  function isEnabled() {
    return Boolean(enabled);
  }

  function transcribe(audioPath, jobControl = null) {
    return new Promise((resolve, reject) => {
      const modelArg =
        modelPath && fs.existsSync(modelPath)
          ? modelPath
          : model;
      const child = spawn(
        pythonBin,
        [
          scriptPath,
          "--input",
          audioPath,
          "--model",
          modelArg,
          "--language",
          language,
          "--beam-size",
          String(beamSize),
          "--compute-type",
          computeType,
          "--local-only",
        ],
        {
          cwd: projectDir,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      let stdout = "";
      let stderr = "";
      let didFinish = false;
      let timeout = null;

      const unregisterCancellation = registerCancellationHandler(jobControl, (error) => {
        if (didFinish) {
          return;
        }
        didFinish = true;
        clearTimeout(timeout);
        child.kill("SIGTERM");
        reject(error);
      });

      function cleanup() {
        clearTimeout(timeout);
        unregisterCancellation();
      }

      timeout = setTimeout(() => {
        if (didFinish) {
          return;
        }
        didFinish = true;
        child.kill("SIGTERM");
        cleanup();
        reject(new Error("Voice transcription timed out."));
      }, timeoutSec * 1000);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        if (didFinish) {
          return;
        }
        didFinish = true;
        cleanup();
        reject(new Error(`Voice transcription failed: ${error.message}`));
      });

      child.on("exit", (code, signal) => {
        if (didFinish) {
          cleanup();
          return;
        }

        didFinish = true;
        cleanup();

        if (signal === "SIGTERM" && jobControl?.cancelled) {
          reject(jobControl.reason || new Error("Voice transcription cancelled."));
          return;
        }

        if (code !== 0) {
          reject(
            new Error(
              `Voice transcription failed: ${
                normalizeText(stderr) || `process exited with code ${code}`
              }`
            )
          );
          return;
        }

        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch (parseError) {
          reject(new Error("Voice transcription returned invalid JSON."));
          return;
        }

        if (!parsed?.ok) {
          reject(new Error(normalizeText(parsed?.error) || "Voice transcription failed."));
          return;
        }

        resolve(parsed);
      });
    });
  }

  function startQueuedPreparation(job, { cleanupPaths, materializeIncomingAudio }) {
    return (async () => {
      const audioPaths = await materializeIncomingAudio(job.context);
      try {
        const transcription = await transcribe(audioPaths[0], null);
        return { audioPaths, transcription };
      } catch (error) {
        await cleanupPaths(audioPaths);
        throw error;
      }
    })();
  }

  function formatTranscriptMessage(transcription) {
    return normalizeText(transcription?.transcript);
  }

  return {
    formatTranscriptMessage,
    isEnabled,
    startQueuedPreparation,
    transcribe,
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  createVoiceNotePlugin,
};
