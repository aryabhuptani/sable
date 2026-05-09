# Changelog

Sable uses named developer-preview tags and GitHub Releases for user-facing patch notes. This file is the repo-local changelog.

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
