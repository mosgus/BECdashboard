# Contract 0120: remove the dead CAPM / κ-view path from `/portfolio/optimize`, and merge `isValidCurrentPortfolio`

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract:

- `POST /portfolio/optimize` no longer knows about `max_sharpe_capm`, `conviction_views`, `kappa`, `delta_mu`, `views_applied`, `capm_expected_returns` or `forward_looking` metrics.
- The frontend has exactly one `isValidCurrentPortfolio`, the one in `lib/portfolio.ts`.

## Why

- CAPM now has its own route (`POST /portfolio/capm`, 0115) and its own tab (0118/0119).
- The old CAPM mode inside `/optimize` was never reachable from the rebuild UI: `OPTIMIZE_MODES` doesn't list it, and `buildOptimizeRequest` never sends views. REBUILD.md records it as unreachable.
- It also counts every view twice, adding `mrp × view` and then `κ × view` again (the `FLAG(custom)` in `optimize_run.py`).
- Gunnar decided on 2026-09-26 to delete it rather than keep a second, subtly different CAPM around.
- `lib/portfolioStore.ts` holds a private copy of `isValidCurrentPortfolio` (with its own `isValidCurrentPosition` and `hasUniqueTickers`). It behaves identically to the exported one in `lib/portfolio.ts`. Two copies of a validator can drift apart, so keep one.

**Keep everything that `capm_run.py` uses:**

- `optimizer.optimize_max_sharpe_capm`
- `optimizer.compute_capm_expected_returns`
- `optimizer.compute_betas`
- `optimizer.compute_returns`
- `optimize_run.LOOKBACK_DAYS`
- `optimize_run.PIN_GRACE_DAYS`

## Files

Modify:

- `backend/app/optimize_run.py`
- `backend/app/optimizer.py` (the module docstring, one comment, and the deletion of `compute_forward_looking_metrics`)
- `backend/app/schemas.py`
- `backend/app/routers/portfolio.py`
- `backend/tests/test_optimize_run.py`
- `backend/tests/test_api_optimize.py`
- `backend/tests/test_optimizer.py`
- `frontend/src/api/client.ts`
- `frontend/src/lib/optimize.test.ts`
- `frontend/src/lib/portfolioStore.ts`

**Touch nothing else.** `capm_run.py`, `test_capm_run.py`, `test_api_capm.py`, `lib/capm.ts`, `lib/portfolio.ts`, `OptimizePage.tsx` and every `.tsx` file stay byte-identical. If the work appears to need another file, stop and report `BLOCKED`.

`reference files/` is read-only and never belongs on a file list.

## Changes

### Backend

**`optimize_run.py`**

1. `Mode`: delete `"max_sharpe_capm"`. The list becomes `"equal_weight", "min_variance", "max_sharpe", "risk_parity", "max_sortino", "min_cvar", "max_diversification", "target_volatility"`.
2. Delete the constant `BENCHMARK = "SPY"`. Only the CAPM branch uses it.
3. Imports from `app.optimizer`: delete `compute_betas`, `compute_capm_expected_returns`, `compute_forward_looking_metrics` and `optimize_max_sharpe_capm`. Keep the rest.
4. `OptimizeResult`: delete the fields `capm_expected_returns`, `views_applied` and `delta_mu`.
5. `run_optimize`: delete the parameters `conviction_views` and `kappa`.
6. Delete the whole `# FLAG(custom): κ views …` comment, the `views_applied = …` line, the `delta_mu = (…)` block, and `capm_expected_returns: dict[str, float] | None = None`.
7. `max_sharpe` branch: it becomes a single line, with no `bumped` copy:
   `fitted_weights = optimize_max_sharpe(returns, rf=rf, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)`
8. `max_sortino` branch: the same change:
   `fitted_weights = optimize_max_sortino(returns, rf=rf, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)`
9. Delete the entire `elif mode == "max_sharpe_capm":` branch, including its `FLAG` comment.
10. Delete the `forward_looking = (…)` block. `metrics` becomes:
    ```python
    metrics = {
        "current": compute_metrics(current_returns, benchmark_returns, rf=rf),
        "optimized": compute_metrics(optimized_returns, benchmark_returns, rf=rf),
    }
    ```
11. In the `OptimizeResult(...)` return, delete the `capm_expected_returns=…`, `views_applied=…` and `delta_mu=…` arguments.

The `benchmark` parameter stays: it still drives the SPY comparison curve and the beta/alpha metrics.

**`optimizer.py`**

1. Replace the first three lines of the module docstring and the `max_sharpe_capm` bullet. The docstring's first lines become:
   ```
   """Portfolio analytics: returns, metrics, equity curve, optimizers.

   Eight optimization modes (run_optimize):
   ```
   Keep the other eight bullets as they are. After the last bullet (`target_volatility`), add:
   ```

   optimize_max_sharpe_capm is not a run_optimize mode; capm_run uses it for the Outlook CAPM tab.
   ```
   Then keep the existing "Ported from main's portfolio module…" paragraph.
2. In the `FLAG(custom)` comment above `compute_capm_expected_returns`, delete the last sentence: "run_optimize adds a second κ bump on top of this in max_sharpe_capm mode — see the FLAG there." Keep the rest of that comment, and keep the `FLAG` above `optimize_max_sharpe_capm`.
3. Delete the function `compute_forward_looking_metrics`. After step 10 above, nothing calls it: `capm_run.py` computes its own metrics. Verify this with the grep in the acceptance criteria before deleting.

**`schemas.py`**

- `OptimizeRequest`: delete `conviction_views` and `kappa`.
- `OptimizeResponse`: delete `capm_expected_returns`, `views_applied` and `delta_mu`.
- Leave everything else unchanged, including the `Capm*` models.
- Pydantic ignores unknown request fields by default, so an old client that still sends `kappa` gets a normal 200. That is fine. Do not add `extra="forbid"`.

**`routers/portfolio.py`**, in `optimize_portfolio`:

- Delete the `conviction_views = (…)` block.
- Delete `conviction_views=conviction_views, kappa=body.kappa,` from the `run_optimize` call. `rebalance=body.rebalance` stays.
- Delete `"capm_expected_returns"`, `"views_applied"` and `"delta_mu"` from the returned dict.
- Do not touch the CAPM route.

**Tests:**

- **`test_optimize_run.py`:**
  - Delete `test_capm_returns_expected_returns_and_forward_looking_metrics`, `test_capm_requires_spy` and `test_views_are_only_applied_by_return_based_modes`.
  - Add, where they were:
    ```python
    def test_capm_mode_is_no_longer_an_optimize_mode():
        with pytest.raises(OptimizeInputError, match="unknown optimization mode"):
            run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, mode="max_sharpe_capm", lookback_days=365)
    ```
- **`test_api_optimize.py`:**
  - Rename `test_missing_spy_is_optional_except_for_capm` to `test_missing_spy_is_optional`, and delete its last three lines (the `capm = …` request and its two asserts).
  - In `test_optimize_errors`'s `parametrize` list, add the case `({"tickers": ["A", "B"], "weights": [1, 1], "mode": "max_sharpe_capm"}, 422)`.
- **`test_optimizer.py`:** delete `test_forward_looking_metrics`, and remove `compute_forward_looking_metrics` from the import.

### Frontend

**`api/client.ts`**

- `OptimizeRequest`: delete `conviction_views?` and `kappa?`.
- `OptimizeResponse`:
  - delete `capm_expected_returns`, `views_applied` and `delta_mu`
  - delete `forward_looking` from `metrics`, which becomes `{ current: OptimizeMetrics | null; optimized: OptimizeMetrics | null }`, keeping the existing multi-line layout

**`lib/optimize.test.ts`**

- In the `RESPONSE` fixture, delete `forward_looking: null`, `capm_expected_returns: null`, `views_applied: false` and `delta_mu: {}`. Keep every other key on its line.
- In `builds the default request from a portfolio`, delete the two lines `expect('kappa' in req).toBe(false)` and `expect('conviction_views' in req).toBe(false)`. The `toEqual` above them already pins the exact request shape.
- In `falls back to the raw mode string when unlisted`, change both `'max_sharpe_capm'` strings to `'not_a_mode'`.

**`lib/portfolioStore.ts`**

- Delete the private `isValidCurrentPosition`, `hasUniqueTickers` and `isValidCurrentPortfolio`.
- Import `isValidCurrentPortfolio` from `./portfolio`, adding it to the existing `import { WEIGHT_EPSILON } from './portfolio'` line.
- Keep `isFiniteNumber`, `isValidLegacyPosition` and `isValidLegacyPortfolio`: the legacy checks still use them.
- Remove `Position` from the type import if it is no longer used. The build and lint will tell you.
- The two implementations accept exactly the same values; the planner compared them line by line. Do not change `lib/portfolio.ts`.

**Formatting:** keep the existing layout of every file you edit. Do not collapse lines. The line-length check below enforces this.

## Out of scope

- Do not change CAPM (`capm_run.py`, `/portfolio/capm`, `lib/capm.ts`, anything in `pages/analysis/outlook/`).
- Do not delete `optimize_max_sharpe_capm`, `compute_capm_expected_returns` or `compute_betas`.
- Do not change the `mrp × view` term or its `FLAG` above `compute_capm_expected_returns`.
- Do not touch `OptimizerGuide.tsx`, `OptimizePage.tsx` or `lib/optimize.ts`.
- Do not add a formatter or any dependency.

## Acceptance criteria and verification (paste the complete output of each command)

```bash
git status --short
(cd backend && PYTHONPATH=. DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)
(cd frontend && npx vitest run 2>&1 | grep -E "^ +Tests")
(cd frontend && npm run build 2>&1 | tail -2)
(cd frontend && npm run lint 2>&1 | grep -E "warning|error")
grep -rn "max_sharpe_capm\|conviction_views\|kappa\|delta_mu\|views_applied\|capm_expected_returns\|forward_looking\|BENCHMARK" backend/app/optimize_run.py backend/app/schemas.py backend/app/routers/portfolio.py frontend/src/api/client.ts frontend/src/lib/optimize.test.ts
grep -rn "compute_forward_looking_metrics" backend frontend/src
grep -c "def optimize_max_sharpe_capm\|def compute_capm_expected_returns\|def compute_betas" backend/app/optimizer.py
grep -rn "function isValidCurrentPortfolio\|function isValidCurrentPosition\|function hasUniqueTickers" frontend/src/lib
git diff --stat -- backend/app/capm_run.py backend/tests/test_capm_run.py backend/tests/test_api_capm.py frontend/src/lib/capm.ts frontend/src/lib/portfolio.ts frontend/src/lib/optimize.ts frontend/src/pages
awk 'length > 300 { print FILENAME": "FNR }' backend/app/optimize_run.py frontend/src/api/client.ts frontend/src/lib/portfolioStore.ts frontend/src/lib/optimize.test.ts
git diff -- backend/app/capm_run.py | wc -l
node contracts/tools/smoke-render.mjs optimize 2>&1 | cut -c1-200 | head -3
node contracts/tools/smoke-render.mjs outlook 2>&1 | cut -c1-200 | head -3
```

Expected:

1. `git status --short`: run it **before editing** and paste it. It will show uncommitted files from earlier contracts (0119 and others); leave them alone.
2. Backend: **657 passed**. The count before is 659: 3 tests are deleted and 1 added in `test_optimize_run`, 1 parametrized case is added in the API test, and 1 test is deleted in `test_optimizer`. If the count before is not 659, the target is that number minus 2.
3. Vitest: **175 passed**, unchanged. No test is added or removed; two assertions are.
4. The build exits 0.
5. Lint shows only `HelpSidebar.tsx:44` and `UniversePage.tsx:60`.
6. The first grep prints nothing.
7. The `compute_forward_looking_metrics` grep prints nothing.
8. The count of kept functions is `3`.
9. The validator grep prints exactly one line: `frontend/src/lib/portfolio.ts:…: export function isValidCurrentPortfolio`. The line for `isValidCurrentPosition` in `portfolio.ts` is private and is also allowed. Nothing from `portfolioStore.ts` may appear.
10. The `git diff --stat` of the files that must not change is empty, **except** that `capm.ts` may already show uncommitted 0119 changes if Gunnar hasn't committed yet. In that case, paste `git diff --stat` for it from before and after your edits; they must be identical.
11. The `awk` line-length check prints nothing.
12. The `capm_run.py` diff count is unchanged from before your edits.
13. Both smoke renders: no `EXCEPTION` line, and `ROOT TEXT` is non-empty. They need Gunnar's dev server on :5173. If it isn't running, say so; do not start one.

## Human verification (Gunnar)

1. Optimize tab: run **Max Sharpe** and **Max Sortino** once each. They give results as before, with no error.
2. Portfolios list and Holdings still load the saved portfolios, which shows the merged validator reads storage correctly.

## Open questions

None known. If the code differs from what this contract quotes, report `BLOCKED` with the difference rather than choosing. For example: another caller of `compute_forward_looking_metrics`, a frontend reader of `forward_looking` / `delta_mu`, or a behavioural difference between the two validators.

## Acceptance (planner, 2026-09-26)

- The diff matches the contract.
  - The eight modes remain, and `max_sharpe` / `max_sortino` use the unbumped returns.
  - `optimize_max_sharpe_capm`, `compute_capm_expected_returns` and `compute_betas` are intact.
  - `portfolioStore.ts` imports the single validator.
- The one change beyond the file's edit list, splitting the `optimizeCsv` assertion across lines in `optimize.test.ts`, was forced by this contract's own line-length check. It is accepted.
- The smoke checks failed in the coder's harness: Chrome answered `/json` before it had opened a page.
  - Fixed in `contracts/tools/smoke-render.mjs`, which now waits for a page target and creates one if none appears.
  - The planner re-ran it: optimize, outlook and holdings all render with no exception.
- Results: backend 657 passed; vitest 175 passed; build succeeds; lint baseline unchanged.
