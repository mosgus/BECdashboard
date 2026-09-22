# Report — Contract 0076 (Per-preset ticker derivation in tests)

**Verdict: accepted.** The suite is green and the fix generalises rather than accommodating two
presets.

## Verified independently

`55 passed`. `presetTickers` is gone; `tickersOf` appears five times — defined once, used at every
call site including both `PRESETS[0]`-specific tests. `toHaveLength(2)`.
`git diff --stat frontend/src/lib/presets.ts` is **empty**: the presets themselves, one of which is
Gunnar's real allocation, were not touched to make a test pass.

**Criterion 12 is the one that mattered and it was done properly.** A third preset was added
temporarily, the suite reported exactly one failure — `expected […(3)] to have a length of 2 but got
3` — and nothing else broke. That is the proof the derivation generalises; under the old shared
constant, adding a third preset would have failed three tests, not one. Then removed, suite green
again.

That is also the failure this contract existed to fix, demonstrated rather than asserted.

## The reported deviation is mine and is a sequencing artifact

Criterion 10 said the backend suite should report **460**. It reports **467**, because contract 0077
landed in between and added seven tests. No backend file was touched here.

Mild, but the general lesson is worth having: **a criterion pinning a count taken from another
contract's baseline goes stale the moment contracts interleave.** Better either to say "unchanged
from whatever it is when you start — report both numbers" or to scope the regression check to the
files this contract owns. The coder reported the discrepancy and correctly declined to explain it
away, which is the behaviour that makes the count useful at all.

## Status

Accepted and archived. The frontend baseline is green again, so contract 0078 starts from a clean
suite rather than inheriting three failures it cannot distinguish from its own.
