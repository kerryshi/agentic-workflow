# Classification

- Failure class: bad_context
- Severity: should_fix
- Prevention layer: grill brief should forbid deep exploration (ask, don't read) or the engine should pass a smaller exploration allowance; workaround proven: enrich pipeline.json task with exact file anchors, then resume

## Root Cause
The grill brief explicitly invited exploration ("Skim the repository briefly if that
helps") with no budget attached. On a large, self-referential repo (the harness's own),
"briefly" lost to the model's bias toward reading before asking — it spent all 12 turns
on file reads and never emitted the questions JSON.

## Contributing Factors
- Grill's 12-turn cap was sized like the other stages' caps, but grill needs tools far
  less than any other stage — the slack was pure exploration budget.
- The task text named files without anchors, making "go find them" feel productive.
- max_turns exits mid-tool-use, so the stage produced nothing salvageable.
