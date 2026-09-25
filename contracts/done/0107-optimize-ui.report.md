# Report — Contract 0107, Optimize tab (planner audit)

**Outcome:** accepted after Amendment 1
**Coder:** sonnet (first pass), haiku (Amendment 1)

## First pass (sonnet): reported COMPLETE
- The planner re-ran the verification: build 0, 111 tests (96 + 15), lint only the two pre-existing warnings, and every grep criterion passes.
- Deviations accepted:
  - the internal `OptimizeResults`/`MetricTiles` components
  - a `mountedRef` instead of HoldingsPage's effect-scoped flag, because the request is click-triggered
  - the recharts formatter widened to satisfy `ValueType`
- **Audit found a blocking bug.** In `main.tsx`, `<StrictMode>` runs React 19's dev mount → unmount → remount. The mount-only effect's cleanup set `mountedRef.current = false`, and nothing reset it. Under `npm run dev`, every response was dropped and Run stuck on "Optimizing…". The tests can't see it, because vitest runs only `src/lib` in node.
- Slips:
  - the Min weight tooltip used U+2019 instead of the contract's ASCII apostrophe
  - a zero change rendered in the foreground colour instead of muted

## Amendment 1 (haiku): COMPLETE
- The planner re-ran it:
  - `mountedRef.current = true` is set in the effect body (line 56)
  - 0 curly apostrophes remain
  - `changeColor` returns `text-[var(--color-muted)]` for zero
  - build 0, 111 passed, 2 lint warnings (the pre-existing ones)
  - `git status --short frontend` is unchanged
- The planner does not rate the layout. Gunnar's 8-point browser check in the contract is the page's only verification.

## Notes for later contracts
- Every page that guards a click-triggered async result with a ref must reset the ref in the effect body. 0109 (Apply) will hit the same pattern.
- `backend/install.sh` appeared untracked at 19:29 on 2026-09-24. Neither the 0107 coder nor the planner wrote it, so Gunnar should confirm it is his before committing.
