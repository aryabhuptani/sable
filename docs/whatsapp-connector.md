# WhatsApp Browser Index Connector

Sable's WhatsApp connector is read-only and allowlist-first. A persistent Playwright/Chromium profile reads WhatsApp Web, while a local SQLite database provides durable history, incremental checkpoints, full-text search, attachment metadata, and export. It does not use Baileys, `whatsapp-web.js`, or Puppeteer, and it has no sending command.

## Install and one-time login

Install dependencies and the Chromium build from the repository:

```bash
npm install
npx playwright install chromium
npm run whatsapp:cli -- init-config
```

Edit the generated private allowlist at `<instance-home>/.config/sable/whatsapp-approved-chats.json`. Use exact chat titles initially; after a chat is indexed, prefer its stable WhatsApp id when one is available.

Open the persistent browser profile and scan WhatsApp's QR code:

```bash
npm run whatsapp:cli -- connect --headless false --wait
```

The profile lives under `<instance-home>/.local/state/sable-whatsapp/profile`. It contains browser credentials and must never be copied into the repository. Close other processes using this profile before starting a sync.
The connector enforces a single browser worker with a private PID lock. A live
worker is never displaced; a stale lock from a dead process is recovered safely.

## Normal operation

Run a bounded initial backfill:

```bash
npm run whatsapp:cli -- sync --until 2025-01-01T00:00:00Z --max-messages 10000 --max-scrolls 1000 --max-time-ms 1800000
```

Then schedule a conservative incremental sync, for example every 15 minutes:

```bash
npm run whatsapp:cli -- sync --max-messages 1000 --max-scrolls 100 --max-time-ms 300000
```

Each approved chat is located through WhatsApp's browser search, so it need not already be visible in the sidebar. The opened title is checked exactly before any message is indexed. Crawling stops on the existing oldest checkpoint, the requested timestamp, maximum messages, maximum scrolls, maximum elapsed time, or three scroll cycles without new messages. Upserts are idempotent, failures are isolated per chat, and every run records health in SQLite.

Useful local-only commands:

```bash
npm run whatsapp:cli -- status
npm run whatsapp:cli -- list-chats
npm run whatsapp:cli -- search --query '"flight details"' --limit 20
npm run whatsapp:cli -- search --query passport --chat CHAT_ID --json
npm run whatsapp:cli -- export-approved --out backup/whatsapp.json --format json
npm run whatsapp:cli -- export-approved --out backup/whatsapp.md --format markdown
npm run whatsapp:cli -- doctor
```

`triage` remains the `/whatsapp` plugin contract. It reads the local index and never opens a browser, so Signal review stays quick and does not trigger login or network access.
Recurring workflows must run `sync` first and check `doctor`; an unhealthy or
partial sync must never be treated as an empty inbox.

## State, backups, and recovery

By default, all mutable state is under `<instance-home>/.local/state/sable-whatsapp`:

- `profile/`: Chromium credentials and WhatsApp Web state.
- `messages.sqlite3`: the message index; SQLite may also create `-wal` and `-shm` files while running.
- `artifacts/`: screenshots, HTML, and selector diagnostics.

Override the root with `SABLE_WHATSAPP_STATE_DIR`, the database with `SABLE_WHATSAPP_DATABASE_PATH`, or the allowlist with `SABLE_WHATSAPP_APPROVED_CHATS_PATH`.

For a consistent database backup, stop sync jobs and copy `messages.sqlite3` together with any `-wal` and `-shm` files, or use SQLite's online backup tooling. Protect backups as private message data. The browser profile is optional to back up and especially sensitive; a fresh QR login can recreate it.

If authentication expires, run `connect --headless false --wait` again. If WhatsApp changes its DOM, `sync` fails without silently accepting an unrelated chat and writes a timestamped screenshot, page HTML, and selector inventory under `artifacts/`. Run `doctor`, inspect those artifacts, and update the centralized selector fallbacks in `tools/whatsapp/selectors.js`. Do not delete the index during browser recovery.

## Known limitations

- WhatsApp Web virtualizes history. Backfill is deliberately bounded and completeness must be validated; deleted/expired messages or history unavailable to WhatsApp Web cannot be recovered.
- DOM-exposed timestamps may be locale-dependent. The normalizer handles machine timestamps and the common `HH:MM, DD/MM/YYYY` form; unknown forms remain nullable rather than inventing a time.
- Stable DOM message ids are preferred. When WhatsApp omits one, Sable derives a deterministic content hash, which can merge truly identical messages with identical metadata.
- Attachment metadata is indexed when exposed in the DOM; attachment bodies are not downloaded.
- Browser search uses exact approved titles as a fallback. Duplicate titles should be replaced with stable ids after validation.
- Full-text search uses SQLite FTS5 when available and falls back to substring search otherwise.
- Sending, reactions, deletion, archiving, and other WhatsApp actions are intentionally absent.

## Validate against real approved chats

After login, validate with one small approved direct chat and one approved group:

1. Run `doctor` and confirm Playwright, state permissions, schema version, and FTS status.
2. Run a small sync with `--max-messages 100 --max-scrolls 10 --max-time-ms 60000`.
3. Compare the newest and oldest indexed timestamps and several message bodies with WhatsApp Web.
4. Search for a distinctive phrase and confirm the correct chat, sender, timestamp, and attachment metadata.
5. Run the same sync again and confirm counts do not grow from duplicates and the known checkpoint stops the crawl.
6. Export JSON and verify only allowlisted chats appear.
7. Temporarily use a nonexistent approved title and confirm a diagnostic screenshot/HTML is created and no other chat is indexed.

Live validation is intentionally not part of automated tests; tests use DOM and adapter fixtures and require no WhatsApp credentials.
