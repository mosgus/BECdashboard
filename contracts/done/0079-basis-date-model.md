# Contract 0079 — `basisDate` on the portfolio model, round-tripping through CSV

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

A portfolio can carry an optional `basisDate`, it survives `localStorage` and a CSV round trip, and
nothing in the app yet displays it.

## Why

Gunnar's idea and call, 2026-09-22: instead of a manually-entered cost basis, the user names **one
date per portfolio** and the app reports return since that date's close — **percentage only, never
dollars**. See `REBUILD.md`, "A basis date replaces cost basis."

**This is a custom return window, not a cost basis.** Same bars and the same `pct_return` as
5D/30D/YTD with a user-chosen anchor. Nothing here computes anything: this contract is the data
plumbing only, so the model change is auditable on its own before any UI or endpoint depends on it.

The other two pieces, deliberately separate:

- **0080** — backend: a `since` parameter on `GET /universe/returns`. No file overlap with this
  contract; the two can run at the same time.
- **0081** — UI: the date input and the `Since` column. Written after both land.

**The CSV gets a fourth column, `basis_date`, populated only on the reserved `CASH` row.** Gunnar's
call, 2026-09-22. Portfolio-level metadata has no natural home in a flat table — the same problem
that sent the portfolio *name* into the filename in contract 0067, where he preferred the plainer
file. A date is different: it cannot be recovered from a filename, so not round-tripping it is real
data loss on the one path that exists to prevent data loss.

## Files

Modify:
- `frontend/src/lib/portfolio.ts` — `basisDate` on `Portfolio`, on `DraftSeed`, and validation.
- `frontend/src/lib/portfolioCsv.ts` — serialize and parse the fourth column.
- `frontend/src/lib/portfolioStore.ts` — accept and preserve it on read and write.
- `frontend/src/lib/portfolio.test.ts`, `portfolioCsv.test.ts`, `portfolioStore.test.ts` — tests below.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**No component, no page, no backend file.** If a type change forces a component edit to keep `tsc`
green, report `BLOCKED` and say which — the field is optional precisely so that does not happen.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

### Model

```ts
export interface Portfolio {
  id: string
  name: string
  cashWeight: number
  positions: Position[]
  updatedAt: string
  /** ISO `YYYY-MM-DD`. The anchor for "return since" — a comparison date the user chose, not a
   *  purchase date and not a cost basis. Absent means no anchor is set. */
  basisDate?: string
}
```

`DraftSeed` gains the same optional field, so a parsed CSV can carry it to the composer. Contract 0081
wires `applySeed`; **do not touch `NewPortfolioDialog` here.**

**Validation — `YYYY-MM-DD` only.** A helper, used by both the store and the parser:

```ts
/** True for a well-formed `YYYY-MM-DD` that names a real calendar day. */
export function isValidBasisDate(value: unknown): value is string
```

It must reject `2026-02-30` and `2026-13-01`, not merely match the shape — construct the date and
confirm it round-trips to the same string. A regex alone accepts impossible days, and this value
later becomes a query parameter the backend will trust.

Do **not** validate that the date is in the past, a trading day, or within stored history. A Saturday
or a pre-IPO date is a *returns* question, answered in 0080 by returning `null`, not a reason to
refuse to store what the user typed.

### Storage

- `isValidCurrentPortfolio` accepts `basisDate` absent, or present and passing `isValidBasisDate`.
  **A present-but-malformed `basisDate` makes the record invalid** — the same strictness the other
  fields get.
- `savePortfolio` preserves it. Note its existing `stamped` object lists fields explicitly rather than
  spreading; add `basisDate` there or it is silently dropped on every save.
- No normalisation on read. Unlike the cash epsilon in 0071, there is no near-miss to repair — a date
  is either well-formed or it is not.

### CSV

Header becomes `ticker,weight_pct,shares,basis_date`.

**Serializer** — emit the fourth column always, empty on position rows, and on the `CASH` row emit
`portfolio.basisDate` or empty:

```
ticker,weight_pct,shares,basis_date
MU,73.40490607218531,,
ORCL,10.481994524396962,,
CASH,0,,2026-01-02
```

**Parser** — `basis_date` joins the alias table as its own optional column, matched case-insensitively
like the others. Read the value **from the `CASH` row only**; ignore it anywhere else rather than
erroring, since an external file may coincidentally carry such a column.

- Absent column, or empty value → `seed.basisDate` is `undefined`.
- Present and valid → `seed.basisDate` is the value.
- **Present and malformed → reject the whole file**, message
  `basis_date must be a date in YYYY-MM-DD form`, with the `CASH` row's line number. Silently
  dropping a date the user typed is the class of failure this project keeps writing contracts about.

**Backward compatibility is the load-bearing requirement.** Every file exported before today has three
columns, and Gunnar has several on disk. A three-column file must parse exactly as it does now.

## Out of scope

- **No UI.** No date input, no `Since` column, no `NewPortfolioDialog` change, no `PortfoliosPage`
  change. 0081.
- **No backend.** No `since` parameter, no endpoint change. 0080.
- **No computation.** Nothing here derives a return, reads a bar, or calls an endpoint.
- Do not add `basisDate` to `Position`. Per-portfolio was decided; per-position was declined.
- Do not add a default value. Absent is a real state and means "no anchor set".
- Do not reintroduce a comment preamble to the CSV. Contract 0067 removed it deliberately.
- Do not change how weights, shares or cash are parsed or written.
- No new dependency.

## Acceptance criteria

1. A test round-trips a portfolio **with** a `basisDate` through
   `serializePortfolioCsv` → `parsePortfolioCsv` and asserts `seed.basisDate` is the same string.
2. A test round-trips a portfolio **without** one and asserts `seed.basisDate` is `undefined` — not
   `''`, not `null`.
3. **A test parses a three-column file with no `basis_date` header at all** and asserts it succeeds
   with the same weights and cash as today. This is the backward-compatibility guard and the criterion
   most likely to be quietly skipped.
4. A test asserts a `CASH` row carrying `2026-02-30` **rejects the file**, with the `CASH` row's line
   number in `result.line`.
5. A test asserts `isValidBasisDate` rejects `2026-02-30`, `2026-13-01`, `26-01-02`, `2026-1-2`,
   `''`, and a non-string; and accepts `2026-01-02` and `2029-02-29`'s valid leap-year sibling
   `2028-02-29`.
6. A test asserts a `basis_date` value on a **position** row is ignored rather than read or rejected.
7. A test asserts `savePortfolio` then `listPortfolios` preserves `basisDate` — the guard against the
   explicit-field `stamped` object dropping it.
8. A test asserts a stored portfolio whose `basisDate` is `"nonsense"` is **rejected** by
   `listPortfolios`, and that one with no `basisDate` key is **accepted**.
9. `cd frontend && npm run test` exits 0. Report the count; it was **55**.
10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
    this project — see `REBUILD.md`.)
11. `cd frontend && npm run build` exits 0.
12. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
13. `grep -rn "basisDate\|basis_date" frontend/src/components/ frontend/src/pages/` prints nothing —
    no UI file was touched.
14. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count rather
    than matching a number; contract 0080 may land in parallel and change it.
15. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
16. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -rn "basisDate\|basis_date" frontend/src/components/ frontend/src/pages/ ; echo "no-ui grep exit: $?"
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
```

Also paste `serializePortfolioCsv` output for a portfolio with a `basisDate` and one without.

## Tooltips

Not applicable — no interactive element.

## Human verification — does Gunnar need to run anything?

**One thing, and it is worth doing before 0081 builds on this.**

Nothing visible changes, but the export format does. After this lands:

1. Export any portfolio from `/portfolios` and open it in a text editor. The header must read
   `ticker,weight_pct,shares,basis_date` and the `CASH` row must end with an empty fourth field.
2. **Re-import one of your older three-column exports** — the ones already in
   `reference files/portfolios/`. They must still import cleanly. That is criterion 3 proven against
   a real file rather than a fixture.

If either looks wrong, stop before running 0081 — it assumes this format.

## Open questions — do not resolve these yourself

None. Per-portfolio, percentage-only, and the `CASH`-row column were all decided by Gunnar on
2026-09-22. If you find another, report `BLOCKED` and stop.
