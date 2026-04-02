# Slice 03 - Milestone 2 Events, Services, And Profiles

Status: TODO

Branch: `spark/s03-events-services-profiles`

Build tag: `spark-s03`

PR title: `Expand agent events services and profiles`

Suggested commit: `Expand agent events services and profiles`

## Goal

Strengthen the event-driven loop so Codex can run FE and verify flows with fewer polls:

1. richer `agent.events` coverage
2. better service discovery and health readiness
3. stronger profile support for `verify.ts` and `dev.web`

## In Scope

1. add events for layout changes, task failure, task cancellation, service disappearance, session recovery, and profile completion
2. improve `agent.service.wait` to support cheap health checks for common dev servers
3. improve `agent.service.list` payload shape if needed for readiness and health
4. harden `agent.task.run_profile` for common flows

## Out Of Scope

1. workspace fingerprint cache
2. secret redaction
3. retry policy
4. app UI
5. search
6. browser agent methods

## Expected Files

1. `Sources/TerminalController.swift`
2. `CLI/bmux.swift`

## Contract Requirements

Rules:

1. events remain cursor-based and bounded
2. service waits should not parse giant terminal logs
3. profiles should prefer Bun where allowed
4. FE readiness should work for simple `dev.web` loops without browser automation yet

Suggested minimal health support:

1. optional `--url-path`
2. optional `--expect-text`
3. cheap HTTP 200-style readiness when safe

## Acceptance

1. Codex can run `ensure service` then `service.wait` with fewer blind polls.
2. `events` cover the main transitions of task and service lifecycle.
3. profile flows expose expected ports and useful event transitions.
4. tagged build passes.

## Review Focus

1. no blocking network logic on hot paths
2. no verbose event payloads
3. health checks remain opt-in and bounded

## Spark Prompt

```text
Implement docs/agent-plan-slices/03-m2-events-services-profiles.md only.

Constraints:
- Do not run local tests.
- Build only with ./scripts/reload.sh --tag spark-s03.
- Reuse existing agent.events, service.wait, service.list, and run_profile flows.
- Keep events and service payloads small.
- Do not start search or browser work.

Deliver:
1. richer agent.events coverage
2. stronger service readiness and health support
3. hardened verify.ts and dev.web profile behavior
4. matching CLI flags only where needed

Stop after the build succeeds, commit with:
Expand agent events services and profiles
```
