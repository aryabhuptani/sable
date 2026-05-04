# Community Install Guide

This guide is for installing Sable as a local-first personal agent runtime on a machine you control. It is written for agents as much as humans: keep private instance state out of the repo, validate with `sable doctor`, and enable integrations only after the base install is healthy.

The `/home/arya/...` paths in this repository are Arya's current minipc layout. Treat them as examples. Your install should set its own `SABLE_INSTANCE_HOME` and related paths.

## Current Shape

Sable is still a single repo with descriptive plugin manifests, not a polished package manager install. The public-ish code lives in the checkout. Your memory, tasks, secrets, Signal account state, Telegram session, Home Assistant config, Typefully credentials, and generated runtime state belong in your local instance home.

Use this separation:

- repo code: `<repo>/`, for example `/opt/sable` or `~/projects/sable`
- instance home: `<instance-home>/`, for example `~/sable-instance`
- memory: `<instance-home>/memory`
- skills: `<instance-home>/skills`
- Codex runtime home: `<instance-home>/.codex` or `<instance-home>/.codex-bridge`
- bridge secrets: `<repo>/apps/signal-bridge/.env`
- Telegram secrets: `<repo>/tools/telegram/.env`

Do not commit `.env` files, local memory, task lists, sessions, attachment queues, OAuth state, Signal state, Telegram state, Home Assistant tokens, Typefully credentials, or generated drafts. Bureaucracy is annoying; leaked tokens are worse.

## Prerequisites

Install these first:

- Linux or macOS host you control; Linux is the best-tested target.
- Node.js 22 or newer.
- npm.
- Python 3.11 or newer with `venv` and `pip`.
- `git`.
- Codex CLI on `PATH`; run `codex --version` to confirm.
- Optional for Signal: `signal-cli` on `PATH` and a Signal number you can register.
- Optional for Telegram: Telegram API credentials from `https://my.telegram.org`.
- Optional for Home Assistant: a reachable Home Assistant instance and a long-lived access token.
- Optional for Autotweet: Typefully API key and social set ID.
- Optional for voice notes: local faster-whisper model files.

## Clone and Install

Choose your own repo location:

```bash
git clone <sable-repo-url> ~/projects/sable
cd ~/projects/sable
npm install
```

Install optional Python helpers when you need them:

```bash
python3 -m pip install telethon
python3 -m pip install -r apps/signal-bridge/requirements-stt.txt
python3 -m venv apps/signal-bridge/.venv-pdf
apps/signal-bridge/.venv-pdf/bin/pip install -r apps/signal-bridge/requirements-pdf.txt
```

The PDF and speech-to-text dependencies are only needed for the Signal bridge attachment and voice-note paths. Telegram only needs Telethon. Home Assistant uses the Python standard library for the current CLI.

## Create Instance State

Pick an instance home and create the local directories Sable expects:

```bash
export SABLE_INSTANCE_HOME="$HOME/sable-instance"
mkdir -p "$SABLE_INSTANCE_HOME"/{memory/knowledge,memory/tasks,skills,.codex,.codex-bridge}
touch "$SABLE_INSTANCE_HOME/AGENTS.md" "$SABLE_INSTANCE_HOME/TODO.md"
```

Recommended baseline environment:

```bash
export SABLE_REPO_ROOT="$HOME/projects/sable"
export SABLE_MEMORY_ROOT="$SABLE_INSTANCE_HOME/memory"
export SABLE_KNOWLEDGE_ROOT="$SABLE_INSTANCE_HOME/memory/knowledge"
export SABLE_TASKS_ROOT="$SABLE_INSTANCE_HOME/memory/tasks"
export SABLE_SKILLS_ROOT="$SABLE_INSTANCE_HOME/skills"
export SABLE_CODEX_CWD="$SABLE_INSTANCE_HOME"
export SABLE_SCHEDULER_JOBS_PATH="$SABLE_INSTANCE_HOME/memory/tasks/projects/sable/scheduler-jobs.json"
export SABLE_RESEARCH_ROOT="$SABLE_INSTANCE_HOME/memory/knowledge/research"
export SABLE_AUTOTWEET_ROOT="$SABLE_INSTANCE_HOME/memory/knowledge/projects/sable/autotweet"
export SABLE_SIGNAL_BRIDGE_DIR="$SABLE_REPO_ROOT/apps/signal-bridge"
export CODEX_HOME="$SABLE_INSTANCE_HOME/.codex-bridge"
```

For a persistent install, put those exports in your shell profile, service environment, or a private env file loaded by your process supervisor. Do not bake them into tracked repo files.

Instance config currently recognizes these path overrides:

- `SABLE_INSTANCE_HOME` or `SABLE_HOME`
- `SABLE_REPO_ROOT`
- `SABLE_MEMORY_ROOT`
- `SABLE_KNOWLEDGE_ROOT`
- `SABLE_TASKS_ROOT`
- `SABLE_SKILLS_ROOT`
- `SABLE_RESEARCH_ROOT`
- `SABLE_AUTOTWEET_ROOT`
- `SABLE_SIGNAL_BRIDGE_DIR`
- `SABLE_CODEX_CWD`
- `SABLE_SCHEDULER_JOBS_PATH`
- `SABLE_OBSIDIAN_VAULT_ROOT`
- `SABLE_OBSIDIAN_VAULT_NAME`
- `VOICE_NOTES_MODEL_PATH`

## Configure Private Secrets

Create bridge config at `apps/signal-bridge/.env` only if you are enabling Signal:

```dotenv
PHONE_NUMBER=+15550000000
ALLOWED_NUMBERS=+15551112222
CODEX_HOME=/home/example/sable-instance/.codex-bridge
SABLE_INSTANCE_HOME=/home/example/sable-instance
SABLE_REPO_ROOT=/home/example/projects/sable
SABLE_CODEX_CWD=/home/example/sable-instance
SABLE_MEMORY_ROOT=/home/example/sable-instance/memory
SABLE_TASKS_ROOT=/home/example/sable-instance/memory/tasks
SABLE_KNOWLEDGE_ROOT=/home/example/sable-instance/memory/knowledge
```

Create Telegram config at `tools/telegram/.env` only if you are enabling Telegram:

```dotenv
SABLE_TELEGRAM_API_ID=123456
SABLE_TELEGRAM_API_HASH=your_api_hash
SABLE_TELEGRAM_PHONE=+15551112222
SABLE_TELEGRAM_SESSION_PATH=/home/example/sable-instance/.local/state/sable-telegram/telethon.session
```

For Home Assistant and Typefully, prefer process environment or a private secret manager:

```bash
export SABLE_HOME_ASSISTANT_URL="http://homeassistant.local:8123"
export SABLE_HOME_ASSISTANT_TOKEN="..."
export SABLE_HOME_ASSISTANT_CONFIG_DIR="$HOME/homeassistant"
export TYPEFULLY_API_KEY="..."
export TYPEFULLY_SOCIAL_SET_ID="..."
```

## Run Doctor and Smoke Tests

From the repo root:

```bash
npm run sable:doctor
npm run sable:doctor -- --json
npm run test:smoke
```

`sable doctor` is read-only. It checks the repo shape, Codex availability, plugin manifests, local instance paths, bridge runtime paths, and config-key presence while redacting secret values.

`npm run test:smoke` is the migration gate. It composes bridge E2E tests, runner assumptions, scheduler, knowledge-base scaffolding, autotweet, Home Assistant, Telegram, Signal attachments, plugin manifests, doctor, instance config, and static migration-contract coverage.

If you only changed local secrets or instance paths, run doctor first. If you changed code or plugin manifests, run smoke before proposing or merging the change.

## Optional Plugin Setup

Plugin manifests live under `plugins/*/plugin.json`. They are currently descriptive contracts for capabilities, config, secrets, diagnostics, and private-data policy. Validate them with:

```bash
npm run test:plugins
```

### Signal Transport

Signal gives Sable its chat interface.

1. Install `signal-cli`.
2. Register and verify the agent number:

```bash
signal-cli -a +15550000000 register
signal-cli -a +15550000000 verify <CODE>
signal-cli -a +15550000000 send -m "hello" +15551112222
```

3. Create `apps/signal-bridge/.env` with `PHONE_NUMBER`, `ALLOWED_NUMBERS`, `CODEX_HOME`, and your instance path overrides.
4. Start the bridge:

```bash
cd apps/signal-bridge
npm start
```

Useful chat commands after it is running:

- `/bridgestatus`
- `/ops`
- `/new`
- `/cancel`

For attachment sending from tools, run this from the repo root:

```bash
npm run signal:attach -- --file /abs/path/to/file.pdf --message "sending this"
```

Set `SABLE_SIGNAL_ATTACHMENT_QUEUE_DIR` if you want the attachment queue outside the bridge directory.

### Telegram Review

Telegram support is a local Telethon CLI plus a Signal-facing `/telegram` command when the bridge is running.

```bash
python3 -m pip install telethon
npm run telegram:cli -- doctor
npm run telegram:cli -- login
npm run telegram:cli -- triage --limit 30
```

Secrets can live in `tools/telegram/.env` or process env:

- `SABLE_TELEGRAM_API_ID`
- `SABLE_TELEGRAM_API_HASH`
- `SABLE_TELEGRAM_PHONE`
- optional `SABLE_TELEGRAM_SESSION_PATH`
- optional bridge-side `SABLE_TELEGRAM_CLI_PATH`
- optional bridge-side `SABLE_TELEGRAM_PYTHON_BIN`

Keep the Telethon session under your instance home, not in the repo.

### Home Assistant

Home Assistant support is a local Python CLI for inspection, service calls, and Sable-managed automation edits.

```bash
npm run ha:cli -- summary
npm run ha:cli -- list-devices
npm run ha:cli -- list-entities
```

For live service calls, set:

- `SABLE_HOME_ASSISTANT_URL` or `HOME_ASSISTANT_URL`
- `SABLE_HOME_ASSISTANT_TOKEN` or `HOME_ASSISTANT_TOKEN`

For local config inspection or automation edits, set:

- `SABLE_HOME_ASSISTANT_CONFIG_DIR`
- optional `SABLE_HOME_ASSISTANT_AUTOMATIONS_FILE`
- optional `SABLE_HOME_ASSISTANT_SCENES_FILE`

Do not put home layout details, entity IDs, tokens, or private automation preferences into plugin manifests.

### Autotweet

Autotweet uses local markdown configuration plus Typefully draft queueing. It should queue drafts for review, not auto-publish.

Create or point `SABLE_AUTOTWEET_ROOT` at your local config directory. Expected files are:

- `CONFIG.md`
- `STYLE_GUIDE.md`
- `QUESTION_BANK.md`
- `SUGGESTIONS.md`

Useful commands:

```bash
npm run autotweet:suggestions -- help
npm run autotweet:context
npm run autotweet:typefully -- help
npm run autotweet:run
```

For live Typefully access, set:

- `TYPEFULLY_API_KEY`
- `TYPEFULLY_SOCIAL_SET_ID`

Keep unpublished drafts, account IDs, style notes, and suggestions in your instance memory, not in repo docs or manifests.

## Running as a Service

For a personal machine, use a user-level service or a small process supervisor. The service should:

- run from `<repo>/apps/signal-bridge`
- load `apps/signal-bridge/.env` and your instance environment
- keep `CODEX_HOME` writable
- keep `SABLE_CODEX_CWD` pointed at your instance home or chosen workspace
- restart the bridge after env changes

On Linux with systemd user services, the operational loop is:

```bash
systemctl --user status signal-codex-bridge.service
systemctl --user restart signal-codex-bridge.service
journalctl --user -u signal-codex-bridge.service -f
```

The exact unit file is instance-specific because paths and secret loading differ per person.

## Updates and Contributions

Before updating:

```bash
git status --short
git pull --ff-only
npm install
npm run sable:doctor
npm run test:smoke
```

Contribution rules for shareable changes:

- Keep code and reusable manifests in the repo.
- Keep private state and secrets in the instance home or ignored `.env` files.
- Do not add Arya-specific absolute paths except as explicit examples.
- Update plugin manifests when capabilities, required config, required secrets, or private-data policies change.
- Run focused tests for the area you changed, then `npm run test:smoke` for migration-sensitive work.
- Do not commit local memory contents, generated queue state, Signal/Telegram sessions, Home Assistant details, Typefully credentials, or Codex runtime state.

When in doubt, run `npm run sable:doctor -- --json` and inspect what paths the runtime thinks it is using. The doctor is dull on purpose, which is exactly why it is useful.
