import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


MODULE_PATH = "/home/arya/projects/sable/tools/homeassistant/humidifier_low_water_signal.py"
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
                mock.patch.object(humidifier_low_water_signal, "STATE_PATH", state_path),
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

            self.assertIn('"active": false', state_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
