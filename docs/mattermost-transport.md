# Mattermost Transport

Mattermost is a second chat transport for Sable. Signal stays the personal control channel; Mattermost becomes the shared bus for parent Sable, Arya, and employee Sable instances.

## Configuration

```text
MATTERMOST_ENABLED=false
MATTERMOST_BASE_URL=https://mattermost.example.com
MATTERMOST_TOKEN=example-token
MATTERMOST_TEAM=example-team
MATTERMOST_PARENT_CHANNEL=sable-control
MATTERMOST_DM_USER_IDS=user-id-1,user-id-2
MATTERMOST_CURSOR_PATH=/path/to/mattermost-cursors.json
```

Tokens must be redacted from logs, `/ops`, `/plugins`, and doctor output.

## Normalized Message

Transport modules should emit this internal shape:

```json
{
  "transport": "mattermost",
  "conversationId": "channel-id",
  "sender": "user-id-or-username",
  "text": "message text",
  "attachments": [],
  "receivedAt": "2026-05-28T00:00:00.000Z",
  "raw": {}
}
```

Signal can be adapted into the same envelope later. The first Mattermost boundary should not break existing Signal behavior.

## V1 Identity

V1 can use one Mattermost bot token with employee-prefixed messages:

```text
[researcher] I finished the source scan.
[reviewer] This patch has one risky scheduler edge case.
```

Per-employee bot accounts are a later improvement if account creation/token handling is easy enough.

Parent Sable can also poll direct-message channels with specific users. Set
`MATTERMOST_DM_USER_IDS` to the allowed Mattermost user ids and keep
`MATTERMOST_ALLOWED_USERS` scoped to the same ids. The transport resolves the
bot/user DM channel at startup and routes replies back to that DM conversation.

The transport persists per-channel poll cursors at `MATTERMOST_CURSOR_PATH` so
bridge restarts do not replay older Mattermost posts. When a channel is first
watched and no cursor exists, the cursor starts at bridge startup time; this
avoids treating historical channel setup messages as fresh user requests.
