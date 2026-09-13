# Contract 0002 — Frontend scaffold

**Status:** open
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

A running Vite + React + TypeScript app with Tailwind v4, the Emory design tokens ported from
`main`, and a typed API client that successfully calls the backend's `/health` — proving the two
halves talk to each other before any feature work starts.

## Why

`REBUILD.md` decided: Vite (not Next.js), React, TypeScript, Tailwind v4 carried over from the
old app, no component library, and a plain typed fetch client rather than react-query. This
contract is the smallest thing that runs under all of those and demonstrates a real round trip
to the backend.

The typed API client is the part that matters. It exists so the base URL and response types live
in exactly one place — with several agents editing components in parallel, a `fetch()` scattered
across call sites is the shape of change that goes wrong.

**Depends on contract 0001.** The backend must be runnable before acceptance criterion 5 can
pass. If `backend/app/main.py` does not exist yet, stop and report `BLOCKED`.

## Files

Create:
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/tsconfig.json`
- `frontend/tsconfig.node.json` — if the Vite template needs it
- `frontend/index.html`
- `frontend/src/main.tsx` — React entry point
- `frontend/src/App.tsx` — renders backend health status
- `frontend/src/styles/globals.css` — ported from `main`, see below
- `frontend/src/api/client.ts` — the typed API client
- `frontend/src/vite-env.d.ts`
- `frontend/.env.example` — documented, no real values
- `frontend/.env.local` — `VITE_API_URL=http://localhost:8000`

**Touch nothing else.** Nothing under `backend/`, nothing in the repo root, nothing under
`agent_prompts/` or `contracts/` other than this contract's status line and its report.

## Stack

- Vite + React + TypeScript (`npm create vite@latest . -- --template react-ts`, run inside
  `frontend/`).
- Tailwind **v4** via its first-party Vite plugin — `npm install tailwindcss @tailwindcss/vite`,
  then `tailwindcss()` in `vite.config.ts` plugins. **Do not** create `tailwind.config.js` or
  `postcss.config.js`; v4 with the Vite plugin needs neither.
- No component library. No react-query. No router — there is one page.

## Porting `globals.css`

Copy it verbatim:

```bash
git show main:frontend/app/globals.css
```

It is already framework-agnostic Tailwind v4 (`@import "tailwindcss";` plus a `@theme inline`
block) and needs **no changes** to its contents. Two things around it do change:

1. The old app loaded Outfit and DM Sans via `next/font/google` in `layout.tsx`. There is no
   `layout.tsx` here — add the Google Fonts `<link>` tags to `index.html` instead, for
   `Outfit` and `DM Sans`, matching the weights the CSS expects.
2. Import it from `src/main.tsx`.

The file's header comment says the fonts are "loaded via next/font/google in layout.tsx." That
becomes untrue the moment it lands here. **Leave it.** Criterion 4 is byte-identical, and an
accurate-but-modified copy fails the check that proves the port was faithful. A later contract
corrects the comment.

Note for when you write `App.tsx`: the `@theme inline` block exposes the color tokens
(`brand-primary`, `brand-accent`, `brand-surface`, `brand-border`, `brand-positive`,
`brand-negative`, `background`, `foreground`) but **not** the fonts — `--font-heading` and
`--font-body` live only in `:root`, so there is no `font-heading` utility class. Typography comes
from the `body` and `h1..h6` rules already in the file. Do not add font tokens to fix this.

## Interface

### `src/api/client.ts`

```typescript
export interface HealthResponse {
  status: string
  python: string
}

// Reads import.meta.env.VITE_API_URL. Throws a clear error if it is unset.
export async function getHealth(): Promise<HealthResponse>
```

Requirements:
- One private `request<T>()` helper that owns the base URL, JSON parsing, and error handling.
  `getHealth` calls it. Every future endpoint will too.
- Non-2xx responses throw an `Error` whose message includes the status code and the response
  body — not a bare "request failed".
- No `any`. No non-null assertions (`!`).

### `src/App.tsx`

Calls `getHealth()` on mount and renders one of three states: loading, the returned status and
Python version, or the error message. Style it with Tailwind utility classes using the brand
tokens (`bg-brand-surface`, `text-brand-primary`, etc. — the names defined in the `@theme inline`
block). Keep it plain; this is a scaffold, not a design.

Manage state with `useState` + `useEffect`. No state library.

### `package.json` scripts

```json
"dev": "vite",
"build": "tsc -b && vite build",
"preview": "vite preview",
"typecheck": "tsc --noEmit"
```

## Out of scope

- No portfolio entry form, no ticker input, no tables. That is contract 0003.
- No routing, no react-query, no component library, no shadcn.
- No chart library. `recharts` arrives when there is something to chart.
- No test framework. `REBUILD.md` decided frontend verification is typecheck + build; do not add
  vitest.
- Do not port any component from `main` other than `globals.css`.
- Do not modify anything under `backend/`, including to "fix" CORS. If CORS blocks the request,
  that is a 0001 defect — report it, don't patch it here.

## Acceptance criteria

0. **Every file in the Files list above exists.** Check with the `ls` command in the verification
   block — it must list all of them and report no "No such file" errors. This criterion exists
   because contract 0001 shipped with a required file silently missing: it was named under Files
   but no criterion checked it, and a file nothing checks is optional in practice.
1. `npm install` in `frontend/` completes without error.
2. `npx tsc -p tsconfig.app.json --noEmit` produces no output and exits 0.
3. `npm run build` succeeds and writes to `frontend/dist/`.
4. `frontend/src/styles/globals.css` is byte-identical to `git show main:frontend/app/globals.css`.
5. With the 0001 backend running on port 8000, `npm run dev` serves a page that displays
   `status: ok` and a Python version beginning `3.13`, with no console errors and no CORS error.
6. No `tailwind.config.js` and no `postcss.config.js` exist in `frontend/`.
7. No `any` type and no non-null assertion in `frontend/src/api/client.ts`:
   `grep -nE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/api/client.ts` matches nothing
   (exit code 1). A bare `grep "any"` is not an acceptable substitute — it matches `company`,
   `many`, and `anything`, so it cannot distinguish pass from fail.

## Verification to run and paste

Run each and paste the **complete, verbatim** output, including failures.

```bash
ls -1 frontend/package.json frontend/vite.config.ts frontend/tsconfig.json frontend/index.html frontend/src/main.tsx frontend/src/App.tsx frontend/src/styles/globals.css frontend/src/api/client.ts frontend/src/vite-env.d.ts frontend/.env.example frontend/.env.local
cd frontend && npm install
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
diff <(git show main:frontend/app/globals.css) frontend/src/styles/globals.css && echo "globals.css identical"
ls frontend/tailwind.config.js frontend/postcss.config.js 2>&1
grep -nE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/api/client.ts ; echo "exit=$? (1 means clean)"
```

Backend for criterion 5 is started with the 0001 venv, not a bare `uvicorn`:

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000
```

For criterion 5, start the backend and the dev server, load the page, and paste what it renders
plus any browser console output. If you cannot drive a browser, say so plainly in the report
under "Not done" — do not claim it passed.

## Open questions — do NOT resolve these yourself

- Page layout, navigation, and how the dashboard is organized. Undecided. Build one bare page.
- Whether react-query gets added later. Decided as "not yet" — do not add it, and do not
  structure `client.ts` around it.
