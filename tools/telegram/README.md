# Telegram Triage Tooling

This directory holds Sable's Telegram-first communications tooling.

Current scope:
- authenticate a local Telethon session for Arya's user account
- inspect recent dialogs on the minipc
- bucket them into queue-clearing categories
- send explicit messages and optional attachments when Arya asks for that step

## Setup

1. Create Telegram API credentials at `https://my.telegram.org`.
2. Export:
   - `SABLE_TELEGRAM_API_ID`
   - `SABLE_TELEGRAM_API_HASH`
   - `SABLE_TELEGRAM_PHONE`
   Or place them in `tools/telegram/.env`, which is ignored by git.
3. Install Telethon:

```bash
python3 -m pip install telethon
```

4. Check readiness:

```bash
npm run telegram:cli -- doctor
```

5. Authorize the session:

```bash
npm run telegram:cli -- login
```

6. Review the queue:

```bash
npm run telegram:cli -- triage --limit 30
```

7. Send a message explicitly:

```bash
npm run telegram:cli -- send --target "Mitchell Amador | Immunefi" --message "hey, just following up here"
```

8. Send a message with attachments:

```bash
npm run telegram:cli -- send --target "@mitchella" --message "sending this over now" --file /abs/path/to/file.pdf
```

## Notes

- Session state defaults to `<SABLE_INSTANCE_HOME>/.local/state/sable-telegram/telethon.session` (`/home/arya/.local/state/sable-telegram/telethon.session` for Arya's current instance). Set `SABLE_TELEGRAM_SESSION_PATH` to override it directly.
- Target matching currently accepts dialog title, username, or numeric dialog id from recent dialogs.
- The next layer should be integrating thread-level draft assistance and then a Signal-facing approval/send flow so Arya can review proposed replies from Signal before they are sent.
