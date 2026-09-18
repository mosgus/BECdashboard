# Audit — Contract 0059

## Audit

**Rejected.** The weight-first model is substantially present and the contract's supplied migration
probe, frontend build, lint, and diff check pass. It still fails the contract's most important
migration guarantee: an old portfolio that cannot be safely converted must remain present and
unchanged so the page can show its migration message.

Independent reproduction installed this previously valid deployed-shape record in `bec-portfolios`:

```json
[{"id":"negative","name":"Negative cash","cash":-1,"positions":[{"ticker":"AAPL","shares":1}],"updatedAt":"2026-09-18T00:00:00.000Z"}]
```

`listPortfolios()` returned `[]`. The old storage validator accepted finite cash, including a
negative value; the new `isValidLegacyPortfolio()` rejects `cash < 0` (and also rejects zero or
negative shares and duplicate tickers) before `migrateLegacyPortfolio()` can return `null` and
the page can preserve/show the record. Any save of another portfolio would then permanently omit
that legacy sibling. This contradicts both the conversion contract and its explicit no-data-loss
acceptance criterion.

The add-allocation boundary also violates the exact-allocation rule. `AddPositionForm` permits a
requested weight up to `cashWeight + 0.01`, while `handleAddPosition` uses
`Math.max(0, cashWeight - weight)`. For example, cash `10` plus an allowed new `10.005` position
persists cash `0` and positions totaling `100.005`, instead of assigning the residue in a way that
preserves an exact 100%. Removal likewise clamps with `Math.min(100, ...)` rather than deriving
cash from the remaining positions. Contract 0060 fixes both defects.

The reported work also staged pure renames of contracts 0049–0053 into `contracts/done/`, despite
0059's explicit “Touch nothing else” boundary. Those are not part of this feature and were not
authorized for the coding agent. They remain staged and must be restored to their prior locations
before the user commits this work; do not fold them into 0059.

What passed independently:

- The exact contract migration command printed `portfolio migration checks passed`.
- A broader pure check confirmed ordinary legacy conversion, price-free weight-mode creation,
  one-time shares-mode allocation calculation, and saved-weight presentation.
- `cd frontend && npm run build` passed.
- `cd frontend && npm run lint` exited 0 with only the pre-existing `UniversePage.tsx:60`
  `react(set-state-in-effect)` warning.
- `git diff --check` passed.

## Resolution

Contract 0060 corrected both rejection findings and was independently accepted: the deployed
legacy validator now retains finite negative cash, zero/negative shares, empty tickers, and
duplicates for an honest unresolved-migration state; add/remove now calculate cash as the exact
complement of saved asset weights. Contract 0059 is accepted as remediated by 0060.
