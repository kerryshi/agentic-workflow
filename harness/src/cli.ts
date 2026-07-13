#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ClaudeDriver } from './adapters/claude.js';
import { CodexDriver } from './adapters/codex.js';
import { Engine, migratePipeline } from './engine.js';
import { readJson, writeFileAtomic } from './fsx.js';
import { renderReport } from './report.js';
import type { AgentId, Pipeline, StageName, TemplateName } from './types.js';

const TEMPLATES: TemplateName[] = ['feature', 'bugfix', 'refactor', 'review'];
const AGENTS: AgentId[] = ['claude', 'codex'];
const STAGES: StageName[] = ['grill', 'repro', 'plan', 'approval', 'build', 'review', 'verify'];

interface Flags {
  values: Map<string, string>;
  bools: Set<string>;
  positional: string[];
}

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
]);

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { values: new Map(), bools: new Set(), positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (VALUE_FLAGS.has(name)) {
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
  harness run "<task>" [--repo <path>] [--template ${TEMPLATES.join('|')}]
                       [--agent ${AGENTS.join('|')}] [--reviewer ${AGENTS.join('|')}]
                       [--model <model>] [--risk low|medium|high]
                       [--skip <stage>[,<stage>]] [--root <path>] [--dry-run]
                       [--agent-verify] [--full-rereview] [--no-isolation]
                       [--stage-budget-usd <n>] [--safe-perms] [--force-new]
  harness resume <run_id> [--approve] [--root <path>]
  harness status [<run_id>] [--root <path>]
  harness report <run_id> [--root <path>]`;

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
      const outcome = await engine.start(startOpts);
      console.log(`${outcome.state}: ${outcome.message}`);
      console.log(`run: ${outcome.runId}`);
      return 0;
    }

    case 'resume': {
      const runId = flags.positional[0];
      if (!runId) throw new Error(`missing run_id.\n${USAGE}`);
      const outcome = await makeEngine(root).resume(runId, {
        approve: flags.bools.has('approve'),
      });
      console.log(`${outcome.state}: ${outcome.message}`);
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
