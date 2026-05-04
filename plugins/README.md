# Sable Plugin Manifests

This directory is the first migration step toward a public `sable-plugins` registry.

For now, these manifests are descriptive. They declare the existing integrations, their capabilities, their required configuration/secrets, and their diagnostic hooks without moving implementation code yet.

The boundary rule is simple:

- `plugins/*/plugin.json` describes reusable integration behavior.
- Existing implementation stays where it is until the manifest is valid and covered by smoke tests.
- Private instance state, secrets, phone numbers, OAuth state, chat history, and Arya-specific paths do not belong in plugin manifests.

Run:

```bash
npm run test:plugins
npm run test:smoke
```
