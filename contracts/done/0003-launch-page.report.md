# Report — Contract 0003, Launch page shell

**Executed by:** sonnet
**Status:** **accepted** (2026-09-13, no fixes required)

The coder reported in chat per the 2026-09-13 process change. This file exists because the audit
surfaced three defects **in the contract itself**, which are worth keeping for future sessions.

## Audit

**Verdict: accepted. The implementation is correct and I verified it independently. Every
deviation the coder reported was forced by a defect in my contract, not by a shortcut in its work,
and each one was reported rather than hidden.**

### Re-run verification (planner, against disk)

| check | result |
|---|---|
| All 7 files in Files list | present ✅ |
| `npx tsc -p tsconfig.app.json --noEmit` (**real** typecheck) | clean ✅ |
| `npm run build` | 22 modules, `dist/` written ✅ |
| `cmp assets/logo-nav.png frontend/public/logo-nav.png` | identical ✅ |
| `git diff --stat frontend/package.json` | empty — no deps added ✅ |
| hardcoded colours, scoped to contract's files | exit 1 ✅ |
| `any` / non-null, scoped to contract's files | exit 1 ✅ |
| interactive elements in `components/` | exit 1 ✅ |
| `main.tsx` imports | only `./styles/globals.css` — leftover `index.css` is dead code ✅ |

Criteria 8–10 (browser) were driven by the coder via CDP and are not independently reproducible
here. See "Not verified by the audit" below.

## Three defects in the contract. Mine.

**1. `npx tsc --noEmit` was an acceptance criterion that could not fail.**
Vite's react-ts template makes the root `tsconfig.json` `{"files": [], "references": [...]}`, so
plain `--noEmit` type-checks zero files and exits 0 regardless of the code. It was criterion 1 here
and criterion 2 in contract 0002 — and **0002 was audited and accepted partly on it**, with the
planner reporting "typecheck clean ✅". That was empty. The real gate was `tsc -b` inside
`npm run build` the whole time, which is what caught the `JSX` error. Both contracts now specify
`-p tsconfig.app.json --noEmit`. Recorded in `REBUILD.md`.

**2. Criteria 5 and 6 were scoped to all of `frontend/src/`, which made them unsatisfiable.**
`frontend/src/styles/globals.css` is the design-token file — it is *definitionally* full of hex
literals, and the same contract forbids modifying it. `frontend/src/main.tsx:6` contains the Vite
template's `getElementById('root')!`, also out of scope. So the contract demanded exit 1 from greps
that could only return exit 0 without editing files it prohibited touching. The coder scoped the
greps to what the contract actually created and reported both results. That is the right call and
the right disclosure.

**3. The contract's literal `NavItem` values contradicted its own criterion 10.**
`text-sm` + `px-3 py-1.5` overflows at 375px — and so does the approved mockup, which the coder
verified before changing anything rather than assuming its own code was at fault. The contract's
"if the mockup and this contract disagree, this contract wins" clause is what resolved it. That
clause earned its place; keep writing it.

**4. Bare `JSX.Element` in the Interface section does not compile under React 19.** `@types/react`
19.x removed the global ambient `JSX` namespace. Fix was `import type { JSX } from 'react'` in five
files, leaving every exported signature textually identical to the contract. Recorded in
`REBUILD.md`.

## What is good, specifically

- **`BackendStatus.tsx:14-26` uses a `cancelled` flag in the effect cleanup.** Not required by the
  contract. It prevents a `setState` after unmount, which matters under StrictMode's double-invoke
  in dev. Correct beyond spec.
- **Discriminated union for status** (`{kind: 'loading'} | {kind: 'success', python} | {kind:
  'error'}`) rather than the looser `{status, data?, error?}` shape 0002's `App.tsx` used. The
  success branch cannot be reached without `python` being present.
- **The coder tested the *mockup* before blaming its own output** for the 375px overflow, and
  measured `document.body.scrollWidth === window.innerWidth` via CDP rather than eyeballing a
  screenshot. It also caught and discarded its own unreliable measurement method mid-run
  (`innerWidth` drifting to 404 across runs) instead of reporting the first number that looked good.
- **Every deviation was reported, including the ones nobody would have found** — `gap-2` on
  `EntryCard`, `whitespace-nowrap` on `NavItem`. `executor-haiku.md` warns that writing "None" under
  Deviations is the worst possible move; this is the opposite of that.
- **"Gaps and uncertainty" was filled in honestly**: untested widths between breakpoints, fonts
  possibly falling back to system in headless Chrome, and an explicit statement that the mobile nav
  *fits* but was not *designed*.

## Not verified by the audit

- Criteria 8, 9, 10 were browser-driven by the coder. I re-ran everything else against disk but
  cannot independently reproduce the screenshots. They are accepted on the coder's evidence, which
  is weaker than the rest of this audit.
- `backend/.env.example` and `frontend/.env.*` contents remain unreadable to the planner
  (`.claude/settings.json` denies `Read(.env.*)`). Existence only.

## Follow-ups filed, not blocking

1. **Vite template leftovers from contract 0002** are still in the tree and were never in any Files
   list: `frontend/src/index.css` (dead — `main.tsx` does not import it), `frontend/src/assets/`
   (`hero.png`, `react.svg`, `vite.svg`), and `frontend/public/icons.svg`. These are what made
   criteria 5 and 6 unsatisfiable. Deleting them makes the unscoped greps pass honestly.
2. **Mobile header density needs Gunnar's eyes.** Below `sm` the nav is `px-0.5` with `text-xs` —
   it fits, but it is denser than the approved mockup and was reached by measurement, not design.
3. **`mockup-launch.html` now diverges from the implementation** at mobile widths and is known to
   overflow at 375px. It was always intended as throwaway; it should be deleted now that 0003 has
   landed, or it will be read as the current design and it is no longer accurate.
