# Contract 0070 — Preset portfolios in the New Portfolio dialog

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

> ## ⚠ REVISED 2026-09-21 — re-read this file before executing
>
> **If you have executed this contract before, the version you read was wrong.** Criterion 3 demanded
> the preset weights "sum to exactly `100`". That is unsatisfiable in every arithmetic and was a
> planner error. It now reads `Math.abs(sum - 100) <= 0.01`.
>
> **The preset weights below are correct and must not be altered.** A previous run correctly reported
> `BLOCKED` rather than changing them — that was the right call, and the contract has been fixed
> rather than the data.
>
> Do not execute from a remembered copy of this file. Read it from disk.

**Run after contract 0069**, which is accepted and archived. The two do not share any file, so they
do not actually conflict — an earlier version of this line said they did and was wrong.

## Goal

Selecting a named preset in the New Portfolio dialog fills the same reviewable draft a CSV import
does, through the same code path.

## Why

`DraftSeed` was shaped in contract 0061 to be exactly `summariseDraft`'s input, specifically so a
preset catalog could populate the draft without new machinery. `applySeed` was extracted in 0065 as
the single path by which a seed becomes an editable draft. This contract is the payoff: presets are a
list and a click, not a second import pipeline.

**Presets are stored as canonical CSV text and parsed with `parsePortfolioCsv`.** That is the whole
design. Authoring a preset becomes "export a portfolio, paste the file", and the preset inherits —
for free and identically — weight validation, the 100% invariant, off-universe dropping with its
report, and the `String`-not-`toFixed` exactness. **Do not write a second parser, a JSON preset
format, or a separate validation path.** A preset that cannot pass `parsePortfolioCsv` is a preset
that would have produced an invalid portfolio.

Gunnar supplied one preset, 2026-09-21, explicitly as a **test preset** — the machinery matters here,
not the allocation.

## Files

Create:
- `frontend/src/lib/presets.ts` — the `Preset` type and the catalog. Data and types only, no React.
- `frontend/src/lib/presets.test.ts` — the tests below.

Modify:
- `frontend/src/components/NewPortfolioDialog.tsx` — the preset control and its selection handler.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch `portfolioCsv.ts`, `portfolio.ts`, `portfolioStore.ts`, `download.ts`,
`AddPositionForm.tsx`, or `PortfoliosPage.tsx`. `AddPositionForm.tsx` carries an uncommitted hand-edit
that must survive untouched.

**`reference files/` is read-only and never belongs on a file list.** The preset content below was
transcribed from `reference files/portfolios/Gunnar's Port-2026-09-21.csv` **by the planner** and is
reproduced in full in this contract — do **not** read, copy from, or reference that path in any source
or test file. Contract 0067 pinned a test to that directory and the test broke the moment Gunnar
renamed his portfolio; see `REBUILD.md`, "A test fixture must live under `frontend/src/`."

## Interface

```ts
// frontend/src/lib/presets.ts

export interface Preset {
  /** Stable across renames — used as a React key and, later, a URL parameter. */
  id: string
  /** Becomes the draft's portfolio name. The user can rename it before creating. */
  name: string
  /** One line, shown beside the name. Say what the allocation is, not why it is good. */
  description: string
  /** Canonical Blue Eagle CSV. Parsed with parsePortfolioCsv at selection time. */
  csv: string
}

export const PRESETS: readonly Preset[]
```

### The one preset

```ts
{
  id: 'test-concentrated',
  name: 'Test Preset',
  description: 'Example allocation for exercising the preset flow — not investment guidance.',
  csv: [
    'ticker,weight_pct,shares',
    'MU,73.40490607218531,',
    'ORCL,10.481994524396962,',
    'VOO,10.4075329437956,',
    'PBR,3.1979752499318987,',
    'SHNY,2.2013242930879917,',
    'XIACF,0.30626691660223515,',
    'CASH,0,',
    '',
  ].join('\n'),
}
```

**The share counts are deliberately stripped.** The source file carried `10`, `10`, `2.08`, `22`,
`33.84`, `13` — Gunnar's actual holdings. A preset is an *allocation*, and `REBUILD.md`'s position
model is explicit that weights are the truth and shares are optional implementation metadata about a
specific person's specific position. Handing another user those share counts asserts a portfolio value
that is not theirs and that nothing in the app will ever reconcile. Weights carry the entire meaning;
the shares column stays present and empty so the file remains canonical.

Weights are reproduced **exactly**, to the last digit, and `parsePortfolioCsv` rejects the preset
outright if a digit is dropped — which is what criterion 3 checks.

**Corrected 2026-09-21, mid-run.** An earlier version of this line claimed the weights "sum to 100".
They do not, and cannot: they are float-derived decimal strings, and their sum is
`100.00000000000001` in float64 and `100 − 1.42e-14` in exact decimal arithmetic. That is *why*
`parsePortfolioCsv` and `isValidCurrentPortfolio` both use a `±0.01` tolerance rather than equality —
no allocation produced by dividing real numbers will ever sum to exactly 100. **Do not "fix" the
preset's digits to make a sum come out even**; that would corrupt the weights to satisfy a wrong
assertion. See the corrected criterion 3.

### Selection

In `NewPortfolioDialog`, beside the existing CSV import control and under the **same pristine
guard** — if the draft is not pristine, presets are not offered either, for the same reason import is
not: replacing typed rows without asking is the destructive option.

Selecting a preset runs exactly what an import runs:

```ts
const result = parsePortfolioCsv(preset.csv, new Set(universe.map((entry) => entry.ticker)))
```

- `ok` → `applySeed({ ...result.seed, name: preset.name })`, then `setDroppedRows(result.dropped)`.
  The preset's name always wins; the CSV carries none.
- `!ok` → the same error rendering as a failed import. **This is a programming error, not user
  error** — a preset that fails to parse shipped broken. Prefix the message so that is obvious:
  `Preset "<name>" could not be loaded: <error>`.
- Clear any previous import error and dropped rows first, exactly as `handleImport` does.

Do not call `handleModeChange`. Set state through `applySeed` only — the same rule as 0065, for the
same reason: it would recompute the preset's own numbers from an empty draft.

### Off-universe tickers in a preset

The existing dropped-row block already reports these and adds their weight to cash. That behaviour is
correct and unchanged. **Expect it to fire**: `SHNY`, `XIACF` and `PBR` are unlikely to be in a fresh
Universe, and a user selecting this preset will see several assets skipped with their weight going to
cash. That is honest and is exactly what the CSV path does.

Do not add an "add these to my Universe" affordance, and do not filter presets by what the Universe
currently holds.

## Out of scope

- **Do not invent presets.** One preset, the one above, transcribed exactly. No index funds, no
  60/40, no sector rotations, no "conservative/balanced/aggressive" ladder. Gunnar supplies preset
  content; a coding agent never authors an allocation.
- **Do not add a JSON or object-literal preset format.** CSV text parsed by `parsePortfolioCsv` is the
  design, and the reason is in the Why section.
- **Do not put share counts in any preset.**
- Do not add preset editing, saving a portfolio as a preset, deleting presets, or a preset URL route.
- Do not change the pristine guard, the import control, `applySeed`, or the dropped/error rendering
  beyond the one message prefix specified above.
- Do not change the CSV format or the parser.
- No new dependency.

## Acceptance criteria

1. A test asserts `PRESETS` has length **1**. This is the guard against a well-meaning later agent
   adding allocations nobody asked for; if Gunnar adds presets, the number changes with him.
2. A test iterates every preset and asserts `parsePortfolioCsv(preset.csv, <all its tickers>)` returns
   `ok === true`. A preset that cannot parse is a shipped bug.
3. **Corrected 2026-09-21.** A test asserts the test preset's parsed position weights sum to `100`
   **within `0.01`** — `Math.abs(sum - 100) <= 0.01`, the same tolerance `parsePortfolioCsv` and
   `isValidCurrentPortfolio` use — and that `seed.cash` is `'0'`.

   The original wording said "exactly `100`", which is unsatisfiable and was a planner error. These
   weights are float-derived: they sum to `100.00000000000001` in float64 and `100 − 1.42e-14` in
   exact decimal. An exact-decimal (BigInt) assertion failed with `expected -245n to be 0n`, and a
   float `=== 100` would have failed too. **Do not change the preset's digits to satisfy this** — the
   digits are correct and the assertion was wrong.

   Additionally, and this is the assertion that actually matters: feed the parsed seed through
   `summariseDraft` with a `byTicker` map containing all six tickers and assert
   `canCreate === true` and `problem === null`. That tests the property the preset exists to have —
   it produces a portfolio the user can create — rather than a numeric identity that no real
   allocation satisfies.
4. A test asserts **every** `SeedRow.shares` is `''` for every preset. No preset carries share counts.
5. A test asserts that parsing the preset against a universe containing **only** `MU` and `VOO`
   returns `ok === true`, drops the other four, and reports their weights in `dropped` — the path a
   real user will hit.
6. A test asserts every preset `id` is unique and non-empty.
7. `grep -c "no-spinners" frontend/src/` is unchanged at **8** — contract 0066 untouched.
8. `cd frontend && npm run test` exits 0. Report the new total.
9. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
10. `cd frontend && npm run build` exits 0.
11. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
12. `cd frontend && npm ci` exits 0.
13. `grep -rn "reference files" frontend/src/` prints nothing.
14. `grep -n "handleModeChange" frontend/src/components/NewPortfolioDialog.tsx` shows it is not called
    from the preset handler. Quote the handler in full in the report.
15. `git diff frontend/src/components/AddPositionForm.tsx` still contains the
    `!available.some((entry) => entry.ticker === ticker)` line.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm ci && echo "NPM CI OK"
grep -c "no-spinners" -r src/ | grep -v ":0" | wc -l
grep -rn "reference files" src/ ; echo "refdir grep exit: $?"
grep -n "handleModeChange" src/components/NewPortfolioDialog.tsx
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

Also paste the preset handler in full, and the `dropped` array your criterion-5 test produces.

## Tooltips — required for any contract adding interactive elements

| element | tooltip label |
|---|---|
| The preset control (select, or each preset button) | `Fill this form from a saved allocation — you still review and create the portfolio yourself` |

Phrased as the effect, not the label. Do **not** use the `title` attribute — it does not render on
`disabled` elements. Say in the report which element you wrapped.

If you use a `<select>`, the `Tooltip` wraps the `<select>` itself. Note that `Tooltip` renders an
`inline-flex` span around its child, which makes that child content-sized — give the select an
explicit width if it needs one (`REBUILD.md`, "`Tooltip` wraps its child in an `inline-flex` span").

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`:

1. Open `New portfolio` and select **Test Preset**. The form fills with the six tickers that are in
   your Universe, name `Test Preset`, and — for any of `PBR`, `SHNY`, `XIACF`, `MU`, `ORCL`, `VOO`
   **not** in your Universe — a skipped-tickers line naming them with their weights, and that weight
   showing up in Cash.
2. **Check the Shares column is empty** on every row. This is the deliberate difference from your own
   export: a preset carries the allocation, not your share counts.
3. Confirm `Create portfolio` enables when the weights total 100, and that creating it produces a
   portfolio you can then edit normally.
4. Type a name first, then look for the preset control — it should be gone, replaced by the
   *"Reopen this dialog to import a CSV"* line, same as the import control.
5. Check the dialog at **1024px and 1023px** and at 375px. Two controls now sit where one did.

**A judgement call for you, not a defect:** the preset is named `Test Preset` and described as *"not
investment guidance."* Your file is 73% MU — a concentrated single-name bet that reads oddly as a
shipped default on a deployed, unauthenticated app where anyone can see it. Naming it as an example
is my hedge. If you want it named `Gunnar's Port` and presented as a real allocation, say so and I
will change the two strings; I did not want to make that call for you.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
