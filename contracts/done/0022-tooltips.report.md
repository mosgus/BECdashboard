# Report — Contract 0022 — Tooltip component, applied across the app

**Status:** reported

## Summary

New `Tooltip.tsx` renders through a portal to `document.body`, shows after 400ms of hover or on
focus, hides immediately on leave/blur/Escape, flips above/below and clamps horizontally to stay
on-screen, and is wired into every element in the copy table. All `title=` attributes it replaces
are removed; `UniverseTable`'s `Name` cell keeps its truncation-fallback `title`.

Files exactly as listed:
- `frontend/src/components/Tooltip.tsx` (new)
- `frontend/src/pages/UniversePage.tsx`
- `frontend/src/components/AddTickerForm.tsx`
- `frontend/src/components/UniverseTable.tsx`
- `frontend/src/components/FilterDialog.tsx`

No other files touched.

## A gap in the copy table, found and resolved

`FilterDialog.tsx`'s header `×` close button had `title="Close"` and is **not** in the copy table
— only "per-group `clear` links," "`Clear all` (dialog)," and "`Done` (dialog)" are listed. But
criterion 5's grep requires **zero** `title=` anywhere in this file, not just on the three listed
elements, so leaving that title in place would fail the criterion, and simply deleting it with
nothing replacing it would leave that control silent — the opposite of this contract's point.

I gave it a `Tooltip` with the copy `"Close and apply"` — identical to `Done`'s copy — because it
calls the exact same `handleClose` function `Done` does (there's no separate cancel/discard path;
filters already apply live as you interact with the dialog, so closing via either control is the
same action). Flagging this rather than silently improvising different wording, per the contract's
own "if you disagree, report it" precedent for the chips exclusion.

## Design decisions

- **`pointer-events-none` is applied by each caller, not by `Tooltip` itself.** The interface says
  "apply `pointer-events-none` to the disabled child" without describing auto-detection, and
  `Tooltip`'s `children: ReactNode` has no reliable way to introspect an arbitrary child's
  `disabled` prop generically. Each caller that has a real disabled state (`AddTickerForm`'s `Add`
  button, `UniversePage`'s `Update all`) already computes that boolean for its own `disabled` prop,
  so conditionally adding `pointer-events-none` to the same className string was the natural,
  minimal-surface-area place for it — not a change to `Tooltip.tsx`'s contract.
- **`aria-describedby` is wired onto the actual child element, not the wrapper `<span>`.** The
  interface says "an `id` referenced by the trigger's `aria-describedby`" — the trigger is the
  button/input/anchor the user actually focuses, not the wrapping span (which is never itself
  focusable). Used `Children.only` + `cloneElement` to inject `aria-describedby` onto the real
  child so screen readers associate the description with the element that has focus. This needed
  one explicit type parameter on `cloneElement` (`ReactElement<DescribableProps>`) since
  `Children.only`'s return type doesn't carry specific prop information — not an `any`, confirmed
  by criterion 8's clean grep.
- **Both hover and focus go through the same 400ms delayed `show()`.** The contract distinguishes
  hover-vs-focus for *triggering* ("also shows on focus") but doesn't specify a different timing
  for focus, so I kept one code path rather than inventing an instant-on-focus behavior the
  contract never asked for.
- **Positioning is a two-phase measure-then-place**, not a single-pass calculation: the tooltip
  first renders invisibly (`visibility: hidden`) so its real rendered size can be measured via
  `getBoundingClientRect()`, then a `useLayoutEffect` computes the flipped/clamped position and
  flips to visible — all before the browser paints, so there's no visible flash. A single-pass
  calculation can't know the tooltip's actual width/height (which varies with the label's length)
  before it exists in the DOM.

## Verification

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 97ms

$ git diff --stat frontend/package.json
(empty)

$ grep -rn "createPortal" frontend/src/components/Tooltip.tsx
2:import { createPortal } from 'react-dom'
74:        createPortal(

$ grep -rn 'title=' frontend/src/pages/UniversePage.tsx frontend/src/components/AddTickerForm.tsx frontend/src/components/FilterDialog.tsx
(no matches, exit 1)

$ grep -n 'title=' frontend/src/components/UniverseTable.tsx
54:                title={row.short_name ?? undefined}
```
Only the `Name` cell's truncation fallback, as required.

```
$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/Tooltip.tsx
(no matches, exit 1)

$ grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/components/Tooltip.tsx
(no matches, exit 1)
```

### Criterion 9 — every copy string, verbatim, with counts

```
[1] Filter the table by type, sector, price, market cap, P/E or yield
[1] Clear every filter and the search box
[1] Show only rows whose ticker or company name matches
[1] Fetch any missing price history for every ticker, up to the last close
[1] Download every ticker's price history as a single zip
[1] Enter a ticker symbol, for example AAPL
[1] Fetch 10 years of price history and current fundamentals
[1] Download this ticker's full price history as CSV
[3] Clear only this filter    (the three per-group clear links)
[1] Reset every filter to its default
[2] Close and apply           (Done, plus the ×  — see the gap noted above)
```

### Criteria 10 and 11 — verified live, not inferred

Both are the actual reason this contract exists, so both were driven through headless Chrome over
CDP against the real components (a temporary swap of `frontend/src/main.tsx` to mount
`AddTickerForm` and `UniverseTable` directly, since I still cannot run the backend in this sandbox
to exercise the real `/universe` page — same constraint as contracts 0015/0018/0019; `main.tsx` was
restored to its exact original content afterward, confirmed via `git diff --stat` showing empty).

**Criterion 10 — the disabled case, the reference case named in the contract:**
```
{
  "ran": true,
  "buttonDisabled": true,
  "present": true,
  "text": "Fetch 10 years of price history and current fundamentals",
  "visible": true
}
```
With the ticker input empty, `Add` is confirmed `disabled` (its own DOM property, not inferred),
and hovering it over real dispatched mouse-move events still produced a `[role="tooltip"]` node
with the correct text and `visibility: visible`. This is the load-bearing check — `title` was
provably silent here; `pointer-events-none` fixed it, and this proves it.

**Criterion 11 — the clipping case, at 375px:**
```
icon rect: {"x":328,"y":178.7,"right":342}   (viewport width 375)
{
  "present": true,
  "text": "Download this ticker's full price history as CSV",
  "visible": true,
  "left": 94.8,
  "right": 367,
  "viewportWidth": 375,
  "fullyOnScreen": true
}
```
The download icon sits at the table's right edge (its own right edge at x=342 of a 375px
viewport). Hovering it produced a tooltip fully within `[0, 375]` — the horizontal clamp kept it
on-screen rather than letting it overflow past the viewport edge the way an unclamped
centered-on-trigger tooltip would.

## Human verification — not done by me

Per the contract's own list: tabbing through controls with a real keyboard to confirm focus-shown
tooltips end-to-end (I verified the underlying mechanism — `aria-describedby` wiring and the same
`show()` path — but did not simulate actual Tab-key navigation), confirming the ~400ms feel isn't
janky in practice, and opening the filter dialog to confirm a tooltip visually sits above the
overlay (I can confirm the DOM/z-index setup is correct, but "looks right stacked over a
semi-transparent overlay" is a visual judgment).
