# Slice 04 - Milestone 2 Hardening And Recovery

Status: TODO

Branch: `spark/s04-hardening-recovery`

Build tag: `spark-s04`

PR title: `Add agent cache redaction retry and recovery`

Suggested commit: `Add agent cache redaction retry and recovery`

## Goal

Implement the low-token hardening features that make repeated Codex loops cheap and safe:

1. workspace fingerprints and safe cache hits
2. secret redaction
3. bounded retry metadata
4. recovery and cleanup events

## In Scope

1. workspace fingerprinting for safe verify profiles
2. cached success for safe profiles such as `verify.ts`
3. deterministic redaction for logs, tails, diagnostics, and event payloads
4. bounded retry metadata for transient startup flows
5. recovery events and cleanup of stale job or service metadata

## Out Of Scope

1. search
2. browser agent methods
3. in-app managed jobs UI

## Expected Files

1. `Sources/TerminalController.swift`
2. `CLI/bmux.swift` only if flags are required

## Contract Requirements

Rules:

1. cached results must be explicit, never silent
2. redaction must happen before payloads leave bmux
3. retries must be opt-in by profile or explicit policy
4. cleanup must not kill user-owned surfaces unexpectedly

## Acceptance

1. `verify.ts` can return a compact cache hit when safe.
2. secrets are redacted in agent-visible tails and diagnostics.
3. retry metadata is visible but bounded.
4. recovery state surfaces through events and state summary.
5. tagged build passes.

## Review Focus

1. no unsafe cache hits
2. redaction does not corrupt useful diagnostics too aggressively
3. retry logic does not hide deterministic failures

## Spark Prompt

```text
Implement docs/agent-plan-slices/04-m2-hardening-and-recovery.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s04.
- Keep all new behavior bounded and explicit.
- Reuse existing profile and task flows.
- Do not start search or browser work.

Deliver:
1. workspace fingerprint caching for safe profiles
2. deterministic redaction in agent-visible payloads
3. bounded retry metadata
4. recovery and cleanup events

Stop after the build succeeds, commit with:
Add agent cache redaction retry and recovery
```
