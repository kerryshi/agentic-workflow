# Evidence — 2026-07-15_1521_add-session-resume-to-the-harness-codex-adapter

Native verify (harness-executed, no agent) ran 4 validation command(s) at 2026-07-15T16:05:49-04:00:

## `npm --prefix harness run typecheck` — PASS (exit 0)
```
> agentic-workflow-harness@0.1.0 typecheck
> tsc --noEmit -p .
```

## `npm --prefix harness test` — PASS (exit 0)
```
m[2m)[22m[32m 221[2mms[22m[39m
 [32m✓[39m tests/run-claim.test.ts [2m([22m[2m3 tests[22m[2m)[22m[33m 343[2mms[22m[39m
   [33m[2m✓[22m[39m atomic id claim[2m > [22mconcurrent PROCESSES never share an id (CASE-0005 class) [33m 337[2mms[22m[39m
 [32m✓[39m tests/cases.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 406[2mms[22m[39m
 [32m✓[39m tests/guards.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 186[2mms[22m[39m
 [32m✓[39m tests/newrun.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 188[2mms[22m[39m
 [32m✓[39m tests/records.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 162[2mms[22m[39m
 [32m✓[39m tests/attempts.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 108[2mms[22m[39m
 [32m✓[39m tests/lock.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 154[2mms[22m[39m
 [32m✓[39m tests/metrics-compat.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 55[2mms[22m[39m
 [32m✓[39m tests/hygiene.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 23[2mms[22m[39m
 [32m✓[39m tests/metrics.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 37[2mms[22m[39m
 [32m✓[39m tests/isolation.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 61[2mms[22m[39m
 [32m✓[39m tests/parse.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 3[2mms[22m[39m
 [32m✓[39m tests/ids.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 2[2mms[22m[39m
 [32m✓[39m tests/doctor.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 15[2mms[22m[39m
 [32m✓[39m tests/summary.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 13[2mms[22m[39m
 [32m✓[39m tests/secrets.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 2[2mms[22m[39m

[2m Test Files [22m [1m[32m24 passed[39m[22m[90m (24)[39m
[2m      Tests [22m [1m[32m171 passed[39m[22m[90m (171)[39m
[2m   Start at [22m 16:05:37
[2m   Duration [22m 3.21s[2m (transform 271ms, setup 0ms, collect 807ms, tests 7.69s, environment 2ms, prepare 1.28s)[22m
```

## `npm --prefix harness test -- codex-driver` — PASS (exit 0)
```
> agentic-workflow-harness@0.1.0 test
> vitest run codex-driver


[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mC:/Users/PC/agentic-workflow/harness[39m

 [32m✓[39m tests/codex-driver.test.ts [2m([22m[2m22 tests[22m[2m)[22m[33m 537[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m22 passed[39m[22m[90m (22)[39m
[2m   Start at [22m 16:05:42
[2m   Duration [22m 740ms[2m (transform 35ms, setup 0ms, collect 41ms, tests 537ms, environment 0ms, prepare 54ms)[22m
```

## `npm --prefix harness run test:all` — PASS (exit 0)
```
sts/run-claim.test.ts [2m([22m[2m3 tests[22m[2m)[22m[33m 344[2mms[22m[39m
   [33m[2m✓[22m[39m atomic id claim[2m > [22mconcurrent PROCESSES never share an id (CASE-0005 class) [33m 338[2mms[22m[39m
 [32m✓[39m tests/cases.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 403[2mms[22m[39m
 [32m✓[39m tests/newrun.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 185[2mms[22m[39m
 [32m✓[39m tests/records.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 157[2mms[22m[39m
 [32m✓[39m tests/guards.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 182[2mms[22m[39m
 [32m✓[39m tests/lock.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 140[2mms[22m[39m
 [32m✓[39m tests/attempts.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 109[2mms[22m[39m
 [32m✓[39m tests/metrics-compat.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 56[2mms[22m[39m
 [32m✓[39m tests/hygiene.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 24[2mms[22m[39m
 [32m✓[39m tests/isolation.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 63[2mms[22m[39m
 [32m✓[39m tests/metrics.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 35[2mms[22m[39m
 [32m✓[39m tests/ids.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 2[2mms[22m[39m
 [32m✓[39m tests/parse.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 3[2mms[22m[39m
 [32m✓[39m tests/doctor.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 16[2mms[22m[39m
 [32m✓[39m tests/summary.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 13[2mms[22m[39m
 [32m✓[39m tests/secrets.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 2[2mms[22m[39m

[2m Test Files [22m [1m[32m24 passed[39m[22m[90m (24)[39m
[2m      Tests [22m [1m[32m171 passed[39m[22m[90m (171)[39m
[2m   Start at [22m 16:05:44
[2m   Duration [22m 3.21s[2m (transform 270ms, setup 0ms, collect 803ms, tests 7.68s, environment 2ms, prepare 1.26s)[22m


> agentic-workflow-harness@0.1.0 build
> tsc -p .
```

Overall: PASS; working tree surprises: YES — paths changed but never reported by build: metrics/runs.jsonl, failures/CASE-0021_grill-stage-burns-its-12-turn-cap/, failures/CASE-0022_native-verify-executes-validation/, runs/2026-07-15_1519_add-a-catering-large-order-faq-topic-to-the-chin/, runs/2026-07-15_1520_add-a-sitemap-xml-to-the-lucky-nail-spa-static-s/, runs/2026-07-15_1521_add-session-resume-to-the-harness-codex-adapter/
