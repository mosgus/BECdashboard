# Report — Contract 0079 (basisDate on the model, through CSV)

**Verdict: accepted.** Clean run. 63 frontend tests, up from 55; backend unchanged at 467.

## Verified independently

`TSC OK`, clean build, lint unchanged. `grep -rn "basisDate\|basis_date" frontend/src/components/ frontend/src/pages/`
prints nothing — no UI file was touched, which was the boundary this contract existed to hold.

**The silent-drop trap was avoided.** `portfolioStore.ts:96-103`:

```ts
const stamped: Portfolio = {
  id, name, cashWeight, positions,
  updatedAt: new Date().toISOString(),
  basisDate: portfolio.basisDate,
}
```

That object lists fields explicitly rather than spreading, so a new field is dropped on every save
unless someone adds it. Criterion 7 exists for exactly that and it passes.

**Backward compatibility proven against real data, not a fixture.** The coder correctly noted it had
only used fixtures, so I parsed Gunnar's actual committed export:

```
BEC-2026-09-21.csv  cols=3  ok=true  rows=8  cash=38.02  basis=undefined
```

Three columns, no `basis_date` header, parses exactly as before. That closes the one gap the report
disclosed.

All eight behavioural criteria are present as named tests: round-trip with and without a date,
three-column import, `2026-02-30` rejection with a line number, `isValidBasisDate` over six malformed
and two valid inputs, a `basis_date` on a position row ignored, save/read persistence, and a malformed
stored date rejected while an absent one is accepted.

## The reported deviation is my factual error

The contract said `DraftSeed` lives in `portfolio.ts`. It lives in `portfolioCsv.ts`. The coder added
the field at the real definition and said so rather than creating a second type to match the contract.

Correct call. Worth noting the shape: I wrote a file location from memory rather than checking, which
is the same class as the four git-state criteria — **asserting something adjacent to what I verified.**
The contract's own Files list happened to include both files, so nothing was blocked.

## Status

Accepted and archived. Contract 0080 is still in progress; 0081 waits on both.
