import { join } from 'node:path';
import type { Engine, EngineOutcome } from './engine.js';

/**
 * Interactive gate mode (`harness run -i`): the process stays alive at gates
 * instead of exiting parked. Field finding (desktop, 2026-07-11): the
 * park/exit/resume two-step is exactly where a real session abandoned the
 * harness (parked twin runs, never resumed). Park-to-disk still happens
 * underneath — quitting at any gate leaves a normal resumable run.
 */

export interface InteractiveIo {
  say(line: string): void;
  /** Ask one question, return the trimmed answer ('' for bare Enter). */
  ask(prompt: string): Promise<string>;
}

export async function interactiveLoop(
  engine: Engine,
  first: EngineOutcome,
  io: InteractiveIo,
): Promise<EngineOutcome> {
  let outcome = first;
  while (outcome.state === 'parked') {
    const { handle, pipeline } = engine.loadRun(outcome.runId);
    const stage = pipeline.stages[pipeline.current_stage];
    io.say('');

    if (stage?.name === 'approval') {
      io.say(`plan ready: ${join(handle.runDir, 'plan.md')}`);
      io.say('read it (edits to the file count — the build treats it as authoritative).');
      // Only explicit choices act — a stray Enter must not silently end the
      // session (review finding: that recreated the exact two-step abandonment
      // -i exists to prevent).
      let decided: 'approve' | 'quit' | undefined;
      while (decided === undefined) {
        const a = (await io.ask('approve and continue? [y]es / [q]uit-parked: ')).toLowerCase();
        if (a === 'y' || a === 'yes') decided = 'approve';
        else if (a === 'q' || a === 'quit') decided = 'quit';
        else io.say(`type y to approve the plan or q to leave the run parked (got ${JSON.stringify(a)})`);
      }
      if (decided === 'quit') {
        io.say(`left parked — resume later with: harness resume ${outcome.runId} --approve`);
        return outcome;
      }
      outcome = await engine.resume(outcome.runId, { approve: true });
      continue;
    }

    if (stage?.name === 'grill' && stage.park_reason === 'awaiting grill answers') {
      io.say(`the task needs answers: ${join(handle.runDir, 'questions.md')}`);
      const a = (await io.ask('answer inline in that file, then press Enter (or q to quit-parked): ')).toLowerCase();
      if (a === 'q' || a === 'quit') {
        io.say(`left parked — resume later with: harness resume ${outcome.runId}`);
        return outcome;
      }
      outcome = await engine.resume(outcome.runId, {});
      continue;
    }

    // Every other park (must-fix after fix cycle, failed verify, agent error…)
    io.say(`parked: ${outcome.message}`);
    const a = (await io.ask('intervene now, then press Enter to resume (or q to quit-parked): ')).toLowerCase();
    if (a === 'q' || a === 'quit') {
      io.say(`left parked — resume later with: harness resume ${outcome.runId}`);
      return outcome;
    }
    outcome = await engine.resume(outcome.runId, {});
  }
  return outcome;
}
