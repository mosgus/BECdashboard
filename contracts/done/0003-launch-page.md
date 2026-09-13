# Contract 0003 — Launch page shell

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The Vite app's root page renders the Blue Eagle launch page — logo, wordmark, four inert header
nav items, hero, and four explanatory cards in the Emory palette — matching the approved mockup,
with a live backend status indicator as the only working behaviour.

## Why

First slice of a deliberately UI-first workflow: build the visual shell, Gunnar looks at it, then
later slices add behaviour. The design is already settled — it was iterated to approval against a
static mockup rather than in the abstract.

`REBUILD.md` decided ("Launch page: header nav is the only navigation; entry cards are
explanatory") that the four header items are the app's navigation and the four cards describe what
the dashboard does. That distinction is load-bearing and this contract enforces it structurally.

**Depends on contract 0002.** If `frontend/src/App.tsx`, `frontend/src/api/client.ts` and
`frontend/src/styles/globals.css` do not exist, stop and report `BLOCKED`.

## The mockup is the visual target

`mockup-launch.html` at the repo root is an approved, throwaway static mockup. **Open it and match
it.** It is plain CSS against the same custom properties Tailwind is bound to, so every value in it
has a Tailwind equivalent.

- It is a *reference*, not a file to port. Do not import it, link it, copy its `<style>` block, or
  move it into `frontend/`.
- Where it uses a raw custom property (`var(--color-surface)`), use the Tailwind token class
  (`bg-brand-surface`). Where it uses a literal (`0.875rem`), use the matching Tailwind scale step.
- If the mockup and this contract disagree, **this contract wins** — report the discrepancy.
- Do not delete it. Gunnar removes it when he's done with it.

### What "inert" means here, and why

Every control except the status indicator is non-functional **by design**. That is the point of the
slice, not an omission — do not wire anything up, and do not treat a dead control as a defect.

The two groups are inert for *different* reasons, and must be built differently:

- **Nav items** are navigation with nowhere to go yet. Routing is an open question below.
- **Entry cards** are explanatory copy that must *never* become clickable, now or later. They are
  the equivalent of `main`'s `WORKFLOW_STEPS` block, not links.

## Files

Create:
- `frontend/public/logo-nav.png` — copy of `assets/logo-nav.png` (64×64 PNG, unmodified)
- `frontend/src/components/Header.tsx` — logo, wordmark, nav, status
- `frontend/src/components/NavItem.tsx` — one inert nav item
- `frontend/src/components/SettingsIcon.tsx` — inlined lucide `settings` path
- `frontend/src/components/EntryCard.tsx` — one explanatory card
- `frontend/src/components/BackendStatus.tsx` — the live indicator

Modify:
- `frontend/src/App.tsx` — replace the 0002 scaffold content with the launch page composition

Copy the logo with `cp assets/logo-nav.png frontend/public/logo-nav.png`. Do not re-encode,
resize, rename, or optimize it.

**Touch nothing else.** Do not modify `globals.css`, `index.html`, `vite.config.ts`,
`package.json`, `src/api/client.ts`, `mockup-launch.html`, or anything under `backend/`. If the
work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `src/components/SettingsIcon.tsx`

```tsx
export function SettingsIcon(): JSX.Element
```

Renders a 16×16 SVG, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
`strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`, containing exactly this path
plus `<circle cx="12" cy="12" r="3" />`:

```
M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915
```

This is lucide-react v0.575.0's `settings` icon, ISC-licensed. **Keep an attribution comment naming
the source and licence.** Do **not** add `lucide-react` to `package.json` — one icon does not
justify the package, and `REBUILD.md` records this.

### `src/components/NavItem.tsx`

```tsx
interface NavItemProps {
  label: string
  icon?: boolean       // true → render <SettingsIcon /> instead of the label
  title?: string       // native tooltip, used for the icon-only item
}

export function NavItem(props: NavItemProps): JSX.Element
```

- Rendered as a `<span>`, **not** an `<a>` and **not** a `<button>`. There is no route to navigate
  to; a real link with no destination is a broken link.
- Styling matches `main`'s header links: `text-sm font-medium text-brand-muted`,
  `rounded-[var(--radius-btn)]`, `px-3 py-1.5`, hover `bg-brand-border text-foreground`,
  `transition-colors`, `cursor-default`.
- Icon variant uses square `p-1.5` padding instead of `px-3 py-1.5`.
- No `onClick`, no `href`.

**`text-brand-muted` does not exist.** `--color-muted` is defined in `:root` but is not exposed
through `@theme inline`, so Tailwind generates no class for it. Use `text-[var(--color-muted)]`
wherever this contract says "muted" — that is the one arbitrary-value exception, and it does not
count as a hardcoded colour under criterion 5.

The `@theme inline` block exposes exactly eight colour tokens: `background`, `foreground`,
`brand-primary`, `brand-accent`, `brand-surface`, `brand-border`, `brand-positive`,
`brand-negative`. Everything else in `globals.css` (`--color-muted`, `--radius-card`,
`--radius-btn`, the fonts) is a raw custom property reached with `var()`. Check that block before
assuming a class exists.

### `src/components/Header.tsx`

```tsx
export function Header(): JSX.Element
```

Sticky (`sticky top-0 z-50`), `h-14`, `bg-brand-surface/95` with `backdrop-blur-sm`, bottom border
`border-b border-brand-border`. Inner container `max-w-screen-xl mx-auto px-4 sm:px-6`,
`flex items-center justify-between`.

Left: `<img src="/logo-nav.png" alt="Blue Eagle Capital" width={32} height={32} className="rounded-full" />`,
then wordmark `Blue Eagle Capital` (`font-bold tracking-tight text-brand-primary`), then muted
subtitle `Portfolio Analytics` hidden below `md`.

Right: the nav, then `<BackendStatus />`. Nav items in this exact order:

| label | icon | title |
|---|---|---|
| `Universe` | no | — |
| `Portfolios` | no | — |
| `Research` | no | — |
| — | yes | `Settings & Ops` |

Below `md`: hide the subtitle and the status *label* (keep the dot), and tighten nav padding, so
the header never wraps. Verify at 375px.

### `src/components/BackendStatus.tsx`

```tsx
export function BackendStatus(): JSX.Element
```

The only component with real behaviour. It preserves contract 0002's proof that the two halves
talk, which would otherwise be deleted along with the scaffold page.

- Calls `getHealth()` from `src/api/client.ts` on mount via `useState` + `useEffect`. Do not add a
  data-fetching library.
- Three states — a `w-2 h-2 rounded-full` dot plus a `text-xs` label:
  - loading → muted dot at reduced opacity, label `Connecting…`
  - success → `bg-brand-positive`, label `` `API ${python}` `` (e.g. `API 3.13.15`)
  - error → `bg-brand-negative`, label `API offline`
- An error must not throw, must not blank the page, and must not surface as an unhandled rejection.

### `src/components/EntryCard.tsx`

```tsx
interface EntryCardProps {
  title: string
  description: string
}

export function EntryCard(props: EntryCardProps): JSX.Element
```

- Rendered as an `<article>`. **No `available` prop, no variants, no interactivity, ever.** These
  cards are explanatory copy — `REBUILD.md` records that they must never become navigation.
- `bg-brand-surface`, `border border-brand-border`, `rounded-[var(--radius-card)]`, `p-6`,
  `min-h-44`, flex column, `cursor-default`.
- Title: `text-[17px] font-semibold text-foreground`. Description: `text-sm leading-relaxed`, muted,
  `flex-1`.
- Gold pill at the bottom, `self-start`: text `Coming soon`, `bg-brand-accent text-foreground`,
  `text-[11px] font-medium`, `px-2.5 py-1`, `rounded-full`.
- No `onClick`, no `href`, no hover state.

### `src/App.tsx`

Composition only. No state beyond what `BackendStatus` owns internally.

```
<Header />
<main class="max-w-screen-xl mx-auto px-4 sm:px-6 pt-16 pb-20">
  <section>  h1 "Blue Eagle Capital"
             p  "Portfolio construction, optimization, and risk analytics."
  <section>  grid of four <EntryCard />
</main>
```

Hero: `h1` at `text-[2.5rem] font-bold tracking-tight text-brand-primary leading-[1.1]`; paragraph
`text-lg font-light` muted, `max-w-xl`, `mt-3.5`. Card grid `mt-14`, `gap-5`,
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`.

The four cards, in this order and with this exact copy:

| title | description |
|---|---|
| `Portfolio` | `Build a portfolio by entering positions manually or importing a CSV.` |
| `Optimize` | `Mean-variance, risk parity, and target-volatility allocation.` |
| `Risk` | `Volatility, drawdown, correlation, and exposure analysis.` |
| `Outlook` | `Forward-looking projections and scenario analysis.` |

Page background `bg-background`, body text `text-foreground`.

**There is no `font-heading` utility class.** `--font-heading` and `--font-body` live in `:root` but
are not exposed through `@theme inline`, so Tailwind generates no class for them. Headings already
get Outfit from the `h1..h6` rule in `globals.css`. Use semantic `<h1>`/`<h2>`; do not add font
tokens to `globals.css` and do not inline `style={{fontFamily: ...}}`.

## Out of scope

- **No router.** No `react-router-dom`, no route tree, no `href`s, no commented-out routes.
- **No new dependencies at all**, including `lucide-react`. `package.json` must be unchanged.
- No portfolio form, ticker input, table, or CSV upload. Later slices.
- No chart library, no `recharts`.
- No test framework — frontend verification is typecheck + build per `REBUILD.md`.
- No changes to `globals.css`. The palette is decided and ported verbatim by 0002.
- No favicon work, no Google Fonts changes — 0002 owns `index.html`.
- No dark mode, no theme switching.
- Do not port any component from `main`. Its `layout.tsx` is a different app; the nav styling above
  is specified here deliberately so you do not need to open it.
- Do not modify, relocate, or delete `mockup-launch.html`.
- Do not build `/universe`, `/portfolios`, `/research` or `/ops` pages. See open questions.

## Acceptance criteria

0. **Every file in the Files list above exists** — see the `ls` command in the verification block.
   (Contract 0001 shipped with a required file silently missing because nothing checked for it.)
1. `npx tsc -p tsconfig.app.json --noEmit` in `frontend/` produces no output and exits 0.
2. `npm run build` in `frontend/` succeeds and writes to `frontend/dist/`.
3. `git diff --stat frontend/package.json` is empty — no dependency added.
4. `frontend/public/logo-nav.png` is byte-identical to `assets/logo-nav.png`
   (`cmp` exits 0).
5. No hardcoded colours: `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/` matches
   nothing (exit 1).
6. No `any`, no non-null assertions:
   `grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/` matches nothing (exit 1).
7. No interactive elements anywhere in `frontend/src/components/` — including `BackendStatus`,
   which needs none: `grep -rnE '<a |<button|onClick|href=' frontend/src/components/` matches
   nothing (exit 1).
8. With the backend running: logo, wordmark, four nav items (the fourth a gear icon), hero, four
   `Coming soon` cards, and a green dot reading `API 3.13.x`.
9. **With the backend stopped**: the page still renders completely, dot red, label `API offline`.
   No blank page, no uncaught console error.
10. At 375px width the header does not wrap and no content overflows horizontally.

Criteria 9 and 10 are the ones most likely to be skipped. Do not report them as passing without
actually stopping the backend and actually narrowing the viewport.

## Verification to run and paste

Run each and paste the **complete, verbatim** output, including failures.

```bash
ls -1 frontend/public/logo-nav.png frontend/src/components/Header.tsx frontend/src/components/NavItem.tsx frontend/src/components/SettingsIcon.tsx frontend/src/components/EntryCard.tsx frontend/src/components/BackendStatus.tsx frontend/src/App.tsx
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git diff --stat frontend/package.json ; echo "(empty above = no deps added)"
cmp assets/logo-nav.png frontend/public/logo-nav.png && echo "logo identical"
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/ ; echo "exit=$? (1 means clean)"
grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/ ; echo "exit=$? (1 means clean)"
grep -rnE '<a |<button|onClick|href=' frontend/src/components/ ; echo "exit=$? (1 means clean)"
```

For criteria 8–10, load the page three ways — backend up, backend stopped, and at 375px — and paste
what renders plus the full browser console for each. If you cannot drive a browser, say so plainly
in the report under "Not done." **Do not claim any of them passed without observing it.**

Backend start command (contract 0001's venv, from `backend/`):

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m uvicorn app.main:app --port 8000
```

## Not an acceptance criterion

Gunnar's visual approval. It is a separate gate applied after the criteria above pass, and the
audit cannot re-verify it. If he asks for changes, that is a follow-up contract, not a failure of
this one.

## Open questions — do NOT resolve these yourself

- **Routing.** Whether the app gets `react-router-dom` with real URLs or stays a single page with
  inert nav is undecided and recorded as open in `REBUILD.md`. Do not add routing, do not make nav
  items navigate, do not scaffold route files.
- **Whether `Universe`, `Research` and `/ops` survive as features.** Three of the four nav
  destinations contradict `REBUILD.md`'s cut list — `/ops` in particular was backed by `job_runs`,
  `audit_log` and `email_config`, none of which exist in this rebuild. The *labels* are settled;
  what they point to is not. Do not build those pages and do not add placeholder routes for them.
- **Whether the entry cards get numbered** (`1 · Portfolio`, …) to read as a sequence rather than
  as destinations. Proposed and not yet answered. Build them unnumbered as specified above.
