# Sable Signal Bridge

Node.js service that listens for Signal messages through `signal-cli` JSON-RPC over stdio, forwards them to the Codex CLI, and sends the reply back over Signal.

Canonical project root for Arya's current instance: `/home/arya/projects/sable/`

Legacy compatibility path: `/home/arya/signal-codex-bridge` (symlink)

## Requirements

- Node.js 22+
- `codex` on your `PATH`
- `signal-cli` on your `PATH`
- A Signal phone number you will register manually later

## Install `signal-cli`

1. Download the latest release from `https://github.com/AsamK/signal-cli/releases`.
2. Extract it.
3. Add the `signal-cli` binary to your `PATH`.

## Register the Signal Number

When you have the number:

1. Register the agent's phone number:
   `signal-cli -a +1AGENTNUMBER register`
2. Complete verification with the SMS code:
   `signal-cli -a +1AGENTNUMBER verify <CODE>`
3. Test sending:
   `signal-cli -a +1AGENTNUMBER send -m "hello" +1YOURNUMBER`

## Setup

1. Install dependencies:
   `npm install`
2. Install local speech-to-text dependencies:
   `python3 -m pip install -r requirements-stt.txt`
3. Install local PDF extraction dependencies:
   `python3 -m venv .venv-pdf && .venv-pdf/bin/pip install -r requirements-pdf.txt`
4. Edit `.env`:
   - `PHONE_NUMBER`: the registered Signal number
   - `ALLOWED_NUMBERS`: comma-separated list of phone numbers allowed to interact with the bridge
   - optional instance roots:
     - `SABLE_INSTANCE_HOME=/home/arya`
     - `SABLE_REPO_ROOT=/home/arya/projects/sable`
     - `SABLE_MEMORY_ROOT=/home/arya/memory`
     - `SABLE_TASKS_ROOT=/home/arya/memory/tasks`
     - `SABLE_KNOWLEDGE_ROOT=/home/arya/memory/knowledge`
     - `SABLE_SIGNAL_BRIDGE_DIR=/home/arya/projects/sable/apps/signal-bridge`
   - optional runtime path overrides:
     - `SABLE_CODEX_CWD=/home/arya`
     - `SABLE_SCHEDULER_JOBS_PATH=/home/arya/memory/tasks/projects/sable/scheduler-jobs.json`
     - `SABLE_RESEARCH_ROOT=/home/arya/memory/knowledge/research`
     - `SABLE_TELEGRAM_CLI_PATH=/home/arya/projects/sable/tools/telegram/telegram_cli.py`
     - `SABLE_OBSIDIAN_VAULT_ROOT=/home/arya/memory`
     - `SABLE_OBSIDIAN_VAULT_NAME=memory`
   - optional bridge timeout:
     - `APP_SERVER_IDLE_TIMEOUT_MS=600000`
   - optional voice note settings:
     - `VOICE_NOTES_ENABLED=true`
     - `VOICE_NOTES_MODEL=base.en`
     - `VOICE_NOTES_MODEL_PATH=/home/arya/models/faster-whisper-base.en`
     - `VOICE_NOTES_LANGUAGE=en`
     - `VOICE_NOTES_BEAM_SIZE=5`
     - `VOICE_NOTES_COMPUTE_TYPE=int8`
     - `VOICE_NOTES_TIMEOUT_SEC=900`
     - `VOICE_NOTES_ECHO_TRANSCRIPT=true`
5. Start the service:
   `npm start`

## Service Mode

The bridge is installed as a `systemd --user` service:

- Status:
  `systemctl --user status signal-codex-bridge.service`
- Restart after config changes:
  `systemctl --user restart signal-codex-bridge.service`
- Live logs:
  `journalctl --user -u signal-codex-bridge.service -f`

The service reads the same `.env` file in this app directory, so changing numbers later is just:

1. update `.env`
2. restart the user service

## Runtime Behavior

- The bridge starts `signal-cli -a <PHONE_NUMBER> jsonRpc` and listens to newline-delimited JSON from stdout.
- Only text messages from numbers listed in `ALLOWED_NUMBERS` are processed.
- Messages are processed one at a time. If a message arrives while Codex is already running, the sender gets:
  `Queued, will process after current task.`
- Send `/cancel` to interrupt the current in-progress transcription or Codex turn without clearing the queued follow-up messages.
- `SIGTERM` now defers bridge shutdown until the current queue drains, so an in-flight reply can finish before the process exits.
- When the bridge performs a watcher-driven restart, it sends `🟡 Restarting Connection to Sable` before exiting and `🟢 Reconnected to Sable` after the new process comes up.
- Long-running Codex jobs stream short progress updates from the app-server turn/item protocol when available.
- Replies longer than 1500 characters are split into multiple Signal messages with a 500 ms delay between chunks.
- Every inbound and outbound message is logged to stdout with timestamps.
- The bridge also polls a persisted scheduler jobs file and runs due recurring workflows through the same normal queue path as Signal messages.

## Conversation State

- Codex runs with working directory `SABLE_CODEX_CWD` when set; otherwise it uses the active instance home from instance config. Arya's current default is `/home/arya`.
- Normal messages continue the last saved Codex session.
- Send `/new` to clear the saved session so the next message starts fresh.
- Send `/new <text>` to start a fresh session immediately using `<text>` as the first prompt.
- The last Codex session id is stored in `.bridge-state.json` in the project directory so the bridge can survive restarts.
- Plugin auth state is also stored in `.bridge-state.json` so browser-based connector setup can survive bridge restarts.

## Recurring Workflow Scheduler

- This scheduler is for recurring autonomous Sable workflows, not normal reminders.
- Use Google Calendar / Tasks for ordinary reminders and todos.
- Scheduler jobs are persisted at `SABLE_SCHEDULER_JOBS_PATH` when set; otherwise the path comes from instance config. Arya's current default is:
  `/home/arya/memory/tasks/projects/sable/scheduler-jobs.json`
- Due jobs are picked up by the bridge heartbeat and executed through the normal Codex/Signal queue.
- Management escape hatches:
  - `/schedules`
  - `/unschedule <id>`
- Local CLI:
  - `node scheduler_cli.js add --recurrence daily --time 8:00AM --prompt "Give me a daily briefing of my day"`
  - `node scheduler_cli.js add --recurrence weekly --day monday --time 9:00AM --prompt "Generate a grocery list for me"`
  - `node scheduler_cli.js list`
  - `node scheduler_cli.js remove --id <schedule-id>`
- Natural-language scheduling is intended to route through the recurring-workflow scheduling skill, which should call the CLI and persist the job file rather than relying on the bridge to regex-parse English.

## Voice Notes

- Voice notes are transcribed locally on the minipc before the transcript is sent into Codex.
- The bridge treats voice notes as English-only and uses the local `transcribe_voice_note.py` helper.
- Current backend target is `faster-whisper` on CPU.
- The bridge prefers `VOICE_NOTES_MODEL_PATH` and passes `--local-only`, so it will not try to download Whisper weights during a live Signal request.
- Pre-download the model once and keep it on disk. Set `VOICE_NOTES_MODEL_PATH` to override it; otherwise the path defaults under the active instance home. Arya's current default is `/home/arya/models/faster-whisper-base.en`.
- During transcription, the bridge sends:
  `Transcribing voice note...`
- After transcription, the bridge can echo the transcript back over Signal for debugging before sending the normal Codex response.
- Audio files are written to `/tmp` temporarily and deleted after the request completes.

## File Attachments

- Images continue to pass through as images.
- Voice notes continue to transcribe locally before the transcript is sent onward.
- Non-image attachments are now downloaded to `/tmp` temporarily and handled by file type.
- Current supported file types:
  - PDFs with extractable embedded text
  - plain text style files such as `.txt`, `.md`, `.json`, `.yaml`, `.csv`, `.xml`, `.log`, and similar source/config files
- Current unsupported file types:
  - Office binaries like `.docx` and `.xlsx`
  - arbitrary binary blobs such as archives
  - scanned/image-only PDFs if no usable text can be extracted locally
- PDF extraction now uses a local `pypdf` helper only. If `pypdf` is missing from `.venv-pdf`, PDF extraction fails clearly instead of pretending to work.
- Oversized or unsupported files get a clear reply over Signal instead of failing silently.

## Plugin Auth Flow

- When Codex suggests installing a plugin such as `google-calendar`, the bridge captures the structured tool suggestion from the app-server turn stream, resolves the plugin's install URL through the local Codex app-server, and sends the URL back over Signal.
- Open the URL in your phone browser and complete the connector flow there.
- The bridge polls plugin state in the background and sends a follow-up message once the plugin looks connected.
- Send `/authstatus` to see the current plugin auth state and resend the install URL.
- Send `/authcancel` to clear a pending auth flow.
- Send `/authresume` after the plugin connects to retry the request that originally triggered the auth step.

## Instance Config

Runtime defaults come from `tools/instance/instance-config.js` first, with `.env` overrides for deploy-specific paths. Arya's current defaults are examples, not portable requirements.

- `SABLE_INSTANCE_HOME` / `SABLE_HOME`: instance home; current default `/home/arya`
- `SABLE_REPO_ROOT`: repo root; current default `/home/arya/projects/sable`
- `SABLE_CODEX_CWD`: Codex working directory; current default `/home/arya`
- `SABLE_SCHEDULER_JOBS_PATH`: scheduler persistence file; current default `/home/arya/memory/tasks/projects/sable/scheduler-jobs.json`
- `SABLE_RESEARCH_ROOT`: research KB root; current default `/home/arya/memory/knowledge/research`
- `SABLE_TELEGRAM_CLI_PATH`: Telegram review CLI; current default `/home/arya/projects/sable/tools/telegram/telegram_cli.py`
- `SABLE_OBSIDIAN_VAULT_ROOT` and `SABLE_OBSIDIAN_VAULT_NAME`: Obsidian link target; current defaults `/home/arya/memory` and the discovered vault name, usually `memory`
- `VOICE_NOTES_MODEL_PATH`: local Whisper model path; current default `/home/arya/models/faster-whisper-base.en`

## Experimental Number Rotation

This setup is currently optimized for temporary or disposable Signal numbers.

- The Signal account identity is tied to `PHONE_NUMBER`, but Codex conversation continuity is stored separately in `.bridge-state.json`.
- If the rented number expires, update `.env` with a newly registered Signal number and restart the service.
- If you want a completely fresh Codex conversation after rotating numbers, delete `.bridge-state.json` or send `/new`.
- If you want to keep the existing Codex conversation after rotating numbers, leave `.bridge-state.json` in place.

Typical replacement flow:

1. register and verify the new Signal number with `signal-cli`
2. update `PHONE_NUMBER` in `.env`
3. restart the service:
   `systemctl --user restart signal-codex-bridge.service`
4. send a test message from an allowed number

## Notes

- The bridge uses the local Codex app-server thread/turn protocol for normal requests so MCP progress and approval-related flows have a real transport.
- App-server turns are started with approval review routed to `guardian_subagent` to avoid losing connector write approvals in the Signal transport.
- No HTTP server, framework, database, daemon mode, or DBus is used.
- If `signal-cli` exits, the bridge exits too.
- For experimental use, replacing the Signal number is operationally cheap; long-term persistence of the Signal identity is the fragile part, not the bridge itself.

## End-to-End Tests

From the repo root:

1. Run:
   `npm run test:e2e`
2. The suite uses fake `signal-cli` and fake `codex` shims on `PATH` and exercises the bridge as a child process.
3. Scheduler CLI persistence tests:
   `npm run test:scheduler`
