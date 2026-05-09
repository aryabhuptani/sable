# Sable v0.1.3 Developer Preview

Release: `v0.1.3`

This is the first developer-preview handoff for trusted early users.

## What Is Stable Enough

- Single-repo install from a tagged ref.
- Private instance home outside the repo.
- Signal-first local bridge service.
- Codex CLI runner under the hood.
- `npm run init:instance` first-run setup.
- `npm run sable:doctor` diagnostics with secret redaction.
- User-level systemd service install/control.
- Plugin API v1 for local Node command plugins.
- Local plugin roots via `SABLE_PLUGIN_PATHS` and `<instance-home>/plugins`.
- Guarded upgrades through `npm run upgrade:check` and `npm run upgrade`.
- Shareability scan for obvious private-state leaks.
- Split default scheduled workflows from local/personal scheduled workflows.
- Default daily memory eval workflow for incremental markdown-memory improvement.
- `/help` command for live slash-command discovery.
- First-run identity/avatar setup prompts.
- Capability docs for what Sable can do out of the box.

## What Is Not Stable Yet

- This is not a polished package-manager install.
- The bridge is still Signal-first.
- Local plugin API v1 is intentionally small.
- Official plugins are still mostly manifest-described boundaries over existing tools.
- Some integrations require manual account setup, especially Signal, Telegram, Home Assistant, and connector auth.
- Main may move quickly between named releases.

## Compatibility Promise

For `v0.1.3`, the compatibility promise is narrow:

- Private instance state should stay outside the repo and should not be overwritten by upgrades.
- Local plugins under `<instance-home>/plugins/local-*` should survive repo pulls.
- Plugin manifests using `pluginApiVersion: 1` should either keep working or fail with a clear doctor/runtime error if the contract changes later.
- Breaking plugin API changes after this should use a new `pluginApiVersion` or a compatibility shim.

## Recommended Release Flow

- Users install from the latest named developer-preview tag.
- Contributors PR changes to `main`.
- `main` can move faster than user installs.
- Cut named tags for safer handoffs after `npm run test:community` and fresh-clone simulation pass.

## Upgrade Flow

```bash
npm run upgrade:check
npm run upgrade
```

Use `docs/upgrade.md` for details.

## First User Handoff

Use `docs/first-user-handoff.md`. It points to the canonical install docs rather than duplicating the install guide.
