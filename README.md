# Sable

Sable is Arya's local-first automation and messaging stack on the minipc.

Current status: `v0.1.1` developer preview. Sable is still a single repo with private instance state kept outside the checkout, a Signal-first bridge, Codex CLI under the hood, and plugin API v1 for local command plugins. Trusted friends can start running it now, but it is still an early local-first system rather than a polished package.

Runtime paths are centralized through `tools/instance/instance-config.js` and can be overridden with environment variables. The `/home/arya/...` paths below document Arya's current minipc layout; they are examples, not assumptions every install must inherit.

Fast path:

```bash
npm install
npm run init:instance -- --instance-home "$HOME/sable-instance"
npm run sable:doctor -- --home-dir "$HOME/sable-instance"
```

For fresh local setup, see `docs/community-install.md`. For what Sable can do out of the box, see `docs/capabilities.md`. For first-user handoff, see `docs/first-user-handoff.md`. For upgrades, see `docs/upgrade.md`. For contributing, see `CONTRIBUTING.md`. For release status, see `DEVELOPER_PREVIEW.md`.

## Layout

- `apps/signal-bridge/`: the live Signal bridge service
- `plugins/`: official plugin manifests and upstreamable plugin scaffolds
- `tools/`: install, upgrade, diagnostics, plugin, and integration tooling
- `tests/e2e/`: black-box end-to-end tests for the bridge
- `knowledge/`: symlink to canonical project knowledge in `/home/arya/memory/knowledge/projects/sable/`
- `TASKS.md`: symlink to canonical project tasks in `/home/arya/memory/tasks/projects/sable/TODO.md`

## Bridge Architecture

The Signal bridge is intentionally moving toward a light modular layout rather than one ever-fatter `bridge.js`.

Current boundaries:

- `apps/signal-bridge/bridge.js`
  - composition root and orchestration
  - owns the live bridge lifecycle, queue processing, and high-level job flow
- `apps/signal-bridge/bridge-commands.js`
  - slash-command parsing
- `apps/signal-bridge/bridge-ops.js`
  - `/ops`, `/bridgestatus`, snapshot/history writing, and alert logic
- `apps/signal-bridge/bridge-codex-client.js`
  - Codex app-server transport/client plumbing
- `apps/signal-bridge/plugin-runtime.js`
  - plugin API v1 discovery, local command registration, and `/plugins`

Refactor policy:

- new bridge features should default to an existing module boundary when one fits
- `bridge.js` should stay focused on orchestration, not accumulate new subsystem internals
- scheduler/autoresearch and attachment internals should only be extracted further when feature work creates real pressure, not for aesthetic reasons alone

## Philosophy

- code lives in `/home/arya/projects/`
- semantic notes live in `/home/arya/memory/knowledge/`
- actionable tracking lives in `/home/arya/memory/tasks/`

That separation is deliberate. Knowledge is not the same thing as a queue.

The scheduler is also not a reminder system. It is for recurring workflows like daily briefs, weekly planning, and other agentic jobs that Sable should run on a schedule.

## Instance Config

Current Arya defaults come from instance config and can be overridden per deployment:

- `SABLE_INSTANCE_HOME` / `SABLE_HOME`: instance home, default `/home/arya`
- `SABLE_REPO_ROOT`: repo root, default `/home/arya/projects/sable`
- `SABLE_CODEX_CWD`: bridge Codex working directory, default `/home/arya`
- `SABLE_SCHEDULER_JOBS_PATH`: scheduler jobs file, default `/home/arya/memory/tasks/projects/sable/scheduler-jobs.json`
- `SABLE_RESEARCH_ROOT`: research KB root, default `/home/arya/memory/knowledge/research`
- `SABLE_TELEGRAM_CLI_PATH`: Telegram CLI, default `/home/arya/projects/sable/tools/telegram/telegram_cli.py`
- `SABLE_OBSIDIAN_VAULT_ROOT` / `SABLE_OBSIDIAN_VAULT_NAME`: Obsidian vault link target, default root `/home/arya/memory`
- `SABLE_PLUGIN_PATHS`: extra local plugin roots, default includes `<instance-home>/plugins`
- `VOICE_NOTES_MODEL_PATH`: local faster-whisper model path, default `/home/arya/models/faster-whisper-base.en`

## Developer Preview Commands

- First-run instance setup:
  `npm run init:instance -- --instance-home "$HOME/sable-instance"`
- Doctor:
  `npm run sable:doctor`
- User service:
  `npm run install:user-service`, `npm run service:start`, `npm run service:status`
- Local plugin scaffold:
  `npm run plugin:create -- --id local-hello --target local`
- Guarded upgrade:
  `npm run upgrade:check`, then `npm run upgrade`
- Shareability scan:
  `npm run shareability:check`
- Community test aggregate:
  `npm run test:community`
- Fresh-clone setup simulation:
  `npm run simulate:fresh-clone`

## Knowledge Base V0

Sable now includes a minimal research knowledge-base scaffold utility:

- Command:
  `npm run kb:init -- "<topic title>"`
- Optional slug override:
  `npm run kb:init -- "<topic title>" --slug <topic-slug>`

This creates a topic-local knowledge base under `SABLE_RESEARCH_ROOT`, which defaults to `/home/arya/memory/knowledge/research/` for Arya's current instance, with:

- `KB.md`
- `raw/inbox/`
- `raw/processed/`
- `wiki/index.md`
- `wiki/log.md`
- `wiki/notes/`
- `outputs/`

The wiki is intended to stay atomic, semantically linked, and Obsidian-friendly. `raw/inbox/` is the single source-drop zone for text, PDFs, screenshots, and other research inputs. `raw/processed/` is the processed archive. `outputs/` stores derived artifacts and is not canonical memory.

## Autoresearch MVP

Sable now includes a bounded autoresearch run scaffold:

- Command:
  `npm run kb:init-run -- --topic <topic-slug> --question "<root question>"`

This creates an active run under the topic KB with:

- `autoresearch/README.md`
- `autoresearch/active/<run-slug>/RUN.md`
- `autoresearch/active/<run-slug>/STATE.json`
- `autoresearch/active/<run-slug>/QUESTIONS.md`
- `autoresearch/active/<run-slug>/SOURCES.md`
- `autoresearch/active/<run-slug>/LOG.md`

New deep-audit runs now default to a stronger contract:

- `mode: deep_audit`
- `maxDepth: 5`
- `maxTotalQuestions: 15`
- `maxFollowupsPerQuestion: 4`
- `minProcessedQuestionsBeforeComplete: 4`
- `minTicksBeforeComplete: 4`
- `requireFrontierExpansionOnRoot: true`

The live scheduler now also supports interval workflows, which is how the shared `every 5 minutes` autoresearch tick runs without creating a little bureaucratic republic of separate scheduler jobs.

## Autotweet Framework

Sable now includes an initial autotweet scaffold inside this repo rather than as a separate project.

- KB/context collector:
  `npm run autotweet:context`
- Deterministic draft-cycle runner:
  `npm run autotweet:run`
- Suggestions helper:
  `npm run autotweet:suggestions -- help`
- Typefully CLI helper:
  `npm run autotweet:typefully -- help`
- Tests:
  `npm run test:autotweet`

Canonical markdown config lives in:

- `/home/arya/memory/knowledge/projects/sable/autotweet/CONFIG.md`
- `/home/arya/memory/knowledge/projects/sable/autotweet/STYLE_GUIDE.md`
- `/home/arya/memory/knowledge/projects/sable/autotweet/QUESTION_BANK.md`
- `/home/arya/memory/knowledge/projects/sable/autotweet/SUGGESTIONS.md`

Required environment variables for live Typefully queueing:

- `TYPEFULLY_API_KEY`
- `TYPEFULLY_SOCIAL_SET_ID`

The current workflow is intentionally conservative:

1. pull ideas from configured knowledge bases
2. use the style guide, question bank, and explicit suggestions queue
3. queue drafts in Typefully for review
4. do not auto-publish

## Home Assistant Tooling

Sable now includes a local Home Assistant helper CLI:

- Command:
  `npm run ha:cli -- <subcommand>`
- Tests:
  `npm run test:homeassistant`

Current focus:

- inventory-style reads from the local Home Assistant config/state tree
- scene activation and generic service calls through the Home Assistant HTTP API when URL/token are configured
- Sable-managed schedule creation/removal by editing `automations.yaml`

Environment variables:

- `SABLE_HOME_ASSISTANT_URL` or `HOME_ASSISTANT_URL`
- `SABLE_HOME_ASSISTANT_TOKEN` or `HOME_ASSISTANT_TOKEN`
- optional config overrides:
  - `SABLE_HOME_ASSISTANT_CONFIG_DIR`
  - `SABLE_HOME_ASSISTANT_AUTOMATIONS_FILE`
  - `SABLE_HOME_ASSISTANT_SCENES_FILE`

Examples:

1. `npm run ha:cli -- summary`
2. `npm run ha:cli -- list-devices --area "Living Room"`
3. `npm run ha:cli -- call-service --domain light --service turn_on --data '{"entity_id":"light.smart_bulb"}'`
4. `npm run ha:cli -- add-scene-schedule --alias "Evening scene" --scene-entity-id scene.evening --time 18:30`
