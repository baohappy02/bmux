# bmux Agent Control Plan

Last updated: April 2, 2026

This document proposes a token-efficient control layer for bmux agents such as Codex.
It covers layout orchestration for windows, workspaces, panes, and surfaces, plus compact browser control inside bmux.
It is complementary to [docs/agent-browser-port-spec.md](/Users/macbook/Desktop/Me/TOOLs/bmux/docs/agent-browser-port-spec.md), which focuses on command-surface parity. This plan focuses on response shape, statefulness, and backend strategy.

## Outcome

1. Agents can create and control real bmux surfaces, including terminals and browsers.
2. Split operations such as right, left, up, and down are first-class and cheap to reason about.
3. The browser remains a real browser surface inside the bmux window, not a text-only simulation.
4. The terminal remains the control plane: agents drive layout and surfaces through CLI/socket commands.
5. Default agent interactions stay small enough to avoid burning tokens on repeated snapshots or large layout dumps.
6. The protocol shape stays stable across backends, even if bmux later adds a full-fidelity Chromium/CDP executor.

## Non-Goals

1. Do not turn the browser into a text-only terminal UI.
2. Do not force Codex to reconstruct the app state by polling multiple verbose v2 commands.
3. Do not force Playwright-level parity on the current `WKWebView` backend.
4. Do not make screenshots, full DOM dumps, full-page text, or full terminal scrollback the default read path.
5. Do not break the current human-oriented `window.*`, `workspace.*`, `pane.*`, `surface.*`, or `browser.*` CLI for debugging.

## Current Problems

Today bmux has the right primitives, but they are still too verbose and too fragmented for efficient LLM loops:

1. Layout discovery is spread across `window.*`, `workspace.*`, `pane.*`, `surface.*`, and `browser.*`, so the agent has to stitch state together itself.
2. There is no compact layout tree with split direction, focused nodes, and surface types in one response.
3. `browser.snapshot --json` includes large payloads such as full page text and HTML.
4. `browser.console.list` and `browser.errors.list` read full client-side log buffers each time.
5. Action responses can include post-action snapshots, which is convenient for humans but wasteful for agents.
6. The protocol has no first-class `layout_rev`, `page_rev`, or `ref_epoch`, so agents cannot safely cache state between calls.
7. The current `WKWebView` implementation uses DOM-oriented event dispatch for many actions, which is not equivalent to native pointer and keyboard input.

## Design Principles

1. Make the protocol stateful on the server side, not in the model context.
2. Give the agent a compact view of the bmux structure first: window, workspace, pane tree, and surfaces.
3. Prefer stable IDs and refs over repeated selector or text matching.
4. Return deltas and acknowledgements by default, not refreshed full-page or full-layout views.
5. Return artifacts by filesystem path, not inline base64, unless explicitly requested.
6. Advertise backend limits honestly so the caller can escalate only when needed.
7. Push useful defaults and naming decisions into the app so Codex does not need to spend tokens correcting them later.

## Proposed Surface

Add a dedicated agent namespace over the existing bmux control surface:

1. `agent.attach`
2. `agent.layout`
3. `agent.open`
4. `agent.focus`
5. `agent.close`
6. `agent.wait`
7. `agent.surface.read`
8. `agent.task.run`
9. `agent.task.wait`
10. `agent.task.result`
11. `agent.task.logs`
12. `agent.task.cancel`
13. `agent.task.run_many`
14. `agent.task.run_profile`
15. `agent.events`
16. `agent.service.wait`
17. `agent.service.list`
18. `agent.state.summary`
19. `agent.terminal.write`
20. `agent.terminal.capture`
21. `agent.terminal.wait`
22. `browser.agent.observe`
23. `browser.agent.act`
24. `browser.agent.read`
25. `browser.agent.logs`
26. `browser.agent.artifact`
27. `agent.capabilities`
28. `agent.batch`
29. `agent.ensure`
30. `agent.artifact.list`
31. `agent.search`
32. `agent.search.index`
33. `agent.search.status`

Suggested CLI wrappers:

```bash
bmux agent attach --json
bmux agent layout --session ag_123 --compact --json
bmux agent open terminal --session ag_123 --split right --cwd /repo --json
bmux agent open browser --session ag_123 --split down --url http://localhost:3000 --json
bmux agent focus --session ag_123 --surface surface:9 --json
bmux agent surface read --session ag_123 --surface surface:9 --fields kind,title,cwd,command --json
bmux agent task run --session ag_123 --label typecheck --cmd "bun run typecheck" --json
bmux agent task run-profile --session ag_123 --profile verify.ts --json
bmux agent task run-many --session ag_123 --file bmux-jobs.json --json
bmux agent task wait --session ag_123 --job job:3 --json
bmux agent task result --session ag_123 --job job:3 --json
bmux agent events --session ag_123 --since 41 --json
bmux agent service wait --session ag_123 --port 3000 --json
bmux agent capabilities --session ag_123 --json
bmux agent batch --session ag_123 --file bmux-setup.json --json
bmux agent ensure service --session ag_123 --profile dev.web --json
bmux agent artifact list --session ag_123 --job job:3 --json
bmux agent search --session ag_123 --query "where auth is configured" --json
bmux agent search status --session ag_123 --json
bmux agent search index --session ag_123 --scope repo --json
bmux agent terminal write --session ag_123 --surface surface:9 --text "bun run dev\n" --json
bmux agent terminal capture --session ag_123 --surface surface:9 --mode delta --json
bmux browser agent observe --session ag_123 --surface surface:7 --scope interactive --json
bmux browser agent act --session ag_123 click --ref e12 --json
```

## Phase 0: Codex-Ready Core

Before bmux grows a richer browser backend, the first deliverable should be a compact control plane that makes Codex effective with layout and terminals.

Phase 0 scope:

1. attach to the current bmux context
2. inspect split topology in one compact call
3. open terminal surfaces with clear split intent
4. run managed sub-terminal jobs in parallel
5. focus and close surfaces deterministically
6. send text to terminal surfaces
7. capture only visible or delta terminal output
8. wait for terminal predicates without polling huge buffers
9. return only `ok` or compact failure summaries for build and test jobs
10. expose event cursors so Codex can react instead of polling
11. track service readiness like ports and health URLs in bmux, not in prompt context
12. make new terminals and surfaces open with stable, human-readable defaults
13. discover the environment and supported profiles in one cheap call
14. make common setup flows idempotent through `ensure` and `batch`
15. avoid repeated verification runs when a safe cached result is still valid
16. find likely-relevant code by intent without forcing Codex into dozens of `grep` guesses

This is the minimum feature set that makes bmux feel usable, fast, and low-token for Codex even before browser automation becomes the main focus.

## Core Agent Shape

The first-class unit for Codex is not just the browser. It is the bmux layout:

1. `window`
2. `workspace`
3. `pane`
4. `surface`

Surface kinds the agent should reason about:

1. `terminal`
2. `browser`
3. `markdown`

The agent should be able to do these cheaply:

1. discover the current layout
2. open a terminal split on the right or below
3. open a browser split on the right or below
4. run `bun`, `flutter`, `pytest`, or other commands in managed job terminals
5. focus a specific pane or surface
6. close a surface or pane
7. read minimal state from the focused surface
8. write to a terminal surface
9. capture terminal output as viewport or delta
10. wait for services such as dev servers by port or health check
11. receive parsed diagnostics instead of raw tool logs
12. rely on sane default cwd and titles for newly created terminals
13. discover which tools, profiles, and parsers are available without probing the shell
14. reuse an existing browser, split, or dev server when one already satisfies the request
15. resume useful local state after bmux or Codex restarts
16. answer concept-level codebase questions with bounded local semantic retrieval

## Codex Operating Contract

The compact `agent.*` namespace should be the only path Codex is taught to prefer once it exists.

Codex should not default to:

1. `list-windows`
2. `list-workspaces`
3. `list-panes`
4. `list-pane-surfaces`
5. `browser snapshot`
6. full terminal scrollback dumps

Codex should default to:

1. `agent.attach`
2. `agent.layout`
3. `agent.open`
4. `agent.focus`
5. `agent.capabilities`
6. `agent.ensure`
7. `agent.batch`
8. `agent.task.run`
9. `agent.task.wait`
10. `agent.task.result`
11. `agent.surface.read`
12. `agent.terminal.write`
13. `agent.terminal.capture`
14. `agent.events`
15. `agent.service.wait`
16. `agent.state.summary`
17. `agent.artifact.list`
18. `agent.search`
19. `agent.search.status`
20. `agent.wait`
21. `browser.agent.*` only when the target surface is a browser

This keeps both prompts and responses small, and it also gives bmux a single stable operating model for future agent skills and documentation.

Exact or syntax-sensitive lookups still belong to `rg`, GitNexus, or future exact-match agent wrappers.
`agent.search` is for concept lookup, intent search, and "I know what this does but not what it is named" workflows.

Package-manager and research policy should also be part of the operating contract:

1. prefer `bun` for JavaScript or TypeScript installs, scripts, and one-off executables whenever the environment supports it
2. only fall back to `npm`, `pnpm`, `yarn`, or `npx` when the repo clearly requires it or Bun is incompatible
3. check pricing before deeper research on external tools, services, dependencies, or platforms
4. if pricing shows the intended option is paid, usage-based, or billing-gated, stop and report that before continuing

## In-App Agent UX

The bmux app itself should help Codex by surfacing the right local state for humans without forcing that same state into model context.

Priority app-level affordances:

1. managed jobs list or lane
2. failure-first notifications
3. service badges such as `:3000 ready`
4. reveal-on-fail behavior for hidden or managed job terminals
5. command palette actions for agent workflows
6. compact artifact access for humans: open log, open diagnostics, open screenshot

These are token-efficient because they keep rich state in the app, where humans can inspect it directly, while Codex still receives only compact handles and summaries.

## New Terminal Defaults

New terminal creation should have stable app-level defaults so both humans and Codex get predictable topology without spending extra commands.

### Default cwd

For `Cmd+N` and equivalent "new terminal" actions with no explicit cwd:

1. default to `~/Desktop`
2. only override this when the caller explicitly passes a cwd or when a stronger existing routing rule already applies

This is token-efficient because Codex does not need a follow-up correction step like "close this" or "open another terminal in Desktop".

### Default title derivation

Default titles for new terminals and workspaces should not be raw full paths.

Rules:

1. derive the initial title from the last path component of the effective cwd
2. `/Users/name/Desktop/myapp` becomes `myapp`
3. do not show the full absolute path as the default title

### Duplicate title disambiguation

When multiple terminals or workspaces would resolve to the same basename:

1. prepend one parent folder segment
2. if still duplicated, keep prepending parent segments until the titles are unique
3. only the conflicting titles should be expanded

Examples:

1. `~/Desktop/app` -> `app`
2. `~/Work/app` -> `Work/app` if another `app` already exists
3. `~/Desktop/client/app` and `~/Work/client/app` -> `Desktop/client/app` and `Work/client/app`

This is token-efficient because Codex can target the right surface by a compact human-readable title instead of needing extra discovery calls against full cwd metadata.

## Managed Job Terminals

`agent.task.*` should run on top of real bmux terminal surfaces, but the presentation can be policy-driven:

1. `visible` mode: open the job as a normal split the user can watch
2. `managed` mode: keep the terminal under bmux control and do not expose it unless requested
3. `reveal_on_fail` mode: keep it quiet on success, but focus or surface it when the job fails

This keeps the implementation aligned with bmux's real terminal model while still letting Codex use builds and tests as cheap background jobs.

## Structured Diagnostics

Raw logs are almost never the right payload for Codex.
bmux should adapt common tool output into compact structured diagnostics.

Priority adapters:

1. `tsc`
2. `eslint`
3. `pytest`
4. `flutter test`
5. `bun run build`
6. `xcodebuild`

Each adapter should normalize:

1. `tool`
2. `file`
3. `line`
4. `column`
5. `code`
6. `severity`
7. `message`
8. `is_root_cause`

Rules:

1. return diagnostics only on failure or explicit request
2. prefer 3 to 10 root-cause diagnostics, not every downstream error
3. dedupe repeated messages and collapse noisy cascades
4. keep the raw log available by path, not inline

## Event Cursors

Codex should not need to poll many commands just to discover that something changed.

Add an event cursor stream:

1. `agent.events --since <cursor>`

Priority event types:

1. `job.started`
2. `job.completed`
3. `job.failed`
4. `service.ready`
5. `service.timeout`
6. `layout.changed`
7. `surface.closed`
8. `browser.navigated`
9. `browser.crashed`

The event stream should be:

1. cursor-based
2. bounded by count and bytes
3. small enough to poll cheaply when push delivery is unavailable

## Service Readiness

bmux should understand when developer services are actually ready, instead of forcing Codex to infer it from logs.

Suggested surface:

1. `agent.service.wait`
2. `agent.service.list`

Readiness predicates:

1. `port`
2. `url`
3. `http_status`
4. `text`
5. `regex`

This is especially important for FE loops:

1. run dev server
2. wait for `localhost:3000`
3. open browser
4. verify app

## Server-Side Working Memory

bmux should retain compact working memory so Codex does not have to restate it in every prompt.

Suggested surface:

1. `agent.state.summary`

High-value remembered slots:

1. active dev server port
2. active dev server job
3. preferred browser surface
4. last failed job
5. last artifact paths
6. last focused surface

This memory should be:

1. small
2. derived automatically when possible
3. safe to invalidate on layout or process churn

## Failure-First Artifacts

When work fails, bmux should capture artifacts automatically and return handles, not payloads.

Preferred artifacts:

1. `log_path`
2. `diagnostics_path`
3. `terminal_tail_path`
4. `screenshot_path`
5. `browser_snapshot_path`

Rules:

1. success paths should not attach artifacts by default
2. failure paths should capture the minimum useful artifact set automatically
3. the response should return paths or ids, not inline content

## Task Policies

Managed jobs should support policy flags so Codex can stay terse and still get good behavior.

Priority policies:

1. `managed`
2. `visible`
3. `reveal_on_fail`
4. `auto_close_on_success`
5. `reuse_surface`
6. `max_parallelism`
7. `package_manager_preference`
8. `network_access`
9. `pricing_gate`
10. `approval_behavior`

## Batch and Ensure Flows

Codex should not spend extra round-trips on common setup sequences when bmux can safely coordinate them.

### `agent.batch`

`agent.batch` should execute a small ordered list of idempotent or low-risk steps under one request:

1. `ensure split-right terminal`
2. `run_profile dev.web`
3. `wait service 3000`
4. `ensure browser right http://localhost:3000`

Rules:

1. each step should return a compact per-step result
2. the batch result should stop on the first hard failure unless `continue_on_error` is requested
3. batch responses must remain smaller than the equivalent sequence of separate calls plus discovery overhead
4. batch preflight should block before side effects when any step is classified as `billing_risk` or disallowed external work without approval

### `agent.ensure`

The `ensure` family should be idempotent.
Codex should be able to say "make sure I have a dev server and browser" without creating duplicates on every retry.

Priority ensure targets:

1. terminal split by direction
2. browser surface by URL or role
3. service by port or health URL
4. named profile or recipe

Rules:

1. return `created: false` when bmux can reuse an existing resource
2. return the matching `surface_id`, `job_id`, or `service_id`
3. never create duplicates when a compatible live resource already exists unless `force_new` is requested

## Capability and Environment Discovery

`agent.capabilities` should cover both bmux backend capabilities and the developer environment.
Codex should not burn tokens asking the shell whether `bun`, `flutter`, `pytest`, or `tsc` exist when bmux can answer once.

The capability payload should include:

1. backend capabilities such as `native_pointer`, `file_upload`, and `network_mocking`
2. detected runtimes and tools such as `bun`, `node`, `flutter`, `python`, `pytest`, `tsc`
3. inferred package manager or build system
4. available parser adapters
5. available named profiles
6. default cwd and title policies for new terminals
7. whether local semantic search is available, warming, or disabled
8. persisted user preferences that affect tool choice or research policy
9. effective execution policy for network access, pricing checks, and approval gates

## Preference Memory and Research Gates

The agent should not have to relearn obvious user preferences every turn.

Priority preferences:

1. preferred JavaScript or TypeScript package manager
2. pricing-first research behavior
3. whether paid or billing-gated options require explicit approval before deeper work

Rules:

1. preference memory belongs in server-side session state and should be exposed by `agent.capabilities` and `agent.state.summary`
2. if `bun` is both preferred and supported, examples, profiles, and generated commands should default to `bun`
3. if the inferred project toolchain conflicts with the preferred package manager, bmux should surface both so Codex can explain the fallback briefly
4. before Codex does deeper research, setup, or prototyping for an external tool or service, it should check pricing first
5. if pricing is paid, usage-based, or billing-gated for the intended workflow, Codex should stop and ask before going deeper
6. if pricing cannot be confirmed quickly, Codex should report that pricing is still unclear before continuing

## Execution Classes and Approval Gates

Every task, profile, and batch step should be classifiable before execution.

Recommended execution classes:

1. `local_read`
2. `local_exec`
3. `local_verify`
4. `network_research`
5. `external_service`
6. `billing_risk`

Rules:

1. `local_read`, `local_exec`, and `local_verify` should usually proceed without extra approval
2. `network_research`, `external_service`, and `billing_risk` should be preflighted against pricing and approval policy before execution
3. `agent.task.run`, `agent.task.run_profile`, and `agent.batch` should surface the execution class before or with execution
4. if pricing is known to be paid or billing-gated for the intended workflow, bmux should stop before side effects and return an approval-shaped result
5. if pricing is still unknown, bmux should default to a blocked or warning result instead of silently proceeding into deeper paid research

## Local-First Semantic Retrieval

Semantic retrieval is worth adding to bmux, but bmux should not copy `mgrep` blindly.

Detailed backend direction for bmux-local search and the reduced GitNexus role lives in [docs/bmux-agent-search-architecture.md](/Users/macbook/Desktop/Me/TOOLs/bmux/docs/bmux-agent-search-architecture.md).

### What bmux should borrow

The `mgrep` evaluation confirms a real pattern worth adopting:

1. semantic top-k retrieval beats repeated blind `grep` guessing for concept-level questions
2. small path plus line-range results are much cheaper than dumping file contents
3. background indexing matters because latency is part of token efficiency
4. good reranking lets the model spend tokens on reasoning, not on search retries

### What bmux should not copy

For bmux and Codex, the current `mgrep` shape has several mismatches:

1. it is cloud-backed and requires authentication before meaningful use
2. even dry-run flows still require auth because they create a store first
3. `install-codex` mainly adds background sync plus a skill that aggressively says to always use `mgrep`
4. the current `mgrep mcp` server does not yet expose useful callable tools, so the Codex integration is not a rich MCP search surface

bmux should therefore treat `mgrep` as design inspiration, not as the product architecture.

### bmux retrieval goals

`agent.search` should be:

1. local-first
2. auth-free for local repositories
3. bounded in bytes and hit count
4. hybrid, not semantic-only
5. optional to warm in the background

The ideal default backend is a local hybrid retriever:

1. lexical candidate generation
2. semantic reranking
3. optional symbol or graph fusion when GitNexus is available

### Proposed search surface

Add a retrieval trio:

1. `agent.search`
2. `agent.search.index`
3. `agent.search.status`

Semantics:

1. `search` asks a question or intent query and returns top-k snippets
2. `search.index` starts or refreshes local indexing
3. `search.status` reports whether the local index is warm, stale, or missing

### Query routing rules

Codex should not use one search mode for everything.

Recommended routing:

1. exact identifier, regex, or rename work: use `rg` or GitNexus
2. architecture or concept lookup: use `agent.search`
3. local repo plus docs blend: use `agent.search` plus explicit web only when needed

### Local storage and privacy

The search index should stay local by default.

Recommended properties:

1. index stored on-disk under bmux-controlled local app data
2. no login required
3. no background upload to third-party servers
4. explicit opt-in for any future cloud sync mode

### Result shape

`agent.search` should return only the minimum useful retrieval payload:

1. file path
2. line range
3. optional symbol name
4. small snippet
5. score
6. search mode such as `lexical`, `semantic`, or `hybrid`

The response should stay small enough that Codex can often answer after one search plus one file read.

## Workspace Fingerprints and Caching

Verification work should be skipped when bmux can prove that nothing relevant changed.

The cache key should be derived from a compact workspace fingerprint such as:

1. repo root
2. git dirty state or base revision
3. relevant lockfiles
4. profile-specific config inputs

Rules:

1. caching should only apply to safe read-mostly profiles such as `verify.ts` or `ci.quick`
2. cached success should return `cache_status: hit` or `status: cached_ok`
3. cache invalidation must happen on relevant file changes, dependency changes, or explicit `--no-cache`
4. Codex should not need to restate why a cached result is acceptable

The same fingerprinting system can also invalidate local search indexes cheaply.

## Secret Redaction

bmux should default to redacting sensitive values before they ever enter agent-visible payloads.

Priority redaction targets:

1. API keys in logs
2. bearer tokens and cookies
3. authorization headers
4. `.env`-style secrets echoed by commands
5. browser storage or network metadata that contains credentials

Rules:

1. event payloads, diagnostics, terminal tails, and browser logs must be redacted by default
2. redaction should be deterministic so repeated placeholders are still comparable
3. raw artifacts may remain on disk for the local user, but agent-visible summaries should stay sanitized

## Retry and Flake Policy

Codex should not have to manually paper over every transient failure.

bmux should support bounded retries for a small set of safe cases:

1. service startup races
2. health-check timeouts
3. browser navigation timing issues
4. test runners known to flake on first launch

Rules:

1. retries must be opt-in by profile or explicit policy
2. never retry destructive commands by default
3. return retry metadata such as `retried: 1` and `final_status`
4. expose whether a failure is likely transient or likely deterministic

## Artifact Registry

Failure artifacts should have stable ids, not only ad hoc paths in one response.

Each artifact record should include:

1. `artifact_id`
2. `kind`
3. `job_id`
4. `surface_id`
5. `path`
6. `created_at`

This allows Codex to keep references compact while humans still have rich local inspection paths.

## Resume, Recovery, and Cleanup

Codex sessions should survive routine churn better than plain CLI loops.

Recovery goals:

1. re-attach to long-running dev servers
2. recover managed jobs that are still alive
3. recover the preferred browser surface after a restart
4. expose whether the session was freshly created or recovered

Cleanup goals:

1. auto-close hidden success jobs after a TTL
2. expire stale artifacts and stale sessions
3. clean up dead service entries and orphaned managed surfaces
4. emit events when recovery or cleanup materially changes the visible state

## Session Model

Each attached agent session should maintain server-side state:

1. `session_id`
2. `window_id`
3. `workspace_id`
4. `pane_id`
5. `surface_id`
6. `backend_kind`
7. `layout_rev`
8. `page_rev`
9. `ref_epoch`
10. `console_cursor`
11. `error_cursor`
12. `last_focus_ref`
13. `job_cursors`
14. `job_registry`
15. `event_cursor`
16. `service_registry`
17. `state_summary`
18. `active_profiles`
19. `artifact_registry`
20. `workspace_fingerprint`
21. `recovery_snapshot`
22. `redaction_policy`
23. `capability_snapshot`
24. `search_index_state`
25. `search_backend`
26. `user_preferences`

Rules:

1. `layout_rev` increments for structural changes such as split, close, move, or focus changes that matter to the agent.
2. `page_rev` increments for meaningful DOM or navigation changes.
3. `ref_epoch` changes when previous element refs are no longer safe to reuse.
4. `console_cursor` and `error_cursor` allow incremental reads without replaying old logs.
5. `job_registry` tracks managed terminal jobs and their latest status.
6. `event_cursor` allows Codex to consume only new events.
7. `service_registry` tracks ports, URLs, and service readiness discovered by bmux.
8. `state_summary` keeps compact server-side memory such as active dev server, last failed job, and preferred browser surface.
9. `artifact_registry` keeps compact ids for logs, diagnostics, screenshots, and browser snapshots.
10. `workspace_fingerprint` allows bmux to reuse safe verification results.
11. `recovery_snapshot` allows attach or re-attach to report whether useful state was recovered.
12. `search_index_state` keeps track of whether local semantic retrieval is ready, stale, or warming.
13. `user_preferences` keeps high-signal durable preferences such as preferred package manager and pricing-first research behavior.
14. Sessions are cheap and disposable; agents should re-attach rather than rebuild state in-context.

## Response Contracts

### `attach`

Default output must be tiny and declarative:

```json
{
  "session_id": "ag_123",
  "window_id": "window:1",
  "workspace_id": "workspace:3",
  "pane_id": "pane:4",
  "surface_id": "surface:2",
  "backend_kind": "wk_dom",
  "layout_rev": 9,
  "page_rev": 17,
  "ref_epoch": 4,
  "title": "Checkout",
  "url": "http://localhost:3000/checkout",
  "ready_state": "interactive",
  "capabilities": {
    "native_pointer": false,
    "file_upload": false,
    "network_mocking": false,
    "cross_origin_frames": false
  }
}
```

### `layout`

Default output should give the agent the whole split structure in a compact tree:

```json
{
  "layout_rev": 10,
  "focused": {
    "window_id": "window:1",
    "workspace_id": "workspace:3",
    "pane_id": "pane:5",
    "surface_id": "surface:9"
  },
  "workspace": {
    "workspace_id": "workspace:3",
    "title": "app",
    "root": {
      "kind": "split",
      "axis": "horizontal",
      "children": [
        {
          "kind": "surface",
          "pane_id": "pane:4",
          "surface_id": "surface:2",
          "surface_kind": "terminal",
          "title": "server"
        },
        {
          "kind": "split",
          "axis": "vertical",
          "children": [
            {
              "kind": "surface",
              "pane_id": "pane:5",
              "surface_id": "surface:7",
              "surface_kind": "browser",
              "title": "localhost:3000"
            },
            {
              "kind": "surface",
              "pane_id": "pane:6",
              "surface_id": "surface:9",
              "surface_kind": "terminal",
              "title": "tests"
            }
          ]
        }
      ]
    }
  }
}
```

This is the key token-saving primitive for split panes. Codex should not need to call separate list APIs to infer whether the app is split vertically or horizontally.

### `capabilities`

`agent.capabilities` should be the one cheap discovery call that replaces shell probing, package-manager guesswork, and forgotten preference restatement.

Example:

```json
{
  "backend_kind": "wk_dom",
  "capabilities": {
    "native_pointer": false,
    "file_upload": false,
    "network_mocking": false
  },
  "environment": {
    "repo_root": "/repo",
    "package_manager": "bun",
    "tools": ["bun", "node", "tsc", "pytest"],
    "parsers": ["tsc", "pytest"],
    "profiles": ["verify.ts", "dev.web"],
    "default_new_terminal_cwd": "~/Desktop",
    "search_backend": "local_hybrid",
    "search_index_ready": false
  },
  "preferences": {
    "preferred_js_package_manager": "bun",
    "pricing_first_research": true,
    "stop_on_paid_option_without_approval": true
  },
  "policy": {
    "default_execution_class": "local_verify",
    "network_research_requires_pricing_check": true,
    "block_paid_or_billing_gated_work_without_approval": true,
    "block_unknown_pricing_before_deeper_research": true
  }
}
```

### `search.status`

Search status should be cheap enough to check at attach time or before a concept lookup:

```json
{
  "backend": "local_hybrid",
  "repo_root": "/repo",
  "ready": true,
  "stale": false,
  "indexed_file_count": 1824,
  "pending_change_count": 0
}
```

### `open`

Opening new surfaces should be high-level and intent-based:

1. `open terminal --split right`
2. `open terminal --split down`
3. `open browser --split right --url ...`
4. `open browser --split down --url ...`
5. `open terminal --workspace current`
6. `open browser --workspace <id>`

Example:

```json
{
  "ok": true,
  "layout_rev": 11,
  "pane_id": "pane:6",
  "surface_id": "surface:9",
  "surface_kind": "terminal",
  "split": "down",
  "focused": true
}
```

### `focus`

Focus changes should be explicit and cheap:

```json
{
  "ok": true,
  "layout_rev": 11,
  "pane_id": "pane:6",
  "surface_id": "surface:9",
  "focused": true
}
```

### `close`

Close responses should report the new focus target so the agent does not need a second discovery call:

```json
{
  "ok": true,
  "layout_rev": 12,
  "closed_surface_id": "surface:9",
  "focused_surface_id": "surface:7",
  "focused_pane_id": "pane:5"
}
```

### `surface.read`

For non-browser surfaces, the agent should read only compact metadata unless it asks for more:

1. `kind`
2. `title`
3. `cwd`
4. `running_command`
5. `focused`
6. `busy`
7. `last_exit_code`
8. `visible_rows`

Terminal output should default to the visible viewport or recent delta, not full scrollback.

### `task.run`

This is the preferred path for builds, tests, and verification commands.

Behavior:

1. creates or reuses a managed terminal surface owned by bmux
2. runs a command without streaming the full log back to the model
3. stores full logs on disk and in bmux state
4. optionally uses a parser adapter or named profile
5. preflights execution class, pricing state, and approval policy before side effects when external work is involved
6. returns a small job handle immediately when execution is allowed

Recommended fields:

1. `job_id`
2. `surface_id`
3. `label`
4. `status`
5. `log_path`
6. `parser`
7. `policy`
8. `execution_class`
9. `approval_state`
10. `package_manager`

Example:

```json
{
  "ok": true,
  "job_id": "job:3",
  "surface_id": "surface:12",
  "label": "typecheck",
  "status": "running",
  "log_path": "/tmp/bmux-jobs/job-3.log",
  "parser": "tsc",
  "policy": "managed",
  "execution_class": "local_verify",
  "approval_state": "not_required",
  "package_manager": "bun"
}
```

### `task.run_many`

This is the preferred path for parallel verification work.

Use cases:

1. `bun run build`
2. `bun run typecheck`
3. `flutter test`
4. `pytest`
5. shell scripts or project-specific checks

Example response:

```json
{
  "ok": true,
  "group_id": "group:1",
  "jobs": [
    {"job_id": "job:3", "label": "typecheck", "status": "running"},
    {"job_id": "job:4", "label": "build", "status": "running"}
  ]
}
```

### `task.run_profile`

Profiles or recipes reduce both token usage and operational mistakes.

Example profiles:

1. `verify.ts`
2. `verify.flutter`
3. `dev.web`
4. `ci.quick`

Example response:

```json
{
  "ok": true,
  "group_id": "group:2",
  "profile": "verify.ts",
  "execution_class": "local_verify",
  "approval_state": "not_required",
  "package_manager": "bun",
  "jobs": [
    {"job_id": "job:7", "label": "typecheck", "status": "running"},
    {"job_id": "job:8", "label": "build", "status": "running"}
  ]
}
```

If a profile or command would cross an approval gate, bmux should stop before work starts:

```json
{
  "ok": false,
  "code": "approval_required",
  "profile": "research.some-paid-tool",
  "execution_class": "billing_risk",
  "pricing_state": "paid",
  "message": "Pricing indicates this workflow is paid or billing-gated. Report this to the user before continuing."
}
```

When a safe cached result exists for the same workspace fingerprint, bmux may return:

```json
{
  "ok": true,
  "profile": "verify.ts",
  "status": "cached_ok",
  "workspace_fingerprint": "ws:2b9f8a",
  "summary": "No relevant changes since the last passing verify.ts run."
}
```

### `task.wait`

Waiters for managed jobs should not stream logs.

Supported patterns:

1. wait for one `job_id`
2. wait for a `group_id`
3. wait for `all`
4. optional `fail_fast`

Example:

```json
{
  "ok": true,
  "job_id": "job:3",
  "status": "completed",
  "exit_code": 0,
  "duration_ms": 18422
}
```

### `task.result`

Results should be tiny on success and only slightly larger on failure.

Success response:

```json
{
  "ok": true,
  "job_id": "job:3",
  "exit_code": 0,
  "duration_ms": 18422,
  "summary": "typecheck passed"
}
```

Failure response:

```json
{
  "ok": false,
  "job_id": "job:3",
  "exit_code": 1,
  "summary": "tsc found 3 errors",
  "tool": "tsc",
  "root_cause_count": 1,
  "diagnostics": [
    {
      "file": "src/app.ts",
      "line": 42,
      "column": 7,
      "code": "TS2322",
      "severity": "error",
      "message": "Type 'undefined' is not assignable to type 'string'.",
      "is_root_cause": true
    }
  ],
  "tail": [
    "src/app.ts:42:7 error TS2322: Type 'undefined' is not assignable to type 'string'."
  ],
  "log_path": "/tmp/bmux-jobs/job-3.log"
}
```

Rules:

1. prefer structured diagnostics over raw log lines
2. cap the diagnostic count
3. include a small tail only when it adds context
4. keep the full artifact on disk

### `task.logs`

The default result path should not expose logs.
Logs are a second-step debug primitive.

Rules:

1. return only on explicit request
2. support `tail`, `delta`, and `path-only`
3. cap bytes and line count
4. prefer `path-only` when a human can inspect locally

### `events`

Events are the low-token glue between jobs, services, layout, and browser state.

Example:

```json
{
  "event_cursor": 44,
  "events": [
    {
      "seq": 42,
      "type": "job.completed",
      "job_id": "job:3",
      "status": "completed",
      "exit_code": 0
    },
    {
      "seq": 43,
      "type": "service.ready",
      "port": 3000,
      "url": "http://localhost:3000"
    },
    {
      "seq": 44,
      "type": "session.recovered",
      "session_id": "ag_123"
    },
    {
      "seq": 45,
      "type": "search.index_ready",
      "backend": "local_hybrid"
    }
  ]
}
```

### `search`

Search should return a small number of high-confidence hits.

Example:

```json
{
  "query": "where auth is configured",
  "mode": "hybrid",
  "hits": [
    {
      "file": "src/auth/config.ts",
      "start_line": 12,
      "end_line": 34,
      "symbol": "configureAuth",
      "score": 0.93,
      "snippet": "export function configureAuth(...) { ... }"
    },
    {
      "file": "src/server/middleware.ts",
      "start_line": 55,
      "end_line": 78,
      "symbol": "authMiddleware",
      "score": 0.87,
      "snippet": "app.use(authMiddleware(...))"
    }
  ]
}
```

Rules:

1. default to 3 to 5 hits
2. cap snippet bytes aggressively
3. prefer symbol-aligned chunks when available
4. do not attach full file bodies

### `search.index`

Indexing should be explicit when needed, but cheap to inspect:

```json
{
  "ok": true,
  "backend": "local_hybrid",
  "status": "indexing",
  "repo_root": "/repo"
}
```

### `batch`

Batch requests should collapse a common setup flow into one compact exchange.

Example:

```json
{
  "ok": true,
  "steps": [
    {"kind": "ensure.service", "created": false, "service_id": "service:1"},
    {"kind": "service.wait", "ready": true, "port": 3000},
    {"kind": "ensure.browser", "created": true, "surface_id": "surface:7"}
  ]
}
```

### `ensure`

Ensure requests should be idempotent and cheap to repeat.

Example:

```json
{
  "ok": true,
  "target": "service",
  "created": false,
  "service_id": "service:1",
  "job_id": "job:9",
  "port": 3000
}
```

### `service.wait`

Service waiters should be first-class so Codex does not parse boot logs just to know a server is ready.

Example:

```json
{
  "ok": true,
  "service_id": "service:1",
  "port": 3000,
  "url": "http://localhost:3000",
  "ready": true
}
```

### `service.list`

Service state should be compact and actionable:

```json
{
  "services": [
    {
      "service_id": "service:1",
      "port": 3000,
      "url": "http://localhost:3000",
      "job_id": "job:9",
      "ready": true
    }
  ]
}
```

### `state.summary`

State summary should give Codex just enough server-side memory to resume work cheaply, including the highest-signal user preferences that change tool choice or research behavior:

```json
{
  "layout_rev": 14,
  "active_dev_server": {
    "job_id": "job:9",
    "port": 3000,
    "url": "http://localhost:3000"
  },
  "preferred_browser_surface": "surface:7",
  "last_failed_job": null,
  "workspace_fingerprint": "ws:2b9f8a",
  "user_preferences": {
    "preferred_js_package_manager": "bun",
    "pricing_first_research": true,
    "stop_on_paid_option_without_approval": true
  },
  "recovered": true
}
```

### `artifact.list`

Artifact reads should return metadata and ids, not the artifact contents:

```json
{
  "artifacts": [
    {
      "artifact_id": "artifact:12",
      "kind": "job.log",
      "job_id": "job:3",
      "path": "/tmp/bmux-jobs/job-3.log"
    }
  ]
}
```

### `task.cancel`

Managed jobs need explicit cancellation for long-running or hung checks.

Example:

```json
{
  "ok": true,
  "job_id": "job:3",
  "status": "cancelled"
}
```

### `terminal.write`

This is the canonical way for Codex to drive terminal surfaces:

1. accepts `surface_id`
2. accepts raw text
3. appends newline only when explicitly requested by the caller
4. returns immediately with an acknowledgement

Example:

```json
{
  "ok": true,
  "surface_id": "surface:9",
  "accepted_bytes": 12
}
```

### `terminal.capture`

This is the key token-saving terminal primitive.

Modes:

1. `viewport`
2. `delta`
3. `tail`

Rules:

1. `viewport` returns only currently visible rows.
2. `delta` returns only new output since the supplied cursor.
3. `tail` returns a bounded recent window.
4. no mode returns full scrollback unless explicitly requested.

Example:

```json
{
  "surface_id": "surface:9",
  "capture_cursor": 41,
  "rows": [
    "$ bun run dev",
    "ready - started server on http://localhost:3000"
  ],
  "has_more_before": false
}
```

### `terminal.wait`

The terminal side also needs a compact waiter so Codex does not poll repeatedly:

1. `--text`
2. `--regex`
3. `--quiet-ms`
4. `--exit-code-ready`

Example:

```json
{
  "ok": true,
  "surface_id": "surface:9",
  "matched": "started server",
  "capture_cursor": 41
}
```

### `observe`

Default scope should return only interaction-relevant nodes, not the whole DOM:

1. `ref`
2. `role`
3. `name`
4. `text_preview`
5. `state` such as `visible`, `enabled`, `checked`, `focused`
6. `in_viewport`
7. `children_hint`

Recommended options:

1. `--scope interactive|content|viewport|selector`
2. `--limit 32`
3. `--since-rev <n>`
4. `--max-depth <n>`
5. `--include-box`

Example:

```json
{
  "page_rev": 18,
  "ref_epoch": 4,
  "nodes": [
    {
      "ref": "e12",
      "role": "button",
      "name": "Place order",
      "text_preview": "Place order",
      "visible": true,
      "enabled": true,
      "in_viewport": true
    }
  ]
}
```

### `act`

Actions should return acknowledgements, not snapshots:

```json
{
  "ok": true,
  "page_rev": 18,
  "ref_epoch": 4,
  "changed": ["e12", "e20"],
  "focus_ref": "e20"
}
```

### `read`

Use small targeted getters instead of general snapshots:

1. `text`
2. `value`
3. `checked`
4. `enabled`
5. `visible`
6. `box`
7. `styles`
8. `url`
9. `title`

### `logs`

Log reads must be cursor-based and incremental:

```json
{
  "console_cursor": 44,
  "entries": [
    {
      "seq": 42,
      "level": "error",
      "text": "Failed to fetch"
    }
  ]
}
```

### `artifact`

Artifacts should default to file paths:

1. screenshots write to disk and return `path`
2. recordings write to disk and return `path`
3. base64 output is opt-in only

## Token Budget Rules

The agent protocol should be cheap by default:

1. `attach` target: under 1 KB.
2. `layout` target: under 2 KB for common split trees.
3. `open`, `focus`, and `close` targets: under 512 bytes unless an error requires more detail.
4. `task.run`, `task.wait`, and `task.cancel` targets: under 512 bytes.
5. `task.result` success target: under 512 bytes.
6. `task.result` failure target: under 2 KB with a bounded tail.
7. `events` target: under 2 KB for routine polling.
8. `service.wait` and `state.summary` targets: under 1 KB.
9. `capabilities`, `ensure`, and `artifact.list` targets: under 1 KB.
10. `search.status` target: under 512 bytes.
11. `search` target: under 2 KB for the default hit count.
12. `batch` target: under 2 KB for common setup sequences.
13. `act` target: under 512 bytes unless an error requires more detail.
14. `terminal.write` target: under 256 bytes.
15. `terminal.capture` target: under 4 KB by default.
16. `observe` target: under 4 KB by default.
17. `logs` target: cursor-based and capped by entry count and byte size.
18. `artifact` target: no inline binary payloads unless explicitly requested.

The model should not need to repeatedly ask for:

1. full HTML
2. full page text
3. full terminal scrollback
4. full console history
5. full screenshots after every action
6. separate verbose list calls just to reconstruct split layout
7. full build or test logs when a simple `ok` would do
8. repeated “is the server ready yet?” polling against raw terminal output
9. repeated shell probing to discover whether `bun`, `flutter`, or `pytest` exists
10. repeated recreation of the same browser, split, or dev server after a retry
11. repeated shotgun `grep` guesses for concept-level questions

## Error Contract

Every `agent.*` command should return short, typed errors so Codex can recover without seeing a long stack trace.

Recommended error codes:

1. `not_found`
2. `stale_ref`
3. `stale_layout`
4. `invalid_target`
5. `unsupported_surface_kind`
6. `not_supported`
7. `timeout`
8. `busy`
9. `service_not_ready`
10. `parser_unavailable`
11. `already_satisfied`
12. `cache_miss`
13. `redacted`
14. `index_missing`
15. `index_stale`
16. `search_backend_unavailable`
17. `approval_required`
18. `pricing_unknown`
19. `paid_option_detected`
20. `network_disallowed`

Example:

```json
{
  "ok": false,
  "code": "stale_layout",
  "message": "layout_rev is outdated",
  "layout_rev": 12
}
```

Approval-gated example:

```json
{
  "ok": false,
  "code": "approval_required",
  "execution_class": "billing_risk",
  "pricing_state": "paid",
  "message": "Pricing indicates this workflow is paid or billing-gated. Report this to the user before continuing."
}
```

## Agent Loop

The expected low-token loop is:

1. `attach`
2. `layout`
3. `capabilities`
4. if the next step involves an external tool or service, apply the pricing and approval gate first
5. `ensure` or `open` or `focus`
6. `batch` for common setup flows
7. `task.run` for build, test, or verification work
8. `events` or `task.wait`
9. `task.result`
10. `service.wait` when a server or preview must come up
11. `state.summary`
12. `search` for concept lookup when exact names are unknown
13. `surface.read`
14. `terminal.write` or `browser.agent.observe`
15. `terminal.capture` or `browser.agent.act`
16. `wait`
17. `browser.agent.read`
18. `artifact.list` only when needed
19. `logs` only when needed
20. `artifact` only for debugging or human review

This replaces the current anti-pattern of:

1. `window.list`
2. `workspace.list`
3. `pane.list`
4. `pane.surfaces`
5. streaming full test logs into model context
6. `snapshot`
7. `snapshot`

## Backend Strategy

### Phase 1: `wk_dom`

Use the existing `WKWebView` backend, but expose its limits explicitly:

1. `native_pointer = false`
2. `touch = false`
3. `file_upload = false`
4. `network_mocking = false`
5. `cross_origin_frames = false`

This is still enough for many FE workflows:

1. navigation
2. form fill and submit
3. DOM querying
4. text verification
5. screenshots
6. console and error inspection

### Phase 2: better state and deltas

Improve the `WKWebView` path without changing backends:

1. add `page_rev` and `ref_epoch`
2. remove automatic post-action snapshot behavior in agent mode
3. add incremental console and error cursors
4. add compact `observe` scopes
5. return artifacts by path

### Phase 3: optional `chromium_cdp`

Add a pluggable backend for full-fidelity interactions that `WKWebView` does not support well:

1. drag and drop
2. canvas and coordinate-based interactions
3. native pointer and keyboard sequences
4. file upload automation
5. viewport and device emulation
6. network interception and offline mode
7. cross-origin iframe control

The protocol should remain the same. Only `backend_kind` and `capabilities` change.

## Implementation Map

Initial implementation can build on existing pieces:

1. CLI command routing in [CLI/bmux.swift](/Users/macbook/Desktop/Me/TOOLs/bmux/CLI/bmux.swift)
2. browser socket handlers in [Sources/TerminalController.swift](/Users/macbook/Desktop/Me/TOOLs/bmux/Sources/TerminalController.swift)
3. navigation lifecycle hooks in [Sources/Panels/BrowserPanel.swift](/Users/macbook/Desktop/Me/TOOLs/bmux/Sources/Panels/BrowserPanel.swift)
4. existing split and creation primitives such as `workspace.create`, `surface.split`, `surface.create`, `pane.list`, `pane.surfaces`, and `browser.open_split`
5. existing terminal-side primitives such as `surface.send_text`, `surface.send_key`, and screen/report commands where a compact agent wrapper can be layered on top

Likely work split:

1. add session state and compact methods in `TerminalController`
2. add thin CLI wrappers in `CLI/bmux.swift`
3. derive a compact layout tree from existing pane and surface state
4. add a managed job registry, artifact registry, and event cursor store
5. add environment discovery and workspace fingerprint helpers
6. add an execution-policy evaluator for package-manager preference, pricing-first research, and approval gates
7. add a local search index and repo-fingerprint invalidation path
8. reuse browser telemetry and navigation hooks for `page_rev` updates
9. keep legacy verbose commands for human debugging

## Rollout Plan

### Milestone 1

1. Add `agent.attach`, `agent.layout`, `agent.capabilities`, `agent.open`, `agent.ensure`, `agent.batch`, `agent.focus`, and `agent.surface.read`.
2. Support split intents: `right`, `left`, `up`, and `down`.
3. Add `agent.task.run`, `agent.task.wait`, `agent.task.result`, `agent.task.logs`, and `agent.task.cancel`.
4. Add `agent.terminal.write`, `agent.terminal.capture`, and `agent.terminal.wait`.
5. Add structured diagnostics adapters for the most common tools.
6. Add `layout_rev`, `page_rev`, `ref_epoch`, log cursors, and event cursors.
7. Add execution-class preflight and approval-gate behavior for external or billing-risk workflows.
8. Keep responses terse and stable for Codex.

### Milestone 1 Checklist

Server and model state:

1. add an `AgentSession` model keyed by `session_id`
2. store `window_id`, `workspace_id`, `pane_id`, `surface_id`, `layout_rev`, event cursor, service registry, artifact registry, workspace fingerprint, terminal capture cursors, user preferences, and effective execution policy
3. invalidate or refresh session state on split, close, move, focus changes, job churn, and recovery events

Socket methods:

1. implement `agent.attach`
2. implement `agent.layout`
3. implement `agent.capabilities`
4. implement `agent.open`
5. implement `agent.ensure`
6. implement `agent.batch`
7. implement `agent.focus`
8. implement `agent.close`
9. implement `agent.surface.read`
10. implement `agent.task.run`
11. implement `agent.task.wait`
12. implement `agent.task.result`
13. implement `agent.task.logs`
14. implement `agent.task.cancel`
15. implement `agent.terminal.write`
16. implement `agent.terminal.capture`
17. implement `agent.terminal.wait`
18. implement `agent.events`
19. implement `agent.service.wait`
20. implement `agent.service.list`
21. implement `agent.state.summary`
22. implement `agent.artifact.list`

Layout model:

1. derive a compact split tree from the current workspace
2. include split axis and focused node in one response
3. include only agent-relevant surface metadata: `surface_id`, `surface_kind`, `title`, `pane_id`
4. keep layout responses bounded and deterministic
5. make duplicate-title disambiguation deterministic within the chosen scope
6. surface the active package-manager and pricing policy in one cheap discovery call

Terminal model:

1. define a stable capture cursor format
2. support `viewport`, `delta`, and `tail`
3. cap returned rows and bytes per call
4. add a quiet waiter and text waiter for terminal workflows
5. respect the default cwd and title policy when no explicit cwd is supplied

Task model:

1. define `job_id` and optional `group_id`
2. define a managed-job lifecycle: `running`, `completed`, `failed`, `cancelled`
3. persist `log_path`, `exit_code`, `duration_ms`, and short `summary`
4. keep success payloads tiny and failure payloads bounded
5. support a mode where jobs open visible surfaces only on failure
6. add parser adapters and root-cause reduction before returning failures
7. add workspace fingerprint caching for safe profiles
8. add bounded retry metadata for transient failures
9. redact secrets before returning tails or diagnostics
10. block paid or pricing-unknown external workflows before side effects unless policy allows them

CLI:

1. add `bmux agent attach`
2. add `bmux agent layout`
3. add `bmux agent capabilities`
4. add `bmux agent open terminal`
5. add `bmux agent open browser`
6. add `bmux agent ensure`
7. add `bmux agent batch`
8. add `bmux agent focus`
9. add `bmux agent close`
10. add `bmux agent surface read`
11. add `bmux agent task run`
12. add `bmux agent task run-many`
13. add `bmux agent task wait`
14. add `bmux agent task result`
15. add `bmux agent task logs`
16. add `bmux agent task cancel`
17. add `bmux agent events`
18. add `bmux agent service wait`
19. add `bmux agent service list`
20. add `bmux agent state summary`
21. add `bmux agent artifact list`
22. add `bmux agent terminal write`
23. add `bmux agent terminal capture`
24. add `bmux agent terminal wait`

Output contracts:

1. make `--json` the default shape for all `agent.*` examples and skills
2. keep success responses short and typed
3. keep error responses short with machine-friendly codes
4. never attach full scrollback or full layout dumps by default
5. redact secrets before any payload crosses the agent boundary

Agent enablement:

1. update the bmux core skill to prefer `agent.*`
2. add one short reference page for the default Codex loop
3. document one standard workflow: run build and typecheck in parallel, return only failures
4. document one standard workflow: open split, run server, wait for ready text, open browser
5. document one standard workflow: attach, inspect capabilities, and use `ensure` instead of recreating resources
6. document one standard workflow: check pricing first for an external tool and stop immediately when the intended option is paid unless the user approves
7. document one standard workflow: prefer `bun`, but explain the exact fallback when project constraints force another package manager

App integration:

1. expose managed jobs and service readiness through existing app UI patterns where possible
2. add reveal-on-fail behavior for managed terminals
3. make `Cmd+N` default to `~/Desktop` when no explicit cwd is provided
4. derive initial titles from basename, not full path
5. disambiguate duplicate titles by prepending parent path segments

### Milestone 2

1. Add richer `agent.events` coverage for layout, jobs, browser, and services.
2. Add service discovery and health-check support robust enough for FE dev servers.
3. Add profile or recipe support for common workflows such as `verify.ts` and `dev.web`.
4. Add failure-first artifact capture and path-based retrieval.
5. Add in-app managed job UX, service badges, and failure-first notifications.
6. Add workspace fingerprint caching for safe verify profiles.
7. Add secret redaction, transient retry policy, and recovery events.
8. Add local-first `agent.search`, `agent.search.index`, and `agent.search.status`.
9. Add policy-aware external research flows and approval-shaped responses for paid or pricing-unknown tools.
10. Add documentation and examples for event-driven Codex loops.

### Milestone 3

1. Add `browser.agent.*` for compact browser interaction on top of the generic agent session.
2. Add compact `act` responses for navigation and common DOM actions.
3. Add artifact-by-path support for browser failures.
4. Add documentation and examples for browser-specific Codex loops.

### Milestone 4

1. Measure real token usage from FE and verification tasks.
2. Decide whether the `WKWebView` backend is sufficient for daily agent work.
3. If not, add a pluggable full-fidelity backend with the same protocol.

## Agent Enablement

Making bmux "ready for Codex" is not only an API task. It also needs one canonical teaching path.

Deliverables after the CLI exists:

1. update the core skill to prefer `agent.*` over legacy verbose list commands
2. add one short reference page with the default Codex loop
3. include 3 to 5 end-to-end examples: run build and typecheck in parallel, wait via events, inspect only failures
4. include one FE example: run dev server, wait for service, open browser, verify app
5. document app-level defaults such as `Cmd+N -> ~/Desktop` and duplicate-title disambiguation
6. include one idempotent example using `capabilities`, `ensure`, and `batch`
7. include one semantic lookup example using `agent.search` before falling back to `rg`
8. include one example where `bun` is preferred by policy but a fallback package manager is chosen with a brief explanation
9. keep legacy CLI docs for humans, but clearly mark `agent.*` as the preferred interface for coding agents

## Open Questions

1. Should `agent.layout` expose exact split ratios, or should it stay semantic only at first?
2. Should `observe` support both accessibility-tree and DOM-tree projections, or only one canonical view?
3. Should element refs survive soft DOM updates when a stable DOM identity is available?
4. What is the right eviction policy for idle agent sessions?
5. Should screenshots be attached to a surface history ring for human inspection in the app?
6. Do we want a separate `Codex mode` CLI flag, or should `agent` imply compact behavior by default?
7. Which tool adapters should ship in the first structured diagnostics set?
8. Should managed jobs reveal their surfaces automatically on failure, or stay hidden unless asked?
9. Should duplicate-title disambiguation apply only within one workspace, or across the full window?
10. Which resource types should `agent.ensure` support in Milestone 1 versus Milestone 2?
11. Which inputs belong in the first workspace fingerprint implementation?
12. How aggressive should redaction be before it starts hiding information that is still useful for debugging?
13. Which local backend should power `agent.search`: sqlite FTS, a vector index, or a hybrid of both?
14. Should GitNexus participate as an optional reranker or separate companion path for `agent.search`?
15. Should user preferences such as package-manager policy and pricing-first research live in bmux app settings, Codex instructions, or both?
16. Should unknown pricing block by default, or only when a workflow would likely cross a paid external boundary?
17. Where should pricing metadata come from for external tools: manual profile metadata, web research, or both?
