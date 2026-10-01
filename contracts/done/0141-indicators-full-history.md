# Contract 0141 — Compute ticker-page indicators over the full stored history

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

`GET /universe/{ticker}/indicators` returns series for **every stored bar**, not only the last 400
calendar days. On `/ticker/:symbol`, choosing a start date earlier than about a year ago then shows
SMA, EMA, Bollinger and every other overlay across the whole visible range.

## Why

The endpoint filters its query to `PriceBar.date >= today - timedelta(days=SIGNAL_WINDOW_DAYS)`.
`SIGNAL_WINDOW_DAYS = 400` belongs to the signals endpoint. `REBUILD.md` records it as the window a
50-day crossover needs, and it was borrowed here by mistake. The ticker page fetches history once
(stored bars back to `HISTORY_START`, 2020-01-01) and filters by the date picker on the client
(`TickerPage.tsx`, "History is intentionally fetched once"). So the price line reaches back to 2020,
but the indicator series stop around 400 days back, and later still once each indicator's warm-up
(20 bars for Bollinger, for example) is used up. That's the "indicators start on Oct 1" Gunnar saw.

Computing over the full stored history also makes warm-up correct at every start date: a 200-day SMA
has values from the 200th stored bar onward, whatever range is displayed.

## Files

Modify:
- `backend/app/routers/universe.py`: `get_indicators` only.
- `backend/tests/test_api_universe.py`: add one test, below the existing `get_indicators` tests.

**Touch nothing else.** In particular, the signals endpoint, `SIGNAL_WINDOW_DAYS` itself,
`indicators.py`, `bars.py`, and every frontend file stay unchanged. If the work appears to require
editing any other file, stop and report `BLOCKED` instead.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

No signature or response-shape change. In `get_indicators`:

1. Delete the line `today = datetime.now(ZoneInfo("America/New_York")).date()`. Nothing else in the
   function uses it.
2. Replace the two-argument `.where(...)` with a single condition:
   `.where(PriceBar.ticker == ticker.upper())`. Keep `.order_by(PriceBar.date)`.

Do **not** remove the `datetime`, `ZoneInfo` or `timedelta` imports. Other functions in the file use
them. Do **not** add `start`/`end` query parameters. The page filters on the client by design.

## Out of scope

- The signals endpoint and its `window_start = today - timedelta(days=SIGNAL_WINDOW_DAYS)` line. It
  is correct as is.
- Server-side date-range parameters, response compression, or caching of indicator results.
- Any frontend change, including `SeriesChart.tsx` and `TickerPage.tsx`.
- Reformatting unrelated code.

## Acceptance criteria

1. `grep -c "SIGNAL_WINDOW_DAYS" backend/app/routers/universe.py` prints `2`: the definition and
   the signals use.
2. `grep -c "window_start = today - timedelta(days=SIGNAL_WINDOW_DAYS)" backend/app/routers/universe.py`
   prints `1`. The signals window is untouched.
3. `sed -n '/^def get_indicators/,/^@router/p' backend/app/routers/universe.py | grep -c "timedelta\|today"`
   prints `0`.
4. A new test `test_get_indicators_covers_bars_older_than_the_signal_window` seeds exactly these bars
   with `_add_indicator_bars`:

   ```python
   start = date.today() - timedelta(days=600)
   bars = [
       (start + timedelta(days=index), 102.0 + index, 98.0 + index, 100.0 + index, 100.0 + index, 100)
       for index in range(25)
   ]
   ```

   It then requests `/universe/OLD/indicators?include=bollinger` (ticker `"OLD"`) and asserts:
   - status 200
   - `body["dates"][0] == start.isoformat()` and `len(body["dates"]) == 25`
   - for the series with key `bollinger_middle`, `points[18] is None` and
     `points[19] == pytest.approx(109.5)`. The mean of closes 100.0 through 119.0 is 109.5.

   Before the change, this test fails: every bar is older than 400 days, so `dates` is empty. Say in
   the report whether you saw it fail before applying the change. You don't have to, but if you did,
   paste that output too.
5. Every existing test in `backend/tests/test_api_universe.py` passes **unmodified**.
6. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest` passes in full.

If any criterion cannot be met as written, report `BLOCKED` and say which one. Don't find a clever
way to pass it.

## Verification to run and paste

Paste the **complete, verbatim** output, including failures. State which files you edited.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -c "SIGNAL_WINDOW_DAYS" backend/app/routers/universe.py
grep -c "window_start = today - timedelta(days=SIGNAL_WINDOW_DAYS)" backend/app/routers/universe.py
sed -n '/^def get_indicators/,/^@router/p' backend/app/routers/universe.py | grep -c "timedelta\|today"
cd backend
PATH="$PWD/.venv/bin:$PATH" pytest -q tests/test_api_universe.py -k indicators
PATH="$PWD/.venv/bin:$PATH" pytest -q
```

## Tooltips

No new interactive elements.

## Human verification — does Gunnar need to run anything?

**Run the app and look at a ticker.** Restart the backend first, because a process started without
`--reload` keeps serving the old window:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

Open http://localhost:5173/ticker/SPY (or any universe ticker). Set the start date to 2022-01-01 and
turn on SMA, EMA and Bollinger. Every overlay should run across the full range. A 200-day SMA starts
about 200 trading days after the first stored bar (early 2020), not in late 2025.

## Open questions

None. If a case isn't covered above, report `BLOCKED`. Don't guess.
