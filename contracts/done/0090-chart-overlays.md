# Contract 0090 — Indicator toggles and chart overlays

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

Six checkboxes on `/ticker/:symbol` draw their indicators — price-scale overlays on the price chart,
oscillators and OBV in their own panes below it.

## Why

The last piece of slice 2. Contract 0088 built the maths, 0089 the endpoint; nothing draws them yet.

**This is also where the numbers finally become checkable.** Signal badges can be wrong invisibly;
Bollinger bands that do not hug the price, or a Donchian channel that misses the highs, are obvious at
a glance. That is worth more than any test in this contract.

## The scale problem — read this before writing any chart code

The six indicators do **not** share a scale, and putting them on one axis produces a chart that looks
broken:

| group | scale | where it goes |
|---|---|---|
| `ema`, `bollinger`, `donchian` | **price** — same units as the stock | **on the price chart** |
| `adx`, `stochastic` | **0–100** | a shared pane below |
| `obv` | **unbounded**, often millions | its own pane below |

Drawing OBV on a $170 stock's axis flattens the price into a line at the bottom and sends OBV off the
top. Drawing ADX there does the reverse. **Three separate Y scales are required**, and the standard
presentation — which the reference follows and which every charting site uses — is a main price panel
with sub-panels beneath it.

Render sub-panes **only when something in them is toggled on**. A user with only Bollinger enabled
sees one chart, not one chart and two empty boxes.

## Files

Modify:
- `frontend/src/api/client.ts` — `getIndicators` and its types.
- `frontend/src/pages/TickerPage.tsx` — the toggles and the fetch.
- `frontend/src/components/TickerChart.tsx` — the overlays and the sub-panes.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**No backend file.** `/universe/{ticker}/indicators` is complete.

**Gunnar hand-styles `TickerPage.tsx`.** Change only what this contract names — do not reformat or
re-indent surrounding markup. `REBUILD.md` records contract 0035, where a contract reverted one of his
hand-edits.

**`reference files/` is read-only and never belongs on a file list.** `main:frontend/components/TechnicalsChart.tsx`
is worth reading for how it panels the oscillators; its colours are Tailwind defaults and must not be
copied.

## Interface

### Client

```ts
export interface IndicatorSeries {
  key: string
  label: string
  points: (number | null)[]
}

export interface IndicatorsResponse {
  ticker: string
  dates: string[]
  series: IndicatorSeries[]
}

export function getIndicators(ticker: string, include: string[]): Promise<IndicatorsResponse>
```

`getIndicators(ticker, [])` returns `{ ticker, dates: [], series: [] }` **without a request**, matching
`getReturns` and `getSignals`. Build the query with `URLSearchParams`; go through `request`.

### Toggles

```tsx
const INDICATOR_GROUPS = [
  { key: 'ema',        label: 'EMA 20/50' },
  { key: 'bollinger',  label: 'Bollinger (20, 2σ)' },
  { key: 'donchian',   label: 'Donchian (20)' },
  { key: 'adx',        label: 'ADX 14' },
  { key: 'stochastic', label: 'Stochastic (14,3)' },
  { key: 'obv',        label: 'OBV' },
] as const
```

A row of checkboxes above the chart, in a card matching the date-range controls. State is a
`Set<string>`, empty by default — **the page opens as it does today**, with price only.

**Unlike contract 0084's signal selector, this one does refetch.** The data genuinely differs per
selection; the endpoint's `include` parameter exists so unrequested indicators are never computed. One
fetch per change, no debounce — each toggle is a deliberate click and the response comes from stored
data.

Add the include set to the existing effect's dependency array as a **stable string**, not the `Set` —
`Array.from(set).sort().join(',')`. A `Set` is a new reference every render and would refetch forever.
That is the same trap `tickerKey` avoids in `HoldingsPage`.

### Chart

`TickerChart` gains one prop:

```tsx
interface TickerChartProps {
  bars: PriceBar[]
  indicators?: IndicatorsResponse
}
```

Optional, so nothing else that renders it breaks.

- **Join on date.** `indicators.dates[i]` aligns with `series[].points[i]`; the bars are a separate
  list and may cover a different range once the user narrows it. Build a date→value map per series
  rather than assuming index alignment with `bars`. Contract 0089 guarantees `points.length ===
  dates.length`, and guarantees nothing about `bars`.
- **`null` points break the line rather than plotting zero.** recharts skips `null` in a `Line` by
  default — do not coalesce to 0. A gap where an indicator has insufficient history is correct;
  a line diving to zero is a lie.
- Price-scale overlays draw on the existing chart as additional `Line`s.
- `adx` and `stochastic` share one sub-pane with a `0–100` domain; `obv` gets its own with an
  auto domain. Each sub-pane is roughly a third the height of the price panel and shares its x-axis
  range.
- Use brand tokens for every line colour. **Do not copy the reference's Tailwind defaults.** Series
  within a group should be visually related — the three Bollinger lines read as one band, not three
  unrelated lines.

## Out of scope

- No candlesticks, no volume bars on the price panel, no crosshair, no zoom, no pan.
- No new indicators beyond the six groups.
- Do not change the date-range behaviour. It stays a client-side filter over already-fetched bars
  (contract 0086); the indicators request is separate and unfiltered.
- Do not add `start`/`end` to the indicators endpoint or any backend file.
- Do not persist the toggle selection across visits.
- Do not change the ATR card, the Signal States panel, or the Holdings page.
- Do not add tests. The 63 `src/lib/` tests must stay untouched and passing.
- No new dependency. `recharts` is present and already split.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
2. `cd frontend && npm run build` exits 0. **Report the main chunk's gzip size and confirm recharts is
   still in a separate chunk.** Main was **108.18 kB** with the shared `AreaChart` chunk at ~100.51 kB.
   A main chunk jumping by ~100 kB means recharts leaked in, which is the most expensive mistake
   available here.
3. `grep -n "recharts" frontend/src/pages/TickerPage.tsx` prints nothing — the page still must not
   import it, not even for a type. The `IndicatorsResponse` type comes from `client.ts`.
4. Reading the diff: the effect depends on a **joined string**, not a `Set` or an array literal. Quote
   the dependency array and the expression that builds it.
5. Reading the diff: `null` points are passed through to recharts, **not** coalesced to `0`. Quote the
   line. `grep -n "?? 0" frontend/src/components/TickerChart.tsx` must print nothing.
6. Reading the diff: the overlays join on **date**, not on array index against `bars`. Quote the join.
7. Reading the diff: sub-panes render **only when a group in them is enabled**. Quote the conditions —
   there must be one for the oscillator pane and one for OBV.
8. `grep -n "getIndicators" frontend/src/api/client.ts` shows the empty-include guard returning
   without a request. Quote it.
9. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
10. `cd frontend && npm run test` exits 0 with **63** tests — unchanged.
11. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; no
    backend file is in scope. It was **508**.
12. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
13. State exactly which files you edited.

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
grep -n "?? 0" frontend/src/components/TickerChart.tsx ; echo "no-zero-coalesce exit: $?"
grep -n "getIndicators" frontend/src/api/client.ts
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
```

## Tooltips — required for any contract adding interactive elements

| element | tooltip label |
|---|---|
| The indicator checkbox row (one on the group label) | `Draw this indicator on the chart` |
| `ADX 14` | `Trend strength from 0 to 100. High means a strong trend in either direction, not a bullish one.` |
| `OBV` | `On-balance volume — cumulative volume added on up days and subtracted on down days.` |

The ADX tooltip matters: **ADX is direction-agnostic** and a high reading is routinely misread as
bullish. Do **not** use the `title` attribute.

## Human verification — does Gunnar need to run anything?

**Yes, and this is the contract where looking at it is the verification.** Four contracts of
numerical work become visible here for the first time.

```bash
cd frontend && npm run dev
```

1. **Bollinger.** The three bands should hug the price, with the middle running through it. If the
   middle is nowhere near the price line, the adjustment or the date join is wrong.
2. **Donchian.** The upper channel should touch the highest highs and the lower the lowest lows over
   the window. It is the easiest overlay to falsify by eye.
3. **EMA 20/50.** Both should track the price, with the 20 reacting faster. If they cross where the
   SMA signal says they do on the Holdings column, two independent paths agree — that is the external
   check the signal engine has been missing.
4. **ADX and Stochastic** appear in their **own pane** below, on a 0–100 axis. If they are drawn on the
   price axis, the price will look flat — that is the scale bug this contract is written to prevent.
5. **OBV** in its own pane, unbounded. On a ticker that has split, this is the one to look at — a
   sudden step at the split date means the volume inversion in contract 0089 is backwards.
6. **Toggle everything off.** The sub-panes disappear and you are back to the price chart alone.
7. **The launch page's network tab** — the recharts chunk must still not load there.
8. Check at 1024px, 1023px and 375px with all six enabled.

**Say what looks wrong.** The layout of the panes is a guess; I have not seen the reference rendered.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
