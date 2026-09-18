# Contract 0047 — Separate action buttons from selection states

**Status:** not started
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Solid navy stops meaning two different things. It keeps marking things that **do** something, and the
three places it currently marks a **selected** option switch to a tinted treatment.

Frontend only. Three call sites. No new tokens, no new dependency, no backend change.

## Why

Gunnar, 2026-09-18, asking whether specific buttons could take different colours. The survey behind
that is the reason to do it: **`bg-brand-primary` currently carries seven distinct jobs.**

```
Add ticker · Apply filters · carousel pager        ← actions
active filter chip · active chart range · active theme toggle   ← selections
filter-count badge                                  ← indicator
```

The app otherwise has a working colour logic — navy for the primary action, red for destructive,
neutral bordered for secondary. Overloading navy across both "press this" and "this one is chosen"
means the active theme toggle carries the same visual weight as `Add ticker`, which is a real
action that fetches ten years of history.

**Assigning colours by location would break that logic.** "Add is green, toggles are purple" replaces
a semantic system with an arbitrary one. The distinction worth drawing is by **role**.

**The pattern already exists in this codebase.** `UniverseTable.tsx:30` marks an ETF with
`bg-brand-primary/10 text-brand-primary` — a tinted chip, not a fill. Reuse that exactly; it costs no
new token and follows dark mode for free, because both halves resolve from `--color-primary`.

## Environment

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

`npm run lint` (oxlint) reports **exactly one** warning, the `set-state-in-effect` baseline in
`UniversePage.tsx`. Do not fix it, do not exceed it. Match on the rule and the count, not the line —
it has moved three times this session.

There is **no frontend test runner.** This is a visual change; the greps below fix the mechanics and
Gunnar judges the result.

**Dark mode shipped in contract 0045.** Every colour must resolve from a token. `bg-brand-primary/10`
compiles to `color-mix(in oklab, var(--color-primary) 10%, transparent)` and therefore follows the
theme automatically — a literal colour would not.

## Files

Modify:
- `frontend/src/components/ThemeSelector.tsx`
- `frontend/src/components/ChartDialog.tsx`
- `frontend/src/components/FilterDialog.tsx`

**Touch nothing else.** Not `globals.css`, not `AddTickerForm.tsx`, not `NewsSection.tsx`, not
`UniversePage.tsx`, not `UniverseTable.tsx`, no backend file, no page. **No new dependency and no new
CSS custom property** — this contract adds no colour, it reassigns an existing one.

## The three changes, and only these three

### 1. `ThemeSelector.tsx` — the active theme toggle

```
- active ? 'bg-brand-primary text-white'
+ active ? 'bg-brand-primary/10 text-brand-primary font-semibold'
```

The inactive branch is unchanged.

### 2. `ChartDialog.tsx` — the active range button

```
- active ? 'bg-brand-primary text-white'
+ active ? 'bg-brand-primary/10 text-brand-primary font-semibold'
```

The inactive branch, the `disabled:` classes and the `border border-transparent` base are all
unchanged.

### 3. `FilterDialog.tsx` — the selected filter chip

```
- const CHIP_ON = 'bg-brand-primary border-brand-primary text-white'
+ const CHIP_ON = 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold'
```

**Keep `border-brand-primary` solid.** `CHIP_OFF` is `bg-brand-surface border-brand-border
text-[var(--color-muted)]`, so the border is what separates a chosen chip from an unchosen one at a
glance; the tint alone is too quiet against a surface that is already near-white in light mode.

### `font-semibold` is load-bearing, not decoration

A 10% wash is a weaker signal than a solid fill. In a segmented control the selected option must be
unmistakable, so the weight change carries what the fill used to. **Do not drop it** as redundant
styling — without it the theme toggles in particular become hard to read at a glance.

## What must NOT change

These use `bg-brand-primary` and are **actions or indicators**, not selections:

| site | why it stays |
|---|---|
| `AddTickerForm.tsx:53` — Add | a real action; fetches ten years of history |
| `FilterDialog.tsx:278` — Apply | a real action |
| `NewsSection.tsx:151` — carousel pager | a real action |
| `UniversePage.tsx:150` — filter-count badge | an indicator, and small enough that a tint would lose it |
| `UniverseTable.tsx:30` — ETF chip | already tinted; this is the pattern being copied |

And the destructive/status colours are untouched: `ChartDialog.tsx:328` and `:382` (red Delete),
`BackendStatus.tsx:33`, `SystemHealthCard.tsx:93`, `JobRunsCard.tsx` pills, `EntryCard.tsx:13` gold.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
2. `npm run lint` reports **exactly one** warning, still the `set-state-in-effect` rule.
3. `grep -rn "bg-brand-primary text-white" frontend/src/` matches **exactly three** lines —
   `AddTickerForm.tsx`, `FilterDialog.tsx` (the Apply button), `NewsSection.tsx`. Quote all three.
   Any fourth means a selection state was missed; any fewer means an action was changed by mistake.
4. `grep -rn "bg-brand-primary/10" frontend/src/` matches **four** lines — the three changed sites
   plus the pre-existing `UniverseTable.tsx`. Quote them.
5. `grep -n "CHIP_ON" frontend/src/components/FilterDialog.tsx` shows `border-brand-primary` still
   present. Quote it.
6. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/components/ThemeSelector.tsx frontend/src/components/ChartDialog.tsx frontend/src/components/FilterDialog.tsx`
   matches nothing (exit 1).
7. `git diff --stat frontend/src/styles/globals.css frontend/src/components/AddTickerForm.tsx frontend/src/components/NewsSection.tsx frontend/src/components/UniverseTable.tsx frontend/src/pages/ backend/`
   is **empty** — no token added, no action restyled, no page touched.
8. `grep -o "bg-brand-primary\\\\/10{[^}]*}" frontend/dist/assets/*.css` matches — the utility
   **compiled**. A Tailwind opacity utility that fails to generate is completely silent, and this
   contract's entire visual effect depends on it.
9. `git status --porcelain` lists nothing outside this contract's three files.
   **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -rn "bg-brand-primary text-white" frontend/src/
grep -rn "bg-brand-primary/10" frontend/src/
grep -n "CHIP_ON" frontend/src/components/FilterDialog.tsx
grep -o "bg-brand-primary\\\\/10{[^}]*}" frontend/dist/assets/*.css
git diff --stat frontend/src/styles/globals.css frontend/src/pages/ backend/ ; echo "(empty = untouched)"
git status --porcelain
```

## Human verification — does Gunnar need to run anything?

**Yes, and in both themes — this is a purely visual change.**

1. `/ops` — the Theme control. The selected option should read as *chosen* without shouting. Compare
   it against the `Add` button on `/universe`: `Add` should now clearly look like the heavier element.
2. Open a chart. The active range (`YTD` by default) should be obviously selected but quieter than
   before.
3. Open Filters and select a few chips. A chosen chip keeps its solid navy outline; the fill is now a
   wash.
4. **Switch to Dark and repeat all three.** `bg-brand-primary/10` over `#161b22` is a much subtler
   wash than over white — this is where the change is most likely to be too quiet. Say so if the
   selected state is hard to pick out; the fix is the opacity (`/10` → `/20`), one character per site.
5. Confirm nothing else moved: `Add`, `Apply filters`, the news carousel arrows and the filter-count
   badge should all look exactly as before.

Point 4 is the one I would expect to need adjusting.

## Out of scope

- No new colour, token or CSS custom property. Gold stays where it is.
- No change to any action button, badge, status dot or destructive button.
- No change to `globals.css` or the dark palette.
- No hover-state redesign — the inactive/hover branches stay as they are.
- No change to spacing, radius, typography or layout.

## Open questions — do NOT resolve these yourself

- **Whether `/10` is strong enough in dark mode.** Judged on screen; one character per site to change.
- **Whether the gold accent should take a role** now that navy is less overloaded. It is currently used
  for the `Coming soon` pill, the `partial` job pill and one text accent — no button.
- **Whether the filter-count badge should also soften.** Left solid deliberately; it is an indicator,
  not a selection.
- **What happens to the four `Coming soon` cards.** Still open.
