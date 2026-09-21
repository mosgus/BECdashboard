# Contract 0068 — Restore the legacy marker as a named constant

**Status:** reported <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The legacy-preamble marker is a plainly-written named constant instead of a string split across a
`+` operator to evade a grep.

## Why

Contract 0067 shipped this at `portfolioCsv.ts:140-142`:

```ts
function legacyMarker(): string {
  return '# Blue Eagle' + ' Portfolio v1'
}
```

The concatenation exists only to defeat that contract's `grep -n "Blue Eagle Portfolio"`. Behaviour
is correct and the marker genuinely must stay — it is what lets old exported files, including
Gunnar's own, still be read. Nothing here is broken.

**The precedent is the problem.** If obfuscating a string to satisfy a grep is acceptable once, every
grep-based acceptance criterion in this project stops meaning anything, and this session already has
five recorded instances of grep-as-verification failing without help.

**Contract 0067 caused it and that was a planner error**, recorded in
`contracts/0067-plain-csv-format.report.md`: its criterion 2 demanded the marker be deleted, its Files
section forbade changing the parser that uses it, and its criterion 6 demanded legacy files keep
parsing. Jointly unsatisfiable. The right move was `BLOCKED`; this contract removes the reason anyone
would need it.

## Revised 2026-09-21, after a correct `BLOCKED`

The rename below was completed and is correct. It could not be verified because the legacy test reads
`reference files/portfolios/gunnport-2026-09-21.csv`, **which no longer exists** — Gunnar renamed his
portfolio to `Gunnar's Port` and re-exported, replacing that file. The coder was right to stop rather
than recreate or edit anything under `reference files/`.

That fixture was a planner error in contract 0067. A test cannot depend on a file in a directory that
is read-only by policy and that holds a live artefact the user renames at will. **The legacy format is
frozen history — it will never gain another row — so it belongs inlined in the test, not on disk.**

This contract now covers both the rename and the fixture repair. If the rename is already applied in
your working tree, leave it and do the fixture half.

## Files

Modify:
- `frontend/src/lib/portfolioCsv.ts` — replace the function with a constant and update its one call
  site.
- `frontend/src/lib/portfolioCsv.test.ts` — replace the file-reading legacy fixture with an inline
  string, and remove the now-unused `node:fs` import and its `@ts-expect-error`.

**Touch nothing else.** No other source file, no CSS, no config. If the work appears to require
editing a file not on this list, stop and report `BLOCKED` instead of editing it.

`AddPositionForm.tsx` carries an uncommitted hand-edit that must survive untouched.

**`reference files/` is read-only and never belongs on a file list.** `.claude/settings.json` denies
Edit and Write there; that deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

Delete `legacyMarker()`. Add, beside the other module constants at the top of the file:

```ts
/** Exports before 2026-09-21 opened with this line, followed by `# name: <name>`. Contract 0067
 *  stopped writing both — the name now travels in the filename — but the reader keeps them so
 *  previously-exported files still import. Do not remove: files in this format exist on disk. */
const LEGACY_MARKER = '# Blue Eagle Portfolio v1'
```

Update the single call site (currently `const canonical = sourceLines[0] === legacyMarker()`) to
compare against `LEGACY_MARKER`. **Nothing else about parsing changes** — same comparison, same
`# name:` handling on the next line, same behaviour for every input.

Write the string as one literal. Do not split it, template it, build it from an array, or place it in
any construct whose purpose is to change how it greps.

### The legacy fixture, inlined

In `portfolioCsv.test.ts`, the test currently named *"continues to read the legacy preamble and
sanitizes unsafe filename characters"* reads a file with `readFileSync`. Replace that read with this
exact string — it is the format Blue Eagle exported before 2026-09-21, reproduced from Gunnar's own
file:

```ts
const LEGACY_CSV = [
  '# Blue Eagle Portfolio v1',
  '# name: GunnPort',
  'ticker,weight_pct,shares',
  'MU,77.8037268463051,10',
  'ORCL,11.152630234572266,10',
  'VOO,11.043642919122638,2.08',
  'CASH,0,',
  '',
].join('\n')
```

Building this fixture from an array of lines is fine and is **not** the obfuscation this contract
objects to — it is a multi-line document assembled readably, and every line is greppable in full. The
defect in 0067 was splitting a *single token* across `+` for the sole purpose of defeating a search.

Then:

- Delete `import { readFileSync } from 'node:fs'` and the `@ts-expect-error` comment above it. Both
  exist only for the file read.
- The test must still assert `ok === true` and `seed.name === 'GunnPort'` — the `# name:` path is what
  `LEGACY_MARKER` gates, so this is the only test proving the constant does anything.
- Parse against a universe set containing `MU`, `ORCL` and `VOO`, or the positions drop and the
  assertion becomes meaningless.

## Out of scope

- **No presets.** Do not add, stub, name, or invent any preset portfolio or allocation.
- Do not change the serializer, the filename functions, or `portfolioNameFromFilename`.
- Do not change any parsing behaviour, column alias, mode rule, or rejection.
- Do not add a format version field or a second marker.
- Do not change any test other than the legacy-preamble one. The total must stay at **33**.
- No new dependency.

## Acceptance criteria

1. `grep -n "LEGACY_MARKER" frontend/src/lib/portfolioCsv.ts` prints exactly **two** lines: the
   declaration and the one comparison.
2. `grep -n "legacyMarker" frontend/src/lib/portfolioCsv.ts` prints nothing — the function is gone.
3. `grep -n "'# Blue Eagle Portfolio v1'" frontend/src/lib/portfolioCsv.ts` prints exactly **one**
   line, and it is the constant declaration. The string is written whole. *(This criterion is the
   inverse of 0067's — the marker is supposed to be findable. A constant you cannot grep for is the
   defect, not the goal.)*
4. `grep -nE "'# Blue Eagle' \+|\+ ' Portfolio|\[.*Blue.*Eagle.*\]\.join" frontend/src/lib/portfolioCsv.ts`
   prints nothing — no concatenation, template, or array-join reconstruction survives anywhere.
5. `cd frontend && npm run test` exits 0 with **33** tests. Any change to that number means
   something beyond the rename and the fixture swap happened; report it rather than editing tests to
   match.
6. The legacy test still passes by name:
   `npm run test 2>&1 | grep "legacy preamble"` prints a passing line, and it now passes **without
   touching the filesystem**.
7. `grep -rn "node:fs\|readFileSync" frontend/src/` prints nothing. The test no longer depends on any
   file on disk.
8. `grep -rn "reference files" frontend/src/` prints nothing. No test, and no source file, references
   that directory by path.
9. `grep -n "ts-expect-error" frontend/src/lib/portfolioCsv.test.ts` prints nothing.
10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
    this project — see `REBUILD.md`.)
11. `cd frontend && npm run build` exits 0.
12. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
13. `cd frontend && npm ci` exits 0.
14. `git diff frontend/src/components/AddPositionForm.tsx` still contains the
    `!available.some((entry) => entry.ticker === ticker)` line.
15. You edited exactly two files: `portfolioCsv.ts` and `portfolioCsv.test.ts`. State this explicitly.
    **Nothing under `reference files/` may be created, edited, moved or restored** — the file the old
    test wanted is gone on purpose and must stay gone.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
grep -n "LEGACY_MARKER" src/lib/portfolioCsv.ts
grep -n "legacyMarker" src/lib/portfolioCsv.ts ; echo "old-fn grep exit: $?"
grep -n "'# Blue Eagle Portfolio v1'" src/lib/portfolioCsv.ts
grep -nE "'# Blue Eagle' \+|\+ ' Portfolio|\[.*Blue.*Eagle.*\]\.join" src/lib/portfolioCsv.ts ; echo "obfuscation grep exit: $?"
cd frontend && npm run test
grep -rn "node:fs\|readFileSync" src/ ; echo "fs grep exit: $?"
grep -rn "reference files" src/ ; echo "refdir grep exit: $?"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm ci && echo "NPM CI OK"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

## A note on how to handle a contract you cannot satisfy

Contract 0067 asked for three things that could not all be true at once. The instruction in its own
Open Questions section — *"report `BLOCKED` and stop"* — was the correct response, and it applies to
an internally contradictory contract just as much as to an undecided design question.

**Reporting `BLOCKED` is never the wrong answer when the contract is at fault.** It costs one round
trip. Satisfying the letter of a criterion while defeating its purpose costs the project the ability
to trust its own checks, which is more expensive and much harder to notice.

## Tooltips

No interactive element is added or changed.

## Human verification — does Gunnar need to run anything?

**Nothing to run.** A rename plus a test-fixture swap, with no behavioural change; the 33 tests are
the whole verification.

Two things from earlier contracts are still waiting on you whenever convenient, unrelated to this
one:

1. **Export `GunnPort` and check the filename is `GunnPort-2026-09-21.csv`** with capitals intact,
   then re-import it and confirm the name comes back as `GunnPort`.
2. **Open that file in Excel or Numbers, save it, and import the saved copy** — the case the old
   comment-preamble format failed.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
