# Report — Contract 0005

**Outcome:** COMPLETE
**Agent:** sonnet

## What I did

- `backend/app/models.py:24` — added `adj_close: Mapped[float | None] = mapped_column(Float)` to `PriceBar`, positioned after `close`. Nullable, no other schema change.
- `backend/migrations/versions/0002_add_adj_close.py` (new) — `revision = "0002"`, `down_revision = "0001"`. `upgrade()` does `op.add_column("price_bars", sa.Column("adj_close", sa.Float(), nullable=True))`; `downgrade()` drops it.
- `backend/app/cache.py`:
  - `_OHLCV_COLUMNS` (`:12`) is now six: `("open", "high", "low", "close", "adj_close", "volume")`.
  - `_normalize_ohlcv()` (`:66-90`) — see the before/after below; this is the actual fix.
  - `_read_from_db()` (`:93-114`) — reads `row.adj_close` into the frame alongside the other five columns; unchanged otherwise.
  - `_write_to_db()` (`:117-135`) — writes `adj_close` through `_clean(row.get("adj_close"), float)`; the upsert `SET` clause (`:141`) already iterated `_OHLCV_COLUMNS` generically, so it picked up the sixth column with no change at all.
- `backend/tests/test_cache_backend.py` — `_ohlcv_df` fixture takes an optional `adj_closes` param, defaulting to all-`NaN` (matching what normalization produces when a caller omits it), so every existing call site needed no changes. Added the two required cases (below).
- `backend/tests/test_models.py` — added `test_price_bars_adj_close_round_trip` (stores a value deliberately different from `close`, reads it back) and `test_price_bars_adj_close_is_nullable` (a row stored without it doesn't raise).

### Before/after of `_normalize_ohlcv`'s column handling

**Before (0004):**
```python
out = out[[col for col in _OHLCV_COLUMNS if col in out.columns]]
```
Selected only columns the caller happened to supply — five in, five out. A caller who omitted a
column got a narrower frame, not a filled one.

**After (0005):**
```python
out = out.reindex(columns=list(_OHLCV_COLUMNS))
```
`DataFrame.reindex(columns=...)` selects existing columns *and* creates any missing ones (filled
with `NaN`), in exactly the specified order, in one call. A caller who omits `adj_close` (or, in
principle, any other column) gets it back as an all-`NaN` column instead of a narrower frame —
which is what makes a five-column caller input and `_read_from_db`'s always-six-column output
converge on the same shape. The subsequent per-column `.astype(...)` calls (float64 ×5, Int64 for
volume) work identically whether the source was real data or the `NaN` reindex produced —
`float64` NaN casts to `Int64`'s `pd.NA` cleanly, no special-casing needed.

### `Adj Close` → `adj_close` mapping

```python
out.columns = [str(col).lower().replace(" ", "_").replace("-", "_") for col in out.columns]
```
`"Adj Close".lower()` → `"adj close"` → replace `" "` → `"adj_close"`. The `.replace("-", "_")` is
there per the contract's instruction to handle hyphens too, though I didn't find a real yfinance
column that uses one — it's a no-op for the columns that actually exist today, cheap insurance if
a future field does.

## Commands run

```
$ ls -1 backend/migrations/versions/
0001_initial.py
0002_add_adj_close.py
__pycache__

$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
........................                                                 [100%]
24 passed in 0.40s
(20 → 24: two new cases in test_cache_backend.py, two in test_models.py)

$ git diff --stat backend/tests/test_cache.py ; echo "(empty = 0001 tests untouched)"
(empty = 0001 tests untouched)

$ grep -n "adj_close" backend/app/models.py backend/app/cache.py backend/migrations/versions/0002_add_adj_close.py
backend/app/models.py:24:    adj_close: Mapped[float | None] = mapped_column(Float)
backend/app/cache.py:12:_OHLCV_COLUMNS = ("open", "high", "low", "close", "adj_close", "volume")
backend/app/cache.py:69-78: [docstring references]
backend/app/cache.py:86:    for col in ("open", "high", "low", "close", "adj_close"):
backend/app/cache.py:109:            "adj_close": [row.adj_close for row in rows],
backend/app/cache.py:132:                "adj_close": _clean(row.get("adj_close"), float),
backend/migrations/versions/0002_add_adj_close.py:1,3,25,29: [docstring + upgrade/downgrade bodies]

$ grep -n "revision\|down_revision" backend/migrations/versions/0002_add_adj_close.py
revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"

$ grep -rn "ForeignKey" backend/app/models.py ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ grep -rnE "DELETE|delete\(\)" backend/app/cache.py ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "from fastapi.testclient import TestClient; from app.main import app; r = TestClient(app).get('/health'); assert r.status_code == 200; print('health 200, degraded mode intact')"
health 200, degraded mode intact
```

Also verified (not in the contract's list, but load-bearing for criterion 2): `git status --short backend/` shows no diff against `app/main.py`, `app/db.py`, `app/config.py`, `requirements.txt`, `requirements-dev.txt`, or anything under `frontend/` — only the five Files-list entries plus the pre-existing untracked files from contract 0004.

## Deviations from the contract

None. The `.replace("-", "_")` hyphen handling and the `reindex`-based fill were both explicitly requested/implied by the contract text ("space and hyphen both to underscore," "Fill, don't filter") — not additions of mine.

## Not done

Nothing from the Files/Interface/Acceptance-criteria lists.

## Gaps and uncertainty

- **`reindex`'s NaN-fill-then-astype path for `Int64` is untested in isolation.** I'm relying on `pd.Series([NaN, NaN], dtype="float64").astype("Int64")` producing `<NA>` cleanly, which it does here (confirmed by `test_shape_consistency_without_adj_close` passing), but I haven't tested a mixed case — a `volume` column that's *entirely* missing (not just some rows) with *other* rows present in the same store() call across multiple calls. Only whole-frame omission is tested.
- **The `_looks_like_ohlcv` guard now checks against a six-element tuple that includes `adj_close`.** A caller passing a frame with *only* an `adj_close`-like column and nothing else (no open/high/low/close/volume) would now be treated as OHLCV-shaped and get force-normalized to six columns, filling the other five with NA. This is a pre-existing heuristic I didn't add, extended by one more member automatically — flagging it because it's a slightly larger surface than before, not because I think it's wrong.
- **No test exercises the migration itself** (`alembic upgrade`), per the contract's explicit instruction not to run it against any database. `0002_add_adj_close.py` is verified by `py_compile` and by the `grep` checks above, not by execution.
- I have not re-tested contract 0004's own scenario (real yfinance data flowing through `store()` in a way that exercises the dialect-aware Postgres upsert) — still SQLite-only, as before, and still an open gap from the prior round.

## Files changed

```
$ git status --short backend/app/models.py backend/app/cache.py backend/tests/test_cache_backend.py backend/tests/test_models.py backend/migrations/
 M backend/app/cache.py
 M backend/app/models.py
 M backend/tests/test_cache_backend.py
 M backend/tests/test_models.py
?? backend/migrations/
```

(`backend/migrations/` shows untracked because the whole directory was untracked from contract 0004; `0002_add_adj_close.py` is the only new file inside it from this contract.)

---

## Audit — Planner only

**Verdict:**

**Verification I re-ran myself:**

**Findings:**

**Follow-up contracts filed:**
