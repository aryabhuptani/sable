# First User Handoff

Use release tag: `v0.1.0`

This page is intentionally short. The canonical install and upgrade instructions live elsewhere so we do not maintain three subtly different setup rituals. Subtle drift is how software grows little teeth.

## Start Here

Give the user or their setup agent these docs, in this order:

1. `README.md`
2. `docs/community-install.md`
3. `docs/upgrade.md`
4. `CONTRIBUTING.md`
5. `DEVELOPER_PREVIEW.md`

Recommended clone command:

```bash
git clone <sable-repo-url> ~/projects/sable
cd ~/projects/sable
git checkout v0.1.0
```

Then follow `docs/community-install.md`.

## Expected Rough Edges

- Signal account registration may need human verification.
- Codex CLI must already be installed and authenticated.
- Home Assistant, Telegram, calendar, and other integrations may require manual auth or local tokens.
- Local plugins are intentionally basic in `v0.1.0`.
- `main` may move faster than release tags; use `v0.1.0` for the first install.

## Feedback to Send Back

Ask first users to report:

- install step that failed
- host OS and Node/Python versions
- whether `npm run sable:doctor` passed
- whether `npm run shareability:check` passed before any PR
- which local plugins they needed
- which local changes should become upstream plugins or core fixes

## For Their Sable Instance

When their Sable improves itself, it should use these rules:

- core runtime fixes go to the repo
- reusable integrations go to repo `plugins/`
- personal integrations go to `<instance-home>/plugins/local-*`
- private memory, tasks, sessions, and secrets stay outside the repo
- behavior/policy lessons belong in instance memory first unless generally useful
- generally useful memory architecture or contribution heuristics should become docs, skills, or repo templates
- before PRs, run `npm run shareability:check` and the narrow relevant tests; before release refs, run `npm run test:community`
