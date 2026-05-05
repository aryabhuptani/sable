# Sable Plugin Manifests

This directory is the first migration step toward a public `sable-plugins` registry.

Most official manifests are still descriptive. Local Node plugins can now register Signal commands through plugin API v1 by declaring `runtime.type = "node-module"` and `runtime.entry = "handler.js"`.

The boundary rule is simple:

- `plugins/*/plugin.json` describes reusable integration behavior.
- `<instance-home>/plugins/*/plugin.json` describes private local plugins.
- Local plugin ids should start with `local-` so they cannot silently shadow official plugins.
- Existing implementation stays where it is until the manifest is valid and covered by smoke tests.
- Private instance state, secrets, phone numbers, OAuth state, chat history, and Arya-specific paths do not belong in plugin manifests.

Create a local plugin:

```bash
npm run plugin:create -- --id local-hello --target local
```

Create an upstreamable official plugin scaffold:

```bash
npm run plugin:create -- --id my-plugin --target repo
```

Run:

```bash
npm run test:plugins
npm run test:smoke
```
