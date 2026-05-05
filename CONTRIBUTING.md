# Contributing to Sable

Sable is currently a developer preview: one repo, private instance state outside the repo, Signal-first runtime, Codex CLI runner, and plugin API v1 for local command plugins.

## Repo vs Instance State

Keep upstreamable code in the repo. Keep personal state in the instance home.

- Repo: bridge code, plugin manifests, tools, tests, docs.
- Instance home: `AGENTS.md`, `TODO.md`, memory, tasks, skills, local plugins, Codex homes, sessions, generated runtime state.
- Secrets: real `.env` files, OAuth state, API keys, phone numbers, Signal/Telegram sessions, Home Assistant tokens.

Do not commit private state. Sable is local-first, not local-state-in-git. Tiny distinction; enormous blast radius.

## Plugin API v1

Official plugin manifests live under `plugins/<id>/plugin.json`.

Local/private plugins live under `<instance-home>/plugins/<id>/plugin.json` or a directory listed in `SABLE_PLUGIN_PATHS`.

Local plugin ids must start with `local-` unless `SABLE_ALLOW_PLUGIN_SHADOWS` explicitly permits a shadow. That keeps a friend’s plugin from silently replacing an upstream integration after a pull.

Create a local plugin:

```bash
npm run plugin:create -- --id local-hello --target local
```

Create an upstreamable plugin:

```bash
npm run plugin:create -- --id useful-plugin --target repo
```

Plugin API v1 exposes manifest metadata, command registration, config lookup, logger, reply helper, diagnostics hook, and instance paths. It intentionally does not expose mutable bridge globals.

## Tests

For plugin work:

```bash
npm run test:plugins
```

For shareability and contributor-facing checks:

```bash
npm run test:community
```

For migration-critical safety before merging:

```bash
npm run test:smoke
```

## Upgrades

Check before pulling:

```bash
npm run upgrade:check
```

Apply a guarded fast-forward update:

```bash
npm run upgrade
```

The upgrade flow refuses dirty repo state, fast-forwards from upstream, runs checks, and restarts the user service only after checks pass. It does not overwrite instance state or local plugins.

## PR Hygiene

- Keep private data out of tracked files.
- Run `npm run shareability:check` before PRs.
- Put reusable plugin fixes upstream; put personal behavior in local plugins or private instance memory.
- Update docs and tests with behavior changes.
- Do not make `bridge.js` a landfill. Add or reuse a boundary module when behavior belongs to a subsystem.
