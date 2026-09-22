# Contract 0086 — The `/ticker/:symbol` detail page, and the two ways in

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`/ticker/:symbol` shows a price chart over a selectable date range, an ATR card, and a Signal States
panel — reachable from the Universe chart dialog and from a Holdings ticker cell.

## Why

Gunnar's ask, 2026-09-22, modelled on `main:frontend/app/ticker/[symbol]/page.tsx`. **Slice 1 of
two**, his call: this builds the page from data that already exists. The reference's six extra
indicator overlays — EMA, Bollinger, Donchian, ADX, Stochastic, OBV — are **slice 2** and are
explicitly not in this contract.

Everything here is assembly. `/universe/{ticker}/history` has served bars since contract 0021,
`/universe/signals` gained `value` and `atr` in 0085, `SignalBadge` shipped in 0084, and `ChartDialog`
already lazy-loads recharts.

**The planner could not view the reference screenshot.** `reference files/images/Blue Eagle Capital —
Portfolio Dashboard.pdf` cannot be rendered in this environment (no poppler), so this contract is
written from the reference's *source*, which is precise about structure and silent about spacing and
proportion. If the result looks wrong, that is the likely reason, and Gunnar will say so.

## Files

Create:
- `frontend/src/pages/TickerPage.tsx` — the page.
- `frontend/src/components/TickerChart.tsx` — the recharts price chart, lazy-loaded.

Modify:
- `frontend/src/App.tsx` — the route.
- `frontend/src/components/ChartDialog.tsx` — a `More details` link.
- `frontend/src/pages/analysis/HoldingsPage.tsx` — the ticker cell becomes a link.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**No backend file.** `getHistory` and `getSignals` are both sufficient as they stand.

**Gunnar hand-styles `HoldingsPage.tsx`, `ChartDialog.tsx` and `Header.tsx`.** Change only what this
contract names — do not reformat or re-indent surrounding markup. `REBUILD.md` records contract 0035,
where a contract written from a report rather than from disk reverted one of his edits.

**`reference files/` is read-only and never belongs on a file list.** Read `main` in place with
`git show "main:frontend/app/ticker/[symbol]/page.tsx"`. Its colours are Tailwind defaults and must
not be copied; this project uses brand tokens.

## Interface

### Route

```tsx
<Route path="/ticker/:symbol" element={<TickerPage />} />
```

Declared before the `*` catch-all. `:symbol` is uppercased on read — `/ticker/mu` and `/ticker/MU`
are the same page.

### Navigation in

**From `ChartDialog`** — a `More details` link in the dialog's footer area, beside whatever controls
are already there:

```tsx
<Link to={`/ticker/${ticker}?from=/universe`}>More details</Link>
```

A `<Link>`, not a button with `navigate()` — it is navigation and should middle-click and open in a
new tab. Clicking it leaves the dialog; do not also call the dialog's close handler, because
unmounting mid-navigation is a source of React warnings and the route change unmounts it anyway.

**From `HoldingsPage`** — the **ticker cell only** becomes a link, matching the reference:

```tsx
<Link to={`/ticker/${row.ticker}?from=/portfolios/${current.id}/holdings`}>{row.ticker}</Link>
```

**Not the whole row.** A row-wide click target on a table that will gain more controls is a trap, and
the reference links the ticker specifically. The cash row's `CASH` is **not** a link — it is not a
ticker.

### The page

**Data**: `getHistory(symbol)` and `getSignals([symbol])`, both on mount, each with its own
`LoadState` so one failing does not blank the other. The existing pattern in `HoldingsPage`.

**Header**
- Back link reading `?from=`, defaulting to `/universe` when absent. Label it from the path:
  starts with `/portfolios` → `← Portfolio`; otherwise `← Universe`. Do not attempt anything cleverer.
- The ticker, large.
- `As of <newest bar date>` when history loaded, from the last bar.

**Date range** — two `<input type="date">`, `Start` and `End`. Default: one year before today, and
today.

**No Update button, and this is a deliberate departure from the reference.** `getHistory` takes no
date parameters and returns the full stored series, which `ChartDialog` already fetches wholesale. So
the range **filters the already-fetched bars client-side** and the chart re-renders immediately. A
button that triggers nothing would be worse than no button.

If the payload ever becomes a problem, the fix is `start`/`end` parameters on the endpoint — a
backend contract, not a workaround here. Say so in a comment.

**Chart** — `TickerChart`, lazy-loaded exactly as `ChartDialog` does it:

```tsx
const TickerChart = lazy(() => import('../components/TickerChart'))
```

and rendered conditionally, not merely mounted-and-returning-null. `REBUILD.md` records that leaving
a lazy component mounted still fetches the chunk and buys nothing — recharts is 9.3 MB on disk and the
split took the initial bundle from 650 kB to 296 kB. **Do not import recharts anywhere in
`TickerPage.tsx` itself**, including for types.

A single line series of `adj_close` against `date` over the filtered range. Not candlesticks, no
volume, no overlays — those are slice 2.

**ATR card** — `ATR (14)` with the `atr` value from the signals response in price units, formatted
with `formatPrice`, and one muted line: `14-day average of true range (Wilder EWM smoothing).` `—`
when null.

**Signal States panel** — one row per signal from the response:
- the signal's `label` (`SMA 20/50`)
- a short description. Use these, ported from the reference because they are accurate:
  - `sma_cross` — `Bullish when the 20-day SMA crosses above the 50-day SMA. Bearish when it crosses below.`
  - `rsi_threshold` — `Overbought above 70 (potential pullback), oversold below 30 (potential rebound).`
  - `macd_cross` — `Bullish when the MACD line crosses above its signal line. Bearish when below.`
- `<SignalBadge state={...} />`
- `value` when non-null, as `RSI 54.20` / `Histogram -0.0936` — label it by signal, never a bare
  number. `sma_cross` has no value and shows nothing.
- `Last trigger <date>` when non-null; nothing when null.

**Unknown ticker** — history empty *and* signals empty. Render a card:
`No stored data for <SYMBOL>.` with a link back to `/universe`. Do not redirect; a mistyped URL
should say what is wrong. A ticker outside the Universe legitimately lands here.

**Failure** — follow `HoldingsPage`: state the failure above the content, keep whatever did load.
`The chart could not be loaded.` / `Signals could not be loaded.`

## Out of scope

- **No indicator overlays.** EMA, Bollinger, Donchian, ADX, Stochastic and OBV are slice 2 and need
  six new backend indicators with their own tests. Do not add toggles for them either.
- No `trigger_values`, no help sidebar, no news, no fundamentals panel, no add-to-portfolio control.
- No candlesticks and no volume series.
- Do not add date parameters to the history endpoint, or any backend file.
- Do not make the whole Holdings row clickable.
- Do not change `SignalBadge`, `getSignals`, `getHistory`, or the Holdings columns.
- Do not add tests. The 63 `src/lib/` tests must stay untouched and passing.
- No new dependency. `recharts` and `react-router-dom` are both present.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
2. `cd frontend && npm run build` exits 0. **Report the main chunk's gzip size, and confirm recharts
   is still in a separate chunk.** It was `106.35 kB` for the main chunk with `ChartDialog` split out
   at ~103 kB. A main chunk jumping by ~100 kB means recharts leaked into it, which is the single most
   likely serious mistake in this contract.
3. `grep -n "recharts" frontend/src/pages/TickerPage.tsx` prints nothing — the page must not import it,
   not even for a type.
4. `grep -n "lazy(" frontend/src/pages/TickerPage.tsx` prints the lazy import, and reading the diff
   shows the chart is **conditionally rendered**, not always mounted. Quote the condition.
5. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
6. `cd frontend && npm run test` exits 0 with **63** tests — unchanged.
7. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; no
   backend file is in scope. It was **493**.
8. `grep -n "from=" frontend/src/components/ChartDialog.tsx frontend/src/pages/analysis/HoldingsPage.tsx`
   shows both entry points pass a `from` parameter.
9. Reading the diff: the Holdings **ticker cell** is the link, not the row, and the cash row's `CASH`
   is not a link. Quote both.
10. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
11. `git status --porcelain frontend/src/components/Header.tsx` — report what it shows and confirm
    **you** did not edit it. It carries a hand-edit from Gunnar.
12. State exactly which files you created and edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "recharts" frontend/src/pages/TickerPage.tsx ; echo "no-recharts-in-page exit: $?"
grep -n "lazy(" frontend/src/pages/TickerPage.tsx
grep -n "from=" frontend/src/components/ChartDialog.tsx frontend/src/pages/analysis/HoldingsPage.tsx
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/src/components/Header.tsx
```

## Tooltips — required for any contract adding interactive elements

| element | tooltip label |
|---|---|
| `More details` link in `ChartDialog` | `Open the full detail page for this ticker` |
| Holdings ticker link | `Open this ticker's detail page` |
| `Start` / `End` date inputs | `Limit the chart to this date range` |
| `ATR (14)` heading | `Average true range — typical daily price movement. Higher means wider swings.` |
| `Signal States` heading | `Computed from stored closing prices. State reflects the most recent crossover or threshold event.` |

Do **not** use the `title` attribute. Individual badges get no tooltip — they already carry a label.

## Human verification — does Gunnar need to run anything?

**Yes. This is a page, and the planner has not seen the design it is modelled on.**

```bash
cd frontend && npm run dev
```

1. From `/universe`, open a ticker's chart dialog and click **More details**. You land on
   `/ticker/<SYMBOL>?from=/universe` and the back link reads `← Universe`.
2. From a portfolio's Holdings tab, click a **ticker cell**. Same page, back link reads
   `← Portfolio`, and going back returns you to the Holdings tab you came from.
3. Confirm clicking elsewhere in a Holdings row does **nothing** — only the ticker is a link.
4. **Change the Start date.** The chart narrows immediately, with no network request — the range is a
   client-side filter over bars already fetched.
5. Check the **Signal States** panel against the Holdings Signal column for the same ticker. They read
   the same endpoint and must agree. The RSI row now shows its number, which is what you could not see
   when you asked whether all-Neutral was correct.
6. Visit `/ticker/ZZZZ` directly. You should get *"No stored data for ZZZZ"* with a link back — not a
   blank page and not a crash.
7. **Open the launch page `/` and check the network tab: the recharts chunk must not load.** It is
   lazy-split deliberately, and a regression here costs every visitor ~100 kB for a chart they never
   open.
8. Check at 1024px, 1023px and 375px.

**Say what looks wrong.** The layout was written from source, not from your screenshot — proportions,
ordering and density are guesses and are cheap to change.

## Open questions — do not resolve these yourself

None. The slicing was decided by Gunnar on 2026-09-22. If you find another, report `BLOCKED` and stop.
