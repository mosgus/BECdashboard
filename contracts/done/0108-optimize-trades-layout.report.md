# Report — Contract 0108 (planner audit)

**Outcome:** ACCEPTED (Amendment 1 included)
**Agents:** sonnet (main), haiku (Amendment 1)
**Audited:** 2026-09-24

## Verified by re-running
- `npm run build`: passes.
- `npm run test`: 120 passed (baseline 111; 9 new).
- `npm run lint`: only `HelpSidebar.tsx:44` and `UniversePage.tsx:60`.
- Every grep criterion (5–12, 14) holds.

## Code review
- **`tradeBasis`** follows the specified order: no-shares, then no-price, then the equity ≤ 0 guard,
  then shares-mismatch.
- **Dollar-mode request** sends `shares × price` in position order.
- **`tradeRows`, formatters and CSV** match the scratch-verified values. The tests assert them
  exactly, with `toBeCloseTo` where they should.
- **The two `curveRows` tests** changed only as authorised: `toBeCloseTo` on the % values, and
  `100 + i` for downsampling.
- **`portfolioCsv.ts`** gained only the `export` keywords.
- **Settings card:**
  - three columns, with the order as specified
  - the Run button and the selected lookback button use `bg-btn-action`/`text-btn-action-text`
  - `bg-brand-primary` is gone
- **Price load:** it has a `cancelled` guard, errors fall back to an empty map, and Run stays
  disabled while prices load.

## Defect found and fixed
- **Amendment 1:** the Max weight label sat about 20px above its slider, because label and slider
  were separate flex children. It is now wrapped in a `<div>`. The Vol target block was re-indented.

## Not from either coder
- **`dismissOnPointerDown` prop:** commit 14177e4 ("Optimizer core") also contains a
  `dismissOnPointerDown` prop in `Tooltip.tsx`, used on the Max and Min weight sliders. Neither
  report mentions it, so it was presumably added by hand. It looks sound: pointer-down hides the
  bubble and suppresses the focus-show that follows, and mouse-leave clears the flag.
- **Vol target slider:** it lacks the prop, so it is inconsistent with the other two sliders. Fold
  that into 0109.

## Outstanding
- Human browser check, per the contract: layout at 1280px and 700px, dark mode, the 0% axis,
  dollar vs weights tables, and the CSV download.
