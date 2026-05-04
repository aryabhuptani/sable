import asyncio
import importlib.util
import os
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "tools" / "telegram" / "telegram_cli.py"
SPEC = importlib.util.spec_from_file_location("telegram_cli", MODULE_PATH)
telegram_cli = importlib.util.module_from_spec(SPEC)
sys.modules["telegram_cli"] = telegram_cli
assert SPEC.loader is not None
SPEC.loader.exec_module(telegram_cli)


class TelegramCliTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc)

    def build_dialog(self, **overrides):
        base = dict(
            title="Test Chat",
            dialog_id=12345,
            username="test_chat",
            unread_count=0,
            unread_mentions_count=0,
            last_message_at=self.now - timedelta(hours=1),
            snippet="normal message",
            last_message_outgoing=False,
            is_user=False,
            is_group=True,
            is_channel=False,
            is_bot=False,
            is_muted=False,
            archived=False,
        )
        base.update(overrides)
        return telegram_cli.DialogSnapshot(**base)

    def test_classify_direct_unread_as_now(self):
        dialog = self.build_dialog(is_user=True, is_group=False, unread_count=1)
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "now")

    def test_classify_recent_group_unread_as_today(self):
        dialog = self.build_dialog(unread_count=1, last_message_at=self.now - timedelta(hours=8))
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "today")

    def test_classify_keyword_heavy_bot_as_spam(self):
        dialog = self.build_dialog(
            is_group=False,
            is_user=False,
            is_bot=True,
            unread_count=4,
            snippet="Huge investment bonus signal for your launchpool profit",
        )
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_muted_chat_as_ignored(self):
        dialog = self.build_dialog(is_muted=True, unread_count=10)
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_old_chat_as_ignored(self):
        dialog = self.build_dialog(last_message_at=self.now - timedelta(days=9), unread_count=1)
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now, stale_days=7), "ignored")

    def test_classify_latest_outgoing_as_ignored(self):
        dialog = self.build_dialog(last_message_outgoing=True, is_user=True, is_group=False)
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_telegram_system_chat_as_ignored(self):
        dialog = self.build_dialog(title="Telegram", is_user=True, is_group=False)
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_central_lisbon_plug_as_ignored(self):
        dialog = self.build_dialog(
            title="Central Lisbon Plug ( OFFICIAL )",
            is_channel=True,
            is_group=False,
            unread_count=1,
            snippet="Wednesday special",
        )
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_direct_promo_as_ignored(self):
        dialog = self.build_dialog(
            is_user=True,
            is_group=False,
            unread_count=1,
            snippet="Came across your project and caught our attention. Open to chatting about exchange listing support?",
        )
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_exchange_delisting_as_ignored_even_in_group(self):
        dialog = self.build_dialog(
            is_user=False,
            is_group=True,
            unread_count=1,
            snippet="Heads up on upcoming exchange de-listings and listing changes.",
        )
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_direct_market_making_pitch_as_ignored(self):
        dialog = self.build_dialog(
            is_user=True,
            is_group=False,
            unread_count=1,
            snippet="Looking for affordable Market Making that keeps your token trading smoothly? Happy to run a free trial.",
        )
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_classify_compliment_only_as_ignored(self):
        dialog = self.build_dialog(
            is_user=True,
            is_group=False,
            unread_count=0,
            snippet="thats such a good tweet",
        )
        self.assertEqual(telegram_cli.classify_dialog(dialog, now=self.now), "ignored")

    def test_format_triage_report_groups_dialogs(self):
        dialogs = [
            self.build_dialog(title="Urgent DM", is_user=True, is_group=False, unread_count=2),
            self.build_dialog(title="Quiet Group", unread_count=0, last_message_at=self.now - timedelta(days=7)),
        ]
        report = telegram_cli.format_triage_report(dialogs, now=self.now)
        self.assertIn("Needs reply now: 1", report)
        self.assertIn("Low-priority / can wait: 1", report)
        self.assertIn("Urgent DM", report)

    def test_match_dialog_target_by_exact_title(self):
        dialogs = [
            self.build_dialog(title="Mitchell Amador | Immunefi", dialog_id=111),
            self.build_dialog(title="Other Chat", dialog_id=222),
        ]
        matched = telegram_cli.match_dialog_target(dialogs, "Mitchell Amador | Immunefi")
        self.assertEqual(matched.dialog_id, 111)

    def test_match_dialog_target_by_username(self):
        dialogs = [
            self.build_dialog(title="Mitchell", username="mitchella", dialog_id=333),
        ]
        matched = telegram_cli.match_dialog_target(dialogs, "@mitchella")
        self.assertEqual(matched.dialog_id, 333)

    def test_validate_attachment_paths_rejects_missing_file(self):
        with self.assertRaises(SystemExit):
            telegram_cli.validate_attachment_paths(["/tmp/definitely-missing-telegram-attachment.pdf"])

    def test_default_session_path_follows_instance_config(self):
        self.assertEqual(
            telegram_cli.default_telegram_session_path(env={}),
            "/home/arya/.local/state/sable-telegram/telethon.session",
        )
        self.assertEqual(
            telegram_cli.default_telegram_session_path(
                env={"SABLE_INSTANCE_HOME": "/srv/alex"}
            ),
            "/srv/alex/.local/state/sable-telegram/telethon.session",
        )
        self.assertEqual(
            telegram_cli.default_telegram_session_path(
                env={
                    "SABLE_INSTANCE_HOME": "/srv/alex",
                    "SABLE_TELEGRAM_SESSION_PATH": "/data/alex/telegram.session",
                }
            ),
            "/data/alex/telegram.session",
        )

    def test_load_config_uses_instance_session_default(self):
        original_env_path = telegram_cli.DEFAULT_ENV_PATH
        original_environ = dict(os.environ)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                telegram_cli.DEFAULT_ENV_PATH = pathlib.Path(temp_dir) / "missing.env"
                os.environ.clear()
                os.environ.update(
                    {
                        "SABLE_INSTANCE_HOME": "/srv/alex",
                        "SABLE_TELEGRAM_API_ID": "123",
                        "SABLE_TELEGRAM_API_HASH": "hash",
                        "SABLE_TELEGRAM_PHONE": "+15551112222",
                    }
                )
                config = telegram_cli.load_config()
        finally:
            telegram_cli.DEFAULT_ENV_PATH = original_env_path
            os.environ.clear()
            os.environ.update(original_environ)

        self.assertEqual(config.session_path, pathlib.Path("/srv/alex/.local/state/sable-telegram/telethon.session"))
        self.assertEqual(config.api_id, "123")
        self.assertEqual(config.api_hash, "hash")
        self.assertEqual(config.phone, "+15551112222")

    def test_mark_read_command_dispatches_with_limit(self):
        captured = {}
        original = telegram_cli.command_mark_read

        async def fake_mark_read(args):
            captured["command"] = args.command
            captured["limit"] = args.limit
            return 0

        telegram_cli.command_mark_read = fake_mark_read
        try:
            result = asyncio.run(telegram_cli.async_main(["mark-read", "--limit", "3"]))
        finally:
            telegram_cli.command_mark_read = original

        self.assertEqual(result, 0)
        self.assertEqual(captured, {"command": "mark-read", "limit": 3})


if __name__ == "__main__":
    unittest.main()
