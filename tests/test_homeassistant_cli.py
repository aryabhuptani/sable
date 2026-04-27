import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = "/home/arya/projects/sable/tools/homeassistant/homeassistant_cli.py"
SPEC = importlib.util.spec_from_file_location("homeassistant_cli", MODULE_PATH)
homeassistant_cli = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = homeassistant_cli
SPEC.loader.exec_module(homeassistant_cli)


class HomeAssistantCliTests(unittest.TestCase):
    def test_normalize_time_accepts_short_and_long_forms(self):
        self.assertEqual(homeassistant_cli.normalize_time("8:05"), "08:05:00")
        self.assertEqual(homeassistant_cli.normalize_time("08:05:09"), "08:05:09")

    def test_normalize_time_rejects_bad_values(self):
        with self.assertRaises(RuntimeError):
            homeassistant_cli.normalize_time("25:00")

    def test_build_trigger_requires_exactly_one_mode(self):
        with self.assertRaises(RuntimeError):
            homeassistant_cli.build_trigger(time_value=None, sun_event=None, offset="00:00:00")
        with self.assertRaises(RuntimeError):
            homeassistant_cli.build_trigger(
                time_value="09:00", sun_event="sunset", offset="00:00:00"
            )

    def test_build_automation_id_slugifies_alias(self):
        self.assertEqual(
            homeassistant_cli.build_automation_id("Living Room Sunset"),
            "sable_living_room_sunset",
        )

    def test_build_state_trigger(self):
        trigger = homeassistant_cli.build_state_trigger(
            entity_id="person.arya",
            to_state="home",
            from_state="not_home",
            for_duration=None,
        )
        self.assertEqual(
            trigger,
            {
                "trigger": "state",
                "entity_id": "person.arya",
                "to": "home",
                "from": "not_home",
            },
        )

    def test_add_and_remove_managed_schedule_round_trip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            automations_file = root / "automations.yaml"
            automations_file.write_text("[]\n", encoding="utf-8")
            empty_storage = root / ".storage"
            empty_storage.mkdir()

            paths = homeassistant_cli.HomeAssistantPaths(
                config_dir=root,
                automations_file=automations_file,
                scenes_file=root / "scenes.yaml",
                area_registry=empty_storage / "core.area_registry",
                device_registry=empty_storage / "core.device_registry",
                entity_registry=empty_storage / "core.entity_registry",
                restore_state=empty_storage / "core.restore_state",
                person_registry=empty_storage / "person",
            )
            cli = homeassistant_cli.HomeAssistantCli(paths=paths, url="http://127.0.0.1:8123", token="")

            create_result = cli.add_managed_service_schedule(
                alias="Evening lights",
                domain="scene",
                service="turn_on",
                data={"entity_id": "scene.evening"},
                time_value="18:30",
                sun_event=None,
                offset="00:00:00",
            )
            self.assertEqual(create_result["automation"]["id"], "sable_evening_lights")

            automations = cli.list_automations()
            self.assertEqual(len(automations), 1)
            self.assertTrue(automations[0]["managed_by_sable"])
            self.assertEqual(automations[0]["trigger_summary"], ["time:18:30:00"])

            remove_result = cli.remove_automation(automation_id="sable_evening_lights", alias=None)
            self.assertEqual(remove_result["removed"]["id"], "sable_evening_lights")
            self.assertEqual(cli.list_automations(), [])

    def test_add_state_service_automation_round_trip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            automations_file = root / "automations.yaml"
            automations_file.write_text("[]\n", encoding="utf-8")
            empty_storage = root / ".storage"
            empty_storage.mkdir()

            paths = homeassistant_cli.HomeAssistantPaths(
                config_dir=root,
                automations_file=automations_file,
                scenes_file=root / "scenes.yaml",
                area_registry=empty_storage / "core.area_registry",
                device_registry=empty_storage / "core.device_registry",
                entity_registry=empty_storage / "core.entity_registry",
                restore_state=empty_storage / "core.restore_state",
                person_registry=empty_storage / "person",
            )
            cli = homeassistant_cli.HomeAssistantCli(paths=paths, url="http://127.0.0.1:8123", token="")

            cli.add_managed_state_service_automation(
                alias="Arrive home lamp",
                trigger_entity_id="person.arya",
                to_state="home",
                from_state="not_home",
                for_duration=None,
                domain="light",
                service="turn_on",
                data={"entity_id": "light.smart_bulb"},
            )

            automations = cli.list_automations()
            self.assertEqual(len(automations), 1)
            self.assertEqual(
                automations[0]["trigger_summary"],
                ["state:person.arya:not_home->home"],
            )


if __name__ == "__main__":
    unittest.main()
