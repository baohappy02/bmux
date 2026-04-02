# bmux Agent Search Architecture

Last updated: April 2, 2026

This document defines how bmux should use code intelligence after the current GitNexus limitations seen on bmux.
It complements [docs/bmux-browser-agent-plan.md](/Users/macbook/Desktop/Me/TOOLs/bmux/docs/bmux-browser-agent-plan.md), which already says `agent.search` should be local-first and token-efficient.

## Current Diagnosis

bmux should not depend on GitNexus as the only trusted code-intelligence layer.

Reasons:

1. bmux is Swift-heavy, and the current GitNexus Swift path is still weak for the exact cases that matter here: private symbols, local symbol recovery, and deeper receiver resolution.
2. The current bmux GitNexus index is structurally useful for some repo-wide navigation, but it is not strong enough to be the primary answer engine for Codex loops.
3. The current local bmux index has `embeddings: 0`, so retrieval quality is further limited even before Swift-specific gaps are considered.
4. The future bmux plan already treats GitNexus as optional graph fusion, not as the main search backend.

The practical rule for bmux is:

1. trust source files first
2. trust build results second
3. treat GitNexus as a companion signal, not the control plane

## Decision

bmux should build its own local-first `agent.search` stack and keep GitNexus in a reduced role.

### What GitNexus should still be used for

1. exact symbol lookup when the graph is healthy enough
2. impact analysis, rename previews, and dependency tracing
3. optional graph-aware reranking for concept queries
4. offline architectural context for larger refactors

### What GitNexus should not be responsible for

1. the default retrieval path for every Codex question
2. the only semantic search backend for bmux
3. authoritative answers about Swift-private or file-local implementation slices
4. large agent-context dumps into the prompt

## Fork Strategy

If bmux decides to own this stack, it should not copy the whole GitNexus monorepo into the bmux app repo.

Recommended strategy:

1. fork the core CLI and ingestion engine as a separate companion repo
2. keep bmux app integration behind a narrow CLI or JSON interface
3. ignore the upstream web UI, editor plugins, and demo/eval layers for the first bmux-owned fork
4. keep the fork small enough that bmux can tune it for Swift and token budgets without inheriting unrelated product surface area

Recommended ownership split:

1. `bmux` owns the `agent.search` API, compact payload design, cache policy, and agent UX
2. the forked code-intel repo owns indexing, graph construction, and optional semantic reranking
3. bmux communicates with that backend through stable, low-byte request and response contracts

This avoids turning the bmux app repo into a second monorepo and keeps it possible to swap the backend later if needed.

## Upstream Inspection Notes

GitNexus upstream was cloned locally for inspection at `/tmp/GitNexus-upstream`.

Important findings from the current upstream layout:

1. the repo is a monorepo with a small core package in `gitnexus/` and a lot of extra surface in `gitnexus-web/`, editor integrations, eval harnesses, and skills
2. the published `gitnexus` package license is `PolyForm-Noncommercial-1.0.0`
3. the actual CLI shell is thin; the real weight sits in the ingestion pipeline, local backend, LadybugDB adapter, and search modules
4. the current search stack is conceptually simple: LadybugDB FTS for lexical retrieval plus optional semantic reranking merged with Reciprocal Rank Fusion

Practical consequence for bmux:

1. use the upstream repo as architecture input
2. do not vendor or lightly rewrite upstream code into bmux without reviewing license impact first
3. prefer a clean-room implementation of the small useful ideas

## Minimal Slice To Rebuild

After inspecting upstream, bmux does not need most of the monorepo.

The useful slice to replicate in bmux form is:

1. thin CLI command routing
2. local index registry and freshness metadata
3. lexical search over files and symbols
4. compact snippet extraction
5. optional semantic reranking
6. optional graph companion integration

The upstream files worth studying as design references are:

1. `gitnexus/src/cli/index.ts`
2. `gitnexus/src/cli/tool.ts`
3. `gitnexus/src/storage/repo-manager.ts`
4. `gitnexus/src/core/search/bm25-index.ts`
5. `gitnexus/src/core/search/hybrid-search.ts`
6. `gitnexus/src/mcp/local/local-backend.ts`

The upstream files bmux should ignore for the first iteration are:

1. `gitnexus-web/`
2. `.claude/`, packaged skills, and plugin integrations
3. `eval/`
4. wiki generation
5. HTTP bridge mode
6. broad MCP compatibility surface unrelated to bmux `agent.search`

## Target bmux Retrieval Model

`agent.search` should be built as a layered local backend.

### Layer 1: cheap lexical recall

The first retrieval stage should be fast, deterministic, and local.

Preferred options:

1. SQLite FTS5 for indexed repositories
2. `rg` fallback when the index is cold or missing
3. path and symbol heuristics based on file names, nearby docs, and recent activity

This stage is responsible for recall, not semantic intelligence.

### Layer 2: compact snippet builder

After candidates are chosen, bmux should build only the smallest useful payload.

Return shape:

1. file path
2. line range
3. optional symbol name
4. compact snippet
5. score
6. mode: `lexical`, `semantic`, `graph`, or `hybrid`

The snippet builder should enforce hard byte limits so the model never receives giant dumps by default.

### Layer 3: optional semantic reranking

Semantic reranking should improve ranking, not replace the lexical stage.

Requirements:

1. local-first
2. warmable in background
3. bounded top-k
4. cheap enough for repeated Codex loops

This can start with no embeddings at all and ship later once the lexical plus snippet path is solid.

### Layer 4: optional graph fusion

Graph-aware reranking can use GitNexus or a bmux-owned fork when available.

Good graph signals:

1. same symbol neighborhood
2. same execution flow
3. same functional community
4. direct caller or callee proximity
5. same file or nearby type cluster

Graph fusion should be best-effort only.
If graph confidence is low, bmux should return lexical or hybrid results and say so.

## bmux-Specific Swift Requirements

Any owned GitNexus fork or replacement must improve the areas bmux actually hits:

1. private and fileprivate method discovery
2. extension-member linking
3. `self` and implicit-member receiver resolution
4. protocol-conformance and implementation lookup
5. nested types and typealias-aware resolution where practical
6. better confidence reporting when a Swift edge is heuristic rather than exact

The main goal is not compiler-grade Swift analysis.
The goal is reliable enough static recovery that Codex stops being misled by missing or wrong cross-file connections in the bmux app layer.

## bmux API Contract

bmux should expose a compact search surface regardless of backend choice:

1. `agent.search`
2. `agent.search.index`
3. `agent.search.status`

Suggested behavior:

### `agent.search.index`

1. indexes the local repository in background
2. reports index scope, backend kind, freshness, and last duration
3. does not block ordinary bmux interaction longer than necessary

### `agent.search.status`

1. reports `missing`, `warming`, `warm`, `stale`, or `degraded`
2. includes backend capabilities such as `lexical`, `semantic`, and `graph`
3. includes whether graph fusion is available and healthy
4. includes whether current results are safe to use for concept queries only or also for exact symbol work

### `agent.search`

1. takes an intent or concept query
2. returns compact top-k results only
3. indicates which backend stages were used
4. indicates confidence and fallback mode
5. never dumps full files by default

## Token Budget Rules

The owned bmux search path should optimize for low-token agent loops, not for general-purpose code search UI.

Rules:

1. default top-k should be small
2. snippets should be short and centered
3. return handles and line ranges before content expansion
4. prefer one good search plus one file read over many search retries
5. keep search status cheap enough to call often
6. keep the indexing path mostly invisible to the model unless something is stale or degraded

## Incremental Delivery Plan

### Phase 0: stop over-trusting GitNexus

1. keep using GitNexus for impact and repo-wide refactors when it helps
2. do not treat it as authoritative for Swift-private implementation slices
3. teach bmux docs and skills to prefer source plus build truth over graph truth in this area

### Phase 1: ship bmux-native lexical `agent.search`

1. implement `agent.search.status`
2. implement `agent.search.index`
3. implement lexical retrieval with compact snippets
4. add `rg` fallback when the index is cold
5. measure token usage on real bmux tasks
6. keep the first implementation clean-room and bmux-native rather than importing upstream code

### Phase 2: add graph fusion

1. consume GitNexus graph output only as an optional ranking signal
2. gate graph use behind freshness and confidence checks
3. surface degraded mode explicitly instead of silently pretending graph results are reliable

### Phase 3: fork or replace the graph engine for bmux

Only do this after Phase 1 proves the `agent.search` API shape.

Then:

1. fork the minimal GitNexus core needed for local indexing and graph queries
2. add bmux-focused Swift improvements
3. trim unused upstream product surface
4. keep the fork usable from Codex without large prompt instructions
5. resolve licensing before any code reuse beyond architecture inspiration

## What Not To Do

1. do not make Codex wait on a full graph backend before `agent.search` exists
2. do not pipe large graph dumps into agent context by default
3. do not clone upstream UI and plugin surfaces into bmux unless bmux truly needs them
4. do not force semantic-only retrieval when lexical recall would answer the question faster and cheaper
5. do not trust graph output over source files when they disagree

## Success Criteria

This direction is working when:

1. Codex can answer concept-level bmux questions with one `agent.search` call plus one or two file reads
2. Swift-heavy slices no longer require blind retries because graph lookup missed private symbols
3. search payloads stay compact enough that repeated agent loops remain cheap
4. GitNexus becomes optional acceleration, not a fragile dependency
5. bmux can later swap in a better graph backend without changing the `agent.search` contract
