# Report — Contract 0062 (Export a portfolio as CSV)

**Verdict: accepted.** The `BLOCKED` outcome was correct behaviour against two acceptance criteria I
wrote wrong. The code is right.

## What was claimed

Haiku reported `BLOCKED`, citing criterion 8 (`git status --porcelain frontend/` must list only three
files) as unsatisfiable while 0061's files sit uncommitted in the tree, and reported criterion 7's
tooltip count as 11 → 13 rather than the specified +1.

## What I found

Re-ran every command. `npx tsc -p tsconfig.app.json --noEmit` → `TSC OK`. `npm run build` → clean,
`334.44 kB / 100.41 kB gzip`. `npm run lint` → only the pre-existing `UniversePage.tsx:60` warning.
`npm run test` → 20 passed.

Read `src/pages/PortfoliosPage.tsx:238-251` and `src/lib/download.ts`. The implementation matches the
contract's specified JSX essentially byte-for-byte: correct tooltip copy, correct classes, placed
inside the `valued && current ?` branch immediately before `Delete portfolio`, `new Date()` read at
the call site so `portfolioCsvFilename` stays pure. `revokeObjectURL` is present at
`download.ts:9`. No legacy-branch export, no bulk export, no backend route, no new dependency.

**Both failing criteria were planner errors, and both are recorded failure shapes in `REBUILD.md`:**

1. **Criterion 7 — `grep -c "Tooltip"` counts lines, not elements.** A `<Tooltip>` wrapper contributes
   an opening and a closing line, so the count moves by two. This is the **fourth** recorded instance
   of "grepping for a keyword is not verifying a construct," and the third in the
   flagged-correct-work-as-broken direction. An element count needs `grep -c "<Tooltip"`.
2. **Criterion 8 assumed 0061 was committed.** Nothing is committed between contracts in this project
   — Gunnar commits, and he had not. `REBUILD.md` already records this for contract 0033
   (*"acceptance criteria must not assume files are tracked"*) and I reproduced it anyway, in a
   contract I wrote the same afternoon as the one that named the lesson.

The coder was right to stop rather than delete another contract's files to make a criterion pass.
That is the behaviour the role file asks for and it worked.

## Corrected criteria

- **7.** `grep -c "<Tooltip" frontend/src/pages/PortfoliosPage.tsx` is exactly one greater than before.
- **8.** `git status --porcelain frontend/src/pages/PortfoliosPage.tsx frontend/src/lib/download.ts`
  lists exactly those two paths. Scope the check to the contract's own files; the tree legitimately
  carries other uncommitted work.

Both now hold against what shipped.

## One thing for Gunnar's eyes, not a rejection

That header row is `flex flex-wrap items-center justify-between`. With two children it put the rename
input left and `Delete portfolio` right. With three, `justify-between` spreads them evenly, so
**`Export CSV` lands in the middle of the row with gaps on both sides** rather than sitting next to
Delete. That is what the contract specified and it is not a defect in the work — but it is probably
not what you want to look at. Wrapping the two buttons in a `<div className="flex gap-2">` is the
one-line fix and belongs in the same pass as the other repairs, not in a contract of its own.

Also unverified by anything automated: `downloadTextFile` clicks a **detached** anchor and revokes the
object URL synchronously on the next line. Both are the common idiom and both work in Chrome; a
detached-anchor click was historically a no-op in Firefox, and a synchronous revoke can race the
download. The human-verification step covers it — actually click the button and confirm a file lands.

## Status

Accepted and archived. The export surface is done; the repairs in 0063 do not touch it.
