# Contract 0124 — Show imported share counts when switching to Shares

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

A CSV with both `weight_pct` and `shares` (e.g. `reference files/portfolios/testSWAP-2026-09-28.csv`)
still opens in Weight mode. Clicking **Shares** now shows the file's share counts in the share
fields instead of blanks. When every row has shares and a price, the cash-dollar field is also
filled so the cash weight carries over.

## Why

`parsePortfolioCsv` seeds such a file in weight mode, with each row's `shares` carried silently
(`portfolioCsv.ts` ~line 310). `switchEntryMode` (contract 0123) then blanks every `shares` field
on Weight → Shares. That follows contract 0059's rule: "clear shares and cash dollars rather than
inventing a notional value." The rule exists to stop the dialog *inventing* share counts from
weights. Imported shares aren't invented: they're the file's own data, and weight mode already
saves them on Create. Blanking them only hides real input.

Cash needs care. In shares mode an empty cash field means **$0**. A file with `CASH,5` would
silently lose its 5% cash on switching, and the shares-mode weights would absorb it. So when every
row has shares and a usable price, cash dollars are derived to keep the weight-mode cash %.
Otherwise cash stays blank and the user types it, as today.

## Files

Modify:
- `frontend/src/lib/portfolio.ts` — change the **to-shares** branch of `switchEntryMode` and add a
  `byTicker` parameter.
- `frontend/src/lib/portfolio.test.ts` — pass the new argument at existing call sites and add the
  tests below.
- `frontend/src/components/NewPortfolioDialog.tsx` — pass `byTicker` to `switchEntryMode`. That is
  the whole change here.
- `REBUILD.md` — append one decision paragraph (text given below) directly after the paragraph
  that contains "**A forced sweep exists for one case".

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, `portfolioCsv.ts` does **not** change.

## Interface

New signature (`byTicker` is appended as the last parameter):

```ts
export function switchEntryMode(
  draft: { mode: EntryMode; cash: string; rows: DraftRow[] },
  nextMode: EntryMode,
  summary: DraftSummary,
  lastSwitch: ModeSwitch | null,
  byTicker: Map<string, UniverseEntry>,
): { fields: DraftFields; lastSwitch: ModeSwitch | null }
```

Steps 1 (same mode) and 2 (restore after an untouched switch back) are **unchanged**. The
to-weight conversion is **unchanged**. Only the **to-shares** conversion changes:

- **Rows:** return every row as a new object (`{ ...row }`) with `shares` **left as it is**. Do
  not blank it. Rows with `shares: ''` stay `''`.
- **Cash:** let `c = summary.cashWeight`. For each row, parse `shares` with the file's existing
  `parseFinitePositive` and get `price = positionPrice(byTicker.get(row.ticker))`.
  Let `positionsValue = Σ shares × price`. Cash is:
  - `toFieldText(positionsValue * c / (100 - c), 2)` when **all** of these hold:
    - `draft.rows.length > 0`
    - every row has non-null parsed shares and `isFinitePositive(price)`
    - `c !== null`
    - `c >= 0` and `c < 100`
    - `positionsValue` is finite and `> 0`

    With `c === 0` this yields `'0'`.
  - `''` otherwise, which is today's behaviour.

Update the JSDoc on `switchEntryMode` to say that to-shares keeps existing share counts and derives
cash dollars only from a complete, priced share set.

In `NewPortfolioDialog.tsx`, the call becomes
`switchEntryMode({ mode, cash: cashText, rows }, nextMode, summary, lastSwitch, byTicker)`.
`byTicker` is already defined in the component.

`REBUILD.md` paragraph to append, verbatim:

```
**Weight → Shares keeps share counts that already exist (contract 0124).** Contract 0059 cleared shares on that switch so the composer would never invent a share count from a weight. That aim stands. But a CSV carrying both weights and shares seeds weight mode with real share counts, and clearing them hid the user's own data. The switch now keeps every row's existing `shares` and never creates one. Cash dollars are derived — `positionsValue × c / (100 − c)` at current prices — only when every row has shares and a usable price, because an empty shares-mode cash field means $0 and would silently drop the file's cash weight. Otherwise cash stays blank for the user to fill.
```

## Out of scope

- Don't change which mode a CSV opens in, and don't touch `parsePortfolioCsv`.
- Don't change the to-weight conversion, the restore rule, `summariseDraft`, `updateRow`, or any JSX.
- Don't derive shares for rows that have none.
- Don't reformat unrelated code.

## Acceptance criteria

1. `grep -n "byTicker: Map<string, UniverseEntry>," frontend/src/lib/portfolio.ts` includes a line
   inside the `switchEntryMode` signature.
2. `grep -n "lastSwitch, byTicker)" frontend/src/components/NewPortfolioDialog.tsx` prints one line.
3. `grep -n "shares: '' }))" frontend/src/lib/portfolio.ts` prints nothing (the blanking map is gone).
4. All 0123 tests still pass, with only the added `byTicker` argument (`new Map()` is fine) and no
   other change to their inputs or expectations.
5. New tests in the `switchEntryMode` block, each asserting `result.fields` with `toEqual`. Build
   `UniverseEntry` values with the file's existing `entry(price)` helper, spreading in `ticker`
   if needed.
   - (h) Weight → Shares for rows AAPL (shares `'1'`, price 300) and MSFT (shares `'2'`, price 100),
     with `summary.cashWeight = 0`: shares stay `'1'`/`'2'` and cash is `'0'`.
   - (i) The same rows with `summary.cashWeight = 20`: positions value is 500, so cash is `'125'`.
   - (j) One row has shares `''`: that row stays `''`, the other keeps its count, and cash is `''`.
   - (k) Every row has shares but one ticker has no price (`entry(null)`): cash is `''` and shares
     are kept.
   - (l) (h)'s result switched back to Weight with no edit restores the original weight draft
     exactly, and `lastSwitch` is `null`.
6. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
7. `cd frontend && npm run lint`: no warnings in the three touched frontend files.
8. `cd frontend && npm test` passes in full.
9. `awk 'length > 300 {print FILENAME": "FNR": "length}'` over the three frontend files: paste the
   output before and after editing. There must be no new lines over 300 characters.
10. `grep -c "Weight → Shares keeps share counts that already exist" REBUILD.md` prints `1`.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report, including failures.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/components/NewPortfolioDialog.tsx frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts   # before AND after
grep -n "byTicker: Map<string, UniverseEntry>," frontend/src/lib/portfolio.ts
grep -n "lastSwitch, byTicker)" frontend/src/components/NewPortfolioDialog.tsx
grep -n "shares: '' }))" frontend/src/lib/portfolio.ts
grep -c "Weight → Shares keeps share counts that already exist" REBUILD.md
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
git diff --stat
```

## Tooltips

No new interactive elements.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** Run `cd frontend && npm run dev`, open `/portfolios`, then
**New portfolio** → **Import CSV**, and choose
`reference files/portfolios/testSWAP-2026-09-28.csv`:

1. It opens in Weight mode with weights 31.44 / 21.26 / 47.30.
2. Click **Shares**. Each row shows `1`, and cash shows `0`. The read-only derived weights reflect
   *today's* prices, so they won't exactly equal the file's weights. That's expected: shares mode
   treats shares as the truth.
3. Click **Weight** without typing. The file's weights come back exactly (contract 0123).

## Open questions

None. If a case isn't covered above, report `BLOCKED`.
