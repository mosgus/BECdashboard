# Contract 0129 — Shares-based portfolios: fixed cash dollars, weights re-marked from prices

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

When every holding in a portfolio has a share count, **the shares and a fixed cash dollar amount
are the truth**, and the weights follow prices. A traditional brokerage account behaves the same way.

Today the reverse holds: weights are saved and fixed (contract 0059), and cash dollars are
re-estimated from prices, so a preset's cash in dollars changes every day.

This contract is **piece 1** of that change:

1. A portfolio may carry a saved `cashDollars`. A **shares-based** portfolio has `cashDollars`
   and a share count on every position.
2. Whenever the Universe loads, each shares-based portfolio is **re-marked**: its saved `weight`s
   and `cashWeight` are recalculated from shares × current price plus the fixed cash, then saved.
   Every other page keeps reading saved weights unchanged, so all tabs see the same snapshot.
3. Creating a portfolio saves `cashDollars` whenever every row has shares.
4. Exporting a shares-based portfolio writes `ticker,shares` with a `CASH,<dollars>` row and
   no weights.
5. The BEC preset becomes shares plus cash dollars, with no weights.
6. Any operation that edits weights directly on a shares-based portfolio drops `cashDollars`, so
   the portfolio safely reverts to weight-based. Those operations are add position, remove
   position, the cash-% editor, and Optimize/CAPM Apply. Teaching them to trade shares is piece 2
   and out of scope here.

## Why the re-mark approach

About 14 files read saved `weight`/`cashWeight`: Optimize, CAPM, Risk, charts, the tables and more.
Recalculating on each page would touch all of them. Re-marking at the single point where prices
arrive (`getUniverse` in `api/client.ts`) keeps the saved weights consistent with shares, so none
of those readers change. This also means the existing "shares vs. weights agree within 0.5 points"
checks (dollar mode in the charts, dollar basis in Optimize) stay satisfied for shares-based
portfolios. Before, drift pushed portfolios out of them.

Gunnar accepted these known costs:
- Weights are as of the **last Universe load**, not live tick by tick.
- The re-mark writes to storage.
- Shares-only files and presets need Universe prices to be created (already true for shares mode).
- The BEC preset now ships Blue Eagle's real share counts and cash. This reverses the REBUILD
  rule "A preset never carries share counts" by Gunnar's decision. The planner updates REBUILD.md.

## Files

Modify only these (+ their tests). Anything else → `BLOCKED`.

| File | Change |
|---|---|
| `frontend/src/lib/portfolio.ts` | `cashDollars?` field, validation, `isSharesBased`, `remarkPortfolio`, `creationCashDollars`, `DraftSummary.cashDollars`, `ValuedPortfolio.cashFixed` |
| `frontend/src/lib/portfolioStore.ts` | `savePortfolio` keeps `cashDollars`; new `remarkStoredPortfolios` |
| `frontend/src/api/client.ts` | `getUniverse` calls `remarkStoredPortfolios` |
| `frontend/src/lib/portfolioCsv.ts` | shares-based export format |
| `frontend/src/components/NewPortfolioDialog.tsx` | save `cashDollars` on create |
| `frontend/src/pages/PortfoliosPage.tsx` | cash-% editor drops `cashDollars` |
| `frontend/src/components/PositionsTable.tsx` | cash tooltip text depends on `cashFixed` |
| `frontend/src/pages/analysis/HoldingsPage.tsx` | cash tooltip and Weight % header tooltip depend on `cashFixed` |
| `frontend/src/lib/presets.ts` | BEC preset CSV (exact text below) |
| tests: `portfolio.test.ts`, `portfolioStore.test.ts`, `portfolioCsv.test.ts`, `presets.test.ts` | see Acceptance |

## Detailed changes

### 1. `lib/portfolio.ts`

**Model.**
```ts
export interface Portfolio {
  id: string
  name: string
  cashWeight: number
  positions: Position[]
  updatedAt: string
  /** Fixed cash in dollars. Present only on shares-based portfolios (contract 0129); weights are then
   *  a snapshot re-marked from shares × price whenever the Universe loads. */
  cashDollars?: number
}
```

**Validation.** In `isValidCurrentPortfolio`, add: `candidate.cashDollars` must be `undefined`
or a finite number `>= 0`. Otherwise the function is unchanged. A `cashDollars` on a portfolio
where some positions lack shares is still **valid**; it's simply not shares-based. Do not reject it.

**New exports:**

```ts
/** Shares are the truth: cash dollars are saved and every position has a share count. */
export function isSharesBased(portfolio: Portfolio): boolean
```
Returns true iff `portfolio.cashDollars !== undefined` and every position has
`isFinitePositive(position.shares)`. An empty positions list returns true.

```ts
/** Recalculate weights from shares × current price and the fixed cash. Null when not shares-based,
 *  when there are no positions, or when any price is unusable — the caller keeps the last snapshot. */
export function remarkPortfolio(portfolio: Portfolio, byTicker: Map<string, UniverseEntry>): Portfolio | null
```
- Return null unless `isValidCurrentPortfolio(portfolio)` and `isSharesBased(portfolio)` hold and
  `positions.length > 0`.
- For each position, `price = positionPrice(byTicker.get(ticker))`. Return null if any price fails
  `isFinitePositive`.
- `value = shares × price`, and `total = Σ value + cashDollars`. Return null unless
  `isFinitePositive(total)`.
- Return a **new** object with the same `id`, `name`, `updatedAt` (**not** re-stamped) and
  `cashDollars`. Also set `positions` = the same positions in the same order, each with
  `weight = value / total × 100` and `shares` kept. Set `cashWeight = cashDollars / total × 100`.
- Return null if the result fails `isValidCurrentPortfolio` (defensive).
- Never mutate the input.

```ts
/** cashDollars to save when a portfolio is created, or undefined for a weight-based one. */
export function creationCashDollars(
  mode: EntryMode,
  summaryCashDollars: number | null,
  portfolio: Portfolio,
  byTicker: Map<string, UniverseEntry>,
): number | undefined
```
- In **shares mode**: `summaryCashDollars` when it is non-null and `>= 0`, else `undefined`. Use
  the typed number exactly so `$292,406.58` is saved as `292406.58`, not a float round trip.
- In **weight mode**: if every position has shares and `impliedPortfolioValue(portfolio, byTicker)`
  is non-null, return `implied × portfolio.cashWeight / 100`. This freezes cash at creation-day
  prices. Otherwise return `undefined`.

**`DraftSummary`** gains `cashDollars: number | null`:
- shares mode: the parsed cash dollars (the existing local `cashDollars`, which is null when invalid).
- weight mode: `null`.

**`ValuedPortfolio`** gains `cashFixed: boolean` = `portfolio.cashDollars !== undefined`.
`valuePortfolio`'s `cashDollars` becomes:
- `portfolio.cashDollars` when defined. It needs no prices.
- otherwise the existing derivation, unchanged.

**Weight-editing operations.** `addPositionDiluting` and `removePositionToCash` already build their
result with explicit fields, so `cashDollars` is dropped. **Keep it that way** and add tests that
prove it (Acceptance 3). Do not change their logic.

### 2. `lib/portfolioStore.ts`

- `savePortfolio`: `stamped` must carry `cashDollars` when the input has it. Use a conditional
  spread: `...(portfolio.cashDollars === undefined ? {} : { cashDollars: portfolio.cashDollars })`.
  Without this, **every save silently erases the fixed cash**. That's the most important line in
  this contract.
- New export:
  ```ts
  /** Re-mark every shares-based portfolio against freshly loaded prices (contract 0129). Writes only
   *  when at least one portfolio was re-marked; never re-stamps updatedAt. */
  export function remarkStoredPortfolios(entries: UniverseEntry[]): void
  ```
  - Build `byTicker`, then `listPortfolios()`. Leave legacy portfolios untouched (use
    `isLegacyPortfolio`).
  - For current ones, use `remarkPortfolio(p, byTicker) ?? p`.
  - Call `replacePortfolios(next)` only if at least one `remarkPortfolio` call returned non-null.
  - Wrap the whole body in `try { … } catch { }`. A re-mark must never throw.
  - `portfolioStore.ts` may import `UniverseEntry` as a **type** from `'../api/client'`.

### 3. `api/client.ts`

`getUniverse` becomes:
```ts
export async function getUniverse(): Promise<UniverseEntry[]> {
  const entries = await request<UniverseEntry[]>('/universe')
  remarkStoredPortfolios(entries)
  return entries
}
```
Import `remarkStoredPortfolios` from `'../lib/portfolioStore'`. This is safe from a runtime cycle:
`portfolio.ts` and `portfolioStore.ts` import only **types** from `api/client`. Confirm every
such import from `api/client` in those two files is `import type`. If any is a value import,
report `BLOCKED`.

Why here: every page that loads prices (`/portfolios`, Holdings, Optimize, CAPM, Launch, Universe)
already calls `getUniverse` and reads `listPortfolios()` after it resolves or on re-render. So each
one sees the re-marked snapshot with no page changes.

### 4. `lib/portfolioCsv.ts`

`serializePortfolioCsv(portfolio)`:
- If `isSharesBased(portfolio)`: the header is `ticker,shares`, then one row per position,
  `ticker,String(shares)`, then `CASH,String(cashDollars)`. There are **no weights**.
- Otherwise, the current output is unchanged byte for byte.

The importer needs no change. `ticker,shares` + `CASH,<dollars>` already imports in shares mode
with cash as dollars (contract 0125, test "accepts zero dollars").

### 5. `components/NewPortfolioDialog.tsx`

In `handleCreate`, build the portfolio object exactly as now. Then call
`creationCashDollars(mode, summary.cashDollars, portfolio, byTicker)`. When the result is not
`undefined`, include it as `cashDollars` on the object passed to `onCreate`. Use whatever the
dialog's current mode and price-map variables are called; don't invent new state.

### 6. `pages/PortfoliosPage.tsx`

The cash-% editor (`handleCashTextChange`) persists `{ ...current, cashWeight: 100, positions: [] }`
and `{ ...current, cashWeight: parsed, positions }`. Both spreads would carry a stale
`cashDollars`. In **both** places, drop it, e.g. `const { cashDollars: _cashDollars, ...base } = current`
and spread `base`. Rename (`{ ...current, name }`) **keeps** `cashDollars`; leave it alone.

### 7. Tooltips (`PositionsTable.tsx`, `HoldingsPage.tsx`)

- Cash dollars cell, in both tables:
  - When `valued.cashFixed`, use: `Cash in dollars, saved with this portfolio. It stays fixed while holding weights move with prices.`
  - Otherwise use the existing text, unchanged.
- HoldingsPage **Weight %** header: the tooltip is currently
  `The saved allocation. It does not change as prices move.` In that page, compute `valued` before
  the JSX (it already exists) and use:
  - When `valued.cashFixed`: `Each holding's share of the portfolio at the last loaded prices. Share counts and cash dollars are fixed; weights move with prices.`
  - Otherwise: the existing text.

### 8. `lib/presets.ts` — BEC preset

Replace the BEC preset's `description` and `csv` with exactly the following. Keep its `id` and `name`.
The share counts are Gunnar's, from the committed file; the cash is Gunnar's figure.

```ts
    description: 'Blue Eagle Capital holdings as share counts, with $292,406.58 cash.',
    csv: [
      'ticker,shares',
      'XLK,184',
      'XLP,559',
      'XLV,410',
      'VEA,300',
      'MS,833',
      'SETM,870',
      'CEG,155',
      'GLD,113',
      'CASH,292406.58',
      '',
    ].join('\n'),
```

Gunnar Preset (`PRESETS[0]`) is unchanged: weights only.

## Acceptance criteria

Floats: use `toBeCloseTo(x, 6)`, never exact equality on computed floats.

1. **`remarkPortfolio`** (in `portfolio.test.ts`). Use the file's existing `entry(price)` helper,
   spreading in `ticker` if needed.
   - Base: AAA 10 shares @ $45 and BBB 30 @ $15, `cashDollars: 100`. The saved weights don't
     matter as long as the portfolio is valid; use 45/45/10.
     - (a) At those prices: weights ≈ 45 and 45, cash ≈ 10, `cashDollars` still 100, same `updatedAt`.
     - (b) AAA @ $55: total 1100, AAA ≈ 50, BBB ≈ 40.909091, cash ≈ 9.090909, `cashDollars` 100.
   - (c) Null when `cashDollars` is absent.
   - (d) Null when BBB has no shares.
   - (e) Null when BBB's price is null.
   - (f) Null when there are no positions.
   - (g) The input object and its positions are not mutated.
2. **Validation**: `isValidCurrentPortfolio` rejects `cashDollars: -1` and `cashDollars: NaN`, and
   accepts `cashDollars` absent or `0`.
3. **Drop on edit**: `addPositionDiluting` and `removePositionToCash` applied to a portfolio with
   `cashDollars: 100` return results where `'cashDollars' in result` is false.
4. **`creationCashDollars`**:
   - shares mode with 292406.58 → `292406.58` (toBe is fine; it's the input passed through).
   - shares mode with null → undefined.
   - weight mode with full shares and prices (the Base above, cash 10%) → ≈ 100.
   - weight mode with a row missing shares → undefined.
5. **`summariseDraft`**: `cashDollars` is the parsed number in shares mode (`'250'` → 250) and
   null in weight mode.
6. **`valuePortfolio`**: with `cashDollars: 100` and an empty price map, `cashDollars` is 100 and
   `cashFixed` is true. Without it, `cashFixed` is false. The existing 0127 tests pass unchanged.
7. **Store** (in `portfolioStore.test.ts`, using its existing `localStorage` stub pattern):
   - `savePortfolio` preserves `cashDollars`.
   - `remarkStoredPortfolios` re-marks a shares-based portfolio (weights change when a price
     changes, `updatedAt` unchanged) and leaves a weight-based sibling byte-identical.
   - It does **not** call `setItem` when no portfolio is shares-based.
8. **CSV**:
   - A shares-based portfolio serialises to exactly
     `ticker,shares\nAAA,10\nBBB,30\nCASH,100\n`.
   - Re-parsing that gives `mode: 'shares'`, `cash: '100'`, and rows with shares `'10'` and `'30'`.
   - Every existing serializer test passes unchanged.
9. **Presets**: replace the test `contains no share counts` with these two tests:
   - `keeps Gunnar Preset weights-only`: every `PRESETS[0]` seed row has `shares === ''`.
   - `ships the BEC preset as shares with fixed cash dollars`: `PRESETS[1]` parses OK with
     `mode: 'shares'`, `cash: '292406.58'`, 8 rows, every row's `shares` non-empty.

   All other preset tests stay unchanged, and `toHaveLength(2)` still holds.
10. `grep -n "cashDollars" frontend/src/lib/portfolioStore.ts` shows the `savePortfolio`
    conditional spread and `remarkStoredPortfolios`.
11. `grep -n "remarkStoredPortfolios" frontend/src/api/client.ts` prints the import and the call.
12. From `frontend/`, all of these pass:
    - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
    - `npm test` passes **in full**. The old presets failure is fixed by item 9.
    - `npm run lint` shows only the pre-existing HelpSidebar.tsx:44 and UniversePage.tsx:77
      warnings.
13. **Long lines.** Before editing, `NewPortfolioDialog.tsx` has two lines over 300 characters
    (230 and 404); every other listed file has none. After editing there must be no **new** long
    lines. If a TSX file collapses, fix it with
    `npx --yes prettier@3 --print-width 120 --single-quote --no-semi --write <file>` rather than
    by hand.

## Verification to run and paste

Paste the complete, verbatim output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src
awk 'length > 300 {print FILENAME": "FNR": "length}' pages/PortfoliosPage.tsx components/NewPortfolioDialog.tsx pages/analysis/HoldingsPage.tsx components/PositionsTable.tsx lib/portfolio.ts lib/portfolioStore.ts lib/portfolioCsv.ts api/client.ts lib/presets.ts   # before AND after
grep -n "cashDollars" lib/portfolioStore.ts
grep -n "remarkStoredPortfolios" api/client.ts
grep -n "from '../api/client'" lib/portfolio.ts lib/portfolioStore.ts
cd ..
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
git diff --stat
```

## Out of scope (piece 2+)

- Add or remove position, cash editing and Apply that adjust shares and cash dollars instead of
  reverting to weight-based.
- A cash-in-dollars editor on `/portfolios`.
- Migrating existing portfolios. Those without `cashDollars` stay weight-based. Gunnar re-creates
  or re-imports them to become shares-based.
- Any backend change.

## Human verification (Gunnar)

Run `cd frontend && npm run dev`.
1. Delete any old BEC portfolio. Create a new one from the **BEC Portfolio** preset in the
   New portfolio dialog. It should open in **By shares** with cash `292406.58`.
2. On `/portfolios`, the Cash row's Shares cell shows **$292,406.58**, and the tooltip says the
   amount is fixed. Reload the page on another day (or after a Universe refresh): the cash stays
   $292,406.58 while the weights move.
3. Analyze portfolio → Holdings shows the same $292,406.58. The weights match `/portfolios`, and
   Optimize's Current column shows the same weights.
4. Export it. The file is `ticker,shares` with `CASH,292406.58` and no weight column. Re-import it:
   it opens in By shares with the same cash.
5. Change its cash % in the editor. The portfolio becomes weight-based: the cash dollars go back
   to the "Estimated…" tooltip. That's expected for piece 1.

## Open questions

None. Report `BLOCKED` for anything uncovered rather than improvising.
