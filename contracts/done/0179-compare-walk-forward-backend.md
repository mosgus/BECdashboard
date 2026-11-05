# Contract 0179 — Compare Optimizers: walk-forward folds + "match current" vol target (backend)

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

After this contract, `POST /portfolio/compare` returns several yearly out-of-sample folds as well as today's single holdout. The default is 4 folds. Fold 1 is the existing holdout.

`vol_target` can also be `null`. Null means "match the current portfolio's volatility over the same fit window", so Target Volatility no longer fails on every all-equity portfolio.

## Why

Gunnar ran `contracts/tools/walk_forward_probe.py` on the Magnificent 7 on 2026-10-26:
- The holdout ranking was different every year. Mean pairwise Spearman across 4 folds was −0.29, which is below random.
- In-sample rank did not predict holdout rank (−0.12).
- Equal weight had the best mean holdout Sharpe.

The single 12-month holdout that Compare Optimizers highlights today is therefore one draw from a noisy process. Walk-forward shows the spread. This generalises 0171's holdout rather than building a second engine, as REBUILD.md "Research Order" step 4 says.

The same run showed Target Volatility failing in every fold. The 10% default sits below the 24–29% floor that an all-equity sleeve can reach.

Gunnar chose a default of 4 folds and skipped a BEC run (2026-10-26). Folds that lack history are skipped and named.

## Files

Modify:
- `backend/app/compare_run.py`:
  - extract the holdout block into a fold helper and loop over folds;
  - resolve `vol_target=None`;
  - add the new dataclasses.
- `backend/app/schemas.py`:
  - `CompareRequest`: `folds` added, `vol_target` made optional;
  - new `FoldOut` and `FoldModeOut`;
  - `CompareResponse`: `folds` and `vol_target` added.
- `backend/app/routers/portfolio.py`: pass `folds` and `vol_target` through, and serialise the new fields.
- `backend/tests/test_compare_run.py`: new tests (below).
- `backend/tests/test_api_compare.py`: shape test extended.
- `frontend/src/api/client.ts`: **types only**.
  - `CompareRequest.vol_target: number | null`, and `folds?: number`.
  - New `CompareFold` and `CompareFoldMode` interfaces.
  - `CompareResponse.folds: CompareFold[]` and `vol_target: number`.
  
  This keeps `tsc` green for the frontend contract that follows. No UI changes.
- `frontend/src/lib/research.test.ts` and `frontend/src/lib/memo.test.ts`: add `folds: []` and `vol_target: 0.1` to every `CompareResponse` fixture, so `tsc` still passes. This is the only change allowed in these two files.

**Touch nothing else.** In particular, do not touch `optimize_run.py` or `optimizer.py`. Historical Optimize keeps its numeric `vol_target`. If the work seems to need another file, stop and report `BLOCKED`.

## Interface

### `compare_run.py`

```python
WALK_FORWARD_FOLDS = 4

@dataclass(frozen=True)
class FoldMode:
    mode: str
    holdout: CompareMetrics | None
    error: str | None          # None when holdout is set, or when the mode was not attempted (see rule 4)

@dataclass(frozen=True)
class Fold:
    fold: int                  # 1 = most recent year
    cut: date                  # fit uses closes ≤ cut
    score_end: date            # nominal end of the scored year
    fit_start: date | None
    fit_end: date | None
    score_start: date | None
    tickers: list[str]         # eligible holdings
    excluded: list[str]        # holdings with no price on or before cut
    vol_target: float | None   # resolved target used in this fold's fit; None if the fold is unavailable
    unavailable: str | None    # set ⇒ current is None and modes is []
    current: CompareMetrics | None
    modes: list[FoldMode]      # MODES order, one per mode

def run_compare(..., vol_target: float | None = 0.10, ..., folds: int = WALK_FORWARD_FOLDS) -> CompareResult
```

`CompareResult` gains `folds: list[Fold]` (always `folds` entries, fold 1 first) and `vol_target: float` (the resolved in-sample target).

### Rules

1. **Fold windows.**
   - `end = min(closes[t].index[-1] for t in weights)`, as today.
   - For fold k: `score_end_k = end - timedelta(days=(k-1)*HOLDOUT_DAYS)` and `cut_k = score_end_k - timedelta(days=HOLDOUT_DAYS)`.
   - Eligible holdings are those with `closes[t].index[0] <= cut_k`.
   - Fit on closes `≤ cut_k` with the same `common` kwargs.
   - Score on closes in `[fit_end, score_end_k]`, using `backtest_series` and `_score`, exactly as the current holdout does.
   
   The only new thing is the upper bound `≤ score_end_k`. For k=1 that is `end`, so fold 1 is unchanged.
2. **Unavailable folds.**
   - If fewer than 2 holdings are eligible, set `unavailable` to the same wording as today's message, using that fold's cut.
   - If the fold's equal-weight fit raises `OptimizeInputError`, set `unavailable = f"Fold fit: {exc}"`.
   
   An unavailable fold has `current=None`, `modes=[]` and `vol_target=None`, and its fit/score dates are None.
3. **Fold 1 must reproduce today's output exactly.** `CompareResult.holdout`, `holdout_unavailable`, each `ModeRow.holdout` / `holdout_weights` / `holdout_error`, and `current.holdout` are all derived from fold 1, and their values must not change. The existing 13 tests in `test_compare_run.py` must pass **unmodified**. Write the loop once and derive these fields from fold 1's results; do not keep a second copy of the holdout code.
4. **Mode errors inside a fold.**
   - A mode whose **in-sample** fit errored is not attempted in any fold: `FoldMode(holdout=None, error=None)`. This matches today, where it has no holdout and no holdout error.
   - A per-fold `OptimizeInputError` gives `error=str(exc)`.
   - A non-converged fit gives `error="The optimizer did not converge on the holdout fit."`, the existing string.
5. **`vol_target=None` means match current.**
   - For the in-sample fit and for each fold, run equal weight first, as the code already does.
   - Take `equal_run.metrics["current"]["vol"]`. For folds, use that fold's equal-weight run.
   - Use that value as `vol_target` for that fit's other seven modes.
   - If that vol is missing or not finite, fall back to `0.10`.
   - A numeric `vol_target` behaves exactly as today. The resolved value is reported in `CompareResult.vol_target` and in `Fold.vol_target`.
   - Approximation, to note in a code comment: with pinned holdings, "current vol" covers the whole portfolio, while the target constrains the fitted sleeve.
6. **`folds` bounds.** The schema uses `Field(4, ge=1, le=6)`. `run_compare` may assume 1 ≤ folds ≤ 6.

### Schema / API

- `CompareRequest`: `vol_target: float | None = None` (API default changes to match current) and `folds: int = Field(4, ge=1, le=6)`.
- `FoldModeOut {mode, holdout: CompareMetricsOut | None, error: str | None}`.
- `FoldOut`:
  - `fold, cut, score_end, fit_start, fit_end, score_start, tickers, excluded, vol_target, unavailable`;
  - `current: CompareMetricsOut | None`;
  - `modes: list[FoldModeOut]`.
- `CompareResponse` adds `folds: list[FoldOut]` and `vol_target: float`.

The Python `run_compare` default stays `vol_target=0.10`, so existing unit tests are unaffected. Only the HTTP default becomes `None`.

### `client.ts` (types only)

These mirror the schema exactly:
- dates are `string`;
- `CompareRequest.vol_target: number | null`;
- `CompareRequest.folds?: number`.

`buildCompareRequest` in `lib/research.ts` still sends a number, which stays valid, so no other frontend file changes.

## Tests to add (`test_compare_run.py`)

Build a longer fixture: about 6 years of business days (`pd.bdate_range("2019-01-02", "2024-12-31")`), using the same `prices()` helper and patterns as A/B/C. Include one holding that starts in 2022.

1. `folds=4` gives 4 folds, numbered 1–4. Each `cut` is 365 days before its `score_end`. Each fold's `score_end` is 365 days before the previous one's. Fold 1's `score_end` equals `end`.
2. No look-ahead in any fold:
   - every fold's `fit_end <= cut`;
   - its `score_start >= fit_end`;
   - recomputing a fold mode's holdout by hand gives the same Sharpe: `run_optimize` on closes `≤ cut`, then `backtest_series` on `[fit_end, score_end]`, then `_score`.
3. The young holding is in `excluded` for folds whose cut is before its first bar, and in `tickers` otherwise.
4. On the existing 2-year fixture with `folds=4`, folds 2–4 are `unavailable`, with `current=None` and `modes=[]`. Fold 1 matches `result.holdout`.
5. Fold 1 equals the legacy fields for every mode: `fold1.modes[i].holdout == result.modes[i].holdout` and `fold1.current == result.current.holdout`.
6. `vol_target=None`:
   - `result.vol_target == pytest.approx(equal_run.metrics["current"]["vol"])`, where `equal_run` is the in-sample equal-weight `run_optimize`;
   - target_volatility has `error is None`;
   - each available fold's `vol_target` is a float.
7. Numeric `vol_target=0.10` gives `result.vol_target == 0.10`, and the existing infeasible test still passes.

`test_api_compare.py`: extend the shape test so that:
- `len(body["folds"]) == 4`;
- every fold carries all the keys above;
- `"vol_target" in body`.

Add one request without `vol_target` that returns 200. Add `folds: 0` and `folds: 7`, which must return 422.

## Out of scope

- Any UI. That is contract 0180, which consumes `folds`.
- Historical Optimize's vol target.
- Fold summaries (mean, beat-equal-weight counts). The frontend computes them.
- Performance work. All folds × 8 modes is roughly 40 fits, and the probe ran 4 folds in a few seconds. Do not add threads.
- Rebalancing inside a fold, or anchored vs rolling options.

## Acceptance criteria

1. `cd backend && ./.venv/bin/python -m pytest -q` → all pass. Report the count before and after.
2. `git diff --stat -- backend/tests/test_compare_run.py` shows only **additions** before the new tests. Confirm with `git diff -U0 backend/tests/test_compare_run.py | grep '^-[^-]'` → no output.
3. `grep -n "HOLDOUT_DAYS" backend/app/compare_run.py` → the constant is still used by the fold loop. There is no second holdout implementation: `grep -c "backtest_series(" backend/app/compare_run.py` must not increase by more than 1 over the current count. Report both counts.
4. `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → exit 0, and `cd frontend && npx vitest run` → all pass (415).
5. `git diff --stat` → only the files listed above.

## Verification to run and paste

> Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`. Use pytest fixtures for anything that needs a database.

```bash
cd backend && ./.venv/bin/python -m pytest -q 2>&1 | tail -3
git diff -U0 backend/tests/test_compare_run.py | grep '^-[^-]'
grep -c "backtest_series(" backend/app/compare_run.py
cd frontend && npx tsc --noEmit -p tsconfig.app.json; echo tsc=$?
cd frontend && npx vitest run 2>&1 | tail -4
git diff --stat
```

## Tooltips

None. No UI in this contract.

## Human verification

- **Nothing to run.** The backend is covered by tests. The planner audits the diff, and the visible check comes with 0180. Restart uvicorn before 0180's check.

## Open questions

None. If fold 1 cannot reproduce the legacy fields exactly, stop and report `BLOCKED` with the differing values. Do not adjust the old tests.
