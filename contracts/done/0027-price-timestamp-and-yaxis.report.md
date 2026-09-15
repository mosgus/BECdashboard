# Report — Contract 0027 — Quote timestamp in the Price header, and fix the chart's Y axis

**Status:** reported

## Summary

`UniverseEntry` gains `quote_fetched_at`, sourced from `ticker_quotes.fetched_at` and guaranteed
null whenever `current_price` is null (same branch, by construction — see below). The `Price`
column header now reads `Price @ 3:10 PM` or `Price @ close`. The chart's Y axis gets the
`tickFormatter` it was missing and a wider `width` — verified live against the exact bug report
(raw Postgres floats, e.g. `332.2699890136719`) and against the widest real price (MU, ~975 plus
padding).

Files exactly as listed:
- `backend/app/schemas.py` — `quote_fetched_at` on `UniverseEntry`
- `backend/app/universe.py` — surfaced in `list_all`/`get_one`
- `backend/tests/test_universe.py` — cases 6/7, plus a real bug found and fixed (below)
- `frontend/src/api/client.ts` — the type
- `frontend/src/components/UniverseTable.tsx` — the header
- `frontend/src/components/ChartDialog.tsx` — the Y axis

No other files touched this session.

## A real, pre-existing bug found while implementing this — not caused by this contract, but fixed here

Running the full suite after my changes surfaced one failure:
`test_list_all_current_price_populated_when_quote_fresh_and_market_open` asserted `current_price
== 123.45` and got `None`. The test explicitly does
`monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)` to force the market open.

**That patch has never actually worked.** `universe.py` imports with
`from app.quotes import is_market_open` — this binds a name in `universe.py`'s **own**
namespace at import time. Patching the attribute on the `app.quotes` module afterward does not
touch that already-bound reference. Every call to `is_market_open` from within `universe.py`
(now `_live_quote`, formerly `_current_price`) has always read the **real, unpatched** function,
regardless of what any test patched on `app.quotes`. This codebase's own established convention
already gets this right elsewhere — contract 0016's tests patch `app.universe.symbol_has_history`
(where the name is *looked up*, not where it's *defined*) — this one test just didn't follow it.

**Why this had been silently working until now**: nothing about the patch failing raises an
error — it just means `is_market_open` reflects the real system clock. The two tests that assert
on `current_price`'s value happened to get the real clock's actual market-open state to agree
with what they asked for, every previous time the suite ran, by coincidence. This run, at whatever
real moment it executed, the real clock said "closed," and the coincidence broke. The `_download_quotes`
patches (`app.quotes._download_quotes`) are **not** affected by this — `fetch_quotes` calls that
name from *within* `quotes.py`'s own module, so that binding is fine.

**Also a correctness gap, not just a test bug**: this means the autouse
`quotes_market_closed_by_default` fixtures (added in contract 0024, present in both
`test_universe.py` and `test_api_universe.py`) only ever correctly suppressed the *fetch* decision
(`refresh_quotes_if_stale` → `needs_refresh` → `is_market_open`, which does resolve via
`quotes.py`'s own namespace and was never broken) — they never actually controlled what
`current_price` showed for any test relying on the default. No test happened to assert on that
combination before, so it went unnoticed.

**Fixed** by also patching `app.universe.is_market_open` everywhere the intent is to control
`universe.py`'s behavior: the autouse fixture in `test_universe.py`, and both explicit overrides
in the two case-11 tests (now three, with the new one this contract adds — see below). I did
**not** touch `test_api_universe.py`'s matching fixture, even though it has the identical
half-effective pattern — nothing in that file currently asserts on `current_price`, so there is no
concrete failure forcing a fix there, and that file isn't in this contract's list. Flagging it
here rather than leaving it undocumented: the same latent gap exists there and would surface the
same way if a future contract adds an assertion on `current_price` through that file.

## Cases 6 and 7 — how they're tested

- **Case 7** (`quote_fetched_at` populated when a fresh quote exists): added directly to the
  now-fixed `test_list_all_current_price_populated_when_quote_fresh_and_market_open` —
  `assert entries["AAPL"]["quote_fetched_at"] == now`.
- **Case 6** (`quote_fetched_at` null whenever `current_price` is null): covered twice, for the
  two distinct reasons `current_price` can be null. Added to
  `test_list_all_current_price_null_when_quote_older_than_ttl` (null due to staleness, quote row
  exists), and a new test,
  `test_list_all_quote_fetched_at_null_when_market_closed_even_with_fresh_quote` (null due to
  closed market, despite a perfectly fresh quote — the more common real-world case, and the one
  most likely to tempt an implementation into showing a timestamp it shouldn't).

Both are true by construction, not by two independently-maintained conditionals that could drift:
`_live_quote(quote) -> tuple[float | None, datetime | None]` returns `(price, fetched_at)` from
the exact same branch every time — there is no code path that returns one without the other.

## Design decisions

- **Renamed `_current_price` to `_live_quote`**, returning a tuple instead of a single value.
  This was the natural way to guarantee the "always null together" invariant the contract asks
  for (criterion 6) without duplicating the market-open/TTL check in two places that could
  silently diverge later. It's a private, underscore-prefixed helper with no external callers
  (confirmed via `grep` before renaming), so this was safe within `universe.py`'s own scope.
- **`quote_fetched_at` costs no new query.** It's read off the exact same `quotes_by_ticker` dict
  `list_all()` already builds via the pre-existing `get_quotes(tickers)` call — `_live_quote` just
  returns one more field from data already in hand. Confirmed by the full suite still passing,
  including the query-count test (criterion 8).
- **Header derives the display time from the first row with a non-null `quote_fetched_at`**, not
  from any specific ticker — `quote_fetched_at` is uniform across all tickers (one batched
  request, per contract 0024), so any row that has one carries the same value as every other row
  that does. `Array.prototype.find` costs nothing meaningful over nine rows.

## Verification

```
$ PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
183 passed, 2 warnings in 1.83s
```
183 > 182 (baseline stated in the contract; one new test, three assertions added to existing
tests, one real bug fixed).

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 161ms

$ grep -n "tickFormatter" frontend/src/components/ChartDialog.tsx
217:                  tickFormatter={(value: string) => value.slice(0, 7)}
225:                  tickFormatter={(value: number) => formatPrice(value)}

$ grep -n "width=" frontend/src/components/ChartDialog.tsx
213:            <ResponsiveContainer width="100%" height={320}>
229:                  width={56}

$ grep -n "quote_fetched_at" backend/app/schemas.py backend/app/universe.py frontend/src/api/client.ts
backend/app/schemas.py:28:    quote_fetched_at: datetime | None
backend/app/universe.py: (3 sites — the tuple destructure and both dict outputs)
frontend/src/api/client.ts:14:  quote_fetched_at: string | null

$ ls -1 backend/migrations/versions/
0001_initial.py
0002_add_adj_close.py
0003_universe_tickers.py
0004_ticker_quotes.py
```
Still four — no migration added.

```
$ grep -rnE 'getHours|getDay|market.?open' frontend/src/
(no matches, exit 1)

$ git diff --stat backend/app/cache.py backend/app/quotes.py backend/app/market_data.py \
    backend/app/models.py backend/app/routers/ frontend/src/pages/ frontend/src/lib/ frontend/package.json
frontend/src/pages/UniversePage.tsx | 2 +-
```
That line predates this session (uncommitted work from contract 0023). `git status` before and
after confirms I touched exactly the six files listed above.

### Beyond the required greps — live verification against the actual reported bug

Criterion 5's Y-axis fix is exactly a *rendering* bug (raw floats, clipped labels), so I drove it
through headless Chrome rather than trusting the code alone (same temporary `main.tsx`-swap
technique as every prior UI contract, restored to its exact original content afterward — confirmed
via empty `git diff --stat` and absence from `git status`):

**Price header, both states:**
```
["Price @ 3:10 PM","Price @ close"]
```

**MU's chart (the contract's own stated widest-value case), Y-axis tick text:**
```
["275.95", "475.95", "675.95", "875.95", "1032.27"]
```
Formatted two-decimal prices, not raw floats — the exact defect class reported (`765626`,
`)742186`) does not reproduce.

**Geometric check — no tick clipped at the SVG's left edge, including the widest label:**
```
{
  "svgWidth": 854,
  "yAxisTicks": [
    {"text":"275.95","left":17.19,"right":48},
    {"text":"475.95","left":16.72,"right":48},
    {"text":"675.95","left":16.77,"right":48},
    {"text":"875.95","left":16.97,"right":48},
    {"text":"1032.27","left":13.45,"right":48}
  ],
  "anyNegativeLeft": false
}
```
Every label's left edge is positive (nothing clipped), and every label fits inside the 56px axis
width with margin — `"1032.27"` (7 characters, wider than MU's own `975.26`, since the chart pads
the domain above the data range) still lands at `right: 48` of 56. `width={56}` is confirmed
sufficient, not just asserted.

Also confirmed against the bars fixture using the exact float shape from the bug report
(`332.2699890136719`, Postgres's literal stored value for the reported AAPL case) — rendered
correctly as a formatted price on the chart, not the raw string.

## Human verification — not done by me

Per the contract's own list, items needing either real market hours or eyeballing a live render in
a real (non-headless) browser: switching through all eight ranges to confirm the Y axis stays
readable at each (I verified one range's rendering, not all eight), and the specific claim that
the header's minute "advances by at most one per 10-minute window — not on every reload" during
real market hours, which needs the real backend and real elapsed time to observe.
