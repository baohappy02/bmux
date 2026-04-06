import type { SkillInput } from "./types";

export const DEFAULT_SKILLS: SkillInput[] = [
  {
    slug: "verify-loop",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Verify loop before log dives",
    summary:
      "Use bmux managed verify jobs with explicit pause control: stop on paused jobs, otherwise read compact task results before opening logs.",
    tags: ["verify", "task", "result", "diagnostics", "low-token"],
    contentMarkdown: `When to use
- You need to validate a code change or reproduce a build or test failure.

Steps
1. Run \`bmux agent task run-profile --session <sid> --profile verify.ts --json\`.
2. If the payload returns \`paused_for_user: true\`, stop and wait for the user instead of calling \`task wait\`, \`task result\`, or \`task logs\`.
3. Only when the task is intentionally unattended, run \`bmux agent task run-profile --session <sid> --pause-for-user false --profile verify.ts --json\`, then use \`bmux agent task wait --session <sid> --job <job-id> --json\`.
4. Read \`bmux agent task result --session <sid> --job <job-id> --json\` before asking for logs.
5. Only fetch \`task logs\` or \`artifact list\` if the result payload is not enough.

Verify
- Prefer parsed diagnostics, summary, and short tail from \`task result\`.
- Keep follow-up reads scoped to the failing job only.

Stop conditions
- For noisy verify work, assume bmux may pause by default and do not auto-wait past a paused payload.
- If \`verify.ts\` is unavailable, inspect \`bmux agent capabilities\` for profiles and package manager first.`,
  },
  {
    slug: "coding-principles",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Coding principles before and after edits",
    summary:
      "Treat code work as production work: inspect impact, keep one source of truth, handle failures explicitly, and verify behavior with tools.",
    tags: ["coding-principles", "quality", "review", "ssot", "impact", "verify"],
    contentMarkdown: `When to use
- You are reading code with intent to change it, reviewing a fix, or verifying behavior after an edit.

Steps
1. If the change touches shared code, inspect \`bmux agent code context|impact|changes --session <sid> ... --json\` first.
2. Prefer the simplest change that keeps one source of truth across code, config, docs, and instruction surfaces.
3. Keep failure paths explicit. Do not swallow errors or hide invariants behind force unwraps or bare catches.
4. Preserve readability: clear names, no dead code, and comments only for why.
5. Verify with the smallest useful tool loop before declaring success.

Verify
- State what you verified and what you could not verify.
- Treat instruction drift, config drift, and copy drift as engineering risk when they can mislead humans or agents.

Stop conditions
- If code intel is unavailable, fall back to scoped source reads and say so explicitly.`,
  },
  {
    slug: "bmux-managed-terminal-tasks",
    scope: "global",
    status: "active",
    origin: "manual",
    title: "Use bmux managed terminals for noisy commands",
    summary:
      "Prefer direct bmux task runs for single commands, open or ensure dedicated surfaces only when reuse matters, and keep logs compact.",
    tags: ["bmux-agent", "terminal", "task", "test", "build", "dev-server", "pause-for-user", "low-token"],
    contentMarkdown: `When to use
- You need to run tests, builds, installs, migrations, benchmarks, or dev servers from bmux.

Steps
1. For a single managed command, prefer \`bmux agent task run\` directly. It can auto-attach to the current focus and choose the task terminal without a separate attach or ensure step.
2. Use \`bmux agent task run-profile\` when a named verify or dev-server profile already exists.
3. Only call \`bmux agent capabilities\` when you need environment, profile, or helper discovery. Do not fetch it before every task.
4. Only open or ensure a dedicated terminal first when the user needs a specific reusable visible surface before the command starts.
5. Only call \`layout\` after topology changes or when the next step depends on pane or surface structure.
6. For noisy or user-visible work, let bmux pause by default or pass \`--pause-for-user true\`, then stop if the task payload returns \`paused_for_user: true\`.
7. Only for intentionally unattended work, pass \`--pause-for-user false\`, then use \`bmux agent task wait\` and \`bmux agent task result\`.
8. Only fetch \`task logs\` or artifacts if the task failed or the user asked for them.

Verify
- Keep output compact and prefer task result over raw terminal capture.
- If a split is refused by the visibility guard, accept the fallback tab or surface instead of forcing more panes.

Stop conditions
- If the payload is paused for user, do not auto-wait or auto-tail logs.
- If there is no live session, attach first.
- If no visible surface can be ensured, keep the command attached instead of launching an unobserved detached job.`,
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
- Prefer \`agent.code\` as the default path for local symbol, impact, rename, and changed-file questions.

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
- Fall back to \`agent search\` plus scoped \`rg\` reads only when the bmux-index backend is unavailable.

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

const REQUIRED_DEFAULT_SKILL_SLUGS = ["coding-principles", "bmux-managed-terminal-tasks"] as const;
const PAUSE_AWARE_DEFAULT_SKILL_SLUGS = ["verify-loop", "bmux-managed-terminal-tasks"] as const;

function stableDefaultRepoRoot(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function validateDefaultSkills(skills: SkillInput[] = DEFAULT_SKILLS): void {
  const seenKeys = new Set<string>();
  const availableSlugs = new Set<string>();

  for (const skill of skills) {
    const slug = skill.slug.trim();
    const title = skill.title.trim();
    const summary = skill.summary.trim();
    const contentMarkdown = skill.contentMarkdown.trim();
    const repoRoot = stableDefaultRepoRoot(skill.repoRoot);
    const key = [skill.scope, repoRoot ?? "", slug].join(":");

    if (!slug) {
      throw new Error("Default skill catalog contains an empty slug");
    }
    if (!title) {
      throw new Error(`Default skill '${slug}' is missing a title`);
    }
    if (!summary) {
      throw new Error(`Default skill '${slug}' is missing a summary`);
    }
    if (!contentMarkdown) {
      throw new Error(`Default skill '${slug}' is missing contentMarkdown`);
    }
    if (skill.scope === "global" && repoRoot) {
      throw new Error(`Global default skill '${slug}' must not set repoRoot`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`Default skill catalog contains a duplicate identity: ${key}`);
    }

    seenKeys.add(key);
    availableSlugs.add(slug);
  }

  for (const slug of REQUIRED_DEFAULT_SKILL_SLUGS) {
    if (!availableSlugs.has(slug)) {
      throw new Error(`Default skill catalog is missing required slug '${slug}'`);
    }
  }

  for (const slug of PAUSE_AWARE_DEFAULT_SKILL_SLUGS) {
    let matchingSkill: SkillInput | undefined;
    for (const skill of skills) {
      if (skill.slug.trim() == slug) {
        matchingSkill = skill;
        break;
      }
    }
    guardPauseAwareDefaultSkill(matchingSkill);
  }
}

function guardPauseAwareDefaultSkill(skill: SkillInput | undefined): void {
  if (!skill) {
    return;
  }

  const content = skill.contentMarkdown;
  if (!content.includes("paused_for_user: true")) {
    throw new Error(`Default skill '${skill.slug}' must mention the paused_for_user contract`);
  }
  if (!content.includes("--pause-for-user false")) {
    throw new Error(`Default skill '${skill.slug}' must document the unattended override`);
  }
  if (!content.includes("do not auto-wait") && !content.includes("stop and wait for the user")) {
    throw new Error(`Default skill '${skill.slug}' must stop automatic waiting after a paused task`);
  }
}
