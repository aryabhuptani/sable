"""Home Assistant plugin runtime configuration for Sable."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from tools.instance.instance_config import InstanceConfig, create_instance_config

DEFAULT_URL = "http://127.0.0.1:8123"
DEFAULT_LOW_WATER_STATE_NAME = "humidifier_low_water_signal.json"


@dataclass(frozen=True)
class HomeAssistantPluginConfig:
    config_dir: Path
    automations_file: Path
    scenes_file: Path
    url: str
    token: str
    signal_bridge_dir: Path
    low_water_state_path: Path


def create_home_assistant_plugin_config(
    *,
    env: Mapping[str, str] | None = None,
    instance_config: InstanceConfig | None = None,
) -> HomeAssistantPluginConfig:
    active_env = os.environ if env is None else env
    active_instance = instance_config or create_instance_config(env=active_env)

    config_dir = Path(
        active_env.get("SABLE_HOME_ASSISTANT_CONFIG_DIR")
        or active_env.get("HOME_ASSISTANT_CONFIG_DIR")
        or Path(active_instance.home_dir) / "homeassistant"
    )
    automations_file = Path(
        active_env.get("SABLE_HOME_ASSISTANT_AUTOMATIONS_FILE")
        or config_dir / "automations.yaml"
    )
    scenes_file = Path(
        active_env.get("SABLE_HOME_ASSISTANT_SCENES_FILE")
        or config_dir / "scenes.yaml"
    )
    low_water_state_path = Path(
        active_env.get("SABLE_HUMIDIFIER_LOW_WATER_STATE_PATH")
        or Path(active_instance.repo_root) / ".state" / DEFAULT_LOW_WATER_STATE_NAME
    )
    url = (
        active_env.get("SABLE_HOME_ASSISTANT_URL")
        or active_env.get("HOME_ASSISTANT_URL")
        or DEFAULT_URL
    )
    token = (
        active_env.get("SABLE_HOME_ASSISTANT_TOKEN")
        or active_env.get("HOME_ASSISTANT_TOKEN")
        or ""
    ).strip()

    return HomeAssistantPluginConfig(
        config_dir=config_dir,
        automations_file=automations_file,
        scenes_file=scenes_file,
        url=url,
        token=token,
        signal_bridge_dir=Path(active_instance.signal_bridge_dir),
        low_water_state_path=low_water_state_path,
    )
