# Contract 0072 — A typed cash percentage is stored exactly, and the last two inline remainders go

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

Typing `5` in the Cash field stores exactly `5`, and every cash remainder in the codebase comes from
`cashFromPositions`.

## Why

**Measured by Gunnar, 2026-09-21.** He typed `5` into the Cash field, reloaded, and the field read
`5.000000000000014`.

`handleCashTextChange` (`PortfoliosPage.tsx:126-138`) rescales the positions to fill `100 - parsed`,
then **discards the value the user typed** and recomputes cash from the rescaled weights:

```ts
const targetAssetWeight = 100 - parsed
const positions = current.positions.map((p) => ({ ...p, weight: (p.weight / assetWeight) * targetAssetWeight }))
const cashWeight = cashFromPositions(positions)      // ← the typed 5 is gone
```

The rescale is not lossless, so `100 - Σ` lands a few ulps off `parsed`. `cashFromPositions` only
snaps within `1e-9` of **zero**, so a residue near `5` passes straight through and is stored.

**This contradicts a rule this project already settled.** `REBUILD.md`, on the CSV format: *"Cash is
stated-or-derived, never recomputed over a stated value."* The CSV parser honours it; the editor does
not. The user stated the number. It wins.

**The same bug has a bigger sibling, visible in Gunnar's two exports.** Every cash edit rescales
*every* position, and the rescale loses precision unevenly:

| ticker | before a cash edit | after |
|---|---|---|
| `VOO` | `10.4075329437956` | `10.407532943795601` |
| `PBR` | `3.1979752499318987` | `3.1979752499318996` |
| `XIACF` | `0.30626691660223515` | `0.3062669166022351` |

That drift also explains an earlier unexplained observation: the three original positions in an older
export had scaled by *different* factors, which pure dilution cannot produce. A cash edit did it.

**Position drift is inherent and is not in scope.** Rescaling is the intended behaviour — cash up,
positions shrink proportionally — and ulp-level loss is unavoidable when you do it. It is ~1e-15
relative, which cannot matter to an allocation. What *is* fixable is that the one number the user
typed should not also be approximate.

This contract also closes the two residues logged in
`contracts/done/0071-cash-epsilon-data-loss.report.md`, both of which were scope errors in that
contract's file list.

## Files

Modify:
- `frontend/src/pages/PortfoliosPage.tsx` — `handleCashTextChange` stores the typed value.
- `frontend/src/lib/portfolio.ts` — `migrateLegacyPortfolio` uses `cashFromPositions`.
- `frontend/src/lib/portfolioStore.ts` — `normaliseStoredPortfolio` uses `WEIGHT_EPSILON`.
- `frontend/src/lib/portfolio.test.ts` — tests for the migration change.
- `frontend/src/lib/portfolioStore.test.ts` — tests for the epsilon change.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch `AddPositionForm.tsx`, `NewPortfolioDialog.tsx`, `presets.ts`, `portfolioCsv.ts`, or
`download.ts`. `AddPositionForm.tsx` is committed and carries the Universe guard at line 57 — verify
with `grep`, never `git diff`.

**`reference files/` is read-only and never belongs on a file list.** The weights above were
transcribed by the planner from Gunnar's exports; do not read, copy from, or reference that directory
in any source or test file.

## Interface

### 1. The typed cash percentage is authoritative

In `handleCashTextChange`, after rescaling, store `parsed` — not a recomputed remainder:

```ts
const targetAssetWeight = 100 - parsed
const positions = current.positions.map((position) => ({
  ...position,
  weight: (position.weight / assetWeight) * targetAssetWeight,
}))

const total = parsed + positions.reduce((sum, position) => sum + position.weight, 0)
if (!Number.isFinite(total) || Math.abs(total - 100) > 0.01) {
  setCashProblem('The saved asset weights cannot be rescaled.')
  return
}

setCashProblem(null)
persist({ ...current, cashWeight: parsed, positions })
```

Three points:

- **`cashWeight: parsed`** is the change. The residue now lands in the positions, where it is already
  unavoidable, instead of in the one figure the user chose.
- **The total is still validated**, against the project's `±0.01`, so a genuinely broken rescale is
  still caught. `parsed` is already range-checked above (`>= 0`, `< 100`) by the existing guards —
  do not duplicate those.
- **Do not call `cashFromPositions` here.** That helper derives cash when nothing stated it. This path
  has a stated value, and the two must not be confused — that confusion is the bug.

Leave the existing `positions.length === 0` branch alone; it already persists `cashWeight: 100`
exactly.

### 2. `migrateLegacyPortfolio` uses the helper

`portfolio.ts:139` still computes `100 - Σ` inline and returns `null` on any negative:

```ts
const cashWeight = 100 - positions.reduce((sum, position) => sum + position.weight, 0)
if (!Number.isFinite(cashWeight) || cashWeight < 0) return null
```

Replace with `cashFromPositions(positions)`, returning `null` when it does. Behaviour changes only in
that a float residue no longer blocks a legacy migration — which is the point. Contract 0071's Goal
said cash is computed in exactly one place; this is what makes that true.

### 3. One epsilon, not two

`portfolioStore.ts:71` uses a literal `-0.01`:

```ts
if (typeof candidate.cashWeight !== 'number' || !(candidate.cashWeight < 0 && candidate.cashWeight > -0.01)) return value
```

Import `WEIGHT_EPSILON` from `./portfolio` and use `-WEIGHT_EPSILON`. The write path can no longer
produce anything outside `1e-9`, so a wider recovery window only admits values nothing explains —
and two epsilons for one concept is the exact divergence 0071 existed to remove.

Note the direction: this **narrows** what is recovered. A hypothetical stored `-0.005` would now be
rejected rather than snapped. That is correct — it is not float noise and nothing in this codebase
can produce it.

## Out of scope

- **No presets.** Do not add, rename, or alter any preset.
- **Do not try to stop position weights drifting.** Rescaling loses ulps; that is arithmetic, not a
  defect, and any "fix" would mean not rescaling.
- Do not round, `toFixed`, or format any stored weight. Display formatting is unchanged.
- Do not change `cashFromPositions` itself, `WEIGHT_EPSILON`'s value, or the `±0.01` total tolerance.
- Do not weaken `isValidCurrentPortfolio`.
- Do not change `addPositionDiluting` or `removePositionToCash` — they derive cash correctly because
  nothing states it in those paths.
- No new dependency.

## Acceptance criteria

1. A test asserts that rescaling Gunnar's six weights for a typed cash of `5` and storing `parsed`
   yields a `cashWeight` of **exactly `5`** (`Object.is`), and that the resulting total is within
   `0.01` of 100. Build it from the weights in the Why section above.
2. A test asserts the same for typed cash values of `0`, `0.005`, and `99.9` — each stored exactly as
   typed.
3. `grep -n "cashFromPositions" frontend/src/pages/PortfoliosPage.tsx` prints **nothing**. The stated
   path must not route through the derived helper.
4. A test asserts `migrateLegacyPortfolio` succeeds on a legacy portfolio whose derived weights leave
   a negative float residue — a case that returns `null` today. Construct it so the residue is real;
   state the residue you achieved.
5. `grep -n "100 - " frontend/src/lib/portfolio.ts` no longer matches inside `migrateLegacyPortfolio`.
   Quote every surviving match and say why each is legitimate.
6. `grep -n -- "-0.01" frontend/src/lib/portfolioStore.ts` prints nothing.
7. `grep -n "WEIGHT_EPSILON" frontend/src/lib/portfolioStore.ts` prints the import and its single use.
8. A test asserts `listPortfolios` still recovers a `-1.4210854715202004e-14` cash weight as `0`, and
   now **rejects** one of `-0.005`. Both directions of the narrowed window.
9. `cd frontend && npm run test` exits 0. Report the new total — it was 50.
10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
    this project — see `REBUILD.md`.)
11. `cd frontend && npm run build` exits 0.
12. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
13. `cd frontend && npm ci` exits 0.
14. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
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
grep -n "cashFromPositions" src/pages/PortfoliosPage.tsx ; echo "stated-path grep exit: $?"
grep -n "100 - " src/lib/portfolio.ts
grep -n -- "-0.01" src/lib/portfolioStore.ts ; echo "old-epsilon grep exit: $?"
grep -n "WEIGHT_EPSILON" src/lib/portfolioStore.ts
grep -n "available.some" src/components/AddPositionForm.tsx
```

## Tooltips

No interactive element is added or changed.

## Human verification — does Gunnar need to run anything?

**Yes — this is the check that found the bug.**

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`, on `Gunnar Preset`:

1. Set Cash to `5`. **Reload.** The field must read exactly `5` — not `5.000000000000014`. Reload two
   or three more times; it was intermittent before, so one clean reload is not proof.
2. Set it back to `0`, reload, and confirm `0`.
3. Export and check the `CASH` row is a clean number.
4. **Expected and not a bug:** the position weights will still shift in the last digit or two on each
   cash edit. Rescaling six numbers cannot be lossless. Nothing downstream can see a 1e-15 difference
   — flag it only if you ever see a change in a digit you can read.

No backend restart is needed.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
