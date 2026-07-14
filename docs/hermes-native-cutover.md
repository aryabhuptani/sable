# Hermes Native Cutover

This is the Sable migration path after Arya approved full Signal account cutover to Hermes.

Rollback note: as of 2026-07-03, this migration is paused. The active local
Signal setup is the Codex-backed `signal-codex-bridge.service`; `signal-cli-http.service`
is disabled/inactive and `hermes-sable-native` is stopped. Treat the rest of
this document as the preserved Hermes migration runbook, not current runtime
state, until Arya explicitly resumes the migration.

## Target

Hermes owns Signal receive/send directly. Sable keeps only the local tools, skills, memory conventions, and selected integrations that still matter.

## Explicitly Retired

- Sable slash-command parity.
- Sable scheduler parity.
- Sable `/ops` parity.
- Dual receive-loop duplication safety.

## Parity Gate

The current migration gate is defined in:

- `tools/hermes-migration/hermes-parity-matrix.json`
- `tools/hermes-migration/hermes-parity-check.js`

Run:

```bash
npm run hermes:parity -- --summary
npm run test:hermes-parity
```

The live cutover is not complete until the required checks in that matrix have evidence.

## Current Local Runtime

As of 2026-07-02, the local runtime is:

- `signal-codex-bridge.service`: disabled and stopped. This is the retired legacy Signal owner.
- `signal-codex-bridge-restart.service`: disabled and stopped. This watcher must stay stopped or it will restart the retired bridge after repo edits. Tiny bureaucratic trapdoor, naturally.
- `signal-cli-http.service`: enabled user service. Runs `signal-cli daemon --http 127.0.0.1:8080` using the existing Signal account from the bridge env.
- `hermes-sable-native`: Docker container running `ghcr.io/nimblecoai/hermes-agent:latest` with host networking, `HERMES_HOME=/opt/data`, and the copied Sable Hermes profile mounted at `/opt/data`.
- Hermes profile mounts:
  - `/home/arya/domains:/home/arya/domains:ro`
  - `/home/arya/domains/shared/skills:/home/arya/domains/shared/skills:ro`
  - `/home/arya/domains/coding/projects/sable:/home/arya/domains/coding/projects/sable:ro`
  - `/home/arya/homeassistant:/home/arya/homeassistant:ro`

The older `hermes-sable-trial` container is stopped and should be treated as superseded by `hermes-sable-native`.

## Verified So Far

- Hermes Signal gateway connects to the local Signal HTTP daemon; logs show `Signal SSE: connected`.
- `hermes send --to signal ...` sends through the configured Signal home channel.
- Hermes cron fired a one-shot `--no-agent` canary and delivered through the live Signal adapter.
- Home Assistant read-only state is accessible inside the Hermes container through `tools/hermes-migration/hermes-ha-readonly.sh summary`.
- Hermes MCP is available, but no MCP servers are configured yet.

Still requiring live phone/OAuth canaries:

- inbound Signal DM text and follow-up/session behavior
- image attachment
- PDF/document attachment
- incoming voice note transcription
- Gmail read through Hermes-native MCP/OAuth
- Calendar create/delete through Hermes-native MCP/OAuth

## Cutover Sequence

1. Confirm the Hermes-native runtime is installed and can run one local prompt.
2. Configure Hermes Signal gateway with the real Signal account and allowlist.
3. Stop the legacy Sable Signal bridge:

   ```bash
   systemctl --user stop signal-codex-bridge.service
   ```

4. Start Hermes gateway with Signal enabled.
5. Run required parity canaries:
   - Signal DM text
   - follow-up/session behavior
   - image attachment
   - PDF/document attachment
   - incoming voice note
   - Gmail read through Hermes-native auth
   - Calendar create/delete round trip through Hermes-native auth
   - Hermes cron canary
   - Home Assistant read-only local integration canary
6. Leave the old Sable bridge stopped once Hermes passes the gate.

## Rollback

If Hermes-native Signal cutover fails, stop Hermes Signal ownership and restart the old bridge:

```bash
docker stop hermes-sable-native
systemctl --user start signal-codex-bridge.service
```

If the old bridge is still configured with `SABLE_PRIMARY_RUNNER=hermes-cli`, it will continue to use Hermes only as a downstream CLI runner. Its `SABLE_HERMES_CONTAINER` is now pointed at `hermes-sable-native`. To roll all the way back to legacy Codex runner behavior, remove or change `SABLE_PRIMARY_RUNNER` to `codex-cli` in the bridge environment and restart the service.

## First Integration Port

Port Home Assistant as the first local integration. It is useful, low-risk in read-only mode, and already has a Sable CLI boundary that can be wrapped as a Hermes tool/skill without redesigning the rest of Sable.

The read-only wrapper is:

```bash
tools/hermes-migration/hermes-ha-readonly.sh summary
```
