# Sable Agent Employees V1

Sable employees are same-codebase Sable instances with isolated state and runtime boundaries. They are not separate agent products, forks, or bespoke mini-services.

## Architecture

Parent Sable remains the top-level orchestrator:

- receives Arya's normal Signal messages
- receives Mattermost messages when Mattermost is enabled
- owns the employee registry
- creates, starts, stops, inspects, and edits employees
- can read every employee log

Each employee:

- runs the same `/home/arya/domains/coding/projects/sable` codebase
- has a durable `AGENTS.md`, profile, tasks, schedule, connector policy, state, and logs
- runs as `SABLE_INSTANCE_MODE=employee`
- gets its own Codex/Claude runner home
- communicates through Mattermost
- runs in a Docker container for context and filesystem isolation

## State

Default employee state lives under the instance memory root:

```text
<instance-home>/memory/agents/
  registry.json
  <employee-id>/
    AGENTS.md
    PROFILE.md
    TASKS.md
    SCHEDULE.json
    CONNECTORS.json
    STATE.json
    LOG.md
    logs/
      runs/
      mattermost.jsonl
      scheduler.jsonl
    memory/
      knowledge/
      tasks/
```

Default runner/container state lives outside the memory vault:

```text
<instance-home>/.sable/employees/<employee-id>/
  codex-home/
  claude-home/
  container-home/
  mattermost-token
  runtime/
```

## Runtime

V1 treats "long-running" as durable identity plus restartable runs, scheduled ticks, and Mattermost-visible continuity. It does not require an immortal LLM process.

Employee runs should use Docker with:

- read-only mount of the Sable repo
- writable mount of the employee state directory
- writable mount of the employee runner home
- explicit environment allowlist
- optional worktree mount for code-editing tasks

## Codex Auth Bootstrap

Employee Codex homes are isolated, but they still need a narrow auth bootstrap
before they can run Codex. The runtime can copy approved files from the parent
Codex home into each employee Codex home before a run:

```text
SABLE_EMPLOYEE_CODEX_CREDENTIAL_SOURCE=/home/arya/.codex-bridge
SABLE_EMPLOYEE_CODEX_CREDENTIAL_FILES=auth.json,config.toml,installation_id
```

Only relative file names are accepted. Missing files are skipped. This is the
first credential-source pattern; later connectors should use the same idea with
explicit allowlists instead of handing employees the whole parent environment.

## Transport

Mattermost is added beside Signal. Inbound messages from both transports normalize into an internal envelope with transport/source metadata. Parent Sable may use one session across Signal and Mattermost; employee Sables should use separate sessions to avoid context pollution.

Each employee should have its own Mattermost bot account and token. Store the
token at the employee runtime path `mattermost-token` and keep only the token
path plus Mattermost user/channel metadata in the employee registry. The parent
Sable bot may create channels and coordinate setup, but employee run completions
should post through the employee's own Mattermost identity.

## Credential Policy

V1 supports simple connector modes:

- `disabled`: no external connector credentials
- `shared`: use parent-approved shared connector credentials
- `env-allowlist`: pass only explicitly named environment variables
- `isolated`: reserved for later per-employee OAuth

Full per-employee OAuth is not part of V1.

## Acceptance

V1 is done when Arya can:

- create an employee from Signal or Mattermost
- give it a task
- see its Mattermost updates
- inspect its logs through parent Sable
- schedule a recurring employee task
- restart Sable without losing employee identity/state
