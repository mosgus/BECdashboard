# Report — Contract 0092 (/ticker chart parity)

**Verdict: accepted.** All twelve criteria met. I re-ran every check myself rather than reading the
coder's numbers.

## Independently re-run

```
npx tsc -p tsconfig.app.json --noEmit   clean
npm run test                            5 files, 67 tests passed
npm run build                           built, recharts still a separate chunk
                                        (CartesianChart-*.js 349 kB, split from index)
```

The chunk split matters beyond this contract: adding six panels to `TickerChart` did not pull
recharts into the main bundle, so the launch page still does not pay for it.

Greps, all run against `frontend/src/components/TickerChart.tsx`:

```
<Area               2      <Bar                1      <Legend             1
<CartesianGrid      6      fill="white"        0      showOscillatorPane  0
downsample(         1      <Tooltip            6      <Tooltip content=   6
```

`<Tooltip>` = `<Tooltip content=` at 6 each — no bare default tooltip survived, which was the point
of writing that criterion as an equality between two counts rather than as a fixed number.

The `<Bar>` binds `macd_histogram`, not `macd_signal`:

```tsx
{seriesByKey.has('macd_histogram') && <Bar dataKey="macd_histogram" name={seriesName('macd_histogram')} fill="var(--color-muted)" radius={[1, 1, 0, 0]} isAnimationActive={false} />}
```

## downsample verified beyond its tests

The test asserts the last row survives for one input length. I checked every length from 401 to 4000:

```
last element retained for every n : true
max output length, n=401..4000    : 401 (at n=800)
```

The final bar is never dropped at any length — that was the criterion that mattered, because a
truncated right edge reads as stale data rather than as a bug.

The cap overshoots by exactly one row at `n = 800`: `step = 2` selects 400 even indices and then the
odd final index is appended. Harmless — it is a render-cost guard, not a data path — and noted only
so nobody later reads `MAX_CHART_POINTS` as a hard ceiling.

## The one thing I got wrong

**I never specified the price panel's Y domain, and the overlays it now draws do not fit inside it.**

The domain is still `[min(adj_close) - pad, max(adj_close) + pad]` with `pad = 8%` of the range —
correct when price was the only thing on the panel, which is what it was when I wrote 0092's file
list. The coder preserved it correctly; nothing in the contract said otherwise.

Bollinger is 2σ around a 20-day mean and routinely sits outside a range derived from closes alone.
Simulated over 500 one-year random walks:

```
Bollinger leaves the price-derived Y domain : 234 / 500  (47%)
Donchian  leaves the price-derived Y domain :   4 / 500  ( 1%)
```

Roughly half the time the band is flat-topped or flat-bottomed against the edge of the panel,
exactly where it is most worth reading — a band clipped at a 52-week low is clipped precisely at the
moment someone is looking to see how far price has pushed outside it. Donchian is effectively fine,
which fits: it is built from highs and lows that the 8% padding mostly absorbs.

Fixed in 0093 by widening the domain to cover whichever overlays are enabled.

## Contract-to-outcome notes

- Criterion 4 asked for the backend `label` to drive legend and tooltip names. The coder added a
  `seriesName(key)` helper with a key fallback and used it on every series. The legend now reads
  "SMA 20", not `sma_fast`.
- Criterion 5's null guard is present and correct: `bollinger_band` is `[lower, upper]` only when
  both are numbers, otherwise `null`, so the 19-bar warmup is a gap and not a wedge from zero.
- The ranged `<Area>` carries `legendType="none"`, so the band does not add a legend entry
  duplicating the Bollinger middle line.
- No report file was written; the coder reports in chat by role. This file is the planner's record,
  as with every prior contract.
- I could not re-run `pytest` this session — the sandbox blocks the Python interpreter. The coder
  reported 512 passing. 0092's file list contains no backend path, and the four modified backend
  files are exactly 0091's known, still-uncommitted set.

## What still needs a human

Unchanged from the contract, and none of it is reachable by grep:

1. Dark mode with Bollinger on — a translucent strip, not an opaque block.
2. The first ~20 bars — no wedge growing from the panel floor.
3. A 10-year range — the right edge reaches today.
4. MACD — bars cross zero exactly where the two lines cross each other.
5. A ticker with under 50 bars — RSI and MACD panes render empty, not missing.
6. ~800px wide — RSI and MACD stack.
