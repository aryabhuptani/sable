# Daily Memory Eval Loop

The memory eval loop measures whether Sable can find and use memory correctly as the instance grows.

It is intentionally small:

1. Run a few memory capability probes.
2. Score retrieval and application.
3. Pick the worst failure.
4. Make one low-risk improvement that generalizes.
5. Log the score and the change.

## Score

Each eval is scored from 0 to 3:

- `0`: missed memory entirely
- `1`: found vague or stale memory
- `2`: found the canonical source
- `3`: found the canonical source and applied it correctly

The main metric is:

```text
memory_use_score = total_points / max_points
```

Track secondary metrics when cheap:

- stale active files
- completed items still in active directories
- broken local links
- oversized active notes without summaries
- repeated failures by capability type

## Eval Shape

```yaml
id: source-of-truth-sable-tasks
capability_type: source_of_truth_recovery
prompt: "Where does Sable track active Sable project work?"
expected_sources:
  - memory/tasks/projects/sable/TODO.md
  - memory/knowledge/projects/sable/STATUS.md
expected_behavior:
  - distinguish active tasks from archive/history
  - point to the canonical task file first
```

## Capability Types

- `source_of_truth_recovery`
- `procedure_activation`
- `current_state_recovery`
- `task_continuity`
- `research_synthesis_reuse`
- `staleness_detection`
- `contradiction_handling`
- `generalization_after_fix`

## Fix Protocol

Every failed eval asks:

> Is this a one-off missing link, or does it reveal a missing general convention?

Default remediation order:

1. Update architecture/protocol docs.
2. Update a template, index, or source-of-truth block.
3. Update a skill trigger or reusable procedure.
4. Make a one-off link/summary/archive fix.

Do not perform broad rewrites or deletion in the daily loop. Escalate risky changes to a task file.

## Default Schedule

New Sable instances include a silent default scheduled workflow, `default-memory-eval`, which runs daily after the conservative dreaming pass.

## Health Check Tool

The deterministic health check is:

```bash
npm run memory:health -- --write-dir memory/knowledge/projects/memory/metrics
```

It reports:

- completed autoresearch runs still under `active/`
- stale active files
- oversized active files without summaries
- broken local markdown/wiki links
- missing memory architecture files

The daily eval loop should read this report before choosing its one low-risk improvement.
