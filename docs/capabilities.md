# What Sable Can Do

Sable is a local-first personal agent runtime. The useful mental model is: you talk to Sable over Signal, she runs Codex locally, and she can use local plugins, scheduled workflows, and your private instance memory to do work on your machine.

## Out Of The Box

- Chat with Codex through the Signal bridge, including resumable interactive sessions and `/new` fresh sessions.
- Handle images, audio notes, PDFs, and text/file attachments through the bridge attachment pipeline.
- Run recurring scheduled workflows such as daily briefs, weekly planning, or silent maintenance jobs.
- Keep default scheduled workflows separate from personal/local scheduled workflows:
  - default workflows live in `SABLE_DEFAULT_SCHEDULER_JOBS_PATH`;
  - local workflows created by the user live in `SABLE_SCHEDULER_JOBS_PATH`.
  - default workflows include conservative dreaming and the daily memory eval loop.
- Discover official and local plugins with `/plugins`.
- Add private local plugins under `<instance-home>/plugins/local-*` without forking Sable.
- Maintain local markdown memory and produce phone-openable Obsidian links when configured.
- Run bounded background Codex jobs through the background-job harness.
- Run guarded upgrades with `npm run upgrade:check` and `npm run upgrade`.

## Memory And Knowledge

Sable expects a markdown-first memory tree:

- `AGENTS.md` for durable local operating norms.
- `skills/` for reusable procedures.
- `memory/tasks/` for active work and project task lists.
- `memory/knowledge/` for semantic, project, and research knowledge.

The memory architecture and daily eval loop are documented in:

- `docs/memory-architecture.md`
- `docs/memory-eval-loop.md`

New instances get a private `memory/README.md`, seed memory evals, and a memory task file so local memory can improve over time without putting private state in the repo.

## Optional Integrations

- Telegram review and reply drafting, when Telegram credentials/session are configured.
- Home Assistant inspection, device control, and local automation management, when Home Assistant URL/token are configured.
- Autotweet editorial suggestion and Typefully draft workflows, when Typefully credentials are configured.
- Google Calendar connector workflows when the connector is available in the active Codex environment.
- Voice note transcription when local faster-whisper dependencies/model files are installed.

## Signal Commands

Send `/help` to Sable for the live command list. The core commands are:

- `/help`
- `/new`
- `/cancel`
- `/ops`
- `/bridgestatus`
- `/plugins`
- `/schedules`
- `/unschedule <id>`
- `/telegram [limit]`
- `/setavatar`
- `/removeavatar`
- `/authstatus`
- `/authresume`
- `/authcancel`

Runtime plugin commands, if any, appear after the core commands.

## First-Run Personalization

`npm run init:instance` creates private instance instructions at `<instance-home>/AGENTS.md`. Edit that file to choose Sable's name/personality/norms. After the Signal bridge is running, send `/setavatar` with an attached image to set Sable's Signal profile picture.
