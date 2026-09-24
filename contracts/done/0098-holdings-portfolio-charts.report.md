# Report: Contract 0098, portfolio charts on the Holdings tab

**Status:** accepted
**Agent:** sonnet. This was the second run. The first run reported BLOCKED correctly, because
0096 and 0097 had not been audited yet.

## Audit

**Accepted, 2026-09-24.** I re-ran every verification command, against uncommitted work.

Build and tooling:
- The build passes.
- 90 tests pass, 15 of them new: 12 in `portfolioChart.test.ts` and 3 for `snapRange`.
- Lint reports only the two warnings that were already there.

The acceptance-criterion greps:
- No `positionPrice` in the new files.
- The 0.5 tolerance constant appears exactly once.
- No keys for the high, low or volume indicators.
- There is one `SIGNAL_DESCRIPTIONS` definition, in `lib/indicators.ts`.
- `PortfolioCharts` appears twice in HoldingsPage, and `ReferenceArea` twice in SeriesChart.
- The lazy import is present.

What I read in the code:
- **Every case in `portfolioChart.test.ts` uses the contract's literal values:**
  - 900 and 904.44 for the dollar mode.
  - 56.25 as the implied weight that makes it a mismatch.
  - The factors 1.11 and 9.
  - The flat-fill label text and the clip to the visible end.
  - The four dollar-format strings.
  - A check that the scaling doesn't mutate its input.
- **`chartMode` uses `last_close` only.** `scaleFactor` in dollar mode divides by the series' last
  value, not by a hard-coded 100.
- **The effect's dependencies are strings.** I found no object dependency and no refetch loop.
- **The SeriesChart change is additive only.** /tickers never passes `shaded`, so its render path is
  unchanged. The `ReferenceArea` edges are snapped to the rendered dates, as specified.
- **HoldingsPage has two added lines.** `<HelpSidebar />` and the signal select are still there.
- **The mode copy and all four tooltip strings match the contract exactly.**

Notes, none of which block acceptance:
- **The date range and toggles persist when switching portfolios.** If React reuses the Holdings
  route's component instance, `start`, `end` and the toggles carry over. The previous portfolio's
  data is also briefly shown against the new portfolio's positions until the fetch returns, and
  that shows up as a momentary "no-shares" note. A `key={current.id}` on `<PortfolioCharts>` would fix
  both. I haven't filed this as a contract; it can go in the next one that touches HoldingsPage.
- **`reference files/portfolios/BEC-2026-09-21.csv` shows as a staged deletion.** A staged deletion
  needs `git rm` or an IDE action. The coder's tools can't stage anything, and the coder says it
  didn't touch the file. `c50eaa9` added `Gunnar Preset V2-2026-09-24.csv` next to it, so this looks
  like Gunnar replacing a preset, but only Gunnar can confirm that. It is not part of this contract.

**Still open for Gunnar:** the six human-verification steps in the contract, run against real data.
