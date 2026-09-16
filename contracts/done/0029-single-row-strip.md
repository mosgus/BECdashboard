# Contract 0029 — One-row ticker strip with names, moved into the app chrome

**Status:** accepted (2026-09-15) — audited by planner. One pre-existing defect
carried through from 0028, logged below and not this contract's fault.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The ticker strip becomes **one unlabelled row containing the whole universe**, each cell reading
`Apple Inc. (AAPL) $333.08 -0.52%`, rendered below the header on **every** page rather than on the
launch page only.

## Why

Contract 0028 built three labelled rows on `/`. In use, Gunnar wants it as app chrome: one row, no
group labels, company names visible, present everywhere. Three separate labelled rows on one page
is a dashboard widget; a single unbroken row across the top of every page is a ticker.

Indices still lead — `^GSPC, ^IXIC, ^RUT` first — but that falls out of the existing group ordering
rather than needing a hardcoded list. See "Ordering" below. **Do not hardcode those three tickers.**

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** Any test touching market state must pin time
explicitly — patch **every module that imported the name**, not just where it is defined.

**Restart the backend before any visual check.** A `uvicorn` without `--reload` serves the code it
was launched with; this exact mistake cost a round trip on 0028. `lsof -nP -iTCP:8000 -sTCP:LISTEN`
names whatever owns the port.

## Files

Modify:
- `backend/app/strip.py` — name resolution, deterministic ordering, `quote_type` on each quote
- `backend/app/schemas.py` — two new fields on `StripQuote`
- `backend/tests/test_strip.py`
- `backend/tests/test_api_universe.py`
- `frontend/src/api/client.ts` — two new fields on the `StripQuote` interface
- `frontend/src/components/TickerStrip.tsx` — one row, names, self-fetching
- `frontend/src/App.tsx` — render the strip between `<Header/>` and `<Routes/>`
- `frontend/src/pages/LaunchPage.tsx` — remove all strip code

**Touch nothing else.** In particular **do not modify `frontend/src/components/Header.tsx`** — the
strip sits below it, not inside it, and the header's `sticky top-0 z-50 h-14` stays exactly as is.
Also untouched: `app/cache.py`, `app/quotes.py`, `app/market_data.py`, `app/freshness.py`,
`app/models.py`, `app/universe.py`, `app/export.py`, any migration, `tests/conftest.py`,
`UniverseTable.tsx`, `UniversePage.tsx`, `ChartDialog.tsx`, `lib/`, `globals.css`.

**No migration** — every field needed is already stored. **No new dependencies.**

## Backend

### Two new fields on `StripQuote`

```python
class StripQuote(BaseModel):
    ticker: str
    name: str            # never null — falls back to the ticker
    quote_type: str | None
    price: float | None
    change: float | None
    pct: float | None
```

`StripReturn`, `StripGroup`, and `StripResponse` are **unchanged**. The `five_day` / `thirty_day` /
`ytd` arrays stay in the payload unrendered — see "Accepted debt".

### Name resolution — the 31-character cap

`ticker_fundamentals` has both `short_name` and `long_name`, both already populated for all 20
current tickers. Neither is usable alone:

**Yahoo hard-caps `short_name` at 31 characters**, truncating mid-word. Measured 2026-09-15 — 6 of
the 20 are cut:

| ticker | `short_name` (31 chars) | `long_name` |
|---|---|---|
| CEG | `Constellation Energy Corporatio` | `Constellation Energy Corporation` |
| IBM | `International Business Machines` | `International Business Machines Corporation` |
| SPY | `State Street SPDR S&P 500 ETF T` | `State Street SPDR S&P 500 ETF Trust` |
| XLK | `State Street Technology Select ` | `State Street Technology Select Sector SPDR ETF` |
| VEA | `Vanguard FTSE Developed Markets` | `Vanguard FTSE Developed Markets Index Fund ETF Shares` |
| XLP | `State Street Consumer Staples S` | `State Street Consumer Staples Select Sector SPDR ETF` |

But `long_name` is not simply better — it is longer and sometimes worse. `^RUT` is
`long_name=' Russell 2000 Index'` (**note the leading space**) against `short_name='Russell 2000'`;
`BYDDF` is `'BYD Company Limited'` against `'BYD Co., Ltd.'`.

So: **prefer `short_name` unless it is provably truncated.**

```
name = short_name.strip()  when short_name is not None and len(short_name) < 31
     = long_name.strip()   otherwise, when long_name is a non-empty string
     = ticker              otherwise
```

**Test `len()` on the raw string, before stripping.** `XLK`'s `short_name` is
`'State Street Technology Select '` — 31 raw, **30 stripped**. Strip first and this ticker silently
keeps a truncated name. This is the one place in this contract where the obvious implementation is
wrong, and it fails on exactly one of your twenty tickers.

Put this in a **pure helper** in `strip.py` alongside `pct_return` — it takes two optional strings
and a ticker and returns a string. No database, no clock. That is what makes the table above
testable.

### Ordering

`build_strip_response` currently selects tickers with **no `ORDER BY`**, so Postgres may return them
in any order. It has looked stable, but nothing guarantees it — and flattening three rows into one
makes any reshuffle obvious. Add `.order_by(UniverseTicker.ticker)`.

That is the whole fix. `_GROUP_ORDER` already puts `Indices` first, and within the Indices group
ascending ticker order is `^GSPC, ^IXIC, ^RUT` — precisely what was asked for, under either C or ICU
collation, because all three share the leading `^`. **Do not add a hardcoded priority list**; if a
fourth index is added later it should slot in by itself.

### Bounded queries

`quote_type_by_ticker` already selects from `TickerFundamentals`. Add `short_name` and `long_name`
to that **same** `select()` — do not add a query, and do not query per ticker. The existing bounded-
query test must still pass unchanged.

## Frontend

### `TickerStrip.tsx` — now self-fetching, one row

```tsx
export function TickerStrip(): JSX.Element | null
```

**It takes no props and owns its own fetch.** This reverses contract 0028's "loading and error
states are the page's job" — that rule existed because the strip lived on a page. It is now global
chrome with no owning page, and threading fetch state through `App.tsx` would put data-fetching into
a file that is otherwise pure routing.

- `useState`/`useEffect`, fetch once on mount. **No data library.** `App.tsx` renders `<TickerStrip />`
  once, outside `<Routes>`, so it mounts once and must **not** refetch on navigation.
- Return `null` while loading, on any error, and when the flattened list is empty. A failed or slow
  strip must be invisible, not an error banner — it is now on every page, and Render cold-starts at
  ~43 seconds.
- **Flatten `response.groups` in payload order** into a single list of quotes. Group order is already
  Indices → ETFs → Equities; do not re-sort client-side.
- **No group labels.** The `StripGroup.label` field is not rendered anywhere.
- One marquee row, duplicated track, same `@keyframes translateX(-50%)` approach as 0028.

### Cell format

`Apple Inc. (AAPL) $333.08 -0.52%`

- Name in the primary text colour, `(TICKER)` in the muted colour, price, then the percent.
- The percent keeps its colour from **`priceChange` in `lib/change.ts`** — import it, do not
  reimplement it. Its rounded-direction rule is why `+0.00%` is never green.
- **No currency symbol when `quote.quote_type === 'INDEX'`.** `^GSPC` currently renders `$7,585.73`;
  an index level is not dollars, and with the name attached — "S&P 500 (^GSPC) $7,585.73" — it reads
  worse than before. Render indices with thousands separators and 2 decimals, no `$`.
  **Key this off `quote_type`, not off the group label string** — `'Indices'` is a display label and
  must not appear in this file.
- `price === null` renders `—` with no percent, as today.

### Scroll duration must scale with content

The 0028 rows were short and hardcoded `40s`. One row holding all 20 tickers *with names* is several
times wider, and a fixed duration means it scrolls several times faster — unreadably so.

Set duration inline, proportional to item count: `max(60, items.length * 5)` seconds. Keep
`animation-name`, `animation-timing-function` and `animation-iteration-count` in the CSS class and
pass **only** `animationDuration` as an inline style — the `animation` shorthand with no duration
resolves to `0s` and the row will not move.

Still CSS animation only. **No `requestAnimationFrame`, no JS animation loop, no dependency.**

### Keep from 0028

- `prefers-reduced-motion: reduce` stops the animation and leaves the row statically scrollable.
- Pause on hover.

### `App.tsx`

```tsx
<BrowserRouter>
  <Header />
  <TickerStrip />
  <Routes>...</Routes>
</BrowserRouter>
```

Nothing else in `App.tsx` changes. The strip is **not sticky** — it scrolls away with the page while
the header stays pinned. Gunnar chose this over a two-tier sticky header so the Universe table keeps
its vertical space.

Give the strip `border-b border-brand-border` only, not `border-y` — the header already draws the
line above it.

### `LaunchPage.tsx`

Remove the `getStrip` import, the `StripGroup` type import, the `TickerStrip` import, the
`stripGroups` state, the `useEffect`, and the `<div className="mt-10">` wrapper. If that leaves
`useState`/`useEffect` unused, drop those imports too.

The page becomes hero → the four `Coming soon` cards. **Do not touch the hero, the card copy, the
card grid, or the cards' `mt-14`.**

## Tooltips

| element | copy |
|---|---|
| Each cell in the strip | `<NAME> (<TICKER>) — price and day change` |

Use the project `Tooltip`, never `title`. The group-label tooltip from 0028 is deleted along with
the labels.

## Accepted debt — state it in the report, do not fix it

`StripResponse` still returns `groups` with `five_day` / `thirty_day` / `ytd` arrays that nothing
renders. Leaving them costs one unused field per group and keeps the data pipeline intact; removing
them is a schema change that forecloses the 5D/30D/YTD rows 0028 was building toward. **Leave them.**
Whether those rows survive at all is Gunnar's call, not this contract's.

## Out of scope

- No changes to `Header.tsx`. No sticky strip.
- No rendering of 5D/30D/YTD. No removal of those fields either.
- No click-through navigation from the strip.
- No news, articles, or AI summary.
- No changes to the Universe page, its table, or its chart.
- No changes to the card copy or the hero.
- No migration, no new dependency, no yfinance calls.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from **204**.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. **Not bare `tsc --noEmit`.**
3. `cd frontend && npm run build` succeeds.
4. A test asserts the name helper returns, for these inputs:
   `('Apple Inc.', 'Apple Inc.', 'AAPL') → 'Apple Inc.'`;
   `('State Street Technology Select ', 'State Street Technology Select Sector SPDR ETF', 'XLK') →`
   the long one **(the 30-vs-31 trap)**;
   `('Russell 2000', ' Russell 2000 Index', '^RUT') → 'Russell 2000'`;
   `(None, None, 'FOO') → 'FOO'`.
5. A test asserts flattening the response's groups in order yields `^GSPC, ^IXIC, ^RUT` as the first
   three tickers, given those three as the only `INDEX` rows — **and passes without any of those
   three appearing as a literal in `app/strip.py`.**
6. `grep -n "order_by" backend/app/strip.py` matches.
7. The existing bounded-query test still passes **unmodified** — `git diff` on that test shows no
   change to its assertion.
8. `grep -n "TickerStrip\|getStrip\|StripGroup" frontend/src/pages/LaunchPage.tsx` matches nothing
   (exit 1).
9. `grep -n "TickerStrip" frontend/src/App.tsx` matches.
10. `git diff --stat frontend/src/components/Header.tsx` is empty.
11. `grep -n "'Indices'" frontend/src/components/TickerStrip.tsx` matches nothing (exit 1) —
    currency suppression is keyed on `quote_type`, not on a display label.
12. `grep -n "animationDuration" frontend/src/components/TickerStrip.tsx` matches.
13. `grep -n "prefers-reduced-motion" frontend/src/components/TickerStrip.tsx` matches.
14. `grep -n "from '../lib/change'" frontend/src/components/TickerStrip.tsx` matches.
15. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/TickerStrip.tsx`
    matches nothing (exit 1).
16. `grep -rnE "except\s*:|except Exception" backend/app/strip.py` matches nothing (exit 1).
17. `ls backend/migrations/versions/` shows exactly four revisions.
18. `git diff --stat backend/app/universe.py backend/app/quotes.py backend/app/cache.py backend/app/models.py frontend/src/components/UniverseTable.tsx frontend/src/pages/UniversePage.tsx frontend/package.json`
    is empty.
19. `git status --porcelain` shows **no new untracked files** under `frontend/src/` or
    `backend/app/` — this contract creates nothing. Any harness you built must be gone.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "order_by" backend/app/strip.py
grep -n "'Indices'" frontend/src/components/TickerStrip.tsx ; echo "(exit $? — 1 = correct)"
grep -n "animationDuration\|prefers-reduced-motion\|from '../lib/change'" frontend/src/components/TickerStrip.tsx
grep -n "TickerStrip\|getStrip\|StripGroup" frontend/src/pages/LaunchPage.tsx ; echo "(exit $? — 1 = correct)"
grep -n "TickerStrip" frontend/src/App.tsx
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
ls -1 backend/migrations/versions/
git diff --stat frontend/src/components/Header.tsx ; echo "(empty = untouched)"
git diff --stat backend/app/universe.py backend/app/quotes.py backend/app/models.py frontend/src/pages/UniversePage.tsx frontend/package.json ; echo "(empty = untouched)"
git status --porcelain
```

Also paste the **first three and last three cells** of a live response so the ordering and the name
resolution are visible rather than asserted:

```bash
curl -s http://127.0.0.1:8000/universe/strip \
  | PATH="$PWD/backend/.venv/bin:$PATH" python -c "import json,sys; q=[x for g in json.load(sys.stdin)['groups'] for x in g['today']]; print(len(q)); [print(x['ticker'], x['quote_type'], repr(x['name'])) for x in q[:3]+q[-3:]]"
```

Restart `uvicorn` first — see Environment.

## Human verification — does Gunnar need to run anything?

**Yes.** This changes chrome on every page.

At `localhost:5173/`:

1. **One** unlabelled row below the header. No `INDICES` / `ETFS` / `EQUITIES` labels anywhere.
2. Cells read `Apple Inc. (AAPL) $333.08 -0.52%`. Check **CEG, IBM, XLK, VEA** specifically — those
   are the ones whose names were being truncated mid-word; none should end in a partial word.
3. `S&P 500 (^GSPC)` leads, then `NASDAQ Composite (^IXIC)`, then `Russell 2000 (^RUT)`.
4. The three indices show **no `$`**. Equities and ETFs do.
5. **Hover — it pauses.** This went unverified on 0028; please actually do it this time.
6. Navigate to **/universe** — the strip is there too, and does **not** restart or flash. Scroll
   down: the header stays pinned, the strip scrolls away.
7. **Stop the backend and reload both pages.** Header, hero, cards and the Universe page all render
   normally; the strip is simply absent. No error banner, no blank page.
8. Judge the **scroll speed**. It is now proportional to ticker count, and 20 tickers with full
   company names is a much longer track than 0028 had. If it reads too fast or too slow, the constant
   is one number — say which way and it gets changed.

Point 2 is the one that justifies this contract's backend half.

## Open questions — do NOT resolve these yourself

- **Whether the 5D/30D/YTD rows survive at all** now that the strip is one row. Leave the data.
- **Clicking a ticker to open its chart.** Would need routing from any page into `/universe`.
- **Whether long names should be truncated with an ellipsis** if the row proves too wide. Render
  them in full; Gunnar judges from the real thing.
- **What happens to the four `Coming soon` cards.** Still Gunnar's call after the news contracts.

---

## Audit (planner, 2026-09-15)

Re-run against the working tree:

- `pytest -q` → **211 passed** (from 204)
- `grep -nE '\^GSPC|\^IXIC|\^RUT' backend/app/strip.py` → exit 1; ordering comes from
  `.order_by(UniverseTicker.ticker)` plus the existing `_GROUP_ORDER`, not a hardcoded list
- `resolve_display_name` tests `len()` on the raw string before stripping — the XLK 30-vs-31 trap is
  handled, and the docstring says why
- Scope empty for `universe.py`, `quotes.py`, `cache.py`, `models.py`, **`Header.tsx`**,
  `UniversePage.tsx`, `package.json`, `requirements.txt`
- Bounded-query test unmodified
- `tsc -p tsconfig.app.json --noEmit` clean; `npm run build` succeeds
- 4 migrations; no new untracked files beyond 0028's three
- Live `GET /universe/strip` → 20 cells, order
  `^GSPC ^IXIC ^RUT | GLD QQQ SETM SPY VEA XLK XLP XLV | AAPL BYDDF CEG IBM MS MSFT MU NVDA ORCL`,
  all six previously-truncated names whole, `BYDDF`/`^RUT` correctly keeping `short_name`

Human verification: points 1–4, 6, 7 confirmed by the implementer with screenshots; **point 5
(hover-pause) was genuinely measured this time** — `animationPlayState` read via the Chrome DevTools
Protocol around a synthetic mouse-move: `running → paused → running`. Point 8, scroll-speed
judgement, is Gunnar's and is open.

### Defect found in audit — reduced motion has no fallback

Carried in from 0028, unchanged by this contract, and missed by both contracts' acceptance criteria.

```css
@media (prefers-reduced-motion: reduce) {
  .ticker-strip-marquee { animation: none; overflow-x: auto; }
}
```

`.ticker-strip-marquee` is `w-max` — `width: max-content` — so it sizes exactly to its children and
never overflows itself; `overflow-x: auto` on it yields no scrollbar and nothing to scroll. Its
parent `.ticker-strip-track` is `overflow-hidden`, which clips the rest. A reduced-motion user sees
the first screenful of tickers, frozen, with no way to reach the remaining fifteen.

The animation half is correct — `animation-name: none` wins on source order. Only the fallback is
broken. The `overflow-x: auto` belongs on `.ticker-strip-track`.

**Both contracts verified this with `grep -n "prefers-reduced-motion"`**, which proves the string is
present and nothing more. That is the planner's recurring defect — matching the word rather than the
construct — and this is its second shipped instance.
