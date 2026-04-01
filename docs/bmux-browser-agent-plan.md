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

## Proposed Surface

Add a dedicated agent namespace over the existing bmux control surface:

1. `agent.attach`
2. `agent.layout`
3. `agent.open`
4. `agent.focus`
5. `agent.close`
6. `agent.wait`
7. `agent.surface.read`
8. `agent.terminal.write`
9. `agent.terminal.capture`
10. `agent.terminal.wait`
11. `browser.agent.observe`
12. `browser.agent.act`
13. `browser.agent.read`
14. `browser.agent.logs`
15. `browser.agent.artifact`
16. `agent.capabilities`

Suggested CLI wrappers:

```bash
bmux agent attach --json
bmux agent layout --session ag_123 --compact --json
bmux agent open terminal --session ag_123 --split right --cwd /repo --json
bmux agent open browser --session ag_123 --split down --url http://localhost:3000 --json
bmux agent focus --session ag_123 --surface surface:9 --json
bmux agent surface read --session ag_123 --surface surface:9 --fields kind,title,cwd,command --json
bmux agent terminal write --session ag_123 --surface surface:9 --text "npm run dev\n" --json
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
4. focus and close surfaces deterministically
5. send text to terminal surfaces
6. capture only visible or delta terminal output
7. wait for terminal predicates without polling huge buffers

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
4. focus a specific pane or surface
5. close a surface or pane
6. read minimal state from the focused surface
7. write to a terminal surface
8. capture terminal output as viewport or delta

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
5. `agent.surface.read`
6. `agent.terminal.write`
7. `agent.terminal.capture`
8. `agent.wait`
9. `browser.agent.*` only when the target surface is a browser

This keeps both prompts and responses small, and it also gives bmux a single stable operating model for future agent skills and documentation.

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

Rules:

1. `layout_rev` increments for structural changes such as split, close, move, or focus changes that matter to the agent.
2. `page_rev` increments for meaningful DOM or navigation changes.
3. `ref_epoch` changes when previous element refs are no longer safe to reuse.
4. `console_cursor` and `error_cursor` allow incremental reads without replaying old logs.
5. Sessions are cheap and disposable; agents should re-attach rather than rebuild state in-context.

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
    "$ npm run dev",
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
4. `act` target: under 512 bytes unless an error requires more detail.
5. `terminal.write` target: under 256 bytes.
6. `terminal.capture` target: under 4 KB by default.
7. `observe` target: under 4 KB by default.
8. `logs` target: cursor-based and capped by entry count and byte size.
9. `artifact` target: no inline binary payloads unless explicitly requested.

The model should not need to repeatedly ask for:

1. full HTML
2. full page text
3. full terminal scrollback
4. full console history
5. full screenshots after every action
6. separate verbose list calls just to reconstruct split layout

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

Example:

```json
{
  "ok": false,
  "code": "stale_layout",
  "message": "layout_rev is outdated",
  "layout_rev": 12
}
```

## Agent Loop

The expected low-token loop is:

1. `attach`
2. `layout`
3. `open` or `focus`
4. `surface.read`
5. `terminal.write` or `browser.agent.observe`
6. `terminal.capture` or `browser.agent.act`
7. `wait`
8. `browser.agent.read`
9. `logs` only when needed
10. `artifact` only for debugging or human review

This replaces the current anti-pattern of:

1. `window.list`
2. `workspace.list`
3. `pane.list`
4. `pane.surfaces`
5. `snapshot`
6. `snapshot`

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
4. reuse browser telemetry and navigation hooks for `page_rev` updates
5. keep legacy verbose commands for human debugging

## Rollout Plan

### Milestone 1

1. Add `agent.attach`, `agent.layout`, `agent.open`, `agent.focus`, and `agent.surface.read`.
2. Support split intents: `right`, `left`, `up`, and `down`.
3. Add `agent.terminal.write`, `agent.terminal.capture`, and `agent.terminal.wait`.
4. Add `layout_rev`, `page_rev`, `ref_epoch`, and log cursors.
5. Keep responses terse and stable for Codex.

### Milestone 1 Checklist

Server and model state:

1. add an `AgentSession` model keyed by `session_id`
2. store `window_id`, `workspace_id`, `pane_id`, `surface_id`, `layout_rev`, and terminal capture cursors
3. invalidate or refresh session state on split, close, move, and focus changes

Socket methods:

1. implement `agent.attach`
2. implement `agent.layout`
3. implement `agent.open`
4. implement `agent.focus`
5. implement `agent.close`
6. implement `agent.surface.read`
7. implement `agent.terminal.write`
8. implement `agent.terminal.capture`
9. implement `agent.terminal.wait`

Layout model:

1. derive a compact split tree from the current workspace
2. include split axis and focused node in one response
3. include only agent-relevant surface metadata: `surface_id`, `surface_kind`, `title`, `pane_id`
4. keep layout responses bounded and deterministic

Terminal model:

1. define a stable capture cursor format
2. support `viewport`, `delta`, and `tail`
3. cap returned rows and bytes per call
4. add a quiet waiter and text waiter for terminal workflows

CLI:

1. add `bmux agent attach`
2. add `bmux agent layout`
3. add `bmux agent open terminal`
4. add `bmux agent open browser`
5. add `bmux agent focus`
6. add `bmux agent close`
7. add `bmux agent surface read`
8. add `bmux agent terminal write`
9. add `bmux agent terminal capture`
10. add `bmux agent terminal wait`

Output contracts:

1. make `--json` the default shape for all `agent.*` examples and skills
2. keep success responses short and typed
3. keep error responses short with machine-friendly codes
4. never attach full scrollback or full layout dumps by default

Agent enablement:

1. update the bmux core skill to prefer `agent.*`
2. add one short reference page for the default Codex loop
3. document one standard workflow: open split, run server, wait for ready text, open browser

### Milestone 2

1. Add `browser.agent.*` for compact browser interaction on top of the generic agent session.
2. Add compact `act` responses for navigation and common DOM actions.
3. Add artifact-by-path support.
4. Add byte and entry caps to all agent responses.
5. Add documentation and examples for the default Codex loop.

### Milestone 3

1. Measure real token usage from a few FE tasks.
2. Decide whether the `WKWebView` backend is sufficient for daily agent work.
3. If not, add a pluggable full-fidelity backend with the same protocol.

## Agent Enablement

Making bmux "ready for Codex" is not only an API task. It also needs one canonical teaching path.

Deliverables after the CLI exists:

1. update the core skill to prefer `agent.*` over legacy verbose list commands
2. add one short reference page with the default Codex loop
3. include 3 to 5 end-to-end examples: open split, run dev server, wait for server, open browser, verify app
4. keep legacy CLI docs for humans, but clearly mark `agent.*` as the preferred interface for coding agents

## Open Questions

1. Should `agent.layout` expose exact split ratios, or should it stay semantic only at first?
2. Should `observe` support both accessibility-tree and DOM-tree projections, or only one canonical view?
3. Should element refs survive soft DOM updates when a stable DOM identity is available?
4. What is the right eviction policy for idle agent sessions?
5. Should screenshots be attached to a surface history ring for human inspection in the app?
6. Do we want a separate `Codex mode` CLI flag, or should `agent` imply compact behavior by default?
