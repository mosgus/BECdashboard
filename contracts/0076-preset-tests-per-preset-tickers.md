# Contract 0076 — Preset tests derive each preset's ticker set from that preset

**Status:** open <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`presets.test.ts` passes against any number of presets, because each one is parsed against the
tickers it actually names.

## Why

**The frontend suite fails today.** Three tests in `presets.test.ts`, after Gunnar added a second
preset (`BEC Portfolio`) in commit `f8a81ce`.

**The presets are fine.** Both were probed through the real parser during the 0075 audit: both return
`ok`, both have empty share columns, cash resolves to `0` and `38.02`. Nothing about the data needs
changing.

The test hardcodes one ticker set at `presets.test.ts:7`:

```ts
const presetTickers = new Set(['MU', 'ORCL', 'VOO', 'PBR', 'SHNY', 'XIACF'])
```

— the *first* preset's tickers — and applies it to **every** preset in the loop. `BEC Portfolio`'s
eight (`VEA, SETM, XLK, CEG, GLD, XLP, XLV, MS`) are all absent from it, so every position drops and
`parsePortfolioCsv` correctly returns *"No portfolio tickers are in the current universe."* The
shares assertion fails for the same reason — it never reaches a seed.

**This is a planner error from contract 0070.** Its criterion 2 said *"parses every preset against
`<all its tickers>`"*, meaning each preset's own; the implementation used a single shared constant and
I accepted it. It passed while exactly one preset existed and broke the instant a second arrived —
so the suite could not survive the event that its own sibling test, `toHaveLength(1)`, exists to
detect.

That length assertion firing is **correct behaviour**: it is the tripwire from contract 0070 ensuring
a coding agent never quietly authors an allocation. Gunnar authored this one, so the expected number
moves to 2. **Do not delete that test** — it is the only thing standing between this catalog and a
well-meaning agent adding a 60/40.

## Files

Modify:
- `frontend/src/lib/presets.test.ts` — derive tickers per preset; update the expected count.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**Do not modify `frontend/src/lib/presets.ts`.** The presets are correct and one of them is Gunnar's
real allocation. Changing a weight, a ticker, a name or a description to make a test pass would be
altering his data to satisfy an assertion — the exact failure contract 0068 was written to prevent.

Do not touch `portfolioCsv.ts`, `portfolio.ts`, `portfolioStore.ts`, or any component.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

Replace the module-level `presetTickers` constant with a helper that reads each preset's own CSV:

```ts
/** The tickers a preset actually names, excluding the reserved CASH row. Derived from the
 *  preset's own CSV so the suite survives presets being added — a shared constant broke the
 *  moment a second preset arrived (contract 0076). */
function tickersOf(preset: Preset): Set<string> {
  return new Set(
    preset.csv
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[0].trim().toUpperCase())
      .filter((ticker) => ticker !== '' && ticker !== 'CASH'),
  )
}
```

Then:

- **Every test that loops over `PRESETS`** uses `tickersOf(preset)` for that preset. No test may use
  another preset's tickers.
- **Tests that reach for `PRESETS[0]` specifically** — the full-precision / `cash === '0'` one — must
  keep doing so and keep using `tickersOf(PRESETS[0])`. That test is about the first preset's exact
  weights and is not a general property; do not generalise it into the loop, and do not assert
  `cash === '0'` for every preset. `BEC Portfolio` has `38.02` cash and that is correct.
- `byTickerFor` stays as it is; pass it `tickersOf(preset)`.
- `expect(PRESETS).toHaveLength(1)` becomes `toHaveLength(2)`, with a comment naming why the number is
  pinned: a coding agent must never add an allocation, so this changes only when Gunnar does.

Import the `Preset` type from `./presets` for the helper's signature.

## Out of scope

- **Do not change `presets.ts` in any way.** No weights, no tickers, no names, no descriptions, no
  ordering, no new preset.
- Do not delete or weaken the length assertion into something open-ended like `toBeGreaterThan(0)`.
  The point is that the number is pinned.
- Do not filter presets against the live Universe anywhere, in source or test. Contract 0070 ruled
  that out; a preset naming tickers the user does not hold is handled by the existing drop-and-report
  path.
- Do not add tests beyond repairing the three that fail. If you notice another gap, report it rather
  than filling it.
- No new dependency.

## Acceptance criteria

1. `cd frontend && npm run test` exits 0 with **55** tests. Report the count.
2. `grep -n "presetTickers" frontend/src/lib/presets.test.ts` prints nothing — the shared constant is
   gone, not merely unused.
3. `grep -c "tickersOf" frontend/src/lib/presets.test.ts` shows the helper defined once and used at
   least three times. Report the number.
4. `git diff --stat frontend/src/lib/presets.ts` prints nothing — **the presets themselves are
   untouched.** *(This file is committed as of `f8a81ce`, so an empty diff here is meaningful rather
   than an artefact of git state.)*
5. `grep -n "toHaveLength" frontend/src/lib/presets.test.ts` shows `2`.
6. A test still asserts, for **every** preset, that no `SeedRow.shares` is non-empty — now against
   that preset's own tickers so it actually reaches a seed. Confirm it passes for both.
7. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
8. `cd frontend && npm run build` exits 0.
9. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
10. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0 with **460** — unchanged.
11. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
12. **Add a third preset temporarily** — any two tickers, weights summing to 100 with a CASH row — run
    the suite, and confirm only the `toHaveLength` test fails. Then remove it and confirm the suite is
    green again. Paste both runs. This proves the per-preset derivation actually generalises rather
    than being hardcoded for these two, and it is the criterion that would have caught the original
    defect.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
grep -n "presetTickers" src/lib/presets.test.ts ; echo "shared-const grep exit: $?"
grep -c "tickersOf" src/lib/presets.test.ts
grep -n "toHaveLength" src/lib/presets.test.ts
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff --stat frontend/src/lib/presets.ts ; echo "presets-untouched exit: $?"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
```

For criterion 12, paste the temporary preset you added, both suite runs, and the `git diff` of
`presets.ts` afterwards showing it restored to exactly two presets.

## Tooltips

Not applicable — test file only.

## Human verification — does Gunnar need to run anything?

**Nothing to run for this contract.** No source or visible surface changes; a green suite is the whole
verification.

Two things from contract 0075 are still waiting on you, unrelated to this one:

1. **Click through the new analysis shell.** `/portfolios` → `Analysis` → the five tabs; reload on
   `/portfolios/<id>/risk` and confirm it returns to Risk & Perf with the right portfolio; a nonsense
   id should show the not-found card rather than a blank page.
2. **`BEC Portfolio` will drop tickers you do not hold.** Selecting it reports the skipped ones and
   routes their weight to cash. That is the CSV path working as designed — if you want the full
   allocation to land, add `VEA, SETM, XLK, CEG, GLD, XLP, XLV, MS` to your Universe first.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
