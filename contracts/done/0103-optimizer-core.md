# Contract 0103 — Optimizer math: port `main`'s `core/portfolio.py` and `core/tilt.py`

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Create a pure module, `backend/app/optimizer.py`, containing `main`'s portfolio optimizer math:
- return, equity and drawdown helpers
- performance metrics
- the CAPM helpers
- all nine optimizers
- the conviction tilt

It has no database, network or FastAPI code. The endpoint comes in 0104 and the UI in 0105+. Add
**scipy** as a pinned dependency.

## Why

The Backtest tab becomes **Optimize**, a port of `main`'s optimizer tab. See REBUILD.md, "The Backtest
tab becomes Optimize". This contract is the math layer, and it is a **port**: the function names,
signatures, defaults and algorithms follow `main` line for line, with two deliberate fixes (below).
Read the originals with:

```bash
git show main:backend/core/portfolio.py
git show main:backend/core/tilt.py
```

The **parity table** in the acceptance criteria was produced by running `main`'s own code, in the
reference venv, on the same versions this contract pins (scipy 1.18.1, numpy 2.5.3, pandas 3.0.5). A
faithful port reproduces it.

## Files

Create:
- `backend/app/optimizer.py`
- `backend/tests/test_optimizer.py`

Modify:
- `backend/requirements.txt`: add `numpy==2.5.3` and `scipy==1.18.1`, one per line, in the existing
  style. numpy is already installed through pandas, but this module imports it directly, so it gets
  pinned.

Install into the existing venv with
`(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pip install -r requirements.txt)`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and report
`BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it. The same applies to `~/WebstormProjects/blue-eagle-reference`. Read `main` only
through `git show main:<path>`.

**`backend/.env` holds the live production database URL.** Every ad-hoc `python -c` must be prefixed
with `DATABASE_URL=""`. The test suite already handles this.

## Interface: `app/optimizer.py`

Port these from `main:backend/core/portfolio.py`, keeping the same names, parameters, defaults and
behaviour unless a fix below says otherwise:

```
compute_returns(prices) -> DataFrame
compute_portfolio_returns(returns, weights) -> Series
compute_equity_curve(returns) -> Series
compute_rolling_vol(returns, window=21) -> Series
compute_drawdown(equity) -> Series
compute_metrics(port_returns, bench_returns=None, rf=0.0) -> dict
compute_betas(returns, market_ticker) -> dict[str, float]
compute_forward_looking_metrics(weights, expected_returns, returns, rf=0.04) -> dict
compute_capm_expected_returns(betas, rf=0.04, mrp=0.05, views=None) -> dict[str, float]
optimize_equal_weight(returns)
optimize_min_variance(returns, max_weight=1.0, min_weight=0.0, asset_bounds=None)
optimize_max_sharpe(returns, rf=0.0, max_weight=1.0, min_weight=0.0, asset_bounds=None)
optimize_max_sharpe_capm(returns, expected_returns, rf=0.04, max_weight=1.0, min_weight=0.0, asset_bounds=None)
optimize_risk_parity(returns, max_weight=1.0)
optimize_max_sortino(returns, rf=0.0, max_weight=1.0, min_weight=0.0)
optimize_min_cvar(returns, alpha=0.05, max_weight=1.0, min_weight=0.0)
optimize_max_diversification(returns, max_weight=1.0)
optimize_target_volatility(returns, vol_target=0.10, max_weight=1.0, min_weight=0.0)
```

Also port the private helpers `_port_vol`, `_neg_sharpe_hist` and `_run_optimizer`. Port
`compute_tilt(base_weights, conviction, lam=1.0, u0=20.0)` from `main:backend/core/tilt.py` into the
same module. Each optimizer returns `dict[str, float]` and raises `RuntimeError` when SLSQP doesn't
converge, as in `main`.

Keep `main`'s module docstring listing the nine modes. Add a short note naming the two fixes below.

### Fix 1: risk parity target

`main`'s `erc_objective` compares `rc = w * (cov @ w)` against `port_vol / n`. Since `Σ rc = σ²`, the
correct target is `port_var / n`. Change only that line: `target = port_var / n`. On uncorrelated
assets the result must be inverse-volatility weights (criterion 4).

### Fix 2: Sharpe with zero volatility

In `compute_metrics`, change `sharpe = (cagr - rf) / vol if vol > 0 else 0.0` to
`sharpe = (cagr - rf) / vol if vol > 1e-12 else None`. The return annotation stays `dict`. A constant
return series has `vol ≈ 3e-18` from float noise, and `main` reports a Sharpe of about 8e16 for it.

No other behaviour changes. Specifically:
- Keep the per-mode differences in bounds. For example, risk parity uses `(1e-6, max_weight)` and max
  diversification uses `(0, max_weight)` whatever `min_weight` is.
- Keep `ftol`/`maxiter` as they are.
- Keep the error messages.

## Out of scope

- No endpoint, request/response schemas, price loading, SPY handling or risk-free-rate fetch. Those
  are 0104.
- Don't port `core/rates.py`, `core/rebalance.py`, `scenarios.py` or `walk_forward.py`.
- Don't touch `app/portfolio_series.py`, `app/returns.py` or `app/indicators.py`.

## Fixtures for the tests (literal)

```python
a, b = 0.01, 0.02
A = np.tile([a, -a, a, -a], 25)          # 100 rows
B = np.tile([b, b, -b, -b], 25)          # sample covariance with A is exactly 0
UNCORR = pd.DataFrame({"A": A, "B": B})
DRIFT  = pd.DataFrame({"A": A + 0.001, "B": B + 0.002})
rng = np.random.default_rng(7)
SEEDED = pd.DataFrame(rng.normal([0.0005, 0.0008, 0.0003], [0.01, 0.02, 0.015], size=(500, 3)),
                      columns=["A", "B", "C"])
```

## Acceptance criteria

Tolerance is **±0.01** on every weight and metric below, unless one is given. Never assert float
equality.

1. `(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q)` passes. The count is **524 +
   at least 20**. Paste the before and after counts.
2. `grep -n "^scipy==1.18.1$" backend/requirements.txt` and `grep -n "^numpy==2.5.3$" backend/requirements.txt`
   each print one line.
3. `grep -n "^from app\|^import app\|sqlalchemy\|fastapi\|yfinance" backend/app/optimizer.py`
   prints nothing. The module must be pure.
4. The tests cover these **analytic** cases:

| call | expected |
|---|---|
| `optimize_equal_weight(DataFrame A,B,C)` with any three columns | each 0.3333 |
| `optimize_min_variance(UNCORR)` | A 0.80, B 0.20 |
| `optimize_min_variance(UNCORR, max_weight=0.6)` | A 0.60, B 0.40 |
| `optimize_risk_parity(UNCORR)` | A 0.6667, B 0.3333 *(fix 1; `main` gives 0.788)* |
| `optimize_max_diversification(UNCORR)` | A 0.6667, B 0.3333 |
| `optimize_max_sharpe(DRIFT)` | A 0.6667, B 0.3333 |
| `optimize_max_sharpe_capm(UNCORR, {"A": 0.08, "B": 0.12}, rf=0.04)` | A 0.6667, B 0.3333 |
| `optimize_target_volatility(DRIFT, vol_target=0.5)` | A 0.00, B 1.00 |
| `optimize_target_volatility(DRIFT, vol_target=0.01)` | raises `RuntimeError` |
| `optimize_min_cvar(DataFrame({"A": A, "Z": zeros(100)}))` | A 0.00, Z 1.00 |
| `compute_tilt({"A": .5, "B": .5}, {"A": 20})` | A 0.6817, B 0.3183 |
| `compute_capm_expected_returns({"A": 1.2}, rf=.04, mrp=.05, views={"A": .5})` | A 0.125 |
| `compute_betas(DataFrame({"M": A, "X": 2*A}), "M")` | `{"X": 2.0}` |
| `compute_equity_curve(Series([0.1, -0.5]))` | [1.1, 0.55] |
| `compute_metrics(Series([0.001]*252))` | cagr 0.2864, max_dd 0.0, **sharpe `is None`** *(fix 2)* |
| `compute_metrics(Series([0.1, -0.5, 0.2]))` | max_dd −0.50 |
| `compute_metrics(Series(2*A), Series(A))` | beta 2.00, alpha −0.0241, vol 0.3191 |
| `compute_forward_looking_metrics({"A": .5, "B": .5}, {"A": .08, "B": .12}, UNCORR, rf=.04)` | expected_return 0.10, vol 0.1784, sharpe 0.3364 |

5. **Parity with `main`** on `SEEDED`, with default arguments. These values came from `main`'s code:

| function | A | B | C |
|---|---|---|---|
| `optimize_max_sortino` | 0.00 | 1.00 | 0.00 |
| `optimize_min_cvar` | 0.5414 | 0.2107 | 0.2479 |
| `optimize_min_variance` | 0.5874 | 0.1467 | 0.2659 |
| `optimize_max_sharpe` | 0.00 | 1.00 | 0.00 |
| `optimize_max_diversification` | 0.4593 | 0.2314 | 0.3093 |

   Risk parity is deliberately absent from this table, because fix 1 changes its output. Instead,
   test that on `SEEDED` its risk contributions `w * (cov @ w)` are equal to within 1% of their mean.

6. **Property tests on `SEEDED`**, one parametrized test over all nine optimizers.
   - For `max_sharpe_capm`, use `expected_returns={"A": .06, "B": .09, "C": .05}`.
   - For `target_volatility`, use **`vol_target=0.20`**. The default of 0.10 is below this fixture's
     minimum achievable vol (0.121), so it correctly raises.

   Check that:
   - the weights sum to 1 (±1e-6)
   - every weight lies within that optimizer's bounds (±1e-6)
   - the keys equal the input columns (for `max_sharpe_capm`, the columns present in
     `expected_returns`)
7. `optimize_min_variance(SEEDED, max_weight=1.0, min_weight=-1.0)` returns weights summing to 1, and
   the test notes whether any weight is negative. It asserts only the sum and the bounds, since
   shorting may or may not bind on this data.

If any criterion cannot be met as written, for example because a parity value doesn't reproduce with
the pinned versions or an analytic case contradicts `main`'s algorithm, **report `BLOCKED` and name the
conflict**, including the value you got. That is the correct answer. Don't loosen a tolerance, change a
fixture or alter the algorithm to make a number match.

## Verification to run and paste

Run each of these from the repo root and paste the **complete, verbatim** output into the report,
including failures. Don't summarise, trim or clean up.

```bash
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q 2>&1 | tail -3)
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q tests/test_optimizer.py -v 2>&1 | tail -45)
grep -n "^scipy==\|^numpy==" backend/requirements.txt
grep -n "^from app\|^import app\|sqlalchemy\|fastapi\|yfinance" backend/app/optimizer.py
grep -n "target = port_var / n\|vol > 1e-12" backend/app/optimizer.py
git status --short
```

## Tooltips — required for any contract adding interactive elements

This is a backend-only contract with no interactive elements.

## Human verification — does Gunnar need to run anything?

No. This is pure math with no UI. The tests prove it. The first thing you can look at arrives with
0105.

## Open questions

None. If a parity value is off by more than 0.01, report `BLOCKED` with the value you got. It would mean
the port differs from `main` somewhere, and finding where is the planner's job.
