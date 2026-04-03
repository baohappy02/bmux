#!/usr/bin/env bun

import { readFileSync } from "node:fs";

import {
  createEvaluation,
  databaseStatus,
  insertRun,
  listEvaluations,
  openDatabase,
  recordSkillUsage,
  searchSkills,
  upsertSkill,
} from "./db";
import type { EvaluationInput, RunRecordInput, SkillInput } from "./types";

function usage(): never {
  console.error(`bmux agent-intel

Usage:
  bun run tools/agent-intel/cli.ts status [--db PATH]
  bun run tools/agent-intel/cli.ts record-run [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts upsert-skill [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts record-usage [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts create-evaluation [--db PATH] [--input FILE]
  bun run tools/agent-intel/cli.ts list-evaluations [--db PATH] [--repo-root PATH] [--limit N]
  bun run tools/agent-intel/cli.ts search-skills --query TEXT [--db PATH] [--repo-root PATH] [--limit N]

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

async function main(): Promise<void> {
  const { command, flags } = parseArgs(Bun.argv.slice(2));
  const db = openDatabase(flags.get("db"));

  switch (command) {
    case "status": {
      console.log(JSON.stringify(databaseStatus(db), null, 2));
      return;
    }

    case "record-run": {
      const input = await readJsonMaybeAsync<RunRecordInput>(flags);
      const runId = insertRun(db, input);
      console.log(JSON.stringify({ ok: true, runId }, null, 2));
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

    case "create-evaluation": {
      const input = await readJsonMaybeAsync<EvaluationInput>(flags);
      const evaluationId = createEvaluation(db, input);
      console.log(JSON.stringify({ ok: true, evaluationId }, null, 2));
      return;
    }

    case "list-evaluations": {
      const repoRoot = flags.get("repo-root") || null;
      const limit = numberFlag(flags, "limit", 20);
      const evaluations = listEvaluations(db, { repoRoot, limit });
      console.log(JSON.stringify({ ok: true, count: evaluations.length, evaluations }, null, 2));
      return;
    }

    case "search-skills": {
      const query = flags.get("query");
      if (!query) {
        throw new Error("Missing --query");
      }
      const repoRoot = flags.get("repo-root") || null;
      const limit = numberFlag(flags, "limit", 5);
      const hits = searchSkills(db, { query, repoRoot, limit });
      console.log(JSON.stringify({ ok: true, count: hits.length, hits }, null, 2));
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
