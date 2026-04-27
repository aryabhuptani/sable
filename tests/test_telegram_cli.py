import importlib.util
import pathlib
import sys
import unittest
from datetime import datetime, timedelta, timezone


MODULE_PATH = pathlib.Path("/home/arya/projects/sable/tools/telegram/telegram_cli.py")
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

    def test_classify_direct_promo_as_ignored(self):
        dialog = self.build_dialog(
            is_user=True,
            is_group=False,
            unread_count=1,
            snippet="Came across your project and caught our attention. Open to chatting about exchange listing support?",
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


if __name__ == "__main__":
    unittest.main()
