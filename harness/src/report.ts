import type { Pipeline, StageAttempt, StageState } from './types.js';

/** Mirror fields as a synthetic attempt, for pre-attempts (v1) pipelines. */
function legacyAttempt(s: StageState): StageAttempt | undefined {
  if (s.agent === undefined && s.tokens === undefined && s.cost_usd === undefined) return undefined;
  return {
    status: s.status === 'failed' ? 'failed' : s.status === 'parked' ? 'parked' : 'done',
    agent: s.agent ?? 'claude',
    model: s.model ?? null,
    tokens: s.tokens ?? { input: 0, output: 0 },
    cost_usd: s.cost_usd ?? 0,
    duration_ms: s.duration_ms ?? 0,
    num_turns: s.num_turns ?? 0,
  };
}

/**
 * Per-attempt token/cost/duration table — the "saves tokens" claim gets
 * measured here. Every attempt is a row; totals sum across ALL attempts
 * (a re-run review used to silently replace its row: 1617 reported $6.15
 * for an $8.23 run).
 */
export function renderReport(pipeline: Pipeline): string {
  const lines = [
    `# Harness report — ${pipeline.run_id}`,
    '',
    `template: ${pipeline.template} · builder: ${pipeline.builder} · reviewer: ${pipeline.reviewer}`,
    '',
    '| stage | status | agent | in tok | out tok | cache rd | cost USD | minutes | turns |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  let inSum = 0;
  let outSum = 0;
  let cacheSum = 0;
  let costSum = 0;
  let msSum = 0;
  for (const s of pipeline.stages) {
    const base = s.variant ? `${s.name} (${s.variant})` : s.name;
    const fallback = legacyAttempt(s);
    const attempts = s.attempts?.length ? s.attempts : fallback ? [fallback] : [];
    if (!attempts.length) {
      // never-executed stage (approval gate, skipped, pending) — one zero row
      lines.push(`| ${base} | ${s.status} | - | 0 | 0 | 0 | 0.0000 | 0.0 | 0 |`);
      continue;
    }
    for (const [i, a] of attempts.entries()) {
      const t = a.tokens ?? { input: 0, output: 0 };
      inSum += t.input;
      outSum += t.output;
      cacheSum += t.cache_read ?? 0;
      costSum += a.cost_usd ?? 0;
      msSum += a.duration_ms ?? 0;
      const name = attempts.length > 1 ? `${base} #${i + 1}` : base;
      const resumed = a.resumed ? '↻' : '';
      lines.push(
        `| ${name} | ${a.status} | ${a.agent}${resumed} | ${t.input} | ${t.output} | ` +
          `${t.cache_read ?? 0} | ${(a.cost_usd ?? 0).toFixed(4)} | ` +
          `${((a.duration_ms ?? 0) / 60000).toFixed(1)} | ${a.num_turns ?? 0} |`,
      );
    }
  }
  lines.push(
    `| **total** | | | **${inSum}** | **${outSum}** | **${cacheSum}** | **${costSum.toFixed(4)}** | ` +
      `**${(msSum / 60000).toFixed(1)}** | |`,
    '',
    '(agent↻ = resumed the builder session rather than starting a fresh context)',
    '',
  );
  return lines.join('\n');
}
