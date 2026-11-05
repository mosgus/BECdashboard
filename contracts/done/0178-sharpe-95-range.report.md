# Report: Contract 0178 — Sharpe 95% range row

**Audited by:** planner (opus), 2026-10-26
**Verdict:** accepted

## Verification re-run
- vitest: 415 tests in 29 files pass. tsc exits 0. `npm run lint` shows only the 2 known warnings.
- The diff matches the interface exactly:
  - `sharpeRange` implements the guard, the Lo iid standard error and the format as specified;
  - the row sits at index 3 with Diff `—`, `diffTone` muted;
  - the coder added `satisfies PerformanceRow`, which is harmless.
- The tests use the planner's Python-computed values. The only line over 300 characters is the mandated tooltip.

## Smoke (isolated stub :8010 + Vite :5180)
- `/ticker/MS`, Risk & Factor Profile: the row renders under Sharpe as `-1.58 to 2.28 | -1.53 to 2.33 | —`.
- Python gives the same numbers for Sharpe 0.35/0.40 at the response's `n_days` = 260.
- Note: the committed ticker section (d683d82) now follows the page's start/end inputs instead of the 1Y/3Y/5Y switch. The window in the request was 2025-10-26 → 2026-10-26. Gunnar changed this himself before committing, and it doesn't affect this contract.

## Not checked
- Risk & Perf → Performance with real portfolio data. It uses the same `performanceRows`, which the unit tests cover. The look is Gunnar's to check.
