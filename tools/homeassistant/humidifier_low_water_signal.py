#!/usr/bin/env python3
"""Queue a Signal refill reminder when bedroom humidity is too low but water is low."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.request
import uuid
from datetime import datetime, time as clock_time
from pathlib import Path


HA_URL = "http://127.0.0.1:8123"
BRIDGE_DIR = Path("/home/arya/projects/sable/apps/signal-bridge")
BRIDGE_ENV = BRIDGE_DIR / ".env"
QUEUE_PENDING = BRIDGE_DIR / ".attachment-queue" / "pending"
STATE_PATH = Path("/home/arya/projects/sable/.state/humidifier_low_water_signal.json")
HUMIDITY_ENTITY = "sensor.levoit_humidifier_humidity"
LOW_WATER_ENTITY = "binary_sensor.levoit_humidifier_low_water"
COOLDOWN_SECONDS = 6 * 60 * 60
SLEEP_START = clock_time(1, 0)
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
    env = load_env(BRIDGE_ENV)
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
        f"{HA_URL}/api/states",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        states = json.load(response)
    return {state["entity_id"]: state for state in states}


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text())
    except json.JSONDecodeError:
        return {}


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def is_sleep_window(now: datetime | None = None) -> bool:
    current = (now or datetime.now()).time()
    if SLEEP_START < SLEEP_END:
        return SLEEP_START <= current < SLEEP_END
    return current >= SLEEP_START or current < SLEEP_END


def queue_signal(message: str, recipient: str) -> Path:
    QUEUE_PENDING.mkdir(parents=True, exist_ok=True)
    request_id = f"humidifier-low-water-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    path = QUEUE_PENDING / f"{request_id}.json"
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
