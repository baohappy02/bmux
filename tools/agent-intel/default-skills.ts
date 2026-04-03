import type { SkillInput } from "./types";

export const DEFAULT_SKILLS: SkillInput[] = [
  {
    slug: "verify-loop",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Verify loop before log dives",
    summary: "Use bmux managed verify jobs, then read compact task results before opening logs.",
    tags: ["verify", "task", "result", "diagnostics", "low-token"],
    contentMarkdown: `When to use
- You need to validate a code change or reproduce a build or test failure.

Steps
1. Run \`bmux agent task run-profile --session <sid> --profile verify.ts --json\`.
2. Wait with \`bmux agent task wait --session <sid> --job <job-id> --json\`.
3. Read \`bmux agent task result --session <sid> --job <job-id> --json\` before asking for logs.
4. Only fetch \`task logs\` or \`artifact list\` if the result payload is not enough.

Verify
- Prefer parsed diagnostics, summary, and short tail from \`task result\`.
- Keep follow-up reads scoped to the failing job only.

Stop conditions
- If \`verify.ts\` is unavailable, inspect \`bmux agent capabilities\` for profiles and package manager first.`,
  },
  {
    slug: "search-then-rg",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Search concept first, exact match second",
    summary: "Use bmux local-first search for concept lookup, then narrow with rg for exact edits.",
    tags: ["search", "rg", "concept", "codebase", "low-token"],
    contentMarkdown: `When to use
- You are locating behavior in an unfamiliar repo.

Steps
1. Check \`bmux agent search status --session <sid> --json\`.
2. If the index is cold, run \`bmux agent search index --session <sid> --json\`.
3. Query with \`bmux agent search query --session <sid> --limit 5 --query "<concept>" --json\`.
4. Once one symbol or file stands out, switch to \`bmux agent code context|impact|trace|changes --session <sid> ... --json\`.
5. Use \`rg\` only after the compact search narrows the file set.

Verify
- Keep search hits to a small limit and prefer exact follow-up reads.
- Prefer \`agent.code\` over GitNexus for local symbol, impact, rename, and changed-file questions.

Stop conditions
- If the repo root is missing, re-check \`bmux agent capabilities\` for environment and cwd.`,
  },
  {
    slug: "code-intel-before-edit",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Use code intel before editing shared code",
    summary: "Resolve the symbol, inspect impact, and check current changes before mutating reused code.",
    tags: ["code-intel", "impact", "changes", "rename", "low-token"],
    contentMarkdown: `When to use
- You are about to edit a shared symbol, refactor, or rename code in a repo.

Steps
1. Check \`bmux agent code status --session <sid> --json\`.
2. If the index is missing or stale, run \`bmux agent code index --session <sid> --timeout-ms 120000 --json\`.
3. Resolve the target with \`bmux agent code symbols --session <sid> --query "<symbol>" --json\`.
4. Inspect \`bmux agent code context --session <sid> --symbol "<symbol>" [--path <path>] --json\`.
5. Inspect \`bmux agent code impact --session <sid> --symbol "<symbol>" [--path <path>] --json\`.
6. Check current scope with \`bmux agent code changes --session <sid> --scope unstaged --json\`.
7. Before renaming, preview with \`bmux agent code rename --session <sid> --symbol "<symbol>" --to "<new-name>" --json\`.

Verify
- Prefer compact counts, affected modules, and confidence tiers over rereading large files.
- Fall back to GitNexus only if bmux-index cannot answer the relation you need.

Stop conditions
- If \`agent code status\` reports the backend unavailable, use \`agent search\` plus \`rg\` as the fallback path.`,
  },
  {
    slug: "dev-server-readiness",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Managed dev server readiness",
    summary: "Use managed service profiles and readiness probes instead of parsing terminal boot logs.",
    tags: ["service", "dev-server", "wait", "readiness"],
    contentMarkdown: `When to use
- You need a local dev server or preview surface for browser work.

Steps
1. Start or reuse it with \`bmux agent ensure service --session <sid> --profile dev.web --json\`.
2. Wait with \`bmux agent service wait --session <sid> --port <port> --url-path / --json\`.
3. Inspect \`bmux agent service list --session <sid> --json\` instead of reading boot logs.

Verify
- Prefer event or service payloads over terminal capture.
- Only inspect logs if service wait times out or readiness probes fail.

Stop conditions
- If no service profile exists, inspect \`bmux agent capabilities\` and workspace state first.`,
  },
  {
    slug: "state-summary-resume",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Resume from state summary",
    summary: "Use state summary and events to resume cheaply instead of re-reading full layout or terminal history.",
    tags: ["resume", "state", "events", "layout"],
    contentMarkdown: `When to use
- You are resuming a bmux session or handing context across turns.

Steps
1. Attach with \`bmux agent attach --json\`.
2. Read \`bmux agent capabilities --session <sid> --json\` once.
3. Read \`bmux agent state summary --session <sid> --json\`.
4. Pull \`bmux agent events --session <sid> --since <cursor> --json\` for incremental changes.
5. Re-run \`layout\` only when topology changed.

Verify
- Use \`workspace_fingerprint\`, \`last_failed_job\`, and \`active_dev_server\` before broader inspection.
- Keep browser reads and terminal capture scoped to the focused surface.

Stop conditions
- If the session was recovered onto a different layout, refresh layout once and continue from the new cursor.`,
  },
];
