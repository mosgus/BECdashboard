# Contract 0198 — The portfolio/preset dialog ignores clicks outside it

**Status:** reported <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, clicking the dimmed backdrop around `NewPortfolioDialog` does nothing. The
dialog closes only through Cancel, Escape, or a successful create, save or delete.

## Why

Gunnar asked for this on 2026-11-25. `NewPortfolioDialog` is the window for **New portfolio**
(`PortfoliosPage`) and for **New preset / Edit preset** (`PresetsAdmin`). It holds a whole form:
rows of tickers, weights, shares and cash. A stray click outside it throws all of that away with no
confirmation.

The stray click often isn't really a click outside. A browser sends `click` to the nearest common
ancestor of the `mousedown` and `mouseup` targets. If you select text in a field, drag past the
dialog's edge and let go, the `click` lands on the backdrop. `event.target === event.currentTarget`
is then true, and the dialog closes. Removing the backdrop handler fixes both cases.

Escape stays. It is a deliberate keystroke, and every other dialog in the app supports it.

## Files

Modify:
- `frontend/src/components/NewPortfolioDialog.tsx`: remove the `onClick` prop from the backdrop
  `<div>` (the one with `fixed inset-0 bg-overlay`, currently around line 210). Put a one-line
  comment directly above that `<div>` saying why it has no backdrop close: the dialog holds a form,
  and a drag-select that ends outside it would otherwise discard the form.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

No props, types or behaviour change, other than the backdrop click.

## Out of scope

- Do not change any other dialog. Every other backdrop handler (`FilterDialog`,
  `SellPositionDialog`, `AdminPasskeyDialog`, `ChartDialog`, `LookbackDialog`, the Apply dialogs in
  `OptimizePage`/`CapmSection`, the delete confirm in `PortfoliosPage`, and so on) stay as they are.
- Do not remove or change the Escape handler.
- Do not add an "unsaved changes" confirmation.
- Do not change the Cancel button or its tooltip.
- Do not extract a shared dialog component.

## Acceptance criteria

1. `grep -c "event.target === event.currentTarget" frontend/src/components/NewPortfolioDialog.tsx`
   prints `0`. This is currently `1`, the backdrop handler and the file's only occurrence.
2. `grep -c "fixed inset-0 bg-overlay" frontend/src/components/NewPortfolioDialog.tsx` prints `1`.
   The backdrop itself still exists.
3. `grep -c "event.key === 'Escape') onCancel()" frontend/src/components/NewPortfolioDialog.tsx`
   prints `1`. Escape still closes the dialog.
4. `grep -rc "event.target === event.currentTarget" frontend/src --include='*.tsx' | grep -v ':0$'`
   prints exactly these 11 files, the same list as before minus `NewPortfolioDialog`:
   `HelpSidebar`, `FilterDialog`, `AdminPasskeyDialog`, `SellPositionDialog`, `GuidePanel`,
   `ChartDialog` (`:2`), `OptimizerGuide`, `PortfoliosPage`, `ExpandableChart`, `OptimizePage`,
   `CapmSection`. All show `:1` except `ChartDialog`. (`LookbackDialog` spells it
   `e.target === e.currentTarget`, so it never appears in this grep, and it is not touched either.)
5. From `frontend/`: `npx vitest run` passes (baseline 495), `npm run build` exits 0, and
   `npx oxlint` shows only the 2 baseline warnings (`UniversePage.tsx`, `HelpSidebar.tsx`).

`BLOCKED` is the correct answer if any criterion cannot be satisfied as written. Do not work
around a criterion.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -c "event.target === event.currentTarget" frontend/src/components/NewPortfolioDialog.tsx
grep -c "fixed inset-0 bg-overlay" frontend/src/components/NewPortfolioDialog.tsx
grep -c "event.key === 'Escape') onCancel()" frontend/src/components/NewPortfolioDialog.tsx
grep -rc "event.target === event.currentTarget" frontend/src --include='*.tsx' | grep -v ':0$'
cd frontend && npx vitest run 2>&1 | tail -4; npm run build >/tmp/build.out 2>&1; echo "build exit=$?"; npx oxlint
```

Also report every file you edited.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** On `/portfolios`, open **New portfolio**:
1. Click the dimmed area outside the window. It should stay open.
2. Type in a weight field, then drag-select the text and release the mouse outside the window. It
   should stay open.
3. Press Escape. It should close.

Repeat steps 1–3 with **Edit preset** under Settings & Ops.

## Open questions

None.
