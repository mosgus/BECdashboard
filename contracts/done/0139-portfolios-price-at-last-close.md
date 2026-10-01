> ## ⚠ REVISED 2026-10-01 — re-read this file before executing
> Gunnar wants the Holdings tab's **Price** column to keep showing the live intraday price.
> What changed: the `Price` → `Last close` header row is gone from §3. In its place, §3b keeps the
> header text `Price`, adds a tooltip to it, changes the Price cell to the live display chain, and
> rewords the Weight % tooltip. Criterion 4 changed to match.
> **Unchanged:** `positionPrice` still returns `last_close` only, and every calculation still uses it.
> Do **not** add a live fallback to `positionPrice` to serve the Holdings display; the display uses
> its own inline chain in `HoldingsPage.tsx`.

# Contract 0139 — Price every Portfolios valuation and trade at the last close

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`positionPrice()` returns the last completed session's close and nothing else, so every
shares-based valuation and trade uses the same price as Optimize and CAPM. User-facing copy stops
saying "current price".

## Why

Gunnar decided this on 2026-10-01. See `REBUILD.md`, "Every price in Portfolios is the last completed
session's close". Today re-marking, Cash edits, Add/buy and Sell price at `current_price`, while
Optimize and CAPM price at `last_close`. Apply therefore trades at a different price than the one
the portfolio is valued at. `tradeBasis` / `chartMode` also compare close-based weights against
live-marked weights with a 0.5-point tolerance, so the trade tables and the Holdings dollar chart
silently fall back to weights-only during market hours. Making `positionPrice` read `last_close`
removes both problems at the source, because every one of those paths already calls it.

## Files

Modify:
- `frontend/src/lib/portfolio.ts`: the `positionPrice` body and doc comment, four doc comments, and
  one problem string (listed below).
- `frontend/src/lib/portfolio.test.ts`: the `entry()` fixture, one asserted string, and the new tests
  below.
- `frontend/src/lib/portfolioStore.test.ts`: lines 85–86 fixture field.
- `frontend/src/lib/portfolioCsv.test.ts`: line 261 fixture field.
- `frontend/src/components/AddPositionForm.tsx`: copy only.
- `frontend/src/components/NewPortfolioDialog.tsx`: copy only.
- `frontend/src/components/PositionsTable.tsx`: copy only.
- `frontend/src/components/SellPositionDialog.tsx`: copy only.
- `frontend/src/pages/PortfoliosPage.tsx`: copy only.
- `frontend/src/pages/analysis/HoldingsPage.tsx`: copy, the Price cell's display chain, and two header tooltips (§3b).

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. That includes `optimize.ts`, `portfolioChart.ts`, `capm.ts`
and `UniverseTable.tsx`; none of them changes.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. `.claude/settings.json` denies Edit and Write there, but that list cannot see a shell
redirect, `sed -i`, `cp` or `mv`, so do not route around it.

## Interface

### 1. `positionPrice` in `frontend/src/lib/portfolio.ts`

Replace the current doc comment and function (currently lines 53–58) with exactly:

```ts
/** The one price every Portfolios valuation and trade uses: the last completed session's close,
 *  the same field Optimize and CAPM size trades on (decision 2026-10-01, contract 0139).
 *  Deliberately no fallback to a live quote — a fallback would reintroduce a second price. */
export function positionPrice(entry: UniverseEntry | undefined): number | null {
  if (entry === undefined) return null
  return entry.last_close
}
```

### 2. Doc comments in `frontend/src/lib/portfolio.ts`. Replace the text, keep everything else on the line

| current text | replace with |
|---|---|
| `/** Estimated at current prices: impliedPortfolioValue × cashWeight / 100.` | `/** Estimated at last closing prices: impliedPortfolioValue × cashWeight / 100.` |
| `/** Recalculate weights from shares × current price and the fixed cash. */` | `/** Recalculate weights from shares × last close and the fixed cash. */` |
| `/** Sell a shares-based holding at its current price into fixed cash, then re-mark (contract 0131).` | `/** Sell a shares-based holding at its last close into fixed cash, then re-mark (contract 0131).` |
| `/** Sell \`sellWeight\` points of portfolio weight of a shares-based holding at current prices into` | `/** Sell \`sellWeight\` points of portfolio weight of a shares-based holding at last closing prices into` |

And the problem string in `summariseDraft`:
`'Every asset needs a usable current price'` → `'Every asset needs a usable last close'`

### 3. User-facing copy: exact replacements

Change only the quoted string. Do not alter the surrounding JSX or logic.

| file | current | new |
|---|---|---|
| `AddPositionForm.tsx` (two occurrences, ~L71 and ~L179) | `Add by shares needs a usable current price for the selected ticker.` | `Add by shares needs a usable last close for the selected ticker.` |
| `AddPositionForm.tsx` ~L72 | `Every holding needs a current price before buying, so the weights can be re-marked.` | `Every holding needs a last close before buying, so the weights can be re-marked.` |
| `AddPositionForm.tsx` ~L126 | `The weight follows from shares and current prices.` | `The weight follows from shares and last closing prices.` |
| `AddPositionForm.tsx` ~L152 (two branches) | `from shares and current prices` / `from the share count and current prices` | `from shares and last closing prices` / `from the share count and last closing prices` |
| `NewPortfolioDialog.tsx` ~L257 | `Enter shares held; current prices calculate the initial allocation once.` | `Enter shares held; last closing prices calculate the initial allocation once.` |
| `PositionsTable.tsx` ~L44 | `` at its current price; the proceeds go to cash. `` | `` at its last close; the proceeds go to cash. `` |
| `PositionsTable.tsx` ~L66 **and** `HoldingsPage.tsx` ~L225 | `Estimated from your share counts at current prices:` | `Estimated from your share counts at last closing prices:` |
| `SellPositionDialog.tsx` ~L95 | `Current prices are needed to sell {ticker}.` | `Closing prices are needed to sell {ticker}.` |
| `SellPositionDialog.tsx` ~L143 | `Current prices changed; close and try again.` | `Prices changed while this was open; close and try again.` |
| `PortfoliosPage.tsx` ~L117 | `Current prices are needed to update the weights.` | `Closing prices are needed to update the weights.` |
| `PortfoliosPage.tsx` ~L122 | `Every holding needs a current price to update the weights.` | `Every holding needs a last close to update the weights.` |
| `PortfoliosPage.tsx` ~L188 | `` Current prices are needed to sell ${ticker} into cash. `` | `` Closing prices are needed to sell ${ticker} into cash. `` |
| `PortfoliosPage.tsx` ~L200 | `because a current price was missing` | `because a last close was missing` |
| `PortfoliosPage.tsx` ~L289 | `needs current prices for every holding` | `needs closing prices for every holding` |
| `PortfoliosPage.tsx` ~L344 | `recalculated from share counts and current prices.` | `recalculated from share counts and last closing prices.` |

### 3b. Holdings tab: live price for display, last close for everything computed

The Holdings tab **shows** the live quote. Its weights, cash estimate and charts are computed, so
they stay on `last_close`.

- **Price cell** (~L203). Replace `{formatPrice(positionPrice(entry))}` with exactly:
  ```tsx
  {formatPrice(entry === undefined ? null : entry.current_price ?? entry.last_close ?? entry.regular_market_price)}
  ```
  Then remove `positionPrice` from the `../../lib/portfolio` import on L13; it becomes unused.
- **Price header** (~L151). Replace `` <th className={`${TH} text-right`}>Price</th> `` with exactly:
  ```tsx
  <th className={`${TH} text-right`}>
    <Tooltip label="Live price during market hours, otherwise the last close. Weights and all analysis use the last close.">
      <span>Price</span>
    </Tooltip>
  </th>
  ```
- **Weight % tooltip** (~L144), the `valued.cashFixed` branch only. Replace
  `"Each holding's share of the portfolio at the last loaded prices. Share counts and cash dollars are fixed; weights move with prices."`
  with
  `"Each holding's share of the portfolio at the last close, the price Optimize and Outlook use. Share counts and cash dollars are fixed; weights update after each close."`
  Leave the other branch unchanged.
- The **Day** column is not touched.

Line numbers are approximate; match on the text. If any "current" text above is not found verbatim,
report `BLOCKED`. Do not guess at a near match.

### 4. Test fixtures. The field changed meaning, so the fixtures move with it

- `portfolio.test.ts` `entry()`: change `current_price: price, last_close: null,` to
  `current_price: null, last_close: price,`. Nothing else in the helper.
- `portfolio.test.ts`: the assertion `toBe('Every asset needs a usable current price')` becomes
  `toBe('Every asset needs a usable last close')`.
- `portfolioStore.test.ts` lines 85–86: `current_price: 55` → `last_close: 55`, and
  `current_price: 15` → `last_close: 15`.
- `portfolioCsv.test.ts` line 261: `current_price: 100` → `last_close: 100`.

Do **not** rename existing test titles, and do not change any other expected value. If an existing
test fails after these fixture edits, report `BLOCKED` with the output. Do not adjust its numbers.

### 5. New tests: append to `portfolio.test.ts`, verbatim

Add `positionPrice` to the existing `./portfolio` import list, and add a new import line
`import { tradeBasis } from './optimize'`. Then append:

```ts
describe('Portfolios price at the last close (decision 2026-10-01)', () => {
  const base: Portfolio = {
    ...portfolio(10, [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }]),
    cashDollars: 100,
  }
  const byTicker = new Map([
    ['AAA', { ...entry(45), ticker: 'AAA', current_price: 60, regular_market_price: 61 }],
    ['BBB', { ...entry(15), ticker: 'BBB', current_price: 20, regular_market_price: 21 }],
  ])

  it('positionPrice returns last_close even when a live quote differs', () => {
    expect(positionPrice(byTicker.get('AAA'))).toBe(45)
  })

  it('positionPrice does not fall back to a live quote when last_close is missing', () => {
    expect(positionPrice({ ...entry(null), current_price: 60, regular_market_price: 61 })).toBeNull()
  })

  it('re-marks at the last close, so the trade table keeps its dollar basis intraday', () => {
    const remarked = remarkPortfolio(base, byTicker)
    expect(remarked?.positions[0].weight).toBeCloseTo(45, 6)
    expect(remarked?.positions[1].weight).toBeCloseTo(45, 6)
    expect(remarked?.cashWeight).toBeCloseTo(10, 6)
    expect(tradeBasis(remarked!, new Map([['AAA', 45], ['BBB', 15]])).kind).toBe('dollar')
  })

  it('sells at the last close, not the live quote', () => {
    expect(removePositionSelling(base, 'AAA', byTicker)?.cashDollars).toBeCloseTo(550, 6)
  })

  it('buys at the last close, not the live quote', () => {
    const result = addPositionBuying(base, 'BBB', 2, byTicker)
    if (!result.ok) throw new Error(result.reason)
    expect(result.cost).toBeCloseTo(30, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(70, 6)
  })
})
```

(Under the old `positionPrice`, the re-mark test gives AAA a weight of 46.15 (600 / 1300), the sell gives 700 and
the buy costs 40. Each new test fails on the old code.)

## Out of scope

- Do not touch `tradeBasis`, `chartMode`, `applyPlan`, the 0.5-point tolerance, or anything in
  `optimize.ts` / `portfolioChart.ts` / `capm.ts`. The tolerance check is now satisfied by
  construction for shares-based portfolios; leave it in force for weight-based ones.
- Do not change `UniverseTable.tsx`, `TickerStrip`, `change.ts` or the Holdings **Day %** column.
  Those show the live quote on purpose.
- Do not add a `current_price` fallback to `positionPrice`, and do not create a new exported helper
  that returns a live price. The only live chain this contract adds is the inline Holdings Price
  cell in §3b, which is display-only.
- Do not touch `migrateLegacyPortfolio`'s handling of the legacy `cash` field. That is a separate
  question.
- Do not change `README.md` or `REBUILD.md`; the planner owns them.

## Acceptance criteria

1. `grep -n "return entry.last_close$" frontend/src/lib/portfolio.ts` prints exactly one line.
2. `grep -c "current_price" frontend/src/lib/portfolio.ts` prints `0`.
3. `grep -rn -i "current price" frontend/src/lib/portfolio.ts frontend/src/components/AddPositionForm.tsx frontend/src/components/NewPortfolioDialog.tsx frontend/src/components/PositionsTable.tsx frontend/src/components/SellPositionDialog.tsx frontend/src/pages/PortfoliosPage.tsx frontend/src/pages/analysis/HoldingsPage.tsx`
   prints nothing (exit 1). This also matches "current prices".
4. In `frontend/src/pages/analysis/HoldingsPage.tsx`:
   - `grep -c "positionPrice"` prints `0`;
   - `grep -c "entry.current_price ?? entry.last_close ?? entry.regular_market_price"` prints `1`;
   - `grep -c "<span>Price</span>"` prints `1`;
   - `grep -c "at the last loaded prices"` prints `0`.
5. `npx vitest run src/lib/portfolio.test.ts -t "last close"` (from `frontend/`) reports **5**
   passing tests and 0 failures.
6. Typecheck, the full test suite, build and lint all exit 0.
7. The coder states which files it edited. It must be a subset of the Files list.

`BLOCKED` is the correct answer to a criterion that cannot be satisfied, not just to an undecided
design question. If any criterion seems to require editing a file outside the list, changing an
existing test's expected numbers, or writing a string in an unusual way to pass a grep, stop and
report `BLOCKED`.

## Verification to run and paste

From the repository root. Paste the complete, verbatim output:

```bash
grep -n "return entry.last_close$" frontend/src/lib/portfolio.ts
grep -c "current_price" frontend/src/lib/portfolio.ts
grep -rn -i "current price" frontend/src/lib/portfolio.ts frontend/src/components/AddPositionForm.tsx frontend/src/components/NewPortfolioDialog.tsx frontend/src/components/PositionsTable.tsx frontend/src/components/SellPositionDialog.tsx frontend/src/pages/PortfoliosPage.tsx frontend/src/pages/analysis/HoldingsPage.tsx; echo "exit=$?"
grep -c "positionPrice" frontend/src/pages/analysis/HoldingsPage.tsx
grep -c "entry.current_price ?? entry.last_close ?? entry.regular_market_price" frontend/src/pages/analysis/HoldingsPage.tsx
grep -c "<span>Price</span>" frontend/src/pages/analysis/HoldingsPage.tsx
grep -c "at the last loaded prices" frontend/src/pages/analysis/HoldingsPage.tsx
(cd frontend && npx vitest run src/lib/portfolio.test.ts -t "last close" 2>&1 | tail -6)
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit=$?")
(cd frontend && npm run test 2>&1 | tail -5)
(cd frontend && npm run build 2>&1 | tail -3)
(cd frontend && npm run lint 2>&1 | tail -4)
git status --short
```

## Tooltips — required for any contract adding interactive elements

One new tooltip: the Holdings **Price** header (§3b), wrapped exactly as the neighbouring **Day**
header is. Other tooltip copy changes only as listed in §3 and §3b.

## Human verification — does Gunnar need to run anything?

Yes, during market hours, on a shares-based portfolio with a holding that has moved intraday:
1. Holdings: the **Price** column shows the live price, matching the Universe page, and Day % still
   moves. **Weight %** does not move intraday, and hovering it says "at the last close".
2. Optimize: run any mode. The trade table shows dollars and share counts. It should not show the
   "weights only" note, which it could before when a holding had moved about 3% or more.
3. Remove → Sell dialog: the proceeds equal shares × last close.

## Open questions

None.
