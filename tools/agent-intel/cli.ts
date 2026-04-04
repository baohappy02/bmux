#!/usr/bin/env bun

import { readFileSync } from "node:fs";

import {
  createEvaluation,
  databaseStatus,
  ingestQueuedRuns,
  insertRun,
  listSkills,
  listEvaluations,
  openDatabase,
  proposeEvaluations,
  recordSkillUsage,
  reviewEvaluation,
  seedDefaultSkills,
  setSkillStatus,
  searchSkills,
  upsertSkill,
} from "./db";
import type {
  EvaluationDecision,
  EvaluationInput,
  RunRecordInput,
  SkillInput,
  SkillStatus,
} from "./types";

function usage(): never {
  console.error(`bmux agent-intel

Usage:
  bun run tools/agent-intel/cli.ts status [--db PATH] [--queue PATH]
  bun run tools/agent-intel/cli.ts ingest-queue [--db PATH] [--queue PATH]
  bun run tools/agent-intel/cli.ts record-run [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts upsert-skill [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts seed-default-skills [--db PATH]
  bun run tools/agent-intel/cli.ts record-usage [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts create-evaluation [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts propose-evaluations [--db PATH] [--queue PATH] [--repo-root PATH] [--limit N] [--min-occurrences N]
  bun run tools/agent-intel/cli.ts list-evaluations [--db PATH] [--queue PATH] [--repo-root PATH] [--limit N]
  bun run tools/agent-intel/cli.ts review-evaluation --evaluation-id ID --decision approve|reject [--activate] [--note TEXT] [--db PATH]
  bun run tools/agent-intel/cli.ts list-skills [--db PATH] [--queue PATH] [--repo-root PATH] [--status STATUS] [--limit N]
  bun run tools/agent-intel/cli.ts set-skill-status --skill-id ID --status STATUS [--db PATH]
  bun run tools/agent-intel/cli.ts search-skills --query TEXT [--db PATH] [--queue PATH] [--repo-root PATH] [--limit N]

Input JSON commands read --input FILE or stdin.`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  command: string;
  flags: Map<string, string>;
} {
  const [command, ...rest] = argv;
  if (!command) {
    usage();
  }

  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index];
    if (!part.startsWith("--")) {
      usage();
    }
    const key = part.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, "true");
      continue;
    }
    flags.set(key, next);
    index += 1;
  }

  return { command, flags };
}

async function readJsonMaybeAsync<T>(flags: Map<string, string>): Promise<T> {
  const inputPath = flags.get("input");
  if (inputPath) {
    return JSON.parse(readFileSync(inputPath, "utf8")) as T;
  }
  const text = (await Bun.readableStreamToText(Bun.stdin.stream())).trim();
  if (!text) {
    throw new Error("Expected JSON from --input or stdin");
  }
  return JSON.parse(text) as T;
}

function numberFlag(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric flag: --${key}`);
  }
  return parsed;
}

function requiredFlag(flags: Map<string, string>, key: string): string {
  const value = flags.get(key)?.trim();
  if (!value) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(Bun.argv.slice(2));
  const db = openDatabase(flags.get("db"));
  const queuePath = flags.get("queue");

  function ingest(): ReturnType<typeof ingestQueuedRuns> {
    return ingestQueuedRuns(db, queuePath);
  }

  switch (command) {
    case "status": {
      const ingestResult = ingest();
      const defaults = seedDefaultSkills(db);
      console.log(
        JSON.stringify(
          {
            ok: true,
            ingest: ingestResult,
            defaults,
            status: databaseStatus(db, { queuePath }),
          },
          null,
          2
        )
      );
      return;
    }

    case "ingest-queue": {
      console.log(JSON.stringify({ ok: true, ...ingest() }, null, 2));
      return;
    }

    case "record-run": {
      const input = await readJsonMaybeAsync<RunRecordInput>(flags);
      const result = insertRun(db, input);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }

    case "upsert-skill": {
      const input = await readJsonMaybeAsync<SkillInput>(flags);
      const result = upsertSkill(db, input);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }

    case "record-usage": {
      const input = await readJsonMaybeAsync<{
        runId: string;
        skillId: string;
        versionId: string;
        retrievalRank?: number | null;
        retrievalScore?: number | null;
        selected?: boolean;
        outcome?: string | null;
      }>(flags);
      const usageId = recordSkillUsage(db, input);
      console.log(JSON.stringify({ ok: true, usageId }, null, 2));
      return;
    }

    case "seed-default-skills": {
      const ingestResult = ingest();
      const result = seedDefaultSkills(db);
      console.log(JSON.stringify({ ok: true, ingest: ingestResult, ...result }, null, 2));
      return;
    }

    case "create-evaluation": {
      const input = await readJsonMaybeAsync<EvaluationInput>(flags);
      const evaluationId = createEvaluation(db, input);
      console.log(JSON.stringify({ ok: true, evaluationId }, null, 2));
      return;
    }

    case "propose-evaluations": {
      const ingestResult = ingest();
      const repoRoot = flags.get("repo-root") || null;
      const limit = numberFlag(flags, "limit", 20);
      const minOccurrences = numberFlag(flags, "min-occurrences", 2);
      const proposals = proposeEvaluations(db, { repoRoot, limit, minOccurrences });
      console.log(
        JSON.stringify(
          { ok: true, ingest: ingestResult, count: proposals.length, proposals },
          null,
          2
        )
      );
      return;
    }

    case "list-evaluations": {
      const ingestResult = ingest();
      const repoRoot = flags.get("repo-root") || null;
      const limit = numberFlag(flags, "limit", 20);
      const evaluations = listEvaluations(db, { repoRoot, limit });
      console.log(
        JSON.stringify(
          { ok: true, ingest: ingestResult, count: evaluations.length, evaluations },
          null,
          2
        )
      );
      return;
    }

    case "review-evaluation": {
      const evaluationId = requiredFlag(flags, "evaluation-id");
      const decision = requiredFlag(flags, "decision") as EvaluationDecision;
      if (decision !== "approve" && decision !== "reject") {
        throw new Error("Invalid --decision, expected approve or reject");
      }
      const result = reviewEvaluation(db, {
        evaluationId,
        decision,
        note: flags.get("note") || null,
        activate: flags.get("activate") === "true",
      });
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }

    case "list-skills": {
      const ingestResult = ingest();
      const defaults = seedDefaultSkills(db);
      const repoRoot = flags.get("repo-root") || null;
      const status = (flags.get("status") || null) as SkillStatus | null;
      const limit = numberFlag(flags, "limit", 20);
      const skills = listSkills(db, { repoRoot, status, limit });
      console.log(
        JSON.stringify({ ok: true, ingest: ingestResult, defaults, count: skills.length, skills }, null, 2)
      );
      return;
    }

    case "set-skill-status": {
      const skillId = requiredFlag(flags, "skill-id");
      const status = requiredFlag(flags, "status") as SkillStatus;
      const result = setSkillStatus(db, { skillId, status });
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }

    case "search-skills": {
      const ingestResult = ingest();
      const defaults = seedDefaultSkills(db);
      const query = flags.get("query");
      if (!query) {
        throw new Error("Missing --query");
      }
      const repoRoot = flags.get("repo-root") || null;
      const limit = numberFlag(flags, "limit", 5);
      const hits = searchSkills(db, { query, repoRoot, limit });
      console.log(
        JSON.stringify({ ok: true, ingest: ingestResult, defaults, count: hits.length, hits }, null, 2)
      );
      return;
    }

    default:
      usage();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
