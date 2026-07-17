import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExecArgs, CodexDriver, parseCodexEvents } from '../src/adapters/codex.js';

// Fixtures captured VERBATIM from the live conformance spike on this machine
// (codex-cli 0.144.1, 2026-07-11, run 2026-07-11_0636).
const HAPPY = [
  '{"type":"thread.started","thread_id":"019f50c1-9ad7-7d90-8e52-9a06c29d2608"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"CONFORMANCE-OK"}}',
  '{"type":"turn.completed","usage":{"input_tokens":13868,"cached_input_tokens":9984,"output_tokens":8,"reasoning_output_tokens":0}}',
].join('\n');

// NB: real codex failure messages are stringified JSON envelopes — keep them
// that way here so tests see the exact shape production sees.
const FAILED = [
  '{"type":"thread.started","thread_id":"019f50c1-f162-74b2-b401-a1a494a6f186"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `bogus-model-xyz` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'bogus-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
  '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'bogus-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}',
].join('\n');

describe('parseCodexEvents', () => {
  it('extracts the agent message, usage, and turn count from the live happy fixture', () => {
    const p = parseCodexEvents(HAPPY);
    expect(p.resultText).toBe('CONFORMANCE-OK');
    expect(p.turns).toBe(1);
    expect(p.tokens).toEqual({ input: 13868, output: 8, cache_read: 9984 });
    expect(p.errors).toEqual([]);
    expect(p.events).toBe(4);
  });

  it('collects deduped errors from the live failure fixture, no agent message', () => {
    const p = parseCodexEvents(FAILED);
    expect(p.resultText).toBeUndefined();
    expect(p.turns).toBe(0);
    // error event and turn.failed carry the same message — recorded once;
    // the warning-level error item is kept too.
    expect(p.errors).toHaveLength(2);
    expect(p.errors[1]).toContain('bogus-model-xyz');
  });

  it('last agent_message wins (final reply carries the stage JSON)', () => {
    const two = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"thinking out loud"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"verdict\\":\\"approve\\"}"}}',
    ].join('\n');
    expect(parseCodexEvents(two).resultText).toBe('{"verdict":"approve"}');
  });

  it('sums usage across turns', () => {
    const multi = [
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10}}',
      '{"type":"turn.completed","usage":{"input_tokens":200,"cached_input_tokens":150,"output_tokens":30}}',
    ].join('\n');
    const p = parseCodexEvents(multi);
    expect(p.turns).toBe(2);
    expect(p.tokens).toEqual({ input: 300, output: 40, cache_read: 190 });
  });

  it('skips non-JSON noise and CRLF/blank lines without losing events', () => {
    const noisy = 'warning: something\r\n\r\n' + HAPPY.replace(/\n/g, '\r\n') + '\r\nnot json either';
    const p = parseCodexEvents(noisy);
    expect(p.resultText).toBe('CONFORMANCE-OK');
    expect(p.events).toBe(4);
  });

  it('reports zero events for entirely non-JSONL stdout', () => {
    const p = parseCodexEvents('codex: something went wrong before the event stream\n');
    expect(p.events).toBe(0);
    expect(p.resultText).toBeUndefined();
  });

  it('captures the thread_id from thread.started as the session id', () => {
    const p = parseCodexEvents(HAPPY);
    expect(p.sessionId).toBe('019f50c1-9ad7-7d90-8e52-9a06c29d2608');
  });
});

describe('buildExecArgs', () => {
  it('defaults: JSONL events, repo-check skipped, full bypass, prompt on stdin', () => {
    expect(buildExecArgs()).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ]);
  });

  it('passes the model through and keeps stdin marker last', () => {
    const args = buildExecArgs({ model: 'gpt-5-codex' });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5-codex');
    expect(args[args.length - 1]).toBe('-');
  });

  it('safe-perms pins an explicit read-only sandbox instead of the bypass', () => {
    const args = buildExecArgs({ skipPermissions: false });
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
  });

  it('resume id turns the invocation into `exec resume <id>` with stdin last', () => {
    const args = buildExecArgs({}, 'sess-123');
    expect(args.slice(0, 5)).toEqual([
      'exec',
      'resume',
      'sess-123',
      '--json',
      '--skip-git-repo-check',
    ]);
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args[args.length - 1]).toBe('-');
  });

  it('resume never emits --sandbox even under safe-perms (codex resume rejects it)', () => {
    // `codex exec resume` has no --sandbox flag; emitting it exits 2. The read-only
    // guardrail is fresh-path only — run() falls back rather than build this.
    const args = buildExecArgs({ skipPermissions: false }, 'sess-123');
    expect(args).not.toContain('--sandbox');
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', 'sess-123']);
  });
});

// ---------------------------------------------------------------------------
// Driver-level branch mapping, driven through a real spawned stub via the
// HARNESS_CODEX_BIN override (.js values run through this same node). Pins the
// never-throw contract, raw-tail preservation, and usage-on-failure honesty.
// ---------------------------------------------------------------------------

const STUB = `
const mode = process.env['CODEX_STUB_MODE'] ?? 'happy';
if (process.argv.includes('login')) process.exit(mode === 'logged-out' ? 1 : 0);
if (process.argv.includes('--help')) {
  // emulate 'codex exec --help'; the resume subcommand line is present unless disabled
  console.log('Usage: codex exec [OPTIONS] [PROMPT]');
  console.log('Commands:');
  if (process.env['CODEX_STUB_RESUME'] !== 'no') console.log('  resume  Resume a previous session by id');
  console.log('  help    Print this message');
  process.exit(0);
}
const resumeIdx = process.argv.indexOf('resume');
const resumedId = resumeIdx >= 0 ? process.argv[resumeIdx + 1] : null;
// mirror codex-cli 0.144.1: 'exec resume' has no --sandbox flag and clap exits 2
if (resumeIdx >= 0 && process.argv.includes('--sandbox')) {
  console.error("error: unexpected argument '--sandbox' found");
  process.exit(2);
}
let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  if (mode === 'happy') {
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 't1' }));
    console.log(JSON.stringify({ type: 'turn.started' }));
    const text = resumedId ? JSON.stringify({ resumed: resumedId }) : '{"echo":' + JSON.stringify(stdin.length) + '}';
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 11, cached_input_tokens: 5, output_tokens: 7 } }));
  } else if (mode === 'noise') {
    console.log('plain banner, no events');
  } else if (mode === 'fail') {
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 21, output_tokens: 3 } }));
    console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'boom from stub' } }));
    process.exitCode = 1;
  } else if (mode === 'no-message') {
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 9, output_tokens: 1 } }));
  }
});
`;

describe('CodexDriver via HARNESS_CODEX_BIN stub', () => {
  let dir: string;
  let stubPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codex-stub-'));
    stubPath = join(dir, 'codex-stub.js');
    writeFileSync(stubPath, STUB, 'utf8');
    process.env['HARNESS_CODEX_BIN'] = stubPath;
  });
  afterEach(() => {
    delete process.env['HARNESS_CODEX_BIN'];
    delete process.env['CODEX_STUB_MODE'];
    delete process.env['CODEX_STUB_RESUME'];
    rmSync(dir, { recursive: true, force: true });
  });

  const brief = { stage: 'verify' as const, prompt: 'do the thing', cwd: process.cwd() };

  it('happy: ok:true with parsed JSON, summed usage, measured duration', async () => {
    const res = await new CodexDriver().run(brief, { timeoutMs: 30_000 });
    expect(res.ok).toBe(true);
    expect(res.parsed).toEqual({ echo: brief.prompt.length });
    expect(res.tokens).toEqual({ input: 11, output: 7, cache_read: 5 });
    expect(res.num_turns).toBe(1);
    expect(res.duration_ms).toBeGreaterThan(0);
  });

  it('resume-with-session: CLI supports resume → drives `exec resume <id>`, emits session_id', async () => {
    const res = await new CodexDriver().run(brief, { timeoutMs: 30_000, resumeSession: 'sess-123' });
    expect(res.ok).toBe(true);
    expect(res.session_id).toBe('t1'); // thread_id from thread.started
    expect(res.resume_unsupported).toBeFalsy();
    // the stub echoes back the id it was resumed with, proving the resume path ran
    expect(res.parsed).toEqual({ resumed: 'sess-123' });
  });

  it('safe-perms resume: CLI cannot resume under read-only sandbox → fresh fallback, not a --sandbox crash', async () => {
    // The stub rejects `resume` + `--sandbox` (like real codex). run() must NOT
    // build that combination: it falls back to a fresh read-only context instead.
    const res = await new CodexDriver().run(brief, {
      timeoutMs: 30_000,
      resumeSession: 'sess-123',
      skipPermissions: false,
    });
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined(); // NOT "codex exited 2: unexpected argument '--sandbox'"
    expect(res.resume_unsupported).toBe(true);
    expect(res.session_id).toBe('t1');
    expect(res.parsed).toEqual({ echo: brief.prompt.length }); // fresh drive, not the resumed-id shape
  });

  it('explicit-fallback: CLI lacks resume → fresh context, resume_unsupported flag set, session_id still emitted', async () => {
    process.env['CODEX_STUB_RESUME'] = 'no';
    const res = await new CodexDriver().run(brief, { timeoutMs: 30_000, resumeSession: 'sess-123' });
    expect(res.ok).toBe(true);
    expect(res.resume_unsupported).toBe(true);
    expect(res.session_id).toBe('t1');
    // fresh drive: prompt echoed, NOT the resumed-id shape
    expect(res.parsed).toEqual({ echo: brief.prompt.length });
  });

  it('exit 0 + non-JSONL stdout: ok:false, raw tail kept, duration still real', async () => {
    process.env['CODEX_STUB_MODE'] = 'noise';
    const res = await new CodexDriver().run(brief, { timeoutMs: 30_000 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no JSONL events');
    expect(res.raw).toContain('plain banner');
    expect(res.duration_ms).toBeGreaterThan(0);
  });

  it('nonzero exit: ok:false with the event error surfaced AND usage reported', async () => {
    process.env['CODEX_STUB_MODE'] = 'fail';
    const res = await new CodexDriver().run(brief, { timeoutMs: 30_000 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom from stub');
    expect(res.tokens.input).toBe(21); // failed stages still report consumption
    expect(res.num_turns).toBe(1);
  });

  it('exit 0 without an agent message: ok:false, usage reported', async () => {
    process.env['CODEX_STUB_MODE'] = 'no-message';
    const res = await new CodexDriver().run(brief, { timeoutMs: 30_000 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no agent message');
    expect(res.tokens.input).toBe(9);
  });

  it('available() follows login status exit code', async () => {
    expect(await new CodexDriver().available()).toBe(true);
    process.env['CODEX_STUB_MODE'] = 'logged-out';
    expect(await new CodexDriver().available()).toBe(false);
  });

  it('missing binary: resolves honestly (available false, run ok:false), never throws', async () => {
    process.env['HARNESS_CODEX_BIN'] = join(dir, 'nope', 'codex.exe');
    const d = new CodexDriver();
    expect(await d.available()).toBe(false);
    const res = await d.run(brief, { timeoutMs: 5_000 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('spawn failed');
  });

  it.runIf(process.platform === 'win32')(
    '.cmd override: sync spawn EINVAL resolves as spawnError instead of rejecting (CASE-0016)',
    async () => {
      const cmdPath = join(dir, 'codex.cmd');
      writeFileSync(cmdPath, '@echo off\r\nexit /b 0\r\n', 'utf8');
      process.env['HARNESS_CODEX_BIN'] = cmdPath;
      const d = new CodexDriver();
      expect(await d.available()).toBe(false); // resolves — must not reject
      const res = await d.run(brief, { timeoutMs: 5_000 });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('EINVAL');
    },
  );
});
