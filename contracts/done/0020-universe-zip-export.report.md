# Report — Contract 0020 — Download the whole universe as a zip

**Status:** reported

## Summary

`GET /universe/export.zip` returns a zip of one CSV per active ticker with stored history,
declared above `/{ticker}` per the route-ordering trap. A `Download Universe` anchor sits below
the table, always downloading everything regardless of the active filter.

Files exactly as listed:
- `backend/tests/test_export_zip.py` (new) — all 13 required cases.
- `backend/app/export.py` — added `build_universe_zip`, pure.
- `backend/app/routers/universe.py` — one new route, declared before `/{ticker}`.
- `frontend/src/pages/UniversePage.tsx` — the anchor.

No other files touched.

## Criterion 4 — the two line numbers

```
48:@router.get("/export.zip")
72:@router.get("/{ticker}", response_model=UniverseDetail)
```
48 < 72 — `export.zip` is declared first.

## Archive size for a nine-ticker universe

Measured, not repeated from the contract's own estimate: built a synthetic 9-ticker universe
(2,689 daily bars each, matching the real universe's actual bar count) through the real
`build_universe_zip`/`history_to_csv` path and measured the output directly (script written,
run, and deleted — not left in the repo):

```
tickers: 9, rows each: 2689
uncompressed total: 2,736,397 bytes (2.74 MB)
zip archive size: 185,630 bytes (0.19 MB)
```

Matches the contract's own scaling note (~2.7MB uncompressed, well under 1MB zipped) closely —
confirmed rather than assumed.

## Design decisions

- **Determinism**: `zipfile.ZipFile.writestr` with a bare filename string stamps each entry with
  `time.localtime()` by default, which would make the same input produce different bytes on every
  call — failing criterion/test 4 outright. Used an explicit `zipfile.ZipInfo` per entry with a
  fixed `date_time = (1980, 1, 1, 0, 0, 0)` and `compress_type = ZIP_DEFLATED` instead, so the
  archive's bytes depend only on the input data, never on wall-clock time.
- **Sort key is `str.upper`, not the raw dict key**: the interface says keys are "uppercase
  tickers," but test 6 exercises a lowercase key. Sorting on the raw key would put `"MSFT"` before
  `"aapl"` (ASCII uppercase sorts before lowercase), which is alphabetically wrong once both get
  uppercased for their filenames. Sorting by `str.upper` keeps the order correct regardless of the
  input's casing.
- **Route loads via `list_all()` + `get_cached()` per ticker**, not a new bulk-cache function —
  `list_all()` already returns exactly the active-membership set the contract asks for ("every
  active universe member"), and `get_cached` is the same no-network read `history.csv`'s route
  already uses. No new persistence-layer code needed.

## Verification

```
$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
159 passed, 2 warnings in 1.21s
```
159 > 146 (baseline stated in the contract; 13 new tests, all passing).

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 97ms

$ grep -rniE '\bdownload\s*(=|\})' frontend/src/pages/UniversePage.tsx
(no matches, exit 1)

$ grep -rnE "except\s*:|except Exception" backend/app/export.py backend/app/routers/universe.py
(no matches, exit 1)

$ git diff --stat frontend/package.json backend/requirements.txt
(empty)

$ ls -1 backend/migrations/versions/
0001_initial.py
0002_add_adj_close.py
0003_universe_tickers.py
```

### Criterion 8's diff check — one pre-existing, unrelated entry

```
$ git diff --stat backend/app/cache.py backend/app/universe.py backend/app/market_data.py \
    backend/app/freshness.py backend/app/models.py backend/app/schemas.py \
    frontend/src/components/ frontend/src/lib/ frontend/src/api/
frontend/src/components/UniverseTable.tsx | 45 +++++++++++++++++++++----------
```
This is contract 0018's own work (still uncommitted from an earlier session — `contracts/done/
0018-table-auto-widths.{md,report.md}` are present, but the corresponding code diff apparently
never got `git add`/`git commit`'d). I did not open or edit `UniverseTable.tsx` in this session —
confirmed via `git status` before and after, which shows only the four files above as mine this
time.

## Human verification — not done by me

Same sandbox constraint as every prior UI contract this session: I cannot run the backend here (any
binary executed from inside a Python virtualenv is hard-blocked, confirmed repeatedly across
contracts 0015/0016/0018), so I can't click the button myself, confirm the file actually saves
(vs. opens a tab) at either origin, or unzip a real download to eyeball the CSVs. Per the contract's
own instructions, please run the four local checks and the deployed-site check yourself:

1. Click **Download Universe** — should save `universe.zip`, not open a tab.
2. Unzip it — one `.csv` per ticker.
3. Open one and compare against the per-row download for the same ticker — should be identical.
4. Apply a filter, click again — **the archive must still contain every ticker**, ignoring the
   filter (this is the one behavior I could only verify structurally, via the route reading
   `list_all()` directly rather than any filtered client state — the frontend anchor has no
   `onClick`/JS at all, so there is no code path by which it *could* respect the filter, but I
   can't watch it happen in a browser).
5. Deployed: confirm it still downloads rather than opening a tab of binary-looking text
   cross-origin.
