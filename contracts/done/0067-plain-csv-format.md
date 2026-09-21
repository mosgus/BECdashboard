# Contract 0067 — Export a plain CSV; carry the portfolio name in the filename

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

An exported portfolio is an ordinary four-line CSV — header row, data rows, nothing else — and the
portfolio name round-trips through the filename rather than a comment preamble.

## Why

**Gunnar's call, 2026-09-21.** The current export opens with two comment lines:

```
# Blue Eagle Portfolio v1
# name: GunnPort
```

The version marker earns nothing — it has exactly one consumer, the decision to read line 2 as the
name, and the format has never had a second version. The preamble as a whole also stops the file
being a plain CSV: saved from Excel, those lines come back **quoted** (`"# Blue Eagle Portfolio v1"`),
which begins with `"` rather than `#`, so the comment-skipping misses them and the file no longer
parses. Both lines go.

The name then has nowhere to live but the filename, and that is lossy **only because our own
generator throws information away**: `portfolioCsvFilename` lowercases and hyphenates, which is what
turns `GunnPort` into `gunnport`. That lowercasing had a purpose when the name also lived inside the
file; it has none now. Preserving case and spaces makes the round trip exact for any name that does
not contain a character a filesystem rejects.

**The parser does not change.** It already skips leading `#` lines and reads `# name:` when present,
so every file exported before today keeps importing. Gunnar's own
`reference files/portfolios/gunnport-2026-09-21.csv` is one of those and must keep working — that is
acceptance criterion 6.

## Files

Modify:
- `frontend/src/lib/portfolioCsv.ts` — `serializePortfolioCsv` drops the preamble;
  `portfolioCsvFilename` preserves case and spaces; add `portfolioNameFromFilename`.
- `frontend/src/lib/portfolioCsv.test.ts` — the tests below.
- `frontend/src/components/NewPortfolioDialog.tsx` — **one line** in `handleImport`: fall back to the
  filename-derived name when the parsed seed has none.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**Do not change `parsePortfolioCsv`.** Its legacy-preamble handling is what keeps old files working
and it is already tested. If you believe it needs a change, report `BLOCKED` and say what and why.

Do not touch `PortfoliosPage.tsx`, `AddPositionForm.tsx`, `portfolio.ts`, `portfolioStore.ts`, or
`download.ts`. `AddPositionForm.tsx` carries an uncommitted hand-edit that must survive untouched.

**`reference files/` is read-only and never belongs on a file list.**
`reference files/portfolios/gunnport-2026-09-21.csv` is Gunnar's real portfolio in the legacy format —
read it, test against it, **never edit or move it.** `.claude/settings.json` denies Edit and Write
there; that deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not route around it.

## The new exported format

```
ticker,weight_pct,shares
MU,77.8037268463051,10
ORCL,11.152630234572266,10
VOO,11.043642919122638,2.08
CASH,0,
```

Header row first, LF line endings, one trailing newline. Everything else is unchanged: `CASH` is
still the reserved cash row, weights are still percent units, numbers are still written with
`String(value)` and **never** `toFixed` — that is what makes the weights above round-trip exactly.

## Interface

```ts
/** Emits the plain format above. No comment preamble; the portfolio name is not in the file. */
export function serializePortfolioCsv(portfolio: Portfolio): string

/** `<name>-YYYY-MM-DD.csv`, preserving the name's case and internal spaces so it can be read
 *  back. Only characters a filesystem rejects are replaced. Pure — `now` is an argument. */
export function portfolioCsvFilename(portfolio: Portfolio, now: Date): string

/** Recover a portfolio name from an exported filename. Pure. */
export function portfolioNameFromFilename(filename: string): string
```

### `portfolioCsvFilename`

In order:

1. Trim the name.
2. Replace every character in `/ \ : * ? " < > |` and every ASCII control character with a space.
   These are the characters Windows and POSIX filesystems reject; nothing else is unsafe.
3. Collapse runs of whitespace to one space, then trim again.
4. If the result is empty, use `portfolio`.
5. Append `-YYYY-MM-DD.csv` from `now`, using local-time `getFullYear` / `getMonth` / `getDate` as the
   current implementation does.

**Do not lowercase. Do not hyphenate spaces. Do not strip accents or non-ASCII letters.** Each of
those silently degrades the name, which is the specific failure this contract exists to remove.

### `portfolioNameFromFilename`

In order:

1. Strip any directory portion (everything through the last `/` or `\`).
2. Strip a trailing `.csv`, case-insensitively.
3. Strip a trailing ` (n)` where `n` is one or more digits — browsers append this to a duplicate
   download, so `GunnPort-2026-09-21 (1).csv` must not import as a name ending in `(1)`.
4. Strip a trailing `-YYYY-MM-DD` — the suffix `portfolioCsvFilename` adds. Match the digit shape
   exactly; do **not** strip a trailing `-2026` or any other partial date, and do not strip a date
   that is not at the end.
5. Trim. If the result is empty, return `''` — **not** a placeholder. An empty name leaves
   `summariseDraft` reporting *"Give the portfolio a name"*, which is correct: the user names it.

Order matters — step 3 must precede step 4, or the date is no longer trailing.

### `NewPortfolioDialog`

In `handleImport`, the existing call becomes:

```ts
applySeed({ ...result.seed, name: result.seed.name || portfolioNameFromFilename(file.name) })
```

A legacy file's `# name:` wins because `result.seed.name` is non-empty; a new-format file falls
through to the filename. Nothing else in `handleImport`, `applySeed`, or the feedback rendering
changes.

## Out of scope

- **No presets.** Do not add, stub, name, or invent any preset portfolio or allocation.
- Do not change `parsePortfolioCsv`, the column aliases, the mode-selection rules, or any rejection.
- Do not add a format version field anywhere, in any form. Removing the one we had is the point.
- Do not change how numbers are written. `String(value)`, never `toFixed`.
- Do not add a `portfolio_name` column — that design was considered and declined.
- Do not change the import UI's layout, the pristine guard, or the dropped/rejected feedback.
- No new dependency.

## Acceptance criteria

1. `serializePortfolioCsv` output's **first line** is exactly `ticker,weight_pct,shares`. A test
   asserts this on the first line specifically, not with `toContain`.
2. `grep -n "Blue Eagle Portfolio" frontend/src/lib/portfolioCsv.ts` prints nothing — the marker
   constant is gone, not merely unused.
3. A test round-trips a portfolio named `GunnPort` with the three weights
   `77.8037268463051`, `11.152630234572266`, `11.043642919122638` and `cashWeight: 0`: serialize,
   derive the filename, parse, apply `portfolioNameFromFilename` to that filename exactly as
   `handleImport` does, run `summariseDraft`, and assert the name is **`GunnPort`** (`===`, case
   intact) and all three weights are strictly equal to the originals.
4. A test asserts `portfolioCsvFilename` on a portfolio named `GunnPort` with
   `new Date(2026, 8, 21)` returns exactly `GunnPort-2026-09-21.csv`.
5. Tests for `portfolioNameFromFilename` covering, each asserted exactly:
   - `GunnPort-2026-09-21.csv` → `GunnPort`
   - `GunnPort-2026-09-21 (1).csv` → `GunnPort`
   - `/Users/x/Downloads/My Core Equity-2026-09-21.csv` → `My Core Equity`
   - `holdings.csv` → `holdings`
   - `Q4-2026.csv` → `Q4-2026` (a trailing partial date is **not** stripped)
   - `.csv` → `''`
6. **A test parses Gunnar's real legacy file** — read
   `reference files/portfolios/gunnport-2026-09-21.csv` from disk with `node:fs` — and asserts
   `ok === true` and `seed.name === 'GunnPort'`, proving the `# name:` path still works and that the
   preamble reader was not removed along with the writer.
7. A test asserts a name containing filesystem-unsafe characters (`A/B:C`) produces a filename with no
   such character, and states in the report what that filename is.
8. `cd frontend && npm run test` exits 0. Report the new total.
9. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
10. `cd frontend && npm run build` exits 0.
11. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
12. `cd frontend && npm ci` exits 0.
13. `grep -rn "no-spinners" frontend/src/` still prints **eight** lines — contract 0066 is untouched.
14. `git diff frontend/src/components/AddPositionForm.tsx` still contains the
    `!available.some((entry) => entry.ticker === ticker)` line.
15. `grep -n "portfolioNameFromFilename" frontend/src/components/NewPortfolioDialog.tsx` prints
    exactly one line.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm ci && echo "NPM CI OK"
grep -n "Blue Eagle Portfolio" src/lib/portfolioCsv.ts ; echo "marker grep exit: $?"
grep -rn "no-spinners" src/ | wc -l
grep -n "portfolioNameFromFilename" src/components/NewPortfolioDialog.tsx
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

Also paste the **exact output of `serializePortfolioCsv`** for a portfolio named `GunnPort` with
Gunnar's three positions and `cashWeight: 0`, and the filename `portfolioCsvFilename` produces for it
at `new Date(2026, 8, 21)`.

## Tooltips

No interactive element is added or changed.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`:

1. **Export `GunnPort`.** The downloaded file should be named `GunnPort-2026-09-21.csv` — **capital G
   and P intact**, which is the whole point of the change. Open it in a text editor: line 1 is
   `ticker,weight_pct,shares` and there are no `#` lines.
2. **Open that file in Excel or Numbers, then save it**, and import the saved copy. This is the case
   the old format failed. It should still import cleanly.
3. **Re-import the file you just exported** into a fresh `New portfolio` dialog. The name field should
   read `GunnPort`, not `gunnport`.
4. **Import your old file** — `reference files/portfolios/gunnport-2026-09-21.csv`, the one with the
   `#` preamble. It must still work and still come in named `GunnPort` from its `# name:` line. Do not
   edit that file.
5. Download the same portfolio twice without deleting the first. The browser will name the second
   `GunnPort-2026-09-21 (1).csv`; importing it should still give `GunnPort`, not `GunnPort (1)`.

No backend restart is needed — this contract changes no server code.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
