# Telegram Triage Tooling

This directory holds Sable's Telegram-first communications tooling.

Current scope:
- authenticate a local Telethon session for Arya's user account
- inspect recent dialogs on the minipc
- bucket them into queue-clearing categories
- stay read-only until the review workflow proves useful

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

## Notes

- Session state defaults to `/home/arya/.local/state/sable-telegram/telethon.session`.
- This is deliberately not sending messages yet.
- The next layer should be integrating the triage output into Signal-facing digests and thread-level draft assistance.
