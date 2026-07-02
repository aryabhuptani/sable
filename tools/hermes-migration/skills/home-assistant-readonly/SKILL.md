---
name: home-assistant-readonly
description: Use when Hermes needs to inspect Arya's local Home Assistant state through Sable's existing read-only Home Assistant CLI during the Sable-to-Hermes migration.
---

# Home Assistant Read-Only Skill

This skill is the first Sable local-integration port for Hermes-native migration.
It intentionally exposes only read-only Home Assistant inspection commands.

## Commands

Run from the Sable repo:

```bash
cd /home/arya/projects/sable
tools/hermes-migration/hermes-ha-readonly.sh summary
tools/hermes-migration/hermes-ha-readonly.sh list-areas
tools/hermes-migration/hermes-ha-readonly.sh list-devices
tools/hermes-migration/hermes-ha-readonly.sh list-entities
tools/hermes-migration/hermes-ha-readonly.sh list-scenes
tools/hermes-migration/hermes-ha-readonly.sh list-automations
```

Useful filters:

```bash
tools/hermes-migration/hermes-ha-readonly.sh list-entities --domain light
tools/hermes-migration/hermes-ha-readonly.sh list-entities --domain climate
tools/hermes-migration/hermes-ha-readonly.sh list-devices --area bedroom
```

## Guardrails

- Do not call `activate-scene`, `call-service`, `add-*`, `remove-automation`, or `reload-automations` for the initial Hermes parity canary.
- Summarize state plainly and mention when a value comes from local Home Assistant registries rather than the live API.
- Do not print Home Assistant tokens or config file contents.

## Parity Canary

The required canary for `local.homeassistant.readonly` is:

```bash
cd /home/arya/projects/sable
tools/hermes-migration/hermes-ha-readonly.sh summary
```

Hermes passes the canary when it can run that command and answer a Signal prompt with a concise status summary grounded in the JSON output.
