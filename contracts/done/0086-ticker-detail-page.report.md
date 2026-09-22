# Report — Contract 0086 (Ticker detail page)

**Verdict: accepted.** 63 frontend, 493 backend, lint clean.

## The bundle criterion held, and the chunking improved

```
index      364.50 kB │ gzip: 108.18 kB     (was 106.35 — +1.83 kB)
AreaChart  345.20 kB │ gzip: 100.51 kB     ← recharts, still split
ChartDialog  9.61 kB │ gzip:   3.19 kB
TickerChart  1.36 kB │ gzip:   0.72 kB
```

`grep "recharts" TickerPage.tsx` is empty and the chart is conditionally mounted on
`history.status === 'ready' && chartBars.length > 0` — not mounted-and-returning-null, which
`REBUILD.md` records as buying nothing.

Worth noting the chunk **restructured**: `ChartDialog` fell from ~103 kB to 3.19 kB and a shared
`AreaChart` chunk appeared. That is Vite hoisting recharts now that two components use it — better
than before, since the library is fetched once and shared rather than bundled per consumer. The
property that mattered (nothing recharts-shaped in the main chunk) holds.

## Two deviations, both correct

**The 404 handling is better than my spec.** I wrote the unknown-ticker card as "history empty *and*
signals empty". `/universe/{ticker}/history` actually **404s** for a ticker outside the Universe. The
coder mapped that case too. My reading of the endpoint was wrong and it handled reality.

**The JSX error was self-corrected and reported verbatim**, including the failing output, rather than
quietly fixed.

## The type shim is my file-list gap

`client.ts:101-112` still declares `SignalOut` without `value` and `TickerSignals` without `atr` — the
fields contract 0085 added to the backend. `TickerPage` patches around it:

```ts
type SignalWithValue = SignalOut & { value: number | null }
type TickerSignalsWithAtr = Omit<TickerSignals, 'signals' | 'atr'> & { ... }
```

The coder was right not to touch `client.ts`; it was in neither contract's file list. 0085 was
backend-only by design and 0086 did not name it.

**But the canonical type now lies about the API**, and the shim is the seed of the exact pattern
contracts 0071 and 0072 spent two rounds undoing for cash: one concept, two definitions, drifting.
The `Omit<TickerSignals, 'atr'>` is itself a tell — it omits a key that does not exist.

Lesson, and it generalises past this instance: **when a contract changes an API response shape, the
typed client is part of that change, not a separate concern.** A backend-only contract that alters a
schema leaves the frontend either stale or working around it, and the workaround is invisible until
someone greps for it.

Filed as contract **0087**.

## Still unverified

Everything visual. The page was written from the reference's *source*, not from Gunnar's PDF, which
this environment cannot render. Proportions, ordering and density are guesses.

## Status

Accepted and archived.
