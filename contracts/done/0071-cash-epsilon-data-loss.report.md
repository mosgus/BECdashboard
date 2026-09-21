# Report — Contract 0071 (Cash epsilon data loss)

**Verdict: accepted.** The data-loss bug is fixed on both the write and the read side.

## Verified independently

`cashFromPositions` (`portfolio.ts:71`) is exactly the specified shape — symmetric
`Math.abs(cash) < WEIGHT_EPSILON` snap at `1e-9`, `null` for a genuine negative, `null` for
non-finite. The constant is declared once and used once.

All three current-portfolio write paths route through it: `addPositionDiluting` (258),
`removePositionToCash` (280), `handleCashTextChange` (`PortfoliosPage.tsx:131`). The old `-0.01`
inline clamp is gone from both files.

Read repair is right and, importantly, restrained:

```ts
return parsed
  .map(normaliseStoredPortfolio)
  .filter((value): value is StoredPortfolio => isValidCurrentPortfolio(value) || isValidLegacyPortfolio(value))
```

Normalisation before validation, so `isValidCurrentPortfolio` keeps its strict `cashWeight >= 0` rule
rather than being loosened. No `setItem` anywhere in the read path — the test asserts it with a spy.
50 tests, `TSC OK`, clean build and lint, `npm ci` fine.

## The reported deviation is correct

`toBeCloseTo(0.005, 12)` instead of exact equality for the typed-cash test. `100 - 99.995` is
`0.004999999999995453` in float64 and cannot equal decimal `0.005`. The assertion still discriminates
against the failure it exists to catch — `|0 - 0.005|` is `0.005`, seven orders above the `0.5e-12`
window — so a snapped value fails it. Correctly identified and correctly reported rather than
worked around.

The coder also answered the question asked: the raw rescale residue from the six weights is
**positive** before snapping, confirming that symmetric handling was necessary and that a
negative-only clamp would have left this exact case broken.

## Two residues, both planner scope errors, neither data loss

**1. `migrateLegacyPortfolio` is a fourth inline `100 - Σ`** (`portfolio.ts:139`), still unclamped,
still `cashWeight < 0 → null`. My Files section named only `addPositionDiluting` and
`removePositionToCash`, so the coder was right not to touch it. The consequence is bounded: a legacy
portfolio whose conversion lands a negative residue fails to migrate and keeps showing its
"needs current prices" card. Data intact, feature degraded, and only for pre-0059 records.

This means the contract's own Goal — *"cash weight is computed in exactly one place"* — is not
literally met. Worth saying plainly rather than letting the archive imply otherwise.

**2. `normaliseStoredPortfolio` uses `-0.01`, not `WEIGHT_EPSILON`.** I tightened the helper to `1e-9`
when revising and left the read-repair section at `-0.01`. So the recovery window is seven orders
wider than anything the write path can now produce. Defensible as forgiveness toward records written
by the old code — but it is two epsilons again, which is the precise pattern this contract existed to
remove.

Both are one-line changes. Neither justified rejecting correct work; they are logged here so the next
contract touching this file closes them.

## Still outstanding

Gunnar's browser walkthrough. Nothing in this environment can see his `localStorage`, so whether
`Gunnar Preset` actually reappears is unverified by anything but argument and a unit test built from
the same number.

## Status

Accepted and archived.
