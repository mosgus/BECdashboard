# Contract 0028 — Scrolling ticker strip on the launch page

**Status:** accepted (2026-09-15) — audited by planner, human verification passed.
Hover-pause verified from source only, not interactively; see "Not verified" below.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The launch page shows scrolling ticker strips — price, day change, and 5-day / 30-day / YTD returns
— computed entirely from the existing universe data, with the four `Coming soon` cards pushed below.

## Why

First of three contracts adapting `reference files/news_section_reference` (a Streamlit app) onto
this launch page. This one is deliberately first because **it needs nothing new**: no API key, no
new dependency, no LLM, no external service. Everything comes from `price_bars` and `ticker_quotes`.

The reference's `finance_ticker.py` hardcodes two firm-specific watchlists (`TCM_TICKERS`,
`GUS_TICKERS`). We do not need them — `quote_type` already partitions the universe into **9 EQUITY,
8 ETF, 3 INDEX**, so the groups come from the data.

**What ports and what does not.** The reference builds HTML strings for
`st.markdown(unsafe_allow_html=True)`; that becomes a React component. What transfers is the *data
shape* the README documents and the decision to compute returns server-side.

**Returns must be computed on the server.** 5D/30D/YTD need historical bars; sending them to the
client would mean ~161KB per ticker × 20 tickers. One endpoint returning ~20 rows of numbers instead.

**Depends on contracts 0024 and 0026.** If `ticker_quotes` does not exist, stop and report `BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** Any test touching market state must pin time
explicitly — patch **every module that imported the name**, not just where it is defined
(`REBUILD.md`; this bit twice).

## Files

Create:
- `backend/app/strip.py` — pure return calculations
- `backend/tests/test_strip.py`
- `frontend/src/components/TickerStrip.tsx`

Modify:
- `backend/app/schemas.py` — strip response models
- `backend/app/routers/universe.py` — one route, **declared above `/{ticker}`**
- `backend/tests/test_api_universe.py`
- `frontend/src/api/client.ts` — `getStrip` and types
- `frontend/src/pages/LaunchPage.tsx` — render the strip above the cards

**Touch nothing else.** Do not modify `app/cache.py`, `app/quotes.py`, `app/market_data.py`,
`app/freshness.py`, `app/models.py`, `app/universe.py`, `app/export.py`, any migration,
`tests/conftest.py`, `UniverseTable.tsx`, `UniversePage.tsx`, `ChartDialog.tsx`, `lib/`, or
`globals.css`. **No migration** — this computes from existing tables. No new dependencies.

## The route-ordering trap

`app/routers/universe.py` declares `@router.get("/{ticker}")`. A new **single-segment** route
declared after it is swallowed and returns `404 "not in universe"` — a plausible wrong answer, not
an error. Contract 0020 hit this with `export.zip`.

Declare `@router.get("/strip")` **above** `/{ticker}`, and **add a test asserting the route resolves
to the strip handler** — ordering is invisible to a reader and a future edit breaks it silently.

## Interface

### `app/strip.py` — pure

```python
def pct_return(latest: float | None, earlier: float | None) -> float | None:
    """Percent return between two prices. None when either is None or `earlier` is 0."""

def nth_prior_close(bars: list[tuple[date, float]], sessions: int) -> float | None:
    """The adj_close `sessions` trading sessions before the latest. None when short."""

def ytd_base_close(bars: list[tuple[date, float]], year: int) -> float | None:
    """The first adj_close on or after 1 January of `year`. None when absent."""
```

Pure — no database, no clock, no network. Bars arrive newest-last.

**Use `adj_close` for all three return windows, not `close`.** Returns are what `adj_close` exists
for: it includes dividends, and over a YTD window that is material — IBM yields 2.78%, so a
close-only YTD return understates it by roughly that much. The *price* shown is still the raw price;
only the percentages are adjusted.

**A ticker with insufficient history is omitted from that group**, not rendered as zero or null. The
reference does the same (`_compute_group` appends only when it has enough points) and the render side
then needs no null handling.

### Day change — the part with two cases

| market | `price` | reference for `change`/`pct` |
|---|---|---|
| open (`current_price` non-null) | `current_price` | `last_close` |
| closed | `last_close` | the close **before** it — second-newest bar |

When the market is closed, comparing `last_close` to itself gives 0.00% for every ticker and the
strip becomes a row of zeros, which is useless. Showing the last completed session's move is what a
ticker strip is for.

**This deliberately differs from the Universe table**, which shows `0.00%` when closed (contract
0026, Gunnar's explicit instruction). They answer different questions: the table asks "has this moved
since the close I am showing you," the strip asks "how did the session go." Do not change the table.

### `GET /universe/strip`

```
200 → StripResponse
503 → no database configured
```

```python
class StripQuote(BaseModel):
    ticker: str
    price: float | None
    change: float | None
    pct: float | None

class StripReturn(BaseModel):
    ticker: str
    pct: float

class StripGroup(BaseModel):
    label: str                    # 'Indices' | 'ETFs' | 'Equities'
    today: list[StripQuote]
    five_day: list[StripReturn]
    thirty_day: list[StripReturn]
    ytd: list[StripReturn]

class StripResponse(BaseModel):
    groups: list[StripGroup]
    as_of: datetime | None        # quote fetched_at, or null when closed
```

- Groups derive from `quote_type`: `INDEX` → `Indices`, `ETF` → `ETFs`, everything else → `Equities`.
  Order: Indices, ETFs, Equities. **Omit a group with no tickers** rather than returning it empty.
- Active universe members only.
- **Never fetch from yfinance.** Reads stored data only. Quote refresh stays owned by `list_all`.
- **Bounded queries** — one for bars, one for quotes/fundamentals. Must not scale per ticker; reuse
  contract 0008's counting approach in a test.
- Declared above `/{ticker}`.

### `components/TickerStrip.tsx`

```tsx
interface TickerStripProps { groups: StripGroup[] }
export function TickerStrip(props: TickerStripProps): JSX.Element | null
```

- One horizontally scrolling marquee **row per group**, labelled, each showing its `today` entries:
  ticker, price, and the percent coloured `text-brand-positive` / `text-brand-negative` /
  `text-[var(--color-muted)]` for up / down / flat.
- **Reuse `priceChange`'s direction rule from `lib/change.ts`** for colour — derived from the
  *rounded* value, so a `+0.00%` is never green. Do not reimplement it; import it.
- CSS animation only — `@keyframes` translating a duplicated track. No JS animation loop, no
  `requestAnimationFrame`, no dependency.
- **`prefers-reduced-motion: reduce` must stop the animation** and render the row statically
  scrollable. Perpetual motion is an accessibility failure and this is two lines of CSS.
- **Pause on hover**, so a user can read a row.
- Returns `null` for an empty `groups` array — the launch page must not show an empty labelled shell.
- Loading and error states are the page's job, not the component's.

The 5D / 30D / YTD rows are fetched and typed by this contract but **rendered in a later one** — get
the data pipeline right first. Do not render them yet.

### `LaunchPage.tsx`

Order becomes: hero → **TickerStrip** → the four `Coming soon` cards, unchanged.

- Fetch on mount with `useState`/`useEffect`. No data library.
- While loading or on error, **render the hero and cards normally and omit the strip.** The launch
  page must never break because a market endpoint is slow or down — it is the first thing anyone
  sees, and Render's free tier cold-starts at ~43 seconds.
- Do not alter the hero, the card copy, or the card grid.

## Tooltips

| element | copy |
|---|---|
| Each ticker in the strip | `<TICKER> — click to open its chart in the Universe` *(text only; no navigation in this contract)* |
| Group label | `Live prices for the <label> in your universe` |

Use the project `Tooltip`. **No navigation from the strip in this contract** — the tooltip describes
the eventual behaviour only if you also wire it; if you do not, use `<TICKER> price and day change`
instead and say so in the report.

## Out of scope

- No rendering of the 5D / 30D / YTD rows yet — data only.
- No news, articles, or AI summary. Contracts 0029 and 0030.
- No click-through navigation from the strip.
- No changes to the Universe page, its table, or its chart.
- No changes to the card copy or to what the cards link to.
- No migration, no new dependency, no yfinance calls.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 183.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. **Not bare `tsc --noEmit`.**
3. `npm run build` succeeds.
4. Route ordering: `grep -n '"/strip"' backend/app/routers/universe.py` shows an **earlier** line
   number than `grep -n '"/{ticker}"'`. Quote both. A test asserts `GET /universe/strip` returns the
   strip shape, not a 404.
5. Tests cover: `pct_return` with a zero and a `None` denominator (no `ZeroDivisionError`, no
   `inf`); `nth_prior_close` returning `None` on short history; `ytd_base_close` on a series starting
   mid-year; a ticker with too little history **omitted** from `five_day`; and the two day-change
   cases (market open vs closed).
6. `grep -rn "adj_close" backend/app/strip.py` matches — returns use adjusted closes.
7. `grep -rnE "except\s*:|except Exception" backend/app/strip.py backend/app/routers/universe.py`
   matches nothing (exit 1).
8. `grep -rn "prefers-reduced-motion" frontend/src/components/TickerStrip.tsx` matches.
9. `grep -rn "priceChange\|from '../lib/change'" frontend/src/components/TickerStrip.tsx` matches —
   colour logic imported, not reimplemented.
10. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/TickerStrip.tsx`
    matches nothing (exit 1).
11. `ls backend/migrations/versions/` shows exactly four revisions.
12. `git diff --stat backend/app/universe.py backend/app/quotes.py backend/app/cache.py frontend/src/components/UniverseTable.tsx frontend/src/pages/UniversePage.tsx frontend/package.json`
    is empty.
13. With the strip endpoint failing, `/` still renders hero and cards — verify by pointing
    `VITE_API_URL` at a dead port, or by stopping the backend.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n '"/strip"' backend/app/routers/universe.py
grep -n '"/{ticker}"' backend/app/routers/universe.py
grep -rn "adj_close" backend/app/strip.py
grep -rn "prefers-reduced-motion" frontend/src/components/TickerStrip.tsx
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
ls -1 backend/migrations/versions/
git diff --stat backend/app/universe.py backend/app/quotes.py frontend/src/pages/UniversePage.tsx frontend/package.json ; echo "(empty = untouched)"
```

## Human verification — does Gunnar need to run anything?

**Yes — it is a visual feature on the first page anyone sees.**

At `localhost:5173/`:

1. Three labelled rows scroll: **Indices, ETFs, Equities**. Percentages coloured red/green/grey.
2. **Hover a row — it pauses.** Move away and it resumes.
3. The four `Coming soon` cards sit **below** the strip, otherwise unchanged.
4. **Stop the backend and reload.** The hero and cards still render; the strip is simply absent. No
   blank page, no error banner covering the page.
5. Cross-check one ticker's percentage against the Universe table's change for the same ticker
   **during market hours** — they should agree. After hours they will **not**, and that is
   deliberate: the table shows `0.00%`, the strip shows the last session's move.

Point 5 is the one worth understanding rather than just checking.

## Open questions — do NOT resolve these yourself

- **Rendering the 5D/30D/YTD rows.** Data only in this contract; a later one renders them.
- **Clicking a ticker to open its chart.** Would need routing from `/` into `/universe` with state.
- **Whether the strip should appear on the Universe page too.** Not now.
- **What happens to the four cards.** Gunnar decides after all three news contracts land.

---

## Audit (planner, 2026-09-15)

Re-run against the working tree, not read from the report:

- `pytest -q` → **204 passed** (from 183)
- `/strip` at `backend/app/routers/universe.py:83`, `/{ticker}` at `:95` — ordered correctly
- `git diff --stat` empty for `universe.py`, `quotes.py`, `cache.py`, `UniverseTable.tsx`,
  `UniversePage.tsx`, `package.json` — scope held
- `frontend/src/main.tsx` clean against HEAD (see below)
- 4 migrations, unchanged
- Untracked files are exactly `app/strip.py`, `tests/test_strip.py`, `TickerStrip.tsx`, and this
  contract — no leftover harness
- Live `GET /universe/strip` → 200 with real quotes (`^GSPC -0.449%`, `^IXIC -0.782%`,
  `^RUT -0.759%`)

Human verification (Gunnar): points 1, 3, 4 passed. Three labelled rows in order, coloured
percentages, cards below and unchanged; with the backend stopped the hero and cards render and the
strip is simply absent.

### Not verified

- **Point 2, hover-pause.** Confirmed present in source
  (`.ticker-strip-track:hover .ticker-strip-marquee { animation-play-state: paused }`) but never
  observed as an interaction — no browser driver is installed and adding one was correctly refused
  under the no-new-dependency rule. Inference from source, not a measurement.
- **Point 5, cross-check against the Universe table during market hours.** Not done.

### Two process failures this contract exposed

Both are recorded in `REBUILD.md`, both coder role files, and `TEMPLATE-contract.md`:

1. A verification harness was built by editing `frontend/src/main.tsx`, leaving 48 lines of mock
   `fetch` returning fabricated strip prices. Harnesses are now new files only.
2. Verification ran against a stale `uvicorn` with no `--reload`, predating the route under test,
   which returned the route-ordering trap's exact 404 string from correctly-ordered code.
