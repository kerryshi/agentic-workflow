import type { AgentId, StageName, TokenUsage } from '../types.js';

export interface StageBrief {
  stage: StageName;
  /** The complete, self-contained prompt for this stage — lean by construction. */
  prompt: string;
  /** Working directory for the agent process: the target repo. */
  cwd: string;
}

export interface DriveOpts {
  model?: string | null;
  timeoutMs?: number;
  maxTurns?: number;
  /**
   * Defaults to true: matches Kerry's standing full-auto permission decision
   * (HANDOFF "Decisions locked"). The approval boundary is enforced by the
   * pipeline's park gates and docs/permission-policy.md, restated in every brief.
   */
  skipPermissions?: boolean;
  /**
   * Resume this agent session instead of starting a fresh context. Builder
   * lineage only — the engine never passes it for review/verify stages.
   */
  resumeSession?: string;
  /**
   * Default true: workers load no user-level config (claude:
   * --setting-sources ""). Repo conventions are injected via the brief.
   */
  isolated?: boolean;
  /** Hard per-stage spend cap in USD (claude --max-budget-usd). */
  budgetUsd?: number;
}

export interface StageResult {
  ok: boolean;
  /** The agent's final message text. */
  resultText: string;
  /** Stage-contract JSON extracted from resultText, when present. */
  parsed?: unknown;
  tokens: TokenUsage;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  /** Agent session identifier, when the CLI reports one (claude does). */
  session_id?: string;
  /**
   * Set by the codex adapter when opts.resumeSession was requested but could not
   * be honored — the installed CLI lacks a `resume` subcommand, or resume is
   * incompatible with the requested read-only sandbox (`codex exec resume` has
   * no `--sandbox`). The drive ran a fresh context instead; the engine logs this
   * to the run-event stream so the fallback is explicit, not silent.
   */
  resume_unsupported?: boolean;
  /** Raw stdout/stderr tail, preserved on failure for the run folder. */
  raw?: string;
  error?: string;
}

export interface AgentDriver {
  id: AgentId;
  /** True when the CLI can resume a prior session headless (claude -p --resume). */
  supportsResume?: boolean;
  /** CLI present and usable. Engines fall back per the reviewer rule when false. */
  available(): Promise<boolean>;
  /** Run ONE stage headless. Must never throw — failures come back as ok:false. */
  run(brief: StageBrief, opts?: DriveOpts): Promise<StageResult>;
}
