# Contract 0092 — /ticker chart parity

**Status:** accepted
**Scope:** frontend only. No backend file may be edited.

## Why

Contract 0091 made the backend able to serve SMA, RSI, MACD, Donchian mid and Full stochastic.
Nothing draws them. The reference app's `/ticker` page shows SMA 20/50 on the price panel and RSI
and MACD panes **always**, with reference lines, a legend and panel titles. Ours shows none of that
and has no legend, no titles, no grid, and a tooltip that can only display one number.

This contract draws what 0091 already serves. **No new backend series are needed** — every key below
exists today.

## The exact series keys

Read from `backend/app/routers/universe.py` lines 404-434. Use these verbatim; do not invent
`sma20`-style names:

| `include` group | keys |
|---|---|
| `sma` | `sma_fast`, `sma_slow` |
| `ema` | `ema_fast`, `ema_slow` |
| `bollinger` | `bollinger_upper`, `bollinger_middle`, `bollinger_lower` |
| `donchian` | `donchian_upper`, `donchian_mid`, `donchian_lower` |
| `rsi` | `rsi` |
| `macd` | `macd_line`, `macd_signal`, `macd_histogram` |
| `adx` | `adx` |
| `stochastic` | `stochastic_k`, `stochastic_d` |
| `obv` | `obv` |

Every series in the response also carries a `label` string (e.g. `"SMA 20"`, `"Histogram"`). **Use
that label for legend and tooltip names.** Do not hardcode display names in the component — the
backend is already the single source for them, and hardcoding creates two places to disagree.

## Two places the reference is wrong for us — do not copy it

**1. The Bollinger band fill.** `git show main:frontend/components/TechnicalsChart.tsx` draws the band
as two stacked `<Area>`s where the lower one has `fill="white" fillOpacity={1}`, painting over the
upper one's fill to leave only the strip between them. That hack assumes a white page background.
**We have a dark theme.** Copied literally it paints an opaque white rectangle from the lower band
down to the bottom of the price panel in dark mode. Criterion 5 forbids it and specifies a real
ranged area instead.

**2. Per-series downsampling.** The reference downsamples each series independently, so a 2500-point
price array and a 2500-point RSI array can select different dates and silently misalign. Our data is
already merged onto one row array keyed by date, so **downsample once, after the merge** — every
series keeps the same x-values by construction.

## Files

- `frontend/src/lib/chart.ts` — **new**
- `frontend/src/lib/chart.test.ts` — **new**
- `frontend/src/components/TickerChart.tsx`
- `frontend/src/pages/TickerPage.tsx`

Do not edit any other file. Do not edit anything under `backend/`. `reference files/` is read-only.

---

## Criteria

### 1. SMA, RSI and MACD are always requested, and are not toggles

In `TickerPage.tsx`, add above the component:

```ts
const ALWAYS_ON_INDICATORS = ['sma', 'rsi', 'macd'] as const
```

The request must be the union of that constant and the user's toggles. Replace the `indicatorKey`
derivation and the call so that:

```ts
const indicatorKey = Array.from(new Set([...ALWAYS_ON_INDICATORS, ...enabledIndicators])).sort().join(',')
```

and the effect calls `getIndicators(symbol, indicatorKey.split(','))` — the `indicatorKey === ''`
branch is now unreachable and must be removed from the call site. Leave the `include.length === 0`
early return inside `client.ts#getIndicators` alone; it is still correct for other callers.

`INDICATOR_GROUPS` must **not** gain `sma`, `rsi` or `macd` entries — these are always on, so a
checkbox for them would be a checkbox that does nothing.

**Check:** `grep -c "ALWAYS_ON_INDICATORS" frontend/src/pages/TickerPage.tsx` ≥ 2, and
`grep -c "key: 'sma'\|key: 'rsi'\|key: 'macd'" frontend/src/pages/TickerPage.tsx` returns 0.

### 2. `downsample` exists in `src/lib/` with tests

`frontend/src/lib/chart.ts`:

```ts
export const MAX_CHART_POINTS = 400

export function downsample<T>(rows: T[], maxPoints = MAX_CHART_POINTS): T[] {
  if (rows.length <= maxPoints) return rows
  const step = Math.ceil(rows.length / maxPoints)
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1)
}
```

`frontend/src/lib/chart.test.ts` must cover, as separate `it` blocks:

- an array of 10 with `maxPoints = 400` is returned **by reference** (`toBe`, not `toEqual`) — no
  copy is made in the common case
- an array of 2500 with `maxPoints = 400` returns `length <= 400`
- for that same 2500 case, the **last element of the input is the last element of the output**. This
  is the criterion that matters: dropping the final bar silently truncates the chart's right edge,
  which looks like stale data rather than like a bug.
- `downsample([], 400)` returns `[]`

**Check:** `npm run test` passes and `grep -c "it(" frontend/src/lib/chart.test.ts` ≥ 4.

### 3. `TickerChart` downsamples the merged rows, once

`TickerChart.tsx` builds `chartData` by merging bars and indicator values by date. Apply
`downsample` to that merged array exactly once, after the merge, and render every panel from the
downsampled array.

**Check:** `grep -c "downsample(" frontend/src/components/TickerChart.tsx` returns exactly 1.

### 4. The price panel draws SMA 20/50, has a legend, a grid, and a title

Price panel changes:

- `TickerChart` takes a new required `ticker: string` prop; `TickerPage` passes `symbol`.
- A panel heading above the chart reading `` `${ticker} — Price & Moving Averages` ``.
- `<CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />` on every panel.
- `<Legend />` on the price panel only.
- Two new always-drawn lines, **conditioned on the key being present** (they are absent during the
  request and for a ticker with under 50 stored bars):
  - `sma_fast` — `stroke="var(--color-accent)"`, `strokeWidth={1.5}`, `strokeDasharray="4 2"`
  - `sma_slow` — `stroke="var(--color-negative)"`, `strokeWidth={1.5}`, `strokeDasharray="6 3"`
- Every `<Line>` and `<Area>` on every panel gets `name={...}` taken from that series' backend
  `label` (fall back to the key if the label is missing). The price area's name is `"Price"`.

Without `name`, the legend renders raw keys like `sma_fast`, which is why this is not optional.

**Check:** `grep -c "<CartesianGrid" frontend/src/components/TickerChart.tsx` ≥ 5 and
`grep -c "<Legend" frontend/src/components/TickerChart.tsx` returns exactly 1.

### 5. Bollinger renders as one shaded band, with no white fill anywhere

When building `chartData`, add a field:

```ts
point.bollinger_band =
  typeof lower === 'number' && typeof upper === 'number' ? [lower, upper] : null
```

and render it as a **single** ranged area:

```tsx
{seriesByKey.has('bollinger_upper') && (
  <Area type="monotone" dataKey="bollinger_band" stroke="none" fill="var(--color-muted)" fillOpacity={0.14} dot={false} isAnimationActive={false} legendType="none" name="Bollinger (20, 2σ)" />
)}
```

Keep the `bollinger_middle` line. Delete the separate `bollinger_upper` and `bollinger_lower`
`<Line>` elements — the band's edges are its own boundary.

The `null` in the warmup period matters: the first 19 bars have no band, and a band that collapses to
`[0, 0]` there would draw a filled wedge from zero, which reads as a real feature of the data.

**Check:** `grep -c 'fill="white"' frontend/src/components/TickerChart.tsx` returns 0, and
`grep -c "<Area" frontend/src/components/TickerChart.tsx` returns exactly 2 (the price area and the
Bollinger band).

### 6. Donchian draws its mid line

Add a `donchian_mid` line alongside the existing upper and lower:
`stroke="var(--color-positive)"`, `strokeWidth={1.1}`, `strokeDasharray="2 2"`.

**Check:** `grep -c "donchian_mid" frontend/src/components/TickerChart.tsx` ≥ 1.

### 7. An always-visible RSI pane with 70/30 reference lines

Below the price panel, in a `<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">`, an RSI panel
titled `RSI (14)`, height `h-[12rem]`:

- Y domain fixed `[0, 100]` — never `['auto','auto']`. An auto domain rescales per ticker and makes
  70 and 30 land in different places on different charts, which destroys the only thing the pane is
  for.
- `<ReferenceLine y={70} stroke="var(--color-negative)" strokeDasharray="4 2" label={{ value: 'OB 70', fontSize: 10 }} />`
- `<ReferenceLine y={30} stroke="var(--color-positive)" strokeDasharray="4 2" label={{ value: 'OS 30', fontSize: 10 }} />`
- a `rsi` line.

The pane renders whenever `chartData` is non-empty, **not** gated on a toggle. If `rsi` values are
all null (insufficient history) the pane still renders, empty — a missing pane and an indicator with
no data look identical to the user, and only one of them is a bug.

**Check:** `grep -c "OB 70" frontend/src/components/TickerChart.tsx` ≥ 1 and
`grep -c "OS 30" frontend/src/components/TickerChart.tsx` ≥ 1.

### 8. An always-visible MACD pane with histogram bars and a zero line

The second cell of that grid: a panel titled `MACD (12, 26, 9)`, height `h-[12rem]`, auto Y domain:

- `<ReferenceLine y={0} stroke="var(--color-border)" />`
- `<Bar dataKey="macd_histogram" fill="var(--color-muted)" radius={[1, 1, 0, 0]} isAnimationActive={false} />` — import `Bar` from recharts
- `macd_line` — `stroke="var(--color-primary)"`, `strokeWidth={1.5}`
- `macd_signal` — `stroke="var(--color-accent)"`, `strokeWidth={1.5}`, `strokeDasharray="4 2"`

Declare the `<Bar>` **before** the two `<Line>`s so the bars paint underneath.

`macd_histogram` is `macd_line - macd_signal` and is verified exact in the backend. It must be the
`<Bar>`; `macd_signal` must be a `<Line>`. Both oscillate around zero, so swapping them produces a
chart that looks entirely plausible and is wrong.

**Check:** `grep -c "<Bar" frontend/src/components/TickerChart.tsx` returns exactly 1, and the line
matching `<Bar` also contains `macd_histogram`.

### 9. ADX and Stochastic get separate panes

They currently share one 0-100 pane. Split them into two independently-toggled panels, in this order
after the RSI/MACD grid, each full width and `h-[12rem]`:

- `ADX (14) — Trend Strength`, rendered when `adx` is present. Domain `[0, 100]`.
  `<ReferenceLine y={25} stroke="var(--color-accent)" strokeDasharray="4 2" label={{ value: 'Trending 25', fontSize: 10 }} />`
- `Stochastic (14, 3, 3)`, rendered when `stochastic_k` is present. Domain `[0, 100]`, lines
  `stochastic_k` and `stochastic_d`, reference lines at 80 (`OB 80`) and 20 (`OS 20`).

They cannot share a pane: 80/20 is meaningless for ADX and 25 is meaningless for the stochastic, so a
shared pane would draw four lines of which two are actively misleading for whichever series the
reader is looking at. Remove `showOscillatorPane`.

**Check:** `grep -c "showOscillatorPane" frontend/src/components/TickerChart.tsx` returns 0, and
`grep -c "Trending 25" frontend/src/components/TickerChart.tsx` ≥ 1.

### 10. The OBV pane gains a title and grid

Keep its behaviour and the `M` tick formatter. Title `On-Balance Volume (OBV)`, gated on `obv` as
today, height `h-[12rem]`.

### 11. The tooltip shows every series, not just the first

`ChartTooltip` today reads `payload?.[0]?.value` and renders one number. The price panel will now
carry up to eight series; showing only the first is wrong on every panel in this contract.

Rewrite it to render one row per `payload` entry that has a numeric `value`, each showing that
entry's `name` and its value, coloured with the entry's `color`. It takes a `format` prop:

- price panel — `formatPrice`
- RSI, MACD, ADX, Stochastic panes — `(v: number) => v.toFixed(2)`
- OBV pane — `(v: number) => \`${(v / 1_000_000).toFixed(1)}M\``

Every panel must use `<Tooltip content={<ChartTooltip format={...} />} />`. The bare `<Tooltip />`
calls on the oscillator and OBV panes today are unstyled defaults and must go.

**Check:** `grep -c "<Tooltip content=" frontend/src/components/TickerChart.tsx` equals
`grep -c "<Tooltip" frontend/src/components/TickerChart.tsx` — i.e. no bare `<Tooltip />` survives.

### 12. Verification

- `npx tsc -p tsconfig.app.json --noEmit` — clean. Plain `tsc --noEmit` is vacuous here; do not use it.
- `npm run build` — succeeds.
- `npm run test` — passes, with the new `chart.test.ts` cases.
- `cd backend && pytest` — still 512 passing. No backend file is touched by this contract; this only
  confirms that.

---

## Report

Write `contracts/0092-ticker-chart-parity.report.md` covering:

- the full output of the four commands in criterion 12
- the exact output of each `grep -c` named above, as a list
- the line of your `<Bar ... />` element, pasted, so the `macd_histogram` binding is readable
- your `bollinger_band` construction, pasted, so the null guard is readable
- anything you could not do, or did differently, and why

Do not run any git command that writes: no commit, push, merge, rebase, tag, stash, checkout of
another branch, or `gh` write. Gunnar commits.

## What a human still has to look at

Neither a typecheck nor a grep can see a rendered page. After this lands, Gunnar should check:

1. **Dark mode, Bollinger on** — the band is a soft translucent strip hugging price. Any opaque
   rectangle means the reference's white-fill hack survived.
2. **The first ~20 bars with Bollinger on** — no wedge growing from the bottom of the panel.
3. **A 10-year date range** — the price line stays smooth and the chart's right edge reaches today.
   A truncated right edge means downsampling dropped the last row.
4. **MACD** — the bars cross zero where the blue and orange lines cross each other. If the bars cross
   zero somewhere else, the histogram and signal are swapped.
5. **A newly added ticker with under 50 bars** — RSI and MACD panes render empty rather than
   disappearing or throwing.
6. **Narrow window (~800px)** — RSI and MACD stack instead of squeezing side by side.
