# Contract 0065 — CSV import in the New Portfolio flow, and removing number-input steppers

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

A CSV chosen in the New Portfolio dialog seeds a reviewable, editable draft — never a created
portfolio — and number fields stop rendering stepper arrows over their own placeholder text.

## Why

`parsePortfolioCsv` has existed and been tested since contract 0061 and nothing calls it. This is the
half that makes export useful: a file carried to another device, or a holdings list from a broker,
becomes a draft you look at before committing.

**Import seeds a draft and stops.** It never creates a portfolio and never overwrites one. The
`DraftSeed` type was shaped in 0061 to be exactly `summariseDraft`'s input so that a future preset
catalog populates this same path — building that path correctly here is what makes presets a drop-in
later. See `REBUILD.md`, "Portfolio CSV: one canonical format we own, parsed client-side."

The stepper fix is Gunnar's, 2026-09-21: `type="number"` renders spin buttons inside the field's right
edge, which truncates the `Weight %` placeholder. Every number input in this app is a free-form
quantity — a weight, a cash percentage, a share count — where stepping by 1 is meaningless.

## Files

Modify:
- `frontend/src/components/NewPortfolioDialog.tsx` — the file input, seed application, and the
  dropped/rejected feedback.
- `frontend/src/styles/globals.css` — the stepper rule.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch `frontend/src/lib/portfolioCsv.ts`. It is accepted, tested, and correct; this contract
consumes it. If you believe it needs a change, report `BLOCKED` and say what and why.

**`reference files/` is read-only and never belongs on a file list.**
`reference files/portfolios/gunnport-2026-09-21.csv` is Gunnar's real exported portfolio — read it to
understand the shape, do not copy it into the repo, do not edit it. `.claude/settings.json` denies
Edit and Write there; that deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Part 1 — number-input steppers

Append to `frontend/src/styles/globals.css`, beside the existing `body` and heading rules:

```css
/* Stepper arrows sit inside the field's right edge and truncate placeholder text — "Weight %"
   renders as "Weight…". Every number input in this app is a free-form quantity (a weight, a cash
   percentage, a share count) where incrementing by 1 is meaningless, so they are removed app-wide
   rather than per-field. type="number" is kept for the numeric keyboard and input filtering.
   Both rules are required: WebKit needs the pseudo-elements, Firefox needs appearance. */
input[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}

input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
```

Applies to all three files that use `type="number"` — `AddPositionForm`, `PortfoliosPage`,
`NewPortfolioDialog` — without editing any of them. Do not add a Tailwind utility class per field and
do not change any `type="number"` to `type="text"`; that would lose numeric keyboards on mobile and
the browser's own input filtering.

## Part 2 — CSV import

### Where it goes

Inside `NewPortfolioDialog`, directly under the `New portfolio` heading and above the name input.

**The control is offered only when the draft is pristine** — `name` is empty after trimming,
`cashText` is empty, and `rows` is empty. That is the state the dialog mounts in.

When the draft is not pristine, render in its place a muted line:

`Reopen this dialog to import a CSV.`

This is deliberate and is the alternative to a confirmation dialog: import is a starting point, not a
merge, and an import that silently discarded typed rows would be the same class of mistake as silent
normalization. Offering no control beats offering a destructive one. Do not build a confirm step, a
modal-in-modal, or an undo.

### Behaviour

```
user picks a file
  → read it as text
  → parsePortfolioCsv(text, new Set(universe.map(e => e.ticker)))
  → ok:    apply the seed to dialog state; render the dropped list if non-empty
  → error: render the message and line number; leave the draft untouched
```

**Never auto-create.** The user still reviews the rows, still sees `summary.problem`, and still
clicks `Create portfolio`. Import changes the draft and nothing else.

Reading the file is `await file.text()`. Do not add `FileReader` ceremony and do not add a dependency.

A parse failure must leave the draft exactly as it was — do not half-apply a seed.

Reset the `<input type="file">` value after each attempt (`event.target.value = ''`), or picking the
same file twice in a row fires no change event and the second attempt appears to do nothing.

### Applying a seed

Extract this as a single named function so the future preset catalog calls the same code:

```ts
/** Apply a parsed CSV (or, later, a preset) to the dialog's draft state. The only path
 *  by which a DraftSeed becomes an editable draft. */
function applySeed(seed: DraftSeed): void
```

It sets `name`, `mode`, `cashText` from `seed.cash`, and `rows` from `seed.rows` with a fresh
`crypto.randomUUID()` per row — `parsePortfolioCsv` emits no ids by design, which is what keeps it
pure and testable.

`seed.mode` drives the existing mode toggle. **Do not route the seed through `handleModeChange`** —
that function converts between weight and shares by recomputing from the *current* draft, and running
it against a freshly-seeded draft would overwrite the file's own numbers. Set `mode` directly.

### Feedback

**Dropped rows** (`result.dropped`, non-empty). Persistent until the next import or dialog close; not
dismissible. State the consequence, not just the fact:

```
Skipped 2 tickers not in your Universe: RDDT (25%), PLTR (10%).
Their 35% was added to cash.
```

For a ticker-only file the weights are `null`, so drop the parenthetical and the second line, and say:

```
Skipped 2 tickers not in your Universe: RDDT, PLTR.
The rest were equal-weighted.
```

Use `formatPercent` from `lib/format.ts` for every percentage.

**Rejections** (`result.ok === false`). Show `result.error`, and append ` (line N)` when
`result.line` is not null. Style it like the existing `summary.problem` line
(`text-xs text-brand-negative`).

Note: when the Universe is empty — the backend is unreachable, which `PortfoliosPage` already handles
— every position drops and the parser returns *"No portfolio tickers are in the current universe."*
That message is correct and needs no special case.

## Out of scope

- **No presets.** Do not add, stub, name, or invent any preset portfolio, allocation, or catalog.
  `applySeed` is the entire forward accommodation; nothing calls it but the file input.
- **No import from the Portfolios page**, no drag-and-drop, no import into an *existing* portfolio.
  One entry point.
- **No merge semantics.** Import replaces a pristine draft. It never appends to existing rows.
- Do not change the CSV format, the parser, the alias table, or any rejection.
- Do not change `lib/portfolio.ts`, `lib/portfolioStore.ts`, `lib/download.ts`, `AddPositionForm`, or
  `PortfoliosPage`.
- Do not add a backend route or any server persistence.
- No new dependency, runtime or dev.
- Do not add a fraction-vs-percent confirmation prompt. A file of `0.25`s lands ~99% in cash, visibly,
  and the user can fix it. Declined in 0061 and still declined.

## Acceptance criteria

1. `cd frontend && npm run test` exits 0 with 30 tests — unchanged. This contract adds UI, and
   `REBUILD.md`'s "UI unit tests are skipped deliberately" still stands. Do not add component tests.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
3. `cd frontend && npm run build` exits 0.
4. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
5. `cd frontend && npm ci` exits 0.
6. `grep -n "webkit-inner-spin-button" frontend/src/styles/globals.css` prints a line, and
   `grep -n "appearance: textfield" frontend/src/styles/globals.css` prints a line. **Both** are
   required; either alone leaves one browser family showing steppers. These greps prove the rules are
   present, not that they work — the browser check below is the actual verification, and this contract
   says so rather than pretending otherwise.
7. `grep -rn 'type="text"' frontend/src/components/NewPortfolioDialog.tsx` shows the same count as
   before the change. Report both numbers. No number input was converted to text.
8. `grep -n "applySeed" frontend/src/components/NewPortfolioDialog.tsx` prints its definition and
   exactly one call site.
9. `grep -n "handleModeChange" frontend/src/components/NewPortfolioDialog.tsx` shows it is **not**
   called from the import path. Quote the surrounding lines of `applySeed` in the report.
10. `grep -rn "preset\|Preset" frontend/src/` prints nothing.
11. `grep -n "value = ''" frontend/src/components/NewPortfolioDialog.tsx` or equivalent shows the file
    input is reset after each attempt. Quote the line.
12. Reading the diff: a failed parse leaves `name`, `mode`, `cashText` and `rows` unassigned. State
    which lines guarantee this.
13. `git diff frontend/src/components/AddPositionForm.tsx` still contains the
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
grep -n "webkit-inner-spin-button" src/styles/globals.css
grep -n "appearance: textfield" src/styles/globals.css
grep -c 'type="text"' src/components/NewPortfolioDialog.tsx
grep -n "applySeed" src/components/NewPortfolioDialog.tsx
grep -n "handleModeChange" src/components/NewPortfolioDialog.tsx
grep -rn "preset\|Preset" src/ ; echo "preset grep exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

## Tooltips — required for any contract adding interactive elements

| element | tooltip label |
|---|---|
| Import CSV file input / its label | `Fill this form from a CSV — you still review and create the portfolio yourself` |

Phrased as the effect, not the label. Do **not** use the `title` attribute — it does not render on
`disabled` elements. A styled `<label>` wrapping a visually-hidden `<input type="file">` is the usual
way to make a file input themeable; wrap whichever element actually receives hover in the `Tooltip`,
and say in the report which one you chose.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** This contract's real verification is visual; the greps above
prove presence, not effect.

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`:

1. **The stepper fix.** Open `New portfolio`. The `Weight %` placeholder must be fully readable with
   no arrows in the field. Check the `Cash %` field and the `Shares` field on the main page's add
   form too — one CSS rule covers all three, so if any still shows arrows the rule is not matching.
   Check in **both Chrome and Firefox** if you have them: the two browsers need different halves of
   that rule, and testing one proves nothing about the other.
2. **Round-trip your own portfolio.** Open `New portfolio`, import
   `reference files/portfolios/gunnport-2026-09-21.csv`. The form should fill with MU / ORCL / VOO at
   77.80 / 11.15 / 11.04, cash 0, name `GunnPort`, and `Create portfolio` should be enabled. Create it
   and confirm it matches the original.
3. **The all-cash file** you exported during 0063's check. It should import to a draft with no rows
   and 100% cash, and still be creatable.
4. **A file with an off-universe ticker.** Hand-edit a copy of your export (outside
   `reference files/`) to rename one ticker to `ZZZZ`. Import it. You should see the skipped-ticker
   line naming `ZZZZ` and its weight, and that weight should appear in the Cash field.
5. **A broken file.** Duplicate a ticker row and import. You should get a rejection naming the ticker
   and the line number, and **the form should be untouched** — not half-filled.
6. **The pristine guard.** Type a name, then look for the import control. It should be replaced by
   `Reopen this dialog to import a CSV.`
7. Check the dialog at **1024px and 1023px** and at 375px. `REBUILD.md` records that a `min-width`
   breakpoint's worst case is exactly at its trigger point.

No backend restart is needed — this contract changes no server code. The Universe must be reachable,
though, or every ticker will be dropped as off-universe.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
