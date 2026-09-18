# Contract 0059 — Weight-first local portfolio model

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Make browser-local portfolios allocation models: saved asset and cash weights are authoritative,
share counts are optional metadata, and creating a portfolio by weight never requires a total
portfolio value.

## Why

`REBUILD.md`, “Position model,” was deliberately reversed on 2026-09-18. Blue Eagle is being used
for portfolio analysis and optimization, not tax-lot, P&L, or brokerage-ledger accounting. The
current weight flow asks for a total value and a live price solely to turn a declared allocation
into shares, then discards the allocation; that is the wrong direction for this product.

This is a migration, not a new field beside the old model. A stored weight is the chosen allocation
until the user changes it. It must never be silently rewritten on a quote refresh.

## Files

Modify:

- `frontend/src/lib/portfolio.ts` — define the new and legacy shapes, allocation valuation/presentation helpers, legacy conversion, and the revised pure composer logic.
- `frontend/src/lib/portfolioStore.ts` — validate and preserve both the new and legacy localStorage shapes; add the exact replacement write needed by migration.
- `frontend/src/components/NewPortfolioDialog.tsx` — make weight entry the default, remove the required total-value path, and save the new model.
- `frontend/src/components/AddPositionForm.tsx` — add positions by allocation weight, with optional shares, without violating a portfolio’s 100% allocation.
- `frontend/src/components/PositionsTable.tsx` — present saved allocation weights and optional shares without pretending a weight-only portfolio has dollar values.
- `frontend/src/pages/PortfoliosPage.tsx` — migrate legacy portfolios once prices are available, manage cash as a percentage, and handle unresolved legacy data honestly.

**Touch nothing else.** Do not modify `REBUILD.md`; its decision record is already written. Do not
add packages or a test framework. The working tree already removes the duplicate empty-state “New
portfolio” button in `PortfoliosPage.tsx`; preserve that removal.

## Interface

In `frontend/src/lib/portfolio.ts`, the persisted current model is exactly:

```ts
export interface Position {
  ticker: string
  weight: number // percentage units: 25 means 25%
  shares?: number
}

export interface Portfolio {
  id: string
  name: string
  cashWeight: number // percentage units
  positions: Position[]
  updatedAt: string
}
```

`weight` is required, finite, and strictly greater than zero. `shares`, when present, is finite and strictly greater than zero.
`cashWeight` is finite and non-negative. A valid current portfolio has no duplicate tickers and
the sum of position weights plus `cashWeight` is within `0.01` percentage points of `100`.
Do not retain `cash` (dollars) or `totalValue` in the persisted current shape.

Keep an internal/exported legacy type for the current deployed shape:

```ts
interface LegacyPosition { ticker: string; shares: number }
interface LegacyPortfolio { id: string; name: string; cash: number; positions: LegacyPosition[]; updatedAt: string }
export type StoredPortfolio = Portfolio | LegacyPortfolio
```

Export this exact pure conversion function from `portfolio.ts`:

```ts
export function migrateLegacyPortfolio(
  legacy: LegacyPortfolio,
  byTicker: Map<string, UniverseEntry>,
): Portfolio | null
```

It returns a new `Portfolio` with the same `id`, `name`, and `updatedAt`, or `null` without
mutation. It may convert only when every legacy position has a finite, strictly-positive share
count and a finite, strictly-positive `positionPrice()`; legacy `cash` must be finite and
non-negative. Calculate each dollar value as `shares × price`, total it with legacy cash, and
write normalized percentage weights and `cashWeight`. The converted weights plus cash weight must
sum to 100 (minor floating-point residue belongs in `cashWeight`). An empty legacy portfolio
converts to `positions: []`, `cashWeight: 100`. On any other invalid or unpriceable input, return
`null`; never equal-weight, drop, or overwrite it.

`listPortfolios()` returns `StoredPortfolio[]`, retaining valid legacy records rather than
filtering them out. `savePortfolio()` accepts a `Portfolio` and preserves legacy siblings and list
order. Add and export:

```ts
export function replacePortfolios(portfolios: StoredPortfolio[]): void
```

It is the guarded, whole-list write used only after migration; it must not transform or discard
valid legacy records. All localStorage reads/writes retain the existing `try/catch` degraded-mode
behavior.

`valuePortfolio()` remains the page’s presentation helper but its output reflects the saved model:

- each position’s displayed `weight` is exactly the saved `position.weight`, not a price-derived value;
- `shares` is nullable for presentation;
- it may use the Universe only for name/missing status, not to recalculate allocation;
- it exposes `cashWeight`, not dollar cash, total value, positions value, or price-derived weights.

Update callers and types accordingly. The positions table has columns `Ticker`, `Name`, `Shares`,
and `Weight`; remove `Price` and `Value`, including their cash and total rows. Render a missing
share count as `—`. Render the final cash row as `Cash` with its saved percentage, then a total
row whose weight is exactly `100.00%`. Preserve the existing “no longer in Universe” warning.

### New-portfolio dialog

Keep the two mutually-exclusive entry modes, but default to `'weight'`.

**By weight** accepts ticker + strictly-positive asset weight for each row and a cash percentage.
There is no total portfolio value input, no derived dollar value/share count, and no price-based
ticker disabling or validation. Asset weights plus cash must total 100 within `0.01`; on submit,
save the corresponding `Portfolio` with absent `shares` fields.

**By shares** accepts ticker + strictly-positive share count and cash dollars, as today. Every
selected ticker must have a usable price. It calculates initial asset weights and `cashWeight`
from `shares × current price + cash dollars`, then saves those weights plus the entered shares.
Cash dollars are not persisted. The total must be strictly positive. Its derived-weight displays
are read-only. Switching from shares to weight may prefill the weights only when they were
successfully calculated; switching from weight to shares clears shares and cash dollars rather
than inventing a notional value. Do not offer any field that allows a target weight and share count
to be authored in the same mode.

### Existing portfolio page

When the Universe first becomes ready, attempt `migrateLegacyPortfolio` for every legacy record.
Replace localStorage and component state only for records that converted. A record that returns
`null` remains unchanged in localStorage and appears in the sidebar. If selected, show its name
and this exact message instead of editable positions:

`This legacy portfolio needs current prices for every holding before its allocations can be migrated. Its saved data has not been changed.`

It remains deletable. Do not manufacture weights or expose the normal position editor for it.

For a current portfolio, replace the cash-dollar editor with a cash-percent editor. A finite draft
in `[0, 100]` is a deliberate allocation edit: scale every asset weight proportionally so all
assets together become `100 - cashWeight`, then save the new cash and scaled asset weights. Assign
minor floating-point residue to cash. When the portfolio has no assets, only `cashWeight = 100` is
valid; any other value leaves storage unchanged and shows an inline explanation. (A controlled
draft is required so typing an intermediate value does not overwrite saved state.) This explicit
edit is the only permitted price-independent change to weights; a quote refresh must never do it.

`AddPositionForm` for a current portfolio has ticker, required strictly-positive `Weight %`, and
optional strictly-positive `Shares` fields. It may add only when requested weight is no greater
than the current cash weight (within 0.01). On add it appends the saved position and subtracts the
same weight from cash, assigning any floating-point residue to cash. It never fetches prices or
derives a weight. Removing a position adds its saved weight back to cash. These rules preserve the
100% invariant without silently changing the other assets’ allocations.

## Out of scope

- Do not implement analysis or optimizer routes/UI, rebalancing, target allocations, trade tickets,
  tax lots, cost basis, P&L, or performance calculation.
- Do not add a portfolio total/notional-value field, dollar values for weight-only portfolios, or a
  price refresh mechanism.
- Do not add mixed per-row share/weight entry or automatic weight drift based on price changes.
- Do not change backend code, API shapes, deployment configuration, styling tokens, routing, or
  localStorage key `bec-portfolios`.

## Acceptance criteria

1. A newly created By weight portfolio with AAPL 60, MSFT 30, and cash 10 saves exactly those
   weights, with no `shares`, no dollar cash, no total value, and no price requirement.
2. A By shares portfolio with priced holdings derives weights once, preserves entered shares, and
   has no persisted dollar cash. Subsequent Universe-price changes do not change saved weights.
3. Current portfolios always retain the 100% allocation invariant after creating, adding, removing,
   or validly editing cash. A cash edit scales all asset weights proportionally; additions draw only
   from cash; removals return weight to cash.
4. A valid legacy localStorage portfolio converts from its actual then-current shares/prices/cash;
   an unpriceable or malformed legacy portfolio remains stored unchanged and receives the exact
   migration message, never equal weights or data loss.
5. The current empty-state duplicate button remains absent; the header-level New portfolio button
   remains available.
6. `frontend` builds and lints cleanly (the pre-existing React set-state-in-effect warning may
   remain, but no error is allowed).

## Verification to run and paste

Run each command from the repository root and paste complete output.

```bash
node --experimental-strip-types --input-type=module -e "import assert from 'node:assert/strict'; import { migrateLegacyPortfolio, positionPrice } from './frontend/src/lib/portfolio.ts'; const entries = new Map([['AAPL', { ticker: 'AAPL', current_price: 20, last_close: null, regular_market_price: null }], ['MSFT', { ticker: 'MSFT', current_price: null, last_close: 30, regular_market_price: null }]]); const legacy = { id: 'p', name: 'Legacy', cash: 10, positions: [{ ticker: 'AAPL', shares: 2 }, { ticker: 'MSFT', shares: 1 }], updatedAt: '2026-09-18T00:00:00.000Z' }; const migrated = migrateLegacyPortfolio(legacy, entries); assert.ok(migrated); assert.equal(migrated.positions[0].weight, 50); assert.equal(migrated.positions[1].weight, 37.5); assert.equal(migrated.cashWeight, 12.5); assert.equal('cash' in migrated, false); assert.equal(migrateLegacyPortfolio(legacy, new Map()), null); assert.equal(positionPrice(entries.get('MSFT')), 30); console.log('portfolio migration checks passed')"
cd frontend && npm run build
cd frontend && npm run lint
git diff --check
```

## Tooltips

Exact copy for interactive elements introduced or materially repurposed by this contract:

- By weight: `Enter each asset's allocation percentage; no portfolio dollar value is required.`
- By shares: `Enter shares held; current prices calculate the initial allocation once.`
- Cash percentage input: `Share of this allocation kept in cash.`
- Cash dollars input in shares mode: `Cash used only to calculate this portfolio's initial allocation.`
- Weight input: `Percentage of the portfolio allocated to this security.`
- Optional shares input: `Optional share count for reference; it does not change the saved allocation.`
- Add-position button: `Add this allocation using available cash weight.`

Existing tooltips may be revised only when their old copy describes cash dollars, derived weights,
or required total value.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** From `frontend`, run `npm run dev`. On `/portfolios`:

1. Create a By weight portfolio with AAPL 60%, MSFT 30%, cash 10%. Confirm no total-value field
   appears; creation works even if a ticker has no quote; the table shows `—` shares and exactly
   60%, 30%, 10%, 100%.
2. Create a By shares portfolio with two priced tickers. Confirm shares are retained and the
   calculated weights total 100%; reload and confirm the allocations persist.
3. For the weight portfolio, add a 5% position while cash is at least 5%, then remove it. Confirm
   cash decreases and returns by exactly 5%, while the other asset weights do not move.
4. If you have an existing shares-and-cash portfolio in this browser, reload `/portfolios` and
   confirm it either converts to the same current allocation or displays the stated no-change
   migration message. Do not clear browser storage to force this check.
