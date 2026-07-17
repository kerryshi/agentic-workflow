# Evidence — 2026-07-15_1936_add-the-deferred-collect-staleness-health-check

Native verify (harness-executed, no agent) ran 5 validation command(s) at 2026-07-16T21:22:29-04:00:

## `.venv/Scripts/python -m pytest tests/test_collect_health.py tests/test_markdown_digest.py tests/test_html_digest.py tests/test_store.py -q` — PASS (exit 0)
```
...................................                                      [100%]
```

## `.venv/Scripts/python -m pytest -q` — PASS (exit 0)
```
.................................................................. [ 51%]
..............................................................           [100%]
```

## `.venv/Scripts/python -c "from datetime import datetime, timedelta, timezone; from engine.digest import collect_health, render_markdown, STALE_AFTER_MINUTES; now = datetime(2026, 7, 16, 12, 0, tzinfo=timezone.utc); stale = collect_health((now - timedelta(hours=74.5)).isoformat(), now=now); fresh = collect_health((now - timedelta(minutes=5)).isoformat(), now=now); unknown = collect_health(None, now=now); assert stale['stale'] and unknown['stale'] and not fresh['stale']; assert STALE_AFTER_MINUTES == 25; empty = render_markdown([], health=stale); assert 'Collection may have stopped' in empty, 'stale banner missing from EMPTY digest (the 2026-07-05 outage shape)'; assert 'Collection may have stopped' not in render_markdown([], health=fresh); assert 'Collection may have stopped' not in render_markdown([]); print('OK: stale banner renders on empty digest; fresh/None stay silent')"` — PASS (exit 0)
```
OK: stale banner renders on empty digest; fresh/None stay silent
```

## `cd extension && npm run compile` — PASS (exit 0)
```
> ai-signal-scraper@0.1.5 compile
> tsc -p ./
```

## `grep -q 'statusBarItem.warningBackground' extension/out/extension.js && echo 'OK: out/extension.js regenerated with the warning badge state'` — PASS (exit 0)
```
OK: out/extension.js regenerated with the warning badge state
```

Overall: PASS; working tree surprises: YES — paths changed but never reported by build: .github/workflows/ci.yml
