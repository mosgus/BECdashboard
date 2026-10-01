# Contract 0130 — Cash editor in dollars for shares-based portfolios

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

On `/portfolios`, the **Cash** editor above the holdings table currently takes a percentage.
Editing it on a shares-based portfolio drops `cashDollars` and reverts the portfolio to
weight-based (contract 0129, piece 1).

After this contract:
- **Shares-based portfolio** (`isSharesBased(current)`): the editor takes **dollars**. Each valid
  edit saves the new `cashDollars` and immediately re-marks the weights from shares × current price.
  The portfolio stays shares-based.
- **Weight-based portfolio**: the percentage editor is unchanged, byte for byte in behavior. It still
  drops `cashDollars`, which is harmless because a weight-based portfolio has none that matter.

This is piece 2(c) of the shares-first work (REBUILD: "Shares-based portfolios … (contract 0129)").

## Files

Modify only:
- `frontend/src/lib/portfolio.ts` — new `withCashDollars`.
- `frontend/src/lib/portfolio.test.ts` — tests.
- `frontend/src/pages/PortfoliosPage.tsx` — the editor.

Anything else → `BLOCKED`. `frontend/src/components/NewPortfolioDialog.tsx` has an uncommitted
edit of Gunnar's. **Do not touch it.**

## 1. `lib/portfolio.ts`

```ts
/** Set a shares-based portfolio's fixed cash and re-mark its weights at the given prices (contract 0130).
 *  Null when the portfolio isn't shares-based, the amount is invalid, or a price is unusable. */
export function withCashDollars(
  portfolio: Portfolio,
  dollars: number,
  byTicker: Map<string, UniverseEntry>,
): Portfolio | null
```
- Return null unless all of these hold:
  - `isValidCurrentPortfolio(portfolio)`
  - `isSharesBased(portfolio)`
  - `Number.isFinite(dollars)` and `dollars >= 0`
- **No positions:** return `{ ...portfolio, cashDollars: dollars, cashWeight: 100 }`. An all-cash
  portfolio is 100% cash at any amount, including $0.
- **Otherwise:** return `remarkPortfolio({ ...portfolio, cashDollars: dollars }, byTicker)`. It
  already returns null for an unusable price and keeps `updatedAt`.
- Never mutate the input.

## 2. `pages/PortfoliosPage.tsx`

Compute `const sharesBased = current !== null && isSharesBased(current)`. Import `isSharesBased`
and `withCashDollars` from `'../lib/portfolio'`, and add them to the existing import line.

**Seeding the text: this is the subtle part.** The reseed effect currently sets
`String(current.cashWeight)` with deps `[current?.id, current?.cashWeight]`. In dollar mode every
keystroke re-marks, which changes `cashWeight`. So an effect keyed on `cashWeight` would overwrite
the text the user is typing. Change the effect to:
- text = `sharesBased ? String(current.cashDollars) : String(current.cashWeight)`, or `''` when
  `current` is null
- deps = `[current?.id, sharesBased, sharesBased ? current?.cashDollars : current?.cashWeight]`
- keep the existing eslint-disable comment and explanation line; update its wording if needed
- **don't clobber in-progress text.** If `cashText.trim() !== ''` and `Number(cashText)` already
  equals the new value, leave the text alone. Otherwise deleting `300.05` down to `300.0` saves
  300, and the reseed would strip the `.0` while the user is typing. This is a parse-equality
  guard, not a float comparison of computed values: the saved number came from `Number(text)`
  itself.

**Handler.** At the top of `handleCashTextChange`, after `setCashText(text)` and the null check,
branch on `sharesBased`. The existing percent logic below stays as the weight-based path, unchanged.

Dollar path:
1. `parsed = text.trim() === '' ? null : Number(text)`. If it is null, not finite, or `< 0`:
   `setCashProblem('Cash must be a dollar amount of 0 or more.')` and return.
2. If `universeState.status !== 'ready'`:
   `setCashProblem('Current prices are needed to update the weights. Try again once the Universe has loaded.')`
   and return. In practice the input is disabled in this state (see UI); this is a guard.
3. `next = withCashDollars(current, parsed, actualByTicker)`. If it is null:
   `setCashProblem('Every holding needs a current price to update the weights.')` and return.
4. `setCashProblem(null)`, then `persist(next)`.

`persist` goes through `savePortfolio`, which keeps `cashDollars` (0129).

**UI.** In the Cash editor block, which today renders a "Cash" label, the input and a "%" suffix,
the weight-based rendering is unchanged. For `sharesBased`:
- Render a `$` **prefix** span before the input, with the same classes as the current `%` span.
  Render no `%` suffix.
- The input has no `max`. Keep `min="0"`, `step="any"`, `inputMode="decimal"`, `type="number"` and
  the same classes.
- The input is `disabled={universeState.status !== 'ready'}`.
- The tooltip label is:
  `Cash held in dollars. Holding weights are recalculated from share counts and current prices.`
  Keep the weight-based label, `Share of this allocation kept in cash.`, unchanged.

The Cash row in `PositionsTable` already shows both the dollars and the resulting %, so there is
no new readout.

## Acceptance criteria

Use `toBeCloseTo(x, 6)` for computed floats.

1. `withCashDollars` tests in `portfolio.test.ts`, in a `describe('withCashDollars', …)` block.
   Base portfolio: AAA 10 shares at $45 and BBB 30 at $15, `cashDollars: 100`, saved weights
   45/45/10.
   - (a) $1100 cash: total 2000, so AAA ≈ 22.5, BBB ≈ 22.5, cash ≈ 55, `cashDollars` 1100,
     same `updatedAt`.
   - (b) $0 cash: AAA ≈ 50, BBB ≈ 50, cash ≈ 0, `cashDollars` 0.
   - (c) Null for -1, NaN and Infinity.
   - (d) Null when the portfolio has no `cashDollars` (weight-based).
   - (e) Null when BBB's price is null.
   - (f) Shares-based with no positions (`cashWeight: 100`, `cashDollars: 50`, `positions: []`),
     set to 75: `cashDollars` is 75 and `cashWeight` is 100.
   - (g) The input is not mutated.
2. `grep -n "withCashDollars" frontend/src/pages/PortfoliosPage.tsx` prints the import and one call.
3. `grep -n "Share of this allocation kept in cash." frontend/src/pages/PortfoliosPage.tsx` still
   prints one line.
4. From `frontend/`, all of these pass:
   - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
   - `npm test` passes in full.
   - `npm run lint` shows only the pre-existing HelpSidebar.tsx:44 and UniversePage.tsx:77
     warnings.
5. Run `awk 'length > 300'` on both source files before and after. Both print nothing before, and
   there must be no new long lines after. If the TSX collapses, run
   `npx --yes prettier@3 --print-width 120 --single-quote --no-semi --write frontend/src/pages/PortfoliosPage.tsx`.

## Verification to run and paste

**Paste every output verbatim.** Summaries like "passed" are not accepted.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/PortfoliosPage.tsx frontend/src/lib/portfolio.ts   # before AND after
grep -n "withCashDollars" frontend/src/pages/PortfoliosPage.tsx
grep -n "Share of this allocation kept in cash." frontend/src/pages/PortfoliosPage.tsx
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
git diff --stat
```

## Out of scope

- Add or remove position, and Apply (pieces 2a, 2b, 2d).
- Converting a weight-based portfolio to shares-based from this editor.
- Any other page.

## Human verification (Gunnar)

Run `cd frontend && npm run dev` and open `/portfolios`. Select a BEC portfolio created from the
preset after 0129.
1. The Cash editor shows `$` and `292406.58`.
2. Type `300000`. The Cash row reads $300,000.00, and its % and every holding's weight shift
   slightly. The portfolio stays shares-based: the tooltip still says the cash is fixed.
3. Clear the field. A red message appears and nothing is saved. Type the original amount back.
4. Reload the page. The amount you entered persists.
5. Select a weights-only portfolio (e.g. Gunnar Preset). The editor still shows `%` and behaves
   as before.
6. While the page is first loading, before prices arrive, the dollar input is greyed out.

## Open questions

None. Report `BLOCKED` for anything uncovered.
