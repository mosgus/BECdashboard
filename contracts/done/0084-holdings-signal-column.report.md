# Report — Contract 0084 (Holdings Signal column)

**Verdict: accepted.** `PARTIAL` was honest bookkeeping, not an incomplete implementation.

## Verified independently

63 frontend tests, 491 backend, `TSC OK`, lint unchanged. `thirty_day` gone from the page, still
present in `client.ts` — the display changed, the API did not.

**The selector does not refetch**, which was the criterion most worth checking:

```
}, [tickerKey, basisDate])          // effect deps
const [selectedSignal, setSelectedSignal] = useState(...)   // line 44, not in any dep array
```

All three signals arrive in one response and the selector filters what is already there. A
`selectedSignal` in that array would have turned one request into three for no new data.

**The badge treats caution states correctly.** `OVERBOUGHT` and `OVERSOLD` are both
`text-[var(--color-muted)]`, not positive or negative — an overbought reading is "extended", which is
neither a buy nor a sell, and colouring it green because the glyph points up would assert something
the indicator does not say. `BULLISH` and `BEARISH` use brand tokens; no Tailwind defaults were
copied from the reference. An unrecognised state falls through to `EMPTY` rather than throwing.

The header renders `Signal (SMA 20/50)` — the parameters from the response, with a fallback to the
option label when no row has data.

## The missing measurement, supplied

The coder could not give a pre-change bundle size because it did not measure before editing, and said
so rather than inventing one. Contract 0081's report has it: **105.70 kB → 106.35 kB gzip, +0.65 kB**
for a component, a client function and a column. In range.

Worth noting as a criterion-design point: *"report the size before and after"* is only answerable if
the coder happens to build first. Better phrasing is *"report the size after, and state the previous
value from the last contract's report if you did not measure it."*

## The self-corrected typecheck

The first `tsc` run failed on a possibly-undefined `tickerSignals`; the coder fixed the guard and
reran. Reported verbatim, including the failure. That is the reporting standard the contract asks for
and it is easy to quietly omit.

## Status

Accepted and archived. Every Portfolios contract from 0061 onward is now closed.
