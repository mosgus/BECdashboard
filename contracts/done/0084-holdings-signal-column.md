# Contract 0084 — The Holdings Signal column

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

Holdings drops the `30D` column, moves `YTD` into its place, and gains a `Signal` column driven by one
selector above the table — showing a bull/bear/neutral badge plus ATR as a percentage.

## Why

Contracts 0082 (the signal engine) and 0083 (the RSI flat-series fix) are accepted. This is the
column. Gunnar's call, 2026-09-22.

Three things deliberately differ from `main`'s Holdings page, all decided and recorded in
`REBUILD.md`:

- **One selector above the table, not a dropdown per row.** The reference gives every row its own
  `<select>`, so row 1 can show SMA while row 2 shows MACD — the column cannot be read as a column.
- **ATR is a number with no bull/bear reading.** The reference offers `ATR` in its dropdown and
  produces no ATR signal at all, so selecting it shows an empty cell. ATR measures magnitude, not
  direction.
- **`state: null` renders differently from `NEUTRAL`.** Null means not enough history to compute;
  neutral means computed and unremarkable. A ticker added last week is not the same as a ticker going
  nowhere.

## Files

Create:
- `frontend/src/components/SignalBadge.tsx` — the five-state badge.

Modify:
- `frontend/src/api/client.ts` — `getSignals`.
- `frontend/src/pages/analysis/HoldingsPage.tsx` — the column, the selector, the 30D removal.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**Gunnar hand-styles these files.** `HoldingsPage.tsx` and `Header.tsx` both carry recent hand-edits;
`Header.tsx` is not in scope at all. Change only what this contract names — do not reformat or
re-indent surrounding markup. `REBUILD.md` records contract 0035, where a contract written from a
report rather than from disk reverted one of his edits.

Do not touch `AnalysisLayout.tsx`, `UniverseTable.tsx`, `portfolio.ts`, or any backend file.

**`reference files/` is read-only and never belongs on a file list.** Read `main` in place with
`git show main:frontend/components/SignalBadge.tsx` for its glyphs and labels — the *colours* there
are Tailwind defaults (`bg-green-100`) and must not be copied; this project uses brand tokens.

## Interface

### Client

```ts
export interface SignalOut {
  signal: string            // "sma_cross" | "rsi_threshold" | "macd_cross"
  label: string             // "SMA 20/50" | "RSI 14" | "MACD 12/26/9"
  state: string | null
  last_trigger_date: string | null
}

export interface TickerSignals {
  ticker: string
  signals: SignalOut[]
  atr_pct: number | null
}

export interface SignalsResponse {
  signals: TickerSignals[]
  as_of: string | null
}

export function getSignals(tickers: string[]): Promise<SignalsResponse>
```

`getSignals([])` returns `{ signals: [], as_of: null }` **without a request**, matching `getReturns`.
Build the query with `URLSearchParams`; go through the existing `request` helper.

### `SignalBadge`

```tsx
export function SignalBadge({ state }: { state: string | null }): JSX.Element
```

| state | glyph + label | treatment |
|---|---|---|
| `BULLISH` | `↑ Bullish` | `text-brand-positive` |
| `BEARISH` | `↓ Bearish` | `text-brand-negative` |
| `NEUTRAL` | `— Neutral` | muted |
| `OVERBOUGHT` | `↑↑ Overbought` | muted |
| `OVERSOLD` | `↓↓ Oversold` | muted |
| `null` | `—` | muted |

**Overbought and oversold are deliberately not coloured.** They are *caution* readings, not direction
calls — an overbought stock is extended, which is neither a buy nor a sell signal. Colouring
overbought green because it contains an up-arrow would assert something the indicator does not say.
The glyph and the word carry the meaning. A dedicated caution colour is a later refinement if Gunnar
wants one; do not invent a token for it here.

An unrecognised state renders as `null` does. Do not throw.

### The selector

Above the table, right-aligned or beside the existing content — one `<select>`, three options, backed
by component state. Default `sma_cross`.

```tsx
const SIGNAL_OPTIONS = [
  { value: 'sma_cross', label: 'SMA Cross' },
  { value: 'rsi_threshold', label: 'RSI' },
  { value: 'macd_cross', label: 'MACD' },
] as const
```

Changing it re-renders from **already-fetched data**. It must **not** refetch — all three signals come
back in one response, so the selector is a display filter and nothing more. A refetch here would turn
one request into three for no new information.

### The column

Final column order: `Ticker · Name · Weight % · Shares · Price · Day · 5D · YTD · [Since] · Signal`

- **`30D` is removed.** Nothing else about `getReturns` changes — the endpoint still returns
  `thirty_day` and that is fine; this is a display decision, not an API one. Do not change the
  endpoint or the client type to drop it.
- `YTD` moves into the position `30D` occupied.
- `Since` stays conditional on `basisDate`, exactly as contract 0081 left it.
- **`Signal` is last.**

Each Signal cell contains the badge for the selected signal, then `atr_pct` as muted text:

```
↑ Bullish    ATR 3.1%
```

- `atr_pct` renders as `ATR {formatPercent(atr_pct)}`, muted, never coloured.
- `atr_pct` null → omit the ATR text entirely rather than printing `ATR —`.
- A ticker absent from the response, or with `signals: []`, renders `—` and no ATR.
- **The cash row's Signal cell is `—`.** Cash has no price series.

The header carries the selected signal's `label` from the response — `SMA 20/50`, not `SMA Cross` — so
the parameters are visible without hovering. Fall back to the option label when no row has data.

### Fetching

Add `getSignals` to the existing mount effect beside `getUniverse` and `getReturns`, with its own
`LoadState`. On failure: Signal cells show `—` and a line appears above the table reading
`Signals could not be loaded.` — the same pattern the other two already use.

## Out of scope

- **No ATR signal state.** It is a number. Decided 2026-09-22.
- No per-row selector. Decided.
- No sorting by signal, no filtering rows by signal, no "all signals at once" view.
- Do not change `getReturns`, the returns endpoint, or remove `thirty_day` from the API.
- Do not add a chart, a sparkline, or a link from the badge.
- Do not show `last_trigger_date` in the cell. It is in the response and will earn a place later;
  a date in every row makes the column unreadable at this width.
- Do not add tests. The 63 `src/lib/` tests must stay untouched and passing.
- No new dependency.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
2. `cd frontend && npm run build` exits 0. Report the main chunk's gzip size before and after.
3. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
4. `cd frontend && npm run test` exits 0 with **63** tests — unchanged.
5. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; no
   backend file is in scope. It was **491**.
6. `grep -n "thirty_day" frontend/src/pages/analysis/HoldingsPage.tsx` prints nothing — the column is
   gone from the page.
7. `grep -n "thirty_day" frontend/src/api/client.ts` still prints the type field — the API is
   unchanged.
8. **Reading the diff: changing the selector does not trigger a fetch.** Quote the lines that
   guarantee it — the selector's state must not appear in any effect's dependency array.
9. `grep -n "bg-green-100\|bg-red-100\|bg-orange-100\|bg-blue-100\|bg-gray-100" frontend/src/components/SignalBadge.tsx`
   prints nothing — the reference's Tailwind defaults were not copied.
10. `grep -n "OVERBOUGHT\|OVERSOLD" frontend/src/components/SignalBadge.tsx` shows both mapped to the
    muted treatment, not to positive or negative.
11. Reading the diff: `getSignals([])` returns without issuing a request. Quote the guard.
12. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
13. `git status --porcelain frontend/src/components/Header.tsx` — report whatever it shows and confirm
    **you** did not edit it. It carries a hand-edit from Gunnar.
14. State exactly which files you created and edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "thirty_day" frontend/src/pages/analysis/HoldingsPage.tsx ; echo "30d-removed exit: $?"
grep -n "thirty_day" frontend/src/api/client.ts
grep -n "bg-green-100\|bg-red-100\|bg-orange-100\|bg-blue-100\|bg-gray-100" frontend/src/components/SignalBadge.tsx ; echo "no-default-tailwind exit: $?"
grep -n "OVERBOUGHT\|OVERSOLD" frontend/src/components/SignalBadge.tsx
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/src/components/Header.tsx
```

## Tooltips — required for any contract adding interactive elements

| element | tooltip label |
|---|---|
| The signal `<select>` | `Choose which technical signal the table shows for every holding` |
| `Signal` column header | `Computed from stored price history. ATR is average true range as a percentage of price — it measures volatility, not direction.` |

Do **not** use the `title` attribute. Individual badges get no tooltip — the glyph and label already
say what they mean, and `REBUILD.md` records that a tooltip repeating a visible label is noise.

## Human verification — does Gunnar need to run anything?

**Yes. The numbers are the part nothing here can judge.**

```bash
cd frontend && npm run dev
```

1. Open a portfolio's **Holdings** tab. Confirm `30D` is gone, `YTD` sits where it was, and `Signal` is
   the last column.
2. **Switch the selector between SMA Cross, RSI and MACD.** The column changes instantly and the
   network tab shows **no new request** — all three arrived together.
3. **Check one SMA crossover against a public chart.** If we say a ticker turned bullish, the 20- and
   50-day lines should visibly cross there on TradingView or StockCharts. This is the easiest of the
   three to falsify and the one most worth doing.
4. **Sanity-check ATR.** An index ETF should read roughly 0.5–1.5%; a volatile single name several
   percent. If every row reads the same, the percentage conversion is wrong.
5. **Find a recently-added ticker** with under 50 sessions of history. Its SMA signal should render
   `—`, not `Neutral`. That distinction is what contract 0082 departed from the reference to preserve.
6. Check at **1024px and 1023px** and at 375px, with a basis date set so `Since` is also present —
   that is ten columns, the widest this table has been. `REBUILD.md` records the Universe table
   clipping silently three times; use `document.querySelector('table').scrollWidth` against its
   container's `clientWidth` rather than judging by eye.

## Open questions — do not resolve these yourself

None. The single selector, ATR-as-a-number, and the column order were decided by Gunnar on
2026-09-22. If you find another, report `BLOCKED` and stop.
