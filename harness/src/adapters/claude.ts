import type { AgentDriver, DriveOpts, StageBrief, StageResult } from './types.js';
import { extractStageJson } from './parse.js';
import { DEFAULT_TIMEOUT_MS, failure, runProcess, tail } from './proc.js';

/** Shape of the `claude -p --output-format json` result envelope (fields we use). */
interface ClaudeEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function claudeBin(): string {
  return process.env['HARNESS_CLAUDE_BIN'] ?? (process.platform === 'win32' ? 'claude.exe' : 'claude');
}

/** Pure arg assembly, exported for tests (mirrors codex's buildExecArgs). */
export function buildClaudeArgs(opts: DriveOpts = {}): string[] {
  const args = ['-p', '--output-format', 'json'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
  if (opts.skipPermissions !== false) args.push('--dangerously-skip-permissions');
  // Workers are isolated by default: no user CLAUDE.md / hooks / skills —
  // interactive-mode instructions fight stage briefs and tax every turn.
  // NOT --bare: that breaks subscription auth headless (probe, 2026-07-12).
  // Repo conventions come back in via the brief (engine injects AGENTS.md).
  if (opts.isolated !== false) args.push('--setting-sources', '');
  if (opts.budgetUsd !== undefined && opts.budgetUsd > 0) {
    args.push('--max-budget-usd', String(opts.budgetUsd));
  }
  // Session lookup is scoped to the cwd's project — safe here because every
  // stage of a run drives the same repo (probe, 2026-07-12).
  if (opts.resumeSession) args.push('--resume', opts.resumeSession);
  return args;
}

export class ClaudeDriver implements AgentDriver {
  readonly id = 'claude' as const;
  readonly supportsResume = true;

  async available(): Promise<boolean> {
    const out = await runProcess(claudeBin(), ['--version'], process.cwd(), '', 30_000);
    return out.code === 0;
  }

  async run(brief: StageBrief, opts: DriveOpts = {}): Promise<StageResult> {
    const args = buildClaudeArgs(opts);

    const out = await runProcess(
      claudeBin(),
      args,
      brief.cwd,
      brief.prompt,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (out.spawnError) return failure(`spawn failed: ${out.spawnError}`, out.stderr);
    if (out.timedOut) return failure('stage timed out', out.stdout + '\n' + out.stderr);
    if (out.code !== 0) {
      // claude -p often emits its JSON error envelope even on non-zero exit —
      // surface its subtype/result instead of discarding it.
      let detail = '';
      try {
        const env = JSON.parse(out.stdout) as ClaudeEnvelope;
        detail = `: ${env.subtype ?? ''} ${env.result ?? ''}`.trimEnd();
      } catch {
        /* no envelope — raw tail is preserved by failure() */
      }
      return failure(`claude exited ${out.code}${detail}`, out.stdout + '\n' + out.stderr);
    }

    let envelope: ClaudeEnvelope;
    try {
      envelope = JSON.parse(out.stdout) as ClaudeEnvelope;
    } catch {
      return failure('non-JSON stdout from claude', out.stdout + '\n' + out.stderr);
    }

    const resultText = envelope.result ?? '';
    const usage = envelope.usage ?? {};
    const result: StageResult = {
      ok: envelope.is_error !== true,
      resultText,
      tokens: {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cache_read: usage.cache_read_input_tokens ?? 0,
        cache_creation: usage.cache_creation_input_tokens ?? 0,
      },
      cost_usd: envelope.total_cost_usd ?? 0,
      duration_ms: envelope.duration_ms ?? 0,
      num_turns: envelope.num_turns ?? 0,
    };
    if (envelope.session_id) result.session_id = envelope.session_id;
    if (envelope.is_error === true) {
      result.error = `claude reported error (subtype: ${envelope.subtype ?? 'unknown'})`;
      result.raw = tail(out.stdout);
    }
    const parsed = extractStageJson(resultText);
    if (parsed !== undefined) result.parsed = parsed;
    return result;
  }
}
