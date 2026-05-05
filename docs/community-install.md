# Community Install Guide

This guide is for installing Sable as a local-first personal agent runtime on a machine you control. It is written for agents as much as humans: keep private instance state out of the repo, validate with `sable doctor`, and enable integrations only after the base install is healthy.

The `/home/arya/...` paths in this repository are Arya's current minipc layout. Treat them as examples. Your install should set its own `SABLE_INSTANCE_HOME` and related paths.

## Fast Path: Run Sable Today

This is the shortest path for a trusted early user who wants a real local Sable process, not just a repo tour.

```bash
git clone <sable-repo-url> ~/projects/sable
cd ~/projects/sable
npm install
npm run init:instance -- --instance-home "$HOME/sable-instance"
cp apps/signal-bridge/.env.example apps/signal-bridge/.env
```

Edit `apps/signal-bridge/.env` with your Signal number, allowed sender number, and generated instance paths. The private instance env is generated at:

```bash
$HOME/sable-instance/.config/sable/sable.env
```

Then validate and install the service:

```bash
npm run sable:doctor -- --home-dir "$HOME/sable-instance"
npm run install:user-service -- --instance-home "$HOME/sable-instance"
npm run service:start -- --instance-home "$HOME/sable-instance"
npm run service:status -- --instance-home "$HOME/sable-instance"
```

Send a Signal message to the Sable number. Once it replies, check:

```text
/ops
/bridgestatus
```

If the bridge fails to start, read logs with:

```bash
journalctl --user -u sable-signal-bridge.service -f
```

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

Pick an instance home and let Sable create the local directories it expects:

```bash
npm run init:instance -- --instance-home "$HOME/sable-instance"
```

The initializer is conservative. It creates missing directories and starter files, but it does not overwrite existing notes unless you pass `--force`; generated files such as scheduler jobs can be regenerated with `--reset-generated`.

The generated private env file contains the baseline environment:

```bash
$HOME/sable-instance/.config/sable/sable.env
```

For a persistent install, the user-level service loads that env file. Do not bake private paths or secrets into tracked repo files.

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

Use `apps/signal-bridge/.env.example` as the starting point. Keep the real `.env` ignored and private.

Create Telegram config at `tools/telegram/.env` only if you are enabling Telegram:

```dotenv
SABLE_TELEGRAM_API_ID=123456
SABLE_TELEGRAM_API_HASH=your_api_hash
SABLE_TELEGRAM_PHONE=+15551112222
SABLE_TELEGRAM_SESSION_PATH=/home/example/sable-instance/.local/state/sable-telegram/telethon.session
```

Use `tools/telegram/.env.example` as the starting point.

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

## Upgrade Safely

Once installed, use the guarded upgrade flow instead of an unreviewed pull:

```bash
npm run upgrade:check
npm run upgrade
```

The upgrade command refuses dirty repo state, fast-forwards from upstream, runs checks, and restarts the user service only after checks pass. It does not overwrite your instance home or local plugins.

See `docs/upgrade.md` for recovery steps and smoke-level options.

## Optional Plugin Setup

Plugin manifests live under `plugins/*/plugin.json` for official plugins and `<instance-home>/plugins/*/plugin.json` for local plugins. Official plugins are upstreamable. Local plugins are for one person's Sable and should survive repo pulls because they live outside the checkout.

Plugin API v1 is intentionally small:

- manifest metadata
- command registration
- config lookup through env / instance config
- logger
- reply helper
- instance paths
- optional diagnostics hook

Validate manifests with:

```bash
npm run test:plugins
```

At runtime, send:

```text
/plugins
```

That reports discovered official/local plugins, plugin API version, registered runtime commands, and local validation issues.

### How Kristen Adds a Local Plugin Without Forking Sable

Create a private local plugin under the instance home:

```bash
npm run plugin:create -- --id local-hello --target local
```

Local plugin ids must start with `local-` so they cannot silently shadow official plugins. The scaffold creates:

- `<instance-home>/plugins/local-hello/plugin.json`
- `<instance-home>/plugins/local-hello/handler.js`
- `<instance-home>/plugins/local-hello/README.md`
- `<instance-home>/plugins/local-hello/handler.test.js`

Restart Sable, then send `/plugins`. The scaffolded command is registered from `handler.js` and should appear in the command list. Upstream updates should not touch this directory.

If someone intentionally wants Sable to search additional local plugin roots, set:

```bash
SABLE_PLUGIN_PATHS=/abs/path/to/plugins:/another/plugin/root
```

Local plugins are loaded after official manifests. A local plugin cannot use an official plugin id unless `SABLE_ALLOW_PLUGIN_SHADOWS` explicitly lists that id. Treat that override as a development escape hatch, not normal configuration.

### How to PR an Official Plugin Upstream

Scaffold into the repo instead:

```bash
npm run plugin:create -- --id calendar-cleanup --target repo
```

Then update the manifest category, capabilities, commands, config, secrets, diagnostics, and private-data policy so it accurately describes the integration. Official plugins should avoid user-specific paths, tokens, phone numbers, session files, message contents, or local memory in tracked files.

Before opening a PR, run:

```bash
npm run test:plugins
npm run test:smoke
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

For a personal machine, prefer the provided user-level systemd service on Linux:

```bash
npm run install:user-service -- --instance-home "$HOME/sable-instance"
npm run service:start -- --instance-home "$HOME/sable-instance"
npm run service:status -- --instance-home "$HOME/sable-instance"
```

The service:

- runs from `<repo>/apps/signal-bridge`
- loads `<instance-home>/.config/sable/sable.env`
- loads `<repo>/apps/signal-bridge/.env`
- keeps `CODEX_HOME` pointed at the private instance
- restarts on bridge failure

Operational commands:

```bash
npm run service:restart -- --instance-home "$HOME/sable-instance"
npm run service:stop -- --instance-home "$HOME/sable-instance"
npm run uninstall:user-service -- --instance-home "$HOME/sable-instance"
journalctl --user -u sable-signal-bridge.service -f
```

To inspect the generated unit without installing it:

```bash
node tools/service/user-service.js render --instance-home "$HOME/sable-instance"
node tools/service/user-service.js install --instance-home "$HOME/sable-instance" --dry-run
```

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
