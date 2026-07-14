# Domain Maintenance Loop

The old memory-eval loop has been folded into domain maintenance.

The maintenance loop should inspect `AGENTS.md`, `/home/arya/domains/`, and `/home/arya/domains/shared/skills/`, then make at most one low-risk generalizable improvement per pass.

Metrics and architecture notes should live under:

- `/home/arya/domains/orchestrator/projects/domain-architecture/`
