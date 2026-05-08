from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping


DEFAULT_HOME_DIR = "/home/arya"
DEFAULT_REPO_ROOT = str(Path(__file__).resolve().parents[2])


@dataclass(frozen=True)
class InstanceConfig:
    home_dir: str
    repo_root: str
    memory_root: str
    knowledge_root: str
    research_root: str
    autotweet_root: str
    signal_bridge_dir: str
    tasks_root: str
    skills_root: str
    agents_path: str
    todo_path: str
    project_knowledge_root: str
    project_tasks_path: str
    default_scheduler_jobs_path: str
    scheduler_jobs_path: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


def _resolve(value: str | os.PathLike[str]) -> str:
    return str(Path(value).expanduser().resolve(strict=False))


def _env_value(env: Mapping[str, str], key: str) -> str:
    return env.get(key) or ""


def create_instance_config(
    *,
    repo_root: str | os.PathLike[str] = DEFAULT_REPO_ROOT,
    home_dir: str | os.PathLike[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> InstanceConfig:
    active_env = os.environ if env is None else env

    resolved_home_dir = _resolve(
        home_dir
        or _env_value(active_env, "SABLE_INSTANCE_HOME")
        or _env_value(active_env, "SABLE_HOME")
        or DEFAULT_HOME_DIR
    )
    resolved_repo_root = _resolve(_env_value(active_env, "SABLE_REPO_ROOT") or repo_root)
    memory_root = _resolve(
        _env_value(active_env, "SABLE_MEMORY_ROOT") or Path(resolved_home_dir) / "memory"
    )
    knowledge_root = _resolve(
        _env_value(active_env, "SABLE_KNOWLEDGE_ROOT") or Path(memory_root) / "knowledge"
    )
    tasks_root = _resolve(_env_value(active_env, "SABLE_TASKS_ROOT") or Path(memory_root) / "tasks")
    skills_root = _resolve(
        _env_value(active_env, "SABLE_SKILLS_ROOT") or Path(resolved_home_dir) / "skills"
    )
    research_root = _resolve(
        _env_value(active_env, "SABLE_RESEARCH_ROOT") or Path(knowledge_root) / "research"
    )
    autotweet_root = _resolve(
        _env_value(active_env, "SABLE_AUTOTWEET_ROOT")
        or Path(knowledge_root) / "projects" / "sable" / "autotweet"
    )
    signal_bridge_dir = _resolve(
        _env_value(active_env, "SABLE_SIGNAL_BRIDGE_DIR")
        or Path(resolved_repo_root) / "apps" / "signal-bridge"
    )
    agents_path = _resolve(
        _env_value(active_env, "SABLE_AGENTS_PATH") or Path(resolved_home_dir) / "AGENTS.md"
    )
    todo_path = _resolve(
        _env_value(active_env, "SABLE_TODO_PATH") or Path(resolved_home_dir) / "TODO.md"
    )
    project_knowledge_root = _resolve(
        _env_value(active_env, "SABLE_PROJECT_KNOWLEDGE_ROOT")
        or Path(knowledge_root) / "projects" / "sable"
    )
    project_tasks_path = _resolve(
        _env_value(active_env, "SABLE_PROJECT_TASKS_PATH")
        or Path(tasks_root) / "projects" / "sable" / "TODO.md"
    )
    scheduler_jobs_path = _resolve(
        _env_value(active_env, "SABLE_SCHEDULER_JOBS_PATH")
        or Path(tasks_root) / "projects" / "sable" / "scheduler-jobs.json"
    )
    default_scheduler_jobs_path = _resolve(
        _env_value(active_env, "SABLE_DEFAULT_SCHEDULER_JOBS_PATH")
        or Path(tasks_root) / "projects" / "sable" / "default-scheduler-jobs.json"
    )

    return InstanceConfig(
        home_dir=resolved_home_dir,
        repo_root=resolved_repo_root,
        memory_root=memory_root,
        knowledge_root=knowledge_root,
        research_root=research_root,
        autotweet_root=autotweet_root,
        signal_bridge_dir=signal_bridge_dir,
        tasks_root=tasks_root,
        skills_root=skills_root,
        agents_path=agents_path,
        todo_path=todo_path,
        project_knowledge_root=project_knowledge_root,
        project_tasks_path=project_tasks_path,
        default_scheduler_jobs_path=default_scheduler_jobs_path,
        scheduler_jobs_path=scheduler_jobs_path,
    )


def redact_instance_path(
    value: str | os.PathLike[str] | None,
    *,
    home_dir: str | os.PathLike[str] = DEFAULT_HOME_DIR,
) -> str:
    normalized = str(value or "")
    resolved_home_dir = _resolve(home_dir or DEFAULT_HOME_DIR)

    if normalized == resolved_home_dir:
        return "~"
    home_prefix = f"{resolved_home_dir}{os.sep}"
    if normalized.startswith(home_prefix):
        return f"~{normalized[len(resolved_home_dir):]}"

    return re.sub(r"^/home/[^/]+", "~", normalized)
