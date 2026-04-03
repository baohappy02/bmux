import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  EvaluationInput,
  SkillInput,
  SkillSearchResult,
  SkillStatus,
  RunRecordInput,
} from "./types";

const DEFAULT_DB_PATH =
  process.env.BMUX_AGENT_INTEL_DB_PATH ||
  (process.env.BMUX_AGENT_INTEL_STATE_DIR
    ? `${process.env.BMUX_AGENT_INTEL_STATE_DIR.replace(/\/$/, "")}/agent-intel.db`
    : undefined);

function fallbackDbPath(): string {
  const home = process.env.HOME;
  if (!home) {
    return resolve(".bmux-agent-intel", "agent-intel.db");
  }
  return resolve(home, "Library/Application Support/bmux/agent-intel/agent-intel.db");
}

export function resolveDbPath(explicitPath?: string): string {
  return explicitPath || DEFAULT_DB_PATH || fallbackDbPath();
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
  `);
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableRepoRoot(value?: string | null): string | null {
  return value?.trim() ? resolve(value.trim()) : null;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null): T {
  if (!value) {
    return [] as T;
  }
  return JSON.parse(value) as T;
}

function latestVersionRows(db: Database): Array<{
  skillId: string;
  slug: string;
  title: string;
  scope: string;
  repoRoot: string;
  status: SkillStatus;
  origin: string;
  summary: string;
  versionId: string;
  changeSummary: string | null;
  tagsJson: string;
  searchBlob: string;
}> {
  return db
    .query(
      `
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
      `
    )
    .all() as Array<{
      skillId: string;
      slug: string;
      title: string;
      scope: string;
      repoRoot: string;
      status: SkillStatus;
      origin: string;
      summary: string;
      versionId: string;
      changeSummary: string | null;
      tagsJson: string;
      searchBlob: string;
    }>;
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

export function insertRun(db: Database, input: RunRecordInput): string {
  const runId = input.id?.trim() || nowId("run");
  db.query(
    `
    INSERT INTO runs (
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
  ).run(
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
  return runId;
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

export function recordSkillUsage(db: Database, params: {
  runId: string;
  skillId: string;
  versionId: string;
  retrievalRank?: number | null;
  retrievalScore?: number | null;
  selected?: boolean;
  outcome?: string | null;
}): string {
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

  if (repoRoot) {
    return db
      .query(
        `
        SELECT *
        FROM evaluations
        WHERE repo_root = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        `
      )
      .all(repoRoot, limit) as Array<Record<string, unknown>>;
  }

  return db
    .query(
      `
      SELECT *
      FROM evaluations
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `
    )
    .all(limit) as Array<Record<string, unknown>>;
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
  const hits = rows
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
        skillId: row.skillId,
        versionId: row.versionId,
        slug: row.slug,
        title: row.title,
        scope: row.scope as "global" | "repo",
        repoRoot: row.repoRoot || null,
        status: row.status,
        origin: row.origin as SkillSearchResult["origin"],
        summary: row.summary,
        changeSummary: row.changeSummary,
        tags: parseJson<string[]>(row.tagsJson),
        score,
        reasons,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit);

  return hits;
}

export function databaseStatus(db: Database): Record<string, unknown> {
  const runCount = Number((db.query("SELECT COUNT(*) AS count FROM runs").get() as { count: number }).count);
  const skillCount = Number((db.query("SELECT COUNT(*) AS count FROM skills").get() as { count: number }).count);
  const versionCount = Number(
    (db.query("SELECT COUNT(*) AS count FROM skill_versions").get() as { count: number }).count
  );
  const evaluationCount = Number(
    (db.query("SELECT COUNT(*) AS count FROM evaluations").get() as { count: number }).count
  );

  return {
    dbPath: db.filename,
    runs: runCount,
    skills: skillCount,
    skillVersions: versionCount,
    evaluations: evaluationCount,
  };
}
