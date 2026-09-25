# Report 0104: backtest_series (planner audit)

**Verdict:** accepted
**Coder:** sonnet · **Auditor:** planner (opus)

## Re-run by the planner
- Full backend suite: **581 passed** (555 before, +26).
- `git diff --stat`: portfolio_series.py +80 and test_portfolio_series.py +137, with 0 deletions. The only
  change above the append is `from typing import Literal`. The existing functions and tests are byte-identical.
- Code read against rules 1–7:
  - The validation order is fine.
  - The frame is built from weighted tickers only, sliced `>= start`, then ffill with no bfill.
  - Initial units come through `units_from_weights(normalised, 0.0, …)`.
  - The period key compares against the previous row.
  - V is taken with the old units, then the units are reset. by_holding is post-rebalance.
  - The outputs are Python floats.

## Notes (non-blocking)
- To get the before-count, the coder overwrote the working files with `git show HEAD:<path>` and then
  restored them. The restore was verified, but that is a risky move on uncommitted work. Future
  contracts will say: take the before-count **before editing**.
- Criterion 11 (insertions only) pushed the coder to a duplicate import line rather than extending the
  existing one. That is harmless, but it shows the criterion was brittle. Future contracts will guard
  existing behaviour with "the existing tests pass unmodified" and will allow import edits.
- `_period_key` has no "none" branch. It is only called when rebalance != "none", so this is fine.
