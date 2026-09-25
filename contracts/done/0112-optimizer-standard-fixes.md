# Contract 0112 — Optimizer: correct the standard modes, cap total shorts, flag the custom code

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

This contract makes five changes:

- Max Sharpe and Max Sortino optimise against the live risk-free rate.
- The metrics table uses that same rate and shows it.
- Max Sortino uses the textbook downside deviation.
- Risk Parity and Max Diversification respect the min-weight floor.
- An unreachable Target Volatility gives a clear 422 instead of a fake "did not converge".

Shorting gets a user-set cap on total short exposure. The custom conviction/views code gets
`FLAG(custom)` comments and **no behaviour change**.

## Why

The planner reviewed every Optimize mode against its standard definition on 2026-09-24. It ran the
code on synthetic data and compared the results with exact solvers.

- **Already correct; do not touch their maths:**
  - Min Variance, Equal Weight, Min CVaR, Max Diversification.
  - Risk Parity: each holding's risk contribution came out at 16.6–16.7% across 6 assets.
  - Min CVaR matched the exact Rockafellar-Uryasev LP to within 0.3%.
- **Wrong, all copied from `main`:**
  1. **`rf` never reaches Max Sharpe or Max Sortino.** `run_optimize` receives `rf` but only
     passes it to CAPM. `optimize_max_sharpe` and `optimize_max_sortino` fall back to their
     `rf=0.0` default. With rf = 0, "Max Sharpe" maximises return ÷ volatility and picks a different
     portfolio. In a synthetic test one holding moved from 5.6% to 1.9%.
  2. **Sortino's downside measure is non-standard.** The code uses `np.std` of only the negative
     days. That measures how spread out the losses are, not how large they are: a portfolio losing a
     steady 1% every bad day would score as having almost no downside risk. The textbook downside
     deviation is `sqrt(mean(min(r − MAR, 0)²))` over **all** days.
  3. **Risk Parity and Max Diversification ignore `min_weight`.** Their bounds are hard-coded to
     `(1e-6, max)` and `(0, max)`.
  4. **An unreachable Target Volatility looks like a solver failure.** When no allowed mix is as
     calm as the target, SLSQP fails. The user then sees "Optimizer did not converge" and gets the
     current weights back.
- **Shorting loophole.** With Allow Short on, each holding can go down to −max weight, and nothing
  limits total short exposure. With max = 100%, a result like 200% long / 100% short is allowed.
  Gunnar chose a **slider** for the cap.
- **Risk-free rate (Gunnar, 2026-09-24): use the live rate if it's simple.** It is simple.
  `app/rates.py:fetch_risk_free_rate()` already reads the 10-year Treasury (`^TNX`) through
  yfinance. It caches the value for an hour and falls back to 4.27%. This reverses the REBUILD.md
  decision "Sharpe = (CAGR − rf) / vol, with rf = 0" for the Optimize tab. The planner updates
  REBUILD.md; you do not.
- **The custom code stays as it is; it only gets comments.** Its authors (Zach or Nicholas) need to
  confirm the intent before anything changes. This covers the κ views bump, the `mrp × view` term,
  the double-counted CAPM views and the tanh/exp tilt.

Verification method for the hinge short cap: the planner ran `max_short − Σ max(−wᵢ, 0) ≥ 0`
through SLSQP on 4 random 8-asset problems. It reached the same Sharpe, to 4 decimal places, as the
exact split-variable formulation (`w = p − q`, `Σq ≤ cap`). Use the hinge form. Do not introduce
split variables.

## Files

Modify:
- `backend/app/optimizer.py` — Sortino, bounds, the `max_short` constraint, the docstring and the
  FLAG comments.
- `backend/app/optimize_run.py` — pass `rf` and `max_short` through, run the target-vol
  pre-check, add the `rf` field and the FLAG comments.
- `backend/app/schemas.py` — `OptimizeRequest.max_short` and `OptimizeResponse.rf`.
- `backend/app/routers/portfolio.py` — always fetch `rf`, pass `max_short`, return `rf`, add one
  FLAG comment.
- `backend/tests/test_optimizer.py`
- `backend/tests/test_optimize_run.py`
- `backend/tests/test_api_optimize.py`
- `frontend/src/api/client.ts` — `max_short` on the request and `rf` on the response.
- `frontend/src/lib/optimize.ts` — the `maxShortPct` setting, the request field, `sameSettings`,
  and the rf-aware `metricItems`.
- `frontend/src/lib/optimize.test.ts`
- `frontend/src/pages/analysis/OptimizePage.tsx` — the short-cap slider, and passing `rf` to
  `metricItems`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, `backend/app/rates.py`,
`frontend/src/components/OptimizerGuide.tsx` and `REBUILD.md` are **not** on the list.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### 1. `backend/app/optimizer.py`

**Module docstring.** Change the `min_variance` line to:
```
  - min_variance        : minimize portfolio variance (fully invested; long-only unless shorting is enabled)
```
Change the `max_sortino` line to:
```
  - max_sortino         : maximise Sortino ratio (excess return / downside deviation below rf)
```

**Short cap.** Add a private helper next to `_run_optimizer`:
```python
def _short_cap_constraint(max_short: float | None) -> list[dict]:
    """Total short exposure Σ max(−wᵢ, 0) ≤ max_short. Empty when there is no cap."""
    if max_short is None:
        return []
    return [{"type": "ineq", "fun": lambda w: max_short - float(np.maximum(-w, 0.0).sum())}]
```
- Change `_run_optimizer` to `_run_optimizer(objective, n, bounds, *args, extra_constraints=())`.
  It appends `extra_constraints` to its existing sum-to-one constraint. Nothing else changes.
- Add a keyword `max_short: float | None = None` to each of these functions, and add
  `_short_cap_constraint(max_short)` to the constraints each one passes to SLSQP:
  - `optimize_min_variance`
  - `optimize_max_sharpe`
  - `optimize_max_sharpe_capm`
  - `optimize_max_sortino`
  - `optimize_min_cvar`
  - `optimize_target_volatility`
- `optimize_max_sharpe_capm` and `optimize_target_volatility` call `minimize` directly. Extend their
  constraint lists in the same way.
- When `max_short is None`, every function must behave exactly as it does today.

**Sortino.** Replace the objective inside `optimize_max_sortino` with this code:
```python
    mar = rf / 252.0
    def neg_sortino(w: np.ndarray) -> float:
        port = ret_matrix @ w
        excess_ann = float(port.mean()) * 252 - rf
        downside_dev = float(np.sqrt(np.mean(np.minimum(port - mar, 0.0) ** 2))) * np.sqrt(252)
        return -excess_ann / max(downside_dev, 1e-12)
```
The `len(downside) < 2` early return disappears. The mean runs over **all** days, not only the
negative ones.

**Min weight.**
- Change the signature to `optimize_risk_parity(returns, max_weight=1.0, min_weight=0.0)`. Its bounds
  become `(max(1e-6, min_weight), max_weight)`.
- Change the signature to `optimize_max_diversification(returns, max_weight=1.0, min_weight=0.0)`.
  Its bounds become `(max(0.0, min_weight), max_weight)`.
- The `max(...)` keeps both modes long-only even if a negative value were ever passed.

**FLAG comments.** Comments only; no code change. Use the exact prefix `# FLAG(custom):` so they can
be found with grep. They go in three places.

Directly above `def compute_capm_expected_returns`:
```python
# FLAG(custom): the `mrp * view` term is not part of CAPM or Black-Litterman. It adds a flat
# return bump per unit of conviction (view 0.20 → +1.0% at mrp 5%). Ported unchanged from main;
# intent to be confirmed with its author before changing. run_optimize adds a second κ bump on
# top of this in max_sharpe_capm mode — see the FLAG there.
```

Directly above `def compute_tilt`:
```python
# FLAG(custom): house conviction tilt, not a textbook method. Each weight is multiplied by
# exp(λ·tanh(view/u0)) and renormalised; u0 = 20 and λ are hand-picked constants. Not used by any
# Optimize mode; reached only through POST /portfolio/tilt. Ported unchanged from main.
```

Directly above `def optimize_max_sharpe_capm`:
```python
# FLAG(custom): the method is standard (max Sharpe on CAPM expected returns). The custom part is
# the expected-returns input, which carries the view bumps — see compute_capm_expected_returns.
```

### 2. `backend/app/optimize_run.py`

- **New keyword argument** on `run_optimize`: `max_short: float = 0.30`, placed after
  `allow_short`. Validate it with the other inputs:
  ```python
  if not math.isfinite(max_short) or not 0.0 <= max_short <= 1.0:
      raise OptimizeInputError("max_short must be between 0 and 1")
  ```
- **Short cap on the fitted sleeve.** Pinned holdings are always long, so the cap for the fitted
  sleeve is `sleeve_short = min(1.0, max_short / fitted_scale) if allow_short else None`. Pass
  `max_short=sleeve_short` to every optimizer in the list from section 1.
- **The short warning** becomes this exact string, formatted with `{max_short:.0%}`:
  `"Short positions enabled (total short capped at 30%). Equal Weight, Risk Parity, and Max Diversification remain long-only."`
- **`rf`:**
  - `max_sharpe` and `max_sortino` get `rf=rf`.
  - Both `compute_metrics` calls get `rf=rf`.
  - Add `rf: float` to `OptimizeResult`, after `delta_mu`, and set it to the `rf` used.
- **Min weight for Risk Parity and Max Diversification:** pass `min_weight=global_min`. It is
  already `0.0` whenever shorting is on.
- **Target Volatility pre-check.** In the `target_volatility` branch, before calling
  `optimize_target_volatility`:
  ```python
  floor_weights = optimize_min_variance(returns, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)
  w_floor = np.array([floor_weights[t] for t in returns.columns])
  floor_vol = float(np.sqrt(w_floor @ (returns.cov().values * 252) @ w_floor))
  if vol_target < floor_vol - 1e-6:
      raise OptimizeInputError(
          f"Vol target ({vol_target:.1%}) is below the lowest volatility the optimized holdings can reach "
          f"({floor_vol:.1%}) within the current weight limits. Raise the target or loosen the limits."
      )
  ```
  - Place it **outside** the `try/except RuntimeError`, or re-raise it, so the 422 is never turned
    into the fallback.
  - If `optimize_min_variance` itself raises `RuntimeError`, the existing fallback handles it.
  - Add `import numpy as np` if it is not already imported.
- **FLAG comments.** Comments only. Directly above the `views_applied = ...` line:
  ```python
  # FLAG(custom): κ views are an ad-hoc additive bump to expected return (kappa × view / 100 per
  # year), not Black-Litterman. In max_sharpe / max_sortino it is added to the historical daily
  # mean; in max_sharpe_capm it is added to CAPM returns that already contain a view term.
  ```
  Directly above the `capm_expected_returns = {ticker: float(value + delta_mu...` statement:
  ```python
  # FLAG(custom): views are counted twice here. compute_capm_expected_returns already added
  # mrp × view, and delta_mu adds kappa × view again (0.05 + 0.05 per unit view by default).
  # main does the same ("Also add kappa-based delta_mu on top"). Left as is pending the author's intent.
  ```

### 3. `backend/app/schemas.py`

- `OptimizeRequest`: add `max_short: float = 0.30` after `allow_short`.
- `OptimizeResponse`: add `rf: float` after `delta_mu`.

### 4. `backend/app/routers/portfolio.py`

- In `optimize_portfolio`, replace the conditional `**({"rf": ...} if body.mode == "max_sharpe_capm" else {})`
  with an unconditional `rf=fetch_risk_free_rate()`.
- Pass `max_short=body.max_short`.
- Add `"rf": result.rf` to the returned dict, after `"delta_mu"`.
- **FLAG comment** directly above the `tilt_weights = compute_tilt(...)` line:
  ```python
  # FLAG(custom): see compute_tilt. The "optimizer" baseline calls optimize_max_sharpe without rf (rf = 0).
  ```
  Check that the `optimizer` baseline really does call `optimize_max_sharpe` without `rf`. If it
  does, keep the second sentence. If it does not, drop the second sentence. Either way, do **not**
  change the tilt code.

### 5. Frontend

**`client.ts`**
- `OptimizeRequest` gains `max_short: number`, after `allow_short`.
- `OptimizeResponse` gains `rf: number`, after `delta_mu`.

**`optimize.ts`**
- `OptimizeSettings` gains `maxShortPct: number   // slider 0–100, step 5`. `DEFAULT_SETTINGS`
  sets `maxShortPct: 30`.
- `buildOptimizeRequest` sends `max_short: settings.maxShortPct / 100` **always**. The backend
  ignores it unless `allow_short` is true.
- `sameSettings` compares `maxShortPct`.
- `metricItems(metrics: OptimizeMetrics | null, rf: number): MetricItem[]`. Define
  `const rfPct = (rf * 100).toFixed(2)` inside it. The tooltips change to:
  - Sharpe: `` `(CAGR − risk-free rate) ÷ volatility. Risk-free rate: 10-year Treasury yield, ${rfPct}% for this run. Above 1 is broadly acceptable; above 2 is excellent.` ``
  - Alpha: `` `Annualised return above what beta to SPY predicts, using the ${rfPct}% risk-free rate` ``
  - Labels, values and the other tooltips are unchanged.

**`OptimizePage.tsx`**
- Pass `response.rf` as the second argument at both `metricItems(...)` call sites.
- Add a slider directly **after** the "Allow short positions" checkbox, inside the same
  `flex flex-col gap-4` column. It follows the Min weight slider's markup:
  - Label: `Max total short: {settings.maxShortPct}%`
  - `<input type="range" min={0} max={100} step={5} disabled={!settings.allowShort} ...>`
  - Wrap it in `<Tooltip dismissOnPointerDown block label={...}>` with the copy from the Tooltips
    section.
- Change the checkbox tooltip's copy as shown in the Tooltips section.

## Out of scope

- **The custom code itself.** Do not change the view double-count, the κ bump, the `mrp × view`
  term or `compute_tilt`. Comments only.
- `backend/app/rates.py`. Use it; do not change it.
- **Showing the risk-free rate anywhere else**, including a Universe-table row. That is a possible
  follow-up and not part of this contract.
- `OptimizerGuide.tsx` copy.
- Min CVaR, Min Variance, Equal Weight and Max Sharpe maths, other than the `rf` and `max_short`
  plumbing above.
- Honouring `min_weight` while shorting. The UI disables it on purpose.
- The CSV export, Apply to Portfolio and the import path.
- New dependencies. SLSQP stays the solver; no split variables and no LP rewrite.

## Acceptance criteria

1. `(cd backend && .venv/bin/python -m pytest -q)` passes. Paste the summary line.
2. `(cd frontend && npm run build)` and `(cd frontend && npm run test)` pass, and
   `npm run lint` reports no new warnings or errors.
3. **New backend tests**, in the named files:
   - **`test_optimizer.py` — Sortino.** On a literal 2-asset fixture, `optimize_max_sortino`'s
     objective at fixed weights equals the hand-computed
     `(mean·252 − rf) / (sqrt(mean(min(r − rf/252, 0)²))·√252)`. Test it through a small public
     re-derivation in the test, not by importing the closure. Also include a case where two
     portfolios have the same negative-day std but different loss sizes, and the optimizer prefers
     the one with smaller losses.
   - **`test_optimizer.py` — short cap.** With `min_weight=-1, max_weight=1` on a fixture where the
     uncapped `optimize_min_variance` or `optimize_max_sharpe` result shorts more than 20%,
     `max_short=0.20` gives `Σ max(−w, 0) ≤ 0.20 + 1e-6`, and the weights still sum to 1.
   - **`test_optimizer.py` — min weight.** `optimize_risk_parity(..., min_weight=0.3)` and
     `optimize_max_diversification(..., min_weight=0.3)` on a 3-asset fixture where the unfloored
     answer puts one asset below 30% now return every weight ≥ 0.3 − 1e-6.
   - **`test_optimize_run.py` — rf.** `run_optimize(..., mode="max_sharpe", rf=0.0)` and
     `rf=0.08` return different `target_weights` on a fixture chosen so the difference is real.
     `result.rf` echoes the input.
   - **`test_optimize_run.py` — target vol.** A target below the floor raises `OptimizeInputError`
     whose message contains `"is below the lowest volatility"`.
   - **`test_optimize_run.py` — fallback test.** The existing
     `test_non_convergence_falls_back_to_current_weights` is rewritten. It now monkeypatches
     `app.optimize_run.optimize_target_volatility` to raise `RuntimeError("boom")`, with a
     reachable `vol_target`, so the fallback path stays covered.
   - **`test_optimize_run.py` — short warning.** The warning test asserts the new exact string, with
     `(total short capped at 30%)` by default. Add a case asserting `max_short=1.5` raises
     `OptimizeInputError`.
   - **`test_api_optimize.py`.** `test_capm_fetches_rate_and_non_capm_does_not` is replaced by a
     test that monkeypatches `fetch_risk_free_rate` to `0.04` and checks two things. First, a
     non-CAPM request returns `rf == 0.04`. Second, `max_short` round-trips: a request with
     `allow_short: true, max_short: 0.1` returns target weights whose total short is ≤ 0.1 + 1e-6.
4. **New or updated frontend tests** in `optimize.test.ts`:
   - The default-request `toEqual` includes `max_short: 0.3`.
   - `maxShortPct: 50` gives `max_short: 0.5`, whether shorting is on or off.
   - `sameSettings` returns false when only `maxShortPct` differs.
   - The `metricItems(..., 0.0427)` Sharpe tooltip contains `4.27%`, and the Alpha tooltip contains
     `4.27% risk-free rate`.
5. `grep -c "FLAG(custom)" backend/app/optimizer.py` prints `3`.
   `grep -c "FLAG(custom)" backend/app/optimize_run.py` prints `2`.
   `grep -c "FLAG(custom)" backend/app/routers/portfolio.py` prints `1`.
6. `git diff backend/app/optimizer.py` shows no change inside the bodies of
   `compute_capm_expected_returns` or `compute_tilt`. The audit checks this by reading the diff.
7. `grep -n "np.std(downside" backend/app/optimizer.py` prints nothing.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string, so any script run without that prefix talks to the **production database**.
> `pytest` is covered by `tests/conftest.py`; ad-hoc scripts are not.

From the repo root. Paste the complete, verbatim output.

```bash
(cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -3)
(cd backend && .venv/bin/python -m pytest -q tests/test_optimizer.py tests/test_optimize_run.py tests/test_api_optimize.py -v 2>&1 | grep -E "PASSED|FAILED|ERROR" )
(cd frontend && npm run build 2>&1 | tail -2)
(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+|FAIL")
(cd frontend && npm run lint 2>&1 | grep -E "warning|error")
grep -c "FLAG(custom)" backend/app/optimizer.py backend/app/optimize_run.py backend/app/routers/portfolio.py
grep -n "np.std(downside" backend/app/optimizer.py; echo "old-sortino exit=$?"
grep -nF 'rf=fetch_risk_free_rate()' backend/app/routers/portfolio.py
grep -nF 'Max total short:' frontend/src/pages/analysis/OptimizePage.tsx
grep -n " title=" frontend/src/pages/analysis/OptimizePage.tsx; echo "title exit=$?"
git diff --stat
git status --short
```

## Tooltips

| Element | Tooltip label |
|---|---|
| Max total short slider (shorting on) | `Cap on the combined size of all short positions, as a share of the portfolio. 30% allows up to 130% long / 30% short.` |
| Max total short slider (shorting off) | `Only used when short positions are allowed` |
| Allow short positions checkbox (changed) | `Let weights go negative, up to the Max total short cap. Equal Weight, Risk Parity and Max Diversification stay long-only.` |

The first label is static text; it does not interpolate the slider value. Switch between the first
two labels on `settings.allowShort`, in the same way as the Min weight slider. Do not use `title=`.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** Restart the backend first (`lsof -nP -iTCP:8000 -sTCP:LISTEN`,
kill it, then relaunch). Then, on the Optimize tab with any portfolio of 3 or more holdings:

1. With **Allow short positions** off, the "Max total short" slider is greyed out, and hovering it
   says it's only used when shorting is on.
2. Turn shorting on, pick **Min Variance** or **Max Sharpe**, set Max total short to 10% and run it.
   The target weights' negative entries add up to 10% or less. The warning line says
   "total short capped at 10%".
3. Hover **Sharpe** in the metrics tiles. It names a rate near today's 10-year Treasury yield, not
   0 and not a stale 4.27% (4.27% appears only if the yfinance fetch failed).
4. Pick **Target Volatility**, drag the target to 5% on a volatile portfolio (e.g. MU-heavy) and run
   it. You get a red error saying the target is below the lowest reachable volatility, not a result
   with "did not converge".

## Open questions

None. Stop and report `BLOCKED` if any of these happen:

- The Sortino fixture from criterion 3 can't be built so that the old and new definitions disagree.
- An existing test outside the ones named above breaks because `rf` now reaches `max_sharpe`.
