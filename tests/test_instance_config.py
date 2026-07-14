import importlib.util
import pathlib
import sys
import unittest


MODULE_PATH = pathlib.Path("/home/arya/domains/coding/projects/sable/tools/instance/instance_config.py")
SPEC = importlib.util.spec_from_file_location("instance_config", MODULE_PATH)
instance_config = importlib.util.module_from_spec(SPEC)
sys.modules["instance_config"] = instance_config
assert SPEC.loader is not None
SPEC.loader.exec_module(instance_config)


class InstanceConfigTests(unittest.TestCase):
    def test_defaults_match_current_arya_layout(self):
        config = instance_config.create_instance_config(env={})

        self.assertEqual(config.home_dir, "/home/arya")
        self.assertEqual(config.repo_root, "/home/arya/domains/coding/projects/sable")
        self.assertEqual(config.domains_root, "/home/arya/domains")
        self.assertEqual(config.shared_root, "/home/arya/domains/shared")
        self.assertEqual(config.orchestrator_root, "/home/arya/domains/orchestrator")
        self.assertEqual(config.coding_root, "/home/arya/domains/coding")
        self.assertEqual(config.research_domain_root, "/home/arya/domains/research")
        self.assertEqual(config.work_root, "/home/arya/domains/work")
        self.assertEqual(config.ops_root, "/home/arya/domains/ops")
        self.assertEqual(config.memory_root, "/home/arya/domains/orchestrator/legacy/memory")
        self.assertEqual(config.knowledge_root, "/home/arya/domains/orchestrator/legacy/memory/knowledge")
        self.assertEqual(config.research_root, "/home/arya/domains/research/projects")
        self.assertEqual(
            config.autotweet_root,
            "/home/arya/domains/orchestrator/projects/autotweet",
        )
        self.assertEqual(
            config.signal_bridge_dir,
            "/home/arya/domains/coding/projects/sable/apps/signal-bridge",
        )
        self.assertEqual(config.tasks_root, "/home/arya/domains/orchestrator/legacy/memory/tasks")
        self.assertEqual(config.skills_root, "/home/arya/domains/shared/skills")
        self.assertEqual(config.agents_path, "/home/arya/AGENTS.md")
        self.assertEqual(config.todo_path, "/home/arya/TODO.md")
        self.assertEqual(
            config.project_knowledge_root,
            "/home/arya/domains/coding/projects/sable/knowledge",
        )
        self.assertEqual(
            config.project_tasks_path,
            "/home/arya/domains/coding/projects/sable/TASKS.md",
        )
        self.assertEqual(
            config.scheduler_jobs_path,
            "/home/arya/domains/orchestrator/schedules/scheduler-jobs.json",
        )
        self.assertEqual(
            config.default_scheduler_jobs_path,
            "/home/arya/domains/orchestrator/schedules/default-scheduler-jobs.json",
        )
        self.assertEqual(
            config.scheduler_state_path,
            "/home/arya/domains/orchestrator/schedules/scheduler-state.json",
        )

    def test_supports_non_arya_env_overrides(self):
        config = instance_config.create_instance_config(
            repo_root="/opt/sable",
            env={
                "SABLE_INSTANCE_HOME": "/srv/alex",
                "SABLE_DOMAINS_ROOT": "/domains/alex",
                "SABLE_REPO_ROOT": "/srv/sable-core",
                "SABLE_MEMORY_ROOT": "/data/alex/memory",
                "SABLE_KNOWLEDGE_ROOT": "/data/alex/knowledge",
                "SABLE_RESEARCH_ROOT": "/data/alex/research",
                "SABLE_AUTOTWEET_ROOT": "/data/alex/autotweet",
                "SABLE_SIGNAL_BRIDGE_DIR": "/srv/alex/signal-bridge",
                "SABLE_TASKS_ROOT": "/data/alex/tasks",
                "SABLE_SKILLS_ROOT": "/data/alex/skills",
                "SABLE_AGENTS_PATH": "/srv/alex/AGENTS.custom.md",
                "SABLE_TODO_PATH": "/srv/alex/TODO.custom.md",
                "SABLE_PROJECT_KNOWLEDGE_ROOT": "/data/alex/projects/sable/knowledge",
                "SABLE_PROJECT_TASKS_PATH": "/data/alex/projects/sable/tasks.md",
                "SABLE_DEFAULT_SCHEDULER_JOBS_PATH": "/data/alex/projects/sable/default-scheduler.json",
                "SABLE_SCHEDULER_JOBS_PATH": "/data/alex/projects/sable/scheduler.json",
                "SABLE_SCHEDULER_STATE_PATH": "/data/alex/projects/sable/scheduler-state.json",
            },
        )

        self.assertEqual(config.home_dir, "/srv/alex")
        self.assertEqual(config.repo_root, "/srv/sable-core")
        self.assertEqual(config.domains_root, "/domains/alex")
        self.assertEqual(config.orchestrator_root, "/domains/alex/orchestrator")
        self.assertEqual(config.coding_root, "/domains/alex/coding")
        self.assertEqual(config.memory_root, "/data/alex/memory")
        self.assertEqual(config.knowledge_root, "/data/alex/knowledge")
        self.assertEqual(config.research_root, "/data/alex/research")
        self.assertEqual(config.autotweet_root, "/data/alex/autotweet")
        self.assertEqual(config.signal_bridge_dir, "/srv/alex/signal-bridge")
        self.assertEqual(config.tasks_root, "/data/alex/tasks")
        self.assertEqual(config.skills_root, "/data/alex/skills")
        self.assertEqual(config.agents_path, "/srv/alex/AGENTS.custom.md")
        self.assertEqual(config.todo_path, "/srv/alex/TODO.custom.md")
        self.assertEqual(
            config.project_knowledge_root,
            "/data/alex/projects/sable/knowledge",
        )
        self.assertEqual(config.project_tasks_path, "/data/alex/projects/sable/tasks.md")
        self.assertEqual(
            config.default_scheduler_jobs_path,
            "/data/alex/projects/sable/default-scheduler.json",
        )
        self.assertEqual(config.scheduler_jobs_path, "/data/alex/projects/sable/scheduler.json")
        self.assertEqual(config.scheduler_state_path, "/data/alex/projects/sable/scheduler-state.json")

    def test_explicit_home_dir_wins_over_env_home(self):
        config = instance_config.create_instance_config(
            home_dir="/tmp/sable-user",
            env={"SABLE_INSTANCE_HOME": "/srv/ignored"},
        )

        self.assertEqual(config.home_dir, "/tmp/sable-user")
        self.assertEqual(config.domains_root, "/tmp/sable-user/domains")
        self.assertEqual(config.memory_root, "/tmp/sable-user/domains/orchestrator/legacy/memory")

    def test_redacts_active_instance_home(self):
        self.assertEqual(
            instance_config.redact_instance_path(
                "/srv/alex/memory/tasks/TODO.md",
                home_dir="/srv/alex",
            ),
            "~/memory/tasks/TODO.md",
        )
        self.assertEqual(
            instance_config.redact_instance_path("/home/arya/.codex-bridge"),
            "~/.codex-bridge",
        )


if __name__ == "__main__":
    unittest.main()
