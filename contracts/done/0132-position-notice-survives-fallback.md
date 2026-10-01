# Contract 0132 — Keep the remove-by-weight notice visible after the fallback

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Bug

Contract 0131 added `setPositionNotice(null)` to the cash reseed effect in
`frontend/src/pages/PortfoliosPage.tsx`, the `useEffect` whose deps are
`[current?.id, sharesBased, sharesBased ? current?.cashDollars : current?.cashWeight]`.

The fallback path in `handleRemovePosition` persists a **weight-based** portfolio and sets the
notice "…was removed by weight because a current price was missing…". That flips `sharesBased`
from true to false, so the effect re-runs after the render and clears the notice at once. The one
message 0131 exists to show is never seen. The planner's contract allowed this placement; the error
is in the spec, not the coder's work.

## Fix

In `frontend/src/pages/PortfoliosPage.tsx` only:
1. Remove the `setPositionNotice(null)` line from the cash reseed effect. Leave the rest of that
   effect exactly as it is.
2. Add a separate effect directly after it:
   ```tsx
   useEffect(() => {
     setPositionNotice(null)
   }, [current?.id])
   ```
   The notice now clears only when the selected portfolio changes. The handler's own
   `setPositionNotice(null)` calls already clear it after a successful removal.

Touch no other file. `frontend/src/components/NewPortfolioDialog.tsx` has Gunnar's own
uncommitted edit. **Do not touch it.** Anything else → `BLOCKED`.

## Acceptance criteria

1. `grep -n "setPositionNotice(null)" frontend/src/pages/PortfoliosPage.tsx` prints exactly
   **three** lines: the new effect and the two in `handleRemovePosition`. None of them is inside the
   cash reseed effect.
2. `grep -n "}, \[current?.id\])" frontend/src/pages/PortfoliosPage.tsx` prints one line.
3. From `frontend/`:
   - `npx tsc -p tsconfig.app.json --noEmit` exits 0.
   - `npm test` shows 236 passed.
   - `npm run lint` shows only the HelpSidebar.tsx:44 and UniversePage.tsx:77 warnings.

   If lint flags the new effect with `set-state-in-effect`, that is a new warning, and it is
   accepted. Report it verbatim and don't try to silence it.
4. Run `awk 'length > 300'` on the file **before and after** the edit. Both runs print nothing.

## Verification to run and paste

**Paste every output verbatim, including the before awk.**

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/PortfoliosPage.tsx   # BEFORE editing
# ... edit ...
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/PortfoliosPage.tsx   # AFTER
grep -n "setPositionNotice(null)" frontend/src/pages/PortfoliosPage.tsx
grep -n "}, \[current?.id\])" frontend/src/pages/PortfoliosPage.tsx
sed -n 70,90p frontend/src/pages/PortfoliosPage.tsx
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test 2>&1 | tail -6
```

## Human verification (Gunnar)

This is hard to trigger by hand, because it needs a shares-based portfolio holding a ticker that
has no price. The code-path review above is the main check. Also confirm that switching portfolios
still clears any notice.
