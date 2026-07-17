import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { TokenUsage } from '../types.js';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from './types.js';
import { extractStageJson } from './parse.js';
import { DEFAULT_TIMEOUT_MS, failure, runProcess } from './proc.js';

/**
 * Shape of the `codex exec --json` JSONL events (fields we use). Captured
 * live on codex-cli 0.144.1 — conformance spike in run 2026-07-11_0636:
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{"input_tokens":n,"cached_input_tokens":n,"output_tokens":n,...}}
 * and on failure:
 *   {"type":"error","message":"..."}
 *   {"type":"turn.failed","error":{"message":"..."}}
 */
interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: { type?: string; text?: string; message?: string };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message?: string };
  message?: string;
}

export interface CodexParse {
  /** Text of the LAST agent_message — the final reply carries the stage JSON. */
  resultText?: string;
  /** thread_id from thread.started — the id `codex exec resume` takes back. */
  sessionId?: string;
  turns: number;
  tokens: TokenUsage;
  /** error events + turn.failed messages + error items, deduped, in order. */
  errors: string[];
  /** Count of parseable JSONL events — 0 means stdout wasn't the event stream. */
  events: number;
}

/** Pure JSONL-event fold; unit-tested against fixtures captured from the live spike. */
export function parseCodexEvents(stdout: string): CodexParse {
  const parsed: CodexParse = {
    turns: 0,
    tokens: { input: 0, output: 0, cache_read: 0 },
    errors: [],
    events: 0,
  };
  const pushError = (msg: string | undefined) => {
    if (msg && !parsed.errors.includes(msg)) parsed.errors.push(msg);
  };
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: CodexEvent;
    try {
      ev = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue; // codex may interleave non-event noise; the events counter guards against ALL-noise
    }
    if (typeof ev !== 'object' || ev === null) continue;
    parsed.events++;
    switch (ev.type) {
      case 'thread.started':
        // first thread_id wins — the session id stays stable across a drive
        if (parsed.sessionId === undefined && typeof ev.thread_id === 'string') {
          parsed.sessionId = ev.thread_id;
        }
        break;
      case 'item.completed':
        if (ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') {
          parsed.resultText = ev.item.text; // last one wins, matching extractStageJson
        } else if (ev.item?.type === 'error') {
          pushError(ev.item.message);
        }
        break;
      case 'turn.completed': {
        parsed.turns++;
        const u = ev.usage ?? {};
        parsed.tokens.input += u.input_tokens ?? 0;
        parsed.tokens.output += u.output_tokens ?? 0;
        parsed.tokens.cache_read = (parsed.tokens.cache_read ?? 0) + (u.cached_input_tokens ?? 0);
        break;
      }
      case 'turn.failed':
        pushError(ev.error?.message);
        break;
      case 'error':
        pushError(ev.message);
        break;
    }
  }
  return parsed;
}

export function buildExecArgs(opts: DriveOpts = {}, resumeSessionId?: string): string[] {
  // `codex exec resume <id>` replays a prior session and shares --json /
  // --skip-git-repo-check / the bypass flag / stdin marker with plain `exec` —
  // but it has NO `--sandbox` option (codex-cli 0.144.1 exits 2 with "unexpected
  // argument '--sandbox'"). So the explicit read-only sandbox is fresh-path only;
  // run() never requests a resume under safe-perms (it falls back to a fresh
  // read-only context instead), keeping this branch unreachable in practice.
  const args = resumeSessionId
    ? ['exec', 'resume', resumeSessionId, '--json', '--skip-git-repo-check']
    : ['exec', '--json', '--skip-git-repo-check'];
  if (opts.model) args.push('--model', opts.model);
  // skipPermissions=false has no interactive analogue in `codex exec` (it is
  // non-interactive); the honest mapping is an EXPLICIT read-only sandbox —
  // relying on codex's default would let ~/.codex/config.toml (which Codex
  // Desktop rewrites) silently weaken the guardrail (review finding, 2026-07-11).
  if (opts.skipPermissions !== false) args.push('--dangerously-bypass-approvals-and-sandbox');
  else if (!resumeSessionId) args.push('--sandbox', 'read-only');
  // NOTE: DriveOpts.maxTurns has no `codex exec` equivalent; the stage timeout
  // remains the backstop for a runaway stage.
  args.push('-'); // prompt arrives on stdin — never through argv (Windows quoting)
  return args;
}

/**
 * npm installs codex as a .cmd shim, which Node refuses to spawn without a
 * shell (CVE-2024-27980 guard) — and a shell reopens argv-quoting risk. So on
 * Windows we run the package's stable JS entry through this same node binary.
 */
function resolveCodexJs(): string | undefined {
  const dirs = (process.env['PATH'] ?? '').split(delimiter);
  // npm's default global prefix, even when PATH misses it or quotes it away
  const appData = process.env['APPDATA'];
  if (appData) dirs.push(join(appData, 'npm'));
  for (const dir of dirs) {
    // Windows PATH entries may legally be quoted — CreateProcess dequotes
    // during search, join() does not (review finding, 2026-07-11)
    const clean = dir.replace(/^"|"$/g, '');
    if (!clean) continue;
    const js = join(clean, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (existsSync(js)) return js;
  }
  return undefined;
}

function codexCommand(): { bin: string; prefix: string[] } {
  const override = process.env['HARNESS_CODEX_BIN'];
  if (override) {
    // a .js override (a test stub, or bin/codex.js itself) runs through this
    // same node — .js files are not directly spawnable
    if (/\.[mc]?js$/i.test(override)) return { bin: process.execPath, prefix: [override] };
    return { bin: override, prefix: [] };
  }
  if (process.platform === 'win32') {
    const js = resolveCodexJs();
    if (js) return { bin: process.execPath, prefix: [js] };
  }
  return { bin: 'codex', prefix: [] };
}

export class CodexDriver implements AgentDriver {
  readonly id = 'codex' as const;
  // The engine's resume gate reads this synchronously; whether THIS installed
  // CLI can actually resume is probed per-run (cliCanResume) and, when it can't,
  // reported honestly via StageResult.resume_unsupported.
  readonly supportsResume = true;

  /** Memoized `codex exec --help` capability probe; undefined until first check. */
  private resumeCapable?: boolean;

  /**
   * True when the installed `codex exec` exposes a `resume` subcommand. Probed
   * via `codex exec --help` (through codexCommand(), so HARNESS_CODEX_BIN stubs
   * and the Windows .js/.cmd resolution apply). Memoized: builder-lineage drives
   * the same CLI every stage, so one probe per driver suffices.
   */
  private async cliCanResume(): Promise<boolean> {
    if (this.resumeCapable !== undefined) return this.resumeCapable;
    const { bin, prefix } = codexCommand();
    const out = await runProcess(bin, [...prefix, 'exec', '--help'], process.cwd(), '', 30_000);
    // Match the subcommand line ("  resume  Resume a previous session..."), not a
    // stray "resume" elsewhere in the help text.
    this.resumeCapable = out.code === 0 && /^\s*resume\b/im.test(out.stdout);
    return this.resumeCapable;
  }

  async available(): Promise<boolean> {
    // `login status` proves CLI present AND auth OK (orchestration.md's bar);
    // it exits nonzero when logged out, so a dead auth degrades honestly.
    const { bin, prefix } = codexCommand();
    const out = await runProcess(bin, [...prefix, 'login', 'status'], process.cwd(), '', 30_000);
    return out.code === 0;
  }

  async run(brief: StageBrief, opts: DriveOpts = {}): Promise<StageResult> {
    const { bin, prefix } = codexCommand();
    // Resume only when asked AND the installed CLI supports it; otherwise drive a
    // fresh context and flag it so the engine can log the fallback explicitly
    // instead of silently discarding the requested session.
    let resumeId: string | undefined;
    let resumeUnsupported = false;
    if (opts.resumeSession) {
      // Resume is viable only when the CLI has the subcommand AND we run full-auto:
      // `codex exec resume` has no --sandbox flag, so a safe-perms (read-only) drive
      // cannot resume without silently dropping the guardrail — fall back to a fresh
      // read-only context and record it, rather than emit args codex rejects.
      const safePerms = opts.skipPermissions === false;
      if (!safePerms && (await this.cliCanResume())) resumeId = opts.resumeSession;
      else resumeUnsupported = true;
    }
    const args = [...prefix, ...buildExecArgs(opts, resumeId)];
    const started = Date.now();
    const out = await runProcess(bin, args, brief.cwd, brief.prompt, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const durationMs = Date.now() - started; // codex emits no duration; wall clock is honest

    const raw = out.stdout + '\n' + out.stderr;
    const events = parseCodexEvents(out.stdout);
    // Even failed stages report what the agent actually consumed — and the
    // fresh-context fallback is recorded on every return path, not just success.
    const withUsage = (r: StageResult): StageResult => {
      r.tokens = events.tokens;
      r.duration_ms = durationMs;
      r.num_turns = events.turns;
      if (resumeUnsupported) r.resume_unsupported = true;
      return r;
    };
    const detail = events.errors.length ? `: ${events.errors.join('; ')}` : '';

    if (out.spawnError) return failure(`spawn failed: ${out.spawnError}`, out.stderr);
    if (out.timedOut) return withUsage(failure('stage timed out', raw));
    if (out.code !== 0) return withUsage(failure(`codex exited ${out.code}${detail}`, raw));
    if (events.events === 0) return withUsage(failure('no JSONL events from codex', raw));
    if (events.errors.length && events.resultText === undefined) {
      // exit 0 shouldn't coincide with a failed turn, but trust the events over the exit code
      return withUsage(failure(`codex reported error${detail}`, raw));
    }
    if (events.resultText === undefined) {
      return withUsage(failure('codex produced no agent message', raw));
    }

    const result: StageResult = withUsage({
      ok: true,
      resultText: events.resultText,
      tokens: events.tokens,
      cost_usd: 0, // codex exec reports no cost; 0 is honest-unknown, tokens carry the accounting
      duration_ms: durationMs,
      num_turns: events.turns,
    });
    if (events.sessionId) result.session_id = events.sessionId; // chains the builder session forward
    const parsed = extractStageJson(events.resultText);
    if (parsed !== undefined) result.parsed = parsed;
    return result;
  }
}
