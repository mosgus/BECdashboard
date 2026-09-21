# Report — Contract 0072 (Stated cash wins)

**Verdict: accepted.** Clean run, no deviations, and it closes the last inline cash remainder.

## Verified independently

**1. The typed value is stored.** `PortfoliosPage.tsx` now validates the total and persists
`cashWeight: parsed`. `grep -n "cashFromPositions" src/pages/PortfoliosPage.tsx` prints nothing — the
import is gone too, so the stated path cannot accidentally route through the derived helper again.
Four tests pin exact storage for `5`, `0`, `0.005` and `99.9`.

**2. `migrateLegacyPortfolio` uses the helper** (`portfolio.ts:139`), with a test that reproduces a
real `-1.4210854715202004e-14` residue — a case that returned `null` before, silently refusing to
migrate a legacy portfolio for a rounding reason.

**3. One epsilon.** `portfolioStore.ts` imports `WEIGHT_EPSILON` and uses `-WEIGHT_EPSILON`; no
`-0.01` survives. Tests cover both directions of the narrowed window: `-1.42e-14` still recovers,
`-0.005` is now rejected.

55 tests, `TSC OK`, clean build, lint unchanged, `npm ci` fine. The four surviving `100 - ` matches in
`portfolio.ts` are the helper itself, implied-value math, and two draft-display remainders — none
derive persisted cash.

**Contract 0071's stated goal is now actually true**: cash weight is computed in exactly one place.
It was not when 0071 was accepted, and the report said so rather than letting the archive imply
otherwise.

## What this closed beyond its own scope

An open question from the 0064 audit was whether relative position weights drifting meant weights were
being recomputed from live quotes — which the position model forbids and which would have been
serious. **They were not.** The cause was the cash rescale losing ulps unevenly, measured across two
of Gunnar's real exports. `addPositionDiluting` was innocent throughout.

That question had been open for three contracts on incomplete information. Worth noting how it
resolved: not by a test, not by reading code, but by diffing two files the user exported days apart.

## Residual, accepted and documented

Position weights still shift in their last digit or two on every cash edit. Rescaling six numbers to a
new total cannot be lossless, and the only "fix" is not rescaling. ~1e-15 relative, invisible to
anything downstream. Named in the contract's Out of scope so a future agent does not "fix" it, and
recorded in `REBUILD.md`.

## Status

Accepted and archived.
