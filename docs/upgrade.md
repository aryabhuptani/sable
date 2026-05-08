# Upgrading Sable

Sable uses a guarded upgrade flow so upstream code can move forward without overwriting private instance state or local plugins.

For first users, start from a named release tag such as `v0.1.1`. Track `main` only if you are intentionally testing fast-moving development.

## Normal Flow

From the repo root:

```bash
npm run upgrade:check
npm run upgrade
```

`upgrade:check` reports:

- whether the repo has local edits
- which upstream branch is tracked
- whether upstream differs from local `HEAD`
- which files would change
- whether `npm install` would run
- what checks would run
- whether the user service would restart

`upgrade` performs the same flow for real:

1. refuse dirty repo state
2. fetch upstream
3. fast-forward pull
4. run `npm install` if package files changed
5. run the configured check level
6. restart the user service only if checks pass

## Smoke Levels

Use `--smoke-level` to control how much validation runs:

```bash
npm run upgrade:check -- --smoke-level plugins
npm run upgrade -- --smoke-level smoke
```

Supported values:

- `none`
- `doctor`
- `plugins`
- `community`
- `smoke`

The default is `community`.

## What Is Safe to Customize

Safe outside the repo:

- `<instance-home>/AGENTS.md`
- `<instance-home>/TODO.md`
- `<instance-home>/memory`
- `<instance-home>/skills`
- `<instance-home>/plugins/local-*`
- `<instance-home>/.codex`
- `<instance-home>/.codex-bridge`
- generated scheduler state
- Telegram and Signal sessions

Safe in repo only when ignored:

- `apps/signal-bridge/.env`
- `tools/telegram/.env`

Upstreamable:

- plugin manifests and official plugin handlers
- reusable bridge fixes
- tests
- docs
- install and diagnostic tooling

## Failed Upgrade Recovery

If `upgrade:check` reports local repo edits, commit or stash them first.

If `upgrade` fails before `git pull`, nothing changed.

If `upgrade` fails after pulling but before restarting the service, fix the repo and rerun checks:

```bash
npm run sable:doctor
npm run test:community
```

Then restart manually:

```bash
npm run service:restart
```

If a local plugin breaks after upstream changes, `/plugins` and `npm run sable:doctor` should show whether the issue is official or local. Local plugin fixes should stay under the instance home unless they are generally useful enough to PR upstream.

## Full Smoke

Run full smoke before sharing a handoff ref:

```bash
npm run test:smoke
```

Run shareability before pushing public-ish code:

```bash
npm run shareability:check
```
