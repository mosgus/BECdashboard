# Report — Contract 0070 (Preset portfolios)

**Verdict: accepted.** `PARTIAL` was honest: both unmet criteria were planner errors, and the browser
walkthrough is Gunnar's step, not the coder's.

## Verified independently

`presets.ts` carries one preset, weights digit-for-digit as specified, every `shares` field empty.
`PRESETS` is `readonly`. 44 tests, `TSC OK`, clean build and lint, `npm ci` fine.

The wiring is right in the three places it could have gone wrong:

- **Pristine guard wraps both controls** (`NewPortfolioDialog.tsx:169`). Import and presets appear
  and disappear together, which is the point — offering a destructive control on a filled draft was
  the thing being avoided.
- **The handler does not touch `handleModeChange`.** `grep` shows it only at its definition and the
  two mode buttons. State goes through `applySeed` alone, so the preset's own numbers are never
  recomputed from an empty draft.
- **`event.target.value = ''` runs before the `ok` branch**, so re-selecting the same preset fires
  again. The same class of bug as the file-input reset in 0065, caught without being told.

Two things done well beyond the letter of the contract:

- The select carries `w-80 max-w-full`. `Tooltip` renders an `inline-flex` span that makes its child
  content-sized; the contract mentioned this and the coder acted on it rather than waiting to be
  bitten.
- `defaultValue=""` with a `disabled` placeholder option, so the control never displays a preset as
  "currently selected" when the draft has been edited since.

Criterion 5's dropped rows are exactly right — parsing against a `MU`/`VOO`-only universe drops
`ORCL`, `PBR`, `SHNY`, `XIACF` with their weights, which is the path a real user hits.

## Both unmet criteria were mine

**Criterion 7 was a malformed command.** I wrote
`grep -c "no-spinners" -r src/ | grep -v ":0" | wc -l`, which counts **files containing matches** (4),
not occurrences (8). The coder ran it, reported `4`, then ran the correct `grep -rn` and reported the
real count of 8 with the full listing — the right response to a criterion that does not measure what
it claims. Contract 0066 is untouched. The correct form is `grep -rn "no-spinners" src/ | wc -l`.

**Criterion 15 was the git-state error again**, written in the same turn as 0069's and before that
lesson was recorded. `git diff AddPositionForm.tsx` is empty because Gunnar committed the file; the
guard is alive at line 57. Already fixed in `agent_prompts/planner-opus.md`: **never use git to assert
a line exists — use `grep`.**

That is six planner criterion errors across this feature — four git-state, one numeric, one malformed
command. Every one produced a false failure on correct work. The coders caught all six.

## One real defect, not worth a rejection

The non-pristine fallback still reads *"Reopen this dialog to import a CSV."* It now stands in for
**two** controls, so it under-describes what was withdrawn. A user who typed a name and then looked
for the preset list is told about CSV import and nothing else.

One string. Folded into the next contract rather than bounced back — the contract specified that
sentence verbatim, so shipping it was compliance, not oversight.

## Status

Accepted and archived. The preset flow is built; only Gunnar's browser walkthrough remains.
