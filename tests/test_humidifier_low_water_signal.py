import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "tools" / "homeassistant" / "humidifier_low_water_signal.py"
SPEC = importlib.util.spec_from_file_location("humidifier_low_water_signal", MODULE_PATH)
humidifier_low_water_signal = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = humidifier_low_water_signal
SPEC.loader.exec_module(humidifier_low_water_signal)


class HumidifierLowWaterSignalTests(unittest.TestCase):
    def test_outside_sleep_window_clears_active_alert_without_queuing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "state.json"
            state_path.write_text('{"active": true, "last_alert_at": 123}\n', encoding="utf-8")

            states = {
                humidifier_low_water_signal.HUMIDITY_ENTITY: {"state": "24"},
                humidifier_low_water_signal.LOW_WATER_ENTITY: {"state": "on"},
            }

            with (
                mock.patch.dict(
                    os.environ,
                    {"SABLE_HUMIDIFIER_LOW_WATER_STATE_PATH": str(state_path)},
                ),
                mock.patch.object(humidifier_low_water_signal, "get_token", return_value="token"),
                mock.patch.object(humidifier_low_water_signal, "get_states", return_value=states),
                mock.patch.object(humidifier_low_water_signal, "is_sleep_window", return_value=False),
                mock.patch.object(
                    humidifier_low_water_signal,
                    "signal_recipient",
                    side_effect=AssertionError("should not resolve Signal recipient"),
                ),
                mock.patch.object(sys, "argv", ["humidifier_low_water_signal.py"]),
            ):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(humidifier_low_water_signal.main(), 0)

            stored_state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertFalse(stored_state["active"])
            self.assertEqual(stored_state["reason"], "outside_sleep_window")

    def test_paths_follow_non_arya_instance_config(self):
        with mock.patch.dict(
            os.environ,
            {
                "SABLE_REPO_ROOT": "/srv/sable-core",
                "SABLE_SIGNAL_BRIDGE_DIR": "/srv/sable-core/bridge",
            },
            clear=True,
        ):
            self.assertEqual(
                humidifier_low_water_signal.bridge_env_path(),
                Path("/srv/sable-core/bridge/.env"),
            )
            self.assertEqual(
                humidifier_low_water_signal.queue_pending_dir(),
                Path("/srv/sable-core/bridge/.attachment-queue/pending"),
            )
            self.assertEqual(
                humidifier_low_water_signal.state_path(),
                Path("/srv/sable-core/.state/humidifier_low_water_signal.json"),
            )

    def test_direct_state_path_override_wins(self):
        with mock.patch.dict(
            os.environ,
            {
                "SABLE_REPO_ROOT": "/srv/sable-core",
                "SABLE_HUMIDIFIER_LOW_WATER_STATE_PATH": "/tmp/humidifier-state.json",
            },
            clear=True,
        ):
            self.assertEqual(
                humidifier_low_water_signal.state_path(),
                Path("/tmp/humidifier-state.json"),
            )

    def test_signal_recipient_reads_env_from_configured_bridge_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            bridge_dir = Path(temp_dir) / "signal-bridge"
            bridge_dir.mkdir()
            (bridge_dir / ".env").write_text('ALLOWED_NUMBERS="+15550001111"\n', encoding="utf-8")

            with mock.patch.dict(
                os.environ,
                {"SABLE_SIGNAL_BRIDGE_DIR": str(bridge_dir)},
                clear=True,
            ):
                self.assertEqual(humidifier_low_water_signal.signal_recipient(), "+15550001111")


if __name__ == "__main__":
    unittest.main()
