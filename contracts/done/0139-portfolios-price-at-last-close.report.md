# Report — Contract 0139

## Audit

**Accepted, with §3b split out to contract 0140.** The coder executed the **pre-revision** text, so
the Holdings tab got the superseded change: the header reads `Last close` and the Price cell shows
`last_close`. That is the opposite of Gunnar's revised requirement, which is a live display price.
The report gives this away: it checks `>Last close</th>` = 1, a criterion the revision had removed.
This is not a coder defect. The revision banner landed while, or after, the old text was in context,
which is exactly the failure the "Revising a live contract" rule warns about.

Everything outside §3b was re-run by the planner and is correct:
- `positionPrice` returns `entry.last_close` only, with the specified doc comment. `current_price`
  count in `portfolio.ts` = 0.
- "current price" has no hits across all seven listed files.
- The fixtures moved exactly as specified, and no expected values changed.
- The five new tests pass (`-t "last close"`: 5 passed). They use literal values and each fails on
  the old code: the re-mark gives 46.15, the sell 700, the buy 40.
- Full suite: 278 passed. tsc, build and lint exit 0.
- The diff touches only listed files.

**Carried forward:** contract 0140 restores the live Price cell under a `Price` header with a
tooltip, drops the now-unused `positionPrice` import from `HoldingsPage.tsx`, and rewords the
Weight % tooltip.
