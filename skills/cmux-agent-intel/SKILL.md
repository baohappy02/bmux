---
name: cmux-agent-intel
description: Local-first retrieval and review loop for bmux Codex sessions. Use before broad search or long log reads to reuse compact skill cards, ingest recent run outcomes, and inspect capture or fix proposals.
---

# bmux Agent Intel

Use this skill when Codex should reuse known low-token workflows instead of rediscovering them.

## Fast Start

```bash
bmux agent intel seed-defaults --json
bmux agent intel search --session <sid> --query "verify failing change" --json
bmux agent intel propose --session <sid> --json
bmux agent intel evaluations --session <sid> --json
```

## Rules

1. Search first. Do not widen into broad logs or screenshots until `agent intel search` returns no useful card.
2. Use `bmux agent task result` before `task logs`.
3. Treat `propose` output as pending review, not auto-approved skill activation.
4. Keep repo-specific reuse gated to the current repo root.

## What It Stores

- compact run outcomes from `report_task_result`
- local skill cards in SQLite
- pending capture or fix evaluations

## References

- [../../docs/codex-agent-guide.md](../../docs/codex-agent-guide.md)
- [../../docs/bmux-optimize-plan.md](../../docs/bmux-optimize-plan.md)
