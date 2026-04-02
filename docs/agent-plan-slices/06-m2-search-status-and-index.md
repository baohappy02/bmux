# Slice 06 - Milestone 2 Search Status And Index

Status: TODO

Branch: `spark/s06-search-status-index`

Build tag: `spark-s06`

PR title: `Add agent search status and indexing`

Suggested commit: `Add agent search status and indexing`

## Goal

Start the local-first search stack with the smallest useful primitives:

1. `agent.search.status`
2. `agent.search.index`

Follow [docs/bmux-agent-search-architecture.md](../bmux-agent-search-architecture.md).

## In Scope

1. local index state model
2. compact status payload
3. explicit index or refresh operation
4. CLI wrappers
5. help text

## Out Of Scope

1. `agent.search` query execution
2. browser work
3. cloud or auth-backed search
4. upstream code reuse

## Expected Files

Likely:

1. `Sources/TerminalController.swift`
2. `CLI/bmux.swift`
3. any new local helper file if needed

## Contract Requirements

Rules:

1. local-first only
2. auth-free only
3. compact status values such as `missing`, `warming`, `warm`, `stale`, `degraded`
4. surface backend capabilities such as `lexical`, `semantic`, `graph`
5. do not block the UI longer than necessary

## Acceptance

1. `agent.search.status` is cheap enough to call often.
2. `agent.search.index` starts or refreshes local indexing.
3. payloads stay small and machine-friendly.
4. tagged build passes.

## Review Focus

1. no cloud coupling
2. no giant status payloads
3. no irreversible backend choice baked in too early

## Spark Prompt

```text
Implement docs/agent-plan-slices/06-m2-search-status-and-index.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s06.
- Follow docs/bmux-agent-search-architecture.md.
- Keep this local-first, auth-free, and bmux-native.
- Do not implement query retrieval yet.

Deliver:
1. agent.search.status
2. agent.search.index
3. matching CLI commands
4. updated help text

Stop after the build succeeds, commit with:
Add agent search status and indexing
```
