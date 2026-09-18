# Contract 0045 — Dark mode, a theme selector, and the `/ops` page that hosts it

**Status:** accepted (2026-09-18) — audited by planner. Visual verification is Gunnar's and is the
real test; see Human verification.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

A working `/ops` page reachable from the gear icon, containing a **Theme** card with three toggles:
**Light**, **System**, **Dark**. The choice persists across reloads and applies with no flash.

Frontend only. System Health and Recent Job Runs are contract 0046.

## Why

Gunnar, 2026-09-18. The gear in the header has been inert since the first mockup, and the backend for
ops landed in contract 0044 with nothing rendering it.

**The app is already themeable and nobody planned it that way.** Every colour resolves from nine
custom properties in `:root`, and `@theme inline` maps every Tailwind utility onto them:

```css
@theme inline {
  --color-background:  var(--color-bg);
  --color-foreground:  var(--color-text);
  --color-brand-primary: var(--color-primary);
  ...
}
```

So overriding those nine under a `[data-theme="dark"]` selector flips the whole app. Audited
2026-09-18, the only literal colour anywhere in `components/` and `pages/` is `text-white`, in **8
places — every one of them on `bg-brand-primary` or `bg-brand-negative`**, both of which stay
saturated in dark mode. Those need no change. `bg-brand-surface/95`, `bg-brand-primary/10` and
`bg-brand-border/40` derive from tokens and follow for free.

### The one thing that inverts wrongly

**`bg-foreground/35` is used on all three modal backdrops** — `ChartDialog.tsx:199`, `:338`, and
`FilterDialog.tsx:139`. `--color-foreground` *is* `--color-text`: navy today, **light** in dark mode.
Those backdrops would become a pale wash over a dark page — a scrim that lightens what it is meant to
dim. A backdrop must stay dark in **both** themes, so it needs its own token rather than deriving
from foreground.

### Why `localStorage` and not the backend

The universe is deliberately shared across users and sessions; a theme is not. Storing it server-side
would mean one person switching to dark changes it for everyone, and `app_state` is a key→*timestamp*
table that would need a schema change to hold a string. It also guarantees a flash: a round-trip
before first paint means the page renders light and then flips.

## Environment

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`** — the root
tsconfig has `files: []` and checks zero files.

`npm run lint` (oxlint) currently reports **exactly one** warning, `UniversePage.tsx:53`. That is the
baseline; do not fix it and do not exceed it.

There is **no frontend test runner** in this project. Correctness here rests on the greps below and on
human verification — so the greps are written to check constructs, not keywords.

**Restart the backend with `--reload` before any visual check.** If the frontend shows "API offline"
while the server logs 200s, your shell has a stale exported `CORS_ORIGINS`.

## Files

Create:
- `frontend/src/lib/theme.ts`
- `frontend/src/components/ThemeSelector.tsx`
- `frontend/src/pages/OpsPage.tsx`

Modify:
- `frontend/index.html` — the anti-flash script
- `frontend/src/styles/globals.css` — dark palette, overlay token
- `frontend/src/App.tsx` — the `/ops` route
- `frontend/src/components/Header.tsx` — point the gear at `/ops`
- `frontend/src/components/ChartDialog.tsx` — two backdrops
- `frontend/src/components/FilterDialog.tsx` — one backdrop

**Touch nothing else.** No backend file, no migration, no other component, and **no new dependency** —
no theme library, no `next-themes`, no context library. React state plus `localStorage` is enough.

Editing `index.html` is legitimate here: the standing rule against it bans **verification harnesses**,
not application changes.

## 1. The dark palette

Add to `globals.css`, after the existing `:root`:

```css
:root[data-theme="dark"] {
  --color-bg:       #0d1117;
  --color-surface:  #161b22;
  --color-border:   #262d38;
  --color-text:     #e6edf3;
  --color-muted:    #8b98a9;
  --color-primary:  #5b8dd9;
  --color-accent:   #f2a900;
  --color-positive: #3fb950;
  --color-negative: #f85149;
}
```

`--color-primary` **must lighten**. `#012169` is a button background *and* heading text
(`text-brand-primary`); left unchanged it would be unreadable as text on a dark background. `#5b8dd9`
keeps white button text legible while working as text. The gold accent is unchanged — it already
reads on dark.

**These nine values are a starting point, not a decision.** Gunnar judges them on screen; they are
nine lines in one block and cheap to change. Do not scatter dark-mode values anywhere else — one
block, or the next adjustment becomes an archaeology exercise.

## 2. The overlay token

```css
:root                  { --color-overlay: rgb(12 35 64 / 0.35); }
:root[data-theme="dark"] { --color-overlay: rgb(0 0 0 / 0.6); }
```

Expose it in `@theme inline` as `--color-overlay` so `bg-overlay` compiles, then replace
`bg-foreground/35` with `bg-overlay` at **all three** sites. Light mode keeps today's exact navy wash
— `rgb(12 35 64 / 0.35)` is `#0C2340` at 35%, which is what `bg-foreground/35` resolves to now, so
**light mode must look pixel-identical afterwards**.

## 3. `lib/theme.ts` — pure where it can be

```ts
export type ThemePreference = 'light' | 'system' | 'dark'

export const THEME_STORAGE_KEY = 'bec-theme'

/** Validates an unknown stored value. Anything unrecognised, including null, is 'light'. */
export function parsePreference(raw: string | null): ThemePreference

/** Pure: which theme actually applies. `prefersDark` is passed in, never read from matchMedia here. */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean): 'light' | 'dark'
```

`resolveTheme` takes `prefersDark` as an argument for the same reason every function in `lib/` takes
`now` as an argument — a function that reads the environment itself cannot be reasoned about or
tested. The `matchMedia` call belongs in the component.

Also export the one impure helper:

```ts
/** Sets data-theme on <html>. 'light' removes the attribute rather than setting it. */
export function applyTheme(theme: 'light' | 'dark'): void
```

Removing the attribute for light keeps light mode the true default — the CSS has no
`[data-theme="light"]` block and must not need one.

## 4. No flash on load

An inline script in `index.html`'s `<head>`, **before** the stylesheet link and before the module
script. It must run before first paint:

```html
<script>
  (function () {
    try {
      var p = localStorage.getItem('bec-theme');
      var dark = p === 'dark' || (p === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    } catch (e) {}
  })();
</script>
```

**The `try/catch` is required**, not defensive noise: `localStorage` throws on access in some privacy
modes, and an uncaught throw here runs before React mounts and leaves a blank page.

It duplicates a little logic from `lib/theme.ts`, deliberately. A module import cannot run before
paint. Comment it as such so nobody "deduplicates" it later and reintroduces the flash.

## 5. `ThemeSelector.tsx`

```tsx
export function ThemeSelector(): JSX.Element
```

- State initialised from `parsePreference(localStorage.getItem(THEME_STORAGE_KEY))`.
- Three buttons — **Light · System · Dark** — as a segmented control: one bordered group, the active
  one filled `bg-brand-primary text-white`.
- Selecting writes `localStorage` and calls `applyTheme(resolveTheme(pref, prefersDark))`.
- **When the preference is `system`, follow the OS live.** Subscribe to
  `matchMedia('(prefers-color-scheme: dark)')` with `addEventListener('change', …)` and re-apply.
  Return the unsubscribe from the effect. Without this, "System" only works at page load.
- `aria-pressed` on each button, and a project `Tooltip` on each: `Always light`,
  `Follow your system setting`, `Always dark`.

## 6. `OpsPage.tsx`, the route, and the gear

- `OpsPage` mirrors `UniversePage`'s shell: `min-h-screen`, `max-w-screen-2xl mx-auto px-4 sm:px-6
  pt-10 pb-20`, an `<h1>Operations</h1>` and a one-line subtitle.
- One card for now — `bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5` —
  headed **Theme**, containing `ThemeSelector`. Contract 0046 adds System Health and Recent Job Runs
  above it.
- `App.tsx`: `<Route path="/ops" element={<OpsPage />} />`, before the `*` catch-all.
- `Header.tsx`: the gear already renders through `NavItem`, which supports `to` — add `to="/ops"` and
  change nothing else about it.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
2. `npm run lint` reports **exactly one** warning, still `UniversePage.tsx:53`.
3. `grep -rn "bg-foreground/" frontend/src/` matches **nothing** (exit 1) — all three backdrops
   converted.
4. `grep -o "bg-overlay{[^}]*}" frontend/dist/assets/*.css` matches — the utility **compiled**, not
   merely typed. A Tailwind arbitrary/theme utility that fails to generate is silent.
5. `grep -o 'data-theme="dark"[^}]*}' frontend/dist/assets/*.css | head -1` shows the dark block
   reached the bundle.
6. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/components/ThemeSelector.tsx frontend/src/pages/OpsPage.tsx frontend/src/lib/theme.ts`
   matches nothing (exit 1) — the palette lives in `globals.css` alone.
7. `grep -n "localStorage" frontend/index.html` matches, and the script tag appears **before** both
   the stylesheet `<link>` and `/src/main.tsx`. Quote the surrounding lines.
8. `grep -n "matchMedia" frontend/src/components/ThemeSelector.tsx` matches, together with
   `addEventListener` — System must follow the OS live, not only at load.
9. `grep -n "to=\"/ops\"" frontend/src/components/Header.tsx` and
   `grep -n "path=\"/ops\"" frontend/src/App.tsx` both match.
10. `grep -rn "prefersDark" frontend/src/lib/theme.ts` — `resolveTheme` takes it as a **parameter**;
    `grep -n "matchMedia" frontend/src/lib/theme.ts` matches **nothing** (exit 1).
11. `git diff --stat backend/` is empty.
12. `git status --porcelain` lists nothing outside this contract's files.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -rn "bg-foreground/" frontend/src/ ; echo "(exit $? — 1 = correct)"
grep -o "bg-overlay{[^}]*}" frontend/dist/assets/*.css
grep -c 'data-theme="dark"' frontend/dist/assets/*.css
grep -n "localStorage\|stylesheet\|main.tsx" frontend/index.html
grep -n "matchMedia\|addEventListener" frontend/src/components/ThemeSelector.tsx
grep -n "matchMedia" frontend/src/lib/theme.ts ; echo "(exit $? — 1 = correct)"
git diff --stat backend/ ; echo "(empty = backend untouched)"
git status --porcelain
```

## Human verification — does Gunnar need to run anything?

**Yes. There is no frontend test runner, so this is the real verification.**

1. Click the gear. `/ops` loads, the gear shows as the active nav item.
2. **Dark** — the whole app inverts: launch page, universe table, news cards, briefing panel.
3. **Reload on dark.** There must be **no white flash** before it paints. That is the inline script
   working; if you see a flash, it is in the wrong place in `<head>`.
4. Open a chart and the filter dialog in dark mode. **The backdrop must darken the page, not lighten
   it.** This is the bug this contract exists to prevent — check it specifically.
5. **System** — change macOS between Light and Dark with the page open. It should follow **without a
   reload**.
6. **Light** — confirm it looks exactly as it does today. Nothing should have shifted.
7. Judge the dark palette. Check specifically: the navy `Add` / `Refresh` buttons, `text-brand-primary`
   headings, the red/green change percentages, and the ticker strip. **Say which values look wrong**
   — they are nine lines in one block.

## Out of scope

- No System Health or Recent Job Runs card — contract 0046, on this same page.
- No backend change. The preference is per-browser and never leaves it.
- No theme library, no context provider, no new dependency.
- No dark-mode-specific shadow tuning. `shadow-sm/md/xl` are black-based and go nearly invisible on
  dark surfaces; the borders carry the separation. Note it if it looks flat, do not fix it here.
- No transition animation on theme switch.
- No per-page or per-component theme overrides.

## Open questions — do NOT resolve these yourself

- **The nine dark values.** Starting point only; Gunnar judges them on screen.
- **Whether dark mode needs its own shadow treatment**, or whether borders suffice.
- **Whether the chart's recharts colours need dark-mode variants.** `ChartDialog` passes token-derived
  colours, so it should follow — confirm visually at step 7 rather than assuming.
- **Whether `/ops` should require a secret** once deployed. Unchanged from 0044.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-18)

- `tsc -p tsconfig.app.json --noEmit` clean; `npm run build` succeeds
- `npm run lint` → exactly **1** warning, the `set-state-in-effect` baseline. It now reports
  `UniversePage.tsx:60` rather than `:53` — the line moved when the planner lazy-loaded `ChartDialog`
  in the 2026-09-18 audit. Same rule, same site, same count.
- `bg-foreground/` → exit 1. All three backdrops converted.
- Built CSS carries both rules, verified in the bundle rather than the source:
  `bg-overlay{background-color:var(--color-modal-overlay)}` and
  `[data-theme=dark]{--color-bg:#0d1117; … --color-modal-overlay:#0009}`
- `matchMedia` absent from `lib/theme.ts`; `resolveTheme` takes `prefersDark` as a parameter
- Route, gear wiring, and no-literal-colour greps all as specified; `git diff --stat backend/` empty

### Two planner errors the implementer caught

1. **`--color-overlay: var(--color-overlay)` in `@theme inline` is a self-reference** that resolves to
   nothing. Naming the source token `--color-modal-overlay` and mapping it to the Tailwind-facing
   `--color-overlay` is the correct fix, and the implementer explained why rather than silently
   renaming.
2. **Criterion 5's grep could never match.** The minifier strips quotes from attribute selectors, so
   the built output is `[data-theme=dark]`, not `[data-theme="dark"]`. The rule was present and
   correct; the criterion was wrong about the output format.

It also caught two of its own false-positive greps — an explanatory comment quoting `bg-foreground/35`
verbatim, and a docstring naming `matchMedia` — and reworded both rather than reporting a clean grep
over unclean source. That is the third time this session that a comment has tripped a negative grep;
it is a real hazard of grep-based criteria.

### One fix applied by the planner

The contract required `try/catch` around `localStorage` in the inline script **because it throws
outright in some privacy modes** — then let `ThemeSelector` read it unguarded inside a `useState`
initialiser, which would crash `/ops` during render in exactly that case. Added `readStoredPreference`
and `storePreference` to `lib/theme.ts`, both guarded; the component no longer touches `localStorage`
directly (`grep localStorage ThemeSelector.tsx` → exit 1).

### Not verified, and it is the substance

No frontend test runner exists, so the palette itself, the absence of flash on reload, live OS
switching, and the dark backdrops are all Gunnar's to judge. The mechanics are confirmed — correct CSS
in the bundle, correct selector specificity, correct subscription lifecycle — but "does it look right"
is not a property any of that establishes.
