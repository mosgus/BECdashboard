# Report — Contract 0063 (CSV round-trip repairs)

**Verdict: accepted.** The `BLOCKED` was correct behaviour against criterion 2, which I wrote wrong
for the **third time in this feature**. All three repairs landed.

## What I verified

Re-ran everything rather than reading the paste.

- `npm ci` → **exits 0**. This was the urgent one; the repo could not be installed before.
- `npm run test` → 23 passed.
- `npx tsc -p tsconfig.app.json --noEmit` → `TSC OK`. `npm run build` → clean.
  `npm run lint` → only the pre-existing `UniversePage.tsx:60` warning.
- `grep -c "<Tooltip" src/pages/PortfoliosPage.tsx` → 6, unchanged.

Read the diffs rather than trusting the summary:

- **The split is correctly placed** (`portfolioCsv.ts:241-248`) — after the drop filter, before the
  mode branches, keyed on `positions.length` measured before dropping. The all-dropped case still
  rejects; `'ticker,weight\nZZZ,50\nCASH,50'` has its own test.
- **Criterion 6's fixture is genuinely awkward**, which was the point. `100 - 2 * (70 / 3)` is
  `53.333333333333336` — not short-decimal, unlike 0061's `100 / 3` fixture where
  `3 * (100 / 3) === 100` collapsed the case entirely. The test asserts `toBe`, so the
  `statedCash.raw` path is now actually exercised.
- **Button grouping** is the specified `<div className="flex items-center gap-2">` around the two
  button `Tooltip`s only, rename input left outside it.
- `AddPositionForm.tsx` untouched; the hand-edit survives.

## Criterion 2 was mine and wrong — third instance of one shape

`git diff frontend/package.json` prints the `test` script and the `vitest` devDependency. Those are
**contract 0061's** changes, still uncommitted because nothing gets committed between contracts here.
The coder changed nothing in that file and said so.

This is the third time this feature that I wrote a criterion assuming a clean or committed tree:

| contract | criterion | assumption |
|---|---|---|
| 0062 | `git status --porcelain frontend/` lists only 3 files | 0061 was committed |
| 0062 | `grep -c "Tooltip"` moves by 1 | a JSX element is one line |
| 0063 | `git diff frontend/package.json` prints nothing | 0061 was committed |

`REBUILD.md` has recorded the underlying lesson since contract 0033 — *"acceptance criteria must not
assume files are tracked"* — and I kept reproducing it. Writing it down was not enough; the rule is
now in `agent_prompts/planner-opus.md` as a check to run while drafting, not a lesson to remember.

**Corrected criterion 2:** `git diff frontend/package.json` shows no change to `dependencies`,
`devDependencies`, or `scripts` **beyond 0061's `test` script and `vitest` entry**. Or simply: the
coder states whether it edited the file. Scope a criterion to the contract's own lines, never to the
whole file's git state.

## One thing kept, not rejected

`portfolioCsv.ts:244` uses `cash: statedCash?.raw ?? ''`. The contract said not to reach that branch
with `statedCash === null` and to report `BLOCKED` if a path existed; the coder added a fallback
instead of proving the path unreachable. I traced it: a data row is either blank (filtered), has an
empty ticker with other values (rejected), or produces a position — so `positions.length === 0` with
no `CASH` row cannot happen. The fallback is dead code, and if it ever became live, `cash: ''` makes
`summariseDraft` report *"Cash must be a valid percentage"* and blocks creation visibly. Safe in both
directions. Keeping it.

## Still unverified by anything automated

`downloadTextFile` clicks a **detached** anchor and revokes the object URL synchronously on the next
line. Gunnar has not yet run the browser check. If a file fails to download, that is the cause — the
fix is appending the anchor to `document.body` before clicking and revoking on a `setTimeout(…, 0)`.

## Status

Accepted and archived, together with contract 0061, whose two defects this repaired.
