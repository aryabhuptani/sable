import unittest
from pathlib import Path

from tools.homeassistant.homeassistant_plugin import create_home_assistant_plugin_config
from tools.instance.instance_config import create_instance_config


class HomeAssistantPluginConfigTests(unittest.TestCase):
    def test_defaults_follow_instance_config(self):
        env = {
            "SABLE_INSTANCE_HOME": "/srv/sable-user",
            "SABLE_REPO_ROOT": "/srv/sable-core",
            "SABLE_SIGNAL_BRIDGE_DIR": "/srv/sable-user/signal-bridge",
        }
        instance_config = create_instance_config(env=env)

        config = create_home_assistant_plugin_config(
            env=env,
            instance_config=instance_config,
        )

        self.assertEqual(config.config_dir, Path("/srv/sable-user/homeassistant"))
        self.assertEqual(
            config.automations_file,
            Path("/srv/sable-user/homeassistant/automations.yaml"),
        )
        self.assertEqual(config.scenes_file, Path("/srv/sable-user/homeassistant/scenes.yaml"))
        self.assertEqual(config.url, "http://127.0.0.1:8123")
        self.assertEqual(config.token, "")
        self.assertEqual(config.signal_bridge_dir, Path("/srv/sable-user/signal-bridge"))
        self.assertEqual(
            config.low_water_state_path,
            Path("/srv/sable-core/.state/humidifier_low_water_signal.json"),
        )

    def test_direct_home_assistant_overrides_win(self):
        env = {
            "SABLE_INSTANCE_HOME": "/srv/sable-user",
            "SABLE_REPO_ROOT": "/srv/sable-core",
            "SABLE_HOME_ASSISTANT_CONFIG_DIR": "/var/lib/homeassistant",
            "SABLE_HOME_ASSISTANT_AUTOMATIONS_FILE": "/tmp/automations.yaml",
            "SABLE_HOME_ASSISTANT_SCENES_FILE": "/tmp/scenes.yaml",
            "SABLE_HOME_ASSISTANT_URL": "http://ha.local:8123",
            "SABLE_HOME_ASSISTANT_TOKEN": " token ",
            "SABLE_HUMIDIFIER_LOW_WATER_STATE_PATH": "/tmp/humidifier-state.json",
        }

        config = create_home_assistant_plugin_config(env=env)

        self.assertEqual(config.config_dir, Path("/var/lib/homeassistant"))
        self.assertEqual(config.automations_file, Path("/tmp/automations.yaml"))
        self.assertEqual(config.scenes_file, Path("/tmp/scenes.yaml"))
        self.assertEqual(config.url, "http://ha.local:8123")
        self.assertEqual(config.token, "token")
        self.assertEqual(config.low_water_state_path, Path("/tmp/humidifier-state.json"))

    def test_legacy_home_assistant_env_aliases_still_work(self):
        env = {
            "SABLE_INSTANCE_HOME": "/srv/sable-user",
            "HOME_ASSISTANT_CONFIG_DIR": "/legacy/ha",
            "HOME_ASSISTANT_URL": "http://legacy-ha:8123",
            "HOME_ASSISTANT_TOKEN": "legacy-token",
        }

        config = create_home_assistant_plugin_config(env=env)

        self.assertEqual(config.config_dir, Path("/legacy/ha"))
        self.assertEqual(config.url, "http://legacy-ha:8123")
        self.assertEqual(config.token, "legacy-token")


if __name__ == "__main__":
    unittest.main()
