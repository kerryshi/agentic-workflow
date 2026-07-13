#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ClaudeDriver } from './adapters/claude.js';
import { CodexDriver } from './adapters/codex.js';
import { captureFailure, resolveFailure, FAILURE_CLASSES, SEVERITIES, RESOLVE_STATUSES } from './cases.js';
import { runDoctor, renderDoctor } from './doctor.js';
import { Engine, migratePipeline } from './engine.js';
import { readJson, writeFileAtomic } from './fsx.js';
import { interactiveLoop, type InteractiveIo } from './interactive.js';
import { completeManualRun, resolveRun, updateRun } from './manualrun.js';
import { renderMetrics, writeMetrics } from './metrics.js';
import { newRun } from './newrun.js';
import { renderReport } from './report.js';
import { renderEstateSummary, summarizeRuns } from './summary.js';
import type { AgentId, Pipeline, StageName, TemplateName } from './types.js';

const TEMPLATES: TemplateName[] = ['feature', 'bugfix', 'refactor', 'review'];
const AGENTS: AgentId[] = ['claude', 'codex'];
const STAGES: StageName[] = ['grill', 'repro', 'plan', 'approval', 'build', 'review', 'verify'];

interface Flags {
  values: Map<string, string>;
  /** Flags that may repeat and ACCUMULATE (never comma-joined — see REPEATABLE_FLAGS). */
  repeated: Map<string, string[]>;
  bools: Set<string>;
  positional: string[];
}

/**
 * `--validate` repeats and each occurrence is ONE command. It must never be comma-split or
 * comma-joined: real commands contain commas (`pytest -k "a,b"`). new_run.ps1 documented this
 * the hard way; the Node port keeps the property.
 */
const REPEATABLE_FLAGS = new Set(['validate', 'evidence-link', 'file']);

const VALUE_FLAGS = new Set([
  'repo',
  'template',
  'agent',
  'reviewer',
  'model',
  'risk',
  'root',
  'skip',
  'stage-budget-usd',
  // case new/resolve
  'summary',
  'class',
  'severity',
  'linked-run',
  'repro',
  'expected',
  'actual',
  'evidence',
  'prevention',
  'regression',
  'fix-summary',
  'status',
  // new-run (the Node replacement for new_run.ps1)
  'agent-id',
  'role',
  'surface',
  'branch',
  'worktree',
  'machine',
  'prompt-summary',
  'status-path',
  // update-run / complete-run
  'command',
  'result',
  'note',
  'outcome',
  'reviewer-result',
  'risks',
  'follow-ups',
]);

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    values: new Map(),
    repeated: new Map(),
    bools: new Set(),
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-i') {
      flags.bools.add('interactive');
    } else if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (REPEATABLE_FLAGS.has(name)) {
        const value = argv[++i];
        if (value === undefined) throw new Error(`--${name} needs a value`);
        const list = flags.repeated.get(name) ?? [];
        list.push(value);
        flags.repeated.set(name, list);
      } else if (VALUE_FLAGS.has(name)) {
        const value = argv[++i];
        if (value === undefined) throw new Error(`--${name} needs a value`);
        // --skip may repeat; store comma-joined
        const prev = flags.values.get(name);
        flags.values.set(name, prev !== undefined && name === 'skip' ? `${prev},${value}` : value);
      } else {
        flags.bools.add(name);
      }
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function oneOf<T extends string>(value: string | undefined, allowed: T[], what: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as string[]).includes(value)) {
    throw new Error(`invalid ${what} "${value}" (expected: ${allowed.join(' | ')})`);
  }
  return value as T;
}

function defaultRoot(): string {
  // dist/cli.js lives at <root>/harness/dist/cli.js
  return resolve(import.meta.dirname, '..', '..');
}

function makeEngine(root: string): Engine {
  return new Engine({
    root,
    drivers: { claude: new ClaudeDriver(), codex: new CodexDriver() },
    log: (msg) => console.log(`[harness] ${msg}`),
  });
}

const USAGE = `usage:
  harness run "<task>" [-i] [--repo <path>] [--template ${TEMPLATES.join('|')}]
                       [--agent ${AGENTS.join('|')}] [--reviewer ${AGENTS.join('|')}]
                       [--model <model>] [--risk low|medium|high]
                       [--skip <stage>[,<stage>]] [--root <path>] [--dry-run]
                       [--agent-verify] [--full-rereview] [--no-isolation]
                       [--stage-budget-usd <n>] [--safe-perms] [--force-new]
  harness resume <run_id> [-i] [--approve] [--root <path>]
  harness status [<run_id>] [--root <path>]
  harness report <run_id> [--root <path>]
  harness report --all [--root <path>]        (estate catch-rate summary)
  harness doctor [--repo <path>] [--root <path>]
  harness case new --summary "..." --class <${FAILURE_CLASSES.slice(0, 3).join('|')}|...>
                   [--severity ${SEVERITIES.join('|')}] [--linked-run <run_id>]
                   [--repo <path>] [--repro <cmd>] [--expected <t>] [--actual <t>]
                   [--evidence <t>] [--prevention <t>] [--root <path>]
  harness case resolve <CASE-ID> [--status ${RESOLVE_STATUSES.join('|')}]
                   [--regression <t>] [--prevention <t>] [--fix-summary <t>] [--root <path>]
  harness new-run "<objective>" [--repo <path>] [--risk low|medium|high]
                   [--validate "<cmd>"]...        (repeat per command; never comma-split)
                   [--agent-id <id>] [--role planner|executor|reviewer|verifier|mixed|...]
                   [--surface <s>] [--model <m>] [--branch <b>] [--worktree <w>]
                   [--machine windows|wsl|mac] [--prompt-summary <t>] [--status-path <p>]
                   [--root <path>]                (a record for work the harness is NOT driving)
  harness update-run [<run_id>] [--command <c>] [--result <r>] [--note <n>]
                   [--evidence-link <l>]... [--file <f>]... [--repo <path>] [--root <path>]
  harness complete-run [<run_id>] [--status shipped|complete|blocked|abandoned]
                   [--outcome <t>] [--reviewer-result <t>] [--risks <t>] [--follow-ups <t>]
                   [--evidence-link <l>]... [--file <f>]... [--capture-diff]
                   [--repo <path>] [--root <path>]
                   (omit <run_id> to target the single in-progress run; ambiguity is REFUSED)
  harness metrics [--json] [--root <path>]        (regenerate metrics/summary.md + .json)`;

function terminalIo(): InteractiveIo & { close(): void } {
  // Lazy readline: only built when a gate is actually reached.
  let rl: import('node:readline/promises').Interface | undefined;
  let closed: Promise<'q'> | undefined;
  return {
    say: (line) => console.log(line),
    ask: async (prompt) => {
      if (!rl) {
        const { createInterface } = await import('node:readline/promises');
        rl = createInterface({ input: process.stdin, output: process.stdout });
        // stdin EOF (Ctrl-D, piped input running dry) leaves rl.question
        // pending forever and Node would exit 0 in silence — treat it as an
        // explicit quit so the parked-run hint still prints.
        closed = new Promise((resolve) => rl!.once('close', () => resolve('q')));
      }
      const answer = await Promise.race([rl.question(prompt), closed!]);
      return answer.trim();
    },
    close: () => rl?.close(),
  };
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  const root = flags.values.get('root') ?? defaultRoot();

  switch (command) {
    case 'run': {
      const task = flags.positional[0];
      if (!task) throw new Error(`missing task.\n${USAGE}`);
      const skip = (flags.values.get('skip') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const s of skip) oneOf(s, STAGES, 'stage');
      const engine = makeEngine(root);
      const template = oneOf(flags.values.get('template'), TEMPLATES, 'template');
      const builder = oneOf(flags.values.get('agent'), AGENTS, 'agent');
      const reviewer = oneOf(flags.values.get('reviewer'), AGENTS, 'reviewer');
      const risk = oneOf(flags.values.get('risk'), ['low', 'medium', 'high'], 'risk');
      const startOpts = {
        task,
        repo: resolve(flags.values.get('repo') ?? process.cwd()),
        ...(template ? { template } : {}),
        ...(builder ? { builder } : {}),
        ...(reviewer ? { reviewer } : {}),
        ...(risk ? { riskLevel: risk } : {}),
        ...(flags.bools.has('safe-perms') ? { skipPermissions: false } : {}),
        ...(flags.bools.has('no-isolation') ? { isolated: false } : {}),
        ...(flags.bools.has('agent-verify') ? { agentVerify: true } : {}),
        ...(flags.bools.has('full-rereview') ? { fullRereview: true } : {}),
        ...(flags.bools.has('force-new') ? { forceNew: true } : {}),
        ...(() => {
          const raw = flags.values.get('stage-budget-usd');
          if (raw === undefined) return {};
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --stage-budget-usd "${raw}"`);
          return { stageBudgetUsd: n };
        })(),
        model: flags.values.get('model') ?? null,
        skipStages: skip as StageName[],
      };
      if (flags.bools.has('dry-run')) {
        console.log(engine.dryRun(startOpts));
        return 0;
      }
      let outcome = await engine.start(startOpts);
      if (flags.bools.has('interactive')) {
        const io = terminalIo();
        try {
          outcome = await interactiveLoop(engine, outcome, io);
        } finally {
          io.close();
        }
      }
      console.log(`${outcome.state}: ${outcome.message}`);
      console.log(`run: ${outcome.runId}`);
      return 0;
    }

    case 'resume': {
      const runId = flags.positional[0];
      if (!runId) throw new Error(`missing run_id.\n${USAGE}`);
      const engine = makeEngine(root);
      let outcome = await engine.resume(runId, {
        approve: flags.bools.has('approve'),
      });
      if (flags.bools.has('interactive')) {
        const io = terminalIo();
        try {
          outcome = await interactiveLoop(engine, outcome, io);
        } finally {
          io.close();
        }
      }
      console.log(`${outcome.state}: ${outcome.message}`);
      return 0;
    }

    case 'doctor': {
      const repo = resolve(flags.values.get('repo') ?? process.cwd());
      const result = await runDoctor(root, repo);
      console.log(renderDoctor(result));
      return result.healthy ? 0 : 1;
    }

    case 'case': {
      const sub = flags.positional[0];
      if (sub === 'new') {
        const summary = flags.values.get('summary');
        const failureClass = flags.values.get('class');
        if (!summary || !failureClass) throw new Error(`case new needs --summary and --class.\n${USAGE}`);
        oneOf(failureClass, [...FAILURE_CLASSES], 'failure class');
        const severity = oneOf(flags.values.get('severity'), [...SEVERITIES], 'severity');
        const made = await captureFailure({
          root,
          summary,
          failureClass: failureClass as (typeof FAILURE_CLASSES)[number],
          ...(severity ? { severity } : {}),
          ...(flags.values.has('linked-run') ? { linkedRun: flags.values.get('linked-run')! } : {}),
          ...(flags.values.has('repo') ? { repo: resolve(flags.values.get('repo')!) } : {}),
          ...(flags.values.has('repro') ? { reproCommand: flags.values.get('repro')! } : {}),
          ...(flags.values.has('expected') ? { expected: flags.values.get('expected')! } : {}),
          ...(flags.values.has('actual') ? { actual: flags.values.get('actual')! } : {}),
          ...(flags.values.has('evidence') ? { evidence: flags.values.get('evidence')! } : {}),
          ...(flags.values.has('prevention') ? { preventionLayer: flags.values.get('prevention')! } : {}),
        });
        console.log(`Created failure case: ${made.caseId}`);
        console.log(made.caseDir);
        return 0;
      }
      if (sub === 'resolve') {
        const caseId = flags.positional[1];
        if (!caseId) throw new Error(`case resolve needs a CASE-ID.\n${USAGE}`);
        const status = oneOf(flags.values.get('status'), [...RESOLVE_STATUSES], 'status');
        const done = await resolveFailure({
          root,
          caseId,
          ...(status ? { status } : {}),
          ...(flags.values.has('regression') ? { regressionTest: flags.values.get('regression')! } : {}),
          ...(flags.values.has('prevention') ? { preventionLayer: flags.values.get('prevention')! } : {}),
          ...(flags.values.has('fix-summary') ? { fixSummary: flags.values.get('fix-summary')! } : {}),
        });
        console.log(`Resolved ${done.caseId}: ${status ?? 'fixed'}`);
        console.log(done.caseDir);
        return 0;
      }
      throw new Error(`unknown case subcommand "${sub ?? ''}".\n${USAGE}`);
    }

    // Replaces scripts/new_run.ps1 (retired 2026-07-13). For work the harness is NOT driving:
    // a manual task, or another agent under adapters/adapter-contract.md.
    case 'new-run': {
      const objective = flags.positional[0];
      if (!objective) throw new Error(`new-run needs an objective.\n${USAGE}`);
      const made = newRun({
        root,
        objective,
        repo: flags.values.get('repo') ?? process.cwd(),
        ...(flags.values.has('branch') ? { branch: flags.values.get('branch')! } : {}),
        ...(flags.values.has('worktree') ? { worktree: flags.values.get('worktree')! } : {}),
        ...(flags.values.has('agent-id') ? { agentId: flags.values.get('agent-id')! } : {}),
        ...(flags.values.has('surface') ? { agentSurface: flags.values.get('surface')! } : {}),
        ...(flags.values.has('model') ? { agentModel: flags.values.get('model')! } : {}),
        ...(flags.values.has('prompt-summary')
          ? { promptSummary: flags.values.get('prompt-summary')! }
          : {}),
        ...(flags.values.has('status-path')
          ? { statusPath: flags.values.get('status-path')! }
          : {}),
        ...(() => {
          const risk = oneOf(flags.values.get('risk'), ['low', 'medium', 'high'], 'risk');
          return risk ? { riskLevel: risk } : {};
        })(),
        ...(() => {
          const role = oneOf(
            flags.values.get('role'),
            ['planner', 'executor', 'reviewer', 'verifier', 'classifier', 'helper', 'mixed'],
            'agent role',
          );
          return role ? { agentRole: role } : {};
        })(),
        ...(() => {
          const machine = oneOf(
            flags.values.get('machine'),
            ['windows', 'wsl', 'mac'],
            'machine',
          );
          return machine ? { machine } : {};
        })(),
        // Each --validate is ONE command, kept whole. Never comma-split.
        validationPlan: flags.repeated.get('validate') ?? [],
      });
      console.log(`Created run: ${made.runId}`);
      console.log(made.runDir);
      return 0;
    }

    // Replaces scripts/update_run.ps1 (retired 2026-07-13).
    case 'update-run': {
      const handle = resolveRun(root, flags.positional[0], flags.values.get('repo'));
      await updateRun(handle, {
        ...(flags.values.has('command') ? { command: flags.values.get('command')! } : {}),
        ...(flags.values.has('result') ? { result: flags.values.get('result')! } : {}),
        ...(flags.values.has('note') ? { note: flags.values.get('note')! } : {}),
        evidenceLinks: flags.repeated.get('evidence-link') ?? [],
        filesChanged: flags.repeated.get('file') ?? [],
      });
      console.log(`Updated run: ${handle.runId}`);
      return 0;
    }

    // Replaces scripts/complete_run.ps1 (retired 2026-07-13).
    case 'complete-run': {
      const handle = resolveRun(root, flags.positional[0], flags.values.get('repo'));
      const status = oneOf(
        flags.values.get('status'),
        ['shipped', 'complete', 'blocked', 'abandoned'],
        'status',
      );
      const record = await completeManualRun(handle, {
        ...(status ? { status } : { status: 'shipped' as const }),
        ...(flags.values.has('outcome') ? { finalOutcome: flags.values.get('outcome')! } : {}),
        ...(flags.values.has('reviewer-result')
          ? { reviewerResult: flags.values.get('reviewer-result')! }
          : {}),
        ...(flags.values.has('risks') ? { risks: flags.values.get('risks')! } : {}),
        ...(flags.values.has('follow-ups') ? { followUps: flags.values.get('follow-ups')! } : {}),
        ...(flags.values.has('repo') ? { repo: flags.values.get('repo')! } : {}),
        evidenceLinks: flags.repeated.get('evidence-link') ?? [],
        filesChanged: flags.repeated.get('file') ?? [],
        captureDiff: flags.bools.has('capture-diff'),
      });
      console.log(`Completed run: ${record.run_id} (${record.status})`);
      return 0;
    }

    // Replaces scripts/summarize_metrics.ps1 (retired 2026-07-13).
    case 'metrics': {
      const summary = writeMetrics(root, (m) => console.warn(m));
      console.log(
        flags.bools.has('json') ? JSON.stringify(summary, null, 2) : renderMetrics(summary),
      );
      return 0;
    }

    case 'status': {
      const runId = flags.positional[0];
      const runsDir = join(root, 'runs');
      if (!runId) {
        const entries = existsSync(runsDir)
          ? readdirSync(runsDir)
              .filter((d) => existsSync(join(runsDir, d, 'pipeline.json')))
              .sort()
              .slice(-10)
          : [];
        if (!entries.length) {
          console.log('no harness runs found');
          return 0;
        }
        for (const id of entries) {
          const p = readJson<Pipeline>(join(runsDir, id, 'pipeline.json'));
          const current = p.stages[p.current_stage];
          const state = current ? `${current.name}:${current.status}` : 'completed';
          console.log(`${id}  [${p.template}]  ${state}`);
        }
        return 0;
      }
      const p = readJson<Pipeline>(join(runsDir, runId, 'pipeline.json'));
      console.log(`run: ${p.run_id}\ntemplate: ${p.template} · builder: ${p.builder} · reviewer: ${p.reviewer}`);
      for (const [i, s] of p.stages.entries()) {
        const marker = i === p.current_stage ? '>' : ' ';
        const name = s.variant ? `${s.name} (${s.variant})` : s.name;
        console.log(`${marker} ${name.padEnd(14)} ${s.status}${s.park_reason ? `  (${s.park_reason})` : ''}`);
      }
      return 0;
    }

    case 'report': {
      if (flags.bools.has('all')) {
        console.log(renderEstateSummary(summarizeRuns(root)));
        return 0;
      }
      const runId = flags.positional[0];
      if (!runId) throw new Error(`missing run_id.\n${USAGE}`);
      const runDir = join(root, 'runs', runId);
      const report = renderReport(migratePipeline(readJson<Pipeline>(join(runDir, 'pipeline.json'))));
      writeFileAtomic(join(runDir, 'tokens.md'), report);
      console.log(report);
      console.log(`(written to runs/${runId}/tokens.md)`);
      return 0;
    }

    default:
      console.log(USAGE);
      return command === undefined || command === 'help' ? 0 : 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
