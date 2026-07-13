export type AgentId = 'claude' | 'codex';
export type StageName =
  | 'grill'
  | 'repro'
  | 'plan'
  | 'approval'
  | 'build'
  | 'review'
  | 'verify';
export type StageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'parked'
  | 'failed'
  | 'skipped';
export type TemplateName = 'feature' | 'bugfix' | 'refactor' | 'review';

export interface TokenUsage {
  input: number;
  output: number;
  cache_read?: number;
  cache_creation?: number;
}

export interface Finding {
  file: string;
  issue: string;
}

/**
 * One execution of a stage (agent process or native harness executor).
 * Append-only: a re-run pushes a new attempt, never overwrites — the 1617 run
 * under-reported $8.23 as $6.15 when re-run reviews clobbered their slot
 * (records-honesty fix, 2026-07-12).
 */
export interface StageAttempt {
  status: 'done' | 'parked' | 'failed';
  agent: AgentId | 'harness';
  model?: string | null;
  session_id?: string;
  /** True when this attempt resumed the builder session instead of starting fresh. */
  resumed?: boolean;
  tokens?: TokenUsage;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  started_at?: string;
  ended_at?: string;
  error?: string;
  park_reason?: string;
  /** Review attempts: what this attempt concluded (delta re-review briefs consume it). */
  review?: {
    verdict: 'approve' | 'must_fix';
    must_fix: Finding[];
    should_fix: Finding[];
    /** Global round number — pairs the attempt with review-N.md / review-N.diff. */
    round?: number;
  };
}

export interface StageState {
  name: StageName;
  status: StageStatus;
  /** 'fix' marks a build/review cycle inserted after a must-fix review. */
  variant?: 'fix';
  /** Every execution of this stage, oldest first. Top-level fields mirror the latest. */
  attempts?: StageAttempt[];
  agent?: AgentId;
  model?: string | null;
  tokens?: TokenUsage;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  artifacts: string[];
  park_reason?: string;
  /** Size of the file Kerry must edit before resume (e.g. questions.md at park time). */
  parked_file_bytes?: number;
  /** Content hash of that file at park time — resume requires it to change. */
  parked_file_hash?: string;
  error?: string;
  started_at?: string;
  ended_at?: string;
}

export interface Pipeline {
  /** 2 = attempts-array records (2026-07-12). Absent = v1; migrated on load. */
  schema_version?: number;
  /** Count of review attempts across the run — numbers review-N.md artifacts. */
  review_round?: number;
  run_id: string;
  template: TemplateName;
  repo: string;
  task: string;
  /** Kerry's grill answers, injected on resume; null until then. */
  answers: string | null;
  builder: AgentId;
  reviewer: AgentId;
  model: string | null;
  /** false = drive agents with permission prompts intact (--safe-perms). */
  skip_permissions: boolean;
  /** false = workers load user-level config again (--no-isolation). Default true. */
  isolated?: boolean;
  /** true = verify runs as an agent (--agent-verify). Default: harness-native. */
  agent_verify?: boolean;
  /** Run risk — high forces every review round to be a full review. */
  risk_level?: 'low' | 'medium' | 'high';
  /** true = re-reviews after fixes are full reviews too (--full-rereview). */
  full_rereview?: boolean;
  /** Hard per-stage spend cap in USD (--stage-budget-usd). */
  stage_budget_usd?: number | null;
  /**
   * The one continuous builder session (grill -> plan -> build -> fix resume
   * it across gates). Review/verify NEVER touch it — that firewall is the
   * quality gate. Null after a failed resume (fresh fallback).
   */
  builder_session_id?: string | null;
  current_stage: number;
  /** Populated by the plan stage; consumed by verify. */
  validation_commands: string[];
  /** Populated by build stages. */
  files_changed: string[];
  /** Auto fix-and-re-review cycles consumed (capped at 1). */
  fix_cycles: number;
  /** Rendered must-fix findings from the latest review, for a fix-variant build. */
  last_must_fix: string | null;
  stages: StageState[];
}

/** run.json shape — must stay byte-compatible with PRD section 3.11 / scripts/new_run.ps1. */
export interface RunRecord {
  run_id: string;
  created_at: string;
  completed_at: string | null;
  machine: 'windows' | 'wsl' | 'mac';
  repo: string;
  repo_name: string;
  branch: string;
  worktree: string | null;
  objective: string;
  user_prompt_summary: string;
  status_path: string;
  risk_level: 'low' | 'medium' | 'high';
  agent: {
    agent_id: string;
    agent_role: string;
    surface: string;
    model: string | null;
    adapter_version: string;
  };
  status: 'in_progress' | 'shipped' | 'complete' | 'blocked' | 'abandoned';
  validation_plan: string[];
  files_changed: string[];
  linked_failures: string[];
  evidence_links: string[];
  reviewer_result: string | null;
  final_outcome: string | null;
}
