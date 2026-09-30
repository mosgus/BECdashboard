# Contract 0128 — Analysis Holdings tab: cash dollars in Shares, green Cash row

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

On `/portfolios/:id/holdings` (the tab "Analyze portfolio" opens), the CASH row gets two changes:
1. The **Shares** cell shows the estimated cash dollars, e.g. `$1,234.50`, whenever they can be
   worked out. It keeps today's muted `—` otherwise.
2. The row gets the same green tint as the Cash row on `/portfolios`: `bg-brand-positive/10`.

## Why

Contract 0127 made both changes to `components/PositionsTable.tsx` (the `/portfolios` page). The
analysis Holdings tab renders its own table in `pages/analysis/HoldingsPage.tsx`, and it was
missed. `valuePortfolio` already returns
`cashDollars: number | null`: `impliedPortfolioValue × cashWeight / 100`. It is null unless every
position has shares and a usable price. This page already calls `valuePortfolio`. The value is an
estimate at current prices, not saved, and it moves with prices. Do not change that model here.

## Files

Modify only `frontend/src/pages/analysis/HoldingsPage.tsx`. Touching any other file is `BLOCKED`.

## Changes

1. Keep the whole `valuePortfolio(...)` result, not just `.rows`. For example:
   ```ts
   const valued = valuePortfolio(current, universeByTicker)
   const rows = valued.rows.slice().sort((left, right) => right.weight - left.weight)
   ```
2. Import `formatMoney` from `'../../lib/optimize'`.
3. The CASH row is currently `<tr className="border-t-2 border-brand-border">`. It becomes
   `<tr className="border-t-2 border-brand-border bg-brand-positive/10">`.
4. The CASH row's 4th cell (under **Shares**) is currently
   `<td className={`${TD} text-right ${MUTED}`}>—</td>`.
   - When `valued.cashDollars === null`: leave that cell exactly as it is.
   - Otherwise: `<td className={`${TD} text-right tabular-nums whitespace-nowrap`}>` containing
     `<Tooltip label="…">` (copy below) around `<span>{formatMoney(valued.cashDollars)}</span>`.

Nothing else changes: no other cells, rows, headers, the CASH label text, or the weight cell.
While the Universe is loading, `universeByTicker` is empty, so `cashDollars` is null and the cell
shows `—`. That is correct.

## Tooltip

`Estimated from your share counts at current prices: cash is this portfolio's cash weight of its implied total value. It moves with prices; it isn't the amount you originally typed.`

This is the same copy as in PositionsTable.

## Acceptance criteria

1. `grep -n "bg-brand-positive/10" frontend/src/pages/analysis/HoldingsPage.tsx` prints exactly one
   line, and that line is the CASH `<tr>`.
2. `grep -n "formatMoney(valued.cashDollars)" frontend/src/pages/analysis/HoldingsPage.tsx` prints
   one line.
3. `grep -n "valuePortfolio(current, universeByTicker).rows" frontend/src/pages/analysis/HoldingsPage.tsx`
   prints nothing.
4. From `frontend/`, `npx tsc -p tsconfig.app.json --noEmit` exits 0. `npm run lint` shows no
   warnings in HoldingsPage.tsx; the pre-existing ones are HelpSidebar.tsx:44 and
   UniversePage.tsx:77.
5. `npm test`: every test passes except, possibly, `presets.test.ts > contains no share counts`.
   That test fails because of Gunnar's uncommitted `presets.ts` edit, which is out of scope. Do not
   touch it. Any other failure is a real failure.
6. `awk 'length > 300'` on HoldingsPage.tsx, before and after, shows no new long lines. Before, it
   prints nothing.

## Verification to run and paste

Paste the complete, verbatim output of each.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/analysis/HoldingsPage.tsx   # before AND after
grep -n "bg-brand-positive/10" frontend/src/pages/analysis/HoldingsPage.tsx
grep -n "formatMoney(valued.cashDollars)" frontend/src/pages/analysis/HoldingsPage.tsx
grep -n "valuePortfolio(current, universeByTicker).rows" frontend/src/pages/analysis/HoldingsPage.tsx
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
git diff --stat
```

## Human verification

Run `cd frontend && npm run dev`, go to `/portfolios`, pick a portfolio, and click **Analyze portfolio**.
1. The CASH row at the bottom of the Holdings table has a light green tint.
2. If every holding has a share count (e.g. a testSWAP import), the Shares cell shows a dollar
   amount; testSWAP has 0% cash, so it shows `$0.00`. Hovering shows the tooltip.
3. For a weights-only portfolio, the Shares cell still shows `—`.

## Open questions

None. If anything isn't covered, report `BLOCKED`.
