# Report: Contract 0096, the portfolio value series endpoint

**Status:** accepted
**Agent:** sonnet

## Audit

**Accepted, 2026-09-24.** Gunnar had already committed the work in `c50eaa9`, so I audited the diff
`HEAD~1..HEAD`. I re-ran every verification command:

- The backend suite passes, 524 tests, up from 506.
- `test_portfolio_series.py` has 7 tests and `test_api_portfolio.py` has 8. One of them is
  parametrised, so there are 9 cases.
- The router has no `compute_*` indicator calls.
- `indicator_series(` appears once in each router.
- `portfolio_series.py` has no `app.` or relative imports.
- The router is registered at `main.py:21`.
- `test_api_universe.py` is untouched.

What I read in the code:
- **The refactor preserves behaviour.** `indicator_series` is the old if-chain moved verbatim, with
  the same keys, labels and order. `get_indicators` passes `high`, `low` and `volume`, so its
  `ValueError` guard can never fire on the ticker route.
- **The pure module matches the interface:**
  - `align_closes` is `ffill().bfill()` over the union of dates.
  - `units_from_weights` normalises with the cash included.
  - `value_series` takes units it's given and never chooses them. This is the Backtest seam.
  - `first_bar` is taken before alignment, as specified.
- **Every case's expected value in the tests is a literal**, within ±0.01.
- **The endpoint tests store `close = 2 × adj_close`.** A route reading the wrong column fails
  them.
- **The validation order matches the table.** NaN and inf are rejected for both weights and cash.
  Include keys are checked before the 404.

Notes, none of which block acceptance:
- A stored `adj_close` of 0 on a holding's last date would divide by zero at the anchor. The
  signals route has the same exposure, and I've never seen it in real data. Nothing is filed.
- The 404 path is tested only for a single unstored ticker. A mix of stored and unstored tickers
  takes the same loop, so I didn't request a second test.
