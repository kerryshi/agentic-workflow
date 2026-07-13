import type { StageName, TemplateName } from './types.js';

/**
 * Deterministic v1 templates (docs/orchestration.md). "Not so strict": these are
 * default stage lists — stages pass through when irrelevant (grill on a clear task),
 * and must-fix reviews insert one fix+re-review cycle dynamically.
 */
export const TEMPLATE_STAGES: Record<TemplateName, StageName[]> = {
  feature: ['grill', 'plan', 'approval', 'build', 'review', 'verify'],
  bugfix: ['repro', 'plan', 'approval', 'build', 'review', 'verify'],
  // Refactor verifies first (tests green = behavior preserved), then reviews.
  refactor: ['plan', 'approval', 'build', 'verify', 'review'],
  review: ['review'],
};

/** Keyword classifier; --template always wins over this. */
export function classifyTask(task: string): TemplateName {
  const t = task.toLowerCase();
  if (/\breview\b/.test(t) && !/\b(fix|implement|add|build|write)\b/.test(t)) return 'review';
  if (/\b(fix|bug|crash|regression|broken|fails?|failing|error)\b/.test(t)) return 'bugfix';
  if (/\b(refactor|rename|extract|cleanup|clean up|restructure|simplify|reorganize)\b/.test(t))
    return 'refactor';
  return 'feature';
}

/** Turn caps keep a wandering stage from burning the budget. */
export const STAGE_MAX_TURNS: Record<StageName, number> = {
  grill: 12,
  repro: 30,
  plan: 30,
  approval: 0,
  build: 80,
  review: 40,
  verify: 30,
};

export const STAGE_TIMEOUT_MS: Record<StageName, number> = {
  grill: 10 * 60 * 1000,
  repro: 20 * 60 * 1000,
  plan: 20 * 60 * 1000,
  approval: 0,
  build: 40 * 60 * 1000,
  review: 20 * 60 * 1000,
  verify: 20 * 60 * 1000,
};
