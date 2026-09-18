# Contract 0055 — The change column stops inventing 0.00%

**Status:** accepted — verified after contract 0056
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

With a live quote, the change is intraday price against the last completed close — unchanged. With no
live quote, it is the **last completed session's** change, visibly marked as not live. A missing
input never again renders as `0.00%`.

## Why

Gunnar, 2026-09-18: *"can't it be a super simple implementation where it looks at the most recent
close, and since intraday there is no close until the market closes it just measures the difference
between the current intraday price and the most recent close? I don't know how this is so hard to
implement and have work consistently."*

**He is right, and that is already the implementation.** `change.ts:26`:

```ts
const percent = ((current - lastClose) / lastClose) * 100
```

The formula was never wrong. Both failures this session were in the **inputs**, and they were
different failures with an identical symptom:

- Contract 0053 — `lastClose` was today's in-progress bar, so the row compared today's price against
  itself.
- Contract 0054 — `current` was null, because the batch quote claim is coverage-blind to a
  newly-added ticker.

The reason both looked like one unfixed bug is `change.ts:21-23`:

```ts
if (current === null) {
  return { percent: 0, direction: 'flat', label: '0.00%' }
}
```

**A missing live quote is rendered as a real, flat market.** The comment defends this as the
market-closed case, which is true after hours — but the function cannot distinguish "market closed,
showing the last close" from "market open, quote missing", so every input failure is disguised as a
plausible number. That is what made two unrelated root causes indistinguishable from the outside, and
it is the actual defect worth fixing: **a display that manufactures a value to fill a gap will hide
every future bug in whatever feeds it.**

Gunnar's decision, 2026-09-18: show the **last session's change** when there is no live quote, rather
than blanking the column for most of the day. The bars are already stored, so it is exact — not an
estimate.

## Files

Modify:
- `backend/app/universe.py` — `prior_close` in `list_all()` and `get_one()`
- `backend/app/schemas.py` — the new field
- `backend/tests/` — tests
- `frontend/src/api/client.ts` — the type
- `frontend/src/lib/change.ts` — the third input and the two branches
- `frontend/src/components/UniverseTable.tsx` — pass it, and mark a non-live figure

**Touch nothing else.** No migration, no model change, no new table, nothing under `reference files/`
(read-only, and it never belongs on a file list). **No new dependency.**

`TickerStrip.tsx` is **unchanged** and must stay so. It always passes a non-null `current`
(`TickerStrip.tsx:24`), so it never reaches the new branch — which is why the third parameter is
optional. Do not "tidy" it into passing a third argument.

`export.py` is unaffected: `CSV_COLUMNS` is a fixed bars-only list (`export.py:11`) and no universe
field reaches it. Do not touch it.

## Environment

Run backend commands as `PATH="$PWD/backend/.venv/bin:$PATH" <cmd>` from the repo root. Frontend
typecheck is `npx tsc -p tsconfig.app.json --noEmit` — **not bare `tsc --noEmit`**. `npm run lint`
reports **exactly one** warning, the `set-state-in-effect` baseline in `UniversePage.tsx`; match on
the rule and the count, not the line.

**Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`** — `backend/.env` holds a live Render
connection string and `config.py` calls `load_dotenv()` at import.

The suite is hermetic: `conftest.py` blocks `socket` *and* `curl_cffi` and raises `RuntimeError`, so
`except Exception` handlers cannot absorb it. **447 tests pass in ~3s; keep it hermetic and fast.**

> **Known hazard, found during 0054 and not yet fixed:** `market_data.py`'s two module-level
> `TTLCache`es (lines 32, 38) are **never reset between tests**, unlike `cache.py`'s. A cached value
> from an earlier test can mask a real blocked-network failure in a later one. If a new test passes
> only when run with the whole suite, or only when run alone, suspect this before believing either
> result. Clear them explicitly in any test that depends on a session lookup.

## Backend — `prior_close`

Add to every universe entry:

```python
prior_close: float | None   # the close BEFORE last_close; null when fewer than two bars exist
```

`list_all()` already builds `last_close_by_ticker` from a `row_number()` window over **non-null**
closes, taking `rn == 1`. Extend the same subquery to `rn <= 2` and read `rn == 2` as `prior_close`.

**Keep the non-null-close filter.** It exists because of the AAPL null-close bug: the most recent bar
and the most recent bar *with a close* are not the same row once a null-close bar exists. The prior
close must be the second most recent **real** close, not the second most recent row.

**Do not add a second query.** One window function already returns both ranks; a separate query for
the prior close would double the round trips for a value the first one is one predicate away from.

`get_one()` reads a DataFrame rather than using `list_all()`'s aggregate query. There, take the
second-to-last entry of `prices["close"].dropna()`, or `None` when fewer than two exist. **Never
index `[-2]` without checking the length first.**

Add `prior_close: float | None` to the `UniverseEntry` schema in `schemas.py`, beside `last_close`.
`UniverseDetail` extends it and needs no separate change.

## Frontend — `lib/change.ts`

```ts
export function priceChange(
  current: number | null,
  lastClose: number | null,
  priorClose?: number | null,
): PriceChange
```

Add one field to the returned object:

```ts
live: boolean   // true when the percentage is against a live intraday price
```

Behaviour:

| `current` | result |
|---|---|
| non-null, `lastClose` non-null and non-zero | `(current - lastClose) / lastClose`, `live: true` — **unchanged** |
| null, `priorClose` non-null and non-zero | `(lastClose - priorClose) / priorClose`, `live: false` |
| anything else | `percent: null`, `label: ''`, `live: false` |

**Delete the `current === null → 0.00%` branch.** That is the whole point of this contract; a
fabricated zero must not survive anywhere in the function.

Keep every existing property: direction and the label's sign still derive from the **rounded**
percentage, so a raw `+0.004%` never renders as a green `+0.00%`. `percent` stays unrounded. `-0` is
still normalised so `toFixed` never prints `-0.00`. Never divide by zero, never return `NaN` or
`Infinity`.

## Frontend — `UniverseTable.tsx`

- Pass `row.prior_close` as the third argument.
- **When `change.live` is false, render the figure muted** — `text-[var(--color-muted)]` instead of
  the up/down colour — with a `Tooltip` reading `Last completed session's change — not a live price`.

That marker is the durable half of this fix. The frontend cannot tell a closed market from a failed
fetch — it has no timezone, no holiday calendar, and asking the backend for market state would mean
reshaping a list response for one boolean. **It does not need to.** What it knows, exactly and
already, is whether the number came from a live price, and that is the thing the reader has to know.
A muted figure is honest under either cause; a coloured `0.00%` was honest under neither.

Use the existing `CHANGE_COLOR` map for the live case. **Do not add a colour token** — the muted
variable already exists.

## Out of scope

- No market-open/closed state plumbed to the frontend, no timezone logic, no holiday calendar.
- No change to `TickerStrip.tsx`, `export.py`, `strip.py`, or the launch page.
- No change to how quotes are fetched, gated, or stored — 0054 owns that.
- No migration, no new column in any table. `prior_close` is derived from `price_bars` at read time.
- No sparkline, no intraday chart, no extended-hours price.
- No change to the Price cell's own value or to `positionPrice`'s fallback chain.

## Acceptance criteria

1. `PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q` passes, **447 or more** tests, still
   about 3 seconds, still hermetic.
2. A test proves `list_all()` returns `prior_close` as the **second most recent non-null** close,
   using a fixture where the most recent bar has a `NULL` close — the AAPL bug's shape. This is the
   one that would silently pass with a naive `rn <= 2` over all rows.
3. A test proves `prior_close` is `None` for a ticker with exactly one bar, and that `get_one()`
   agrees with `list_all()` for the same ticker.
4. `grep -c "select(" backend/app/universe.py` is **unchanged** from before this contract — quote the
   before and after numbers. No second query was added.
5. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
6. `npm run lint` reports exactly one warning, still `set-state-in-effect`.
7. `grep -n "0.00%" frontend/src/lib/change.ts` matches nothing (exit 1) — the fabricated zero is
   gone, not merely bypassed.
8. `git diff --stat frontend/src/components/TickerStrip.tsx` is **empty**.
9. `git status --porcelain backend/migrations/` is empty.
10. `grep -rn "dark:" frontend/src/` matches nothing (exit 1);
    `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/lib/change.ts` matches nothing (exit 1).

## Verification to run and paste

Paste the **complete, verbatim** output of each, including failures.

```bash
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q 2>&1 | tail -10
grep -c "select(" backend/app/universe.py
grep -n "prior_close" backend/app/universe.py backend/app/schemas.py frontend/src/api/client.ts
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -n "0.00%" frontend/src/lib/change.ts ; echo "(exit $? — 1 = correct)"
grep -rn "dark:" frontend/src/ ; echo "(exit $? — 1 = correct)"
git diff --stat frontend/src/components/TickerStrip.tsx ; echo "(empty = untouched)"
git status --porcelain backend/migrations/ ; echo "(empty = no migration)"
git status --porcelain
```

Plus `priceChange` against the **real compiled module** — transpile, import, run, delete both files.
Do not hand-write a mirror:

```bash
cd frontend && npx esbuild src/lib/change.ts --format=esm --outfile=/tmp/_c.mjs --log-level=error
```

Show, for each: `percent`, `label`, `direction`, `live`.

- `(335.11, 337.00, 330.00)` — live intraday, `-0.56%`, `live: true`. The prior close must be
  **ignored** when a current price exists.
- `(null, 337.00, 330.00)` — `+2.12%`, `live: false`
- `(null, 337.00, null)` — `label: ''`, `percent: null`, no fabricated zero
- `(null, 337.00, 0)` — `label: ''`, no `Infinity`
- `(337.00, 337.00, 330.00)` — a genuinely flat live session: `0.00%` with `live: true`. **This is
  the case that must still be possible**, and it is what the deleted branch was impersonating.
- `(null, null, null)` and `(337.00, null, null)` — `label: ''`, no `NaN`

**`NaN` or `Infinity` anywhere is a failure.**

## Human verification — does Gunnar need to run anything?

**Yes, and the two states are easiest to compare across the close.**

Restart the backend with `--reload` first; one started without it serves the code it was launched
with, forever. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

1. **During market hours:** every row shows a live change in green or red, exactly as now. Nothing
   about the live path changes.
2. **After 4pm ET:** every row shows the **completed session's** change — today's close against
   yesterday's — in muted grey, with the tooltip explaining it is not live. Previously this read
   `0.00%` for everything.
3. **Add a ticker during market hours.** It should show a real live change immediately (that is
   0054), and never a grey `0.00%`.
4. A ticker with one bar, if you can make one, shows a blank change rather than a zero.
5. Dark mode, then light — the muted figure must be legible in both and clearly distinct from the
   green/red live one.

## Open questions — do NOT resolve these yourself

- **Whether the Price column header should say which session it is showing** when nothing is live. It
  currently reads `PRICE @ 11:27 AM` or `PRICE @ close`.
- **Whether `market_data.py`'s two module-level `TTLCache`es should be reset by an autouse fixture**,
  structurally, rather than patched per-test. Found during 0054; a real source of order-dependent
  test masking.
- **Whether the derived trailing yield should replace `.info`'s reported one** everywhere, so the
  column means one thing.
- **What happens to the four `Coming soon` cards.** Still open.
