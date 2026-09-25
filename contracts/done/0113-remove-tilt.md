# Contract 0113 — Remove the unused tilt engine

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`POST /portfolio/tilt`, `TiltRequest`, `optimizer.compute_tilt` and their five tests no longer exist,
and nothing else changes.

## Why

The tilt engine was ported from `main` in 0103 and 0106, but `main` never made it reachable, and no
rebuild UI calls it. On 2026-09-24 Gunnar decided to delete it rather than maintain unused code. See
REBUILD.md, the "Outlook tab" entry, bullet "Tilt is removed". No frontend file references the route,
so this is backend-only.

## Files

Modify:
- `backend/app/routers/portfolio.py`:
  - delete the whole `tilt_portfolio` route (the `@router.post("/tilt")` decorator through the
    closing `}` of its return dict, currently lines 188–228)
  - delete the line `from app.optimizer import compute_tilt`
  - remove `TiltRequest` from the `from app.schemas import …` line, so it reads exactly
    `from app.schemas import OptimizeRequest, OptimizeResponse, PortfolioSeriesResponse`
  - remove any blank lines left at the end of the file, so it ends with exactly one newline
- `backend/app/schemas.py`:
  - delete `class TiltRequest(BaseModel):` and its eight fields (currently lines 158–166)
  - delete one of the two blank-line pairs so that exactly two blank lines separate the previous
    class from `class PinnedHoldingOut`
- `backend/app/optimizer.py`:
  - delete the three `# FLAG(custom): house conviction tilt …` comment lines and the whole
    `compute_tilt` function (currently lines 253–268)
  - delete the `import math` line: `compute_tilt` was its only user (`grep -n "math\." app/optimizer.py`
    currently shows only line 263)
  - in the module docstring, change `Ported from main's portfolio and tilt modules.` to
    `Ported from main's portfolio module.`
  - `compute_tilt` is the last function in the file, so after the deletion the file must end with
    `optimize_target_volatility`'s `return dict(zip(tickers, result.x.tolist()))` followed by exactly
    one newline and no blank lines
- `backend/tests/test_optimizer.py`:
  - delete `test_tilt_and_empty_tilt` (currently lines 77–79)
  - remove `compute_tilt, ` from the import list. Leave every other imported name, and the list's
    order, unchanged. Re-wrapping that line is fine.
- `backend/tests/test_api_optimize.py`:
  - delete these four functions (currently lines 132–160):
    - `test_tilt_equal_and_current_need_no_database`
    - `test_tilt_optimizer_uses_pinned_run_optimize`
    - `test_tilt_optimizer_default_lookback_requires_two_full_history_holdings`
    - `test_tilt_rejects_unknown_baselines_and_optimizer_modes`
  - the file must end with `test_optimize_requires_database` followed by exactly one newline

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

## Interface

Deletion only. Every other signature, route and schema stays byte-identical. In particular:
- `_normalise_request`, `_load_stored_closes`, `run_optimize` and `OptimizeInputError` stay: the
  `/optimize` route uses them.
- `OptimizeRequest.conviction_views` and `OptimizeRequest.kappa` stay. They belong to the CAPM path,
  not to tilt, and the Outlook contracts decide their fate.
- `math` stays imported in `routers/portfolio.py`. That file is not part of the `import math` deletion.

## Out of scope

- Do not touch any `FLAG(custom)` comment other than the one directly above `compute_tilt`.
- Do not touch `conviction_views`, `kappa`, `max_sharpe_capm` or the CAPM helpers.
- Do not edit the frontend. `OptimizerGuide.tsx`'s phrase "low-vol tilts" is unrelated English and stays.
- Do not edit `contracts/done/`, `REBUILD.md` or `README.md`. The planner owns the docs.
- No refactors or reformatting beyond the lines named above.

## Acceptance criteria

1. **Before any edit**, `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)`
   reports `634 passed`. If it reports a different count, stop and report `BLOCKED` with the output.
2. After the edits, the same command reports `629 passed` (634 − 5) and no failures or errors.
3. `grep -rni "tilt" backend/app backend/tests --include='*.py'` prints nothing and exits 1.
4. `grep -n "^import math" backend/app/optimizer.py` prints nothing.
5. `grep -n "^import math" backend/app/routers/portfolio.py` still prints `3:import math`.
6. `git diff --numstat -- backend/` lists exactly the five files named above, and every row's
   "added" column is ≤ 3. The only additions allowed are the rewritten docstring line, the rewritten
   schemas import line, and the re-wrapped test import lines.
7. `git status --short` shows no new or modified files outside `backend/app/routers/portfolio.py`,
   `backend/app/schemas.py`, `backend/app/optimizer.py`, `backend/tests/test_optimizer.py`,
   `backend/tests/test_api_optimize.py`, `contracts/0113-remove-tilt.md` and
   `contracts/0113-remove-tilt.report.md`. Pre-existing changes to `REBUILD.md` and `README.md` are
   the planner's and are expected.
8. The following prints `404` and then `True False` (the last two lines of output; a
   `StarletteDeprecationWarning` above them is pre-existing and expected). That proves the route is
   gone and `/optimize` still exists. Before the edit, the same script prints `200` then `True True`.
   ```bash
   (cd backend && DATABASE_URL="" .venv/bin/python -c "
   from fastapi.testclient import TestClient
   from app.main import app
   c = TestClient(app)
   print(c.post('/portfolio/tilt', json={'tickers':['A','B'],'weights':[1,1]}).status_code)
   paths = app.openapi()['paths']
   print('/portfolio/optimize' in paths, '/portfolio/tilt' in paths)
   ")
   ```
9. `backend/tests/test_api_optimize.py`, `backend/app/routers/portfolio.py` and
   `backend/app/optimizer.py` each end in exactly one newline: `tail -c 2 <file> | xxd -p` prints a
   value ending in `0a` but not `0a0a` for all three.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string — so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.
>
> **`DATABASE_URL=""` is the only ambient value that works.** Setting it to a real throwaway URL
> raises at import, because `config.py`'s conflict guard (contract 0041) rejects any *non-empty*
> ambient value that differs from `.env`. That is by design.

Run each of these from the repo root and paste the **complete, verbatim** output into the report,
including failures. Do not summarize, trim or clean up.

```bash
# before editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)
# after editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)
grep -rni "tilt" backend/app backend/tests --include='*.py'; echo "exit=$?"
grep -n "^import math" backend/app/optimizer.py; echo "exit=$?"
grep -n "^import math" backend/app/routers/portfolio.py
git diff --numstat -- backend/
git status --short
(cd backend && DATABASE_URL="" .venv/bin/python -c "
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
print(c.post('/portfolio/tilt', json={'tickers':['A','B'],'weights':[1,1]}).status_code)
paths = app.openapi()['paths']
print('/portfolio/optimize' in paths, '/portfolio/tilt' in paths)
")
tail -c 2 backend/tests/test_api_optimize.py | xxd -p
tail -c 2 backend/app/routers/portfolio.py | xxd -p
tail -c 2 backend/app/optimizer.py | xxd -p
```

## Human verification — does Gunnar need to run anything?

- **Nothing to run.** No UI calls the route, so there is no visible change. The tests and the audit
  are the whole verification.

## Open questions

None. If a sixth tilt reference turns up anywhere in `backend/`, or the before-count is not 634,
report `BLOCKED` rather than guessing.
