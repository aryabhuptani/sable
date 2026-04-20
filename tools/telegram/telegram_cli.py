#!/usr/bin/env python3
"""Read-first Telegram triage tooling for Sable.

This tool intentionally starts in a conservative mode:
- authenticate as Arya's Telegram user account via Telethon
- inspect recent dialogs locally on the minipc
- produce queue-clearing summaries and triage buckets
- avoid sending messages until the review workflow is proven useful

Environment:
- SABLE_TELEGRAM_API_ID
- SABLE_TELEGRAM_API_HASH
- SABLE_TELEGRAM_PHONE
- SABLE_TELEGRAM_SESSION_PATH (optional)
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import os
import pathlib
import shutil
from collections import defaultdict
from datetime import datetime, timedelta, timezone


DEFAULT_SESSION_PATH = "/home/arya/.local/state/sable-telegram/telethon.session"
DEFAULT_ENV_PATH = pathlib.Path(__file__).with_name(".env")
DEFAULT_DIRECT_REPLY_WINDOW_HOURS = 72
DEFAULT_ACTIVE_REPLY_WINDOW_HOURS = 24
SPAM_KEYWORDS = (
    "airdrop",
    "bonus",
    "casino",
    "copy trade",
    "dropshipping",
    "forex",
    "investment",
    "launchpool",
    "profit",
    "signal",
    "token sale",
    "whitelist",
)


@dataclasses.dataclass(slots=True)
class TelegramConfig:
    api_id: str | None
    api_hash: str | None
    phone: str | None
    session_path: pathlib.Path


@dataclasses.dataclass(slots=True)
class DialogSnapshot:
    title: str
    unread_count: int
    unread_mentions_count: int
    last_message_at: datetime | None
    snippet: str
    is_user: bool
    is_group: bool
    is_channel: bool
    is_bot: bool
    is_muted: bool
    archived: bool


def load_config() -> TelegramConfig:
    load_local_env(DEFAULT_ENV_PATH)
    session_path = pathlib.Path(
        os.environ.get("SABLE_TELEGRAM_SESSION_PATH", DEFAULT_SESSION_PATH)
    ).expanduser()
    return TelegramConfig(
        api_id=normalize_text(os.environ.get("SABLE_TELEGRAM_API_ID")),
        api_hash=normalize_text(os.environ.get("SABLE_TELEGRAM_API_HASH")),
        phone=normalize_text(os.environ.get("SABLE_TELEGRAM_PHONE")),
        session_path=session_path,
    )


def normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def load_local_env(env_path: pathlib.Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip("'").strip('"')


def has_required_config(config: TelegramConfig) -> bool:
    return bool(config.api_id and config.api_hash and config.phone)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def classify_dialog(
    dialog: DialogSnapshot,
    *,
    now: datetime | None = None,
    direct_reply_window_hours: int = DEFAULT_DIRECT_REPLY_WINDOW_HOURS,
    active_reply_window_hours: int = DEFAULT_ACTIVE_REPLY_WINDOW_HOURS,
) -> str:
    """Return one of: now, today, low, spam."""
    now = now or utc_now()

    if looks_like_spam(dialog):
        return "spam"

    age = age_timedelta(dialog.last_message_at, now)
    within_direct_window = age is not None and age <= timedelta(hours=direct_reply_window_hours)
    within_active_window = age is not None and age <= timedelta(hours=active_reply_window_hours)

    if dialog.unread_mentions_count > 0:
        return "now"

    if dialog.unread_count > 0 and dialog.is_user and within_direct_window:
        return "now"

    if dialog.unread_count >= 3 and within_active_window:
        return "now"

    if dialog.unread_count > 0:
        return "today"

    if dialog.is_user and within_direct_window:
        return "today"

    if dialog.is_group and within_active_window:
        return "today"

    return "low"


def looks_like_spam(dialog: DialogSnapshot) -> bool:
    text = " ".join([dialog.title, dialog.snippet]).lower()
    keyword_hits = sum(1 for keyword in SPAM_KEYWORDS if keyword in text)
    if keyword_hits >= 2:
        return True
    if dialog.is_bot and dialog.unread_count > 0 and keyword_hits >= 1:
        return True
    if dialog.is_channel and dialog.unread_count >= 10 and keyword_hits >= 1:
        return True
    return False


def age_timedelta(then: datetime | None, now: datetime) -> timedelta | None:
    if then is None:
        return None
    normalized = then.astimezone(timezone.utc)
    return now - normalized


def format_relative_age(then: datetime | None, now: datetime | None = None) -> str:
    if then is None:
        return "unknown time"
    now = now or utc_now()
    delta = age_timedelta(then, now)
    if delta is None:
        return "unknown time"
    minutes = int(delta.total_seconds() // 60)
    if minutes < 60:
        return f"{max(minutes, 0)}m ago"
    hours = minutes // 60
    if hours < 48:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def truncate_text(value: str, limit: int = 140) -> str:
    normalized = " ".join(str(value or "").strip().split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def summarize_dialog(dialog: DialogSnapshot, now: datetime | None = None) -> str:
    unread_bits = []
    if dialog.unread_count:
        unread_bits.append(f"{dialog.unread_count} unread")
    if dialog.unread_mentions_count:
        unread_bits.append(f"{dialog.unread_mentions_count} mentions")
    unread_part = ", ".join(unread_bits) if unread_bits else "no unread"
    kind = (
        "direct"
        if dialog.is_user
        else "group"
        if dialog.is_group
        else "channel"
        if dialog.is_channel
        else "chat"
    )
    snippet = truncate_text(dialog.snippet or "(no preview)")
    return (
        f"{dialog.title} [{kind}; {unread_part}; {format_relative_age(dialog.last_message_at, now)}]"
        f" — {snippet}"
    )


def format_triage_report(dialogs: list[DialogSnapshot], now: datetime | None = None) -> str:
    now = now or utc_now()
    buckets: dict[str, list[DialogSnapshot]] = defaultdict(list)
    for dialog in dialogs:
        buckets[classify_dialog(dialog, now=now)].append(dialog)

    ordered_sections = [
        ("now", "Needs reply now"),
        ("today", "Should reply today"),
        ("low", "Low-priority / can wait"),
        ("spam", "Spam / likely noise"),
    ]
    lines = []
    total = len(dialogs)
    lines.append(f"Telegram queue review: {total} dialog{'s' if total != 1 else ''}")
    for bucket_key, heading in ordered_sections:
        bucket = buckets.get(bucket_key, [])
        lines.append("")
        lines.append(f"{heading}: {len(bucket)}")
        if not bucket:
            lines.append("- none")
            continue
        for dialog in sorted(
            bucket,
            key=lambda item: (
                -(item.unread_mentions_count or 0),
                -(item.unread_count or 0),
                item.last_message_at or datetime.fromtimestamp(0, tz=timezone.utc),
            ),
            reverse=False,
        ):
            lines.append(f"- {summarize_dialog(dialog, now=now)}")
    return "\n".join(lines)


def ensure_session_parent(session_path: pathlib.Path) -> None:
    session_path.parent.mkdir(parents=True, exist_ok=True)


def import_telethon():
    try:
        from telethon import TelegramClient  # type: ignore
        from telethon.errors import SessionPasswordNeededError  # type: ignore
    except ModuleNotFoundError as error:  # pragma: no cover - exercised indirectly in doctor
        raise SystemExit(
            "Telethon is not installed. Install it with:\n"
            "python3 -m pip install telethon"
        ) from error
    return TelegramClient, SessionPasswordNeededError


async def build_client(config: TelegramConfig):
    TelegramClient, _ = import_telethon()
    ensure_session_parent(config.session_path)
    return TelegramClient(str(config.session_path), int(config.api_id), config.api_hash)


async def command_doctor(args: argparse.Namespace) -> int:
    config = load_config()
    telethon_path = shutil.which("python3")
    dependency_ok = True
    dependency_error = None
    try:
        import_telethon()
    except SystemExit as error:
        dependency_ok = False
        dependency_error = str(error)

    payload = {
        "configured": {
            "api_id": bool(config.api_id),
            "api_hash": bool(config.api_hash),
            "phone": bool(config.phone),
        },
        "has_required_config": has_required_config(config),
        "session_path": str(config.session_path),
        "session_exists": config.session_path.exists(),
        "python3": telethon_path,
        "telethon_ready": dependency_ok,
    }
    if dependency_error:
        payload["telethon_error"] = dependency_error
    print(json.dumps(payload, indent=2))
    return 0


async def command_login(args: argparse.Namespace) -> int:
    config = load_config()
    if not has_required_config(config):
        raise SystemExit(
            "Missing Telegram config. Set SABLE_TELEGRAM_API_ID, "
            "SABLE_TELEGRAM_API_HASH, and SABLE_TELEGRAM_PHONE first."
        )

    _, SessionPasswordNeededError = import_telethon()
    client = await build_client(config)
    await client.connect()
    try:
        if await client.is_user_authorized():
            print(f"Telegram session already authorized at {config.session_path}.")
            return 0

        await client.send_code_request(config.phone)
        code = args.code or input("Telegram login code: ").strip()
        password = args.password
        try:
            await client.sign_in(phone=config.phone, code=code)
        except SessionPasswordNeededError:
            if not password:
                password = input("Telegram 2FA password: ").strip()
            await client.sign_in(password=password)

        print(f"Telegram session authorized and stored at {config.session_path}.")
        return 0
    finally:
        await client.disconnect()


async def fetch_dialogs(config: TelegramConfig, limit: int) -> list[DialogSnapshot]:
    if not has_required_config(config):
        raise SystemExit(
            "Missing Telegram config. Set SABLE_TELEGRAM_API_ID, "
            "SABLE_TELEGRAM_API_HASH, and SABLE_TELEGRAM_PHONE first."
        )
    client = await build_client(config)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise SystemExit(
                "Telegram session is not authorized yet. Run:\n"
                "python3 tools/telegram/telegram_cli.py login"
            )

        snapshots: list[DialogSnapshot] = []
        async for dialog in client.iter_dialogs(limit=limit, ignore_pinned=False):
            entity = dialog.entity
            title = (
                dialog.name
                or getattr(entity, "title", None)
                or getattr(entity, "first_name", None)
            )
            snippet = ""
            if dialog.message is not None:
                snippet = getattr(dialog.message, "message", None) or getattr(
                    dialog.message, "raw_text", ""
                )
            snapshots.append(
                DialogSnapshot(
                    title=truncate_text(title or "Untitled chat", 80),
                    unread_count=int(dialog.unread_count or 0),
                    unread_mentions_count=int(dialog.unread_mentions_count or 0),
                    last_message_at=getattr(dialog.message, "date", None),
                    snippet=snippet or "",
                    is_user=bool(getattr(entity, "bot", False) is False and dialog.is_user),
                    is_group=bool(dialog.is_group),
                    is_channel=bool(dialog.is_channel),
                    is_bot=bool(getattr(entity, "bot", False)),
                    is_muted=bool(
                        getattr(getattr(dialog, "dialog", None), "notify_settings", None)
                    ),
                    archived=bool(getattr(dialog, "folder_id", None) == 1),
                )
            )
        return snapshots
    finally:
        await client.disconnect()


async def command_list_dialogs(args: argparse.Namespace) -> int:
    dialogs = await fetch_dialogs(load_config(), args.limit)
    now = utc_now()
    for dialog in dialogs:
        print(summarize_dialog(dialog, now=now))
    return 0


async def command_triage(args: argparse.Namespace) -> int:
    dialogs = await fetch_dialogs(load_config(), args.limit)
    print(format_triage_report(dialogs))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Telegram triage tooling for Sable.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("doctor", help="Show config/dependency/session readiness.")

    login_parser = subparsers.add_parser("login", help="Authorize the local Telegram session.")
    login_parser.add_argument("--code", help="Telegram one-time login code.")
    login_parser.add_argument("--password", help="Telegram 2FA password if enabled.")

    list_parser = subparsers.add_parser(
        "list-dialogs", help="Print recent dialogs with unread counts and snippets."
    )
    list_parser.add_argument("--limit", type=int, default=25)

    triage_parser = subparsers.add_parser(
        "triage", help="Bucket recent dialogs into reply/ignore queues."
    )
    triage_parser.add_argument("--limit", type=int, default=25)

    return parser


async def async_main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "doctor":
        return await command_doctor(args)
    if args.command == "login":
        return await command_login(args)
    if args.command == "list-dialogs":
        return await command_list_dialogs(args)
    if args.command == "triage":
        return await command_triage(args)
    parser.error(f"Unknown command {args.command}")
    return 2


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(async_main(argv))


if __name__ == "__main__":
    raise SystemExit(main())
