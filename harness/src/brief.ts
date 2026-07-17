import type { StageName } from './types.js';

export interface BriefContext {
  task: string;
  answers: string | null;
  /** plan.md content, for build/review stages. */
  planMd?: string;
  /** Rendered must-fix findings, for a fix-variant build stage. */
  reviewFindings?: string;
  validationCommands?: string[];
  /** Whether the reviewer is a different agent than the builder. */
  independentReviewer?: boolean;
  variant?: 'fix';
  /** A prior attempt at this stage exists (crash, park, or rejected output). */
  retry?: boolean;
  /** This stage resumes the builder session — earlier stages are in-context. */
  resumedSession?: boolean;
  /** Repo AGENTS.md/CLAUDE.md content — isolated workers don't auto-load it. */
  repoConventions?: string;
  /** Harness-captured working-tree diff (capped) — saves the reviewer reconstruction turns. */
  currentDiff?: string;
  /** Present on re-reviews: scope to prior findings + what changed since. */
  deltaReview?: { priorMustFix: string; priorDiff?: string };
}

const CONSTRAINTS = `CONSTRAINTS:
- Work only inside this repository (your current working directory).
- Never push, deploy, send messages, install global software, touch credentials/secrets,
  or modify anything outside this repository.
- Do not create git commits; leave changes in the working tree.
- Honest output only: report failures as failures. Never claim a check passed without
  having run it in this session and seen the output.`;

function header(stage: StageName, ctx: BriefContext): string {
  const parts = [
    `You are the ${stage.toUpperCase()} stage of a coding pipeline run by a harness`,
    `(agentic-workflow v2). Do only this stage's job; later stages are handled separately.`,
    ``,
    `TASK:`,
    ctx.task,
  ];
  if (ctx.answers) {
    parts.push(``, `CLARIFICATIONS FROM KERRY (authoritative):`, ctx.answers);
  }
  if (ctx.retry) {
    parts.push(
      ``,
      `NOTE: a previous attempt at this stage was interrupted or rejected. Reassess the`,
      `actual working-tree state first — do not assume earlier changes are absent or complete.`,
    );
  }
  parts.push(``, CONSTRAINTS, ``);
  if (ctx.repoConventions) {
    parts.push(`REPO CONVENTIONS (this repository's own agent docs — follow them):`, ctx.repoConventions, ``);
  }
  return parts.join('\n');
}

function contract(schema: string): string {
  return [
    `OUTPUT CONTRACT:`,
    `End your reply with exactly one JSON object of this shape (no other JSON objects after it):`,
    schema,
  ].join('\n');
}

export function buildBrief(stage: StageName, ctx: BriefContext): string {
  switch (stage) {
    case 'grill':
      // No open-ended repo exploration: a large repo ate the whole turn cap and
      // produced zero questions (CASE-0021). Ask, don't read.
      return [
        header(stage, ctx),
        `Assess whether this task is specified well enough to plan and build without guessing`,
        `product intent. Work from the task text — ASK, DON'T EXPLORE: you have a hard turn`,
        `cap and repositories can be arbitrarily large, so spend at most 2 quick file peeks`,
        `confirming that things the task names exist. If you would need to read code to`,
        `answer a question yourself, that is a question to return, not research to do.`,
        `DO NOT edit any files and DO NOT start planning the implementation.`,
        `If the task leaves real room for misalignment (scope, user-visible behavior, edge`,
        `cases, "done" criteria), produce at most 5 pointed questions whose answers would`,
        `change the plan. If it is clear enough, say so.`,
        ``,
        contract(`{"ambiguous": true|false, "questions": ["question 1", "..."]}`),
      ].join('\n');

    case 'repro':
      return [
        header(stage, ctx),
        `Reproduce the reported problem in this repository. Find the command or minimal steps`,
        `that demonstrate the failing behavior and capture the actual failing output.`,
        `DO NOT fix anything yet.`,
        ``,
        contract(
          `{"reproduced": true|false, "repro_command": "command that shows the failure, or empty",` +
            ` "notes": "what you observed, including the failing output tail"}`,
        ),
      ].join('\n');

    case 'plan':
      return [
        header(stage, ctx),
        `Produce a short, concrete implementation plan for this task. Read the code you need;`,
        `DO NOT edit any files. The plan must cover: goal, ordered steps, files to touch,`,
        `exact validation commands that will prove it works, and risks. Follow the repo's`,
        `existing conventions.`,
        ``,
        // Commands execute under bash even on Windows; backslash paths die there (CASE-0022).
        `VALIDATION COMMAND RULES — the harness runs them with non-interactive \`bash -c\``,
        `from the repo root on EVERY platform (Git Bash on Windows):`,
        `- forward-slash paths only (.venv/Scripts/python, never .venv\\Scripts\\python —`,
        `  bash strips bare backslashes);`,
        `- pipe stdin explicitly (echo 'text' | cmd, never a bare "text" | cmd);`,
        `- every command must run unattended and exit non-zero on failure.`,
        ``,
        contract(
          `{"plan_markdown": "the full plan as markdown",` +
            ` "validation_commands": ["cmd 1", "..."], "files": ["path 1", "..."]}`,
        ),
      ].join('\n');

    case 'approval':
      return ''; // gate stage — never sent to an agent

    case 'build': {
      const parts = [header(stage, ctx)];
      if (ctx.variant === 'fix') {
        parts.push(
          `An independent review of your pipeline's earlier build found MUST-FIX issues.`,
          `Address ONLY these findings — no unrelated changes:`,
          ``,
          ctx.reviewFindings ?? '(findings missing — treat as fatal and say so in notes)',
          ``,
        );
      }
      parts.push(
        `Implement the approved plan below. Small, scoped changes; follow existing`,
        `conventions; every bug fix needs a regression test that fails before the fix.`,
        `Run the plan's validation commands yourself before finishing and report honestly.`,
        ...(ctx.resumedSession
          ? [
              `You planned this earlier in this same session, but the text below is the`,
              `APPROVED version — Kerry may have edited it at the gate; it wins over your memory.`,
            ]
          : []),
        ``,
        `APPROVED PLAN:`,
        ctx.planMd ?? '(no plan artifact — stop and report this as an error in your JSON)',
        ``,
        contract(
          `{"summary": "what you changed and why", "files_changed": ["path 1", "..."],` +
            ` "commands_run": ["cmd 1", "..."], "tests_passed": true|false,` +
            ` "test_output_tail": "last lines of the validation output"}`,
        ),
      );
      return parts.join('\n');
    }

    case 'review': {
      const independence = ctx.independentReviewer
        ? `You are a DIFFERENT agent than the one that wrote this code.`
        : `You are a fresh process of the same agent that wrote this code — you have none of` +
          ` its context. Judge only what you can see.`;
      const parts = [header(stage, ctx), `You are an independent, skeptical reviewer. ${independence}`];
      if (ctx.deltaReview) {
        parts.push(
          `This is a RE-REVIEW after fixes — scope it; do not re-derive the whole review.`,
          `The previous review round raised these MUST-FIX findings:`,
          ctx.deltaReview.priorMustFix,
          ``,
          `Your job, in order:`,
          `1. Verify each prior finding is ACTUALLY resolved — drive the code, don't trust claims.`,
          `2. Adversarially review what changed since that round (compare the prior and current`,
          `   diffs below) — fixes introduce their own bugs.`,
          `3. Do NOT re-litigate unchanged code you can see was previously reviewed.`,
        );
        if (ctx.deltaReview.priorDiff) {
          parts.push(``, `PRIOR DIFF (tree at the previous review):`, '```diff', ctx.deltaReview.priorDiff, '```');
        }
      } else {
        parts.push(
          `The change under review is the UNCOMMITTED state of this repository: verify against`,
          `the real repo — read the touched files and drive the code where practical; the diff`,
          `below saves you reconstructing WHAT changed, not judging it.`,
          `DO NOT fix anything — report findings only.`,
          `Classify findings as must_fix (correctness, data loss, security, broken tests) or`,
          `should_fix (quality issues worth doing now). Verify claims against the plan below.`,
        );
      }
      if (ctx.currentDiff) {
        parts.push(``, `CURRENT DIFF (harness-captured, includes untracked files):`, '```diff', ctx.currentDiff, '```');
      } else {
        parts.push(``, `(No harness diff was captured — run git status and git diff yourself.)`);
      }
      parts.push(
        ``,
        `PLAN THE BUILDER FOLLOWED:`,
        ctx.planMd ?? '(no plan artifact — review the diff on its own terms)',
        ``,
        contract(
          `{"verdict": "approve"|"must_fix", "must_fix": [{"file": "path", "issue": "..."}],` +
            ` "should_fix": [{"file": "path", "issue": "..."}], "notes": "..."}`,
        ),
      );
      return parts.join('\n');
    }

    case 'verify': {
      const cmds = ctx.validationCommands?.length
        ? ctx.validationCommands.map((c) => `- ${c}`).join('\n')
        : '- (none recorded — derive the obvious test/lint commands from the repo and say so)';
      return [
        header(stage, ctx),
        `Run each validation command below in this repository and capture its real output.`,
        `Also run git status to confirm the working tree state matches what the build stage`,
        `reported. DO NOT edit files. Report exactly what happened — a failing command is a`,
        `failing command.`,
        ``,
        `VALIDATION COMMANDS:`,
        cmds,
        ``,
        contract(
          `{"passed": true|false, "results": [{"command": "...", "passed": true|false,` +
            ` "output_tail": "last ~10 lines"}], "git_status_clean_of_surprises": true|false}`,
        ),
      ].join('\n');
    }
  }
}
