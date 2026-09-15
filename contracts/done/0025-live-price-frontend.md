# Contract 0025 — Show the live price in the table and the chart

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The Price column shows the live intraday price while the market is open and the most recent close
outside it, and the chart's 5D range ends on the live price rather than the last completed session.

## Why

Contract 0024 added `current_price` and `last_close` to `UniverseEntry` and the backend is already
serving them — verified 2026-09-15 at 14:29 ET, with AAPL quoted at 330.40 against a 332.27 last
close. Nothing on the frontend reads them yet.

**The market-hours decision lives entirely in the backend.** `current_price` is `null` outside
trading hours and when the stored quote is older than the 10-minute TTL, so the client needs no
clock logic at all — it prefers `current_price` when present and falls back otherwise. Do not
reimplement market hours in TypeScript.

**Depends on contract 0024.** If `UniverseEntry` in `api/client.ts` cannot be given a
`current_price` because the API does not return one, stop and report `BLOCKED`.

## Files

Modify:
- `frontend/src/api/client.ts` — two new fields on `UniverseEntry`
- `frontend/src/lib/ranges.ts` — one pure function to append the live point
- `frontend/src/components/UniverseTable.tsx` — Price column precedence and its tooltip
- `frontend/src/components/ChartDialog.tsx` — live final point, header price

**Touch nothing else.** Do not modify `UniversePage.tsx`, `FilterDialog.tsx`, `AddTickerForm.tsx`,
`Tooltip.tsx`, `lib/format.ts`, `lib/filters.ts`, `globals.css`, or anything under `backend/`. No new
dependencies. If the work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `api/client.ts`

Add to `UniverseEntry`, after `regular_market_price`:

```ts
current_price: number | null   // live quote; null outside market hours or when stale
last_close: number | null      // most recent non-null close from price_bars
```

Both nullable. `regular_market_price` stays — it is a fundamentals-snapshot field on a different
clock and is now the **last** fallback, not the first.

### Price column precedence

```
current_price  ??  last_close  ??  regular_market_price  ??  "—"
```

`current_price` first because it is live. `last_close` second because it is a real session close.
`regular_market_price` last because it was captured whenever fundamentals were last fetched and may
be days old.

**No visual styling change to the cell** — no colour, no badge, no asterisk. Which value is showing
is carried by the tooltip below, not by decoration the user has to learn.

### `lib/ranges.ts` — one pure function

```ts
export function withLiveQuote(
  bars: PriceBar[],
  currentPrice: number | null,
  asOfISODate: string | null,
): PriceBar[]
```

- Returns `bars` unchanged when `currentPrice` is `null` — that is the closed-market case and it is
  the common one.
- Otherwise appends a synthetic bar `{ date: asOfISODate, close: currentPrice, adj_close: null }`.
- **If `asOfISODate` already matches the last bar's date, replace that bar rather than appending
  it.** After the close, the daily bar for today exists *and* a quote may still be stored; appending
  would put two points on the same date and draw a visible spike. This is the case that breaks a
  naive implementation.
- Never mutates the input array.
- Pure — no clock, no React.

Applied **after** range slicing, so the live point survives every range.

### `ChartDialog.tsx`

- Build the plotted series as `withLiveQuote(sliceRange(bars, range, anchor), currentPrice, asOf)`.
- **The header price is the last point of the *plotted* series**, not the last raw bar. It currently
  reads the raw tail; contract 0024 removed the null-close rows that exposed that as a visible bug,
  but the latent fault remains and this closes it.
- The range change figure is computed over the plotted series too, so during market hours the 5D
  move includes today.
- `asOf` comes from the entry the dialog already receives — **no extra request.**

**No `1D` range button.** Explicitly out of scope; the live point appears within the existing
ranges.

## Tooltips — required for any contract adding interactive elements

This contract adds no new controls, but the Price cell gains one because the value is now ambiguous:

| element | copy |
|---|---|
| Price cell, live | `Live price during market hours` |
| Price cell, fallback | `Most recent closing price` |

Use the project `Tooltip`, not `title`. Pick the copy from whether `current_price` is non-null —
this is the only place the client distinguishes the two, and it is presentation, not market-hours
logic.

## Out of scope

- **No `1D` range button.** Explicitly rejected.
- No market-hours logic in TypeScript — the backend already decided.
- No polling or auto-refresh on the page; a live price appears on load and on `Update all`.
- No colour, flash, or animation on price change.
- No intraday chart granularity — one synthetic point, not a minute series.
- No change to `Update all`, filters, or the export endpoints.
- No new dependencies.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
2. `npm run build` succeeds.
3. `git diff --stat frontend/package.json` is empty — no dependency added.
4. `grep -rnE 'getHours|getDay|9\.5|16\b.*ET|market.?open' frontend/src/` matches nothing (exit 1) —
   no market-hours logic on the client.
5. `grep -n "withLiveQuote" frontend/src/lib/ranges.ts frontend/src/components/ChartDialog.tsx`
   matches in both.
6. **`withLiveQuote` verified against the three cases**, in a temporary script written to `/tmp`,
   not the repo, deleted afterwards. Paste the output:
   - `currentPrice = null` → input returned unchanged
   - a quote dated **after** the last bar → appended, length +1
   - a quote dated **equal to** the last bar → **replaces** it, length unchanged
7. `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/lib/ranges.ts frontend/src/components/ChartDialog.tsx frontend/src/components/UniverseTable.tsx`
   matches nothing (exit 1).
8. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/UniverseTable.tsx frontend/src/components/ChartDialog.tsx`
   matches nothing (exit 1).
9. `git diff --stat backend/ frontend/src/pages/ frontend/src/components/FilterDialog.tsx frontend/src/components/AddTickerForm.tsx frontend/src/components/Tooltip.tsx frontend/src/lib/format.ts frontend/src/lib/filters.ts`
   is empty.

Criterion 6 is the one with a real trap in it. If a browser is unavailable for the visual checks,
say so plainly under "Not done" — but criterion 6 needs no browser.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff --stat frontend/package.json ; echo "(empty = no deps)"
grep -rnE 'getHours|getDay|9\.5|16\b.*ET|market.?open' frontend/src/ ; echo "exit=$? (1 means no client-side market hours)"
grep -n "withLiveQuote" frontend/src/lib/ranges.ts frontend/src/components/ChartDialog.tsx
grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/lib/ranges.ts frontend/src/components/ChartDialog.tsx frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
git diff --stat backend/ frontend/src/pages/ ; echo "(empty = untouched)"
```

## Human verification — does Gunnar need to run anything?

**Yes, and the interesting half needs the market open.**

**During market hours** (9:30–16:00 ET, weekday), at `localhost:5173/universe`:

1. The Price column shows the **live** price. Cross-check one ticker against the database:
   `psql "$DATABASE_URL" -c "select ticker, price from ticker_quotes order by ticker limit 5"` — the
   table should match.
2. Hover a Price cell → `Live price during market hours`.
3. Open a chart, switch to **5D**. The final point should be **today**, at the live price, past the
   last completed session.
4. The header price in the dialog matches the table's Price cell for that ticker.

**After 16:00 ET**, reload:

5. Price falls back to the most recent close — and the tooltip changes to
   `Most recent closing price`.
6. On 5D the chart ends on the last completed session, with no synthetic point.

That before/after is the whole feature, and it is the decision you made about market hours made
visible.

## Open questions — do NOT resolve these yourself

- **Auto-refreshing the page during market hours** so the price updates without a reload. Not now;
  the value refreshes on load and on `Update all`.
- **Showing the quote timestamp** in the table. The tooltip says live or close, not when.
- **Colouring the price** by daily direction. Would need a previous close to compare against on the
  client; out of scope.
- **Pre-market and after-hours quotes.** Regular session only, per contract 0024.
