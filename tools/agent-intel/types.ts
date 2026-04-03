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
export type EvaluationDecision = "approve" | "reject";

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
  versionLabel: string | null;
  slug: string;
  title: string;
  scope: SkillScope;
  repoRoot: string | null;
  status: SkillStatus;
  origin: SkillOrigin;
  summary: string;
  contentMarkdown: string;
  changeSummary: string | null;
  tags: string[];
  score: number;
  reasons: string[];
}

export interface SkillListItem {
  skillId: string;
  versionId: string;
  versionLabel: string | null;
  slug: string;
  title: string;
  scope: SkillScope;
  repoRoot: string | null;
  status: SkillStatus;
  origin: SkillOrigin;
  summary: string;
  contentMarkdown: string;
  changeSummary: string | null;
  tags: string[];
}

export interface QueuedRunIngestResult {
  queuePath: string;
  ingested: number;
  skipped: number;
  errorCount: number;
  errors: Array<{ line: number; error: string }>;
}

export interface ProposedEvaluation {
  evaluationId: string;
  type: EvaluationType;
  repoRoot: string | null;
  proposedSlug: string | null;
  summary: string;
  evidenceCount: number | null;
  created: boolean;
}

export interface ReviewEvaluationResult {
  evaluationId: string;
  status: EvaluationStatus;
  decision: EvaluationDecision;
  skillId: string | null;
  versionId: string | null;
  skillStatus: SkillStatus | null;
}

export interface AgentIntelMetrics {
  repoRoot: string | null;
  runs: {
    total: number;
    success: number;
    failure: number;
    successRate: number;
    medianDurationMs: number | null;
    p90DurationMs: number | null;
    recurringSuccessPatterns: number;
    recurringFailurePatterns: number;
  };
  skills: {
    total: number;
    byStatus: Partial<Record<SkillStatus, number>>;
  };
  evaluations: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  usage: {
    total: number;
    selected: number;
    successful: number;
  };
  topFailureSignatures: Array<{
    failureSignature: string;
    count: number;
  }>;
}
