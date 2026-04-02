# Slice 09 - Milestone 3 Browser Agent Actions

Status: TODO

Branch: `spark/s09-browser-agent-actions`

Build tag: `spark-s09`

PR title: `Add compact browser agent actions`

Suggested commit: `Add compact browser agent actions`

## Goal

Finish the first browser agent loop:

1. `browser.agent.act`
2. compact action results
3. browser failure artifacts wired into the artifact model

## In Scope

1. action routing for common DOM interactions
2. compact post-action deltas
3. failure artifacts by path
4. CLI wrapper

## Out Of Scope

1. true native pointer fidelity
2. CDP backend work
3. cross-origin iframe breakthroughs
4. network mocking

## Contract Requirements

Rules:

1. action results stay small
2. return `page_rev`, changed refs, or focus refs instead of full snapshots
3. only expose backend capabilities that are real
4. keep browser failure artifacts path-based

## Acceptance

1. common click, fill, press, and select flows work through the compact contract.
2. action responses stay terse.
3. failure cases point to artifacts instead of dumping large payloads.
4. tagged build passes.

## Review Focus

1. false promises about user-realistic interaction fidelity
2. payload bloat after each action
3. browser failure artifact sprawl

## Spark Prompt

```text
Implement docs/agent-plan-slices/09-m3-browser-agent-actions.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s09.
- Reuse the existing browser socket layer.
- Keep post-action responses compact.
- Do not attempt CDP or native pointer fidelity in this slice.

Deliver:
1. browser.agent.act
2. compact action result payloads
3. browser failure artifacts hooked into path-based retrieval
4. matching CLI command

Stop after the build succeeds, commit with:
Add compact browser agent actions
```
