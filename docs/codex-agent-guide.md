# Codex Agent Guide

This is the canonical low-token workflow for Codex inside bmux.

Use `agent.*` first. Use legacy `list-*` and full browser snapshots only for debugging.

## Ground Rules

1. Prefer `bun` when the repo supports it.
2. Check pricing before spending time on external tools or services.
3. Stop and report if the path requires billing or paid usage.
4. Keep responses compact: refs, cursors, booleans, and short summaries.

## Fast Paths

For a single managed command, skip the full attach/capabilities/layout dance:

1. `bmux agent task run --pause-for-user true --cmd "cargo test" --json`
2. Stop if the payload returns `paused_for_user: true`
3. Use `bmux agent task result --job <job-id> --json` only when the user wants you to continue

Only create a dedicated surface first when reuse matters:

1. `bmux agent ensure terminal --split down --focus false --json`
2. `bmux agent task run --surface <surface> --pause-for-user true --cmd "cargo test" --json`

Use the longer session loop only when the task is multi-step or you need discovery:

1. `bmux agent attach --json`
2. `bmux agent capabilities --session <sid> --json` only if you need environment or profile discovery
3. `bmux agent layout --session <sid> --json` only when topology matters or just changed
4. `bmux agent intel search --session <sid> --query "<task>" --json`
5. `bmux agent events --session <sid> --since <cursor> --json`
6. `bmux agent state summary --session <sid> --json`

For one-shot task dispatch, `attach` is optional:

```bash
bmux agent task run --pause-for-user true --cmd "cargo test" --json
```

When `--session` is omitted on `open`, `ensure`, `task run`, `task run-many`, or `task run-profile`, bmux auto-attaches to the current focus and returns `session_id` in the payload.
After that, `task wait`, `task result`, `task logs`, and `task cancel` can be called with `--job` alone when the session is not already cached by the caller.
For noisy commands, bmux may also pause by default; if the payload comes back with `paused_for_user: true`, stop and do not auto-wait.

## Skill Loop

```bash
bmux agent intel seed-defaults --json
bmux agent intel search --session <sid> --query "verify existing build fix" --json
bmux agent intel propose --session <sid> --json
bmux agent intel evaluations --session <sid> --json
bmux agent intel review --evaluation <eval-id> --decision approve --json
bmux agent intel skills --session <sid> --json
```

Rules:

1. search for a compact skill card before widening search or reading long logs
2. let `task result` and `state summary` drive the next step
3. treat `propose` output as reviewable candidates, not auto-active behavior
4. approvals should land as `canary` by default; use `skill-status` to promote only after repeated clean runs

## Verify Loop

```bash
bmux agent task run-profile --session <sid> --pause-for-user false verify.ts --json
bmux agent task wait --session <sid> --job-id <job> --json
bmux agent task result --session <sid> --job-id <job> --json
```

Success should stay small.

Failure should point to:

1. parsed diagnostics
2. short tail
3. `log_path`
4. `agent artifact list`

## User-Gated Noisy Commands

When the command is large or noisy and the user wants to inspect the terminal first,
start it with a pause contract instead of immediately pulling logs back into the model:

```bash
bmux agent task run --pause-for-user true --cmd "cargo test" --json
bmux agent task run-profile --pause-for-user true verify.ts --json
```

The response should stay compact and machine-readable:

- `paused_for_user: true`
- `next_action: "wait_for_user"`
- `automatic_log_ingest: false`

After that, stop and wait for the user.
Only fetch `task result`, a targeted tail, or logs after the user says to continue or provides a failure snippet.
Do not call `task wait` against a paused payload unless the user explicitly redirected you to continue unattended.

## Dev Server Loop

```bash
bmux agent ensure service --session <sid> --profile dev.web --json
bmux agent service wait --session <sid> --port 3000 --url-path / --json
bmux agent service list --session <sid> --json
```

Use `agent.events` between steps instead of polling logs.

## Browser Loop

```bash
bmux browser agent observe --session <sid> --json
bmux browser agent act --session <sid> click --ref e12 --json
bmux browser agent read --session <sid> --ref e20 --fields text,visible --json
bmux browser agent logs --session <sid> --kind errors --cursor 0 --json
```

Rules:

1. do not request full DOM dumps by default
2. do not request base64 artifacts by default
3. use `browser agent artifact` only when the agent actually needs a screenshot path

## Search Loop

```bash
bmux agent search status --session <sid> --json
bmux agent search index --session <sid> --json
bmux agent search query --session <sid> --limit 5 --query "existing auth validation logic" --json
```

Use `agent.search` for concept lookup. Use `rg` for exact-match or regex follow-up work.

## Code Intel Loop

```bash
bmux agent code status --session <sid> --json
bmux agent code index --session <sid> --timeout-ms 120000 --json
bmux agent code symbols --session <sid> --limit 5 --query "TerminalController" --json
bmux agent code context --session <sid> --symbol "TerminalController" --path Sources/TerminalController.swift --json
bmux agent code impact --session <sid> --symbol "TerminalController" --path Sources/TerminalController.swift --json
bmux agent code changes --session <sid> --scope unstaged --json
bmux agent code rename --session <sid> --symbol "activeSocketPath" --path Sources/TerminalController.swift --to currentSocketPath --json
```

Use `agent.code` when the task needs symbol-aware answers, blast radius, changed-symbol mapping, module ownership, or safe rename preview. Treat it as the default local repo loop.
If `status` is `stale` or `missing` on a large repo, prefer `code index --timeout-ms 120000` instead of relying on the CLI's shorter default response window.

## Measurement Hooks

Use these to compare token and latency cost by workflow:

1. `bmux agent events --session <sid> --since <cursor> --json`
2. `bmux agent state summary --session <sid> --json`
3. debug log lines written by `agent.event ...` in DEBUG builds

Build with a tag, then inspect the tagged debug log:

```bash
tail -f "$(cat /tmp/cmux-last-debug-log-path 2>/dev/null || echo /tmp/cmux-debug.log)"
```

Useful event families:

1. `task.*`
2. `service.*`
3. `search.*`
4. `browser.observe`
5. `browser.action`
6. `browser.action.failed`
7. `layout.changed`
8. `session.recovered`

## Browser Backend Decision Gate

The current browser agent layer is `WKWebView`-backed and compact-first.

Stay on this backend when the task only needs:

1. navigation
2. DOM reads
3. click/fill/type/select flows
4. screenshots
5. console and error checks

Escalate to a future pluggable backend only when the task requires:

1. native pointer fidelity
2. drag and drop
3. canvas or coordinate-heavy input
4. device emulation
5. network interception
6. cross-origin iframe breakthroughs
