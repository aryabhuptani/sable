#!/usr/bin/env python3
"""Local Home Assistant helper for Sable.

This CLI uses local Home Assistant storage for inventory-style reads and the
Home Assistant HTTP API for live actions when a reachable URL/token are
configured.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


DEFAULT_CONFIG_DIR = Path("/home/arya/homeassistant")
DEFAULT_URL = "http://127.0.0.1:8123"
SABLE_MANAGED_DESCRIPTION = "Managed by Sable homeassistant-cli"


@dataclass(frozen=True)
class HomeAssistantPaths:
    config_dir: Path
    automations_file: Path
    scenes_file: Path
    area_registry: Path
    device_registry: Path
    entity_registry: Path
    restore_state: Path
    person_registry: Path


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    cli = HomeAssistantCli.from_env()

    try:
        result = dispatch(cli, args)
    except Exception as error:  # pragma: no cover - top-level error path
        print(str(error), file=sys.stderr)
        return 1

    if result is None:
        return 0

    output = format_output(result, args.output)
    sys.stdout.write(f"{output}\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Local Home Assistant helper for Sable."
    )
    parser.add_argument(
        "--output",
        choices=["json", "text"],
        default="json",
        help="Output format. Defaults to json.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("summary", help="Summarize local HA state and API reachability.")
    subparsers.add_parser("list-areas", help="List Home Assistant areas.")

    devices = subparsers.add_parser("list-devices", help="List devices from local registries.")
    devices.add_argument("--area", help="Filter by area name or area id.")
    devices.add_argument("--include-deleted", action="store_true")

    entities = subparsers.add_parser("list-entities", help="List entities from local registries.")
    entities.add_argument("--area", help="Filter by area name or area id.")
    entities.add_argument("--domain", help="Filter by entity domain such as light or climate.")
    entities.add_argument("--device-id", help="Filter by Home Assistant device id.")
    entities.add_argument(
        "--conversation-exposed",
        action="store_true",
        help="Only include entities explicitly exposed to HA conversation.",
    )

    subparsers.add_parser("list-scenes", help="List scenes from local files and registries.")
    subparsers.add_parser("list-automations", help="List automations from automations.yaml.")

    activate_scene = subparsers.add_parser("activate-scene", help="Activate a scene via the HA API.")
    activate_scene.add_argument("--entity-id", required=True)
    activate_scene.add_argument("--transition", type=float)

    call_service = subparsers.add_parser("call-service", help="Call an HA service via the API.")
    call_service.add_argument("--domain", required=True)
    call_service.add_argument("--service", required=True)
    call_service.add_argument(
        "--data",
        default="{}",
        help="JSON object payload for the service call.",
    )

    add_scene_schedule = subparsers.add_parser(
        "add-scene-schedule",
        help="Create a Sable-managed automation that activates a scene on a schedule.",
    )
    add_scene_schedule.add_argument("--alias", required=True)
    add_scene_schedule.add_argument("--scene-entity-id", required=True)
    add_scene_schedule.add_argument("--time", help="Time trigger in HH:MM or HH:MM:SS.")
    add_scene_schedule.add_argument("--event", choices=["sunrise", "sunset"])
    add_scene_schedule.add_argument(
        "--offset",
        default="00:00:00",
        help="Sun offset like +00:15:00 or -00:30:00. Used only with --event.",
    )
    add_scene_schedule.add_argument("--transition", type=float)
    add_scene_schedule.add_argument("--reload", action="store_true")

    add_service_schedule = subparsers.add_parser(
        "add-service-schedule",
        help="Create a Sable-managed automation that calls a service on a schedule.",
    )
    add_service_schedule.add_argument("--alias", required=True)
    add_service_schedule.add_argument("--domain", required=True)
    add_service_schedule.add_argument("--service", required=True)
    add_service_schedule.add_argument(
        "--data",
        default="{}",
        help="JSON object payload for the automation action.",
    )
    add_service_schedule.add_argument("--time", help="Time trigger in HH:MM or HH:MM:SS.")
    add_service_schedule.add_argument("--event", choices=["sunrise", "sunset"])
    add_service_schedule.add_argument(
        "--offset",
        default="00:00:00",
        help="Sun offset like +00:15:00 or -00:30:00. Used only with --event.",
    )
    add_service_schedule.add_argument("--reload", action="store_true")

    add_state_service = subparsers.add_parser(
        "add-state-service-automation",
        help="Create a Sable-managed automation that calls a service on an entity state transition.",
    )
    add_state_service.add_argument("--alias", required=True)
    add_state_service.add_argument("--trigger-entity-id", required=True)
    add_state_service.add_argument("--to-state", required=True)
    add_state_service.add_argument("--from-state")
    add_state_service.add_argument("--for-duration")
    add_state_service.add_argument("--domain", required=True)
    add_state_service.add_argument("--service", required=True)
    add_state_service.add_argument(
        "--data",
        default="{}",
        help="JSON object payload for the automation action.",
    )
    add_state_service.add_argument("--reload", action="store_true")

    add_arrival_light = subparsers.add_parser(
        "add-arrival-light-automation",
        help="Create a Sable-managed automation that turns on a light when a person arrives home.",
    )
    add_arrival_light.add_argument("--alias", required=True)
    add_arrival_light.add_argument("--person-entity-id", required=True)
    add_arrival_light.add_argument("--light-entity-id", required=True)
    add_arrival_light.add_argument("--from-state", default="not_home")
    add_arrival_light.add_argument("--brightness-pct", type=int)
    add_arrival_light.add_argument("--transition", type=float)
    add_arrival_light.add_argument("--reload", action="store_true")

    remove_automation = subparsers.add_parser(
        "remove-automation",
        help="Remove an automation from automations.yaml by id or alias.",
    )
    remove_automation.add_argument("--id")
    remove_automation.add_argument("--alias")
    remove_automation.add_argument("--reload", action="store_true")

    subparsers.add_parser(
        "reload-automations",
        help="Ask Home Assistant to reload automations via the API.",
    )
    return parser


def dispatch(cli: "HomeAssistantCli", args: argparse.Namespace) -> Any:
    command = args.command
    if command == "summary":
        return cli.summary()
    if command == "list-areas":
        return cli.list_areas()
    if command == "list-devices":
        return cli.list_devices(area=args.area, include_deleted=args.include_deleted)
    if command == "list-entities":
        return cli.list_entities(
            area=args.area,
            domain=args.domain,
            device_id=args.device_id,
            conversation_exposed=args.conversation_exposed,
        )
    if command == "list-scenes":
        return cli.list_scenes()
    if command == "list-automations":
        return cli.list_automations()
    if command == "activate-scene":
        data: dict[str, Any] = {"entity_id": args.entity_id}
        if args.transition is not None:
            data["transition"] = args.transition
        return cli.call_service("scene", "turn_on", data)
    if command == "call-service":
        return cli.call_service(args.domain, args.service, parse_json_object(args.data, "--data"))
    if command == "add-scene-schedule":
        data = {"entity_id": args.scene_entity_id}
        if args.transition is not None:
            data["transition"] = args.transition
        result = cli.add_managed_service_schedule(
            alias=args.alias,
            domain="scene",
            service="turn_on",
            data=data,
            time_value=args.time,
            sun_event=args.event,
            offset=args.offset,
        )
        if args.reload:
            result["reload"] = cli.reload_automations()
        return result
    if command == "add-service-schedule":
        result = cli.add_managed_service_schedule(
            alias=args.alias,
            domain=args.domain,
            service=args.service,
            data=parse_json_object(args.data, "--data"),
            time_value=args.time,
            sun_event=args.event,
            offset=args.offset,
        )
        if args.reload:
            result["reload"] = cli.reload_automations()
        return result
    if command == "add-state-service-automation":
        result = cli.add_managed_state_service_automation(
            alias=args.alias,
            trigger_entity_id=args.trigger_entity_id,
            to_state=args.to_state,
            from_state=args.from_state,
            for_duration=args.for_duration,
            domain=args.domain,
            service=args.service,
            data=parse_json_object(args.data, "--data"),
        )
        if args.reload:
            result["reload"] = cli.reload_automations()
        return result
    if command == "add-arrival-light-automation":
        data: dict[str, Any] = {"entity_id": args.light_entity_id}
        if args.brightness_pct is not None:
            data["brightness_pct"] = args.brightness_pct
        if args.transition is not None:
            data["transition"] = args.transition
        result = cli.add_managed_state_service_automation(
            alias=args.alias,
            trigger_entity_id=args.person_entity_id,
            to_state="home",
            from_state=args.from_state,
            for_duration=None,
            domain="light",
            service="turn_on",
            data=data,
        )
        if args.reload:
            result["reload"] = cli.reload_automations()
        return result
    if command == "remove-automation":
        result = cli.remove_automation(automation_id=args.id, alias=args.alias)
        if args.reload:
            result["reload"] = cli.reload_automations()
        return result
    if command == "reload-automations":
        return cli.reload_automations()
    raise ValueError(f"Unsupported command: {command}")


class HomeAssistantCli:
    def __init__(self, paths: HomeAssistantPaths, url: str, token: str) -> None:
        self.paths = paths
        self.url = url.rstrip("/")
        self.token = token

    @classmethod
    def from_env(cls) -> "HomeAssistantCli":
        config_dir = Path(
            os.environ.get("SABLE_HOME_ASSISTANT_CONFIG_DIR")
            or os.environ.get("HOME_ASSISTANT_CONFIG_DIR")
            or DEFAULT_CONFIG_DIR
        )
        automations_file = Path(
            os.environ.get("SABLE_HOME_ASSISTANT_AUTOMATIONS_FILE")
            or config_dir / "automations.yaml"
        )
        scenes_file = Path(
            os.environ.get("SABLE_HOME_ASSISTANT_SCENES_FILE") or config_dir / "scenes.yaml"
        )
        storage_dir = config_dir / ".storage"
        paths = HomeAssistantPaths(
            config_dir=config_dir,
            automations_file=automations_file,
            scenes_file=scenes_file,
            area_registry=storage_dir / "core.area_registry",
            device_registry=storage_dir / "core.device_registry",
            entity_registry=storage_dir / "core.entity_registry",
            restore_state=storage_dir / "core.restore_state",
            person_registry=storage_dir / "person",
        )
        url = (
            os.environ.get("SABLE_HOME_ASSISTANT_URL")
            or os.environ.get("HOME_ASSISTANT_URL")
            or DEFAULT_URL
        )
        token = (
            os.environ.get("SABLE_HOME_ASSISTANT_TOKEN")
            or os.environ.get("HOME_ASSISTANT_TOKEN")
            or ""
        ).strip()
        return cls(paths=paths, url=url, token=token)

    def summary(self) -> dict[str, Any]:
        areas = self.list_areas()
        devices = self.list_devices()
        entities = self.list_entities()
        scenes = self.list_scenes()
        automations = self.list_automations()
        people = self.list_people()
        api_probe = self.api_probe()

        domains: dict[str, int] = {}
        for entity in entities:
            domain = entity["entity_id"].split(".", 1)[0]
            domains[domain] = domains.get(domain, 0) + 1

        return {
            "config_dir": str(self.paths.config_dir),
            "api": api_probe,
            "counts": {
                "areas": len(areas),
                "devices": len(devices),
                "entities": len(entities),
                "scenes": len(scenes),
                "automations": len(automations),
                "people": len(people),
            },
            "domains": domains,
            "areas": areas,
            "people": people,
            "notes": presence_notes(people),
        }

    def api_probe(self) -> dict[str, Any]:
        if not self.token:
            return {
                "configured": False,
                "reachable": False,
                "message": "Set SABLE_HOME_ASSISTANT_TOKEN and SABLE_HOME_ASSISTANT_URL for live actions.",
            }
        try:
            response = self.api_request("GET", "/api/")
            return {
                "configured": True,
                "reachable": True,
                "message": response.get("message", "API reachable."),
            }
        except Exception as error:
            return {
                "configured": True,
                "reachable": False,
                "message": str(error),
            }

    def list_areas(self) -> list[dict[str, Any]]:
        data = self.read_storage_json(self.paths.area_registry)
        items = data.get("data", {}).get("areas", [])
        return sorted(
            [
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "aliases": item.get("aliases", []),
                }
                for item in items
            ],
            key=lambda item: (item["name"] or "", item["id"] or ""),
        )

    def list_people(self) -> list[dict[str, Any]]:
        data = self.read_storage_json(self.paths.person_registry)
        items = data.get("data", {}).get("items", [])
        return [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "device_trackers": item.get("device_trackers", []),
            }
            for item in items
        ]

    def list_devices(self, area: str | None = None, include_deleted: bool = False) -> list[dict[str, Any]]:
        data = self.read_storage_json(self.paths.device_registry)
        area_map = self.area_map()
        items = list(data.get("data", {}).get("devices", []))
        if include_deleted:
            items.extend(data.get("data", {}).get("deleted_devices", []))
        area_filter = self.resolve_area_filter(area)
        normalized = []
        for item in items:
            item_area = item.get("area_id")
            if area_filter and item_area != area_filter:
                continue
            normalized.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "name_by_user": item.get("name_by_user"),
                    "area_id": item_area,
                    "area_name": area_map.get(item_area, ""),
                    "manufacturer": item.get("manufacturer"),
                    "model": item.get("model"),
                    "entry_type": item.get("entry_type"),
                    "identifiers": item.get("identifiers", []),
                    "labels": item.get("labels", []),
                }
            )
        return sorted(normalized, key=lambda item: (item["area_name"], item["name"] or "", item["id"] or ""))

    def list_entities(
        self,
        area: str | None = None,
        domain: str | None = None,
        device_id: str | None = None,
        conversation_exposed: bool = False,
    ) -> list[dict[str, Any]]:
        data = self.read_storage_json(self.paths.entity_registry)
        area_map = self.area_map()
        device_area_map = self.device_area_map()
        items = data.get("data", {}).get("entities", [])
        area_filter = self.resolve_area_filter(area)
        normalized: list[dict[str, Any]] = []
        for item in items:
            entity_id = item.get("entity_id") or ""
            item_domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
            if domain and item_domain != domain:
                continue
            item_device_id = item.get("device_id")
            if device_id and item_device_id != device_id:
                continue
            item_area = item.get("area_id") or device_area_map.get(item_device_id)
            if area_filter and item_area != area_filter:
                continue
            exposed = bool(
                item.get("options", {})
                .get("conversation", {})
                .get("should_expose", False)
            )
            if conversation_exposed and not exposed:
                continue
            normalized.append(
                {
                    "entity_id": entity_id,
                    "name": item.get("name") or item.get("original_name"),
                    "domain": item_domain,
                    "area_id": item_area,
                    "area_name": area_map.get(item_area, ""),
                    "device_id": item_device_id,
                    "disabled_by": item.get("disabled_by"),
                    "conversation_exposed": exposed,
                }
            )
        return sorted(
            normalized,
            key=lambda item: (
                item["area_name"],
                item["domain"],
                item["entity_id"],
            ),
        )

    def list_scenes(self) -> list[dict[str, Any]]:
        scenes: list[dict[str, Any]] = []
        scene_entities = self.list_entities(domain="scene")
        seen_entity_ids = set()
        for entity in scene_entities:
            entity_id = entity["entity_id"]
            seen_entity_ids.add(entity_id)
            scenes.append(
                {
                    "entity_id": entity_id,
                    "name": entity.get("name") or entity_id,
                    "source": "entity_registry",
                }
            )

        yaml_scenes = self.read_yaml_list(self.paths.scenes_file)
        for index, scene in enumerate(yaml_scenes):
            if not isinstance(scene, dict):
                continue
            scene_id = normalize_slug(scene.get("id") or "")
            entity_id = f"scene.{scene_id}" if scene_id else ""
            if entity_id and entity_id in seen_entity_ids:
                continue
            scenes.append(
                {
                    "entity_id": entity_id or None,
                    "name": scene.get("name") or scene_id or f"scene-{index + 1}",
                    "id": scene.get("id"),
                    "source": "scenes_yaml",
                }
            )
        return sorted(scenes, key=lambda item: (item.get("name") or "", item.get("entity_id") or ""))

    def list_automations(self) -> list[dict[str, Any]]:
        automations = self.read_yaml_list(self.paths.automations_file)
        normalized = []
        for index, automation in enumerate(automations):
            if not isinstance(automation, dict):
                continue
            description = automation.get("description") or ""
            normalized.append(
                {
                    "index": index,
                    "id": automation.get("id"),
                    "alias": automation.get("alias"),
                    "description": description,
                    "managed_by_sable": is_sable_managed(automation),
                    "trigger_summary": summarize_triggers(automation.get("triggers", [])),
                }
            )
        return normalized

    def call_service(self, domain: str, service: str, data: dict[str, Any]) -> Any:
        if not self.token:
            raise RuntimeError("Live service calls need SABLE_HOME_ASSISTANT_TOKEN and SABLE_HOME_ASSISTANT_URL.")
        return self.api_request("POST", f"/api/services/{domain}/{service}", data)

    def reload_automations(self) -> Any:
        return self.call_service("automation", "reload", {})

    def add_managed_service_schedule(
        self,
        *,
        alias: str,
        domain: str,
        service: str,
        data: dict[str, Any],
        time_value: str | None,
        sun_event: str | None,
        offset: str,
    ) -> dict[str, Any]:
        trigger = build_trigger(time_value=time_value, sun_event=sun_event, offset=offset)
        automations = self.read_yaml_list(self.paths.automations_file)
        automation_id = build_automation_id(alias)
        if any(str(item.get("id")) == automation_id for item in automations if isinstance(item, dict)):
            raise RuntimeError(f"Automation id already exists: {automation_id}")

        automation = {
            "id": automation_id,
            "alias": alias,
            "description": SABLE_MANAGED_DESCRIPTION,
            "triggers": [trigger],
            "conditions": [],
            "actions": [
                {
                    "action": f"{domain}.{service}",
                    "data": data,
                }
            ],
            "mode": "single",
        }
        automations.append(automation)
        self.write_yaml_list(self.paths.automations_file, automations)
        return {
            "ok": True,
            "automation": {
                "id": automation_id,
                "alias": alias,
                "trigger": trigger,
                "service": f"{domain}.{service}",
                "data": data,
            },
            "automations_file": str(self.paths.automations_file),
        }

    def add_managed_state_service_automation(
        self,
        *,
        alias: str,
        trigger_entity_id: str,
        to_state: str,
        from_state: str | None,
        for_duration: str | None,
        domain: str,
        service: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        trigger = build_state_trigger(
            entity_id=trigger_entity_id,
            to_state=to_state,
            from_state=from_state,
            for_duration=for_duration,
        )
        automations = self.read_yaml_list(self.paths.automations_file)
        automation_id = build_automation_id(alias)
        if any(str(item.get("id")) == automation_id for item in automations if isinstance(item, dict)):
            raise RuntimeError(f"Automation id already exists: {automation_id}")

        automation = {
            "id": automation_id,
            "alias": alias,
            "description": SABLE_MANAGED_DESCRIPTION,
            "triggers": [trigger],
            "conditions": [],
            "actions": [
                {
                    "action": f"{domain}.{service}",
                    "data": data,
                }
            ],
            "mode": "single",
        }
        automations.append(automation)
        self.write_yaml_list(self.paths.automations_file, automations)
        return {
            "ok": True,
            "automation": {
                "id": automation_id,
                "alias": alias,
                "trigger": trigger,
                "service": f"{domain}.{service}",
                "data": data,
            },
            "automations_file": str(self.paths.automations_file),
        }

    def remove_automation(self, *, automation_id: str | None, alias: str | None) -> dict[str, Any]:
        if not automation_id and not alias:
            raise RuntimeError("Pass --id or --alias.")
        automations = self.read_yaml_list(self.paths.automations_file)
        updated = []
        removed: dict[str, Any] | None = None
        for automation in automations:
            if not isinstance(automation, dict):
                updated.append(automation)
                continue
            matches = False
            if automation_id and str(automation.get("id")) == automation_id:
                matches = True
            if alias and str(automation.get("alias")) == alias:
                matches = True
            if matches and removed is None:
                removed = automation
                continue
            updated.append(automation)
        if removed is None:
            target = automation_id or alias
            raise RuntimeError(f"No automation matched: {target}")
        self.write_yaml_list(self.paths.automations_file, updated)
        return {
            "ok": True,
            "removed": {
                "id": removed.get("id"),
                "alias": removed.get("alias"),
                "managed_by_sable": is_sable_managed(removed),
            },
            "automations_file": str(self.paths.automations_file),
        }

    def api_request(self, method: str, path: str, data: dict[str, Any] | None = None) -> Any:
        body = None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        if data is not None:
            body = json.dumps(data).encode("utf-8")
        request = urllib.request.Request(
            f"{self.url}{path}",
            data=body,
            method=method,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Home Assistant API error {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"Home Assistant API request failed: {error.reason}") from error

        if not payload:
            return {}
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {"raw": payload}

    def area_map(self) -> dict[str, str]:
        return {item["id"]: item["name"] for item in self.list_areas() if item.get("id")}

    def device_area_map(self) -> dict[str, str]:
        return {item["id"]: item["area_id"] for item in self.list_devices() if item.get("id")}

    def resolve_area_filter(self, area: str | None) -> str | None:
        if not area:
            return None
        lookup = area.strip().lower()
        for item in self.list_areas():
            item_id = (item.get("id") or "").lower()
            item_name = (item.get("name") or "").lower()
            if lookup in {item_id, item_name}:
                return item.get("id")
        raise RuntimeError(f"Unknown area: {area}")

    def read_storage_json(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def read_yaml_list(self, path: Path) -> list[Any]:
        if not path.exists():
            return []
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return []
        data = yaml.safe_load(text)
        if data is None:
            return []
        if not isinstance(data, list):
            raise RuntimeError(f"Expected a YAML list in {path}")
        return data

    def write_yaml_list(self, path: Path, items: list[Any]) -> None:
        text = yaml.safe_dump(items, sort_keys=False, allow_unicode=False)
        path.write_text(text, encoding="utf-8")


def build_trigger(*, time_value: str | None, sun_event: str | None, offset: str) -> dict[str, Any]:
    if bool(time_value) == bool(sun_event):
        raise RuntimeError("Pass exactly one of --time or --event.")
    if time_value:
        return {
            "trigger": "time",
            "at": normalize_time(time_value),
        }
    return {
        "trigger": "sun",
        "event": sun_event,
        "offset": normalize_offset(offset),
    }


def build_state_trigger(
    *,
    entity_id: str,
    to_state: str,
    from_state: str | None,
    for_duration: str | None,
) -> dict[str, Any]:
    trigger = {
        "trigger": "state",
        "entity_id": entity_id.strip(),
        "to": to_state.strip(),
    }
    if not trigger["entity_id"]:
        raise RuntimeError("Trigger entity id cannot be empty.")
    if from_state and from_state.strip():
        trigger["from"] = from_state.strip()
    if for_duration and for_duration.strip():
        trigger["for"] = normalize_duration(for_duration)
    return trigger


def build_automation_id(alias: str) -> str:
    slug = normalize_slug(alias)
    if not slug:
        raise RuntimeError("Alias must contain at least one alphanumeric character.")
    return f"sable_{slug}"


def normalize_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    return slug.strip("_")


def normalize_time(value: str) -> str:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", value.strip())
    if not match:
        raise RuntimeError("Time must look like HH:MM or HH:MM:SS.")
    hour = int(match.group(1))
    minute = int(match.group(2))
    second = int(match.group(3) or "0")
    if hour > 23 or minute > 59 or second > 59:
        raise RuntimeError("Time is out of range.")
    return f"{hour:02d}:{minute:02d}:{second:02d}"


def normalize_offset(value: str) -> str:
    cleaned = value.strip() or "00:00:00"
    if not re.fullmatch(r"[+-]?\d{2}:\d{2}:\d{2}", cleaned):
        raise RuntimeError("Offset must look like +HH:MM:SS, -HH:MM:SS, or 00:00:00.")
    return cleaned


def normalize_duration(value: str) -> str:
    cleaned = value.strip()
    if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", cleaned):
        raise RuntimeError("Duration must look like HH:MM:SS.")
    return cleaned


def parse_json_object(raw: str, flag_name: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{flag_name} must be valid JSON: {error.msg}") from error
    if not isinstance(parsed, dict):
        raise RuntimeError(f"{flag_name} must be a JSON object.")
    return parsed


def is_sable_managed(automation: dict[str, Any]) -> bool:
    description = str(automation.get("description") or "")
    automation_id = str(automation.get("id") or "")
    return description.startswith(SABLE_MANAGED_DESCRIPTION) or automation_id.startswith("sable_")


def summarize_triggers(triggers: Any) -> list[str]:
    if not isinstance(triggers, list):
        return []
    summary = []
    for trigger in triggers:
        if not isinstance(trigger, dict):
            continue
        kind = trigger.get("trigger")
        if kind == "time":
            summary.append(f"time:{trigger.get('at')}")
        elif kind == "sun":
            summary.append(f"sun:{trigger.get('event')}:{trigger.get('offset', '00:00:00')}")
        elif kind == "state":
            summary.append(
                "state:"
                f"{trigger.get('entity_id')}:"
                f"{trigger.get('from', '*')}->"
                f"{trigger.get('to')}"
            )
        else:
            summary.append(kind or "unknown")
    return summary


def presence_notes(people: list[dict[str, Any]]) -> list[str]:
    if not people:
        return ["No people are configured in Home Assistant yet."]
    notes = []
    for person in people:
        trackers = person.get("device_trackers", [])
        if trackers:
            notes.append(f"{person.get('name')}: {len(trackers)} device tracker(s) attached.")
        else:
            notes.append(
                f"{person.get('name')}: no device trackers attached. GPS presence will need phone/device_tracker setup."
            )
    return notes


def format_output(result: Any, output_mode: str) -> str:
    if output_mode == "json":
        return json.dumps(result, indent=2, sort_keys=False)
    if isinstance(result, str):
        return result
    if isinstance(result, list):
        return "\n".join(json.dumps(item, sort_keys=False) for item in result)
    return json.dumps(result, sort_keys=False)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
