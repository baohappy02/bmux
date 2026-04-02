# Slice 01 - Milestone 1 Task Ops

Status: DONE

Branch: `spark/s01-task-ops`

Build tag: `spark-s01`

PR title: `Complete agent task logs cancel and run-many`

Suggested commit: `Add agent task logs cancel and run-many`

## Goal

This slice has already landed and is kept here as review history.

Close the remaining task-control gaps in Milestone 1:

1. `agent.task.logs`
2. `agent.task.cancel`
3. `agent.task.run_many`
4. CLI wrappers for all three

## In Scope

Server:

1. implement `agent.task.logs`
2. implement `agent.task.cancel`
3. implement `agent.task.run_many`
4. reuse existing `AgentTask`, `v2AgentTasks`, task log path, and event log

CLI:

1. add `bmux agent task logs`
2. add `bmux agent task cancel`
3. add `bmux agent task run-many`
4. update `bmux agent` help text

## Out Of Scope

1. `agent.state.summary`
2. `agent.artifact.list`
3. search
4. browser agent methods
5. app UI

## Expected Files

1. `Sources/TerminalController.swift`
2. `CLI/bmux.swift`

## Contract Requirements

### `agent.task.logs`

Support:

1. `mode: tail|delta|path-only`
2. bounded `lines`
3. bounded `bytes`
4. optional `cursor` for delta mode

Rules:

1. never dump the full log by default
2. prefer returning `log_path` plus a small tail
3. if no persisted log exists yet, fall back to terminal capture
4. return `cursor` so Codex can continue cheaply

### `agent.task.cancel`

Rules:

1. validate that the job belongs to the session
2. best effort stop the running terminal task without stealing app focus
3. mark the task as `cancelled`
4. emit `task.cancelled`
5. keep payload short

### `agent.task.run_many`

Rules:

1. accept a compact jobs array
2. return `group_id`
3. return per-job payloads shaped like `task.run`
4. do not duplicate `task.run_profile`
5. reuse the existing job store and event flow

## Acceptance

1. `system.capabilities` and `agent.capabilities` expose the new task methods.
2. CLI can call each new method without extra wrappers.
3. `task.logs` success payloads stay small.
4. `task.cancel` is idempotent on already terminal jobs.
5. `task.run_many` creates a bounded grouped response.
6. Tagged build passes.

## Review Focus

1. no event spam
2. no giant log payloads
3. no second task registry
4. no focus-steal side effects
5. cancellation semantics are honest about best-effort behavior

## Spark Prompt

```text
Implement docs/agent-plan-slices/01-m1-task-ops.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s01.
- Touch only the files needed for this slice.
- Reuse existing AgentTask, AgentSession, task event, and log-path helpers.
- Keep responses compact and token-efficient.
- Do not start search or browser work.

Deliver:
1. agent.task.logs
2. agent.task.cancel
3. agent.task.run_many
4. matching CLI commands
5. updated help text

Stop after the build succeeds, commit with:
Add agent task logs cancel and run-many
```
