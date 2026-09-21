# Contract 0069 — The composer rejects off-universe tickers, like the editor already does

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`summariseDraft`'s weight mode refuses a ticker that is not in the Universe, closing the last path by
which a portfolio can hold a security the app has no data for.

## Why

Gunnar hand-edited `AddPositionForm.tsx` to add `!available.some((entry) => entry.ticker === ticker)`
to its disabled condition, so the **editor** on `/portfolios` will not add an off-universe ticker.
The **composer** — `NewPortfolioDialog`, via `summariseDraft` — still will.

Look at `portfolio.ts:342`. Weight mode's only ticker check is `row.ticker === ''`. It never reads
`byTicker` at all, so typing `ZZZZ` and a weight of 100 creates a portfolio holding a security with
no price, no name, and no history. `valuePortfolio` then renders it as `missing`, which is the right
display for a ticker *deleted from the Universe after the fact* — but it should not be reachable by
typing.

**Shares mode is already safe** and shows the shape of the fix: `portfolio.ts:380` requires
`isFinitePositive(positionPrice(byTicker.get(row.ticker)))`, which an unknown ticker fails. Only
weight mode has the hole.

CSV import is also already safe — off-universe rows are dropped and reported before a seed is built.
Manual typing in the dialog is the only remaining path.

## Files

Modify:
- `frontend/src/lib/portfolio.ts` — add the membership check to `summariseDraft`'s weight mode.
- `frontend/src/lib/portfolio.test.ts` — the tests below.

**Touch nothing else.** No component changes: the dialog already passes `byTicker` and already renders
`summary.problem`. If the work appears to require editing a file not on this list, stop and report
`BLOCKED` instead of editing it.

Do not touch `AddPositionForm.tsx`. It carries Gunnar's uncommitted hand-edit and is already correct.

**`reference files/` is read-only and never belongs on a file list.** `.claude/settings.json` denies
Edit and Write there; that deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

In `summariseDraft`, weight mode only, insert one clause into the existing `problem` chain —
**after** the empty-ticker check and **before** the cash check:

```ts
else if (byTicker.size > 0 && draft.rows.some((row) => row.ticker !== '' && !byTicker.has(row.ticker)))
  problem = 'Every asset must be a ticker in your Universe'
```

Three details, each load-bearing:

- **`byTicker.size > 0` guards the Universe-unreachable case.** `PortfoliosPage` passes `[]` when
  `getUniverse()` fails, and the dialog already renders its own *"Add tickers to your Universe"*
  message in that state. Without the guard, a backend outage would make every row report a ticker
  problem instead — blaming the user for a network failure.
- **`row.ticker !== ''`** keeps the existing *"Choose a ticker for every asset"* message owning the
  empty case. Two messages for one empty field is worse than one.
- **Order matters.** Placed after the empty check, an empty row reports "choose a ticker"; placed
  before it, it would report "must be in your Universe", which is confusing for a field the user has
  not filled in yet.

Do not change shares mode. Do not change `DraftSummary`, `canCreate`, or any message text other than
adding the one above.

## Out of scope

- **No presets.** That is contract 0070, running after this one.
- Do not change `AddPositionForm`, `NewPortfolioDialog`, `PortfoliosPage`, or any CSV module.
- Do not add per-row error display. `summary.problem` is one line for the whole draft and that is the
  existing pattern; a per-row indicator is a separate design question and is not being asked for.
- Do not change how an off-universe ticker is *displayed* once saved. `valuePortfolio`'s `missing`
  flag exists for tickers removed from the Universe after the fact and must keep working.
- Do not add a "add this ticker to the Universe" affordance from the dialog.
- No new dependency.

## Acceptance criteria

1. A test asserts that weight-mode `summariseDraft` with a row whose ticker is **not** a key in
   `byTicker` returns `canCreate === false` and
   `problem === 'Every asset must be a ticker in your Universe'`, with a non-empty `byTicker`.
2. A test asserts the same draft with an **empty** `byTicker` map does **not** report that problem —
   proving the outage guard. State what `problem` is in that case.
3. A test asserts a row with an **empty** ticker still reports `'Choose a ticker for every asset'`,
   not the new message — proving the ordering.
4. A test asserts a fully-valid weight-mode draft whose tickers are all in `byTicker` still returns
   `canCreate === true`. The new clause must not break the happy path.
5. A test asserts **shares mode is unchanged**: an off-universe ticker in shares mode still reports
   `'Every asset needs a usable current price'`, the existing message, not the new one.
6. `cd frontend && npm run test` exits 0. Report the new total — it was 33.
7. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
8. `cd frontend && npm run build` exits 0.
9. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
10. `cd frontend && npm ci` exits 0.
11. `grep -n "byTicker" frontend/src/lib/portfolio.ts` shows weight mode now reads it. Quote the
    surrounding lines.
12. `git diff frontend/src/components/AddPositionForm.tsx` still contains the
    `!available.some((entry) => entry.ticker === ticker)` line, unchanged.
13. You edited exactly two files: `portfolio.ts` and `portfolio.test.ts`. State this explicitly.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm ci && echo "NPM CI OK"
grep -n "byTicker" src/lib/portfolio.ts
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

## Tooltips

No interactive element is added or changed.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`:

1. Open `New portfolio`, type a name, add an asset, and type a ticker that is **not** in your Universe
   (`ZZZZ`). `Create portfolio` must stay disabled and the line above it must read
   *"Every asset must be a ticker in your Universe"*.
2. Change it to a real Universe ticker with a weight of 100 and cash 0. The message clears and
   `Create portfolio` enables.
3. **Stop the backend**, reload `/portfolios`, and open `New portfolio`. You should see the existing
   *"Add tickers to your Universe…"* message — **not** a ticker-validation error. This is the guard in
   criterion 2 and it is the case a test can assert but only you can see in context.
4. Confirm an existing portfolio that holds a ticker you later **delete** from the Universe still
   displays, marked missing. That path is unrelated and must not regress.

No backend restart is needed for 1 and 2; step 3 asks you to stop it deliberately.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
