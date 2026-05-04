# Sable Architecture Migration Checklist

This checklist is the gate for migrating Sable from Arya's local agent into a community-installable local-first runtime without breaking the working bridge.

## Non-Negotiables

- Keep Codex CLI as the primary runner until another runner proves it can preserve the same local workflow and cost profile.
- Run `npm run test:smoke` before and after each migration slice.
- Move behavior behind boundaries before moving files between repos.
- Do not move secrets, private memory, personal tasks, phone numbers, OAuth state, or Arya-specific prompts into shareable code.
- Prefer compatibility shims during migration; delete them only after downstream call sites are updated and smoke coverage is green.

## Core Boundaries

### Runner Boundary

Core may depend on a `RunnerAdapter`, not directly on Codex, Hermes, or API clients.

Adapter contract:

- identify runner type and display name
- expose launch args and child environment diagnostics without printing secrets
- create a long-lived session/client for streaming turns
- call one-shot runner methods when needed
- probe runtime capability profile
- close/cancel active sessions when supported

Initial implementation: `CodexCliRunnerAdapter`.

Future implementations: `HermesRunnerAdapter`, optional API-backed runner for users who explicitly choose direct API spend.

### Transport Boundary

Core may depend on a transport interface, not directly on Signal.

Transport contract:

- receive inbound events
- send text
- send attachments
- expose sender identity
- expose thread/conversation context
- provide health diagnostics

Initial implementation: Signal bridge.

### Plugin Boundary

Plugins may register domain behavior, but should not monkeypatch bridge internals.

Plugin contract:

- manifest with name, version, capabilities, commands, required config, required secrets, and diagnostics
- enable/disable lifecycle
- command handlers
- scheduled workflow hooks
- optional skill/prompt snippets
- tests or smoke checks

Initial plugin candidates: Telegram, Home Assistant, Google Calendar, Autotweet, Autoresearch, memory/Obsidian.

### Instance Boundary

Local instance state owns private identity and data.

Instance-owned state:

- assistant name/personality/avatar
- private memory and task files
- enabled plugin list and plugin config
- secrets and OAuth state pointers
- allowed senders/recipients
- local scheduler jobs and automations

Shareable code must not assume Arya's instance except through defaults or explicit config.

## Migration Sequence

1. Add smoke gate and migration contract tests.
2. Add `RunnerAdapter` around the existing Codex CLI path.
3. Add plugin manifest schema and descriptive manifests for current integrations.
4. Add `sable doctor` for config, runner, plugin, memory, and bridge diagnostics.
5. Extract one low-risk integration behind a plugin boundary.
6. Move Arya-specific config discovery toward an instance directory.
7. Repeat plugin extraction with smoke coverage after each slice.
8. Split repos only after internal boundaries hold inside the current repo.

## Per-Slice Checklist

- Scope names the boundary being changed.
- Existing behavior is preserved unless the change explicitly says otherwise.
- Smoke gate passes before edits if the slice touches runtime behavior.
- New or moved boundary has at least one focused test.
- `npm run test:smoke` passes after edits.
- Sable task state and maintenance log are updated when the slice materially advances migration work.
- Meaningful Sable code changes are committed and pushed.

## Repo Split Readiness

Do not split repos until all are true:

- `CodexCliRunnerAdapter` is the only bridge path for Codex execution.
- At least two integrations are behind plugin manifests.
- `sable doctor` can diagnose missing local config without exposing secrets.
- Arya's local instance works through config rather than hardcoded private paths for the migration-touched surfaces.
- A fresh clone can run the smoke gate without requiring Arya's private secrets.
