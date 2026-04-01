# cmux agent notes

## Initial setup

Run the setup script to initialize submodules and build GhosttyKit:

```bash
./scripts/setup.sh
```

## Local dev

After making code changes, always run the reload script with a tag to build the Debug app:

```bash
./scripts/reload.sh --tag fix-zsh-autosuggestions
```

By default, `reload.sh` builds but does **not** launch the app. The script prints the `.app` path so the user can cmd-click to open it. Pass `--launch` to kill any existing instance and open the app automatically:

```bash
./scripts/reload.sh --tag fix-zsh-autosuggestions --launch
```

`reload.sh` prints an `App path:` line with the absolute path to the built `.app`. Use that path to build a cmd-clickable `file://` URL. Steps:

1. Grab the path from the `App path:` line in `reload.sh` output.
2. Prepend `file://` and URL-encode spaces as `%20`. Do not hardcode any part of the path.
3. Format it as a markdown link using the template for your agent type.

Example. If `reload.sh` output contains:
```
App path:
  /Users/someone/Library/Developer/Xcode/DerivedData/cmux-my-tag/Build/Products/Debug/cmux DEV my-tag.app
```

**Claude Code** outputs:
```markdown
=======================================================
[cmux DEV my-tag.app](file:///Users/someone/Library/Developer/Xcode/DerivedData/cmux-my-tag/Build/Products/Debug/cmux%20DEV%20my-tag.app)
=======================================================
```

**Codex** outputs:
```
=======================================================
[my-tag: file:///Users/someone/Library/Developer/Xcode/DerivedData/cmux-my-tag/Build/Products/Debug/cmux%20DEV%20my-tag.app](file:///Users/someone/Library/Developer/Xcode/DerivedData/cmux-my-tag/Build/Products/Debug/cmux%20DEV%20my-tag.app)
=======================================================
```

Never use `/tmp/cmux-<tag>/...` app links in chat output.

After making code changes, always use `reload.sh --tag` to build. **Never run bare `xcodebuild` or `open` an untagged `cmux DEV.app`.** Untagged builds share the default debug socket and bundle ID with other agents, causing conflicts and stealing focus.

```bash
./scripts/reload.sh --tag <your-branch-slug>
```

If you only need to verify the build compiles (no launch), use a tagged derivedDataPath:

```bash
xcodebuild -project GhosttyTabs.xcodeproj -scheme cmux -configuration Debug -destination 'platform=macOS' -derivedDataPath /tmp/cmux-<your-tag> build
```

When rebuilding GhosttyKit.xcframework, always use Release optimizations:

```bash
cd ghostty && zig build -Demit-xcframework=true -Dxcframework-target=universal -Doptimize=ReleaseFast
```

When rebuilding cmuxd for release/bundling, always use ReleaseFast:

```bash
cd cmuxd && zig build -Doptimize=ReleaseFast
```

`reload` = build the Debug app (tag required). Pass `--launch` to also kill existing and open:

```bash
./scripts/reload.sh --tag <tag>
./scripts/reload.sh --tag <tag> --launch
```

`reloadp` = kill and launch the Release app:

```bash
./scripts/reloadp.sh
```

`reloads` = kill and launch the Release app as "cmux STAGING" (isolated from production cmux):

```bash
./scripts/reloads.sh
```

`reload2` = reload both Debug and Release (tag required for Debug reload):

```bash
./scripts/reload2.sh --tag <tag>
```

For parallel/isolated builds (e.g., testing a feature alongside the main app), use `--tag` with a short descriptive name:

```bash
./scripts/reload.sh --tag fix-blur-effect
```

This creates an isolated app with its own name, bundle ID, socket, and derived data path so it runs side-by-side with the main app. Important: use a non-`/tmp` derived data path if you need xcframework resolution (the script handles this automatically).

Before launching a new tagged run, clean up any older tags you started in this session (quit old tagged app + remove its `/tmp` socket/derived data).

## Debug event log

All debug events (keys, mouse, focus, splits, tabs) go to a unified log in DEBUG builds:

```bash
tail -f "$(cat /tmp/cmux-last-debug-log-path 2>/dev/null || echo /tmp/cmux-debug.log)"
```

- Untagged Debug app: `/tmp/cmux-debug.log`
- Tagged Debug app (`./scripts/reload.sh --tag <tag>`): `/tmp/cmux-debug-<tag>.log`
- `reload.sh` writes the current path to `/tmp/cmux-last-debug-log-path`
- `reload.sh` writes the selected dev CLI path to `/tmp/cmux-last-cli-path`
- `reload.sh` updates `/tmp/cmux-cli` and `$HOME/.local/bin/cmux-dev` to that CLI

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

**Never run tests locally.** All tests (E2E, UI, python socket tests) run via GitHub Actions or on the VM.

- **E2E / UI tests:** trigger via `gh workflow run test-e2e.yml` (see cmuxterm-hq CLAUDE.md for details)
- **Unit tests:** `xcodebuild -scheme cmux-unit` is safe (no app launch), but prefer CI
- **Python socket tests (tests_v2/):** these connect to a running cmux instance's socket. Never launch an untagged `cmux DEV.app` to run them. If you must test locally, use a tagged build's socket (`/tmp/cmux-debug-<tag>.sock`) with `CMUX_SOCKET=/tmp/cmux-debug-<tag>.sock`
- **Never `open` an untagged `cmux DEV.app`** from DerivedData. It conflicts with the user's running debug instance.

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bmux** (12414 symbols, 21330 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/bmux/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bmux/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bmux/clusters` | All functional areas |
| `gitnexus://repo/bmux/processes` | All execution flows |
| `gitnexus://repo/bmux/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
