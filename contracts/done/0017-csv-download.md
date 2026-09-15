# Contract 0017 — Per-ticker CSV download

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Each row of the Universe table gains a download button that saves that ticker's full price history
as a CSV, byte-compatible with the files `reference files/old_yfinance_project/YF.py` produces.

## Why

The app stores nine tickers × 2,689 daily bars and offers no way to get at them. Every planned
analytic will eventually consume this data inside the app, but an export is useful now and is the
cheapest possible proof that what is stored is actually correct — open it in Excel and look.

Contract 0014 removed the per-row `Refresh` button and rebalanced the table's `table-fixed` widths
to absorb the freed space. This contract puts a column back, so those widths need re-tuning again.

**Format matches `YF.py` exactly**, so exported files are interchangeable with whatever Gunnar
already has:

```python
# YF.py:120,129
expected = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
df.to_csv(path, index=False, header=True, float_format="%.14f")
```

The stored columns map one-to-one — `open, high, low, close, adj_close, volume` plus a `date` index
— so this is a rename and reorder, not a transformation.

**Depends on contracts 0008 and 0014.** If `app/routers/universe.py` or
`frontend/src/components/UniverseTable.tsx` does not exist, stop and report `BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL` via
an autouse fixture — do not remove or weaken it.

## Files

Create:
- `backend/app/export.py` — the DataFrame → CSV conversion, pure
- `backend/tests/test_export.py`
- `frontend/src/components/DownloadIcon.tsx`

Modify:
- `backend/app/routers/universe.py` — one new route
- `backend/tests/test_api_universe.py` — endpoint tests
- `frontend/src/components/UniverseTable.tsx` — the column, and re-tuned widths

**Touch nothing else.** Do not modify `app/cache.py`, `app/universe.py`, `app/market_data.py`,
`app/freshness.py`, `app/models.py`, `app/schemas.py`, any migration, `tests/conftest.py`,
`tests/test_cache.py`, `UniversePage.tsx`, `api/client.ts`, or `lib/`. No new dependencies. If the
work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `app/export.py` — pure

```python
CSV_COLUMNS = ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"]

def history_to_csv(df: pd.DataFrame) -> str:
    """Render a stored OHLCV frame as YF.py-compatible CSV text."""
```

Requirements, each with a test:

- **Header is exactly `Date,Open,High,Low,Close,Adj Close,Volume`** — capitalised, with a space in
  `Adj Close`, in that order. Our internal names are lowercase with an underscore; rename on the way
  out.
- `date` moves from the index to the first **column**. `index=False`.
- Prices use `float_format="%.14f"`, matching `YF.py:129`. Yes, `333.08` becomes
  `333.08000000000000`. That is deliberate — YF.py's own comment is "write with high precision so
  1e-5 deltas survive round-trip," and the point of this contract is interchangeable files.
- **`Volume` must render as a plain integer**, not `1234.0` and not `1234.00000000000000`. It is
  stored as nullable `Int64`; `float_format` must not reach it.
- A **null** in any column renders as an empty field, not `nan`, not `None`, not `0`.
- Dates render `YYYY-MM-DD` with no time component.
- Line endings `\n`. A trailing newline at end of file is fine; no blank line beyond it.
- Empty input returns **just the header row**, not an empty string — a CSV with no rows is still a
  valid CSV.

### `app/routers/universe.py` — one route

```
GET /universe/{ticker}/history.csv   →  200 text/csv
                                        404 not in universe, or no stored history
```

- Read via `cache.get_cached(ticker)`. Do **not** fetch from yfinance — this endpoint exports what
  is stored, and a download must never trigger a network call.
- `404` when the ticker is not an active universe member, **and** when it has no stored bars. Detail
  message names the ticker and does not leak a connection string.
- **Headers — the load-bearing part:**

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="MSFT.csv"
```

`Content-Disposition` is what makes the browser save rather than display. **The HTML `download`
attribute is ignored for cross-origin URLs**, and in production the frontend
(`blueeaglecapital.onrender.com`) and backend (`blue-eagle-backend.onrender.com`) are different
origins. Relying on `download` alone works locally and silently opens a tab full of CSV text in
production — the same shape of bug as the `_redirects` SPA-fallback issue. The server header is the
only thing that works in both.

- Filename is the uppercased ticker plus `.csv`.
- Degraded mode (`DATABASE_URL` unset) → `503`, consistent with the other universe routes.

### `frontend/src/components/DownloadIcon.tsx`

```tsx
export function DownloadIcon(): JSX.Element
```

lucide's `download` icon inlined, exactly as `SettingsIcon.tsx` does it — 16×16,
`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, round caps and
joins. Keep an attribution comment naming lucide and the ISC licence. **Do not add `lucide-react`.**

### `frontend/src/components/UniverseTable.tsx`

- A final column, header empty (like the old Refresh column), right-aligned, containing one
  `<a>` per row:

```tsx
<a href={`${import.meta.env.VITE_API_URL}/universe/${row.ticker}/history.csv`}
   title={`Download ${row.ticker} history as CSV`}
   aria-label={`Download ${row.ticker} history as CSV`}>
  <DownloadIcon />
</a>
```

- An `<a>`, not a `<button>` — this is a navigation to a resource, it works without JavaScript, and
  it gets the browser's native download behaviour for free. No `onClick`, no `fetch`, no blob.
- **Do not add the `download` attribute.** It does nothing cross-origin and its presence implies
  the filename is controlled client-side when it is not. `Content-Disposition` owns that.
- Styling matches the old Refresh button's treatment — muted, hover to foreground,
  `rounded-[var(--radius-btn)]`, small padding.
- **Re-tune the `table-fixed` column widths** to make room, reversing contract 0014's
  redistribution. The freed space came mostly out of `Name`; take it back from there.
- The column is **visible at every breakpoint**, like the old Refresh column was — it must not be
  one of the `hide-sm`/`hide-md`/`hide-lg` set.

## Out of scope

- No bulk / "download all" export. One ticker at a time.
- No date-range selection, no column selection, no format choice. Full stored history, YF.py format.
- No Excel/JSON/Parquet export.
- No fundamentals in the CSV — price history only, as YF.py produced.
- No fetching from yfinance in this path, ever.
- No changes to `UniversePage.tsx`, the filter logic, or `api/client.ts` — the link needs no client
  code.
- No progress indicator or loading state. It is a browser download.
- No new dependencies, no `lucide-react`.

## Testing

No network, no database for `test_export.py`; SQLite `tmp_path` for the endpoint tests.

Required cases:

1. Header row is exactly `Date,Open,High,Low,Close,Adj Close,Volume`.
2. A known frame renders the expected number of data rows, and the first row's `Date` is
   `YYYY-MM-DD` with no time.
3. Prices render at 14 decimal places.
4. **`Volume` renders as a plain integer** — assert the field has no `.` in it.
5. A null price renders as an **empty field**; assert the row does not contain `nan` or `None`.
6. A null volume renders as an empty field.
7. Empty input returns only the header row.
8. `GET /universe/{ticker}/history.csv` returns `200`, `Content-Type` starting `text/csv`, and
   `Content-Disposition` containing `attachment` and `filename="TICKER.csv"`.
9. The response body's first line is the header and its line count equals `bar_count + 1`.
10. A ticker not in the universe returns `404`.
11. A ticker in the universe with no stored bars returns `404`.
12. Lowercase in the path resolves the same ticker and the filename is uppercased.
13. The endpoint makes **no** call to `_download_history` — monkeypatch it to raise, and assert the
    request still succeeds.
14. Degraded mode (`DATABASE_URL` unset) returns `503`.

## Acceptance criteria

0. Every file in the Files list exists; nothing outside it changed.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 133.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
3. `npm run build` succeeds.
4. `git diff --stat frontend/package.json` is empty — no dependency added.
5. `grep -rn "lucide-react" frontend/src/` matches nothing (exit 1).
6. `grep -n "download" frontend/src/components/UniverseTable.tsx` shows **no** `download` attribute
   on the anchor — only the URL path, title and aria-label.
7. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/` matches nothing
   (exit 1).
8. `grep -rnE "except\s*:|except Exception" backend/app/export.py backend/app/routers/universe.py`
   matches nothing (exit 1).
9. `git diff --stat backend/app/cache.py backend/app/universe.py backend/app/market_data.py backend/app/freshness.py backend/app/models.py backend/app/schemas.py backend/tests/conftest.py backend/requirements.txt frontend/src/pages/ frontend/src/lib/`
   is empty.
10. `ls backend/migrations/versions/` shows exactly three revisions.
11. At 375px the table still does not scroll horizontally with the extra column present.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff --stat frontend/package.json ; echo "(empty = no deps)"
grep -rn "lucide-react" frontend/src/ ; echo "exit=$? (1 means clean)"
grep -n "download" frontend/src/components/UniverseTable.tsx
grep -rnE "except\s*:|except Exception" backend/app/export.py backend/app/routers/universe.py ; echo "exit=$? (1 means clean)"
git diff --stat backend/app/cache.py backend/app/universe.py backend/app/market_data.py backend/app/freshness.py backend/app/models.py backend/app/schemas.py backend/tests/conftest.py backend/requirements.txt frontend/src/pages/ frontend/src/lib/ ; echo "(empty = untouched)"
cd backend && PATH="$PWD/.venv/bin:$PATH" DATABASE_URL="" python -c "
import pandas as pd
from app.export import history_to_csv
idx = pd.to_datetime(['2016-01-04','2016-01-05']).astype('datetime64[us]'); idx.name='date'
df = pd.DataFrame({'open':[100.5,None],'high':[101.0,102.0],'low':[99.0,100.0],
                   'close':[100.75,101.5],'adj_close':[99.1,100.2],
                   'volume':pd.array([1234567,None],dtype='Int64')}, index=idx)
print(history_to_csv(df))"
```

That last snippet must show the exact header, a 14-decimal price, `1234567` with no decimal point,
and **empty fields** for the two nulls — not `nan`.

## Human verification — does Gunnar need to run anything?

**Yes, and both halves matter — the local check and the deployed one, because the download
behaviour differs between them.**

Locally, with backend and frontend running:

1. Click the download icon on MSFT's row. A file named `MSFT.csv` should **save**, not open in a tab.
2. Open it. Header reads `Date,Open,High,Low,Close,Adj Close,Volume`; roughly 2,690 lines; first data
   row dated `2016-01-04`; `Volume` values are whole numbers.
3. Compare against a CSV `YF.py` produced for the same ticker, if you still have one — the columns
   and precision should match.
4. Click download on QQQ. It should work identically; ETFs have full price history even though their
   fundamentals are sparse.
5. Narrow to 375px — the icon column stays visible and nothing scrolls sideways.

**Then on the deployed site**, which is the check that cannot be done locally: click the icon and
confirm it still **downloads** rather than opening a tab full of text. Locally the two origins are
both `localhost` and the browser is lenient; in production they are different hosts, and only
`Content-Disposition` makes it work. If it opens a tab, that header is missing or malformed.

## Open questions — do NOT resolve these yourself

- **Bulk export** ("download all as a zip"). Out of scope; do not add it.
- **Date-range or column selection on export.** Out of scope.
- **Whether fundamentals should be exportable.** Undecided; price history only for now.
- **Whether `%.14f` is the right precision long-term.** Matching YF.py is the current requirement.
  Do not change it to something more readable.
