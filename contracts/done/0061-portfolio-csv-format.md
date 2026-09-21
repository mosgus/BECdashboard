# Contract 0061 — Canonical portfolio CSV: pure parser, serializer, and frontend test harness

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

A pure `frontend/src/lib/portfolioCsv.ts` that serializes a `Portfolio` to a canonical Blue Eagle
CSV and parses both that format and simple external holdings files into a draft seed — plus the
first frontend test infrastructure in this repo (`vitest`), covering it.

## Why

Portfolios live in `localStorage` (see `REBUILD.md`, "Portfolio persistence: browser `localStorage`,
behind an interface"), which means they are tied to one browser on one machine and CSV export is the
only backup story. That story was named when the decision was made and never built.

This contract is the pure half only. No UI, no file input, no download button — those are contracts
0062 and 0063. The split exists because a parser doing weight arithmetic, duplicate detection and
quoting is exactly the "math or data transformation" case where a wrong answer looks entirely
plausible, and it earns its own audit rather than being the third thing checked behind a dialog diff.

**Do not port `main:backend/routers/_portfolio_helpers.py`.** It was read before this contract was
written. It sniffs four formats and decides whether `0.25` means 25% or 0.25% **by magnitude**, which
is a guess the file cannot support. The format below declares its units instead.

## Files

Create:
- `frontend/src/lib/portfolioCsv.ts` — the pure serializer and parser. No React, no DOM, no clock.
- `frontend/src/lib/portfolioCsv.test.ts` — vitest suite for the above.

Modify:
- `frontend/package.json` — add `vitest` to `devDependencies`, add `"test": "vitest run"` to scripts.
- `frontend/vite.config.ts` — add the vitest `test` block (`environment: 'node'`, `include` scoped to
  `src/lib/**/*.test.ts`).

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`frontend/src/components/AddPositionForm.tsx` has an uncommitted hand-edit in the working tree.**
Do not revert, reformat, or touch that file. Run `git status --porcelain frontend/` before you start
and again at the end; the same modification must still be present and unchanged.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

## The canonical format

```
# Blue Eagle Portfolio v1
# name: Core Equity
ticker,weight_pct,shares
AAPL,25,10
MSFT,25,
CASH,50,
```

- Line 1 is the exact literal `# Blue Eagle Portfolio v1`. Its presence is what identifies a
  canonical file; nothing else about parsing branches on it.
- Line 2 is `# name: ` followed by the portfolio name, verbatim, trimmed on read.
- `weight_pct` is **always percent units**. `25` means 25%. There is no fraction interpretation and
  no magnitude heuristic — a file of `0.25`s parses to 0.25% each and lands ~99% in cash, which the
  user sees on the draft and can fix. That is the honest outcome; guessing is not.
- `shares` is optional per row and empty when absent. It is metadata, never the source of allocation
  truth (`REBUILD.md`, "Position model: saved weights are the truth").
- `CASH` is a **reserved ticker**, case-insensitive, carrying the portfolio's cash weight. At most
  one such row. Accepted limit: Pathward Financial genuinely trades as `CASH`; it is not in the
  Universe and the Universe is the gate, so the collision is unreachable today. Write it down rather
  than working around it.

Numbers are written with `String(value)`, **not** `toFixed`. JavaScript's number-to-string is the
shortest round-trippable form, so a hand-typed `25` stays `25` and only a genuinely irrational weight
(`100/3`) prints long. `toFixed(4)` would silently break exact round-tripping, which is the point of
the format.

## External files

A file whose first line is not the canonical marker is an external holdings file. Skip any leading
`#` lines, find the first row that parses as a header, and match columns case-insensitively with
leading/trailing whitespace trimmed:

| field | accepted header names |
|---|---|
| ticker | `ticker`, `symbol` |
| weight | `weight_pct`, `weight` |
| shares | `shares`, `quantity`, `qty` |

That alias set is deliberately small. Do not add exchange-suffix stripping, security-description
parsing, market-value columns, or time-series column detection — all of those are the reference
importer and all are out of scope.

**Mode selection, in this order:**

1. A weight column is present → `mode: 'weight'`. Shares, if also present, are carried as optional
   metadata on each row. This is not the "mixed flows" case `REBUILD.md` forbids — that rule is about
   *entering* shares and a target weight as two independent inputs. Here weight simply wins and shares
   ride along, which is the position model restated.
2. No weight column, shares column present → `mode: 'shares'`, `cash: ''`. `summariseDraft` treats
   empty cash as `$0` and derives weights from shares × price, blocking creation for any row without
   a usable price. That existing behaviour is the "derive weights only when usable prices exist"
   requirement; do not build a second validation path for it.
3. Neither → equal weight. Each surviving row gets `String(100 / n)`, `cash: '0'`, `mode: 'weight'`.

## Cash, remainder, and dropped rows

**Cash is stated-or-derived, never recomputed over a stated value.**

- File contains a `CASH` row → that stated weight is used as-is. Round-tripping a portfolio whose
  weights are `100/3` depends on this: recomputing `100 - Σ` is not guaranteed bit-identical to the
  value that was written, and the round-trip is required to be exact.
- File contains no `CASH` row → cash is `100 - Σweights`, the derivation `addPositionUsingCash` and
  `migrateLegacyPortfolio` already use.

**Validate the whole file first, then drop rows.** A duplicate ticker among rows that would have been
dropped must still fail the file. Ordering matters and the tests pin it.

**Dropped rows** are tickers absent from the supplied universe set. The two seeding modes handle the
orphaned allocation differently, and the asymmetry is deliberate:

- **Weighted file** (modes 1 and 2): the dropped row's weight goes to **cash**. The file asserted an
  allocation; spreading the orphan across the survivors would be the silent normalization this
  feature exists to avoid.
- **Ticker-only file** (mode 3): equal weight is computed over the **survivors**, cash `0`. There was
  no allocation in the file to preserve, so equal-weighting the remainder is what a person would do
  by hand.

`CASH` is resolved as the reserved row **before** the universe check and is never a dropped row.

## Whole-file rejections

Each returns `{ ok: false, error, line }` with a message a user can act on. `line` is the 1-indexed
source line where known, `null` otherwise.

1. Empty input, or input over 1 MB, or more than 5000 data rows.
2. No header row found, or a header row with no recognised ticker column.
3. Zero data rows after skipping blank lines.
4. A duplicate ticker (compared uppercase, after trimming), including a duplicate `CASH`.
5. A weight cell that is present and non-empty but not a finite number `> 0`.
6. A shares cell that is present and non-empty but not a finite number `> 0`.
7. `Σ` of all position weights plus a stated cash weight exceeding `100.01`. Computed on the file's
   own rows, before any drop.
8. A stated `CASH` row where the file's total is not `100 ± 0.01`. A file that states its cash and
   does not add up is malformed, not a remainder case.
9. An empty ticker cell on a row that has any other non-empty cell.
10. Every row dropped as off-universe (nothing left to seed).

Rejections are whole-file. Never partially import past one of these.

## Interface

```ts
import type { EntryMode, Portfolio } from './portfolio'

/** A row of the New Portfolio composer, before the dialog assigns React keys.
 *  All fields are the raw text the composer's inputs hold. */
export interface SeedRow {
  ticker: string
  shares: string
  weight: string
}

/** Exactly summariseDraft()'s input, minus the per-row ids. This is the seam a future
 *  preset catalog populates — a preset returns a DraftSeed and nothing else changes. */
export interface DraftSeed {
  name: string
  mode: EntryMode
  cash: string
  rows: SeedRow[]
}

export interface DroppedRow {
  ticker: string
  /** The weight the file stated for this row, in percent units; null for a ticker-only file. */
  weightPct: number | null
}

export type CsvImportResult =
  | { ok: true; seed: DraftSeed; dropped: DroppedRow[] }
  | { ok: false; error: string; line: number | null }

/** Pure. `universeTickers` is the membership gate; nothing else is read from the Universe. */
export function parsePortfolioCsv(text: string, universeTickers: ReadonlySet<string>): CsvImportResult

/** Pure. Emits the canonical format above, LF-terminated, with a trailing newline. */
export function serializePortfolioCsv(portfolio: Portfolio): string

/** Pure — `now` is an argument, per REBUILD.md's rule for every lib/ function.
 *  Shape: `<slugified name>-YYYY-MM-DD.csv`, falling back to `portfolio` for a name that
 *  slugifies to empty. */
export function portfolioCsvFilename(portfolio: Portfolio, now: Date): string
```

`parsePortfolioCsv` emits no ids and calls no `crypto.randomUUID()` — the dialog assigns those in
0063. That is what keeps this module pure and its round-trip test able to compare by value.

### Parsing details that must be handled

- Strip a leading UTF-8 BOM (`﻿`). Excel writes one and it silently corrupts the first header
  name into `﻿ticker`, which then fails header detection for a file that looks fine.
- Accept `\r\n`, `\n`, and a trailing newline or its absence.
- RFC 4180 quoting: double-quoted fields, embedded commas, and `""` as an escaped quote. Portfolio
  names and broker security descriptions both contain commas.
- Skip fully-blank lines anywhere, including between data rows.
- Uppercase and trim every ticker.

## Out of scope

- **No UI of any kind.** No file input, no download anchor, no dialog changes, no button. 0062 adds
  export to `PortfoliosPage`; 0063 adds import to `NewPortfolioDialog`.
- **No presets.** Do not invent, seed, or stub any named portfolio or allocation. `DraftSeed` is the
  only forward accommodation this contract makes for them.
- **No backend.** No route, no server persistence, no Python file touched.
- **No runtime dependency.** `papaparse` and equivalents are not authorized; the format is ours and
  the quoting rules above are ~40 lines. `vitest` is a **dev** dependency and is the only one added.
- Do not modify `lib/portfolio.ts`, `lib/portfolioStore.ts`, or any component.
- Do not add component tests or a DOM test environment. `environment: 'node'`, `src/lib/**` only.
  `REBUILD.md`'s "UI unit tests are skipped deliberately" still stands.
- Do not add a fraction-vs-percent confirmation prompt. Considered and deliberately omitted; the
  99%-cash outcome is visible and correctable, and a prompt is UI that belongs in 0063 if it is
  wanted at all.

## Acceptance criteria

1. `cd frontend && npm run test` exits 0, and its output names at least one test per numbered
   rejection in "Whole-file rejections" above (10 tests minimum in that group).
2. A round-trip test constructs a `Portfolio` whose three position weights are each `100 / 3` and
   whose `cashWeight` is `100 - 3 * (100 / 3)`, serializes it, parses the result against a universe
   set containing those tickers, feeds the seed through `summariseDraft` from `lib/portfolio.ts`, and
   asserts the reconstructed name, `cashWeight`, and every position weight are **strictly equal**
   (`===`, not `toBeCloseTo`) to the original. This is the criterion that fails if anyone reaches for
   `toFixed`.
3. A round-trip test covers a portfolio with an optional `shares` value on one position and none on
   another, and asserts both survive.
4. A test asserts a portfolio name containing a comma round-trips.
5. A test parses input prefixed with `﻿` and succeeds; the same test asserts the un-prefixed
   input produces an identical result.
6. A test parses a CRLF-terminated file and asserts the result equals the LF version's.
7. Three seeding tests, one per mode: ticker-only → every weight `String(100 / n)` and `cash === '0'`;
   ticker+weight → weights preserved verbatim as written and `cash` equal to the remainder;
   ticker+shares → `mode === 'shares'`, `cash === ''`, every `SeedRow.weight === ''`.
8. A drop test on a **weighted** file asserts the dropped row's weight is added to `cash` and that
   `dropped` names the ticker with its `weightPct`.
9. A drop test on a **ticker-only** file asserts the survivors are equal-weighted over the survivor
   count (not the file's row count) and `cash === '0'`.
10. A test asserts a file containing a duplicate ticker **among rows that would be dropped as
    off-universe** is still rejected — proving validation runs before dropping.
11. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
    this project and is not a substitute — see `REBUILD.md`.)
12. `cd frontend && npm run build` exits 0.
13. `cd frontend && npm run lint` exits 0.
14. `grep -n "toFixed" frontend/src/lib/portfolioCsv.ts` prints nothing.
15. `grep -rn "papaparse\|csv-parse\|d3-dsv" frontend/package.json` prints nothing.
16. `git status --porcelain frontend/src/components/AddPositionForm.tsx` still prints exactly
    ` M frontend/src/components/AddPositionForm.tsx`, and `git diff frontend/src/components/AddPositionForm.tsx`
    still shows the single added `!available.some(...)` line and nothing else.
17. The production bundle does not grow: report `npm run build`'s reported gzip size for the main
    chunk before and after. `vitest` is a dev dependency and must not appear in the bundle.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
grep -n "toFixed" src/lib/portfolioCsv.ts; echo "toFixed exit: $?"
grep -rn "papaparse\|csv-parse\|d3-dsv" package.json; echo "dep grep exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

Also report: the exact `vitest` version npm resolved, and whether the `test` block went into
`vite.config.ts` or required a separate `vitest.config.ts` (either is acceptable — say which and
why).

## Tooltips

Not applicable. This contract adds no clickable or focusable element.

## Human verification — does Gunnar need to run anything?

**Nothing to run.** This contract has no visible surface. The suite and the audit are the whole
verification. The first thing Gunnar will see is contract 0062's export button.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop; a plausible guess here gets silently absorbed into
the format, and the format is the thing that has to keep working across devices and future sessions.
