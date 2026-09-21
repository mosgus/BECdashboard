# Contract 0066 — Apply the no-spinners class to every non-Shares number field

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

Every `type="number"` field in the app except the two `Shares` inputs carries `no-spinners`, so
placeholders render in full while share counts keep their steppers.

## Why

**Gunnar's call, 2026-09-21, reversing this contract's earlier app-wide version.** Share counts are
usually integers and stepping by 1 is genuinely useful there; weights and cash percentages are typed
values like `12.5` where a stepper only eats the placeholder. So the rule is an **opt-in class, not
an element selector** — the opposite of what an earlier draft of this contract argued for, and the
earlier reasoning is superseded rather than merely outvoted.

Contract 0065 shipped the class but applied it to **one of seven** number inputs. Three non-Shares
fields still show steppers, including the `Cash` field on `/portfolios` that Gunnar named in the
original report alongside `Weight %`, and the New Portfolio dialog's per-row `Weight %` — the
identical `w-24` field to the one that was fixed, so the same truncation reappears the moment the
dialog opens.

Nothing is wrong with the CSS itself. This contract only adds the class where it is missing.

## Current state, measured 2026-09-21

| field | file:line | has `no-spinners` | should |
|---|---|---|---|
| `Weight %` | `AddPositionForm.tsx:101` | yes | yes — leave alone |
| `Shares` | `AddPositionForm.tsx:~113` | no | **no — leave alone** |
| `Cash` | `PortfoliosPage.tsx:276` | no | **add** |
| `Cash %` | `NewPortfolioDialog.tsx:~226` | no | **add** |
| `Cash $` | `NewPortfolioDialog.tsx:~238` | no | **add** |
| `Weight %` (per row) | `NewPortfolioDialog.tsx:~279` | no | **add** |
| `Shares` (per row) | `NewPortfolioDialog.tsx:~293` | no | **no — leave alone** |

Line numbers are approximate — **locate each field by its `placeholder`**, not by line number. Three
additions, two deliberate omissions.

## Files

Modify:
- `frontend/src/pages/PortfoliosPage.tsx` — add `no-spinners` to the cash input's className.
- `frontend/src/components/NewPortfolioDialog.tsx` — add `no-spinners` to `Cash %`, `Cash $`, and the
  per-row `Weight %`. **Not** the per-row `Shares`.
- `frontend/src/styles/globals.css` — comment only. The current comment reads
  `/* Hide number input spinners for weight field only */`, which is now false in two directions: it
  is not only the weight field, and "only" implies a scope the class does not enforce. Replace with:

```css
/* Number steppers render inside the field's right edge and truncate placeholder text — "Weight %"
   shows as "Weight…". Opt-in rather than an element selector, because Shares keeps its steppers:
   share counts are usually integers and stepping by 1 is useful there, while weights and cash
   percentages are typed values like 12.5. Gunnar's call, 2026-09-21.
   Both rules are required — WebKit needs the pseudo-elements, Firefox needs appearance — so
   verifying in one browser proves nothing about the other. */
```

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**Do not change the CSS rules themselves.** The selectors and declarations at `globals.css:121-130`
are correct; only the comment above them changes. Do not switch to `input[type="number"]` — that
would strip the Shares steppers, which is the thing this contract exists to preserve.

**Do not touch `AddPositionForm.tsx` at all.** Its `Weight %` is already correct and its `Shares` is
correctly left alone. It also carries an uncommitted hand-edit (`!available.some(...)`) that must
survive.

Do not touch `portfolioCsv.ts`, `portfolio.ts`, `portfolioStore.ts`, or any test file. Do not touch
0065's CSV import UI in `NewPortfolioDialog` — the file input, `applySeed`, and the dropped/rejected
feedback are accepted and correct; the only change to that file is three `className` strings.

**`reference files/` is read-only and never belongs on a file list.** `.claude/settings.json` denies
Edit and Write there; that deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

Each change appends ` no-spinners` to an existing className. Nothing else about any input changes —
same `type`, same `inputMode`, same `min`/`max`/`step`, same width, same handlers, same `Tooltip`.

```tsx
// PortfoliosPage.tsx — Cash
className="text-sm px-3 py-1.5 w-32 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground no-spinners"

// NewPortfolioDialog.tsx — Cash %, and the per-row Weight %
className={`${FIELD} w-24 no-spinners`}

// NewPortfolioDialog.tsx — Cash $
className={`${FIELD} w-32 no-spinners`}
```

## Out of scope

- **No presets.** Do not add, stub, name, or invent any preset portfolio or allocation.
- Do not add the class to either `Shares` input. That is the whole point of the selective policy.
- Do not change any `type="number"` to `type="text"` — that loses the numeric keyboard on mobile and
  the browser's input filtering.
- Do not convert the class rule to an element selector.
- Do not add a Tailwind arbitrary-variant (`[&::-webkit-inner-spin-button]:appearance-none`) anywhere.
  One stylesheet rule, referenced by class.
- Do not change any component's logic, state, or layout. Three strings and one comment.

## Acceptance criteria

1. `grep -rn "no-spinners" frontend/src/` prints exactly **seven** lines:

   | source | count |
   |---|---|
   | `AddPositionForm.tsx` (`Weight %`, unchanged) | 1 |
   | `PortfoliosPage.tsx` (`Cash`) | 1 |
   | `NewPortfolioDialog.tsx` (`Cash %`, `Cash $`, per-row `Weight %`) | 3 |
   | `globals.css` (the two selector lines) | 2 |

   Paste the full output. If your count differs, say why rather than adjusting anything to match.
2. `grep -n "no-spinners" frontend/src/components/NewPortfolioDialog.tsx` prints exactly **three**
   lines.
3. The two `Shares` inputs do **not** carry the class. Verify by printing the className line
   immediately following each `placeholder="Shares"` in both files, and paste them.
4. `grep -c 'type="number"' frontend/src/components/AddPositionForm.tsx frontend/src/pages/PortfoliosPage.tsx frontend/src/components/NewPortfolioDialog.tsx`
   prints `2`, `1`, `4` — unchanged. No input changed type, none were added or removed.
5. `grep -n 'input\[type="number"\]' frontend/src/styles/globals.css` prints **nothing** — the rule
   stays class-scoped.
6. `grep -n "weight field only" frontend/src/styles/globals.css` prints nothing — the stale comment
   is gone.
7. `git diff frontend/src/components/AddPositionForm.tsx` is **identical** to before this contract,
   and still contains the `!available.some((entry) => entry.ticker === ticker)` line.
8. `grep -n "applySeed" frontend/src/components/NewPortfolioDialog.tsx` still prints a definition and
   exactly one call site — 0065's import UI is untouched.
9. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.)
10. `cd frontend && npm run build` exits 0.
11. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
12. `cd frontend && npm run test` exits 0 with 30 tests — unchanged.
13. `cd frontend && npm ci` exits 0.

**None of these prove a stepper is gone.** A class that is present is not a class that renders. The
browser check below is the verification; these criteria only prove the class landed on the right
five fields and stayed off the right two.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
grep -rn "no-spinners" frontend/src/
grep -n "no-spinners" frontend/src/components/NewPortfolioDialog.tsx
grep -n -A1 'placeholder="Shares"' frontend/src/components/AddPositionForm.tsx frontend/src/components/NewPortfolioDialog.tsx
grep -c 'type="number"' frontend/src/components/AddPositionForm.tsx frontend/src/pages/PortfoliosPage.tsx frontend/src/components/NewPortfolioDialog.tsx
grep -n 'input\[type="number"\]' frontend/src/styles/globals.css ; echo "element-selector grep exit: $?"
grep -n "weight field only" frontend/src/styles/globals.css ; echo "stale-comment grep exit: $?"
grep -n "applySeed" frontend/src/components/NewPortfolioDialog.tsx
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
cd frontend && npm ci && echo "NPM CI OK"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

## Tooltips

No interactive element is added or changed. Every existing tooltip stays exactly as it is.

## Human verification — does Gunnar need to run anything?

**Yes — this is the whole verification.** A grep sees a class, not a rendered arrow.

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`, confirm **no arrows and a fully readable placeholder** in:

1. The add-position row's **`Weight %`** (already working — confirm it did not regress).
2. The portfolio header's **`Cash`** field. **This is the one you originally reported that was
   missed.**
3. `New portfolio` dialog: **`Cash %`**, and each asset row's **`Weight %`**.
4. `New portfolio` dialog in shares mode (click `By shares`): **`Cash $`**.

And confirm **arrows are still present** in:

5. The add-position row's **`Shares`** field.
6. Each asset row's **`Shares`** field in the dialog.

Check in **both Chrome and Firefox** if you have them — the two halves of the rule serve different
engines, so one browser proves nothing about the other.

Also confirm typing still works: `12.5` must be accepted in a weight field, and letters rejected.

While you are in there, **0065's import flow has still never been run in a browser.** Import
`reference files/portfolios/gunnport-2026-09-21.csv` into a fresh `New portfolio` dialog and confirm
it fills with MU / ORCL / VOO at 77.80 / 11.15 / 11.04, cash 0, name `GunnPort`, and creates
correctly. That is the last unverified piece of the whole CSV feature.

No backend restart is needed — this contract changes no server code.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
