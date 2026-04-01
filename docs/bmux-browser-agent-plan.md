# bmux Browser Agent Plan

Last updated: April 2, 2026

This document proposes a token-efficient browser control layer for bmux agents such as Codex.
It is complementary to [docs/agent-browser-port-spec.md](/Users/macbook/Desktop/Me/TOOLs/bmux/docs/agent-browser-port-spec.md), which focuses on command-surface parity. This plan focuses on response shape, statefulness, and backend strategy.

## Outcome

1. The browser remains a real browser surface inside the bmux window.
2. The terminal remains the control plane: agents drive the browser through CLI/socket commands.
3. Default agent interactions stay small enough to avoid burning tokens on repeated snapshots.
4. The protocol shape stays stable across backends, even if bmux later adds a full-fidelity Chromium/CDP executor.

## Non-Goals

1. Do not turn the browser into a text-only terminal UI.
2. Do not force Playwright-level parity on the current `WKWebView` backend.
3. Do not make screenshots, full DOM dumps, or full-page text the default read path.
4. Do not break the current human-oriented `browser.*` CLI for debugging.

## Current Problems

Today the browser automation surface is useful, but it is not cheap for LLM loops:

1. `browser.snapshot --json` includes large payloads such as full page text and HTML.
2. `browser.console.list` and `browser.errors.list` read full client-side log buffers each time.
3. Action responses can include post-action snapshots, which is convenient for humans but wasteful for agents.
4. The protocol has no first-class `page_rev` or `ref_epoch`, so agents cannot safely cache state between calls.
5. The current `WKWebView` implementation uses DOM-oriented event dispatch for many actions, which is not equivalent to native pointer and keyboard input.

## Design Principles

1. Make the protocol stateful on the server side, not in the model context.
2. Prefer stable refs over repeated selector or text matching.
3. Return deltas and acknowledgements by default, not refreshed full-page views.
4. Return artifacts by filesystem path, not inline base64, unless explicitly requested.
5. Advertise backend limits honestly so the caller can escalate only when needed.

## Proposed Surface

Add a dedicated agent namespace over the existing browser surface:

1. `browser.agent.attach`
2. `browser.agent.observe`
3. `browser.agent.act`
4. `browser.agent.read`
5. `browser.agent.wait`
6. `browser.agent.logs`
7. `browser.agent.artifact`
8. `browser.agent.capabilities`

Suggested CLI wrappers:

```bash
bmux browser agent attach --surface surface:2 --json
bmux browser agent observe --session ba_123 --scope interactive --json
bmux browser agent act --session ba_123 click --ref e12 --json
bmux browser agent wait --session ba_123 --ref e20 --state visible --timeout-ms 5000 --json
bmux browser agent read --session ba_123 --ref e20 --fields text,value,enabled --json
bmux browser agent logs --session ba_123 --since 41 --json
bmux browser agent artifact --session ba_123 screenshot --out /tmp/fail.png --json
```

## Session Model

Each attached agent session should maintain server-side state:

1. `session_id`
2. `surface_id`
3. `backend_kind`
4. `page_rev`
5. `ref_epoch`
6. `console_cursor`
7. `error_cursor`
8. `last_focus_ref`

Rules:

1. `page_rev` increments for meaningful DOM or navigation changes.
2. `ref_epoch` changes when previous element refs are no longer safe to reuse.
3. `console_cursor` and `error_cursor` allow incremental reads without replaying old logs.
4. Sessions are cheap and disposable; agents should re-attach rather than rebuild state in-context.

## Response Contracts

### `attach`

Default output must be tiny and declarative:

```json
{
  "session_id": "ba_123",
  "surface_ref": "surface:2",
  "backend_kind": "wk_dom",
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
2. `act` target: under 512 bytes unless an error requires more detail.
3. `observe` target: under 4 KB by default.
4. `logs` target: cursor-based and capped by entry count and byte size.
5. `artifact` target: no inline binary payloads unless explicitly requested.

The model should not need to repeatedly ask for:

1. full HTML
2. full page text
3. full console history
4. full screenshots after every action

## Agent Loop

The expected low-token loop is:

1. `attach`
2. `observe`
3. `act`
4. `wait`
5. `read`
6. `logs` only when needed
7. `artifact` only for debugging or human review

This replaces the current anti-pattern of:

1. `snapshot`
2. `snapshot`
3. `snapshot`

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

Likely work split:

1. add session state and compact methods in `TerminalController`
2. add thin CLI wrappers in `CLI/bmux.swift`
3. reuse browser telemetry and navigation hooks for `page_rev` updates
4. keep legacy `browser.snapshot` for human debugging

## Rollout Plan

### Milestone 1

1. Add the `browser.agent.*` namespace.
2. Implement `attach`, `observe`, `read`, `wait`, and `logs`.
3. Add `page_rev`, `ref_epoch`, and log cursors.
4. Disable automatic post-action snapshot output in agent mode.

### Milestone 2

1. Add compact `act` responses for navigation and common DOM actions.
2. Add artifact-by-path support.
3. Add byte and entry caps to all agent responses.
4. Add documentation and examples for the default Codex loop.

### Milestone 3

1. Measure real token usage from a few FE tasks.
2. Decide whether the `WKWebView` backend is sufficient for daily agent work.
3. If not, add a pluggable full-fidelity backend with the same protocol.

## Open Questions

1. Should `observe` support both accessibility-tree and DOM-tree projections, or only one canonical view?
2. Should element refs survive soft DOM updates when a stable DOM identity is available?
3. What is the right eviction policy for idle agent sessions?
4. Should screenshots be attached to a surface history ring for human inspection in the app?
5. Do we want a separate `Codex mode` CLI flag, or should `browser agent` imply compact behavior by default?
