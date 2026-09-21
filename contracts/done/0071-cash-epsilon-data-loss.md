# Contract 0071 — A float residue in cash silently deletes a portfolio on reload

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

> ## ⚠ REVISED 2026-09-21 — re-read this file before executing
>
> **If you executed this contract before, the version you read was self-contradictory.** The helper
> snapped only *negative* residue while criterion 3 required a *positive* residue to snap. The
> previous run correctly reported `BLOCKED` rather than picking one — that was the right call.
>
> Two things changed: the snap is now **symmetric**, and the threshold is **`1e-9`, not `0.01`**. The
> reasoning is in "One computation, one place" and it matters — `0.01` would have silently eaten a
> user-entered cash value.
>
> Do not execute from a remembered copy of this file. Read it from disk, in a fresh session.

## Goal

Cash weight is computed in exactly one place, float residue can never make it negative, and a
portfolio already carrying a negative residue is repaired on read instead of discarded.

## Why

**This is live data loss.** Gunnar's real `Gunnar Preset` portfolio exports as:

```
CASH,-1.4210854715202004e-14
```

`portfolioStore.isValidCurrentPortfolio` rejects any `cashWeight < 0`, and `listPortfolios` **filters
out** entries that fail it. Measured 2026-09-21 against that exact record: `listPortfolios()` returns
**0 portfolios**. The row is still in `localStorage`; the app simply stops showing it. Create a
portfolio, touch the Cash field, reload the page, and it is gone with no error anywhere.

The source is `PortfoliosPage.tsx:129`, in `handleCashTextChange`:

```ts
const positions = current.positions.map((position) => ({ ...position, weight: (position.weight / assetWeight) * targetAssetWeight }))
const cashWeight = 100 - positions.reduce((sum, position) => sum + position.weight, 0)
```

No clamp. Rescaling six weights and re-summing lands `1.42e-14` either side of 100. Reproduced
exactly: that arithmetic on the preset's weights yields ORCL `10.48199452439696` — the precise value
in Gunnar's exported file — confirming this path, not the preset and not `addPositionDiluting`, wrote
the bad record.

**`addPositionDiluting` already solves this and the other two paths do not.** Contract 0064's
implementer added a clamp there unprompted, having hit the problem:

```ts
if (cashWeight < 0 && cashWeight > -0.01) cashWeight = 0
```

So `100 - Σ` is currently computed in **three** places with **two** different behaviours —
`addPositionDiluting` (clamped), `removePositionToCash` (unclamped, `portfolio.ts:215`), and
`handleCashTextChange` (unclamped). That divergence is the actual defect; the missing clamp is a
symptom.

There is also an inconsistency in the validator worth naming: it tolerates the *total* being within
`±0.01` of 100 but demands `cashWeight >= 0` exactly. A residue too small to matter for the total is
fatal for the component.

## Files

Modify:
- `frontend/src/lib/portfolio.ts` — add `cashFromPositions`; use it in `addPositionDiluting` and
  `removePositionToCash`.
- `frontend/src/lib/portfolioStore.ts` — normalise a negative-epsilon `cashWeight` on read.
- `frontend/src/pages/PortfoliosPage.tsx` — `handleCashTextChange` uses `cashFromPositions`.
- `frontend/src/lib/portfolio.test.ts` — the tests below.
- `frontend/src/lib/portfolioStore.test.ts` — **create** if absent; the read-repair tests.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch `AddPositionForm.tsx`, `NewPortfolioDialog.tsx`, `presets.ts`, `portfolioCsv.ts`, or
`download.ts`.

**`reference files/` is read-only and never belongs on a file list.** The values above were
transcribed by the planner from `reference files/portfolios/Gunnar Preset-2026-09-21.csv`; do not read,
copy from, or reference that path in any source or test file.

## Interface

### One computation, one place

```ts
/** Cash as the remainder of an allocation: `100 - Σweights`, with float residue inside the
 *  project's ±0.01 tolerance snapped to exactly 0.
 *
 *  Rescaling or re-summing weights lands a few 1e-14 either side of 100. A positive residue is
 *  harmless; a negative one is not — `portfolioStore.isValidCurrentPortfolio` rejects
 *  `cashWeight < 0`, and `listPortfolios` then drops the portfolio from the list entirely.
 *
 *  Returns null when the remainder is genuinely out of range, which stays a caller error. */
export function cashFromPositions(positions: Position[]): number | null
```

```ts
/** Residue below this is float noise, not an allocation. Symmetric. */
export const WEIGHT_EPSILON = 1e-9
```

Behaviour:

- `total = Σ positions[].weight`
- `cash = 100 - total`
- if `!Number.isFinite(cash)` → return `null`
- if `Math.abs(cash) < WEIGHT_EPSILON` → return **`0`** *(both signs)*
- if `cash < 0` → return `null`
- otherwise return `cash`

**Two corrections from the first version of this contract, both deliberate:**

**The snap is symmetric.** Rescaling lands on either side of 100 depending on rounding — Gunnar's
stored record carried `-1.42e-14`, and the same arithmetic targeting cash `0` produces `+1.42e-14`.
Snapping one sign and not the other leaves `String(cashWeight)` exporting
`CASH,1.4210854715202004e-14` in a user-facing CSV, and guarantees the sign nobody handled becomes the
next bug. Treat both as the zero they are.

**The threshold is `1e-9`, not the project's `±0.01`.** This is the correction that matters.
`cashFromPositions` also serves `handleCashTextChange`, where the user *types* a cash percentage and
the positions are rescaled to match. A user who types `0.005` would have that value silently snapped
to `0` under a `0.01` threshold — the helper would destroy exactly the input it exists to preserve.

`1e-9` sits about five orders of magnitude above float64 noise on values near 100 (~1.4e-14) and seven
below the display tolerance, so it cannot reach anything a person typed.

**This tightens `addPositionDiluting`'s existing clamp** from `-0.01` to `-1e-9`. That is intended: a
dilution landing at `-0.005` is a logic error, not rounding, and returning `null` surfaces it instead
of quietly zeroing it.

**Replace the inline computation in all three call sites** — `addPositionDiluting`,
`removePositionToCash`, and `handleCashTextChange`. `addPositionDiluting`'s existing clamp is deleted
because the helper now does it; its behaviour must not otherwise change.

In `handleCashTextChange`, a `null` return sets the existing
`'The saved asset weights cannot be rescaled.'` problem and does **not** persist. Do not invent a new
message.

### Repair on read, do not discard

In `portfolioStore.ts`, a stored portfolio whose `cashWeight` is negative but greater than `-0.01`
must **load, with its `cashWeight` normalised to `0`** — not be filtered out.

Records already written by the bug exist on Gunnar's machine right now. Tightening the writer alone
leaves them invisible forever.

Implement as a normalisation step before validation, so `isValidCurrentPortfolio` keeps its strict
`cashWeight >= 0` rule and is not weakened:

```ts
function normaliseStoredPortfolio(value: unknown): unknown   // snaps a (-0.01, 0) cashWeight to 0
```

`listPortfolios` normalises each candidate first, then validates. A `cashWeight` of `-5` is still
rejected — that is corrupt, not residue.

**Do not have `listPortfolios` write back.** Reads stay reads; the repaired value persists the next
time the user saves. A read that silently rewrites storage is a worse property than a stale record.

## Out of scope

- **No presets.** Do not add, rename, or alter any preset.
- Do not weaken `isValidCurrentPortfolio`. The strict rule stays; normalisation happens before it.
- Do not change the `±0.01` total tolerance anywhere.
- Do not change `serializePortfolioCsv`. It will emit `0` once the stored value is `0`; writing a
  rounded number on export would hide the bug rather than fix it.
- Do not add a migration pass, a version field, or a one-off repair script.
- Do not change how weights are rescaled — only how the resulting cash is derived.
- No new dependency.

## Acceptance criteria

1. A test asserts `cashFromPositions` returns exactly `0` (`Object.is`, so `-0` fails) for positions
   summing to `100 + 1.4210854715202004e-14` **and** for positions summing to
   `100 - 1.4210854715202004e-14`. Both signs, one expectation.
2. A test asserts `cashFromPositions` returns `null` for positions summing to `150`, and a normal
   positive remainder for positions summing to `60` (expect `40`).
2b. **A test asserts a user-entered cash value survives.** Positions summing to `99.995` must return
   `0.005`, **not** `0` — proving the threshold is `1e-9` and not `0.01`. This is the criterion that
   fails if anyone widens the epsilon to the project's display tolerance.
3. A test reproduces the real defect end to end: take the six weights
   `73.40490607218531`, `10.481994524396962`, `10.4075329437956`, `3.1979752499318987`,
   `2.2013242930879917`, `0.30626691660223515`, rescale them the way `handleCashTextChange` does for a
   target cash of `0`, and assert `cashFromPositions` on the result is exactly `0` — **not** an
   epsilon of either sign. Report which sign the raw `100 - Σ` produced before the snap.
4. A test asserts `listPortfolios` **returns** a stored portfolio whose `cashWeight` is
   `-1.4210854715202004e-14`, with its `cashWeight` read back as exactly `0`. This is the criterion
   that proves Gunnar's existing record is recovered; it fails against today's code, which returns an
   empty array.
5. A test asserts `listPortfolios` still **rejects** a stored portfolio with `cashWeight: -5`.
6. A test asserts `listPortfolios` does not write to `localStorage` — assert `setItem` is never called
   during a read. State how you stubbed it.
7. `grep -n "100 - " frontend/src/lib/portfolio.ts frontend/src/pages/PortfoliosPage.tsx` shows the
   remainder is no longer computed inline in `addPositionDiluting`, `removePositionToCash`, or
   `handleCashTextChange`. Quote what remains and say why each surviving match is legitimate.
8. `grep -n -- "-0.01" frontend/src/lib/portfolio.ts frontend/src/pages/PortfoliosPage.tsx` prints
   nothing — the old inline clamp and its threshold are gone from both files.
8b. `grep -n "WEIGHT_EPSILON" frontend/src/lib/portfolio.ts` shows the constant declared once and used
   once, inside `cashFromPositions`. No call site applies its own epsilon.
9. `cd frontend && npm run test` exits 0. Report the new total — it was 44.
10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
    this project — see `REBUILD.md`.)
11. `cd frontend && npm run build` exits 0.
12. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
13. `cd frontend && npm ci` exits 0.
14. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard. *(Use `grep`, not `git diff` — that file is committed and a diff is empty by design.)*
15. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm ci && echo "NPM CI OK"
grep -n "100 - " src/lib/portfolio.ts src/pages/PortfoliosPage.tsx
grep -n "> -0.01" src/lib/portfolio.ts ; echo "old-clamp grep exit: $?"
grep -n "cashFromPositions" src/lib/portfolio.ts src/pages/PortfoliosPage.tsx
grep -n "available.some" src/components/AddPositionForm.tsx
```

## Tooltips

No interactive element is added or changed.

## Human verification — does Gunnar need to run anything?

**Yes, and it is the only check that proves the recovery worked.**

```bash
cd frontend && npm run dev
```

1. **Before anything else, open `/portfolios` and look at the sidebar.** If `Gunnar Preset` is
   missing, that is the bug — the record is in `localStorage` but the app refuses to list it. If it is
   still there, you have not reloaded since creating it.
2. With this contract applied, reload again. **`Gunnar Preset` must appear**, with Cash showing
   `0.00%`.
3. Select it and **export**. The `CASH` row must now read `CASH,0,` — not a number in scientific
   notation.
4. Change the Cash field to `5`, then back to `0`. Reload. The portfolio must still be there. This is
   the write-side fix; step 2 was the read-side one.
5. Add a position and remove it again, then reload. `removePositionToCash` had the same missing clamp
   and is fixed by the same helper.

If step 1 shows the portfolio already gone, nothing is lost — the data is intact in `localStorage` and
step 2 brings it back. Do not clear site data before running this.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
