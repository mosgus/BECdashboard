# Contract 0043 — Make the test suite hermetic: block the network by default

**Status:** accepted (2026-09-18) — audited by planner, who found the block incomplete and
closed the gap. See the audit.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

No test can reach the network unless it explicitly asks to. The suite stops making live yfinance
calls, and stops being able to regress into making them again.

Tests and test configuration only. No application code changes.

## Why

Every contract in this project states *"tests must pass with no network"*. Measured 2026-09-18, that
was true only by accident.

**The whole suite passes with every outbound socket blocked — in 7.7s instead of 22.7s.** That
15-second gap is live network I/O whose results are thrown away.

Traced to two groups:

```
3.26s  test_api_universe.py::test_get_strip_schedules_auto_refresh_background_task
3.24s  test_api_universe.py::test_get_strip_resolves_to_strip_handler_not_the_ticker_catchall
3.21s  test_api_universe.py::test_get_strip_returns_expected_shape_for_a_universe_member
1.71s  test_news.py::test_run_news_refresh_if_due_writes_the_claim_before_the_fetch_even_if_it_raises
1.70s  test_news.py::test_refresh_stores_only_the_preferred_publishers_article
   …   four more test_news.py cases at ~1.5s each
```

The mechanism: `test_get_strip_schedules_auto_refresh_background_task` patches
`run_auto_refresh_if_due` but **not** `run_news_refresh_if_due`. Contract **0037** added that second
`background_tasks.add_task` and never updated these tests. `TestClient` runs background tasks
synchronously after the response, so each of those tests performs a **real news refresh across all
seven `MARKET_NEWS_TICKERS`** — roughly 21 live Yahoo requests per suite run. They pass regardless,
because `refresh_news_if_stale`'s per-ticker `except Exception: continue` swallows the outcome.

Three consequences, in order of how much they matter:

1. **It spends real yfinance quota** against the same IP Yahoo already rate-limits for this app
   (contract 0030 measured `getcrumb` returning 429 from Render). Running the suite repeatedly during
   development competes with the product for that budget.
2. **Test results depend on Yahoo being reachable.** A test that currently gets real data would take
   a different path offline. That is not a test, it is a coin flip with good odds.
3. It is 3× slower than it needs to be.

### This is the same incident as the one conftest already guards

`tests/conftest.py` carries an autouse fixture stripping `DATABASE_URL`, written after tests issued
real `INSERT INTO price_bars` against the production database on 2026-09-13. Its docstring is worth
re-reading before writing this one:

> *"It surfaced as a failure only by luck… Had those frames been OHLCV-shaped, the writes would have
> **succeeded**, silently seeding the live table with test data."*

Same shape: a test reaching something real that nobody intended, passing anyway, discovered by
accident. The fix belongs in the same file, for the same reason.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

Pytest configuration lives in `backend/pytest.ini`.

## Files

Modify:
- `backend/tests/conftest.py`
- `backend/pytest.ini`
- `backend/tests/test_api_universe.py`

**Touch nothing else.** **No file under `backend/app/` may change.** This contract fixes tests, not
behaviour — if a test only passes once you change application code, stop and report `BLOCKED`, because
that means the block found a real defect and it deserves its own contract.

No migration, no new dependency, no frontend change.

## 1. The autouse network block

In `tests/conftest.py`, beside `isolate_from_ambient_database`:

```python
@pytest.fixture(autouse=True)
def block_network(request, monkeypatch):
    """No test reaches the network unless it explicitly opts in."""
```

- Skip the block when the test carries `@pytest.mark.allow_network`, via
  `request.node.get_closest_marker("allow_network")`.
- Otherwise patch `socket.socket.connect`, `socket.socket.connect_ex` and `socket.create_connection`
  to raise.
- Raise a **`RuntimeError`**, not `OSError`. `OSError` is what a genuine connection failure looks
  like, and several code paths in this app catch broad exceptions and continue — the whole point is
  that an accidental network call must be **loud**, not absorbed by
  `except Exception: continue`.
- The message must name the attempted address and say how to opt in, e.g.
  `Test attempted a network connection to ('query1.finance.yahoo.com', 443). Patch the call, or mark the test @pytest.mark.allow_network.`

Use `monkeypatch` so it unwinds per test. This is proven to work: the planner ran exactly this
substitution on 2026-09-18 and all 360 tests passed in 7.7s.

**Nothing legitimate in this suite needs a socket.** SQLite fixtures use files, and `TestClient`
talks to the ASGI app in-process.

Register the marker in `pytest.ini` so `--strict-markers` and warning output stay clean:

```ini
markers =
    allow_network: test is permitted to make real outbound connections
```

## 2. Do not paper over failures with the marker

**`allow_network` exists for a future integration test, not for making this suite pass.**

If a test fails once the block is in place, the correct response is to patch whatever it is calling —
`fetch_news_for`, `fetch_history`, `symbol_has_history`, `run_news_refresh_if_due` — **not** to add
the marker. Adding the marker to an existing unit test reintroduces exactly the problem this contract
removes.

Planner has verified all 360 currently pass under the block, so **no existing test should need it**.
If one does, that is a finding: report it rather than silencing it.

## 3. Patch the strip tests' second background task

The block alone makes those three tests fast (a refused connection is instant) and safe, but they
would still be *executing* a real refresh path for no reason, and the assertion would still not say
so. Fix the intent as well as the symptom.

In `test_api_universe.py`, every test that issues `client.get("/universe/strip")` must patch **both**
background tasks:

```python
monkeypatch.setattr("app.routers.universe.run_auto_refresh_if_due", ...)
monkeypatch.setattr("app.routers.universe.run_news_refresh_if_due", ...)
```

`test_get_strip_schedules_auto_refresh_background_task` keeps asserting on the first; the second just
needs to be a no-op so nothing real runs. **Do not weaken its existing assertion.**

Check the rest of the file too — any other test hitting an endpoint that schedules background work
needs the same treatment. `GET /universe/strip` is the only such endpoint today.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes. Count is **at least 360**;
   it rises only by tests added for the block itself.
2. **Paste the runtime before and after.** It must drop materially — the planner measured 22.7s → 7.7s.
   This is the observable proof the suite stopped calling Yahoo, and no grep can substitute for it.
3. A test proves the block fires: attempting `socket.create_connection(("example.com", 80))` inside a
   normal test raises `RuntimeError` with a message naming the address.
4. A test marked `@pytest.mark.allow_network` proves the opt-out works — assert the patch is **not**
   installed, e.g. that `socket.socket.connect` is the real builtin. **Do not make a real connection
   in it**; that would put network I/O back into the suite to prove network I/O was removed.
5. `grep -n "allow_network" backend/pytest.ini` matches — the marker is registered.
6. `grep -rn "allow_network" backend/tests/` shows it used **only** by the criterion-4 test. Quote
   every match. Any other use means an existing test was silenced instead of fixed.
7. Every `client.get("/universe/strip")` in `test_api_universe.py` is preceded by a patch of
   **both** `run_auto_refresh_if_due` and `run_news_refresh_if_due`. Quote each site.
8. `git diff --stat backend/app/` is **empty**. No application code changed.
9. `ls backend/migrations/versions/` still shows exactly **seven**.
10. `git status --porcelain` lists nothing outside this contract's three files.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "allow_network" backend/pytest.ini
grep -rn "allow_network" backend/tests/
grep -n "run_news_refresh_if_due" backend/tests/test_api_universe.py
git diff --stat backend/app/ ; echo "(empty = no application code touched)"
ls -1 backend/migrations/versions/
git status --porcelain
```

Plus the timing evidence, which is the point of the contract:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q --durations=8 2>&1 | tail -12
```

The slowest tests should now be measured in **hundredths of a second**. If
`test_get_strip_*` or `test_news.py` cases still take seconds, something is still reaching out.

## Human verification — does Gunnar need to run anything?

**No.** This contract changes no application behaviour and has no visible surface. The suite timing in
the report is the whole verification.

Worth knowing rather than doing: after this, running `pytest` no longer consumes yfinance quota, so
iterating on tests can no longer contribute to rate-limiting the live app.

## Out of scope

- No application code changes of any kind.
- No new test framework, plugin or dependency — `monkeypatch` and stdlib `socket` are enough.
- No blocking of filesystem or subprocess access. Network only.
- No attempt to make the three strip tests assert anything new about the news refresh; they only stop
  executing it for real.
- No change to `isolate_from_ambient_database`. It stays exactly as it is.

## Open questions — do NOT resolve these yourself

- **Whether the seven `test_news.py` cases should also patch more explicitly.** The block makes them
  correct and fast; whether their intent is clear enough is a separate judgement.
- **Whether a genuine integration suite should exist**, marked `allow_network` and run deliberately
  rather than on every invocation.
- **Whether `_cached_last_session` deserves a fallback reference ticker.** Still the largest remaining
  single point of failure in the application itself.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-18)

`pytest -q` → **362 passed in 3.05s**, slowest single test **0.06s**. Before: 22.97s with the slowest
at 3.26s. `git diff --stat backend/app/` empty — no application code touched. Scope is exactly the
contract's three files.

### The implementer improved on the spec

The contract sketched inline `monkeypatch.setattr` at each `client.get("/universe/strip")` site. The
implementer instead extended the file's **existing** autouse fixture — which already did exactly this
for `run_auto_refresh_if_due` — covering all four call sites without four duplicated pairs, and
`test_get_strip_schedules_auto_refresh_background_task` still re-patches locally to spy. Better than
what was asked for, and flagged rather than slipped in.

`_REAL_SOCKET_CONNECT` captured at module-import time, before any fixture runs, is the one correct way
to hold a reference to the unpatched method for the opt-out test — and it proves the opt-out without
making a real connection.

### The block was incomplete, and that is a planner error

Probing with a throwaway test file, the socket patches fire correctly:

```
RuntimeError: Test attempted a network connection to ('query1.finance.yahoo.com', 443).
```

But **`yf.Ticker("AAPL").news` returned 10 live articles anyway.** yfinance reaches libcurl through
`curl_cffi`'s C bindings, which never touch `socket.socket`. `yfinance/data.py` uses **both**
`requests` and `curl_cffi`: the socket patches break the cookie/crumb flow (requests → urllib3 →
socket), but contract 0030 established that `.news` **needs no crumb**, so it goes straight out
through curl_cffi.

The planner's evidence for the block — 360 tests passing in 7.7s with sockets blocked — was real but
misattributed. The speedup came mostly from this contract's Part 3; Part 1 only ever covered
stdlib-socket callers. **A future test calling a crumb-free yfinance endpoint would still have made
live requests, silently, which is the exact regression this contract existed to prevent.**

Closed by the planner, validated before and after:

```python
monkeypatch.setattr(curl_requests.Session, "request", _blocked_curl_request)
```

```
socket    -> blocked (unchanged)
yfinance  -> BLOCKED: 'GET https://query1.finance.yahoo.com/v1/test/getcrumb'
suite     -> 362 passed in 2.88s
```

The suite passing unchanged confirms no existing test depended on Yahoo being reachable.

**General lesson:** blocking `socket` does not block a library that binds libcurl, `openssl` or any
other native transport. Verify a network block by making a real call through *the library you care
about*, not through `socket`.
