# Codex + bmux Smoke Test

Last updated: April 3, 2026

This guide verifies the current bmux + Codex setup after a clean restart.

Use it after:

1. quitting Codex
2. quitting bmux
3. reopening `/Applications/bmux.app`
4. reopening Codex

The goal is to verify:

1. Codex sees the global `$bmux-agent` skill
2. Codex sees the local `bmux` plugin and its MCP tools
3. bmux core agent flows work end-to-end
4. managed task flows stay compact and token-efficient
5. service, search, and browser flows work at least as smoke coverage
6. the app does not regress into pane explosion, UI churn, or RAM runaway

## Preflight

Before starting, make sure these paths still exist:

1. `/Users/macbook/.codex/skills/bmux-agent/SKILL.md`
2. `/Users/macbook/plugins/bmux/.codex-plugin/plugin.json`
3. `/Users/macbook/plugins/bmux/.mcp.json`
4. `/Users/macbook/plugins/bmux/scripts/bmux-mcp.ts`
5. `/Users/macbook/.agents/plugins/marketplace.json`

Expected runtime defaults:

1. current bmux CLI is auto-discovered from `BMUX_CLI` or `bmux`
2. current bmux socket is auto-discovered from `BMUX_SOCKET_PATH`, `CMUX_SOCKET_PATH`, `/tmp/bmux-last-socket-path`, or `/tmp/cmux-last-socket-path`
3. JavaScript package manager preference is `bun`
4. pricing-first behavior is enabled in global Codex instructions

## Restart Sequence

1. Quit Codex completely.
2. Quit the running bmux app completely.
3. Launch `/Applications/bmux.app`.
4. Open a clean workspace.
5. Open Codex again.

Expected result:

1. Codex starts with the updated global instructions.
2. bmux opens without restoring a broken pane storm.
3. the sidebar and terminal rendering look normal
4. no immediate RAM spike or UI churn appears

Stop here if:

1. bmux opens with dozens of panes again
2. tab titles start thrashing
3. text rendering looks crushed or continuously relayouts
4. memory starts climbing abnormally before any smoke steps

## Phase 1: Plugin Discovery

Ask Codex to verify that the bmux MCP plugin is visible.

Suggested prompt:

```text
Check whether the local bmux MCP plugin is available, and list the first several bmux MCP tools you can see. Do not run any heavy actions yet.
```

Pass criteria:

1. Codex acknowledges the local `bmux` plugin or `bmux_*` MCP tools
2. tool names include at least:
   `bmux_connection_status`, `bmux_attach`, `bmux_capabilities`, `bmux_layout`, `bmux_task_run`

Fail criteria:

1. Codex only talks about shell commands and cannot see MCP tools
2. Codex does not mention the `$bmux-agent` skill or bmux MCP tools at all

If this fails:

1. restart Codex once more
2. confirm the plugin files still exist
3. confirm marketplace file still points to `./plugins/bmux`

## Phase 2: Connection Smoke

Suggested prompt:

```text
Use the bmux MCP tools. First call bmux_connection_status, then bmux_attach, then bmux_capabilities. Keep everything compact.
```

Pass criteria:

1. `bmux_connection_status` returns a CLI path and socket path
2. `bmux_attach` returns a real `session_id`
3. `bmux_capabilities` returns:
   `backend_kind`
   `preferences.preferred_js_package_manager = bun`
   pricing-first policy flags
   `split_visibility_guard`

Important expected details:

1. backend is currently `bmux_native`
2. browser capability limits still show:
   `native_pointer = false`
   `file_upload = false`
   `network_mocking = false`
   `cross_origin_frames = false`

Fail criteria:

1. attach cannot connect to the socket
2. capabilities hangs
3. capabilities causes a memory spike

## Phase 3: Layout and Surface Control

Suggested prompt:

```text
Using bmux MCP tools only, attach if needed, fetch the compact layout, open one terminal split to the right, then fetch layout again and summarize what changed.
```

Pass criteria:

1. `bmux_layout` returns a compact tree
2. `bmux_open` succeeds for a terminal surface
3. second layout shows a real topology change
4. Codex does not dump huge raw payloads

Then test focus and read:

```text
Focus the newly opened terminal, then read its compact surface metadata.
```

Pass criteria:

1. `bmux_focus` succeeds
2. `bmux_surface_read` returns small metadata like title, cwd, kind, refs

Fail criteria:

1. unexpected pane explosion
2. repeated splits that make content unreadable
3. huge layout dumps by default

## Phase 4: Visible Split Guard

This specifically checks the recent fix that prevents bmux from creating absurdly small visible panes.

Suggested prompt:

```text
Keep opening additional terminal tasks or surfaces with split=right until bmux refuses to create another visible pane. Report when the visibility guard falls back to a pane tab.
```

Pass criteria:

1. bmux allows a reasonable first split
2. bmux eventually returns a guard response instead of creating unusable panes
3. the fallback indicates tab-style placement rather than another visible split
4. the UI remains readable

Expected behavior:

1. guard policy exposes:
   `minimum_visible_width_px = 320`
   `minimum_visible_height_px = 200`
   fallback `pane_tab`

Fail criteria:

1. bmux keeps splitting until panes become useless
2. UI becomes laggy or visibly broken
3. content becomes unreadable because every split is still forced

## Phase 5: Managed Task Flow

This is the most important Codex workflow.

Suggested prompt:

```text
Use bmux MCP tools to run `pwd` as a managed task in the repo, wait for it, then fetch task result. Only fetch logs if the task fails.
```

Pass criteria:

1. `bmux_task_run` returns a top-level `job_id`
2. `bmux_task_wait` succeeds
3. `bmux_task_result` succeeds
4. success is compact and does not include large logs

Then run a Bun-native verify-style task:

```text
Run a managed bmux task with `bun --version`, wait for it, and return only the compact result.
```

Pass criteria:

1. task succeeds
2. Codex does not ask for logs unnecessarily
3. output remains small

Then force a failure:

```text
Run a managed bmux task with a clearly failing command such as `bun x definitely-not-a-real-command`, wait for it, fetch compact result, and only then fetch logs.
```

Pass criteria:

1. `bmux_task_result` shows failure summary first
2. `bmux_task_logs` is only called after failure
3. failure payload stays bounded

Fail criteria:

1. Codex jumps straight to full logs every time
2. `job_id` is missing
3. task remains stuck in `queued` or `running`
4. success path still includes noisy logs

## Phase 6: Event Stream

Suggested prompt:

```text
Use bmux events to watch task state changes instead of polling terminal output. Show me the latest task-related events only.
```

Pass criteria:

1. `bmux_events` returns compact event entries
2. Codex uses events instead of repeatedly capturing terminal output
3. task flow shows `task.started` and `task.completed`

Fail criteria:

1. Codex ignores events and polls noisy terminal output
2. event cursor handling looks broken or duplicates forever

## Phase 7: Service Readiness

Start a trivial local server in a managed terminal first, then wait on it.

Suggested prompt:

```text
Use bmux to start a lightweight local HTTP server on a free port in a managed task, then wait for that service port and confirm readiness without reading raw logs.
```

Pass criteria:

1. `bmux_task_run` launches the service task
2. `bmux_service_wait` succeeds on the chosen port
3. `bmux_service_list` can show the detected service
4. Codex does not parse boot logs manually

Fail criteria:

1. service wait never resolves even though the port is live
2. Codex has to fallback to raw terminal log scraping

## Phase 8: Search Flow

Suggested prompt:

```text
Use bmux search tools only. Check search status, trigger indexing if needed, then query for agent task logic in the bmux repo. Keep the output bounded.
```

Pass criteria:

1. `bmux_search_status` returns cleanly
2. `bmux_search_index` returns cleanly
3. `bmux_search_query` returns bounded hits
4. Codex does not replace intent search with giant `rg` spam unless exact matching is needed

Fail criteria:

1. search commands hang
2. indexing causes a memory spike
3. query returns unbounded blobs

## Phase 9: Browser Agent Smoke

This is only smoke coverage, not full-fidelity proof.

Suggested prompt:

```text
Open or ensure a browser surface in bmux, observe it compactly, then read title and URL. Do not request full snapshots.
```

Pass criteria:

1. `bmux_open` or `bmux_ensure` can create or reuse a browser surface
2. `bmux_browser_observe` returns compact nodes only
3. `bmux_browser_read` can return title and URL

Then test one small action:

```text
Use the browser agent to perform one compact action such as focus or click if there is a safe target, then report the compact result.
```

Pass criteria:

1. `bmux_browser_act` runs
2. result stays small
3. Codex does not request screenshots unless actually needed

Optional debug-only follow-up:

```text
If the action fails, fetch browser logs first. Only create a screenshot artifact if logs are insufficient.
```

Fail criteria:

1. browser observe/read hangs
2. Codex defaults to full DOM or huge snapshots
3. browser actions require noisy fallback too early

## Phase 10: Resume and Reuse

Suggested prompt:

```text
Without reattaching manually, keep using the current bmux session and prove that you can fetch layout and task state cheaply.
```

Pass criteria:

1. Codex reuses the session naturally
2. repeated calls stay compact
3. no redundant attach spam in every step

Fail criteria:

1. every operation starts from scratch
2. Codex loses session memory immediately

## Phase 11: Regression Watch

Keep Activity Monitor open while doing the smoke.

Watch for:

1. bmux RSS climbing continuously without settling
2. CPU pegged on idle after a completed smoke step
3. tab title churn
4. pane count increasing unexpectedly
5. text rendering corruption or crushed layout

Immediate stop conditions:

1. RAM spikes rapidly
2. pane storm returns
3. app becomes visibly laggy from simple agent operations

## Expected Current Limits

These are known non-goals for the current browser backend and should not be treated as smoke failures:

1. native pointer fidelity is not there yet
2. drag and drop is not the success target
3. cross-origin iframe control is limited
4. file upload automation is not the success target
5. network mocking and offline emulation are not the success target

If one of those fails, record it as expected limitation, not a regression.

## Minimal Pass Bar

Call the whole smoke a pass if all of these are true:

1. Codex sees the bmux plugin tools after restart
2. `attach`, `capabilities`, and `layout` work
3. `task_run`, `task_wait`, and `task_result` work with compact output
4. visible split guard prevents unreadable pane spam
5. service wait works without log scraping
6. search status/index/query work without hanging
7. browser observe/read work in compact mode
8. no RAM runaway, pane storm, or title churn appears during the run

## Minimal Fail Report Format

If any phase fails, record:

1. phase name
2. prompt used
3. last bmux MCP tool called
4. exact failure text
5. whether RAM/UI/pane count changed abnormally
6. whether the failure is a regression or an expected current limit
