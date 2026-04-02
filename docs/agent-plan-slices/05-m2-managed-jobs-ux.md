# Slice 05 - Milestone 2 Managed Jobs UX

Status: TODO

Branch: `spark/s05-managed-jobs-ux`

Build tag: `spark-s05`

PR title: `Add managed jobs UX and failure reveal`

Suggested commit: `Add managed jobs UX and failure reveal`

## Goal

Expose the agent job model through the bmux app so humans can coexist with Codex without confusion.

## In Scope

1. managed job visibility in existing app UI patterns
2. service readiness badges
3. reveal-on-fail behavior for managed terminals
4. failure-first notifications
5. clear human versus agent ownership markers where practical

## Out Of Scope

1. search
2. browser agent methods
3. a brand new major UI subsystem if existing surfaces can host the state

## Expected Files

Likely:

1. `Sources/TabManager.swift`
2. `Sources/Workspace.swift`
3. `Sources/AppDelegate.swift`
4. `Sources/bmuxApp.swift`
5. `Sources/TerminalController.swift`

## Contract Requirements

Rules:

1. do not regress typing or focus-sensitive paths
2. reuse existing sidebar, metadata, and notification systems where possible
3. keep UI state derived from the existing task and service model
4. reveal-on-fail should be policy-driven, not always-on

## Acceptance

1. a managed job failure is easy for a human to locate in-app
2. a ready dev server is visible without reading logs
3. pass cases stay quiet
4. tagged build passes

## Review Focus

1. typing latency regressions
2. focus churn
3. unnecessary view recomputation in hot paths
4. duplicate app state versus existing agent data

## Spark Prompt

```text
Implement docs/agent-plan-slices/05-m2-managed-jobs-ux.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s05.
- Respect the repo notes about typing-latency-sensitive paths.
- Reuse existing sidebar, metadata, and notification patterns before creating new UI.
- Do not start search or browser work.

Deliver:
1. managed jobs visibility
2. service readiness badges
3. reveal-on-fail behavior
4. failure-first notifications

Stop after the build succeeds, commit with:
Add managed jobs UX and failure reveal
```
