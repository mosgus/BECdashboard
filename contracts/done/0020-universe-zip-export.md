# Contract 0020 — Download the whole universe as a zip

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

A `Download Universe` button below the table saves `universe.zip`, containing one CSV per tracked
ticker in the same format contract 0017 produces for a single row.

## Why

Contract 0017 gave every row its own CSV download. With nine tickers that is nine clicks, and the
number only grows. One archive is the obvious next step and reuses everything already built —
`history_to_csv` needs no changes, and the frontend needs no JavaScript.

**Depends on contracts 0017 and 0018.** If `app/export.py` has no `history_to_csv`, or
`UniverseTable.tsx` has no download column, stop and report `BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL` via
an autouse fixture — do not remove or weaken it.

## The route-ordering trap — read this before writing the route

`app/routers/universe.py:47` declares `@router.get("/{ticker}")`. FastAPI matches routes **in
declaration order**, so a new single-segment route declared *after* it is swallowed:
`/universe/export.zip` would resolve to `get_ticker(ticker="export.zip")` and return **404 "not in
universe"** — a plausible-looking wrong answer, not an error.

(`/{ticker}/history.csv` escapes this only because it has two path segments and cannot collide.)

Two requirements, both mandatory:

1. **Declare `@router.get("/export.zip")` above `@router.get("/{ticker}")`.**
2. **Add a test that asserts the route resolves to the zip handler**, not to `get_ticker`. Ordering
   is invisible to the reader and a future edit that moves the handler breaks it silently. The test
   is the only durable guard.

## Files

Create:
- `backend/tests/test_export_zip.py`

Modify:
- `backend/app/export.py` — the archive builder, pure
- `backend/app/routers/universe.py` — one new route, declared **before** `/{ticker}`
- `frontend/src/pages/UniversePage.tsx` — the button

**Touch nothing else.** Do not modify `app/cache.py`, `app/universe.py`, `app/market_data.py`,
`app/freshness.py`, `app/models.py`, `app/schemas.py`, `UniverseTable.tsx`, `DownloadIcon.tsx`,
`FilterDialog.tsx`, `lib/`, `api/client.ts`, any migration, `tests/conftest.py`, or
`tests/test_cache.py`. No new dependencies — **`zipfile` and `io` are standard library.** If the
work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `app/export.py`

```python
def build_universe_zip(histories: dict[str, pd.DataFrame]) -> bytes:
    """Zip one CSV per ticker. Keys are uppercase tickers; each becomes TICKER.csv."""
```

- Pure: takes already-loaded frames, returns bytes. **No database access, no `get_cached` call, no
  network.** The route does the loading; this function does the packing. Same separation as
  `history_to_csv`.
- Each member is `history_to_csv(frame)` encoded UTF-8, named `TICKER.csv` uppercase.
- `zipfile.ZIP_DEFLATED`. The content is repetitive decimal text and compresses well.
- Entries sorted by ticker, so the archive is deterministic — the same input produces identical
  bytes, which is what makes it testable.
- An empty dict returns a **valid empty zip**, not `b""` and not an exception. The route decides
  whether that case is a 404; this function does not.
- No directory nesting — files sit at the archive root.

### `app/routers/universe.py`

```
GET /universe/export.zip  →  200 application/zip
                             404 when the universe has no ticker with stored history
                             503 when no database is configured
```

- Load every **active** universe member's history via `cache.get_cached`. Skip tickers with no
  stored bars rather than including an empty CSV — a file with only a header is a puzzle for whoever
  opens the archive.
- `404` only when *nothing* has history. One ticker with bars is a valid archive.
- **Never fetch from yfinance.** This exports what is stored. A download that triggers outbound
  requests is how the rate-limiting of contract 0013 comes back, one click at a time.
- Headers:

```
Content-Type: application/zip
Content-Disposition: attachment; filename="universe.zip"
```

`Content-Disposition` is load-bearing — the frontend and backend are different origins in
production, and the HTML `download` attribute is ignored cross-origin. Same reasoning as 0017.

- Declared **above** `/{ticker}`. See the trap section.

### `frontend/src/pages/UniversePage.tsx`

A single anchor **below the table card**, outside it, rendered only in the populated state (not
while loading, erroring, or empty):

```tsx
<a href={`${import.meta.env.VITE_API_URL}/universe/export.zip`}
   className="…"
   title="Download every ticker's price history as a zip">
  <DownloadIcon />
  <span>Download Universe</span>
</a>
```

- Import the existing `DownloadIcon`; do not duplicate the SVG.
- An `<a>`, not a `<button>` — no `onClick`, no `fetch`, no blob. **Do not add the `download`
  attribute**; it does nothing cross-origin and implies client-side control of the filename that
  does not exist.
- Styling matches the existing secondary buttons — `bg-brand-surface`, `border-brand-border`, muted
  text, hover to `bg-brand-border`/`text-foreground`, `rounded-[var(--radius-btn)]`. Icon and label
  on one line with a small gap.
- Left-aligned, with top margin separating it from the card.

**It ignores filters and downloads everything**, matching `Update all`'s behaviour. The label says
"Universe", not "shown", so there is no ambiguity to resolve — do **not** wire it to filter state.

## Out of scope

- No progress indicator, no loading state. It is a browser download of a small file.
- No date-range, column, or ticker selection.
- No filter-aware export ("download shown"). Explicitly rejected above.
- No manifest, README, or metadata file inside the archive.
- No fundamentals — price history only, as in 0017.
- No streaming response. In-memory is correct at this size; see the scaling note.
- No changes to `UniverseTable.tsx`, the per-row download, or `history_to_csv`.
- No new dependencies. `zipfile` and `io` are standard library.

**Scaling note, not a requirement:** nine tickers is roughly 2.7MB uncompressed and well under 1MB
zipped, so building it in memory is fine. At a few hundred tickers this would want streaming.
Do not build that now; note it if you see the number climbing.

## Testing

No network, no database for the pure function; SQLite `tmp_path` for the route.

Required cases:

1. `build_universe_zip` with two tickers produces an archive with exactly `AAPL.csv` and `MSFT.csv`
   at the root — assert on `ZipFile.namelist()`.
2. A member's contents equal `history_to_csv` of the same frame, byte for byte.
3. Entries are sorted by ticker regardless of dict insertion order.
4. The same input twice produces identical bytes — deterministic.
5. An empty dict returns a valid zip with an empty `namelist()`, and does not raise.
6. A ticker with a lowercase key is stored as an uppercase `TICKER.csv`.
7. `GET /universe/export.zip` returns `200`, `Content-Type: application/zip`, and a
   `Content-Disposition` containing `attachment` and `filename="universe.zip"`.
8. The response body opens as a valid zip and contains one entry per ticker **with stored history**.
9. A ticker in the universe with **no** stored bars is **omitted** from the archive, and the request
   still succeeds.
10. A universe where **no** ticker has history returns `404`.
11. **The route-ordering guard.** `GET /universe/export.zip` reaches the zip handler, not
    `get_ticker`. Assert the response `Content-Type` is `application/zip` — a `404` with a JSON
    detail means `/{ticker}` swallowed it.
12. The endpoint makes **no** call to `_download_history` or `_download_info` — monkeypatch both to
    raise and assert the request still succeeds.
13. Degraded mode (`DATABASE_URL` unset) returns `503`.

## Acceptance criteria

0. Every file in the Files list exists; nothing outside it changed.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 146.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
3. `npm run build` succeeds.
4. `grep -n "export.zip\|{ticker}" backend/app/routers/universe.py` shows the `export.zip` route
   declared on an **earlier line** than `@router.get("/{ticker}")`. Quote both line numbers.
5. `git diff --stat frontend/package.json backend/requirements.txt` is empty — no dependency added.
6. `grep -rniE '\bdownload\s*(=|\})' frontend/src/pages/UniversePage.tsx` matches nothing (exit 1) —
   no `download` attribute on the anchor.
7. `grep -rnE "except\s*:|except Exception" backend/app/export.py backend/app/routers/universe.py`
   matches nothing (exit 1).
8. `git diff --stat backend/app/cache.py backend/app/universe.py backend/app/market_data.py backend/app/freshness.py backend/app/models.py backend/app/schemas.py frontend/src/components/ frontend/src/lib/ frontend/src/api/`
   is empty.
9. `ls backend/migrations/versions/` shows exactly three revisions.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "export.zip" backend/app/routers/universe.py
grep -n '"/{ticker}"' backend/app/routers/universe.py
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
grep -rniE '\bdownload\s*(=|\})' frontend/src/pages/UniversePage.tsx ; echo "exit=$? (1 means clean)"
grep -rnE "except\s*:|except Exception" backend/app/export.py backend/app/routers/universe.py ; echo "exit=$? (1 means clean)"
git diff --stat frontend/package.json backend/requirements.txt backend/app/cache.py backend/app/universe.py backend/app/market_data.py backend/app/freshness.py backend/app/models.py backend/app/schemas.py frontend/src/components/ frontend/src/lib/ frontend/src/api/ ; echo "(empty = untouched)"
```

State in the report: the two line numbers from criterion 4, and the archive size for a nine-ticker
universe.

## Human verification — does Gunnar need to run anything?

**Yes — locally and then deployed, because the download behaviour differs between them.**

Locally:

1. Click **Download Universe**. A file named `universe.zip` should **save**, not open.
2. Unzip it: one `.csv` per ticker, named `AAPL.csv`, `MSFT.csv`, and so on.
3. Open one — header `Date,Open,High,Low,Close,Adj Close,Volume`, roughly 2,690 lines, first data row
   `2016-01-04`. It should be identical to what the per-row download gives for that ticker.
4. Apply a filter so only three rows show, then click **Download Universe** again. **The archive
   must still contain every ticker**, matching `Update all`'s behaviour.

**Then on the deployed site** — the check that cannot be done locally, since both halves are
`localhost` there and the browser is lenient about cross-origin downloads. Click it and confirm it
still saves rather than opening. Expect the first click after idle to take ~43 seconds while the
backend cold-starts.

## Open questions — do NOT resolve these yourself

- **Filter-aware export** ("download shown"). Rejected for consistency with `Update all`. If both
  behaviours are eventually wanted, that is a product decision about two buttons, not a tweak.
- **Streaming for large universes.** In-memory is right at this size; revisit if the ticker count
  reaches the hundreds.
- **Including fundamentals** in the archive, as a second CSV. Undecided.
- **A manifest file** listing contents and export date. Undecided; do not add one.
