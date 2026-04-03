export type SkillScope = "global" | "repo";
export type SkillStatus =
  | "candidate"
  | "canary"
  | "active"
  | "quarantined"
  | "disabled";
export type SkillOrigin = "manual" | "captured" | "fixed" | "derived";
export type EvaluationType = "capture" | "fix" | "derived";
export type EvaluationStatus = "pending" | "approved" | "rejected";

export interface RunRecordInput {
  id?: string;
  repoRoot?: string | null;
  workspaceFingerprint?: string | null;
  taskText?: string | null;
  executionClass?: string | null;
  success: boolean;
  durationMs?: number | null;
  failureSignature?: string | null;
  mcpCallCount?: number | null;
  payloadBytesIn?: number | null;
  payloadBytesOut?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface SkillInput {
  id?: string;
  slug: string;
  scope: SkillScope;
  repoRoot?: string | null;
  status: SkillStatus;
  origin: SkillOrigin;
  title: string;
  summary: string;
  contentMarkdown: string;
  changeSummary?: string | null;
  versionLabel?: string | null;
  tags?: string[];
}

export interface EvaluationInput {
  type: EvaluationType;
  repoRoot?: string | null;
  targetSkillId?: string | null;
  proposedSlug?: string | null;
  status?: EvaluationStatus;
  evidenceCount?: number | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

export interface SkillSearchResult {
  skillId: string;
  versionId: string;
  slug: string;
  title: string;
  scope: SkillScope;
  repoRoot: string | null;
  status: SkillStatus;
  origin: SkillOrigin;
  summary: string;
  changeSummary: string | null;
  tags: string[];
  score: number;
  reasons: string[];
}
