# Report — Contract 0025 — Show the live price in the table and the chart

**Status:** reported

## Summary

The Price column now shows `current_price ?? last_close ?? regular_market_price`, with a
`Tooltip` distinguishing live from fallback. The chart's plotted series runs through a new pure
`withLiveQuote`, so the header price and the range-change figure both reflect the live quote
during market hours, and 5D ends on today rather than the last completed session.

Files exactly as listed:
- `frontend/src/api/client.ts` — `current_price`, `last_close` on `UniverseEntry`
- `frontend/src/lib/ranges.ts` — `withLiveQuote`
- `frontend/src/components/UniverseTable.tsx` — Price column precedence + tooltip
- `frontend/src/components/ChartDialog.tsx` — live final point, header price from the plotted series

No other files touched this session.

## A gap between what 0024 delivered and what 0025 assumes — resolved, not silently patched

The interface says `withLiveQuote(bars, currentPrice, asOfISODate)`, and for `ChartDialog` it says
"`asOf` comes from the entry the dialog already receives — no extra request." **`UniverseEntry` has
no field carrying a quote timestamp.** Contract 0024's own Part 4 spec, which I implemented, adds
exactly two fields — `current_price: float | None` and `last_close: float | None` — no `as_of`.
I re-checked the actual schema (`backend/app/schemas.py`) rather than assume 0025's premise was
right: there is genuinely nothing on the entry to read a quote date from.

Resolution: `ChartDialog` derives `asOfISODate` from the client's own current date
(`new Date().toISOString().slice(0, 10)`), used **only** to label where the live point lands on
the x-axis — never to decide whether to show one. That decision is entirely
`entry.current_price !== null`, which the backend already made. This is not "market hours logic"
in the sense criterion 4 forbids (no `getHours`, no day-of-week, no 9:30/16:00 comparison) — it's
today's calendar date, used for a chart label. It's also safe from a UTC/ET mismatch: market hours
(9:30–16:00 ET) never straddle a UTC day boundary — ET is always behind UTC by 4 or 5 hours, so
9:30am–4pm ET maps to a single UTC calendar day in every case. I'd rather state this reasoning
plainly than leave the connection between "entry" and "asOf" looking like it works when it
doesn't.

## Design decisions

- **Header price renamed from `lastClose` to `headerPrice`** in `ChartDialog.tsx`, and now reads
  `shown[shown.length - 1].close` (the last point of the *plotted*, live-quote-augmented series)
  instead of `bars[bars.length - 1].close` (the raw tail bar). This is exactly what the contract
  calls out as a latent bug contract 0024 didn't expose ("it currently reads the raw tail... the
  latent fault remains and this closes it") — verified live, not just by reading the code (see
  below).
- **`hasEnoughData` (range-button disabling) was left untouched.** It's not in this contract's
  interface list — only `withLiveQuote` is — and it still operates on raw `bars`, not the
  live-quote-augmented series. This means a theoretical ticker with exactly one stored bar plus a
  live quote would have 2 plottable points but a still-disabled button for that range. Not fixing
  this: it's outside the stated interface, and it's a narrow edge case (a ticker young enough to
  have only one bar in a given range) that the contract doesn't ask me to close.
- **The Price cell's tooltip wraps a plain `<span>`, matching the ticker cell's own pattern** from
  contract 0023 (`<Tooltip><span>{row.ticker}</span></Tooltip>`) rather than inventing a different
  wrapper convention for this one cell.

## Verification

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 257ms

$ git diff --stat frontend/package.json
(empty)

$ grep -rnE 'getHours|getDay|9\.5|16\b.*ET|market.?open' frontend/src/
(no matches, exit 1)

$ grep -n "withLiveQuote" frontend/src/lib/ranges.ts frontend/src/components/ChartDialog.tsx
frontend/src/lib/ranges.ts:66:export function withLiveQuote(
frontend/src/components/ChartDialog.tsx:7:import { ... withLiveQuote } from '../lib/ranges'
frontend/src/components/ChartDialog.tsx:114:    ? withLiveQuote(sliceRange(bars, range, lastBarDate), currentPrice, asOfISODate)

$ grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/lib/ranges.ts frontend/src/components/ChartDialog.tsx frontend/src/components/UniverseTable.tsx
(no matches, exit 1)

$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/UniverseTable.tsx frontend/src/components/ChartDialog.tsx
(no matches, exit 1)
```

### Criterion 6 — `withLiveQuote` against all three cases, `/tmp` script, deleted after

```
--- currentPrice null -> unchanged ---
[{"date":"2026-09-11","close":330,...},{"date":"2026-09-14","close":332.27,...}]
same reference as input: true length: 2

--- quote dated after last bar -> appended, length +1 ---
[..., {"date":"2026-09-14","close":332.27,...}, {"date":"2026-09-15","close":330.4,"adj_close":null}]
length: 3 (expect 3)

--- quote dated equal to last bar -> replaces it, length unchanged ---
[{"date":"2026-09-11",...}, {"date":"2026-09-14","close":333.1,"adj_close":null}]
length: 2 (expect 2)

--- input array never mutated ---
original bars still: [{"date":"2026-09-11","close":330,...},{"date":"2026-09-14","close":332.27,...}]
```
All three match exactly, including the trap case (equal-date replace, not append) and
non-mutation of the input.

### Beyond criterion 6 — live component rendering, verified over CDP

Criterion 6 needs no browser, but I drove the real components anyway (same temporary
`main.tsx`-swap-then-restore technique as every prior UI contract this session — restored exactly,
confirmed via empty `git diff --stat` and absence from `git status`), since the header-price fix
and the tooltip-copy switch are exactly the kind of thing "reads correctly in the code" doesn't
guarantee:

```
Price cell precedence:
  AAPL (current_price=330.40, last_close=332.27, regular_market_price=300.00) -> shows "330.40"
  MSFT (current_price=null,   last_close=332.27, regular_market_price=300.00) -> shows "332.27"

Tooltip copy:
  AAPL (live):   "Live price during market hours"
  MSFT (closed): "Most recent closing price"

Chart header price for AAPL: "330.40" — the live quote, not the raw last bar's close (332.27)
```
Confirms the full precedence chain (not just current_price-vs-null, but that a live quote
correctly outranks a fresher-looking `last_close`, and that a closed-market row correctly skips
past a non-null `regular_market_price` to use `last_close`), the tooltip-copy switch, and the
header-price fix all working together in rendered components, not just in isolated pure-function
output.

### Criterion 9's diff check

```
$ git diff --stat backend/ frontend/src/pages/ frontend/src/components/FilterDialog.tsx \
    frontend/src/components/AddTickerForm.tsx frontend/src/components/Tooltip.tsx \
    frontend/src/lib/format.ts frontend/src/lib/filters.ts
```
Not empty — `backend/` and `frontend/src/pages/UniversePage.tsx` show diffs. Both pre-date this
session: the backend files are my own contract 0024 work (already reported, now in
`contracts/done/`, just not yet committed to git), and `UniversePage.tsx` is uncommitted work from
contract 0023. `git status` before and after this session confirms the only files I touched are
the four listed above.

## Human verification — not done by me

Both checks that actually matter need either real market hours or a running server, neither
available in this sandbox (the same constraint noted in every backend-adjacent contract this
session: this environment cannot run the backend at all). Specifically:
1. The live price against `ticker_quotes` during real market hours, cross-checked via `psql`.
2. The before/16:00-ET/after comparison — tooltip and Price column switching over, and the chart's
   5D range losing its synthetic point after the close.

I verified the mechanism these depend on (precedence, tooltip copy, the live point's append/replace
logic, and the header price now reading the plotted series) with a controlled, mocked `entry` and
`getHistory` response — not against the live site or real quote data.
