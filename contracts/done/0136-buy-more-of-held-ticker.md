# Contract 0136: buy more of a ticker a shares-based portfolio already holds

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

On `/portfolios`, a **shares-based** portfolio (contract 0129) can buy more shares of a ticker it already holds. The cost is
shares × current price, paid from `cashDollars`. The holding's share count increases, and the portfolio is re-marked and stays
shares-based. Today the form hides held tickers, and `addPositionBuying` (contract 0135) returns `'held'` for them.

These are planner decisions. Gunnar can overrule them; you must not change them.
- **Use the same form and the same function.** `addPositionBuying` gets a top-up path. There is no second function and no
  per-row button, so the preview stays the saved result (the 0134 lesson).
- **No margin**, same as 0135. When the cost exceeds the cash, the form shows the maximum share count.
- **Weight-based portfolios don't change at all.** Their form still hides held tickers.

## Files

You may modify only these files:
- `frontend/src/lib/portfolio.ts`
- `frontend/src/lib/portfolio.test.ts`
- `frontend/src/components/AddPositionForm.tsx`

Anything else means `BLOCKED`. `frontend/src/components/NewPortfolioDialog.tsx` holds Gunnar's own uncommitted edit, so
**don't touch it**. `AddPositionForm.tsx` may already contain a small, separate styling change to the Weight input's
`className` (greyed when shares-based). Leave that line as you find it.

## 1. `lib/portfolio.ts`

- Remove `'held'` from the `BuyResult` failure reasons.
- In `addPositionBuying`, delete the line that returns `'held'`. Steps 3–6 (price, cost, insufficient-cash, `cashAfter`) apply
  to both paths unchanged. After `cashAfter`, branch:
  - **Already held:**
    ```ts
    const positions = portfolio.positions.map((position) =>
      position.ticker === ticker ? { ...position, shares: position.shares! + shares } : position)
    const next = withCashDollars({ ...portfolio, positions }, cashAfter, byTicker)
    if (next === null) return { ok: false, reason: 'unpriced-holding' }
    return { ok: true, portfolio: next, cost }
    ```
    The weights still sum to 100 and every position still has shares, so `withCashDollars` accepts this input as-is. You
    don't need `addPositionDiluting` here.
  - **Not held:** the existing `addPositionDiluting` and `withCashDollars` code, unchanged.
- Update the doc comment to `/** Buy a holding (new or already held) in a shares-based portfolio with its fixed cash, then
  re-mark (contracts 0135, 0136). */`.

## 2. `components/AddPositionForm.tsx`

Change only the shares-based path. The weight-based path has to render and behave exactly as it does today.

- `const available = sharesBased ? holdable : holdable.filter((entry) => !heldTickers.has(entry.ticker))`. Shares-based mode
  therefore never reaches the "Every Universe ticker is already held" early return, and weight-based mode still does.
- Find the held position:
  `const heldPosition = sharesBased ? portfolio.positions.find((position) => position.ticker === ticker) : undefined`.
- **Datalist option label:** for a held ticker in shares-based mode, use
  `` `${entry.short_name ?? entry.ticker} (held: ${formatShares(<that position's shares>)})` ``. For all others, keep the label as
  it is today.
- **Message line, ok case:** when `heldPosition !== undefined`, prefix the existing text with
  `` `Buys ${formatShares(Number(shares))} more; you'll hold ${formatShares(heldPosition.shares! + Number(shares))}. ` ``. Leave
  the `Costs … left.` text after it unchanged. The insufficient-cash, no-price, unpriced-holding and invalid messages stay
  as they are.
- Remove the `buy.reason === 'held'` clause from `buyMessage`, because that reason no longer exists.
- **Derived-weight box:** keep the value as it is. It already reads the ticker's weight from `buy.portfolio`, which for a
  held ticker is the new total weight. Fix the redundant ternary on its Tooltip label: shares-based uses
  `'Weight of this holding after the buy, from shares and current prices'`, and weight-based keeps
  `'Weight derived from the share count and current prices'`.
- Don't change the button text or the `handleClick` logic.

⚠️ **`Tooltip` calls `Children.only`.** Every `<Tooltip>` must wrap **exactly one** element. Put any new conditional element
**outside** Tooltips.

## Acceptance criteria

Use `toBeCloseTo(x, 6)` for computed floats. Put new tests in the existing `describe('addPositionBuying', …)` block and reuse
its `base` and `prices` (AAA 10 shares @ $45, BBB 30 @ $15, `cashDollars: 100`, CCC @ $20).

1. **Replace** the test `'rejects a ticker that is already held'` with **buy 2 AAA**. Expect `ok`, `cost` ≈ 90 and
   `cashDollars` ≈ 10. Expect AAA shares `toBe(12)` and BBB shares `toBe(30)`. Expect AAA weight ≈ 54, BBB ≈ 45 and
   `cashWeight` ≈ 1. Expect 2 positions (no duplicate AAA) and an unchanged `updatedAt`.
2. **Buy 3 AAA** (cost 135) → `{ ok: false, reason: 'insufficient-cash' }`.
3. **Buy 1 AAA with BBB's price null** → `'unpriced-holding'`.
4. **Buy 1 AAA with AAA's price null** → `'no-price'`.
5. Buying 2 AAA leaves the input unmutated (compare it to a `structuredClone` taken beforehand).
6. All the existing `addPositionBuying` tests other than the replaced one pass unchanged.
7. Running `grep -rn "'held'" frontend/src` prints nothing.
8. From `frontend/`, `npx tsc -p tsconfig.app.json --noEmit` exits 0, `npm test` passes in full (261 − 1 + 5 = 265), and
   `npm run lint` shows only the HelpSidebar.tsx:44 and UniversePage.tsx:77 warnings.
9. **Long lines.** None exist in the three files right now. The after check must also show none.

## Verification to run and paste

**Paste every output verbatim. Run the before awk on its own.**

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts frontend/src/components/AddPositionForm.tsx   # BEFORE, alone
# ... edit ...
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts frontend/src/components/AddPositionForm.tsx   # AFTER
grep -rn "'held'" frontend/src
grep -n "const available\|heldPosition\|held: " frontend/src/components/AddPositionForm.tsx
grep -n "<Tooltip" -A2 frontend/src/components/AddPositionForm.tsx
git diff --stat
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
```

## Out of scope

- Partial sells (selling some shares of a holding). Remove still sells all of it.
- Buying held tickers whose quote type isn't holdable. They aren't in `holdable`, so they never appear in the form.
- Any change for weight-based portfolios.

## Human verification (Gunnar)

Export BEC first. Then on `/portfolios`, with BEC selected:
1. Type a ticker you hold. It appears in the suggestions with "(held: N)".
2. Enter a small share count. The line reads "Buys X more; you'll hold Y. Costs $A of $B cash; $C left.", and the derived box
   shows the holding's new weight.
3. Press Add. That row's shares go up by X, cash dollars drop by the cost, and no duplicate row appears.
4. Enter a share count that costs more than your cash. Add is disabled and the line shows the maximum.
5. On a weights-only portfolio, held tickers still don't appear in the suggestions.
