import { describe, expect, it } from 'vitest';
import { buildBrief } from '../src/brief.js';
import { STAGE_MAX_TURNS } from '../src/templates.js';

const CTX = { task: 'Add a median helper', answers: null };

// CASE-0021: grill burned its entire turn cap reading a large repo instead of
// asking questions (error_max_turns, zero questions produced).
describe('grill brief (CASE-0021)', () => {
  it('directs the agent to ask instead of exploring the repo', () => {
    const brief = buildBrief('grill', CTX);
    expect(brief).toContain(`ASK, DON'T EXPLORE`);
    expect(brief).not.toContain('Skim the repository');
  });

  it('keeps the grill turn cap small — questions, not expeditions', () => {
    expect(STAGE_MAX_TURNS.grill).toBeLessThanOrEqual(6);
  });
});

// CASE-0022: plan authored .venv\Scripts\python paths; native verify runs
// bash -c, which strips bare backslashes (all commands exit 127).
describe('plan brief validation-command rules (CASE-0022)', () => {
  it('tells the planner commands run under bash -c with forward-slash paths', () => {
    const brief = buildBrief('plan', CTX);
    expect(brief).toContain('bash -c');
    expect(brief).toContain('forward-slash');
    expect(brief).toContain('echo');
  });
});
