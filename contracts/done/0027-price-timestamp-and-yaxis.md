# Contract 0027 — Quote timestamp in the Price header, and fix the chart's Y axis

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The `Price` column header shows when the displayed price was captured, and the chart's Y axis shows
prices instead of clipped raw floats.

## Why

**Two unrelated defects, batched because both are small.**

**1. The chart's Y-axis labels are raw floats.** `ChartDialog.tsx:223-229` declares `YAxis` with
**no `tickFormatter`** and `width={44}`. Postgres stores `332.2699890136719`, recharts renders that
string verbatim, and 44px cannot hold seventeen characters — so the labels overflow left out of the
SVG and the visible fragment is meaningless. Observed on AAPL: four ticks reading `765626` and one
reading `)742186`, on a stock that has never traded above $1,000. The X axis got a `tickFormatter`
(line 217); the Y axis was missed. `formatPrice` is already imported at line 6.

**2. The Price column gives no indication of freshness.** Gunnar asked for the header to show when
`Update all` was last pressed — **but that is not what determines the price.** Contract 0024
refreshes quotes lazily on *any* `GET /universe` when the market is open and the stored quote is
over 10 minutes old, so a plain page reload updates the price with no button press. Labelling the
header with a button-press time would misattribute a fresher number to a staler event.

The honest value is **when the displayed quote was captured**, which is true however the refresh was
triggered. That is `ticker_quotes.fetched_at`, and it is **not currently exposed** — the
`fetched_at` already on `UniverseEntry` is the *fundamentals* timestamp. This is the gap `REBUILD.md`
records after contract 0025.

**Use `fetched_at`, not `as_of`.** Measured 2026-09-15: `fetched_at` is identical across all tickers
(one batched request) while `as_of` is each ticker's last *trade* and varies — BYDDF's was 21 minutes
older than AAPL's, because it is thinly traded. A **column header is one value for every row**, so it
must use the uniform one. Per-ticker `as_of` would belong in a cell tooltip, which is out of scope.

**Depends on contracts 0024 and 0026.** If `ticker_quotes` does not exist, stop and report `BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.**

## Files

Modify:
- `backend/app/schemas.py` — one field on `UniverseEntry`
- `backend/app/universe.py` — surface it
- `backend/tests/test_universe.py`
- `frontend/src/api/client.ts` — the type
- `frontend/src/components/UniverseTable.tsx` — the header
- `frontend/src/components/ChartDialog.tsx` — the Y axis

**Touch nothing else.** Do not modify `app/cache.py`, `app/quotes.py`, `app/market_data.py`,
`app/freshness.py`, `app/models.py`, `app/export.py`, `app/routers/`, any migration,
`tests/conftest.py`, `UniversePage.tsx`, `FilterDialog.tsx`, `Tooltip.tsx`, `lib/`, or
`globals.css`. **No migration** — the column already exists on `ticker_quotes`. No new dependencies.

## Interface

### Backend — one field

```python
quote_fetched_at: datetime | None   # when the displayed quote was captured; null when none
```

- Comes from `ticker_quotes.fetched_at` for that ticker.
- `null` when no quote is stored, **and** `null` whenever `current_price` is `null` — the two must
  agree. A timestamp beside a price that is not a quote is a lie about what is on screen.
- Joined in the **same query** as the existing quote read. `list_all`'s query count must not grow;
  contract 0008's counting test still applies.
- `UniverseDetail` inherits it. Do not redeclare.

### Frontend — the header

```
Price @ 3:10 PM     ← any row has current_price (market open, quote fresh)
Price @ close       ← every current_price is null
```

- Render `quote_fetched_at` in **America/New_York** via `toLocaleTimeString('en-US', { timeZone:
  'America/New_York', hour: 'numeric', minute: '2-digit' })`. The stored value is UTC; the user
  thinks in market time.
- **This is formatting, not market-hours logic.** Do not compute whether the market is open in
  TypeScript — decide purely from whether any row has a non-null `current_price`, which the backend
  already determined. Contract 0025's prohibition still stands.
- The `@ …` portion is smaller and muted (`text-[10px]` or `text-xs`, `text-[var(--color-muted)]`),
  on the same line as `Price`, right-aligned with the column.
- If `quote_fetched_at` is null on every row, fall back to `Price @ close`.

### Frontend — the Y axis

```tsx
<YAxis
  domain={[yMin - yPad, yMax + yPad]}
  tickFormatter={(value: number) => formatPrice(value)}
  width={56}
  ...
/>
```

- `tickFormatter` is the fix. `formatPrice` is already imported.
- `width={44}` → **56**, enough for `5094.05` at `fontSize: 10`. Verify against the widest value in
  the real universe (MU, ~975) and report the number you land on.
- Change nothing else about the chart — not the domain, the padding, the line, the area, or the
  X axis.

## Tooltips

| element | copy |
|---|---|
| Price column header | `Price as of the last quote fetch; refreshes at most every 10 minutes while the market is open` |

Use the project `Tooltip`. The existing per-cell Price tooltips from contracts 0025 and 0026 stay
unchanged.

## Out of scope

- No per-ticker `as_of` display. Header only, one uniform value.
- No auto-refresh, countdown, or "updated N minutes ago" relative time.
- No migration — `fetched_at` already exists on `ticker_quotes`.
- No change to quote refresh timing, the TTL, or market-hours logic.
- No other chart changes.
- No new dependencies.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 182.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
3. `npm run build` succeeds.
4. `grep -n "tickFormatter" frontend/src/components/ChartDialog.tsx` matches on **both** axes.
   Quote both lines.
5. `grep -n "width=" frontend/src/components/ChartDialog.tsx` shows the `YAxis` width is no longer
   44.
6. A test asserts `quote_fetched_at` is `null` whenever `current_price` is `null` — the two agree.
7. A test asserts `quote_fetched_at` is populated when a fresh quote exists.
8. `list_all`'s query count is unchanged — contract 0008's counting test still passes.
9. `ls backend/migrations/versions/` shows exactly **four** revisions — no migration added.
10. `grep -rnE 'getHours|getDay|market.?open' frontend/src/` matches nothing (exit 1) — no
    market-hours logic on the client. (`America/New_York` in a formatter is not market-hours logic.)
11. `git diff --stat backend/app/cache.py backend/app/quotes.py backend/app/market_data.py backend/app/models.py backend/app/routers/ frontend/src/pages/ frontend/src/lib/ frontend/package.json`
    is empty.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
grep -n "tickFormatter" frontend/src/components/ChartDialog.tsx
grep -n "width=" frontend/src/components/ChartDialog.tsx
grep -n "quote_fetched_at" backend/app/schemas.py backend/app/universe.py frontend/src/api/client.ts
ls -1 backend/migrations/versions/
grep -rnE 'getHours|getDay|market.?open' frontend/src/ ; echo "exit=$? (1 means clean)"
git diff --stat backend/app/cache.py backend/app/quotes.py backend/app/market_data.py backend/app/models.py frontend/src/pages/ frontend/src/lib/ frontend/package.json ; echo "(empty = untouched)"
```

## Human verification — does Gunnar need to run anything?

**Yes, and the Y-axis half can be checked immediately regardless of market state.**

1. **Open any chart.** The Y axis must read prices — `280.00`, `300.00`, `320.00` — not `765626`,
   and nothing clipped at the left edge. Check AAPL specifically; that is the reported case.
2. Switch through all eight ranges; the axis stays readable at each.
3. **Market closed:** the Price header reads `Price @ close`.
4. **During market hours:** it reads `Price @ 3:10 PM` or similar, in Eastern time, and the minute
   advances by at most one per 10-minute window — not on every reload.
5. Hover the header → the tooltip explains the 10-minute refresh.

## Open questions — do NOT resolve these yourself

- **Per-ticker `as_of` in a cell tooltip.** BYDDF's last trade can be 20+ minutes older than AAPL's;
  surfacing that per row is a real idea and a separate contract.
- **Relative time** ("updated 4 minutes ago") instead of a clock time. Undecided.
- **Whether the header should show a date as well** when the quote is from a previous session.
