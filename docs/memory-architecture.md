# Sable Memory Architecture

Sable's memory is markdown-first. The source of truth is a small set of files and directories that can be read by humans, agents, scripts, and future Sable instances without a hosted database.

## Source Of Truth

| Memory kind | Canonical location | Purpose |
| --- | --- | --- |
| Durable norms | `AGENTS.md` | Identity, operating policy, broad behavior rules |
| Procedures | `skills/*/SKILL.md` | Reusable workflows and SOPs |
| Tasks | `memory/tasks/` | Active work, queues, blockers, next actions |
| Semantic knowledge | `memory/knowledge/` | Project context, research notes, stable facts |
| Research sources | `memory/knowledge/research/<topic>/raw/` | Raw inputs and processed provenance |
| Logs/audits | `memory/knowledge/**/LOG.md` or `logs/` | What happened, when, and why |
| Generated/background artifacts | `memory/tasks/projects/sable/background-jobs/` or project-specific output dirs | Durable evidence, not the first retrieval surface |

## Design Principles

- Keep markdown canonical; tools can index or render it, but should not become the only source of truth.
- Prefer a few high-quality indexes and summaries over storing more notes.
- Keep active files small enough to guide current action.
- Move completed history into progress/archive notes instead of leaving it in active task files.
- Promote repeated procedures into skills.
- Promote durable cross-task behavior rules into `AGENTS.md`.
- Mark or archive stale/superseded memory instead of leaving contradictory instructions live.
- Make improvements general before making one-off fixes.

## Project Memory Pattern

Every substantial project should have:

- code repo, if any: `projects/<project>/`
- task file: `memory/tasks/projects/<project>/TODO.md`
- knowledge/status area: `memory/knowledge/projects/<project>/`
- research area, if needed: `memory/knowledge/research/<topic>/`
- a short source-of-truth block linking the above

Recommended active task-file shape:

```md
# Project Tasks

## Source Of Truth

- Repo: `/path/to/repo`
- Status: `/path/to/STATUS.md`
- Knowledge: `/path/to/knowledge`
- Archive/progress: `/path/to/progress`

## In Progress

1. Current task
Current state: one short paragraph.
Next: one concrete action.

## Backlog

- [ ] Future work
```

## Memory Eval Loop

Sable should continuously improve memory through small eval-driven changes.

Each eval tests a reusable memory capability, not only a specific fact:

- source-of-truth recovery
- procedure activation
- current-state recovery
- task continuity
- research synthesis reuse
- staleness detection
- contradiction handling
- generalization after a fix

When an eval fails, prefer fixes in this order:

1. Improve the general memory protocol, template, or convention.
2. Improve an index, source-of-truth block, or skill trigger for a class of memory.
3. Make a specific note/link/summary fix only when the failure is truly local.

The daily loop should make at most one low-risk improvement per run.
