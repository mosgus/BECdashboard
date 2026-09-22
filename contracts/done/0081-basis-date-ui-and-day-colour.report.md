# Report — Contract 0081 (Basis-date UI, Since column, Day colour)

**Verdict: accepted.** Clean run, no deviations. 63 frontend tests, 475 backend, bundle +0.31 kB.

## Verified independently

**Part B did not cost the live/not-live signal**, which was the only real risk in this contract.

`UniverseTable.tsx:135` now colours unconditionally while the tooltip above it keeps both messages:

```tsx
label={change.live ? 'Change from the last close' : "Last completed session's change — not a live price"}
<span className={`text-xs ${CHANGE_COLOR[change.direction]}`}>
```

`grep "change.live"` in `HoldingsPage.tsx` returns nothing, and the header tooltip is in place at
`HoldingsPage.tsx:102` — *"Change from the last close. When the market is closed this is the last
completed session's move."* Holdings went from grey-with-no-explanation to coloured-with-one, which
is the outcome that made the change worth accepting.

**The `Since` column is genuinely absent, not CSS-hidden.** Three guards, all
`current.basisDate !== undefined &&`: the header (113), the data cell (155), and the cash row's
placeholder (169). A column missing its `<td>` in one row and not another would have produced a
silently misaligned table; all three move together.

**The empty-date path removes the property rather than storing `''`:**

```ts
const { basisDate: _basisDate, ...withoutBasisDate } = current
persist(withoutBasisDate)
```

Worth tracing why that is sufficient: `savePortfolio`'s `stamped` object assigns
`basisDate: portfolio.basisDate`, which becomes `undefined`, and `JSON.stringify` omits undefined
properties — so the stored record has no `basisDate` key at all, which is what
`isValidCurrentPortfolio` requires. The explicit-field `stamped` object that nearly swallowed this
field in 0079 works in its favour here.

`getReturns`'s guard is `typeof since === 'string' && since !== ''`, so the parameter is omitted for
both `undefined` and `''`.

## What this completes

Three contracts of one feature: 0079 the model and CSV column, 0080 the endpoint parameter, 0081 the
UI. The split held — each was auditable alone, and no contract needed rework to accommodate the next.

## Still unverified

Everything visual, and the two states that need real conditions: colour after the close, and the
export/re-import round trip carrying `basis_date` on the `CASH` row. Nothing here can produce either.

## Status

Accepted and archived.
