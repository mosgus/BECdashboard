# Report 0192 — `backtest_series` on numpy arrays

**Status:** accepted (planner audit, 2026-11-09)

## Audit

**Accepted. The coder was right to report `BLOCKED`, and the code was correct. The criterion was the
defect.**

### What was claimed

The coder reported `BLOCKED`:
- The oracle tests passed (12 schedule × fixture cases) and so did the whole backend suite.
- `compare_reference.py check` reported `MISMATCH`, all in `modes[7]`, with differences around 1e-9.

The coder stopped instead of loosening the tolerance or touching files outside the list. That is the
behaviour the contract asked for, and it is worth repeating: a quiet tolerance bump would have hidden
a criterion error the planner needed to see.

### What the planner found

The planner reclassified every differing float across all three reference cases, measured against
the working tree with 0191–0193 all applied:

- **`1825-target-10pct-monthly` (fixed vol target):** 176 floats differ, max relative 1.03e-13.
- **`730-capped-quarterly` (fixed vol target):** 208 floats differ, max relative 5.04e-12.
- **`default-365-match-current`:** 228 floats differ. Of those, **24 exceed 1e-9, and every one is
  in mode 7, `target_volatility`.** The largest absolute weight difference is 1.22e-9.

The mechanism:
- Under "match current", the vol target is the current portfolio's own volatility, computed from a
  `backtest_series` curve.
- The rewrite sums in a different order, which moved that target in its last bit:
  `0.10161879184527994 → 0.10161879184527989`.
- `optimize_target_volatility` (SLSQP) stops at about 1e-9, so it converged to weights about 1.2e-9
  apart.

That is solver precision, not an error.

**The criterion was wrong.** A relative tolerance of 1e-9 is tighter than anything downstream of an
iterative optimizer can reproduce. The planner changed `contracts/tools/compare_reference.py` to
`rel_tol=1e-6, abs_tol=1e-9`, with the reason in its docstring. Two checks followed:
- With 0192 and 0193 applied, `check` prints `MATCH`.
- **Mutation check:** the planner monkeypatched `backtest_series` to drift up to 0.01% across the
  series. The corrected check reported `MISMATCH`, so the looser tolerance still catches a real error.

Re-run by the planner:
- `pytest tests/test_portfolio_series.py`: 45 passed, including the 12 `test_matches_loop_reference`
  cases.
- Full backend suite: 893 passed, with 0191–0193 applied.
- Both "no per-row loop" greps print nothing.

### Code review

- **Good:** The segment approach is right. The coder also kept the column-by-column summation order
  deliberately, so the outputs land within 1e-13 of the old loop, not merely within tolerance.
- **Minor, not fixed:** `import numpy as np` sits inside the function body. It belongs at module
  level with the `pandas` import. Fold it into the next contract that touches this file.
- **Edge-case behaviour change, accepted:** a zero price on a rebalance date now gives `inf` (numpy
  division) instead of raising `ZeroDivisionError`. No test covers it and real price data never has
  a 0 close. Recorded so nobody is surprised later.

### Timing (criterion 7, informational)

`compare_reference.py check`, per case, on the planner's machine:
- **Before:** 2.66 / 3.13 / 2.84 s.
- **0192 alone** (coder's run): 2.25 / 2.35 / 2.44 s.
- **0192 + 0193:** 0.35 / 0.40 / 0.39 s.

### Lesson (added to the planner checklist)

A tolerance on anything computed *by* an iterative solver, or from a value the solver consumed, can
be no tighter than the solver's own stopping tolerance. The planner set 1e-9 from the rewrite's
summation error and never checked which outputs passed through SLSQP afterwards.
