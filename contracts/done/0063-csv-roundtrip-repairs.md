# Contract 0063 — CSV round-trip repairs: lockfile, all-cash portfolios, export button grouping

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`npm ci` works again, an all-cash portfolio survives export and re-import, and the two header buttons
on `/portfolios` sit next to each other.

## Why

Three defects found in the 0061 and 0062 audits. All three are small, all three are mechanical, and
all three are consequences of my contract text rather than of the code that shipped — see
`contracts/0061-portfolio-csv-format.report.md` for the full verdicts.

The lockfile one is the urgent one: the repo currently cannot be installed with `npm ci` at all.

## Files

Modify:
- `frontend/package-lock.json` — regenerate so `vitest@4.1.11` and its transitive dependencies are
  present. Do this by running `npm install` in `frontend/`, not by hand-editing the file.
- `frontend/src/lib/portfolioCsv.ts` — split the empty-result rejection in two (see Interface).
- `frontend/src/lib/portfolioCsv.test.ts` — add three tests (see Acceptance criteria).
- `frontend/src/pages/PortfoliosPage.tsx` — wrap the two header buttons in a flex group.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`frontend/src/components/AddPositionForm.tsx` has an uncommitted hand-edit in the working tree.**
Do not revert, reformat, or touch that file.

**`reference files/` is read-only and never belongs on a file list.** `.claude/settings.json` denies
Edit and Write there; that deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### 1. Lockfile

```bash
cd frontend && npm install
```

`package.json` is already correct and **must not change** — no version bump, no reordering, no
script changes. Only the lockfile moves.

### 2. All-cash portfolios must import

`parsePortfolioCsv` currently returns one rejection for two different situations. At
`portfolioCsv.ts:241`:

```ts
if (surviving.length === 0) return failure('No portfolio tickers are in the current universe', null)
```

Split it. The distinguishing fact is whether the file contained any non-`CASH` rows at all — that is
`positions.length`, computed before the drop filter:

- **`positions.length === 0`** (the file named no positions; a canonical export of a 100%-cash
  portfolio is exactly this) → **succeed**, with an empty `rows` array:

  ```ts
  { ok: true, seed: { name, mode: 'weight', cash: <the stated cash, raw>, rows: [] }, dropped: [] }
  ```

  Use `statedCash.raw` when a `CASH` row is present, so the round-trip stays exact. When no `CASH`
  row is present either, the file has no content at all and the existing "no data rows" rejection at
  line 182 already covers it — do not reach this branch with `statedCash === null`. If you find a
  path that does, report `BLOCKED` rather than inventing a default.

- **`positions.length > 0 && surviving.length === 0`** (every named position was dropped) → keep the
  rejection, with the existing message. It is accurate in this case and only this case.

Place the split **after** the drop filter and **before** the mode branches, so the three seeding
paths are unreachable with an empty `positions` list.

`summariseDraft` already accepts zero rows: weight mode with `rows: []` and `cash: '100'` gives
`allocatedPercent === 100` and `canCreate === true`. Do not change `lib/portfolio.ts` to accommodate
this — verify the existing behaviour instead, and if it does not hold, report `BLOCKED`.

### 3. Button grouping

In `PortfoliosPage.tsx`, the header row is
`<div className="flex flex-wrap items-center justify-between gap-3 mb-4">` with three children: the
rename `Tooltip`, the `Export CSV` `Tooltip`, and the `Delete portfolio` `Tooltip`. `justify-between`
spreads three children evenly, so Export floats in the middle of the row.

Wrap the **two button `Tooltip`s only** — not the rename input — in:

```tsx
<div className="flex items-center gap-2">
```

Order inside the group stays Export, then Delete. Change nothing else about either button: same
classes, same tooltip copy, same handlers.

Note for whoever checks this: `Tooltip` renders an `inline-flex` span around its child, so a
tooltipped element is content-sized and does not stretch (`REBUILD.md`, "`Tooltip` wraps its child in
an `inline-flex` span"). Both buttons are `whitespace-nowrap` and content-sized already, so no
`w-full` is needed here — but do not add one thinking it will help.

## Out of scope

- **No import UI.** No file input, no drag-and-drop, no `NewPortfolioDialog` changes. That is 0064.
- **No presets.** Do not add, stub, or name any preset portfolio or allocation.
- Do not change the CSV format, the alias table, the mode-selection rules, or any other rejection.
- Do not change `package.json`, `vite.config.ts`, `lib/portfolio.ts`, `lib/portfolioStore.ts`, or
  `lib/download.ts`.
- Do not "fix" the ticker-only-file-with-a-bare-`CASH`-row rejection. It was reviewed and kept.
- Do not add a dependency. `npm install` here regenerates the lockfile for a dependency that is
  already declared; it must not add a new one.

## Acceptance criteria

1. `cd frontend && npm ci` exits 0. This is the criterion that matters most — it fails today.
2. `git diff frontend/package.json` prints nothing. The lockfile moved; the manifest did not.
3. `cd frontend && npm run test` exits 0 with **23** tests passing (20 existing + 3 new).
4. A new test round-trips a `Portfolio` with `positions: []` and `cashWeight: 100` through
   `serializePortfolioCsv` → `parsePortfolioCsv` → `summariseDraft`, and asserts `ok === true`,
   `seed.rows` is empty, `summary.cashWeight === 100`, and `summary.canCreate === true`.
5. A new test asserts a file whose only named position is off-universe (e.g.
   `ticker,weight\nZZZ,50\nCASH,50`) is still **rejected** — proving the split did not turn the
   all-dropped case into a silent empty import.
6. A new test asserts exact round-tripping of a stated cash value that is **not** representable as a
   short decimal. Build the portfolio as two positions of `weight: 70 / 3` each and
   `cashWeight: 100 - 2 * (70 / 3)`, and assert `summary.cashWeight` is **strictly equal** (`===`) to
   the original. Contract 0061's fixture used `100 / 3` three times, where `3 * (100 / 3) === 100`
   exactly, so the awkward-cash path was never actually exercised. Confirm this fixture does not
   collapse the same way before relying on it — if `100 - 2 * (70 / 3)` turns out to be exact too,
   find a fixture that is not and say which you used.
7. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project and is not a substitute — see `REBUILD.md`.)
8. `cd frontend && npm run build` exits 0.
9. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
10. `grep -c "<Tooltip" frontend/src/pages/PortfoliosPage.tsx` is unchanged from before this contract.
    Report the number. (Counting `"Tooltip"` instead of `"<Tooltip"` counts closing tags too — that
    error is what made contract 0062 report `BLOCKED`.)
11. `git diff frontend/src/components/AddPositionForm.tsx` still shows only the single added
    `!available.some(...)` line.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm install
cd frontend && npm ci && echo "NPM CI OK"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff --stat frontend/package.json
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
grep -c "<Tooltip" src/pages/PortfoliosPage.tsx
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

Report the exact value of `100 - 2 * (70 / 3)` that your criterion-6 fixture produced.

## Tooltips

No new interactive element. The two existing buttons keep their existing tooltip copy verbatim:

| element | tooltip label |
|---|---|
| `Export CSV` | `Download this portfolio as a CSV you can re-import on another device` |
| `Delete portfolio` | `Permanently delete this portfolio — it is stored only in this browser` |

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`:

1. **Export a real portfolio and confirm a file actually downloads.** Nothing automated covers this:
   `downloadTextFile` clicks a **detached** anchor and revokes the object URL on the very next line.
   Both are the usual idiom, both work in Chrome, and both have historically been flaky elsewhere — a
   detached-anchor click was once a no-op in Firefox, and a synchronous revoke can race the download.
   If the file does not appear, that is the cause, and the fix is appending the anchor to `document.body`
   before clicking and revoking on a `setTimeout(…, 0)`. Report it rather than patching it here.
2. Open the file in a **text editor**, not Excel — Excel reformats the numbers and will make a
   correct file look wrong. Confirm line 1 is `# Blue Eagle Portfolio v1` and line 2 carries the name.
3. **Make a 100%-cash portfolio** (create one, remove every position) and export it. Confirm the file
   has a `CASH,100,` row and nothing else. Keep the file — 0064 will use it as the import test case.
4. Confirm `Export CSV` and `Delete portfolio` now sit **adjacent** on the right of the header, with
   the name input on the left.
5. Check the header at **1024px and 1023px**, and at 375px. `REBUILD.md` records that a `min-width`
   breakpoint's worst case is exactly at its trigger point, and that this page's card uses
   `overflow-hidden`, which turns overflow into silent clipping rather than a scrollbar. Confirm the
   row wraps rather than clipping `Delete portfolio`.

No backend restart is needed — this contract changes no server code.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
