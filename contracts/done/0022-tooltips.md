# Contract 0022 — Tooltip component, applied across the app

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Hovering any interactive control shows a short, styled tooltip explaining **what it does** —
including controls that are `disabled`, which is where the current `title` attributes go silent.

## Why

`REBUILD.md` now requires a tooltip on every interactive element, phrased as the effect rather than
the label. `title` attributes were added as a first attempt and do not deliver it:

- **`title` never renders on a `disabled` element.** Browsers do not fire mouse events on disabled
  form controls. `AddTickerForm`'s Add button is disabled whenever the input is empty, and
  `Update all` is disabled mid-refresh — the two moments a user most wants to know why they cannot
  click are the two moments the explanation is silent.
- Native tooltips have a ~1s delay, cannot be styled, and vary by browser.

This lands **before** the chart dialog (contract 0023) deliberately: that contract adds eight range
buttons, a close control and a download link, and building them against an existing `Tooltip` is
cheaper than retrofitting them afterwards.

**Depends on contracts 0015 and 0020.** If `FilterDialog.tsx` or the `Download Universe` anchor does
not exist, stop and report `BLOCKED`.

## Files

Create:
- `frontend/src/components/Tooltip.tsx`

Modify:
- `frontend/src/pages/UniversePage.tsx`
- `frontend/src/components/AddTickerForm.tsx`
- `frontend/src/components/UniverseTable.tsx`
- `frontend/src/components/FilterDialog.tsx`

**Touch nothing else.** Do not modify `lib/`, `api/`, `globals.css`, `Header.tsx`, `NavItem.tsx`,
`DownloadIcon.tsx`, `SettingsIcon.tsx`, `App.tsx`, or anything under `backend/`. **No new
dependencies** — `createPortal` comes from `react-dom`, which is already installed. If the work
appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `components/Tooltip.tsx`

```tsx
interface TooltipProps {
  label: string
  children: ReactNode
  placement?: 'top' | 'bottom'   // default 'top'
}
export function Tooltip(props: TooltipProps): JSX.Element
```

Behaviour:

- Renders `children` inside a wrapper `<span>` that carries the hover and focus handlers. The
  wrapper must be `inline-flex` so it does not disturb existing layout — several of these sit inside
  flex rows and table cells.
- **Shows after ~400ms of hover; hides immediately on leave.** A delay prevents tooltips flashing as
  the pointer crosses a toolbar; no delay on hide keeps it from lingering.
- Also shows on **focus** and hides on **blur**, so keyboard users get it.
- Hides on `Escape`.

**Two implementation requirements, both load-bearing:**

**1. Render through a portal to `document.body` with `position: fixed`.** The table lives inside a
card with `overflow-hidden` (needed for its rounded corners). A tooltip rendered inline would be
**clipped by that card** — most visibly on the per-row download icons at the table's right edge,
which is exactly where it matters. Use `createPortal` from `react-dom` and position from the
trigger's `getBoundingClientRect()`.

**2. Disabled children need the wrapper to receive the events.** A `disabled` button swallows mouse
events. Apply `pointer-events-none` to the disabled child so events reach the wrapper span, which is
what actually listens. Without this, the contract's entire premise fails. **Test it on
`AddTickerForm`'s Add button with the input empty** — that is the reference case.

Positioning:

- Default above the trigger, centred, with a small gap.
- **Flip to below when there is not enough room above**, and **clamp horizontally** so it never
  renders off-screen. The rightmost download icon at 375px is the case that breaks a naive
  implementation.

Styling — brand tokens only, no hardcoded colours:

- `bg-foreground` with `text-brand-surface` (dark on light page), `text-xs`, `px-2 py-1`,
  `rounded-[var(--radius-btn)]`, `whitespace-nowrap`, a soft shadow, `z-[100]` so it sits above the
  dialog overlay.
- `pointer-events-none` on the tooltip itself, so it never blocks a click.

Accessibility: `role="tooltip"` and an `id` referenced by the trigger's `aria-describedby`.

### Tooltip copy — exact strings

Phrased as the **effect**, not the label.

| element | file | copy |
|---|---|---|
| Filters button | `UniversePage` | `Filter the table by type, sector, price, market cap, P/E or yield` |
| Clear-all `×` | `UniversePage` | `Clear every filter and the search box` |
| Search input | `UniversePage` | `Show only rows whose ticker or company name matches` |
| `Update all` | `UniversePage` | `Fetch any missing price history for every ticker, up to the last close` |
| `Download Universe` | `UniversePage` | `Download every ticker's price history as a single zip` |
| Ticker input | `AddTickerForm` | `Enter a ticker symbol, for example AAPL` |
| `Add` button | `AddTickerForm` | `Fetch 10 years of price history and current fundamentals` |
| Per-row download icon | `UniverseTable` | `Download this ticker's full price history as CSV` |
| Per-group `clear` links | `FilterDialog` | `Clear only this filter` |
| `Clear all` (dialog) | `FilterDialog` | `Reset every filter to its default` |
| `Done` (dialog) | `FilterDialog` | `Close and apply` |

**Type and Sector chips are deliberately excluded.** A chip labelled `Technology` inside a group
labelled `Sector` explains itself; a tooltip there is noise, and noise on the obvious controls
dilutes the ones that carry real information. If you disagree, report it rather than adding them.

**Remove the `title` attributes** that this replaces, on every element above. **Keep** `title` on
`UniverseTable`'s `Name` cell — there it is a legitimate fallback for text truncated by CSS, not an
explanation.

## Out of scope

- No tooltips on the header nav — those items are inert placeholders (contract 0003) and describing
  a control that does nothing is worse than silence.
- No tooltips on Type/Sector chips. See above.
- No touch/long-press support.
- No arrow or caret on the tooltip.
- No rich content — plain strings only.
- No changes to the chart dialog; it does not exist yet (contract 0023).
- No new dependencies. No changes to `globals.css`.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`.**
2. `npm run build` succeeds.
3. `git diff --stat frontend/package.json` is empty — no dependency added.
4. `grep -rn "createPortal" frontend/src/components/Tooltip.tsx` matches — the portal is used.
5. `grep -rn 'title=' frontend/src/pages/UniversePage.tsx frontend/src/components/AddTickerForm.tsx frontend/src/components/FilterDialog.tsx`
   matches nothing (exit 1) — every explanatory `title` replaced.
6. `grep -n 'title=' frontend/src/components/UniverseTable.tsx` matches **only** the `Name` cell's
   truncation fallback. Quote the line.
7. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/Tooltip.tsx` matches
   nothing (exit 1).
8. `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/components/Tooltip.tsx` matches
   nothing (exit 1).
9. Every string in the copy table appears verbatim in the codebase.
10. **The disabled case works.** With the ticker input empty, hovering `Add` shows its tooltip.
    This is the contract's reason for existing — verify it, do not infer it.
11. **The clipping case works.** At a width where the download column sits at the table's right
    edge, its tooltip renders fully and is not cut off by the card.
12. `git diff --stat frontend/src/lib/ frontend/src/api/ backend/` is empty.

Criteria 10 and 11 are the contract. If a browser is unavailable, say so plainly under "Not done"
rather than inferring from the code.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff --stat frontend/package.json ; echo "(empty = no deps)"
grep -rn "createPortal" frontend/src/components/Tooltip.tsx
grep -rn 'title=' frontend/src/pages/UniversePage.tsx frontend/src/components/AddTickerForm.tsx frontend/src/components/FilterDialog.tsx ; echo "exit=$? (1 means clean)"
grep -n 'title=' frontend/src/components/UniverseTable.tsx
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/Tooltip.tsx ; echo "exit=$? (1 means clean)"
git diff --stat frontend/src/lib/ frontend/src/api/ backend/ ; echo "(empty = untouched)"
```

## Tooltips — required for any contract adding interactive elements

This contract *is* that requirement. The copy table above is the enumeration.

## Human verification — does Gunnar need to run anything?

**Yes — the two cases that justify the whole contract cannot be checked any other way.**

At `localhost:5173/universe`:

1. **Leave the ticker box empty and hover `Add`.** The tooltip must appear even though the button is
   disabled. With `title` it showed nothing — that is the bug being fixed.
2. **Start `Update all`, then hover it while it runs.** Disabled, tooltip still shows.
3. **Hover a download icon in the rightmost column.** The tooltip must render fully, not be clipped
   by the card's rounded edge. Narrow the window so the column sits at the very edge and check again.
4. Hover `Filters`, the `×`, and `Download Universe` — each explains its effect, appearing after a
   short pause rather than instantly or after a second.
5. Tab through the controls with the keyboard — tooltips should appear on focus too.
6. Open the filter dialog and hover a `clear` link; the tooltip must sit above the overlay, not
   behind it.

## Open questions — do NOT resolve these yourself

- **Touch devices.** No long-press support; tooltips are pointer-and-keyboard only for now.
- **Whether the inert nav items should explain themselves.** They are placeholders; describing them
  would imply they work.
- **Tooltips on Type/Sector chips.** Excluded as noise. Report if you disagree; do not add them.
