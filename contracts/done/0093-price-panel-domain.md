# Contract 0093 — price panel Y domain covers its overlays

**Status:** accepted
**Scope:** frontend only. No backend file may be edited.

## Why

`TickerChart` computes the price panel's Y domain from `adj_close` alone:

```ts
const minimum = Math.min(...prices)
const maximum = Math.max(...prices)
const padding = (maximum - minimum) * 0.08 || 1
```

That was correct when price was the only series on the panel. After contract 0092 the panel also
draws SMA 20/50, and optionally EMA, the Bollinger band and the Donchian channel — none of which are
bounded by the close range.

Measured over 500 simulated one-year random walks, the Bollinger band falls outside that domain in
**47%** of them; Donchian in 1%. When it happens the band is drawn flat against the top or bottom
edge of the panel, and it happens worst at price extremes — precisely where someone is looking to see
how far price has pushed outside the band.

This is a planner error in 0092, not a coder error. 0092 never specified the domain and the existing
line was preserved correctly.

## The subtlety that makes this more than a one-liner

`seriesByKey` is keyed by the **indicator** date axis, which spans ~400 days regardless of what the
user is looking at. `chartData` is built from the **filtered** bars, so an indicator value on a date
outside the visible range is never drawn.

So the domain must be computed from the rendered rows, **not** from `seriesByKey`. Computing it from
`seriesByKey` would mean viewing a one-month window silently scales the panel to the extremes of the
full 400-day indicator history, which is a worse bug than the one being fixed.

## Files

- `frontend/src/lib/chart.ts`
- `frontend/src/lib/chart.test.ts`
- `frontend/src/components/TickerChart.tsx`

Do not edit any other file. Do not edit anything under `backend/`. `reference files/` is read-only.

---

## Criteria

### 1. A pure `priceDomain` helper in `src/lib/chart.ts`

```ts
export const PRICE_PANEL_KEYS = [
  'adj_close',
  'sma_fast',
  'sma_slow',
  'ema_fast',
  'ema_slow',
  'bollinger_upper',
  'bollinger_middle',
  'bollinger_lower',
  'donchian_upper',
  'donchian_mid',
  'donchian_lower',
] as const

export function priceDomain(
  rows: ReadonlyArray<Record<string, unknown>>,
  keys: ReadonlyArray<string> = PRICE_PANEL_KEYS,
  padFraction = 0.08,
): [number, number]
```

Behaviour:

- Scan every row for every key in `keys`; consider a value only when it is a `number` and
  `Number.isFinite` is true. Non-numeric, `null` and `undefined` values are skipped — the warmup
  period of every indicator is null, and `bollinger_band` holds an array, so both must be ignored
  rather than coerced.
- `padding = (max - min) * padFraction || 1` — keep the `|| 1` fallback so a flat series still gets a
  visible span instead of a zero-height domain.
- Return `[min - padding, max + padding]`.
- **If no finite value is found at all, return `[0, 1]`.** Today `Math.min(...[])` returns `Infinity`
  and hands recharts an `[Infinity, -Infinity]` domain; this is a latent crash path being closed
  while the line is already being touched.

**Do not use spread** (`Math.min(...values)`) to compute the extremes. Accumulate in a loop. A
ten-year range is ~2500 rows across eleven keys, and spreading tens of thousands of arguments into a
call is a stack-overflow risk that only appears for the users with the most history.

**Check:** `grep -c "Math.min(\.\.\." frontend/src/lib/chart.ts` returns 0.

### 2. Tests for `priceDomain`

In `frontend/src/lib/chart.test.ts`, a new `describe('priceDomain')` block covering, as separate
`it` blocks:

- **The regression this contract exists for.** Rows whose `adj_close` values are all within
  `[100, 110]` but where one row has `bollinger_lower: 80`. Assert the returned lower bound is
  **strictly below 80**. Asserting it is below 100 would pass against the old broken code and prove
  nothing.
- Symmetrically, a `bollinger_upper: 200` against closes in `[100, 110]` returns an upper bound
  strictly above 200.
- A key that is present with `null` in every row does not affect the result — the domain equals the
  domain computed without that key in `keys`.
- A key absent from `keys` is ignored even when present in the rows: closes in `[100, 110]` plus
  `obv: 5_000_000` on every row, called with `keys: ['adj_close']`, returns an upper bound under 200.
- A flat series (every `adj_close` exactly `100`) returns a domain with a non-zero span.
- `priceDomain([])` returns `[0, 1]`.

**Check:** `npm run test` passes and `grep -c "it(" frontend/src/lib/chart.test.ts` ≥ 10 (the four
`downsample` cases from 0092 plus these six).

### 3. `TickerChart` uses it, against the rendered rows

Replace the `minimum` / `maximum` / `padding` block and the price panel's `domain` prop with a single
call against `renderedData` — the post-downsample array, so the domain describes exactly what is
drawn:

```ts
const priceYDomain = priceDomain(renderedData)
```

`renderedData` is currently derived after those three lines; reorder as needed. The price panel's
`<ChartYAxis domain={priceYDomain} />`.

`ChartYAxis`'s `domain` prop is typed `[number | 'auto', number | 'auto']`, which accepts
`[number, number]` — no type change should be needed. If one is, say so in the report rather than
widening the type silently.

Do not change any other panel's domain. RSI, ADX and Stochastic stay pinned at `[0, 100]` — that is
deliberate, and the reference lines at 70/30, 25 and 80/20 are meaningless if those rescale.

**Check:** `grep -c "priceDomain(" frontend/src/components/TickerChart.tsx` returns exactly 1, and
`grep -c "Math.min(\.\.\.prices)" frontend/src/components/TickerChart.tsx` returns 0.

### 4. Nothing else moves

`points`, `prices`, `chartData`, `renderedData`, `seriesByKey`, `labelsByKey`, `seriesName` and every
panel other than the price panel keep their current behaviour. This contract changes two numbers.

### 5. Verification

- `npx tsc -p tsconfig.app.json --noEmit` — clean. Plain `tsc --noEmit` is vacuous here; do not use it.
- `npm run build` — succeeds.
- `npm run test` — passes, with the new `priceDomain` cases.

You do not need to run `pytest`; no backend file is in scope.

---

## Report

Report in chat, covering:

- the full output of the three commands in criterion 5
- the exact output of each `grep -c` named above
- your `priceDomain` implementation, pasted, so the finite-value filter and the loop are readable
- the two Bollinger regression tests, pasted
- anything you could not do, or did differently, and why

Do not run any git command that writes: no commit, push, merge, rebase, tag, stash, checkout of
another branch, or `gh` write. Gunnar commits.

## What a human still has to look at

1. **Bollinger on, a ticker near a 52-week low** — the lower band curves freely with visible space
   beneath it, rather than running flat along the bottom edge.
2. **Bollinger off** — the price line still fills the panel and has not shrunk into the middle. If
   every ticker now looks zoomed out with bollinger off, the domain is being computed from
   `seriesByKey` instead of the rendered rows.
3. **A one-month date range with Bollinger on** — the panel scales to that month, not to the full
   400-day indicator window. This is the failure mode described at the top of this contract.
