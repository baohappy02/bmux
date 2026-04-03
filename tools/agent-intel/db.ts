import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { DEFAULT_SKILLS } from "./default-skills";
import type {
  AgentIntelMetrics,
  EvaluationDecision,
  EvaluationInput,
  EvaluationStatus,
  ProposedEvaluation,
  QueuedRunIngestResult,
  ReviewEvaluationResult,
  RunRecordInput,
  SkillListItem,
  SkillInput,
  SkillOrigin,
  SkillSearchResult,
  SkillStatus,
  SkillScope,
} from "./types";

const DEFAULT_STATE_DIR = normalizePathLike(process.env.BMUX_AGENT_INTEL_STATE_DIR);
const DEFAULT_DB_PATH =
  normalizePathLike(process.env.BMUX_AGENT_INTEL_DB_PATH) ||
  (DEFAULT_STATE_DIR ? resolve(DEFAULT_STATE_DIR, "agent-intel.db") : undefined);
const DEFAULT_QUEUE_PATH =
  normalizePathLike(process.env.BMUX_AGENT_INTEL_QUEUE_PATH) ||
  (DEFAULT_STATE_DIR ? resolve(DEFAULT_STATE_DIR, "run-queue.ndjson") : undefined);

function normalizePathLike(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolve(trimmed);
}

function fallbackStateDir(): string {
  const home = process.env.HOME;
  if (!home) {
    return resolve(".bmux-agent-intel");
  }
  return resolve(home, "Library/Application Support/bmux/agent-intel");
}

export function resolveStateDir(explicitPath?: string): string {
  return normalizePathLike(explicitPath) || DEFAULT_STATE_DIR || fallbackStateDir();
}

export function resolveDbPath(explicitPath?: string): string {
  return normalizePathLike(explicitPath) || DEFAULT_DB_PATH || resolve(resolveStateDir(), "agent-intel.db");
}

export function resolveQueuePath(explicitPath?: string): string {
  return normalizePathLike(explicitPath) || DEFAULT_QUEUE_PATH || resolve(resolveStateDir(), "run-queue.ndjson");
}

export function openDatabase(explicitPath?: string): Database {
  const dbPath = resolveDbPath(explicitPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  ensureSchema(db);
  return db;
}

export function ensureSchema(db: Database): void {
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      repo_root TEXT,
      workspace_fingerprint TEXT,
      task_text TEXT,
      execution_class TEXT,
      success INTEGER NOT NULL,
      duration_ms INTEGER,
      failure_signature TEXT,
      mcp_call_count INTEGER,
      payload_bytes_in INTEGER,
      payload_bytes_out INTEGER,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_runs_repo_exec_success_created
      ON runs(repo_root, execution_class, success, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_runs_failure_signature
      ON runs(repo_root, failure_signature, created_at DESC);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      scope TEXT NOT NULL,
      repo_root TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      origin TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_scope_slug_repo
      ON skills(scope, slug, repo_root);

    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      version_label TEXT,
      content_markdown TEXT NOT NULL,
      change_summary TEXT,
      tags_json TEXT NOT NULL,
      search_blob TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_skill_versions_skill
      ON skill_versions(skill_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS skill_usage (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      skill_version_id TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
      retrieval_rank INTEGER,
      retrieval_score REAL,
      selected INTEGER NOT NULL DEFAULT 0,
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      repo_root TEXT,
      target_skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL,
      proposed_slug TEXT,
      status TEXT NOT NULL,
      evidence_count INTEGER,
      summary TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_evaluations_repo_type_created
      ON evaluations(repo_root, type, created_at DESC);
  `);
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableRepoRoot(value?: string | null): string | null {
  return normalizePathLike(value) || null;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type EvaluationRow = {
  id: string;
  type: EvaluationInput["type"];
  repo_root: string | null;
  target_skill_id: string | null;
  proposed_slug: string | null;
  status: EvaluationStatus;
  evidence_count: number | null;
  summary: string;
  metadata_json: string | null;
  created_at: string;
};

type SkillVersionRow = {
  skillId: string;
  slug: string;
  title: string;
  scope: string;
  repoRoot: string;
  status: SkillStatus;
  origin: string;
  summary: string;
  versionId: string;
  versionLabel: string | null;
  contentMarkdown: string;
  changeSummary: string | null;
  tagsJson: string;
  searchBlob: string;
};

function latestSkillVersionRowQuery(whereClause = ""): string {
  return `
      SELECT
        s.id AS skillId,
        s.slug AS slug,
        s.title AS title,
        s.scope AS scope,
        s.repo_root AS repoRoot,
        s.status AS status,
        s.origin AS origin,
        s.summary AS summary,
        v.id AS versionId,
        v.version_label AS versionLabel,
        v.content_markdown AS contentMarkdown,
        v.change_summary AS changeSummary,
        v.tags_json AS tagsJson,
        v.search_blob AS searchBlob
      FROM skills s
      JOIN skill_versions v
        ON v.id = (
          SELECT sv.id
          FROM skill_versions sv
          WHERE sv.skill_id = s.id
          ORDER BY sv.created_at DESC, sv.id DESC
          LIMIT 1
        )
      WHERE s.status != 'disabled'
      ${whereClause}
  `;
}

function latestVersionRows(db: Database): SkillVersionRow[] {
  return db.query(latestSkillVersionRowQuery()).all() as SkillVersionRow[];
}

function latestSkillVersion(
  db: Database,
  params: { scope: SkillInput["scope"]; slug: string; repoRoot?: string | null }
):
  | {
      skillId: string;
      title: string;
      summary: string;
      status: SkillStatus;
      origin: string;
      contentMarkdown: string;
      changeSummary: string | null;
      versionLabel: string | null;
      tagsJson: string;
    }
  | null {
  const repoRoot = stableRepoRoot(params.repoRoot) ?? "";
  return db
    .query(
      `
      SELECT
        s.id AS skillId,
        s.title AS title,
        s.summary AS summary,
        s.status AS status,
        s.origin AS origin,
        v.content_markdown AS contentMarkdown,
        v.change_summary AS changeSummary,
        v.version_label AS versionLabel,
        v.tags_json AS tagsJson
      FROM skills s
      JOIN skill_versions v
        ON v.id = (
          SELECT sv.id
          FROM skill_versions sv
          WHERE sv.skill_id = s.id
          ORDER BY sv.created_at DESC, sv.id DESC
          LIMIT 1
        )
      WHERE s.scope = ? AND s.slug = ? AND s.repo_root = ?
      LIMIT 1
      `
    )
    .get(params.scope, params.slug, repoRoot) as
    | {
        skillId: string;
        title: string;
        summary: string;
        status: SkillStatus;
        origin: string;
        contentMarkdown: string;
        changeSummary: string | null;
        versionLabel: string | null;
        tagsJson: string;
      }
    | null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreSearchBlob(params: {
  queryTokens: string[];
  searchBlob: string;
  slug: string;
  title: string;
  scope: string;
  repoRoot: string | null;
  requestedRepoRoot: string | null;
  status: SkillStatus;
}): { score: number; reasons: string[] } {
  const searchBlob = params.searchBlob.toLowerCase();
  const slug = params.slug.toLowerCase();
  const title = params.title.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  for (const token of params.queryTokens) {
    if (slug.includes(token)) {
      score += 7;
      reasons.push(`slug:${token}`);
      continue;
    }
    if (title.includes(token)) {
      score += 5;
      reasons.push(`title:${token}`);
      continue;
    }
    if (searchBlob.includes(token)) {
      score += 2;
      reasons.push(`content:${token}`);
    }
  }

  if (params.requestedRepoRoot && params.repoRoot === params.requestedRepoRoot) {
    score += 6;
    reasons.push("repo-match");
  } else if (params.scope === "global") {
    score += 1;
    reasons.push("global-fallback");
  }

  if (params.status === "active") {
    score += 3;
    reasons.push("active");
  } else if (params.status === "canary") {
    score += 1;
    reasons.push("canary");
  } else if (params.status === "quarantined") {
    score -= 5;
    reasons.push("quarantined");
  }

  return { score, reasons };
}

function mapSkillVersionRow(row: SkillVersionRow): SkillListItem {
  return {
    skillId: row.skillId,
    versionId: row.versionId,
    versionLabel: row.versionLabel,
    slug: row.slug,
    title: row.title,
    scope: row.scope as SkillScope,
    repoRoot: row.repoRoot || null,
    status: row.status,
    origin: row.origin as SkillOrigin,
    summary: row.summary,
    contentMarkdown: row.contentMarkdown,
    changeSummary: row.changeSummary,
    tags: parseJson<string[]>(row.tagsJson, []),
  };
}

function readEvaluationRow(db: Database, evaluationId: string): EvaluationRow | null {
  return db
    .query(
      `
      SELECT *
      FROM evaluations
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(evaluationId) as EvaluationRow | null;
}

function updateEvaluation(
  db: Database,
  params: {
    evaluationId: string;
    status: EvaluationStatus;
    metadata: Record<string, unknown> | null;
  }
): void {
  db.query(
    `
    UPDATE evaluations
    SET status = ?, metadata_json = ?
    WHERE id = ?
    `
  ).run(params.status, toJson(params.metadata), params.evaluationId);
}

function buildSkillDraftFromEvaluation(row: EvaluationRow): SkillInput {
  const metadata = parseJson<Record<string, unknown> | null>(row.metadata_json, null) ?? {};
  const repoRoot = stableRepoRoot(row.repo_root);
  const taskText = typeof metadata.taskText === "string" ? metadata.taskText.trim() : "";
  const executionClass =
    typeof metadata.executionClass === "string" ? metadata.executionClass.trim() : "";
  const failureSignature =
    typeof metadata.failureSignature === "string" ? metadata.failureSignature.trim() : "";
  const scope: SkillScope = repoRoot ? "repo" : "global";
  const origin: SkillOrigin =
    row.type === "capture" ? "captured" : row.type === "fix" ? "fixed" : "derived";
  const proposedSlug =
    row.proposed_slug?.trim() ||
    `${row.type}-${slugify(taskText || executionClass || row.summary).slice(0, 48)}`;
  const conciseTask = taskText || executionClass || row.summary;
  const titlePrefix = row.type === "fix" ? "Fix" : row.type === "derived" ? "Derived" : "Captured";
  const title = `${titlePrefix}: ${conciseTask}`;
  const tags = [
    row.type,
    scope,
    executionClass ? slugify(executionClass) : "",
    failureSignature ? slugify(failureSignature).slice(0, 32) : "",
  ].filter((value) => value.length > 0);

  const whenToUse = [`- use for: ${conciseTask}`];
  if (repoRoot) {
    whenToUse.push(`- repo root must match: \`${repoRoot}\``);
  }
  if (executionClass) {
    whenToUse.push(`- execution class: \`${executionClass}\``);
  }

  const checks = [
    "- search for an existing compact skill card before reading long logs",
    "- prefer `agent task result` and `agent state summary` before tailing logs",
  ];
  if (failureSignature) {
    checks.push(`- watch for failure signature: \`${failureSignature}\``);
  }

  const steps =
    row.type === "fix"
      ? [
          "1. reproduce with the smallest failing command or verify profile",
          "2. inspect `agent task result` for parsed diagnostics and short tail",
          "3. narrow to the reported failure signature before widening search",
          "4. patch the smallest likely root cause, then rerun the same verify path",
        ]
      : [
          "1. attach or reuse the current bmux session",
          "2. search local code or bmux agent search with a narrow task query",
          "3. run the smallest verify path that proves the task is complete",
          "4. only widen to logs or browser artifacts if result and state summary are insufficient",
        ];

  const verify = [
    "- rerun the same task or verify profile",
    "- confirm `task.result.ok=true` or equivalent success signal",
    "- capture only compact evidence back into agent-intel",
  ];

  const pitfalls = [
    "- do not generalize this skill across unrelated repos without repeated wins",
    "- do not promote directly to active until canary runs are clean",
  ];

  const contentMarkdown = [
    "# When To Use",
    ...whenToUse,
    "",
    "# Prechecks",
    ...checks,
    "",
    "# Steps",
    ...steps,
    "",
    "# Verify",
    ...verify,
    "",
    "# Pitfalls",
    ...pitfalls,
  ].join("\n");

  return {
    slug: proposedSlug,
    scope,
    repoRoot,
    status: "canary",
    origin,
    title,
    summary: row.summary,
    contentMarkdown,
    changeSummary: `Approved from evaluation ${row.id}`,
    versionLabel: `${row.type}.v1`,
    tags,
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? null;
}

export function insertRun(
  db: Database,
  input: RunRecordInput
): { runId: string; inserted: boolean } {
  const runId = input.id?.trim() || nowId("run");
  const result = db
    .query(
      `
      INSERT OR IGNORE INTO runs (
        id,
        repo_root,
        workspace_fingerprint,
        task_text,
        execution_class,
        success,
        duration_ms,
        failure_signature,
        mcp_call_count,
        payload_bytes_in,
        payload_bytes_out,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      runId,
      stableRepoRoot(input.repoRoot),
      input.workspaceFingerprint ?? null,
      input.taskText ?? null,
      input.executionClass ?? null,
      input.success ? 1 : 0,
      input.durationMs ?? null,
      input.failureSignature ?? null,
      input.mcpCallCount ?? null,
      input.payloadBytesIn ?? null,
      input.payloadBytesOut ?? null,
      toJson(input.metadata ?? null)
    );
  return {
    runId,
    inserted: Number(result.changes ?? 0) > 0,
  };
}

export function upsertSkill(db: Database, input: SkillInput): { skillId: string; versionId: string } {
  const repoRoot = stableRepoRoot(input.repoRoot) ?? "";
  const existing = db
    .query(
      `
      SELECT id
      FROM skills
      WHERE scope = ? AND slug = ? AND repo_root = ?
      LIMIT 1
      `
    )
    .get(input.scope, input.slug, repoRoot) as { id: string } | null;

  const skillId = existing?.id || input.id?.trim() || nowId("skill");
  const versionId = nowId("skillv");
  const tags = input.tags ?? [];
  const searchBlob = [
    input.slug,
    input.title,
    input.summary,
    input.changeSummary ?? "",
    tags.join(" "),
    input.contentMarkdown,
  ]
    .join("\n")
    .trim();

  db.transaction(() => {
    if (existing) {
      db.query(
        `
        UPDATE skills
        SET status = ?, origin = ?, title = ?, summary = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `
      ).run(input.status, input.origin, input.title, input.summary, skillId);
    } else {
      db.query(
        `
        INSERT INTO skills (
          id, slug, scope, repo_root, status, origin, title, summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        skillId,
        input.slug,
        input.scope,
        repoRoot,
        input.status,
        input.origin,
        input.title,
        input.summary
      );
    }

    db.query(
      `
      INSERT INTO skill_versions (
        id, skill_id, version_label, content_markdown, change_summary, tags_json, search_blob
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      versionId,
      skillId,
      input.versionLabel ?? null,
      input.contentMarkdown,
      input.changeSummary ?? null,
      toJson(tags),
      searchBlob
    );
  })();

  return { skillId, versionId };
}

export function recordSkillUsage(
  db: Database,
  params: {
    runId: string;
    skillId: string;
    versionId: string;
    retrievalRank?: number | null;
    retrievalScore?: number | null;
    selected?: boolean;
    outcome?: string | null;
  }
): string {
  const usageId = nowId("usage");
  db.query(
    `
    INSERT INTO skill_usage (
      id, run_id, skill_id, skill_version_id, retrieval_rank, retrieval_score, selected, outcome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    usageId,
    params.runId,
    params.skillId,
    params.versionId,
    params.retrievalRank ?? null,
    params.retrievalScore ?? null,
    params.selected ? 1 : 0,
    params.outcome ?? null
  );
  return usageId;
}

export function createEvaluation(db: Database, input: EvaluationInput): string {
  const evaluationId = nowId("eval");
  db.query(
    `
    INSERT INTO evaluations (
      id, type, repo_root, target_skill_id, proposed_slug, status, evidence_count, summary, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    evaluationId,
    input.type,
    stableRepoRoot(input.repoRoot),
    input.targetSkillId ?? null,
    input.proposedSlug ?? null,
    input.status ?? "pending",
    input.evidenceCount ?? null,
    input.summary,
    toJson(input.metadata ?? null)
  );
  return evaluationId;
}

export function listEvaluations(
  db: Database,
  options: { repoRoot?: string | null; limit?: number } = {}
): Array<Record<string, unknown>> {
  const repoRoot = stableRepoRoot(options.repoRoot);
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  const rows = repoRoot
    ? (db
        .query(
          `
          SELECT *
          FROM evaluations
          WHERE repo_root = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
          `
        )
        .all(repoRoot, limit) as Array<Record<string, unknown>>)
    : (db
        .query(
          `
          SELECT *
          FROM evaluations
          ORDER BY created_at DESC, id DESC
          LIMIT ?
          `
        )
        .all(limit) as Array<Record<string, unknown>>);

  return rows.map((row) => {
    const metadata = parseJson<Record<string, unknown> | null>(
      typeof row.metadata_json === "string" ? row.metadata_json : null,
      null
    );
    return {
      ...row,
      metadata,
    };
  });
}

export function listSkills(
  db: Database,
  options: { repoRoot?: string | null; status?: SkillStatus | null; limit?: number } = {}
): SkillListItem[] {
  const repoRoot = stableRepoRoot(options.repoRoot);
  const status = options.status?.trim() as SkillStatus | undefined;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const filters: string[] = [];
  const params: unknown[] = [];

  if (repoRoot) {
    filters.push("AND s.repo_root = ?");
    params.push(repoRoot);
  }
  if (status) {
    filters.push("AND s.status = ?");
    params.push(status);
  }

  const query = `
    ${latestSkillVersionRowQuery(filters.join("\n"))}
    ORDER BY
      CASE s.status
        WHEN 'active' THEN 1
        WHEN 'canary' THEN 2
        WHEN 'candidate' THEN 3
        WHEN 'quarantined' THEN 4
        ELSE 5
      END,
      s.updated_at DESC,
      s.slug ASC
    LIMIT ?
  `;

  const rows = db.query(query).all(...params, limit) as SkillVersionRow[];
  return rows.map(mapSkillVersionRow);
}

export function searchSkills(
  db: Database,
  options: { query: string; repoRoot?: string | null; limit?: number }
): SkillSearchResult[] {
  const queryTokens = tokenize(options.query);
  const requestedRepoRoot = stableRepoRoot(options.repoRoot);
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20));

  if (queryTokens.length === 0) {
    return [];
  }

  const rows = latestVersionRows(db);
  return rows
    .map((row) => {
      const { score, reasons } = scoreSearchBlob({
        queryTokens,
        searchBlob: row.searchBlob,
        slug: row.slug,
        title: row.title,
        scope: row.scope,
        repoRoot: row.repoRoot || null,
        requestedRepoRoot,
        status: row.status,
      });
      return {
        ...mapSkillVersionRow(row),
        score,
        reasons,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

export function ingestQueuedRuns(
  db: Database,
  explicitQueuePath?: string
): QueuedRunIngestResult {
  const queuePath = resolveQueuePath(explicitQueuePath);
  mkdirSync(dirname(queuePath), { recursive: true });

  if (!existsSync(queuePath)) {
    return {
      queuePath,
      ingested: 0,
      skipped: 0,
      errorCount: 0,
      errors: [],
    };
  }

  const processingPath = `${queuePath}.processing.${process.pid}.${Date.now()}`;
  try {
    renameSync(queuePath, processingPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        queuePath,
        ingested: 0,
        skipped: 0,
        errorCount: 0,
        errors: [],
      };
    }
    throw error;
  }

  const errors: Array<{ line: number; error: string }> = [];
  let ingested = 0;
  let skipped = 0;

  try {
    const raw = readFileSync(processingPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      try {
        const record = JSON.parse(line) as RunRecordInput;
        if (typeof record.success !== "boolean") {
          throw new Error("Queued run is missing boolean success");
        }
        const result = insertRun(db, record);
        if (result.inserted) {
          ingested += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        errors.push({
          line: index + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    rmSync(processingPath, { force: true });
  }

  return {
    queuePath,
    ingested,
    skipped,
    errorCount: errors.length,
    errors: errors.slice(0, 20),
  };
}

export function seedDefaultSkills(db: Database): {
  inserted: number;
  updated: number;
  skipped: number;
  skillIds: string[];
} {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const skillIds: string[] = [];

  for (const skill of DEFAULT_SKILLS) {
    const existing = latestSkillVersion(db, skill);
    const existingTags = existing ? parseJson<string[]>(existing.tagsJson, []) : [];
    const unchanged =
      existing &&
      existing.title === skill.title &&
      existing.summary === skill.summary &&
      existing.status === skill.status &&
      existing.origin === skill.origin &&
      existing.contentMarkdown === skill.contentMarkdown &&
      (existing.changeSummary ?? null) === (skill.changeSummary ?? null) &&
      (existing.versionLabel ?? null) === (skill.versionLabel ?? null) &&
      JSON.stringify(existingTags) === JSON.stringify(skill.tags ?? []);

    if (unchanged) {
      skillIds.push(existing.skillId);
      skipped += 1;
      continue;
    }

    const result = upsertSkill(db, skill);
    skillIds.push(result.skillId);
    if (existing) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }

  return { inserted, updated, skipped, skillIds };
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "candidate";
}

function insertEvaluationIfMissing(
  db: Database,
  input: EvaluationInput
): { evaluationId: string; created: boolean } {
  const repoRoot = stableRepoRoot(input.repoRoot);
  const proposedSlug = input.proposedSlug?.trim() || null;
  const existing = db
    .query(
      `
      SELECT id
      FROM evaluations
      WHERE type = ?
        AND COALESCE(repo_root, '') = COALESCE(?, '')
        AND COALESCE(proposed_slug, '') = COALESCE(?, '')
        AND summary = ?
      LIMIT 1
      `
    )
    .get(input.type, repoRoot, proposedSlug, input.summary) as { id: string } | null;

  if (existing) {
    return { evaluationId: existing.id, created: false };
  }

  return {
    evaluationId: createEvaluation(db, input),
    created: true,
  };
}

export function proposeEvaluations(
  db: Database,
  options: { repoRoot?: string | null; limit?: number; minOccurrences?: number } = {}
): ProposedEvaluation[] {
  const repoRoot = stableRepoRoot(options.repoRoot);
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const minOccurrences = Math.max(2, Math.min(options.minOccurrences ?? 2, 20));
  const proposals: ProposedEvaluation[] = [];

  const captureWhere = repoRoot ? "AND repo_root = ?" : "";
  const captureRows = repoRoot
    ? (db
        .query(
          `
          SELECT repo_root, execution_class, task_text, COUNT(*) AS sample_count
          FROM runs
          WHERE success = 1
            AND task_text IS NOT NULL
            AND TRIM(task_text) != ''
            ${captureWhere}
          GROUP BY repo_root, execution_class, task_text
          HAVING COUNT(*) >= ?
          ORDER BY sample_count DESC, MAX(created_at) DESC
          LIMIT ?
          `
        )
        .all(repoRoot, minOccurrences, limit) as Array<{
          repo_root: string | null;
          execution_class: string | null;
          task_text: string | null;
          sample_count: number;
        }>)
    : (db
        .query(
          `
          SELECT repo_root, execution_class, task_text, COUNT(*) AS sample_count
          FROM runs
          WHERE success = 1
            AND task_text IS NOT NULL
            AND TRIM(task_text) != ''
          GROUP BY repo_root, execution_class, task_text
          HAVING COUNT(*) >= ?
          ORDER BY sample_count DESC, MAX(created_at) DESC
          LIMIT ?
          `
        )
        .all(minOccurrences, limit) as Array<{
          repo_root: string | null;
          execution_class: string | null;
          task_text: string | null;
          sample_count: number;
        }>);

  for (const row of captureRows) {
    const taskText = row.task_text?.trim();
    if (!taskText) {
      continue;
    }
    const executionClass = row.execution_class?.trim() || "unclassified";
    const proposedSlug = `capture-${slugify(taskText).slice(0, 48)}`;
    const summary = `Repeated successful runs for "${taskText}" in execution class "${executionClass}"`;
    const result = insertEvaluationIfMissing(db, {
      type: "capture",
      repoRoot: row.repo_root,
      proposedSlug,
      status: "pending",
      evidenceCount: row.sample_count,
      summary,
      metadata: {
        taskText,
        executionClass,
        source: "runs",
        mode: "captured_candidate",
      },
    });
    proposals.push({
      evaluationId: result.evaluationId,
      type: "capture",
      repoRoot: stableRepoRoot(row.repo_root),
      proposedSlug,
      summary,
      evidenceCount: row.sample_count,
      created: result.created,
    });
  }

  const fixRows = repoRoot
    ? (db
        .query(
          `
          SELECT
            repo_root,
            execution_class,
            task_text,
            failure_signature,
            COUNT(*) AS sample_count
          FROM runs
          WHERE success = 0
            AND failure_signature IS NOT NULL
            AND TRIM(failure_signature) != ''
            AND COALESCE(task_text, '') != ''
            AND repo_root = ?
          GROUP BY repo_root, execution_class, task_text, failure_signature
          HAVING COUNT(*) >= ?
          ORDER BY sample_count DESC, MAX(created_at) DESC
          LIMIT ?
          `
        )
        .all(repoRoot, minOccurrences, limit) as Array<{
          repo_root: string | null;
          execution_class: string | null;
          task_text: string | null;
          failure_signature: string;
          sample_count: number;
        }>)
    : (db
        .query(
          `
          SELECT
            repo_root,
            execution_class,
            task_text,
            failure_signature,
            COUNT(*) AS sample_count
          FROM runs
          WHERE success = 0
            AND failure_signature IS NOT NULL
            AND TRIM(failure_signature) != ''
            AND COALESCE(task_text, '') != ''
          GROUP BY repo_root, execution_class, task_text, failure_signature
          HAVING COUNT(*) >= ?
          ORDER BY sample_count DESC, MAX(created_at) DESC
          LIMIT ?
          `
        )
        .all(minOccurrences, limit) as Array<{
          repo_root: string | null;
          execution_class: string | null;
          task_text: string | null;
          failure_signature: string;
          sample_count: number;
        }>);

  for (const row of fixRows) {
    const taskText = row.task_text?.trim() || row.execution_class?.trim() || "task";
    const executionClass = row.execution_class?.trim() || "unclassified";
    const failureSignature = row.failure_signature.trim();
    if (!failureSignature) {
      continue;
    }
    const proposedSlug = `fix-${slugify(taskText).slice(0, 48)}`;
    const summary = `Repeated failure signature "${failureSignature}" for "${taskText}" in execution class "${executionClass}"`;
    const result = insertEvaluationIfMissing(db, {
      type: "fix",
      repoRoot: row.repo_root,
      proposedSlug,
      status: "pending",
      evidenceCount: row.sample_count,
      summary,
      metadata: {
        taskText,
        executionClass,
        failureSignature,
        source: "runs",
        mode: "fix_candidate",
      },
    });
    proposals.push({
      evaluationId: result.evaluationId,
      type: "fix",
      repoRoot: stableRepoRoot(row.repo_root),
      proposedSlug,
      summary,
      evidenceCount: row.sample_count,
      created: result.created,
    });
  }

  return proposals;
}

export function reviewEvaluation(
  db: Database,
  params: {
    evaluationId: string;
    decision: EvaluationDecision;
    note?: string | null;
    activate?: boolean;
  }
): ReviewEvaluationResult {
  const row = readEvaluationRow(db, params.evaluationId);
  if (!row) {
    throw new Error(`Unknown evaluation: ${params.evaluationId}`);
  }

  const currentMetadata = parseJson<Record<string, unknown> | null>(row.metadata_json, null) ?? {};
  const reviewedAt = new Date().toISOString();
  const reviewNote = params.note?.trim() || null;

  if (params.decision === "reject") {
    const metadata = {
      ...currentMetadata,
      review: {
        decision: "reject",
        reviewedAt,
        note: reviewNote,
      },
    };
    updateEvaluation(db, {
      evaluationId: row.id,
      status: "rejected",
      metadata,
    });
    return {
      evaluationId: row.id,
      status: "rejected",
      decision: "reject",
      skillId: null,
      versionId: null,
      skillStatus: null,
    };
  }

  const skillDraft = buildSkillDraftFromEvaluation(row);
  if (params.activate) {
    skillDraft.status = "active";
  }
  const { skillId, versionId } = upsertSkill(db, skillDraft);
  const metadata = {
    ...currentMetadata,
    review: {
      decision: "approve",
      reviewedAt,
      note: reviewNote,
      activate: Boolean(params.activate),
    },
    appliedSkillId: skillId,
    appliedVersionId: versionId,
    appliedSkillStatus: skillDraft.status,
  };
  updateEvaluation(db, {
    evaluationId: row.id,
    status: "approved",
    metadata,
  });

  return {
    evaluationId: row.id,
    status: "approved",
    decision: "approve",
    skillId,
    versionId,
    skillStatus: skillDraft.status,
  };
}

export function setSkillStatus(
  db: Database,
  params: {
    skillId: string;
    status: SkillStatus;
  }
): { skillId: string; status: SkillStatus } {
  const result = db
    .query(
      `
      UPDATE skills
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    )
    .run(params.status, params.skillId);

  if (Number(result.changes ?? 0) === 0) {
    throw new Error(`Unknown skill: ${params.skillId}`);
  }

  return {
    skillId: params.skillId,
    status: params.status,
  };
}

export function computeMetrics(
  db: Database,
  options: { repoRoot?: string | null; limit?: number } = {}
): AgentIntelMetrics {
  const repoRoot = stableRepoRoot(options.repoRoot);
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20));

  const runWhere = repoRoot ? "WHERE repo_root = ?" : "";
  const runCounts = (repoRoot
    ? db
        .query(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count
          FROM runs
          ${runWhere}
          `
        )
        .get(repoRoot)
    : db
        .query(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count
          FROM runs
          `
        )
        .get()) as {
    total: number | null;
    success_count: number | null;
    failure_count: number | null;
  };

  const durationRows = (repoRoot
    ? db
        .query(
          `
          SELECT duration_ms
          FROM runs
          WHERE repo_root = ? AND duration_ms IS NOT NULL
          ORDER BY duration_ms ASC
          `
        )
        .all(repoRoot)
    : db
        .query(
          `
          SELECT duration_ms
          FROM runs
          WHERE duration_ms IS NOT NULL
          ORDER BY duration_ms ASC
          `
        )
        .all()) as Array<{ duration_ms: number }>;
  const durations = durationRows
    .map((row) => Number(row.duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const recurringSuccessPatterns = Number(
    (
      repoRoot
        ? db
            .query(
              `
              SELECT COUNT(*) AS count
              FROM (
                SELECT 1
                FROM runs
                WHERE repo_root = ?
                  AND success = 1
                  AND COALESCE(task_text, '') != ''
                GROUP BY task_text, execution_class
                HAVING COUNT(*) >= 2
              )
              `
            )
            .get(repoRoot)
        : db
            .query(
              `
              SELECT COUNT(*) AS count
              FROM (
                SELECT 1
                FROM runs
                WHERE success = 1
                  AND COALESCE(task_text, '') != ''
                GROUP BY task_text, execution_class
                HAVING COUNT(*) >= 2
              )
              `
            )
            .get()
    ) as { count: number }
  .count);

  const recurringFailurePatterns = Number(
    (
      repoRoot
        ? db
            .query(
              `
              SELECT COUNT(*) AS count
              FROM (
                SELECT 1
                FROM runs
                WHERE repo_root = ?
                  AND success = 0
                  AND COALESCE(failure_signature, '') != ''
                GROUP BY failure_signature, execution_class
                HAVING COUNT(*) >= 2
              )
              `
            )
            .get(repoRoot)
        : db
            .query(
              `
              SELECT COUNT(*) AS count
              FROM (
                SELECT 1
                FROM runs
                WHERE success = 0
                  AND COALESCE(failure_signature, '') != ''
                GROUP BY failure_signature, execution_class
                HAVING COUNT(*) >= 2
              )
              `
            )
            .get()
    ) as { count: number }
  .count);

  const failureRows = (repoRoot
    ? db
        .query(
          `
          SELECT failure_signature AS failureSignature, COUNT(*) AS count
          FROM runs
          WHERE repo_root = ?
            AND success = 0
            AND COALESCE(failure_signature, '') != ''
          GROUP BY failure_signature
          ORDER BY count DESC, MAX(created_at) DESC
          LIMIT ?
          `
        )
        .all(repoRoot, limit)
    : db
        .query(
          `
          SELECT failure_signature AS failureSignature, COUNT(*) AS count
          FROM runs
          WHERE success = 0
            AND COALESCE(failure_signature, '') != ''
          GROUP BY failure_signature
          ORDER BY count DESC, MAX(created_at) DESC
          LIMIT ?
          `
        )
        .all(limit)) as Array<{ failureSignature: string; count: number }>;

  const evaluationCounts = (repoRoot
    ? db
        .query(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
          FROM evaluations
          WHERE repo_root = ?
          `
        )
        .get(repoRoot)
    : db
        .query(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
          FROM evaluations
          `
        )
        .get()) as {
    total: number | null;
    pending_count: number | null;
    approved_count: number | null;
    rejected_count: number | null;
  };

  const skillRows = (repoRoot
    ? db
        .query(
          `
          SELECT status, COUNT(*) AS count
          FROM skills
          WHERE repo_root = ? OR repo_root = ''
          GROUP BY status
          `
        )
        .all(repoRoot)
    : db
        .query(
          `
          SELECT status, COUNT(*) AS count
          FROM skills
          GROUP BY status
          `
        )
        .all()) as Array<{ status: SkillStatus; count: number }>;
  const skillsByStatus = skillRows.reduce<Partial<Record<SkillStatus, number>>>((acc, row) => {
    acc[row.status] = Number(row.count);
    return acc;
  }, {});

  const usageCounts = (repoRoot
    ? db
        .query(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN su.selected = 1 THEN 1 ELSE 0 END) AS selected_count,
            SUM(CASE WHEN su.outcome = 'success' THEN 1 ELSE 0 END) AS success_count
          FROM skill_usage su
          JOIN runs r ON r.id = su.run_id
          WHERE r.repo_root = ?
          `
        )
        .get(repoRoot)
    : db
        .query(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN selected = 1 THEN 1 ELSE 0 END) AS selected_count,
            SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success_count
          FROM skill_usage
          `
        )
        .get()) as {
    total: number | null;
    selected_count: number | null;
    success_count: number | null;
  };

  const totalRuns = Number(runCounts.total ?? 0);
  const successRuns = Number(runCounts.success_count ?? 0);
  const failureRuns = Number(runCounts.failure_count ?? 0);

  return {
    repoRoot,
    runs: {
      total: totalRuns,
      success: successRuns,
      failure: failureRuns,
      successRate: totalRuns > 0 ? Number((successRuns / totalRuns).toFixed(4)) : 0,
      medianDurationMs: percentile(durations, 0.5),
      p90DurationMs: percentile(durations, 0.9),
      recurringSuccessPatterns,
      recurringFailurePatterns,
    },
    skills: {
      total: skillRows.reduce((sum, row) => sum + Number(row.count), 0),
      byStatus: skillsByStatus,
    },
    evaluations: {
      total: Number(evaluationCounts.total ?? 0),
      pending: Number(evaluationCounts.pending_count ?? 0),
      approved: Number(evaluationCounts.approved_count ?? 0),
      rejected: Number(evaluationCounts.rejected_count ?? 0),
    },
    usage: {
      total: Number(usageCounts.total ?? 0),
      selected: Number(usageCounts.selected_count ?? 0),
      successful: Number(usageCounts.success_count ?? 0),
    },
    topFailureSignatures: failureRows.map((row) => ({
      failureSignature: row.failureSignature,
      count: Number(row.count),
    })),
  };
}

export function databaseStatus(
  db: Database,
  options: { queuePath?: string } = {}
): Record<string, unknown> {
  const runCount = Number((db.query("SELECT COUNT(*) AS count FROM runs").get() as { count: number }).count);
  const skillCount = Number((db.query("SELECT COUNT(*) AS count FROM skills").get() as { count: number }).count);
  const versionCount = Number(
    (db.query("SELECT COUNT(*) AS count FROM skill_versions").get() as { count: number }).count
  );
  const evaluationCount = Number(
    (db.query("SELECT COUNT(*) AS count FROM evaluations").get() as { count: number }).count
  );

  const queuePath = resolveQueuePath(options.queuePath);
  const pendingQueueBytes = existsSync(queuePath) ? readFileSync(queuePath).byteLength : 0;

  return {
    dbPath: db.filename,
    queuePath,
    pendingQueueBytes,
    runs: runCount,
    skills: skillCount,
    skillVersions: versionCount,
    evaluations: evaluationCount,
  };
}
