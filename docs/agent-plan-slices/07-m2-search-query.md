# Slice 07 - Milestone 2 Search Query

Status: TODO

Branch: `spark/s07-search-query`

Build tag: `spark-s07`

PR title: `Add local-first agent search query`

Suggested commit: `Add local-first agent search query`

## Goal

Ship the first useful `agent.search` query path.

Follow [docs/bmux-agent-search-architecture.md](../bmux-agent-search-architecture.md).

## In Scope

1. `agent.search`
2. lexical candidate generation
3. compact snippet extraction
4. small top-k bounded output
5. CLI wrapper and help text

## Out Of Scope

1. cloud search
2. browser work
3. full graph fusion as a hard dependency
4. large MCP or plugin integration work

## Contract Requirements

Rules:

1. default to 3 to 5 hits
2. cap snippet bytes aggressively
3. return file path, line range, symbol when possible, score, and mode
4. do not dump full files
5. if the index is cold, use a bounded fallback such as `rg`

## Acceptance

1. concept queries return a compact top-k result set.
2. fallback mode is explicit.
3. query payloads remain token-cheap.
4. tagged build passes.

## Review Focus

1. snippet quality
2. bounded output
3. reasonable lexical fallback when the index is cold
4. no hidden cloud dependency

## Spark Prompt

```text
Implement docs/agent-plan-slices/07-m2-search-query.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s07.
- Follow docs/bmux-agent-search-architecture.md.
- Keep results local-first, bounded, and compact.
- Do not start browser work.

Deliver:
1. agent.search
2. matching CLI command
3. compact top-k result shape
4. explicit cold-index fallback behavior

Stop after the build succeeds, commit with:
Add local-first agent search query
```
