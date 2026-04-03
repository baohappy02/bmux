# bmux Optimize Plan

Last updated: April 3, 2026

This document turns the earlier OpenSpace-style exploration into a practical bmux plan.
The goal is not to clone OpenSpace.
The goal is to make Codex inside bmux more accurate, more reliable, and more token-efficient over time.

## One-Sentence Summary

Keep bmux as the runtime control plane, keep Codex as the worker, and add a small local `agent-intel` layer that remembers what worked, suggests compact playbooks before execution, and captures reviewed skill candidates after execution.

## Why bmux Does Not Need an OpenSpace Clone

OpenSpace had to provide:

1. task delegation
2. skill discovery
3. skill repair
4. execution recording
5. post-task analysis
6. skill evolution

bmux already has most of the runtime substrate needed for this:

1. `agent.attach`
2. `agent.layout`
3. `agent.capabilities`
4. `agent.task.*`
5. `agent.events`
6. `agent.state.summary`
7. `agent.service.*`
8. `agent.search*`
9. `browser.agent.*`

So the missing layer is not "another executor."
The missing layer is:

1. durable memory
2. local skill registry
3. compact retrieval
4. post-run evaluation
5. controlled rollout of learned skills

## Product Goal

For repeated or similar tasks, Codex should:

1. ask fewer discovery questions
2. choose better first actions
3. repeat fewer known mistakes
4. consume fewer MCP calls and fewer prompt bytes

## Architecture

Use three layers:

1. `bmux`
   Owns the true runtime state, managed tasks, events, layout, search, browser control, and artifacts.

2. `Codex`
   Remains the active coding agent and primary worker.

3. `agent-intel`
   A local companion service with durable storage and retrieval logic.

`agent-intel` should not replace `bmux agent.*`.
It should sit above it and answer:

1. "Have we solved something like this before?"
2. "Which compact playbook should Codex see first?"
3. "Should this successful pattern become a reusable skill candidate?"
4. "Should this repeated failure produce a fix candidate?"

## v1 Scope

The first useful version should do only three things:

1. record execution outcomes
2. store versioned local skills
3. retrieve the best-matching skill cards for a task

That means v1 explicitly does not do:

1. cloud search
2. auto-upload
3. autonomous self-editing
4. automatic skill activation
5. a second general-purpose task executor

## Core Loop

### Before execution

Codex asks `agent-intel` for matching skills.

`agent-intel` ranks results using:

1. repo match
2. execution class match
3. failure-signature match
4. lexical task overlap
5. skill status weighting

It returns only a few compact skill cards:

1. when to use
2. prechecks
3. steps
4. verify
5. pitfalls
6. stop conditions

### During execution

Codex still uses existing `bmux agent.*` and `browser.agent.*` tools.

### After execution

bmux and `agent-intel` record:

1. task summary
2. repo root
3. workspace fingerprint
4. command / execution class
5. success or failure
6. duration
7. failure signature
8. payload-size proxies
9. selected skill ids

## Evolution Policy

OpenSpace uses `FIX`, `DERIVED`, and `CAPTURED`.
bmux should keep those labels but roll them out slowly.

### Phase order

1. `CAPTURED` first
   Repeated verified success becomes a candidate skill.

2. `FIX` second
   Repeated failures linked to one skill create a repair candidate.

3. `DERIVED` last
   Only after enough evidence exists that a more general pattern is safe.

Every evolved skill must be:

1. versioned
2. reviewable
3. reversible
4. disabled by default until approved

## Persistence

Primary durable store:

`~/Library/Application Support/bmux/agent-intel/agent-intel.db`

Optional reviewed repo-local export:

`<repo>/.bmux/skills/`

Why this split:

1. global memory should not require committing files
2. repo-specific skills may later benefit from human review and version control

## Data Model

Minimum tables:

1. `runs`
2. `skills`
3. `skill_versions`
4. `skill_usage`
5. `evaluations`

Minimum statuses:

1. `candidate`
2. `canary`
3. `active`
4. `quarantined`
5. `disabled`

Minimum origins:

1. `manual`
2. `captured`
3. `fixed`
4. `derived`

## Measurement

Do not wait for perfect token accounting.
Use practical proxies first.

Primary success metrics:

1. fewer `agent.search` retries before first useful edit
2. fewer repeated failure signatures
3. lower MCP payload bytes on recurring tasks
4. faster time from first action to successful `task.result`
5. higher reuse rate of approved skills

## Safety Rules

1. no raw prompt self-modification
2. no automatic activation in v1
3. no cloud dependency in default path
4. no repo-to-global promotion without evidence
5. quarantine skills that correlate with regressions
6. keep retrieval bounded and compact

## First Implementation Slices

### Slice 1

Create the `agent-intel` foundation:

1. SQLite schema
2. CLI for recording runs
3. CLI for storing skill versions
4. CLI for searching skills
5. CLI for listing pending evaluations

### Slice 2

Connect bmux output into the recorder:

1. task result summary
2. failure signature
3. workspace fingerprint
4. selected skill ids

### Slice 3

Add candidate generation and human review:

1. propose `CAPTURED` candidate from repeated successful runs
2. propose `FIX` candidate from repeated skill-linked failures
3. keep activation manual

## Likely Files

Planning and docs:

1. `docs/bmux-optimize-plan.md`
2. `docs/codex-agent-guide.md`

Initial implementation:

1. `tools/agent-intel/db.ts`
2. `tools/agent-intel/types.ts`
3. `tools/agent-intel/cli.ts`

Later bmux integration:

1. `Sources/TerminalController.swift`

## Commit Strategy

Use two commits:

1. plan + sidecar foundation
2. bmux integration hooks

This keeps the first change isolated and avoids conflicts with the current dirty worktree in bmux runtime files.
