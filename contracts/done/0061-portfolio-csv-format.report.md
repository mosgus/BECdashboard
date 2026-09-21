# Report — Contract 0061 (Canonical portfolio CSV)

**Verdict: rejected, pending contract 0063.** The parser is good work and nothing in it should be
rewritten. Two defects block acceptance, and both originate in my spec rather than in the
implementation.

## What was claimed

Sonnet reported COMPLETE: 20 tests, all ten rejection categories, `vitest@4.1.11` as a dev
dependency, `TSC OK`, clean build and lint, no `toFixed`, no CSV dependency, `AddPositionForm.tsx`
untouched. It disclosed two things it could have hidden: that `package-lock.json` was regenerated and
then restored because the file list did not name it, and that shares-only imports cannot transfer a
dropped row's allocation to cash.

## What I verified

Re-ran everything rather than reading the paste. `npm run test` → 20 passed.
`npx tsc -p tsconfig.app.json --noEmit` → `TSC OK`. `npm run build` → clean. `npm run lint` → only the
pre-existing `UniversePage.tsx:60` warning. `grep -n "toFixed"` → nothing.
`git diff frontend/src/components/AddPositionForm.tsx` → still exactly the one added
`!available.some(...)` line, unchanged.

Then read `portfolioCsv.ts` and `portfolioCsv.test.ts` in full and ran my own probe suite against the
module for cases the tests do not cover.

**What is genuinely right, and worth saying concretely:**

- **The stated-cash round-trip is exact by construction, not by luck.** `parsePortfolioCsv:261-262`
  returns `statedCash.raw` — the literal source string — when nothing was dropped, and only computes
  a new value when a drop changes the answer. That is the right instinct and it is what makes
  criterion 2 pass.
- **Duplicate detection runs at line 200, before the drop filter at line 236.** Criterion 10's test
  (`ZZZ,25 / zzz,25`, both off-universe, rejected at line 3) actually proves the ordering rather than
  asserting around it.
- **The drop-to-cash arithmetic is correct.** `positionWeightTotal` accumulates before the filter, so
  `100 - positionWeightTotal + droppedWeight` reduces to `100 - survivingTotal`. Verified by probe,
  not by reading.
- I confirmed full idempotence independently: export → import → `summariseDraft` → export produces a
  **byte-identical** file.

## Defect 1 — `npm ci` is broken in this repo right now

`package.json` declares `vitest@^4.0.18`; `package-lock.json` does not contain it. Confirmed:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
npm error Missing: vitest@4.1.11 from lock file
```

Any fresh clone, any CI step, and any Render build that uses `npm ci` now fails outright. The coder
restored the lockfile **because my file list did not name it** and the contract says to report
`BLOCKED` rather than edit an unlisted file — it followed the rule correctly and disclosed the
consequence. The rule was wrong.

**General lesson, going into `REBUILD.md`: a contract that adds or removes a dependency must list the
lockfile.** `package.json` and `package-lock.json` are one edit, and separating them produces a tree
that passes every acceptance criterion and cannot be installed.

## Defect 2 — a 100%-cash portfolio cannot be re-imported

This one is a real round-trip failure and neither report mentions it. `PortfoliosPage.tsx:103-109`
explicitly supports a portfolio with no positions and `cashWeight: 100`. Exporting one produces:

```
# Blue Eagle Portfolio v1
# name: AllCash
ticker,weight_pct,shares
CASH,100,
```

Re-importing it returns `{"ok":false,"error":"No portfolio tickers are in the current universe"}`.

Two things are wrong. The file is rejected at all, which breaks the stated goal that an exported CSV
is uploadable later. And the message is **actively misleading** — it blames the Universe for a file
that named no tickers to check against it.

The cause is my spec, not the code: rejection #10 says *"every row dropped as off-universe (nothing
left to seed)"*, and `surviving.length === 0` is a faithful reading that happens to also catch "there
were never any positions." Those are different conditions and need different answers.

## Defect 3 (minor) — criterion 2's fixture is weaker than I intended

I chose `100 / 3` to force a non-round-trippable cash value. It does not: `3 * (100/3) === 100`
exactly in float64, so `cashWeight` is `0` and the awkward-cash path is never exercised. The
*weights* are genuinely irrational (`33.333333333333336`) and do round-trip strictly, so the
criterion still proves the thing that matters — `String` over `toFixed` — but the cash arm is
decorative. Worth one better fixture rather than a rewrite.

## Not defects

- **"Shares-only imports cannot transfer an allocation to cash."** The coder is right and so is the
  code. My contract said *"weighted file (modes 1 and 2)"* sends dropped weight to cash, but mode 2
  is the shares-only file, which states no percentages — there is nothing to transfer. Contract text
  error; behaviour is correct. `REBUILD.md` corrected.
- **A ticker-only file containing a bare `CASH` line is rejected** ("CASH needs a finite weight of
  zero or greater"). Unspecified, defensible, clearly messaged. Leaving it.
- **A weight-mode row with a blank weight cell parses**, and `summariseDraft` then blocks creation
  with *"Every asset needs a strictly-positive weight."* Visible, not silent. Correct.
- Bundle went `333.27 → 334.44 kB` (`99.98 → 100.41 kB` gzip). That is the new lib code; `vitest` is
  not in the bundle. My criterion 17 said "must not grow," which was badly worded — the intent was
  that the dev dependency stays out, and it does.

## Disposition

Work stays on disk. Contract **0063** repairs both defects and the two bad criteria; this contract is
archived with it once 0063 is accepted. Do not re-run 0061.

## Final status — updated 2026-09-21

**Accepted.** Contract 0063 repaired both blocking defects: `npm ci` works again, and an all-cash
portfolio now round-trips (`portfolioCsv.ts:241-248`). Defect 3 — the fixture that collapsed into the
easy case — is also closed, by 0063's `100 - 2 * (70 / 3)` test. Archived alongside 0063.
