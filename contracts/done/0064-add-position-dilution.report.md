# Report — Contract 0064 (Dilution and shares-driven entry)

**Verdict: accepted.** The bug that sealed Gunnar's portfolio is gone, and the dilution rule turns out
to be more self-consistent than I argued for when I specified it.

## What I verified

Re-ran everything. `npm run test` → 30 passed across 2 files. `npx tsc -p tsconfig.app.json --noEmit`
→ `TSC OK`. `npm run build` → clean. `npm ci` → exits 0 (0063's fix held).
`grep -rn "addPositionUsingCash" src/` → nothing. `grep -n "weightNumber > cashWeight"` → nothing.
The `!available.some(...)` Universe guard survives at line 57.

Read `addPositionDiluting` (`portfolio.ts:224-253`) rather than trusting the summary. It matches the
contract: cash first, `scale = (positionTotal - shortfall) / positionTotal`, cash recomputed from the
positions rather than tracked, and a final `Math.abs(total - 100) > 0.01` guard so an invalid
portfolio is returned as `null` instead of being silently dropped by `savePortfolio`.

**One addition not in the contract, and it is correct:** line 240 clamps a cash weight in
`(-0.01, 0)` to exactly `0`. Pro-rata scaling produces float residue of that size routinely, and
`portfolioStore.isValidCurrentPortfolio` rejects any negative cash — without the clamp a legitimate
dilution would intermittently fail to save, depending on the arithmetic. The clamp is bounded to the
existing tolerance and cannot mask a real negative. Good judgment; keeping it.

## The audit number I asked for was the wrong test, and the real property is better

I asked for the derived weight using MU/ORCL/VOO at $10 each. The arithmetic checks out exactly —
`M = 220.8`, `W = 900 / 1120.8 = 80.2998%`, survivors scaled by `0.197002`, total `100`.

But those toy prices are **inconsistent with the stored weights** — 10 MU shares at $10 is $100, which
is not 77.80% of $220.8. So the number verified the arithmetic and nothing about whether shares and
weights stay coherent. My fixture, my error.

The property I should have asked for holds algebraically, so I checked it that way instead. With
`C = 0`:

```
W     = sp / (V + sp)
scale = (100 - W) / 100 = 1 - sp/(V + sp) = V / (V + sp)
```

The funding rule's scale factor **is exactly** the old-book-over-new-book ratio. So a shares-driven
add into a fully-invested portfolio leaves every existing position's `shares × price` at precisely
its new weight — shares and weights stay coherent with no special-casing. The "one rule" claim in the
contract is stronger than I knew when I wrote it.

**Where it does not hold, and this is worth knowing:** when `C > 0`, cash absorbs part of the add, so
`scale ≠ V / (V + sp)` and stored share counts drift out of agreement with stored weights. That is
defensible — shares are explicitly metadata, not truth — but it means a second shares-driven add
after a cash-funded one computes `V` from share counts that no longer reconcile. Bounded and
recorded, not blocking.

## Deviation, permitted

Criterion 8 was satisfied by direct invariant assertion rather than a `localStorage` stub. The
contract named that as the alternative and the coder said which it used. Fine.

## Still unverified

The browser check. Nothing automated can confirm the derived weight is *sensible* — it comes from
live quotes — or that the form wraps at 375 / 1023 / 1024px with a new derived-weight field on the
row. That is Gunnar's step 1-5 in the contract.

## Status

Accepted and archived.
