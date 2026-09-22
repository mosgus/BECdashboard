# Report — Contract 0093 (price panel Y domain)

**Verdict: accepted.** Re-verified independently: tsc clean, 73 tests across 5 files (up from 67),
`grep -c "it(" chart.test.ts` = 10.

## The regression tests actually discriminate

The point of specifying "strictly below 80" rather than "below the close range" was that the looser
assertion would pass against the code being fixed. I mutation-tested both fixtures by running the
shipped `priceDomain` restricted to `['adj_close']` — which is exactly the pre-0093 behaviour:

```
lower-bound test  new: 77.60  < 80 ?  true
lower-bound test  OLD: 99.20  < 80 ?  false
upper-bound test  new: 208.00 > 200?  true
upper-bound test  OLD: 110.80 > 200?  false
```

Both fail against the old logic and pass against the new. They are real regression tests, not
assertions that happen to hold.

Also confirmed directly:

```
empty rows                   : [0,1]        (not [Infinity,-Infinity])
flat series span             : 2            (the || 1 fallback, doubled by padding)
bollinger_band array ignored : [99.2,110.8] (not blown out to 999)
```

That last one matters: `bollinger_band` holds `[lower, upper]`, and a `typeof` check that admitted
arrays would have scaled the panel to whatever the array's numeric coercion produced. The
`typeof value === 'number'` guard handles it, and I checked rather than assumed.

## The domain is computed from the rendered rows

`const priceYDomain = priceDomain(renderedData)` sits immediately after `renderedData`, so it runs
against the downsampled, date-filtered array — not `seriesByKey`, which spans the full ~400-day
indicator axis regardless of what the user is looking at. That was the failure mode this contract
warned about and it was avoided.

## A sloppy line in my own contract

Criterion 4 said `prices` "keeps its current behaviour". Wrong — removing `minimum` and `maximum`
makes `prices` dead, and `noUnusedLocals` would have rejected it. The coder deleted it, which is both
correct and the only thing that typechecks. My criterion listed a variable I had not thought through;
the coder's judgment was better than my spec.

## Noted, not acted on

The coder flagged that `ChartPoint` (index signature `string | number | number[] | null`) is passed
to a parameter typed `ReadonlyArray<Record<string, unknown>>` and is accepted structurally with no
cast. That is correct today and would surface as a type error rather than a silent bug if a stricter
tsconfig ever disagreed. No action.

## What still needs a human

1. Bollinger on, a ticker near a 52-week low — the lower band curves freely, with space beneath it.
2. Bollinger off — the price line still fills the panel and has not shrunk toward the middle.
3. A one-month range with Bollinger on — the panel scales to that month, not to 400 days.
