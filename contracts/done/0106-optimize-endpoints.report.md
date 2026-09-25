# Report 0106: optimize and tilt endpoints (planner audit)

**Verdict:** accepted
**Coder:** sonnet · **Auditor:** planner (opus)

## History
- The first run was BLOCKED correctly. The contract hard-coded a 1825-day lookback for the tilt
  optimizer baseline against a one-year fixture, which pins every holding. That was a planner error.
- Amendment 1 added `TiltRequest.lookback_days` and a default-lookback 422 regression test. The second
  run completed.

## Re-run by the planner
- Full backend suite: **629 passed** (603 before, +26). `test_api_portfolio.py` and `test_api_ops.py` are unmodified.
- Text fixes are confirmed at `optimize_run.py:146`, `:162` and `:167`, and `"constant baseline"` is gone.
- I read the router diff:
  - `_load_stored_closes` is the exact query `/series` used, with the same 404. `/series` now calls it.
  - SPY is reused when it's a holding and otherwise loaded with `required=False`.
  - `fetch_risk_free_rate()` is called only for `max_sharpe_capm`.
  - `OptimizeInputError` maps to 422.
  - `_safe_metrics` nulls non-finite values.
  - Tilt checks the mode before `_require_database`, so equal and current need no DB.
- `rates.py` is a faithful port with the `_download_tnx` boundary.

## Notes (non-blocking)
- The report didn't paste `git status` or the full verification output, as the contract asked. I re-ran it all.
- `/tilt` has no `response_model`. The contract didn't require one, and the UI contract will type the
  response on the client.
- Nothing has been committed since 0102. 0103–0106 are all uncommitted in one working tree.
