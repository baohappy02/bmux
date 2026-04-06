# cmux agent notes

## Initial setup

Run the setup script to initialize submodules and build GhosttyKit:

```bash
./scripts/setup.sh
```

## Repo-local instruction source

- Repo-local behavioral rules are SSOT in `AGENTS.md`. Other repo-local instruction files should link to this file instead of duplicating the same rules.

## bmux-index lifecycle

- When bmux opens or switches to a project repo, it should keep one long-lived `bmux-index serve` session and call `bmux-index prepare` as a non-blocking warmup step.
- Do not treat `bmux-index status` as a required gate for repo-scoped reads. For `route`, `search`, `search_many`, `symbols`, `context`, `impact`, `trace`, `refs`, `rename`, `changes`, and `module`, call the read path directly and let `bmux-index` auto-index if the local index is `missing` or `stale`.
- Use `status` as telemetry or diagnostics only. Dirty tracked or untracked worktree counts are noisy in normal development and should not block indexed reads.
- Re-warm on repo switch or when freshness inputs drift enough to stale the index, such as branch switches, large checkouts, or source fingerprint changes, but keep normal indexed reads on the direct read path.

## Local dev

Run the setup script once to initialize submodules and build GhosttyKit:

```bash
./scripts/setup.sh
```

Keep exactly one local app variant in normal development:

1. `/Applications/bmux.app`

Use the installed app as the only runtime target for normal coding, verification, and agent work.

```bash
./scripts/reloadp.sh
```

Rules:

- `reloadp.sh` is the canonical local dev loop. It rebuilds and relaunches `/Applications/bmux.app`.
- When using bmux MCP or `agent` commands from this repo, default the target to the bmux app, window, workspace, tab, and surface the user is currently using, not the last attached runtime.
- Treat any reused MCP session whose `cli_path` does not point at `/Applications/bmux.app` as stale for normal work. Re-attach from the currently focused `/Applications/bmux.app` before any `task run`, `task wait`, `task result`, `task logs`, `ensure`, `open`, or browser-agent action.
- If a change is wrong, undo or revert it in source control instead of switching runtimes.
- For managed build, test, verify, and fix loops, default to `agent.task.run` or `agent.task.run-profile` so bmux dispatches into a separate visible task terminal. Reuse a visible managed task terminal when it already exists; otherwise create it as a right split instead of reusing the attached prompt surface.
- Do not fall back to background exec when bmux managed task terminals are available. If bmux cannot create a visible split because of the visibility guard, surface the structured error instead of silently using a hidden tab or shell.
- For intentionally unattended managed verify or fix loops, run the command in a visible bmux terminal with `pause_for_user=false`, then use `task wait` as the completion channel and consume `failure_markers` first, then `failure_context`, before reading raw logs.
- Even in unattended loops, do not tail terminal noise live. Search the returned failure markers such as `error`, `failed`, `fatal`, `panic`, or `exception`; use `task logs` only when `task wait` or `task result` still leaves the failure under-specified.

When rebuilding GhosttyKit.xcframework, always use Release optimizations:

```bash
cd ghostty && zig build -Demit-xcframework=true -Dxcframework-target=universal -Doptimize=ReleaseFast
```

When rebuilding `bmuxd` for release/bundling, always use ReleaseFast:

```bash
cd bmuxd && zig build -Doptimize=ReleaseFast
```

`reloadp` is the stable-install shortcut for rebuilding and relaunching `/Applications/bmux.app`:

```bash
./scripts/reloadp.sh
```

## Debug event log

All debug events (keys, mouse, focus, splits, tabs) go to a unified log in DEBUG builds:

```bash
tail -f "$(cat /tmp/cmux-last-debug-log-path 2>/dev/null || echo /tmp/cmux-debug.log)"
```

- Use `/tmp/cmux-last-debug-log-path` when present; otherwise fall back to `/tmp/cmux-debug.log`.
- Do not rely on alternate debug log files or alternate CLI symlinks in the normal workflow.

- Implementation: `vendor/bonsplit/Sources/Bonsplit/Public/DebugEventLog.swift`
- Free function `dlog("message")` — logs with timestamp and appends to file in real time
- Entire file is `#if DEBUG`; all call sites must be wrapped in `#if DEBUG` / `#endif`
- 500-entry ring buffer; `DebugEventLog.shared.dump()` writes full buffer to file
- Key events logged in `AppDelegate.swift` (monitor, performKeyEquivalent)
- Mouse/UI events logged inline in views (ContentView, BrowserPanelView, etc.)
- Focus events: `focus.panel`, `focus.bonsplit`, `focus.firstResponder`, `focus.moveFocus`
- Bonsplit events: `tab.select`, `tab.close`, `tab.dragStart`, `tab.drop`, `pane.focus`, `pane.drop`, `divider.dragStart`

## Regression test commit policy

When adding a regression test for a bug fix, use a two-commit structure so CI proves the test catches the bug:

1. **Commit 1:** Add the failing test only (no fix). CI should go red.
2. **Commit 2:** Add the fix. CI should go green.

This makes it visible in the GitHub PR UI (Commits tab, check statuses) that the test genuinely fails without the fix.

## Debug menu

The app has a **Debug** menu in the macOS menu bar (only in DEBUG builds). Use it for visual iteration:

- **Debug > Debug Windows** contains panels for tuning layout, colors, and behavior. Entries are alphabetical with no dividers.
- To add a debug toggle or visual option: create an `NSWindowController` subclass with a `shared` singleton, add it to the "Debug Windows" menu in `Sources/cmuxApp.swift`, and add a SwiftUI view with `@AppStorage` bindings for live changes.
- When the user says "debug menu" or "debug window", they mean this menu, not `defaults write`.

## Pitfalls

- **Custom UTTypes** for drag-and-drop must be declared in `Resources/Info.plist` under `UTExportedTypeDeclarations` (e.g. `com.splittabbar.tabtransfer`, `com.cmux.sidebar-tab-reorder`).
- Do not add an app-level display link or manual `ghostty_surface_draw` loop; rely on Ghostty wakeups/renderer to avoid typing lag.
- **Typing-latency-sensitive paths** (read carefully before touching these areas):
  - `WindowTerminalHostView.hitTest()` in `TerminalWindowPortal.swift`: called on every event including keyboard. All divider/sidebar/drag routing is gated to pointer events only. Do not add work outside the `isPointerEvent` guard.
  - `TabItemView` in `ContentView.swift`: uses `Equatable` conformance + `.equatable()` to skip body re-evaluation during typing. Do not add `@EnvironmentObject`, `@ObservedObject` (besides `tab`), or `@Binding` properties without updating the `==` function. Do not remove `.equatable()` from the ForEach call site. Do not read `tabManager` or `notificationStore` in the body; use the precomputed `let` parameters instead.
  - `TerminalSurface.forceRefresh()` in `GhosttyTerminalView.swift`: called on every keystroke. Do not add allocations, file I/O, or formatting here.
- **Terminal find layering contract:** `SurfaceSearchOverlay` must be mounted from `GhosttySurfaceScrollView` in `Sources/GhosttyTerminalView.swift` (AppKit portal layer), not from SwiftUI panel containers such as `Sources/Panels/TerminalPanelView.swift`. Portal-hosted terminal views can sit above SwiftUI during split/workspace churn.
- **Submodule safety:** When modifying a submodule (ghostty, vendor/bonsplit, etc.), always push the submodule commit to its remote `main` branch BEFORE committing the updated pointer in the parent repo. Never commit on a detached HEAD or temporary branch — the commit will be orphaned and lost. Verify with: `cd <submodule> && git merge-base --is-ancestor HEAD origin/main`.
- **All user-facing strings must be localized.** Use `String(localized: "key.name", defaultValue: "English text")` for every string shown in the UI (labels, buttons, menus, dialogs, tooltips, error messages). Keys go in `Resources/Localizable.xcstrings` with translations for all supported languages (currently English and Japanese). Never use bare string literals in SwiftUI `Text()`, `Button()`, alert titles, etc.

## Test quality policy

- Do not add tests that only verify source code text, method signatures, AST fragments, or grep-style patterns.
- Do not add tests that read checked-in metadata or project files such as `Resources/Info.plist`, `project.pbxproj`, `.xcconfig`, or source files only to assert that a key, string, plist entry, or snippet exists.
- Tests must verify observable runtime behavior through executable paths (unit/integration/e2e/CLI), not implementation shape.
- For metadata changes, prefer verifying the built app bundle or the runtime behavior that depends on that metadata, not the checked-in source file.
- If a behavior cannot be exercised end-to-end yet, add a small runtime seam or harness first, then test through that seam.
- If no meaningful behavioral or artifact-level test is practical, skip the fake regression test and state that explicitly.

## Socket command threading policy

- Do not use `DispatchQueue.main.sync` for high-frequency socket telemetry commands (`report_*`, `ports_kick`, status/progress/log metadata updates).
- For telemetry hot paths:
  - Parse and validate arguments off-main.
  - Dedupe/coalesce off-main first.
  - Schedule minimal UI/model mutation with `DispatchQueue.main.async` only when needed.
- Commands that directly manipulate AppKit/Ghostty UI state (focus/select/open/close/send key/input, list/current queries requiring exact synchronous snapshot) are allowed to run on main actor.
- If adding a new socket command, default to off-main handling; require an explicit reason in code comments when main-thread execution is necessary.

## Socket focus policy

- Socket/CLI commands must not steal macOS app focus (no app activation/window raising side effects).
- Only explicit focus-intent commands may mutate in-app focus/selection (`window.focus`, `workspace.select/next/previous/last`, `surface.focus`, `pane.focus/last`, browser focus commands, and v1 focus equivalents).
- All non-focus commands should preserve current user focus context while still applying data/model changes.

## Testing policy

- **E2E / UI tests:** trigger via `gh workflow run test-e2e.yml` (see cmuxterm-hq CLAUDE.md for details)
- **Unit tests:** prefer `./scripts/test-unit.sh` for local runs. It wraps `xcodebuild -scheme bmux-unit`.
- **Raw local xcodebuild:** not a trustworthy first diagnostic in restricted or sandboxed environments. DerivedData, module cache, and SwiftPM permission failures can mask the real code issue. If you must invoke `xcodebuild` directly, use an explicit writable `-derivedDataPath` and treat cache/permission failures as environment noise first.
- **Python socket tests (tests_v2/):** these connect to a running cmux instance's socket. If you must test locally, point `CMUX_SOCKET` at the socket of the currently running `/Applications/bmux.app` instance.

## Ghostty submodule workflow

Ghostty changes must be committed in the `ghostty` submodule and pushed to the `manaflow-ai/ghostty` fork.
Keep `docs/ghostty-fork.md` up to date with any fork changes and conflict notes.

```bash
cd ghostty
git remote -v  # origin = upstream, manaflow = fork
git checkout -b <branch>
git add <files>
git commit -m "..."
git push manaflow <branch>
```

To keep the fork up to date with upstream:

```bash
cd ghostty
git fetch origin
git checkout main
git merge origin/main
git push manaflow main
```

Then update the parent repo with the new submodule SHA:

```bash
cd ..
git add ghostty
git commit -m "Update ghostty submodule"
```

## Release

Use the `/release` command to prepare a new release. This will:
1. Determine the new version (bumps minor by default)
2. Gather commits since the last tag and update the changelog
3. Update `CHANGELOG.md` (the docs changelog page at `web/app/docs/changelog/page.tsx` reads from it)
4. Run `./scripts/bump-version.sh` to update both versions
5. Commit, tag, and push

Version bumping:

```bash
./scripts/bump-version.sh          # bump minor (0.15.0 → 0.16.0)
./scripts/bump-version.sh patch    # bump patch (0.15.0 → 0.15.1)
./scripts/bump-version.sh major    # bump major (0.15.0 → 1.0.0)
./scripts/bump-version.sh 1.0.0    # set specific version
```

This updates both `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` (build number). The build number is auto-incremented and is required for Sparkle auto-update to work.

Manual release steps (if not using the command):

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
gh run watch --repo manaflow-ai/cmux
```

Notes:
- Requires GitHub secrets: `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- The release asset is `cmux-macos.dmg` attached to the tag.
- README download button points to `releases/latest/download/cmux-macos.dmg`.
- Versioning: bump the minor version for updates unless explicitly asked otherwise.
- Changelog: update `CHANGELOG.md`; docs changelog is rendered from it.
