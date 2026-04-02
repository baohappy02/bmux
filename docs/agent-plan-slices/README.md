# bmux Agent Plan Slices

This folder turns the remaining work in [docs/bmux-browser-agent-plan.md](../bmux-browser-agent-plan.md) into reviewable Spark-sized slices.

Use it as the handoff pack for fast implementation plus manual review.

## Foundation Already Landed

These commits are already on `main`:

1. `2b438aef` `Add agent core surface controls`
2. `9556cd6a` `Add agent task and terminal primitives`
3. `d5d7e993` `Add agent events and service waiting`
4. `c081031a` `Add agent ensure and batch commands`
5. `slice 01 task-ops work is already landed locally and should not be reimplemented`

These are already done:

1. `agent.attach`
2. `agent.layout`
3. `agent.capabilities`
4. `agent.open`
5. `agent.ensure`
6. `agent.batch`
7. `agent.focus`
8. `agent.close`
9. `agent.surface.read`
10. `agent.terminal.write`
11. `agent.terminal.capture`
12. `agent.terminal.wait`
13. `agent.task.run`
14. `agent.task.run_profile`
15. `agent.task.wait`
16. `agent.task.result`
17. `agent.task.logs`
18. `agent.task.run_many`
19. `agent.task.cancel`
20. `agent.events`
21. `agent.service.list`
22. `agent.service.wait`
23. `Cmd+N -> ~/Desktop`
24. automatic workspace title basename plus duplicate disambiguation

## Remaining Slice Order

Implement in this order:

1. [02-m1-state-and-artifacts.md](./02-m1-state-and-artifacts.md)
2. [03-m2-events-services-profiles.md](./03-m2-events-services-profiles.md)
3. [04-m2-hardening-and-recovery.md](./04-m2-hardening-and-recovery.md)
4. [05-m2-managed-jobs-ux.md](./05-m2-managed-jobs-ux.md)
5. [06-m2-search-status-and-index.md](./06-m2-search-status-and-index.md)
6. [07-m2-search-query.md](./07-m2-search-query.md)
7. [08-m3-browser-agent-core.md](./08-m3-browser-agent-core.md)
8. [09-m3-browser-agent-actions.md](./09-m3-browser-agent-actions.md)
9. [10-agent-enablement-and-measurement.md](./10-agent-enablement-and-measurement.md)

## Rules For Every Slice

1. One slice per branch.
2. One slice per PR.
3. Do not mix unrelated docs or cleanup.
4. Do not run local tests.
5. Build only with `./scripts/reload.sh --tag <tag>`.
6. Keep outputs compact and machine-friendly.
7. Prefer existing `agent.*` namespaces over inventing new ones.
8. Reuse existing `AgentSession`, `AgentTask`, event, and artifact flows before adding new stores.
9. Respect the repo rule that non-focus socket commands must not steal app focus.
10. Prefer `bun` in examples and profiles when the project allows it.

## Spark Workflow

For each slice:

1. Checkout `main`.
2. Create the suggested branch from the slice doc.
3. Tell Spark to implement exactly one slice.
4. Let Spark build with the suggested tag.
5. Commit with the suggested message.
6. Push and stop.
7. Ask for review on that one PR or commit before moving on.

## Review Gate

After each Spark slice, review against:

1. contract shape
2. token efficiency
3. focus-steal regressions
4. hidden state duplication
5. event spam or oversized payloads
6. mismatches between CLI and socket methods
7. app-level regressions in workspace and surface behavior

## Notes For Search Work

Search slices must follow [docs/bmux-agent-search-architecture.md](../bmux-agent-search-architecture.md).

That document is the source of truth for:

1. local-first requirements
2. reduced GitNexus role
3. clean-room implementation direction
4. hybrid lexical plus semantic architecture
