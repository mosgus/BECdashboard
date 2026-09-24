# Report: Contract 0097, generalising TickerChart into SeriesChart

**Status:** accepted
**Agent:** haiku

## Audit

**Accepted, 2026-09-24.** Gunnar had already committed the work in `c50eaa9`, so I audited it with
`git diff -M HEAD~1 HEAD`. Git detects the change as a rename, 91% similar. I re-ran every check:

- `npm run build` passes.
- 75 tests pass, unchanged as required.
- Lint reports only the two pre-existing warnings.
- `TickerChart` no longer appears anywhere, and `adj_close` no longer appears in the three files.

**Criterion 10.** I read the component diff line by line. It contains exactly the nine listed
changes and nothing else. No panel, colour or height changed.

- The MACD tooltip stays `toFixed(2)`.
- Its axis picks up `formatValue`, and the default of `formatPrice` gives the same output as before.

`chart.test.ts` has 15 changed lines, all renames of `adj_close` to `value`. My contract undercounted
them; there was no extra edit.

The criterion 10 command in the contract used `HEAD:`, which stopped working once the work was
committed. The audit used `HEAD~1`. Future refactor contracts should compare against a named commit.

**Still open for Gunnar:** the check in the browser that /ticker/AAPL looks unchanged.
