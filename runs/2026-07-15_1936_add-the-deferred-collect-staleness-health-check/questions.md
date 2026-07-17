# Grill questions

Answer inline under each question, then resume the run.

1. Source of truth: the extension's top --json output carries no last-collect timestamp today — where should the staleness check read the last *successful* collect time from (a new/existing engine field or status subcommand, collect.log mtime over SSH, etc.), and if it needs a new engine field, is landing the extension side against a not-yet-deployed engine field acceptable given the Jetson deploy is out of scope?
   A: New engine field. Engine writes a last-successful-collect timestamp into its JSON output; the extension reads it. Landing the extension against the not-yet-deployed engine field is acceptable — the Jetson deploy is separately blocked (JETSON_HOST), and the warning simply activates once deployed. Do NOT use SSH-based log mtime (SSH to the Jetson is currently broken). [Kerry, 2026-07-16]

2. Command vs passive: STATUS calls this a 'health-check command' but the task says 'warn visibly' — do you want a passive warning on every showTop/refresh, a separate invokable aiSignal.healthCheck command, or both?
   A: Passive warning on every showTop/refresh only. No separate command. [Kerry, 2026-07-16]

3. Which visible surface should carry the warning: the status-bar badge switching to a warning state, a banner prepended to the digest markdown/tooltip, and/or a warning toast?
   A: Status-bar badge switches to a warning state AND a banner is prepended to the digest markdown. No toast. [Kerry, 2026-07-16]

4. When the last-collect time is unknown or the Jetson is unreachable (SSH fails), should that be treated as stale and warn, or stay silent?
   A: Treat as stale and warn. Unknown health = assume unhealthy; silent degradation is the failure mode this check exists to catch. [Kerry, 2026-07-16]

5. Test style: the repo's tests are all Python/pytest with no TS test harness — should the staleness comparison live in the engine (Python) so it's pytest-covered, or is an untested extension-only TypeScript change acceptable?
   A: Staleness comparison lives in the engine (Python) with pytest coverage; the extension only renders the engine's verdict. Every change ships with a test. [Kerry, 2026-07-16]
