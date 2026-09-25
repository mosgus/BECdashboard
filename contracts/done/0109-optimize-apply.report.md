# Report — Contract 0109 (planner audit)

**Outcome:** ACCEPTED
**Agent:** sonnet
**Audited:** 2026-09-24

## Verified by re-running
- `npm run build`: passes.
- `npm run test`: 129 passed (baseline 120, with 9 new `it` blocks).
- `npm run lint`: only the two pre-existing warnings.
- The test diff removes no existing line.
- `portfolio.ts`: a 1-line change, the `export` keyword only.
- `OptimizeChart.tsx`: still only Gunnar's 9-line `contentStyle` edit.

## Code review
- **`applyPlan`** checks in the specified order:
  1. tickers-changed
  2. infeasible
  3. short (≤ −0.0005)
  4. shares mode
  5. no-price (recomputed mode only)
  6. kept and removed, then renormalise
  7. validity check
- **Positions:** they keep portfolio order. Weights-only modes build `{ ticker, weight }` with no
  `shares` key, and the tests assert `!('shares' in p)`.
- **Invested value:** in recomputed mode it includes the removed holdings. So a removed holding's
  value is redistributed rather than lost.
- **UI:**
  - The plan is recomputed on render.
  - The button is disabled when applied or blocked, and its tooltip shows the reason.
  - The dialog copies the delete-confirm markup, with Cancel autofocused.
  - The confirm handler saves, re-reads and compares `updatedAt` to detect a silent storage failure.
  - A new run clears `applied` and the error.
  - The Vol target slider has `dismissOnPointerDown`.

## Residual risk (not a defect)
- **Two validators:** `portfolio.ts` and `portfolioStore.ts` each have an `isValidCurrentPortfolio`.
  - They agree today: finite non-negative cash, positive weights, positive or absent shares, unique
    tickers, total within 0.01.
  - If they ever diverge so that the store rejects what `applyPlan` accepted, the record would be
    written and then filtered out on read. The page would say "Nothing was changed", but the
    portfolio would have vanished from the list.
  - Consolidating them into one exported validator is worth a small future contract.

## Outstanding
- Gunnar's browser click-through, per the contract, on a throwaway portfolio.
