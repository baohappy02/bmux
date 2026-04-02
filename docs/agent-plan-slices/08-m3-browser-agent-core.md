# Slice 08 - Milestone 3 Browser Agent Core

Status: DONE

Branch: `spark/s08-browser-agent-core`

Build tag: `spark-s08`

PR title: `Add browser agent session primitives`

Suggested commit: `Add browser agent session primitives`

## Goal

Start the compact browser layer on top of the generic agent session:

1. `browser.agent.observe`
2. `browser.agent.read`
3. `browser.agent.logs`
4. `browser.agent.artifact`

## In Scope

1. compact browser observation model
2. ref-oriented output
3. bounded browser logs and artifact metadata
4. CLI wrappers

## Out Of Scope

1. full-fidelity native input
2. `browser.agent.act`
3. CDP backend work
4. broad browser refactoring

## Expected Files

Likely:

1. `Sources/TerminalController.swift`
2. `CLI/bmux.swift`
3. `Sources/Panels/BrowserPanel.swift` only if needed

## Contract Requirements

Rules:

1. no full DOM dumps by default
2. no base64 artifacts by default
3. keep ref stability as good as the existing backend allows
4. make backend capability limits explicit

## Acceptance

1. observe returns a compact interactive or content view.
2. read returns small targeted fields.
3. logs are cursor-based and bounded.
4. artifact returns path metadata, not content.
5. tagged build passes.

## Review Focus

1. payload size
2. ref invalidation behavior
3. docs versus implementation mismatch

## Spark Prompt

```text
Implement docs/agent-plan-slices/08-m3-browser-agent-core.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s08.
- Reuse the existing browser backend and browser socket helpers.
- Keep everything compact and ref-oriented.
- Do not add full-fidelity input yet.

Deliver:
1. browser.agent.observe
2. browser.agent.read
3. browser.agent.logs
4. browser.agent.artifact
5. matching CLI commands

Stop after the build succeeds, commit with:
Add browser agent session primitives
```
