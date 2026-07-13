# Actual Behavior

The MVP `complete_run.ps1` blind-overwrote `evidence.md` and `review.md`, destroying any content a
human or `/ship` had filled in during the run. It also appended a fresh `run_completed` event on every
invocation — one MVP run accumulated 8 duplicate `run_completed` events — corrupting the metrics event
log and inflating completion counts.
