# Slice 02 - Milestone 1 State And Artifacts

Status: DONE

Branch: `spark/s02-state-artifacts`

Build tag: `spark-s02`

PR title: `Add agent state summary and artifact listing`

Suggested commit: `Add agent state summary and artifact listing`

## Goal

Finish the remaining Milestone 1 session-memory primitives:

1. `agent.state.summary`
2. `agent.artifact.list`
3. CLI wrappers for both

## In Scope

Server:

1. implement `agent.state.summary`
2. implement `agent.artifact.list`
3. add an artifact registry backed by existing job log paths and future-friendly metadata
4. expose high-signal session memory without dumping layout or logs

CLI:

1. add `bmux agent state summary`
2. add `bmux agent artifact list`
3. update help text

## Out Of Scope

1. search
2. browser agent methods
3. app UI
4. richer event coverage beyond what state summary needs

## Expected Files

1. `Sources/TerminalController.swift`
2. `CLI/bmux.swift`

## Contract Requirements

### `agent.state.summary`

Return only the minimum useful memory:

1. `layout_rev`
2. `active_dev_server`
3. `preferred_browser_surface`
4. `last_failed_job`
5. `workspace_fingerprint`
6. `user_preferences`
7. `recovered`

Rules:

1. do not embed full layout trees
2. do not embed task logs
3. keep fields nullable and predictable

### `agent.artifact.list`

Start small:

1. job logs
2. failure artifacts already written to disk

Return metadata only:

1. `artifact_id`
2. `kind`
3. `job_id`
4. `surface_id`
5. `path`
6. `created_at`

Rules:

1. no artifact contents
2. no base64
3. stable ids within a session

## Acceptance

1. `agent.state.summary` works with just a session id.
2. `agent.artifact.list` returns empty arrays cleanly.
3. user preferences include the current Bun and pricing behavior.
4. artifact ids are stable and compact.
5. tagged build passes.

## Review Focus

1. state summary stays small
2. artifact registry does not become a second log store
3. response fields match the plan instead of ad hoc naming

## Spark Prompt

```text
Implement docs/agent-plan-slices/02-m1-state-and-artifacts.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s02.
- Reuse existing session, task, service, and log-path data.
- Keep payloads tiny and deterministic.
- Do not start search or browser work.

Deliver:
1. agent.state.summary
2. agent.artifact.list
3. matching CLI commands
4. updated help text

Stop after the build succeeds, commit with:
Add agent state summary and artifact listing
```
