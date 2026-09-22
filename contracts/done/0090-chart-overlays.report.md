# Report — Contract 0090 (Chart overlays and toggles)

**Verdict: accepted.** 63 frontend, 508 backend, no deviations.

## The four traps were all avoided

**Bundle.** Main `108.18 → 108.67 kB`, +0.49 kB. Recharts stays split at 100.64 kB — the chunk is now
named `CartesianChart` rather than `AreaChart` because more of the library is reachable, which is
naming, not leakage. `grep "recharts"` in `TickerPage.tsx` is empty.

**Stable dependency.** `Array.from(enabledIndicators).sort().join(',')` with deps
`[symbol, indicatorKey]`. A `Set` in that array would be a new reference every render and refetch
forever — the trap `tickerKey` avoids in `HoldingsPage`.

**Date join, not index.** `valuesByDate.set(date, …)` then `valuesByDate.get(bar.date)`. The bars and
the indicator series are independent lists once the date range narrows; joining on index would have
drawn every overlay shifted and looked almost right.

**Gaps preserved.** `grep "?? 0"` is empty. Both coalesces are `?? null` — an absent date and a null
point both become `null`, which recharts skips. A line diving to zero where an indicator lacks history
would have been a lie that looked like data.

Sub-panes are conditional on their own groups:

```ts
const showOscillatorPane = seriesByKey.has('adx') || seriesByKey.has('stochastic_k')
const showObvPane = seriesByKey.has('obv')
```

## What this completes

The `/ticker` page, both slices — contracts 0086 and 0088-0090 — and with it every indicator the
reference page offers, minus the ones it never actually computed.

**Slice 2 also closes the validation gap that had been open since 0082.** The signal engine had no
external check: a systematically wrong crossover would pass every test. Now EMA 20/50 is drawn on the
same chart the SMA signal is computed from, so if the lines cross where the Holdings column says they
do, two independent paths agree. That check costs a glance and does not require TradingView.

## Status

Accepted and archived.
