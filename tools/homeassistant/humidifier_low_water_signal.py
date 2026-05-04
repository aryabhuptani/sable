#!/usr/bin/env python3
"""Queue a Signal refill reminder when bedroom humidity is too low but water is low."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime, time as clock_time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.homeassistant.homeassistant_plugin import create_home_assistant_plugin_config

HUMIDITY_ENTITY = "sensor.levoit_humidifier_humidity"
LOW_WATER_ENTITY = "binary_sensor.levoit_humidifier_low_water"
COOLDOWN_SECONDS = 6 * 60 * 60
SLEEP_START = clock_time(0, 15)
SLEEP_END = clock_time(9, 0)


TOKEN_SCRIPT = r"""
import json, time
from pathlib import Path
import jwt
data=json.loads(Path('/config/.storage/auth').read_text())['data']
owner_ids={u['id'] for u in data['users'] if u.get('is_owner') and u.get('is_active')}
rt=[t for t in data['refresh_tokens'] if t.get('user_id') in owner_ids and t.get('jwt_key')][-1]
now=int(time.time())
print(jwt.encode({'iss':rt['id'],'iat':now,'exp':now+int(rt.get('access_token_expiration') or 1800)}, rt['jwt_key'], algorithm='HS256'))
""".strip()


def bridge_dir() -> Path:
    return create_home_assistant_plugin_config().signal_bridge_dir


def ha_url() -> str:
    return create_home_assistant_plugin_config().url.rstrip("/")


def bridge_env_path() -> Path:
    return bridge_dir() / ".env"


def queue_pending_dir() -> Path:
    return bridge_dir() / ".attachment-queue" / "pending"


def state_path() -> Path:
    return create_home_assistant_plugin_config().low_water_state_path


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def signal_recipient() -> str:
    env = load_env(bridge_env_path())
    recipients = env.get("ALLOWED_NUMBERS") or env.get("ALLOWED_SENDERS") or ""
    for candidate in recipients.replace(",", " ").split():
        if candidate:
            return candidate
    raise RuntimeError("No Signal recipient found in signal bridge .env")


def get_token() -> str:
    result = subprocess.run(
        ["sudo", "docker", "exec", "-i", "homeassistant", "python3", "-c", TOKEN_SCRIPT],
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def get_states(token: str) -> dict[str, dict]:
    request = urllib.request.Request(
        f"{ha_url()}/api/states",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        states = json.load(response)
    return {state["entity_id"]: state for state in states}


def load_state() -> dict:
    path = state_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}


def save_state(state: dict) -> None:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def is_sleep_window(now: datetime | None = None) -> bool:
    current = (now or datetime.now()).time()
    if SLEEP_START < SLEEP_END:
        return SLEEP_START <= current < SLEEP_END
    return current >= SLEEP_START or current < SLEEP_END


def queue_signal(message: str, recipient: str) -> Path:
    pending_dir = queue_pending_dir()
    pending_dir.mkdir(parents=True, exist_ok=True)
    request_id = f"humidifier-low-water-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    path = pending_dir / f"{request_id}.json"
    payload = {
        "id": request_id,
        "recipient": recipient,
        "message": message,
        "files": [],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = get_token()
    states = get_states(token)
    humidity_raw = states.get(HUMIDITY_ENTITY, {}).get("state")
    low_water = states.get(LOW_WATER_ENTITY, {}).get("state") == "on"

    try:
        humidity = float(humidity_raw)
    except (TypeError, ValueError):
        print(f"humidity unavailable: {humidity_raw!r}")
        return 0

    state = load_state()
    now = time.time()

    if not is_sleep_window():
        if state.get("active"):
            state = {"active": False, "last_clear_at": now, "reason": "outside_sleep_window"}
            save_state(state)
        print(f"no alert outside sleep window: humidity={humidity:g}, low_water={low_water}")
        return 0

    if humidity >= 30 or not low_water:
        if state.get("active"):
            state = {"active": False, "last_clear_at": now}
            save_state(state)
        print(f"no alert: humidity={humidity:g}, low_water={low_water}")
        return 0

    last_alert = float(state.get("last_alert_at") or 0)
    if now - last_alert < COOLDOWN_SECONDS:
        print(f"cooldown: humidity={humidity:g}, low_water={low_water}")
        return 0

    message = (
        f"Bedroom humidity is down at {humidity:g}%, but the humidifier is low on water. "
        "Refill it when you can so I can bring the room back up."
    )
    if args.dry_run:
        print(f"would queue: {message}")
    else:
        queued = queue_signal(message, signal_recipient())
        print(f"queued Signal reminder: {queued}")

    state.update({"active": True, "last_alert_at": now, "last_humidity": humidity})
    save_state(state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
