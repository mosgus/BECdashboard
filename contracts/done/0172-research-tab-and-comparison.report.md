# 0172 audit (planner, 2026-10-26): accepted

**Re-run:** tsc (`-p tsconfig.app.json`) exits 0. Tests: 382 passed in 26 files (372 + 10). Build exits 0. Lint shows only the 2 known warnings. The `title=`, Net Sharpe and >300-char greps print nothing. Criterion 8's test also checks tickers, max_weight, vol_target and lookback.

**Browser (criteria 18–19), against a stub API on :8000 with no production reads.** The stub serves a fixed CompareResponse covering a pinned holding, an excluded holdout ticker, a warning, a `feasible=false` row, a `holdout_error` row and an in-sample `error` row.
- With no backend, the shell renders: tab, pill, controls. The fetch failure shows on the page and is not swallowed.
- With the stub:
  - The run notes, explainer and table all render.
  - The default sort is holdout Sharpe, descending.
  - Highlighted cells are only at column indexes 1–4 (holdout): EW CAGR and Sharpe, Min Var vol, Min CVaR max DD. That is the correct best value per column. The current row's higher Sharpe is correctly not highlighted.
  - The holdout-error row spans 4 columns, muted. The error row spans 10 columns in `text-brand-negative`. `did not converge` appears under Min CVaR.
- A `NewsSection` exception appeared, but it came from the stub returning `{}` for `/news`. It has nothing to do with this contract.
- **Not verified: real BEC data.** A local backend reads production prices, which is blocked for the planner. This is covered by Gunnar's human check.

**Notes, no action needed:**
- `Cost (one-time)` is not a sort button. The contract says every column header is one, but `CompareSortKey` has no cost key. Cost is monotone in `traded`, so Traded sorts the same. This was a spec inconsistency, and the coder took the reading the types support.
- The extra "fewer than two holdings" guard avoids a guaranteed 422. Keep it.
