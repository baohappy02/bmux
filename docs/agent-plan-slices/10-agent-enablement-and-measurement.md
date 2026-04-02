# Slice 10 - Agent Enablement And Measurement

Status: TODO

Branch: `spark/s10-enable-measure`

Build tag: `spark-s10`

PR title: `Add Codex agent docs skills and measurement hooks`

Suggested commit: `Add Codex agent docs skills and measurement hooks`

## Goal

Finish the plan with the material that makes the feature actually usable:

1. Codex teaching docs
2. skill or instruction updates that prefer `agent.*`
3. end-to-end examples
4. measurement hooks for real token and flow evaluation
5. backend decision notes for `WKWebView` versus future pluggable browser backend

## In Scope

1. update docs and skills to prefer `agent.*`
2. add canonical examples for build, server, ensure, and browser loops
3. add lightweight measurement hooks or logging for real usage evaluation
4. document the backend decision gate for browser fidelity

## Out Of Scope

1. a full CDP backend
2. new search or browser primitives

## Expected Files

Likely:

1. `docs/bmux-browser-agent-plan.md`
2. `docs/agent-plan-slices/README.md`
3. relevant skill or instruction files
4. possibly lightweight measurement code in app or CLI if truly needed

## Acceptance

1. there is one canonical Codex loop doc.
2. there are concrete examples for build, service, ensure, and browser workflows.
3. measurement hooks are enough to compare token and latency cost by workflow.
4. tagged build passes if code changed.

## Review Focus

1. docs match implementation
2. no stale examples
3. measurement hooks stay lightweight

## Spark Prompt

```text
Implement docs/agent-plan-slices/10-agent-enablement-and-measurement.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s10 if code changes.
- Prefer docs and skill updates over speculative new code.
- Keep examples aligned with the actual implemented agent contract.

Deliver:
1. Codex-facing docs and examples
2. skill or instruction updates that prefer agent.*
3. lightweight measurement hooks or notes
4. backend decision notes for browser fidelity

Stop after the slice is complete, commit with:
Add Codex agent docs skills and measurement hooks
```
