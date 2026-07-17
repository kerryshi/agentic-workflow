# Evidence — 2026-07-15_2209_build-go-live-step-3-of-the-outreach-webmaster-p

Native verify (harness-executed, no agent) ran 5 validation command(s) at 2026-07-16T21:07:56-04:00:

## `.venv/Scripts/ruff check .` — PASS (exit 0)
```
All checks passed!
```

## `.venv/Scripts/python -m pytest -q` — PASS (exit 0)
```
........................................................................ [ 18%]
........................................................................ [ 36%]
........................................................................ [ 54%]
........................................................................ [ 72%]
........................................................................ [ 90%]
.......................................                                  [100%]
============================== warnings summary ===============================
tests/test_webapp.py::test_csrf_rejects_cross_origin_post
  C:\Users\PC\Desktop\Sandbox Testing\outreach webmaster\.venv\Lib\site-packages\fastapi\testclient.py:1: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient as TestClient  # noqa

tests/test_webapp.py::test_csrf_rejects_cross_origin_post
  C:\Users\PC\Desktop\Sandbox Testing\outreach webmaster\src\outreach_webmaster\webapp\app.py:58: DeprecationWarning: 
          on_event is deprecated, use lifespan event handlers instead.
  
          Read more about it in the
          [FastAPI docs for Lifespan Events](https://fastapi.tiangolo.com/advanced/events/).
          
    @app.on_event("startup")

tests/test_webapp.py::test_csrf_rejects_cross_origin_post
  C:\Users\PC\Desktop\Sandbox Testing\outreach webmaster\.venv\Lib\site-packages\fastapi\applications.py:4675: DeprecationWarning: 
          on_event is deprecated, use lifespan event handlers instead.
  
          Read more about it in the
          [FastAPI docs for Lifespan Events](https://fastapi.tiangolo.com/advanced/events/).
          
    return self.router.on_event(event_type)  # ty: ignore[deprecated]

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
399 passed, 3 warnings in 8.81s
```

## `.venv/Scripts/python -m pytest tests/test_send.py tests/test_send_live.py -q` — PASS (exit 0)
```
........................................................                 [100%]
56 passed in 1.45s
```

## `.venv/Scripts/python -m outreach_webmaster send --help | grep -q -- '--cap'` — PASS (exit 0)
```

```

## `.venv/Scripts/python -m outreach_webmaster stop --help > /dev/null` — PASS (exit 0)
```

```

Overall: PASS; working tree surprises: none
