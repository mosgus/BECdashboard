# Contract 0140 — Holdings tab shows the live price; its weights stay at the last close

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The Holdings tab's Price column displays the live intraday quote again, under the header "Price"
with a tooltip. The Weight % tooltip says that weights are at the last close.

## Why

Contract 0139 made `positionPrice()` return `last_close` only, so every Portfolios calculation uses
the same price as Optimize and CAPM. That part is done and accepted. The rule Gunnar settled on
2026-10-01 is **live for display, close for computation** (see `REBUILD.md`, "Every price in
Portfolios is the last completed session's close"). 0139 was revised to keep the Holdings Price
column live, but it executed from the pre-revision text, so the column now shows the last close
under a "Last close" header. This contract finishes that one section.

## Files

Modify:
- `frontend/src/pages/analysis/HoldingsPage.tsx` — four edits, all specified below.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, `frontend/src/lib/portfolio.ts` and
`positionPrice` do **not** change.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

Current state on disk (verified by the planner on 2026-10-01). Match on the text; line numbers are
approximate:

1. **Import, L13.** `import { positionPrice, valuePortfolio } from '../../lib/portfolio'` becomes
   `import { valuePortfolio } from '../../lib/portfolio'`.

2. **Price header, L151.** Replace `` <th className={`${TH} text-right`}>Last close</th> `` with exactly:
   ```tsx
                   <th className={`${TH} text-right`}>
                     <Tooltip label="Live price during market hours, otherwise the last close. Weights and all analysis use the last close.">
                       <span>Price</span>
                     </Tooltip>
                   </th>
   ```
   `Tooltip` is already imported on L8.

3. **Price cell, L203.** Replace `{formatPrice(positionPrice(entry))}` with exactly:
   ```tsx
   {formatPrice(entry === undefined ? null : entry.current_price ?? entry.last_close ?? entry.regular_market_price)}
   ```

4. **Weight % tooltip, L144, `valued.cashFixed` branch only.** Replace
   `"Each holding's share of the portfolio at the last loaded prices. Share counts and cash dollars are fixed; weights move with prices."`
   with
   `"Each holding's share of the portfolio at the last close, the price Optimize and Outlook use. Share counts and cash dollars are fixed; weights update after each close."`
   Leave the other branch, `'The saved allocation. It does not change as prices move.'`, unchanged.

If any of the four "current" texts is not found verbatim, report `BLOCKED`. Do not guess at a near match.

## Out of scope

- Do not change `positionPrice`, or add any exported helper that returns a live price. The inline
  chain in edit 3 is display-only and stays in this file.
- Do not touch the Day column, the Cash row, the charts, or any other tooltip.
- Do not edit tests. This is display copy in a component, and UI components are untested by design.

## Acceptance criteria

All counts are for `frontend/src/pages/analysis/HoldingsPage.tsx`:

1. `grep -c "positionPrice"` prints `0`.
2. `grep -c "entry.current_price ?? entry.last_close ?? entry.regular_market_price"` prints `1`.
3. `grep -c "<span>Price</span>"` prints `1`.
4. `grep -c "Last close</th>"` prints `0`.
5. `grep -c "at the last loaded prices"` prints `0`.
6. `grep -c "at the last close, the price Optimize and Outlook use"` prints `1`.
7. Typecheck, full tests, build and lint exit 0.
8. `node contracts/tools/smoke-render.mjs holdings` reports no uncaught exception. (0119's Tooltip
   `Children.only` crash is exactly what a new Tooltip can cause.)
9. The coder states which files it edited. It must be exactly the one above.

`BLOCKED` is the correct answer to any criterion that cannot be met without leaving the Files list.

## Verification to run and paste

From the repository root. Paste the complete, verbatim output:

```bash
F=frontend/src/pages/analysis/HoldingsPage.tsx
grep -c "positionPrice" $F
grep -c "entry.current_price ?? entry.last_close ?? entry.regular_market_price" $F
grep -c "<span>Price</span>" $F
grep -c "Last close</th>" $F
grep -c "at the last loaded prices" $F
grep -c "at the last close, the price Optimize and Outlook use" $F
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit=$?")
(cd frontend && npm run test 2>&1 | tail -5)
(cd frontend && npm run build 2>&1 | tail -3)
(cd frontend && npm run lint; echo "lint exit=$?")
node contracts/tools/smoke-render.mjs holdings
```

If `smoke-render.mjs` rejects `holdings` as a tab name, run it with no argument and paste its usage
output. Do not edit the tool.

## Tooltips — required for any contract adding interactive elements

One new tooltip, on the Price header, wrapped exactly like the neighbouring Day header: one
`<span>` child, so `Children.only` holds.

## Human verification — does Gunnar need to run anything?

Yes, during market hours, on a shares-based portfolio's Holdings tab:
- **Price** matches the Universe page's live price, and Day % moves.
- **Weight %** does not move intraday, and its tooltip says "at the last close".

## Open questions

None.
