# Contract 0048 — Dedicated CSS variables for button colours

**Status:** accepted (2026-09-18) — audited by planner. Gunnar has since tuned the token values.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Button colours come from their own CSS custom properties instead of borrowing the palette tokens, so
a button's colour can be changed in one place without dragging headings, badges and status dots with
it.

Frontend only. New tokens in `globals.css`, then eight call sites switched onto them.

## Why

Gunnar, 2026-09-18, asked for exactly this. The reason it is worth doing is concrete:
**`--color-primary` is not a button colour, it is the brand navy**, and it currently drives all of:

```
Add ticker · Apply filters · carousel pager        ← buttons
active theme toggle · chart range · filter chip    ← selected states (contract 0047)
every h1/h2 heading · the ETF chip · filter-count badge · a text accent
```

So "make the Add button gold" is currently impossible without turning every heading gold. A button
token layer decouples the two: the tokens **default to the existing palette**, so nothing looks
different on day one, and changing a button afterwards is a one-line edit in one file.

### It also fixes a live bug

`AddTickerForm.tsx:53` carries `dark:text-foreground`, committed in `711999c`. Tailwind's `dark:`
variant compiles to:

```css
@media (prefers-color-scheme:dark){.dark\:text-foreground{color:var(--color-text)}}
```

That keys off the **operating system**, not this app's `[data-theme="dark"]` attribute. With OS dark
and the app's theme set to **Light**, the Add button renders `--color-text` — navy `#0C2340` in light
mode — on `bg-brand-primary`, navy `#012169`. **Navy on navy: the label disappears.** One of four
theme/OS combinations, and a common one on a Mac.

**Do not fix this by adding more `dark:` variants.** Every one of them will key off the OS and
disagree with the theme selector. Per-theme button text is exactly what
`--color-btn-*-text` exists to express: set it once in the dark block and the variant is unnecessary.

## Environment

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

`npm run lint` (oxlint) reports **exactly one** warning, the `set-state-in-effect` baseline in
`UniversePage.tsx`. Do not fix it, do not exceed it. Match on the rule and the count, not the line.

There is **no frontend test runner.** The greps below fix the mechanics; Gunnar judges the result.

**A Tailwind utility that fails to generate is completely silent.** Every new token must be checked in
`dist/assets/*.css`, not in the source. This has bitten the project three times.

## Files

Modify:
- `frontend/src/styles/globals.css` — the token block and the `@theme inline` mapping
- `frontend/src/components/AddTickerForm.tsx`
- `frontend/src/components/FilterDialog.tsx`
- `frontend/src/components/NewsSection.tsx`
- `frontend/src/components/ThemeSelector.tsx`
- `frontend/src/components/ChartDialog.tsx`

**Touch nothing else.** No backend file, no page, no other component, no `index.html`, no migration.
**No new dependency.** `reference files/` is read-only and is not involved here.

## 1. The tokens

Three roles, each a background and a foreground. Add to `globals.css` beside the existing tokens:

```css
:root {
  /* Buttons. Default to the palette so nothing changes visually on day one; the point of the
     indirection is that changing one of these no longer moves headings, chips or status dots. */
  --color-btn-action:        var(--color-primary);
  --color-btn-action-text:   #ffffff;
  --color-btn-selected:      var(--color-primary);
  --color-btn-selected-text: var(--color-primary);
  --color-btn-danger:        var(--color-negative);
  --color-btn-danger-text:   #ffffff;
}
```

And in the **dark** block, override only what needs to differ:

```css
:root[data-theme="dark"] {
  /* --color-btn-action resolves to the lightened dark-mode primary (#5b8dd9) automatically.
     White on it is about 3.5:1 — legible but thin — so dark mode uses the deep surface colour
     for button text instead. This is what AddTickerForm's `dark:` variant was reaching for, and
     it works here because it follows the theme attribute rather than the OS. */
  --color-btn-action-text: #0d1117;
  --color-btn-danger-text: #0d1117;
}
```

**`--color-btn-selected-text` equals `--color-btn-selected` on purpose** — the selected state is a
10% wash of the colour with the full-strength colour as text (contract 0047). Keeping them as two
tokens means a future change can break that tie without restructuring anything.

Expose all six in `@theme inline`:

```css
@theme inline {
  --color-btn-action:        var(--color-btn-action);   /* ← WRONG, see below */
}
```

**That is a self-reference and resolves to nothing** — the same trap contract 0045 hit with
`--color-overlay`. Name the source properties `--btn-action`, `--btn-action-text`, etc. **without**
the `--color-` prefix, and map them across:

```css
:root { --btn-action: var(--color-primary); --btn-action-text: #ffffff; ... }

@theme inline {
  --color-btn-action:        var(--btn-action);
  --color-btn-action-text:   var(--btn-action-text);
  --color-btn-selected:      var(--btn-selected);
  --color-btn-selected-text: var(--btn-selected-text);
  --color-btn-danger:        var(--btn-danger);
  --color-btn-danger-text:   var(--btn-danger-text);
}
```

That generates `bg-btn-action`, `text-btn-action-text`, `bg-btn-selected/10`, `text-btn-selected-text`,
`bg-btn-danger`, `text-btn-danger-text`.

## 2. The eight call sites

| file:line | now | becomes |
|---|---|---|
| `AddTickerForm.tsx:53` | `bg-brand-primary text-white dark:text-foreground` | `bg-btn-action text-btn-action-text` |
| `FilterDialog.tsx:278` (Apply) | `bg-brand-primary text-white` | `bg-btn-action text-btn-action-text` |
| `NewsSection.tsx:151` (pager) | `bg-brand-primary text-white` | `bg-btn-action text-btn-action-text` |
| `ThemeSelector.tsx:54` | `bg-brand-primary/10 text-brand-primary` | `bg-btn-selected/10 text-btn-selected-text` |
| `ChartDialog.tsx:313` | `bg-brand-primary/10 text-brand-primary` | `bg-btn-selected/10 text-btn-selected-text` |
| `FilterDialog.tsx:42` (`CHIP_ON`) | `bg-brand-primary/10 border-brand-primary text-brand-primary` | `bg-btn-selected/10 border-btn-selected text-btn-selected-text` |
| `ChartDialog.tsx:328` (Delete) | `bg-brand-negative text-white` | `bg-btn-danger text-btn-danger-text` |
| `ChartDialog.tsx:382` (confirm Delete) | `bg-brand-negative text-white` | `bg-btn-danger text-btn-danger-text` |

**`dark:text-foreground` is deleted, not translated.** It is the bug.

`font-semibold` on the three selected states stays (contract 0047 — the weight carries what the fill
used to). Every other class on every one of these elements — padding, radius, `hover:`, `disabled:`,
`whitespace-nowrap`, `pointer-events-none` — is unchanged.

## 3. What must NOT change

These use the palette tokens and are **not buttons**:

| site | why |
|---|---|
| `UniversePage.tsx:150` — filter-count badge | an indicator inside a button, not a button |
| `UniverseTable.tsx:30` — ETF chip | a data badge; it should track the brand, not the button |
| `BackendStatus.tsx:33`, `SystemHealthCard.tsx:93` | status dots |
| `JobRunsCard.tsx` status pills | data, not controls |
| `EntryCard.tsx:13` — gold pill | a label |
| every `text-brand-primary` heading | the whole point of the separation |

Secondary/neutral buttons — `Filters`, `Reset Filters`, `Retry`, `Refresh`, the download buttons — are
deliberately **out of scope**. They carry no colour of their own (`bg-brand-surface`,
`border-brand-border`, `text-[var(--color-muted)]`), and giving them tokens would triple the surface
area for no current benefit. Noted as an open question.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
2. `npm run lint` reports **exactly one** warning, still `set-state-in-effect`.
3. `grep -rn "dark:" frontend/src/` matches **nothing** (exit 1). The OS-keyed variant is gone and
   no new one was introduced.
4. All six utilities compiled — check the **built** CSS, not the source:
   `grep -oE "(bg|text|border)-btn-[a-z-]+(\\\\/10)?\{[^}]*\}" frontend/dist/assets/*.css`
   must show `bg-btn-action`, `text-btn-action-text`, `bg-btn-selected/10`, `text-btn-selected-text`,
   `border-btn-selected`, `bg-btn-danger`, `text-btn-danger-text`. Quote them.
5. `grep -o "\[data-theme=dark\]{[^}]*}" frontend/dist/assets/*.css` contains `--btn-action-text`
   — the dark override reached the bundle.
6. `grep -rn "bg-brand-primary\b" frontend/src/` matches **only** `UniversePage.tsx` (the badge).
   `grep -rn "bg-brand-negative\b" frontend/src/` matches **only** `BackendStatus.tsx` and
   `SystemHealthCard.tsx` (the dots). Quote both results in full — this is how we know no button was
   left behind and no non-button was converted.
7. `grep -n "text-brand-primary" frontend/src/` still matches the headings and `UniverseTable.tsx`.
   Quote them — headings must **not** have been swept into the button tokens.
8. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/components/ frontend/src/pages/`
   matches nothing (exit 1). The two literal hex values in this contract belong in `globals.css` only.
9. `git diff --stat frontend/src/pages/ frontend/src/components/UniverseTable.tsx frontend/index.html backend/`
   is **empty**.
10. `git status --porcelain` lists nothing outside this contract's six files.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -rn "dark:" frontend/src/ ; echo "(exit $? — 1 = correct)"
grep -oE "(bg|text|border)-btn-[a-z-]+(\\\\/10)?\{[^}]*\}" frontend/dist/assets/*.css
grep -o "\[data-theme=dark\]{[^}]*}" frontend/dist/assets/*.css
grep -rn "bg-brand-primary\b\|bg-brand-negative\b" frontend/src/
grep -rn "text-brand-primary" frontend/src/
git diff --stat frontend/src/pages/ frontend/index.html backend/ ; echo "(empty = untouched)"
git status --porcelain
```

## Human verification — does Gunnar need to run anything?

**Yes — and one check specifically targets the bug.**

1. **Light theme, nothing should look different.** Add, Apply, the news arrows, Delete, the theme
   toggles, chart ranges and filter chips should all be exactly as they are now. The tokens default
   to the same palette; if anything shifts in light mode, a mapping is wrong.
2. **The bug check.** Set macOS to **Dark**, then set the app's theme to **Light** on `/ops`. Go to
   `/universe` and look at the **Add** button. Before this contract its label was navy-on-navy and
   effectively invisible; it must now read clearly.
3. **Dark theme** — Add and Delete now use dark text on their lighter backgrounds. Check both read
   well; white-on-`#5b8dd9` was about 3.5:1, and this is the alternative.
4. Open a chart in dark and confirm the red Delete button still reads as destructive.
5. **Then try changing one.** In `globals.css`, set `--btn-action: var(--color-accent)` and reload —
   every action button turns gold and **no heading moves**. That is the whole point of the contract;
   revert it afterwards unless you like it.

Step 5 is the one that proves the contract did what it set out to do.

## Out of scope

- No secondary/neutral button tokens — see "What must NOT change".
- No change to any heading, badge, chip, status dot or pill.
- No new colour choices. Tokens default to today's palette; picking different values is a separate,
  one-line decision afterwards.
- No shared button component or extracted class constants. Tempting, and a much larger refactor.
- No change to the theme mechanism, `index.html`, or `lib/theme.ts`.

## Open questions — do NOT resolve these yourself

- **Whether secondary buttons deserve tokens too** (`Filters`, `Retry`, `Refresh`, downloads).
- **Whether `--btn-selected` should stop tracking `--color-primary`** now that it can.
- **Whether the dark-mode button text should be `#0d1117` or the `--color-bg` token** — using the
  token would couple button text to the page background, which may or may not be wanted.
- **Whether the eight sites should collapse into a shared `<Button>` component.** A real refactor,
  and easier to judge once the tokens exist.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-18)

- `tsc` clean, `npm run build` succeeds, `npm run lint` → exactly 1 warning (unchanged baseline)
- `grep -rn "dark:" frontend/src/` → **exit 1**. The OS-keyed variant is gone and no new one appeared.
- All seven utilities compiled in the bundle, each referencing the prefix-free source property, so the
  `@theme inline` self-reference trap was avoided:

```
bg-btn-action{background-color:var(--btn-action)}
bg-btn-danger{background-color:var(--btn-danger)}
bg-btn-selected\/10{background-color:color-mix(in oklab, var(--btn-selected) 10%, transparent)}
border-btn-selected{border-color:var(--btn-selected)}
text-btn-action-text{color:var(--btn-action-text)}
text-btn-danger-text{color:var(--btn-danger-text)}
text-btn-selected-text{color:var(--btn-selected-text)}
```

Gunnar has since adjusted the token values by hand — which is the point of the contract, and took a
one-line edit in one file.

### Separate defect found while assessing the page, and fixed

`app/jobrun.py:45` writes `detail["error"] = {"type": ..., "message": ...}` on a failed run — a nested
object. `summariseDetail` called `String(value)` on it, so a failure rendered as
**`"[object Object] error"`** on the ops page: the least useful possible output in the one situation
the card exists for. Undetected because the database holds no failure rows.

Fixed in `lib/opsFormat.ts`, generically rather than by special-casing the key:

- a nested object renders its values joined by `": "` → `RuntimeError: connection refused`
- a `true` boolean renders as the bare key (`briefing`, not `true briefing`); a `false` one is skipped

Verified against all four real detail shapes plus the no-briefing case.
