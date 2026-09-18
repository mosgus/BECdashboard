# Contract 0046 — System Health and Recent Job Runs on the ops page

**Status:** accepted (2026-09-18) — audited by planner. Dark-mode legibility and the offline-error
UI are Gunnar's to confirm.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

`/ops` renders the two cards the backend has been serving since contract 0044: **System Health** and
**Recent Job Runs**, above the existing Theme card.

Frontend only. The endpoints already exist and are unchanged.

## Why

Contract 0044 built `GET /ops/status` and `GET /ops/job_runs` and nothing renders them. Until it does,
the only way to answer *"did the 09:30 sweep run, and did it work?"* is to curl the API — which is
exactly the question the page exists for.

Both endpoints are live and verified against the real database (0044's audit). Their shapes are fixed
by `app/schemas.py`; **this contract must not change either endpoint.**

```
GET /ops/status
  database   { connected: bool, revision: str|null }
  universe   { active_tickers: int, total_bars: int, newest_bar_date: date|null }
  news       { article_count: int, newest_fetched_at: datetime|null }
  briefing   { exists: bool, model: str|null, created_at: datetime|null }
  gemini_key_configured: bool
  python: str
  windows    { auto_refresh_last_claim, news_refresh_last_claim, current_window_start }  (all datetime|null)

GET /ops/job_runs?limit=
  { job_runs: [ { id, job_name, started_at, finished_at|null, status, duration_ms|null, detail|null } ] }
```

`status` is one of `success` | `partial` | `failure`. `detail` is free-form JSON — the universe sweep
writes `{tickers, refreshed, errors}`, the news refresh writes `{feeds, stored, errors, briefing}`.

## These cards show their errors — unlike everything else

`TickerStrip` and `NewsSection` return `null` on failure, deliberately: the launch page must never
break because a market endpoint is slow.

**Invert that here.** An ops page that silently renders nothing when the backend is unwell is useless
precisely when it is needed. A failed fetch must show the error message inside the card. Say so in the
report — this is the one place in the app where that is the right call.

## Environment

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

`npm run lint` (oxlint) currently reports **exactly one** warning, the `set-state-in-effect` baseline
in `UniversePage.tsx`. Do not fix it, do not exceed it. Its line number has moved twice this session;
match on the rule and the count, not the line.

There is **no frontend test runner.** Correctness rests on the greps below plus human verification.

**Dark mode shipped in contract 0045.** Every colour must come from a token — `text-foreground`,
`text-[var(--color-muted)]`, `bg-brand-surface`, `border-brand-border`, `text-brand-positive`,
`text-brand-negative`, `text-brand-accent`. A literal colour here works in light and breaks in dark,
and nothing will catch it but your eyes.

## Files

Create:
- `frontend/src/lib/opsFormat.ts`
- `frontend/src/components/SystemHealthCard.tsx`
- `frontend/src/components/JobRunsCard.tsx`

Modify:
- `frontend/src/api/client.ts` — types and two fetchers
- `frontend/src/pages/OpsPage.tsx` — compose the cards

**Touch nothing else.** No backend file, no migration, no other component, no `globals.css`,
no `index.html`, no `App.tsx`, no `ThemeSelector.tsx`. **No new dependency** — no table library, no
date library, no charting.

## `lib/opsFormat.ts` — pure

```ts
/** "840ms" under a second, else "19.5s". Null → "—". */
export function formatDuration(ms: number | null): string

/** A job run's detail object as one compact line, e.g. "22 tickers · 2 refreshed".
 *  Null or empty → "". */
export function summariseDetail(detail: Record<string, unknown> | null): string
```

Both pure — no clock, no DOM, consistent with every other module in `lib/`.

`summariseDetail` must be **generic over the keys**, not a switch on `job_name`. The two jobs write
different shapes today and a third will write a third; a renderer that knows the key names breaks
silently the moment one changes. Render `key value` pairs joined by ` · `, and:

- skip a key whose value is `null`, `undefined`, an empty array, or an empty string
- render an array as its joined contents
- **omit `errors` entirely** — the card renders it separately and in the negative colour, so
  including it here would print it twice

`formatDuration` is ported from the reference's `fmtDuration` (`frontend/app/ops/page.tsx`). Real
durations are seconds, not milliseconds — 0044 measured a universe sweep at 19,520 ms.

## `SystemHealthCard.tsx`

```tsx
export function SystemHealthCard(): JSX.Element
```

Self-fetching with `useState`/`useEffect`, no data library — the same pattern as `NewsSection`.

- **Loading**: a muted line. **Error**: the message, in `text-brand-negative`, inside the card.
- A **Refresh** button in the card header that refetches. Project `Tooltip`:
  `Re-read system status`. Disabled while in flight.
- **Do not poll.** The reference used a 60-second `refetchInterval`; this app has deliberately avoided
  background timers everywhere else, and a manual button is enough for a page you open on purpose.

Render the values as labelled stats in a responsive grid — `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`
or similar. Group sensibly; exact layout is yours. Required content:

| label | source | notes |
|---|---|---|
| Database | `database.connected` | a `text-brand-positive` / `text-brand-negative` dot, plus `database.revision` as the migration version |
| Universe | `universe.active_tickers` | with `universe.total_bars` and `universe.newest_bar_date` |
| News | `news.article_count` | with `news.newest_fetched_at` as a relative age |
| Briefing | `briefing.exists` | with `briefing.model` and `briefing.created_at` as a relative age |
| Gemini key | `gemini_key_configured` | **the boolean only** — "Configured" / "Not configured" |
| Python | `python` | |
| Last universe sweep | `windows.auto_refresh_last_claim` | relative age |
| Last news refresh | `windows.news_refresh_last_claim` | relative age |
| Current window | `windows.current_window_start` | `null` means no window is open — render "Closed", not "—" |

Reuse `relativeTime(iso, now)` from `lib/relativeTime.ts` for every timestamp. **Do not add a second
time formatter.** `newest_bar_date` is a plain date, not a timestamp — render it as-is rather than
forcing it through `relativeTime`.

## `JobRunsCard.tsx`

```tsx
export function JobRunsCard(): JSX.Element
```

Self-fetching, requests `limit=10`.

- **Empty**: `No job runs recorded yet.` — the reference's copy, and correct here since a fresh
  database genuinely has none until the first window opens.
- **Error**: the message in `text-brand-negative`, same as above.
- A table: **Job · Status · Duration · Finished · Detail**.
  - `job_name` in a mono font.
  - Status as a pill — `success` positive, `partial` accent, `failure` negative. Derive the colour
    from a lookup with a neutral fallback, so an unknown status renders muted rather than crashing.
  - Duration through `formatDuration`.
  - Finished through `relativeTime`; `null` → `—`.
  - Detail through `summariseDetail`, plus — when `detail.errors` is a non-empty array — a second line
    listing them in `text-brand-negative`. That is the whole point of `partial`: seeing *which* ticker
    or feed failed without opening the logs.
- Horizontally scrollable on narrow screens (`overflow-x-auto`), like `UniverseTable`.

## `OpsPage.tsx`

Order becomes: **System Health → Recent Job Runs → Theme.** Operational facts first, preferences last.

Keep the existing `CARD` constant, the heading and the subtitle. The two new cards own their own card
chrome so they can render their own header rows — do not wrap them in another `CARD` div.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
2. `npm run lint` reports **exactly one** warning, still the `set-state-in-effect` rule.
3. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/SystemHealthCard.tsx frontend/src/components/JobRunsCard.tsx frontend/src/pages/OpsPage.tsx frontend/src/lib/opsFormat.ts`
   matches nothing (exit 1) — dark mode depends on this.
4. `grep -rnE "\b(bg|text|border|divide)-(white|black|gray|slate|zinc|red|green|blue|amber)-?[0-9]{0,3}\b" frontend/src/components/SystemHealthCard.tsx frontend/src/components/JobRunsCard.tsx`
   matches nothing (exit 1) — no Tailwind literal palette colours either. `text-white` **is**
   permitted, but only on a `bg-brand-primary` / `bg-brand-negative` pill; quote any use.
5. `grep -n "job_name" frontend/src/lib/opsFormat.ts` matches **nothing** (exit 1) —
   `summariseDetail` must be generic over keys, not a switch on the job.
6. `grep -n "errors" frontend/src/lib/opsFormat.ts` shows it is **skipped**, and
   `grep -n "errors" frontend/src/components/JobRunsCard.tsx` shows it rendered separately. Quote
   both.
7. `grep -rn "setInterval\|refetchInterval" frontend/src/components/SystemHealthCard.tsx frontend/src/components/JobRunsCard.tsx`
   matches nothing (exit 1) — manual refresh only.
8. `grep -n "relativeTime" frontend/src/components/SystemHealthCard.tsx` matches, and
   `grep -rnE "toLocaleString|Intl\.(DateTimeFormat|RelativeTimeFormat)" frontend/src/components/SystemHealthCard.tsx frontend/src/components/JobRunsCard.tsx`
   matches nothing (exit 1) — one time formatter in this codebase, not two.
9. Both cards render an error message rather than `null` on a failed fetch. Quote the branch from each.
10. `git diff --stat backend/` is empty.
11. `git status --porcelain` lists nothing outside this contract's files.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/components/SystemHealthCard.tsx frontend/src/components/JobRunsCard.tsx frontend/src/pages/OpsPage.tsx frontend/src/lib/opsFormat.ts ; echo "(exit $? — 1 = correct)"
grep -n "job_name" frontend/src/lib/opsFormat.ts ; echo "(exit $? — 1 = correct)"
grep -rn "setInterval\|refetchInterval" frontend/src/components/SystemHealthCard.tsx frontend/src/components/JobRunsCard.tsx ; echo "(exit $? — 1 = correct)"
grep -rnE "toLocaleString|Intl\." frontend/src/components/SystemHealthCard.tsx frontend/src/components/JobRunsCard.tsx ; echo "(exit $? — 1 = correct)"
git diff --stat backend/ ; echo "(empty = backend untouched)"
git status --porcelain
```

Plus the live shapes the cards must handle, so the report shows they were read rather than assumed:

```bash
curl -s http://127.0.0.1:8000/ops/status | python3 -m json.tool
curl -s 'http://127.0.0.1:8000/ops/job_runs?limit=5' | python3 -m json.tool
```

Restart uvicorn with `--reload` first. If `job_runs` is empty, load `localhost:5173/` once to open a
window, wait a few seconds, and re-check — **an empty list is a valid state the card must handle**,
not a reason to fake data.

## Human verification — does Gunnar need to run anything?

**Yes, and in both themes.**

1. `/ops` shows three cards in order: System Health, Recent Job Runs, Theme.
2. System Health reflects reality — ticker count matches the Universe page, the migration revision is
   `0008`, Gemini reads Configured.
3. Press **Refresh** on System Health. Values re-read; the button disables while it runs.
4. Recent Job Runs lists the sweeps with sensible durations (~4–20s) and a green `success` pill.
5. **Stop the backend and reload `/ops`.** Both cards must show an **error message** — not blank
   cards, not a blank page. This is the opposite of how the launch page behaves and it is deliberate.
6. **Switch to Dark and re-read both cards.** Status pills, the database dot, the error colour and the
   table borders must all still be legible. A literal colour would look fine in light and wrong here.
7. If you ever see a `partial` run, check the failing ticker is named under Detail. If you never do,
   that is good news and not a defect.

## Out of scope

- No change to `/ops/status`, `/ops/job_runs`, or anything under `backend/`.
- No polling, auto-refresh or websockets.
- No new card beyond the two. No digest, no alerting, no price-refresh control.
- No pagination or filtering of job runs — ten, newest first.
- No change to `ThemeSelector`, `globals.css`, `index.html` or `App.tsx`.
- No change to how `TickerStrip` or `NewsSection` handle failure; the inversion is local to `/ops`.

## Open questions — do NOT resolve these yourself

- **Whether System Health should poll.** A manual button is the starting point; if the page proves
  useful to leave open, a 60-second interval is a small change.
- **Whether `/ops` should require a secret** now that it is reachable from the header on a public
  deployment. It exposes no secrets, but it does expose system internals.
- **Whether job runs deserve a detail view** — a row expanding to the raw `detail` JSON.
- **Whether a `failure` run should surface anywhere outside `/ops`**, e.g. the header status dot.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-18)

- `tsc -p tsconfig.app.json --noEmit` clean; `npm run build` succeeds
- `npm run lint` → exactly **1** warning, the unchanged `set-state-in-effect` baseline
- Colour literals and Tailwind palette literals in the new files → exit 1. Dark mode depends on this
  and nothing but a human eye would have caught a violation.
- `job_name` absent from `opsFormat.ts` → the detail renderer is generic over keys
- `errors` skipped in the formatter (`if (key === 'errors') continue`) and rendered separately in the
  card at `JobRunsCard.tsx:118` — not printed twice
- `setInterval`/`refetchInterval` → exit 1; `toLocaleString`/`Intl.*` → exit 1
- `git diff --stat backend/` empty

### The inversion was implemented, not reflexed away

Both cards carry an explicit error branch — `state.status === 'error'` rendering `state.message` in
`text-brand-negative` — rather than the `return null` used everywhere else. This was the thing most
likely to be written by habit and it was not.

### The status pill degrades instead of crashing

```ts
const color = STATUS_PILL_COLOR[status] ?? 'bg-brand-border text-[var(--color-muted)]'
// job_runs.status is a plain string column, not an enum the frontend controls
```

The comment states the actual reason — the column is free-form, so an unknown value is a data
question, not an impossible state. Pill colours resolve through
`color-mix(in oklab, var(--color-accent) 10%, transparent)`, so they follow the theme with no
dark-mode variant.

### The implementer caught its own regression

Its first draft called a synchronous `setState({status: 'loading'})` as the first line of each card's
`load()`, invoked from the mount effect — the exact pattern behind `UniversePage`'s baseline warning.
Lint went 1 → 3. Fixed by dropping the redundant pre-fetch write (state already initialises to
`loading`, matching `NewsSection`) and moving `setRefreshing(true)` into the click handler rather than
the shared `load()`. Caught by running lint, not by reading the diff.

### Verified mechanically, not visually

The implementer drove headless Chrome against the dev server and dumped the DOM: `System Health`,
`Recent Job Runs`, `Theme`, `Connected`, `Migration 0008`, `22 tickers`, `3.13.15`, `Configured` and
`success` all present, no error text. That establishes the cards mount, fetch and render live data —
it establishes nothing about dark-mode legibility or the offline error UI, both of which remain
Gunnar's.
