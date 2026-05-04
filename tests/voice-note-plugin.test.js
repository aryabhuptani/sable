const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { createVoiceNotePlugin } = require("../apps/signal-bridge/voice-note-plugin");

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
  };
  return child;
}

test("voice note plugin spawns the local transcription command and parses JSON output", async () => {
  const calls = [];
  const child = createFakeChild();
  const plugin = createVoiceNotePlugin({
    beamSize: 3,
    computeType: "int8",
    language: "en",
    model: "base.en",
    projectDir: "/repo/apps/signal-bridge",
    pythonBin: "python3",
    scriptPath: "/repo/apps/signal-bridge/transcribe_voice_note.py",
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
    timeoutSec: 30,
  });

  const transcriptionPromise = plugin.transcribe("/tmp/audio.aac");
  child.stdout.emit("data", JSON.stringify({ ok: true, transcript: " hello " }));
  child.emit("exit", 0, null);
  const transcription = await transcriptionPromise;

  assert.deepEqual(transcription, { ok: true, transcript: " hello " });
  assert.deepEqual(calls, [
    {
      command: "python3",
      args: [
        "/repo/apps/signal-bridge/transcribe_voice_note.py",
        "--input",
        "/tmp/audio.aac",
        "--model",
        "base.en",
        "--language",
        "en",
        "--beam-size",
        "3",
        "--compute-type",
        "int8",
        "--local-only",
      ],
      options: {
        cwd: "/repo/apps/signal-bridge",
        stdio: ["ignore", "pipe", "pipe"],
      },
    },
  ]);
  assert.equal(plugin.formatTranscriptMessage(transcription), "hello");
});

test("voice note plugin surfaces transcription process failures", async () => {
  const child = createFakeChild();
  const plugin = createVoiceNotePlugin({
    projectDir: "/repo",
    scriptPath: "/repo/transcribe.py",
    spawn: () => child,
  });

  const transcriptionPromise = plugin.transcribe("/tmp/audio.aac");
  child.stderr.emit("data", "model missing");
  child.emit("exit", 2, null);

  await assert.rejects(transcriptionPromise, /model missing/);
});

test("voice note plugin cleans queued audio paths when background transcription fails", async () => {
  const child = createFakeChild();
  const cleaned = [];
  const plugin = createVoiceNotePlugin({
    projectDir: "/repo",
    scriptPath: "/repo/transcribe.py",
    spawn: () => child,
  });

  const preparationPromise = plugin.startQueuedPreparation(
    { context: { id: "job" } },
    {
      cleanupPaths: async (paths) => cleaned.push(paths),
      materializeIncomingAudio: async () => ["/tmp/audio.aac"],
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  child.stderr.emit("data", "nope");
  child.emit("exit", 1, null);

  await assert.rejects(preparationPromise, /nope/);
  assert.deepEqual(cleaned, [["/tmp/audio.aac"]]);
});

test("voice note plugin cancels the transcription subprocess through job control", async () => {
  const child = createFakeChild();
  let cancellationHandler = null;
  const plugin = createVoiceNotePlugin({
    projectDir: "/repo",
    registerCancellationHandler: (_jobControl, handler) => {
      cancellationHandler = handler;
      return () => {};
    },
    scriptPath: "/repo/transcribe.py",
    spawn: () => child,
  });
  const cancellation = new Error("cancelled");

  const transcriptionPromise = plugin.transcribe("/tmp/audio.aac", {});
  cancellationHandler(cancellation);

  await assert.rejects(transcriptionPromise, /cancelled/);
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
});
