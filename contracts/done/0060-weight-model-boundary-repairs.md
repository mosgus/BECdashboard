# Contract 0060 — Weight-model migration and allocation-boundary repairs

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

Preserve every record valid under the deployed shares-and-cash storage schema through the
weight-model migration, and make add/remove allocation operations finish at exactly 100%.

## Why

Audit of contract 0059 found two narrow failures. First, `listPortfolios()` filters deployed
finite-negative-cash (and other non-convertible) records before the page can leave them unchanged
and show the required migration message; a later save loses them. Second, the add form permits a
weight slightly above cash but clamps cash to zero, which can persist weights above 100%.

This contract fixes those boundary conditions only. It does not revisit the chosen weight-first
architecture or add features.

## Files

Modify:

- `frontend/src/lib/portfolio.ts` — add exact pure allocation add/remove helpers.
- `frontend/src/lib/portfolioStore.ts` — retain every record valid under the deployed legacy shape.
- `frontend/src/components/AddPositionForm.tsx` — reject a requested allocation greater than available cash.
- `frontend/src/pages/PortfoliosPage.tsx` — use the allocation helpers for add/remove.

**Touch nothing else.** Do not modify `REBUILD.md`, any other contract, backend code, package
files, or the staged 0049–0053 archival moves. Do not add dependencies or a test framework.

## Interface

The deployed legacy storage validator was:

```ts
typeof id === 'string'
typeof name === 'string'
Number.isFinite(cash)
Array.isArray(positions)
positions.every((p) => typeof p.ticker === 'string' && Number.isFinite(p.shares))
typeof updatedAt === 'string'
```

Make `isValidLegacyPortfolio()` match that exact deployed acceptance surface. In particular, it
must retain finite negative cash, zero/negative shares, and duplicate tickers. These records are
not necessarily convertible: `migrateLegacyPortfolio()` remains responsible for returning `null`
when its stricter non-negative cash, positive shares, unique tickers, and price conditions are not
met. They must therefore remain in `listPortfolios()`, survive `savePortfolio()` and
`replacePortfolios()`, and reach the existing unresolved-legacy message unchanged.

Export these exact pure helpers from `frontend/src/lib/portfolio.ts`:

```ts
export function addPositionUsingCash(portfolio: Portfolio, position: Position): Portfolio | null
export function removePositionToCash(portfolio: Portfolio, ticker: string): Portfolio | null
```

They never mutate their inputs.

`addPositionUsingCash` returns `null` if `ticker` duplicates an existing position, if either input
is not a valid current-model value, or if `position.weight > portfolio.cashWeight`. Otherwise it
returns the position appended and sets `cashWeight` to exactly:

```ts
100 - sum(next.positions.map((position) => position.weight))
```

It must be finite and non-negative. Do not use a tolerance, `Math.max`, or a value calculated as
old cash minus requested weight.

`removePositionToCash` returns `null` if no position matches. Otherwise it returns that position
removed and sets `cashWeight` to the same exact complement of the remaining asset weights. It must
not use `Math.min` or add the removed weight to prior cash. Both successful helpers return a
current `Portfolio` whose weights plus cash equal 100 to normal JavaScript floating-point precision
(absolute error at most `1e-9`).

`AddPositionForm` disables its button whenever `weightNumber > cashWeight` — no `+ 0.01` tolerance.
`PortfoliosPage` replaces its local add/remove arithmetic with the helpers and leaves state/storage
unchanged if a helper returns `null`.

## Out of scope

- Do not change weight/share entry UI, cash rescaling, display columns, legacy message copy, or
  migration timing.
- Do not make negative cash or invalid shares convertible; retain them only to prevent data loss.
- Do not alter the current-model validator, storage key, API, backend, or portfolio semantics.
- Do not touch the staged contract archival changes; Gunnar owns that cleanup.

## Acceptance criteria

1. `listPortfolios()` returns a deployed-shape record with `cash: -1` and a finite share count;
   `migrateLegacyPortfolio()` returns `null` for it; saving a separate current portfolio does not
   remove the legacy sibling or change its serialized data.
2. Given a valid current portfolio with asset weights 90 and cash 10, adding a 10-weight position
   returns cash 0 and a total allocation of 100; adding 10.000001 returns `null`.
3. Removing the added position returns cash 10 and a total allocation of 100. Neither helper
   mutates the input object.
4. The build, lint, exact migration check from 0059, and diff check pass.

## Verification to run and paste

Run from repository root and paste complete output.

```bash
node --experimental-strip-types --input-type=module -e "import assert from 'node:assert/strict'; const memory = new Map(); globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) }; const store = await import('./frontend/src/lib/portfolioStore.ts'); const lib = await import('./frontend/src/lib/portfolio.ts'); const legacy = { id: 'legacy', name: 'Negative', cash: -1, positions: [{ ticker: 'AAPL', shares: 1 }], updatedAt: '2026-09-18T00:00:00.000Z' }; localStorage.setItem(store.PORTFOLIO_STORAGE_KEY, JSON.stringify([legacy])); assert.deepEqual(store.listPortfolios(), [legacy]); assert.equal(lib.migrateLegacyPortfolio(legacy, new Map()), null); const current = { id: 'current', name: 'Current', cashWeight: 10, positions: [{ ticker: 'MSFT', weight: 90 }], updatedAt: '2026-09-18T00:00:00.000Z' }; store.savePortfolio(current); assert.deepEqual(store.listPortfolios()[0], legacy); const added = lib.addPositionUsingCash(current, { ticker: 'AAPL', weight: 10 }); assert.ok(added); assert.equal(added.cashWeight, 0); assert.ok(Math.abs(added.cashWeight + added.positions.reduce((sum, p) => sum + p.weight, 0) - 100) <= 1e-9); assert.equal(lib.addPositionUsingCash(current, { ticker: 'AAPL', weight: 10.000001 }), null); assert.equal(current.cashWeight, 10); assert.equal(current.positions.length, 1); const removed = lib.removePositionToCash(added, 'AAPL'); assert.ok(removed); assert.equal(removed.cashWeight, 10); assert.ok(Math.abs(removed.cashWeight + removed.positions.reduce((sum, p) => sum + p.weight, 0) - 100) <= 1e-9); console.log('0059 boundary repairs passed')"
node --experimental-strip-types --input-type=module -e "import assert from 'node:assert/strict'; import { migrateLegacyPortfolio, positionPrice } from './frontend/src/lib/portfolio.ts'; const entries = new Map([['AAPL', { ticker: 'AAPL', current_price: 20, last_close: null, regular_market_price: null }], ['MSFT', { ticker: 'MSFT', current_price: null, last_close: 30, regular_market_price: null }]]); const legacy = { id: 'p', name: 'Legacy', cash: 10, positions: [{ ticker: 'AAPL', shares: 2 }, { ticker: 'MSFT', shares: 1 }], updatedAt: '2026-09-18T00:00:00.000Z' }; const migrated = migrateLegacyPortfolio(legacy, entries); assert.ok(migrated); assert.equal(migrated.positions[0].weight, 50); assert.equal(migrated.positions[1].weight, 37.5); assert.equal(migrated.cashWeight, 12.5); assert.equal('cash' in migrated, false); assert.equal(migrateLegacyPortfolio(legacy, new Map()), null); assert.equal(positionPrice(entries.get('MSFT')), 30); console.log('portfolio migration checks passed')"
(cd frontend && npm run build)
(cd frontend && npm run lint)
git diff --check
```

## Tooltips — required for any contract adding interactive elements

No interactive elements are added or relabeled. Existing tooltip copy remains unchanged.

## Human verification — does Gunnar need to run anything?

**Nothing to run.** This is boundary validation and storage preservation only. The existing 0059
browser walkthrough remains required after its corrective contract is accepted.
