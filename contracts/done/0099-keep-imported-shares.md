# Contract 0099 — Keep share counts from an imported CSV

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

When a CSV has both a `weight_pct` and a `shares` column, the portfolio created from it saves the
file's share counts on each position. Those counts then show in the Holdings table's existing
`Shares` column.

## Why

The app loses share counts on its own round trip today. `serializePortfolioCsv` writes shares, and
`parsePortfolioCsv` reads them into the `DraftSeed` (see the `ticker,weight,shares` test in
`portfolioCsv.test.ts`). Then two places discard them:

1. `summariseDraft`'s weight branch (`frontend/src/lib/portfolio.ts`) hardcodes `shares: null` on
   every row.
2. `NewPortfolioDialog.handleCreate` attaches shares only when `mode === 'shares'`.

The existing test `round-trips optional shares and a comma in the name` stops at the seed, which is
why nobody noticed the loss. Export a portfolio that has shares, import it back, and the shares are
gone.

The `REBUILD.md` rule is "saved weights are the truth; shares are optional implementation metadata",
and it stands. A file carrying both columns still has unambiguous meaning: **the weights are saved
exactly as written, and the shares ride along as metadata.** They are not used to derive or check
any weight. This does not break the "flows must not be mixed" rule, which is about a user typing
shares and a separate target weight *into the composer*. The file format is what the app itself
writes. When share counts and weights disagree, the existing 0.5-point rule for dollar display
already handles it (`REBUILD.md`, around the `impliedPortfolioValue` entry).

## Files

Modify:
- `frontend/src/lib/portfolio.ts`: in `summariseDraft`'s **weight** branch only, set each row's
  `shares` to `parseFinitePositive(row.shares)` instead of `null`. Nothing else in the weight branch
  changes. `shares` must play no part in `problem`, `canCreate`, `allocatedPercent` or any weight.
- `frontend/src/components/NewPortfolioDialog.tsx`: three changes.
  1. **`handleCreate`**: attach `shares` whenever `row.shares !== null` (the summary row's value),
     in either mode. Delete the `mode === 'shares' && source?.shares.trim() !== ''` condition and the
     `source` lookup it needs.
  2. **`updateRow`**: when `field === 'ticker'` **and** `mode === 'weight'`, also set that row's
     `shares` to `''`. In weight mode the shares field is not rendered, so without this, retyping an
     imported row's ticker would silently attach the old ticker's share count to the new ticker.
     Shares mode is unchanged, because its shares field is visible.
  3. **A note in weight mode.** When `mode === 'weight'` and at least one row whose `ticker !== ''`
     has a non-empty `shares` string, render one line of non-interactive text directly below the
     rows list and above the remainder line, reading exactly:
     `Share counts from the file are saved with these positions. Weights above are what the portfolio uses.`
     Use the muted text style already used nearby (`text-sm text-[var(--color-muted)]`). Render
     nothing when no row qualifies.
- `frontend/src/lib/portfolio.test.ts`: add the tests in criteria 2–3.
- `frontend/src/lib/portfolioCsv.test.ts`: extend the round-trip test (criterion 4).

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. This includes `portfolioCsv.ts`: the parser is already
correct and must not change.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs, but never edit it. `.claude/settings.json` denies Edit and Write there, and that deny list
cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not route around it.

## Interface

No signature changes. `DraftSummary.rows[].shares` is already typed `number | null`. After this
contract, the weight branch populates it instead of always returning `null`.

`handleCreate`'s mapping becomes, in effect:

```ts
row.shares !== null
  ? { ticker: row.ticker, weight: row.weight as number, shares: row.shares }
  : { ticker: row.ticker, weight: row.weight as number }
```

A position without shares must have **no `shares` key at all**, not `shares: undefined`, because
`serializePortfolioCsv` and `isValidCurrentPortfolio` both branch on `=== undefined`. Keep the
two-shape form above.

## Out of scope

- Do not show or edit share counts in the `PortfoliosPage` position editor.
- Do not preserve imported shares when the user switches the draft from weight mode to shares mode.
  The existing clear in `handleModeChange` stays exactly as it is.
- Do not validate shares against weights, and do not warn when they disagree.
- Do not change `parsePortfolioCsv`, `serializePortfolioCsv`, presets, or `presets.test.ts`.
  Contract 0100 is editing `presets.ts` and `presets.test.ts` in parallel.
- No new dependencies.

## Acceptance criteria

1. `cd frontend && npm run test` exits 0, and `npx tsc -p tsconfig.app.json --noEmit` exits 0.
   Never use plain `--noEmit`: it checks nothing in this project.
2. New test in `portfolio.test.ts`: `summariseDraft` in **weight** mode with rows
   `[{ id: 'a', ticker: 'AAPL', weight: '60', shares: '2' }, { id: 'b', ticker: 'MSFT', weight: '40', shares: '' }]`,
   cash `'0'`, and a `byTicker` containing both, returns `rows[0].shares === 2`,
   `rows[1].shares === null`, `canCreate === true`, and weights `[60, 40]`.
3. New test in `portfolio.test.ts`: the same draft with `rows[0].shares` set to `'abc'` still
   returns `canCreate === true`, weights `[60, 40]`, and `rows[0].shares === null`. Share text never
   blocks a weight-mode draft.
4. Extend `round-trips optional shares and a comma in the name` in `portfolioCsv.test.ts` so that
   after parsing, it runs the seed through `summariseDraft` (using the file's existing `toDraft`
   helper and a `byTicker` map with AAPL and MSFT) and asserts the summary rows' `shares` equal
   `[10, null]`. This criterion is the one that would have caught the bug.
5. `grep -n "mode === 'shares' && source" frontend/src/components/NewPortfolioDialog.tsx` prints
   nothing.
6. `grep -c "Share counts from the file are saved with these positions" frontend/src/components/NewPortfolioDialog.tsx`
   prints `1`.
7. State in your report which files you edited. Do not use `git diff` or `git status` to prove
   this: another contract is running in the same working tree, and nothing is committed between
   contracts.

If any criterion cannot be met without breaking another, or without editing a file not listed,
report `BLOCKED`. Do not find a clever way to pass it. `BLOCKED` is the correct answer to an
unsatisfiable contract, not only to an undecided design question.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report, including failures.
Do not summarize, trim or clean up.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend && npm run test
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend && npm run build
grep -n "mode === 'shares' && source" /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/components/NewPortfolioDialog.tsx; echo "grep exit $?"
grep -c "Share counts from the file are saved with these positions" /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/components/NewPortfolioDialog.tsx
```

## Tooltips

This contract adds no interactive element. The note is plain text, so it needs no tooltip.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** `cd frontend && npm run dev`, then open http://localhost:5173.

1. On `/portfolios`, open New Portfolio and import
   `reference files/portfolios/Gunnar Preset V2-2026-09-24.csv`. The draft should open in **By
   weight** with the six weights, and the note should appear below the rows.
2. Create it, then open its Holdings tab. The `Shares` column should read 10, 2.08, 47, 4.46, 68.84
   and 13 for MU, VOO, PBR, ORCL, SHNY and XIACF. The weights should match the file.
3. Export that portfolio, then re-import the export. The shares should survive the second trip.
4. Start a blank weight-mode portfolio. The note should not appear.
5. Import the file again, retype one row's ticker to a different Universe ticker, and create. That
   position should show `—` under Shares.
