# Contract 0038 — Delete a ticker and all of its stored data

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

A `Delete ticker` button at the bottom right of the chart dialog. Pressing it opens a confirmation
dialog with **Cancel** and **Delete**. Confirming permanently removes the ticker's membership, price
history, fundamentals and quote from the database, closes both dialogs, and refreshes the table.

## Why

The Universe page is add-only. A mistyped or delisted symbol is permanent — Gunnar hit this once with
`Unknown symbol: SPY`. This is the last functional gap before portfolios start depending on the
universe.

**This deliberately overrides the no-cascade design note.** `models.py` says:

> *"Curated universe membership — a flag, not a cascade. Neither `price_bars` nor
> `ticker_fundamentals` reference this table in either direction: the old app's cascade meant
> de-listing a ticker silently destroyed its price history."*

Gunnar chose full deletion on 2026-09-17, knowing the cost. The old app's failure was that deletion
was **silent and implicit**; here it is explicit, confirmed, and the only path to it is a two-step
dialog. **Do not add a foreign key or an `ON DELETE CASCADE`** — the deletion stays an explicit,
ordered set of statements in application code. The schema does not change at all.

**Measured cost, AAPL, 2026-09-17:** 2,692 price bars, 1 fundamentals row, 1 quote, 1 membership row.
Re-adding refetches ten years — one large yfinance call, a few seconds.

## The bug you will introduce if you only delete database rows

`app/cache.py` holds `_cache = TTLCache(maxsize=512, ttl=86400)` — an in-process cache of price
history keyed by uppercase ticker, with a **24-hour** TTL. `get_cached` checks it before touching the
database.

Delete AAPL's rows without evicting that entry, re-add it the same day, and:

1. `add()` → `refresh_ticker` → `get_cached("AAPL")` returns the **old DataFrame from memory**
2. `is_stale(stored, last_session)` is False
3. no fetch happens, and the ticker reappears with its full pre-deletion history

The hard delete silently undoes itself, with no error anywhere. **`remove()` must evict the cache
entry**, and a test must prove it.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

**Tests must pass with no network and no database.** Never call yfinance in a test.

**Restart the backend with `--reload` before any manual check.**

**If a command fails with `password authentication failed for user "<not in .env>"`, or the frontend
shows "API offline" while the server logs 200s**, your shell has a stale exported `DATABASE_URL` or
`CORS_ORIGINS`. `env | grep -E "DATABASE_URL|CORS_ORIGINS"`.

**This contract's manual verification destroys real data.** Add a throwaway ticker and delete that
one — never a ticker already in Gunnar's universe.

## Files

Create: *(nothing)*

Modify:
- `backend/app/cache.py` — `evict`
- `backend/app/universe.py` — `remove`
- `backend/app/schemas.py` — `DeleteResult`
- `backend/app/routers/universe.py` — `DELETE /{ticker}`
- `backend/tests/test_cache.py`
- `backend/tests/test_universe.py`
- `backend/tests/test_api_universe.py`
- `frontend/src/api/client.ts` — `deleteTicker`
- `frontend/src/components/ChartDialog.tsx` — button + confirmation dialog
- `frontend/src/pages/UniversePage.tsx` — wire `onDeleted`

**Touch nothing else.** Not `app/news.py`, `app/briefing.py`, `app/autorefresh.py`, `app/schedule.py`,
`app/quotes.py`, `app/strip.py`, `app/market_data.py`, `app/freshness.py`, `app/models.py`,
`app/db.py`, `app/config.py`, `app/main.py`, `tests/conftest.py`, any migration, `UniverseTable.tsx`,
`NewsSection.tsx`, `TickerStrip.tsx`, `AddTickerForm.tsx`, `FilterDialog.tsx`, `Tooltip.tsx`, or
`App.tsx`.

**No migration. No new dependency. No schema change.**

## Backend

### `app/cache.py`

```python
def evict(ticker: str) -> None:
    """Drop one ticker's in-process entry. Case-insensitive, no-op when absent.
    Never touches the database."""
```

Uppercase the key, `_cache.pop(key, None)`. **Do not change `clear()`** — it is test-only and stays
as it is. Do not widen `evict` to delete rows; separating the memory concern from the storage concern
is the point.

### `app/universe.py`

```python
def remove(ticker: str) -> dict:
    """Permanently delete a ticker's membership and every row of its stored market data.
    Raises NotInUniverse when there is no active membership row."""
```

Deletes, in this order, inside **one** `session()` so a failure part-way rolls the whole thing back:

1. `price_bars` where `ticker == key`
2. `ticker_fundamentals` where `ticker == key`
3. `ticker_quotes` where `ticker == key`
4. `universe_tickers` where `ticker == key` — a real `DELETE`, **not** `active = False`

Then, **after** the transaction commits, `cache.evict(key)`. After, not before: evicting first and
then rolling back would leave memory and storage disagreeing in the opposite direction.

**`news_articles` is not touched.** `source_ticker` is provenance — which feed surfaced an article —
not subject matter. Contract 0030 measured AAPL's feed returning a story about a Canadian telecom, so
deleting by `source_ticker` would remove legitimate feed content that has nothing to do with the
ticker being deleted. The 14-day (now 2-day) `pub_date` prune already ages articles out.

Raise `NotInUniverse` when the row is missing or already inactive — reuse the existing exception, the
same check `refresh()` does at `universe.py:115`.

Return a count per table so the caller can report what happened:

```python
{"ticker": "AAPL", "bars_deleted": 2692, "fundamentals_deleted": 1, "quotes_deleted": 1}
```

### `DELETE /universe/{ticker}`

```
200 → DeleteResult
404 → not in the universe
503 → no database configured
```

`DeleteResult` mirrors the dict above. Declare it beside the existing `GET /{ticker}` — a different
method on the same path, so **no new route-ordering hazard** and nothing above it needs moving. Do
not add a literal `DELETE` route for any other path.

## Frontend

### `client.ts`

```ts
export interface DeleteResult {
  ticker: string
  bars_deleted: number
  fundamentals_deleted: number
  quotes_deleted: number
}
export async function deleteTicker(ticker: string): Promise<DeleteResult>
```

`request` currently supports `'GET' | 'POST'`. Widen that union to include `'DELETE'`; change nothing
else about it.

### `ChartDialog.tsx`

New prop: `onDeleted: () => void`.

**The button.** The footer today is `<div className="flex flex-wrap gap-1 px-5 py-4">` holding the
range buttons. Make that row `justify-between`: range buttons stay left, `Delete ticker` goes right.
Style it as a danger action — `text-brand-negative` with a border, filling to `bg-brand-negative` /
white text on hover. Tooltip: `Permanently delete <TICKER> and all of its stored data`.

**The confirmation dialog.** A second overlay above the chart, `z-[110]` (the chart is `z-[100]`).

- `role="dialog"`, `aria-modal="true"`, labelled.
- Copy must state what is destroyed, with the real number from `entry.bar_count`:
  *"Permanently delete **AAPL**? This removes its 2,692 stored price bars, fundamentals and latest
  quote. Re-adding it later refetches ten years of history."*
  Fall back to wording without a count when `entry` is null.
- **Cancel** (neutral, autofocused) and **Delete** (`bg-brand-negative`, white text). Cancel first in
  DOM order so it is the default focus target — the destructive action must never be what a stray
  Return key hits.
- While the request is in flight both buttons are `disabled` and Delete reads `Deleting…`.
- On failure, show the message inside the confirmation dialog and leave it open. **Do not close
  either dialog on error** — the user must see what went wrong.
- On success: call `onDeleted()`, then `onClose()`.

**Escape must close the confirmation, not the chart.** `ChartDialog` already has a `keydown` listener
that calls `handleClose()` on Escape (around line 89). When the confirmation is open, Escape closes
**only** the confirmation. Getting this wrong leaves an orphaned confirmation dialog over a closed
chart, or closes both at once. A test is not required, but say in the report how you verified it.

The backdrop click that currently closes the chart must also not fire through the confirmation.

### `UniversePage.tsx`

Pass `onDeleted={() => { setSelectedTicker(null); load() }}` — clear the selection and refetch so the
deleted row disappears. Nothing else on the page changes.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from **311**.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
3. **A test proves the cache is evicted**: store a frame for a ticker via `cache.store`, call
   `remove`, then assert `cache.get_cached(ticker)` is `None`. This is the criterion that matters —
   without it a same-day re-add silently resurrects the deleted history.
4. A test asserts `remove` deletes rows from all four tables and that a subsequent `get_one` raises
   `NotInUniverse`.
5. A test asserts `remove` on an unknown or already-inactive ticker raises `NotInUniverse` and
   **deletes nothing** — assert the row counts of another ticker are unchanged.
6. A test asserts `news_articles` rows whose `source_ticker` is the deleted ticker **still exist**
   afterwards.
7. `DELETE /universe/{ticker}` returns 200 with the counts, and 404 for an unknown ticker.
8. `grep -rn "ON DELETE CASCADE\|ondelete" backend/app/models.py` matches nothing (exit 1) — no
   schema change.
9. `ls backend/migrations/versions/` still shows exactly **seven**.
10. `grep -n "z-\[110\]" frontend/src/components/ChartDialog.tsx` matches — the confirmation sits
    above the chart.
11. `git diff --stat backend/app/news.py backend/app/briefing.py backend/app/autorefresh.py backend/app/schedule.py backend/app/models.py backend/app/quotes.py backend/app/strip.py`
    is empty.
12. `git status --porcelain` lists nothing outside this contract's Files list.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -rn "ON DELETE CASCADE\|ondelete" backend/app/models.py ; echo "(exit $? — 1 = correct)"
ls -1 backend/migrations/versions/
grep -n "z-\[110\]" frontend/src/components/ChartDialog.tsx
grep -n "DELETE" frontend/src/api/client.ts
git diff --stat backend/app/news.py backend/app/models.py backend/app/quotes.py ; echo "(empty = untouched)"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git status --porcelain
```

Plus a live round trip **on a throwaway ticker only** — against the real database, deliberately not
`DATABASE_URL=""`:

```bash
curl -s -X POST http://127.0.0.1:8000/universe -H 'Content-Type: application/json' -d '{"ticker":"KO"}' -o /dev/null -w 'add: %{http_code}\n'
curl -s -X DELETE http://127.0.0.1:8000/universe/KO | python3 -m json.tool
curl -s -o /dev/null -w 'get after delete: %{http_code} (expect 404)\n' http://127.0.0.1:8000/universe/KO
```

**Never run this against a ticker already in the universe.** If `KO` is present, pick another symbol
that is not.

## Human verification — does Gunnar need to run anything?

**Yes, and carefully — this destroys data.**

1. Add a throwaway ticker you do not want, e.g. `KO`.
2. Click its row to open the chart. `Delete ticker` sits at the **bottom right**, range buttons still
   bottom left.
3. Press it. A confirmation appears **over** the chart, naming the ticker and its real bar count.
4. Press **Escape** — only the confirmation closes; the chart is still open. Press Escape again — the
   chart closes.
5. Reopen, press `Delete ticker`, press **Cancel**. Nothing is deleted.
6. Press `Delete ticker`, then **Delete**. Both dialogs close, the row disappears, the count in
   `Update all`/filters drops by one.
7. Confirm the news feed still shows articles — deleting a ticker must not empty it.
8. Re-add the same ticker. It should take **several seconds** and refetch ten years — if it returns
   instantly with full history, the cache eviction is missing and the delete did not really happen.

Point 8 is the one worth doing properly. It is the only check that distinguishes a real delete from
one the in-process cache quietly reversed.

## Out of scope

- No bulk delete, no multi-select, no delete from the table row.
- No undo, no trash, no soft-delete flag. `active` stays in the schema, unused by this path.
- No deletion of `news_articles` or `news_summaries`.
- No foreign keys, no `ON DELETE CASCADE`, no migration.
- No change to `add()`'s re-activation branch — it stays, harmless, for any inactive rows that exist.
- No confirmation for any other destructive action.

## Open questions — do NOT resolve these yourself

- **Whether `active` should be dropped from the schema** now that nothing sets it to `False`.
- **Whether delete should also be reachable from the table row**, not just the chart.
- **Whether a deleted ticker should be remembered** so the auto-refresh never re-adds it. Nothing
  re-adds tickers today, so this is hypothetical.
- **What happens to the four `Coming soon` cards.** Still open.
