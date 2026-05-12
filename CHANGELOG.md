# Changelog

Sable uses named developer-preview tags and GitHub Releases for user-facing patch notes. This file is the repo-local changelog.

## v0.1.7 - 2026-05-12

### Added

- Added experimental WhatsApp review support through WhatsApp Web.
- Added `/whatsapp [limit]` to surface approved WhatsApp chats without starting a Codex turn.
- Added `npm run whatsapp:cli` with `init-config` and `triage` commands.
- Added an approved-chat allowlist config so WhatsApp triage surfaces only explicitly approved chat ids or exact chat names.
- Added the `whatsapp-review` plugin manifest and setup docs.

### Compatibility

- WhatsApp support is opt-in and does not add `whatsapp-web.js` to the default install path. Users who enable it should run `npm install whatsapp-web.js qrcode-terminal` locally.
- WhatsApp session data and approved-chat config stay in private instance state, outside the repo.

### Validation

- `npm run test:whatsapp`
- `node --test tests/e2e/bridge.commands.e2e.test.js`
- `npm run test:plugins`
- `npm run test:community`

## v0.1.6 - 2026-05-12

### Added

- Added a generated `<instance-home>/SETUP.md` first-run checklist covering identity/personality, Signal avatar, `/help`, runtime, scheduling, and memory setup.

### Changed

- Schedule listings now label workflows as `[default]` or `[local]`.
- Normal `/unschedule` and scheduler CLI removal protect default workflows; the CLI requires `--include-defaults true` for intentional default scheduler edits.

### Validation

- `node --test tests/scheduler-cli.test.js tests/bridge-scheduler-runtime.test.js tests/bridge-job-runtime.test.js tests/init-instance.test.js tests/test_bridge_commands.js`
- `node --test tests/e2e/bridge.e2e.test.js`
- `npm run test:community`

## v0.1.5 - 2026-05-09

### Added

- Added `npm run autoresearch:archive-completed`, a deterministic finalizer that moves completed autoresearch runs from `active/` to `archive/` while preserving state and run logs.
- Wired the Signal bridge autoresearch monitor to archive completed runs after completion notices are prepared.
- Wired the daily memory eval prompt to run the archive finalizer before measuring memory health.

### Changed

- Completion notices now rewrite run-log paths to the archived location when a run is archived during notice handling.

### Validation

- `npm run test:kb`
- `node --test tests/autoresearch-monitor.test.js tests/memory-health.test.js`
- `npm run test:community`

## v0.1.4 - 2026-05-09

### Added

- Added `npm run memory:health`, a deterministic markdown memory health checker.
- Added report artifacts under `memory/knowledge/projects/memory/metrics/` when run with `--write-dir`.
- Added daily memory-eval prompt guidance to run the health check before choosing one low-risk improvement.
- Added smoke coverage for memory health checks.

### Fixed

- Local link measurement now handles Obsidian wiki-style notes and line-suffixed file references, reducing false broken-link noise.

### Validation

- `npm run test:memory`
- `npm run memory:health -- --memory-root <instance-home>/memory --write-dir <instance-home>/memory/knowledge/projects/memory/metrics --format text`
- `npm run test:community`

## v0.1.3 - 2026-05-09

### Added

- Codified the markdown-first memory architecture in repo docs and first-run instance scaffolding.
- Added `memory/knowledge/projects/memory/ARCHITECTURE.md` and `ARCHITECTURE_LOG.md` scaffolding for new Sable instances.
- Added the architecture change rule: memory architecture changes must update the architecture record and append to the architecture log.

### Changed

- Updated developer-preview handoff docs to point first users at `v0.1.3`.

### Validation

- `node --test tests/init-instance.test.js`
- `npm run shareability:check`
- `git diff --check`

## v0.1.2 - 2026-05-09

### Added

- Added `default-memory-eval`, a silent daily workflow for eval-driven memory improvement.
- Added memory architecture and eval-loop docs.
- Added seed memory eval scaffolding for new Sable instances.

### Validation

- `npm run test:community`
- `npm run test:e2e`
- `npm run shareability:check`

## v0.1.1 - 2026-05-08

### Added

- Added `/help` for built-in and plugin command discovery.
- Split default scheduled workflows from local/personal scheduled workflows.
- Added first-run identity/avatar onboarding prompts.
- Added out-of-the-box capability docs.

### Fixed

- Removed Arya-specific hardcoding from the background-job harness Codex home resolution.

### Validation

- `npm run test:community`

## v0.1.0 - 2026-05-05

### Added

- First runnable community developer-preview handoff.
- Private instance setup with `npm run init:instance`.
- User service install/control tooling.
- Plugin API v1 and local plugin scaffolding.
- Guarded upgrade flow, shareability checks, and community install docs.

### Validation

- `npm run test:community`
- fresh-clone simulation
