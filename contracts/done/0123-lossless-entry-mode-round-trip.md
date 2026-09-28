# Contract 0123 — Lossless weight ⇄ shares round trip in the New portfolio dialog

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

In the New portfolio dialog, switching **Weight → Shares → Weight** (or **Shares → Weight →
Shares**) without editing anything in between restores exactly what was there before. Today it
empties the fields.

## Why

`handleModeChange` in `NewPortfolioDialog.tsx` treats every switch as a conversion. Weight → Shares
blanks shares and cash, as contract 0059 requires: the dialog must not invent a share count from a
weight. Shares → Weight then derives weights *from* those blank shares, so every weight comes
back `''`. A preset or CSV (both seed weight mode) is wiped by two clicks. Hand-typed weights are
wiped the same way. Shares → Weight → Shares loses the typed shares and cash dollars for the same
reason.

Restoring values the user already entered doesn't invent anything, so 0059's rule still holds.
The restore applies **only** when the draft is unchanged since the switch. After any edit, the
current conversion runs unchanged. The rule is "undo an untouched switch", not "keep two drafts".

## Files

Modify:
- `frontend/src/lib/portfolio.ts` — add `DraftFields`, `ModeSwitch` and `switchEntryMode` (below).
  Put them directly after `summariseDraft`.
- `frontend/src/lib/portfolio.test.ts` — add a `describe('switchEntryMode', …)` block.
- `frontend/src/components/NewPortfolioDialog.tsx` — make `handleModeChange` call `switchEntryMode`,
  and hold `lastSwitch` state.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

In `frontend/src/lib/portfolio.ts`:

```ts
/** The mode-dependent part of a composer draft: what a mode switch rewrites. */
export interface DraftFields {
  cash: string
  rows: DraftRow[]
}

/** The last mode switch, kept so an untouched switch back can be undone exactly. */
export interface ModeSwitch {
  from: EntryMode
  before: DraftFields
  after: DraftFields
}

/** Switch the composer's entry mode. If the previous switch left from `nextMode` and the draft is
 *  unchanged since then, restore the pre-switch fields verbatim. Otherwise convert: to weight,
 *  prefill weights and cash % from `summary`; to shares, clear shares and cash dollars (contract
 *  0059 — never invent a share count). */
export function switchEntryMode(
  draft: { mode: EntryMode; cash: string; rows: DraftRow[] },
  nextMode: EntryMode,
  summary: DraftSummary,
  lastSwitch: ModeSwitch | null,
): { fields: DraftFields; lastSwitch: ModeSwitch | null }
```

Behaviour, in order:

1. `nextMode === draft.mode` → return `{ fields: { cash: draft.cash, rows: draft.rows }, lastSwitch }`
   unchanged.
2. **Restore:** if `lastSwitch !== null`, `lastSwitch.from === nextMode`, and the current
   `{ cash, rows }` equals `lastSwitch.after`, return `{ fields: lastSwitch.before, lastSwitch: null }`.
   "Equals" means the same `cash` string and the same row count. At each index, `id`, `ticker`,
   `shares` and `weight` must all be `===`. Write this as a small non-exported helper. No deep-equal
   library.
3. **Convert:** otherwise compute `fields` exactly as `handleModeChange` does today:
   - to `'weight'`: `cash = summary.cashWeight !== null ? toFieldText(summary.cashWeight, 2) : ''`.
     Each row gets `weight` = its `summary.rows` match by `id`, as `toFieldText(w, 4)`, or `''` when
     that weight is null or missing.
   - to `'shares'`: `cash = ''`, and every row gets `shares: ''`.

   Return `{ fields, lastSwitch: { from: draft.mode, before: { cash: draft.cash, rows: draft.rows }, after: fields } }`.

Do not mutate `draft.rows` or any row object. Build new arrays and objects.

In `NewPortfolioDialog.tsx`:

- Add `const [lastSwitch, setLastSwitch] = useState<ModeSwitch | null>(null)`.
- `handleModeChange(nextMode)` keeps its `if (nextMode === mode) return`. It then calls
  `switchEntryMode({ mode, cash: cashText, rows }, nextMode, summary, lastSwitch)` and applies the
  result: `setCashText(fields.cash)`, `setRows(fields.rows)`, `setLastSwitch(result.lastSwitch)`,
  `setMode(nextMode)`. Use plain value setters here. Don't use a functional `setRows(prev => …)`,
  because the comparison has to see the same `rows` this render sees.
- `applySeed` also calls `setLastSwitch(null)`.
- Remove the now-unused inline conversion code. Remove the `toFieldText` import only if nothing
  else in the file uses it (check with grep).

No change to any JSX, markup, class, tooltip or copy.

## Out of scope

- Do not keep weights and shares as two live, independent drafts. Any edit after a switch means
  the next switch converts, as today.
- Do not change `summariseDraft`, `updateRow`, the CSV/preset paths (other than the one
  `setLastSwitch(null)` line), or the existing portfolio page's editing.
- Do not add a DOM testing library or component tests. The logic is tested through the pure
  function.
- Do not reformat unrelated code.

## Acceptance criteria

1. `grep -n "export function switchEntryMode" frontend/src/lib/portfolio.ts` prints one line.
2. `grep -n "switchEntryMode(" frontend/src/components/NewPortfolioDialog.tsx` prints at least one line.
3. `grep -n "previous.map((row) => ({ ...row, shares: '' }))" frontend/src/components/NewPortfolioDialog.tsx`
   prints nothing (the inline conversion is gone).
4. `grep -n "setLastSwitch(null)" frontend/src/components/NewPortfolioDialog.tsx` prints at least one line.
5. The new `describe('switchEntryMode')` block has **at least** these tests, each asserting on the
   returned `fields` with `toEqual`:
   - (a) Weight → Shares on a draft with weights `'60'`, `'40'` and cash `'0'`: shares are all `''`,
     cash is `''`, and `lastSwitch.from === 'weight'`.
   - (b) Take (a)'s result, then switch Shares → Weight with no edit: fields equal (a)'s original
     weight draft **exactly**, including row ids, and `lastSwitch` is `null`.
   - (c) As (b), but first change one row's ticker in the shares-mode fields: no restore happens.
     Weights come from the supplied summary, and `lastSwitch` is non-null.
   - (d) Shares → Weight → Shares with no edit: the original shares strings and cash dollars come
     back exactly.
   - (e) Same-mode call returns the input fields and the input `lastSwitch` unchanged.
   - (f) Restore does not fire when `lastSwitch.from` differs from `nextMode`.
   - (g) The input `draft.rows` array and its row objects aren't mutated. Snapshot them with
     `structuredClone` before the call and `toEqual` after.

   Build `DraftSummary` values by hand in the tests. Don't route through `summariseDraft` or
   universe fixtures.
6. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
7. `cd frontend && npm run lint` exits 0 with no new warnings in the three touched files.
8. `cd frontend && npm test` passes in full.
9. `awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/components/NewPortfolioDialog.tsx frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts`
   prints nothing new compared with before your edit. Run it **before** editing too, and paste
   both outputs. Don't collapse multi-line JSX or functions onto one line.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report, including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/components/NewPortfolioDialog.tsx frontend/src/lib/portfolio.ts frontend/src/lib/portfolio.test.ts   # before AND after
grep -n "export function switchEntryMode" frontend/src/lib/portfolio.ts
grep -n "switchEntryMode(\|setLastSwitch" frontend/src/components/NewPortfolioDialog.tsx
grep -n "previous.map((row) => ({ ...row, shares: '' }))" frontend/src/components/NewPortfolioDialog.tsx
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
git diff --stat
```

## Tooltips

No new interactive elements. The existing Weight/Shares buttons are unchanged.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** Run `cd frontend && npm run dev` and open `/portfolios`.
Click **New portfolio**:

1. Select **Gunnar Preset**. Click **Shares**, then **Weight** without typing. All six weights and
   cash `0` come back.
2. Click **Shares**, type a share count in one row, then click **Weight**. Weights are derived from
   what you typed; this is today's behaviour, and blank rows show empty. That's expected: you edited.
3. In Shares mode, type shares and cash $, click **Weight**, then **Shares** without typing. Your
   shares and cash $ come back.

## Open questions

None. If a case isn't covered above, report `BLOCKED`. Don't guess.
