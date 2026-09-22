# Blue Eagle

A portfolio analysis tool: a curated, shared universe of securities on the server, and allocation
work — portfolios, and eventually optimization and risk — in the browser.

This branch (`rebuild`) is a ground-up rewrite of an earlier implementation still intact on `main`.
The rewrite is well past the exploratory stage: the architecture below is what the app is being made
production-ready on, not a proposal. `REBUILD.md` carries the reasoning behind every line here,
including the decisions that were reversed and why.

## Status

Four pages ship, all backed by a live deployment on Render.

| page | what works |
|---|---|
| `/` | Market briefing (Gemini, over stored headlines), news cards and text list, four explanatory entry cards |
| `/universe` | Add, refresh and delete tickers; filters; charts; CSV and zip export; live quotes and day change |
| `/portfolios` | Weight-first portfolios in browser storage: create by weight or by shares, add positions with pro-rata dilution, CSV import and export |
| `/ops` | System health, job-run history, theme selector |

Chrome on every page: a scrolling ticker strip, a backend status indicator, and light/dark theming
off a single attribute.

Not built: optimization, risk, forecasting, and the `Research` nav destination. The four entry cards
on `/` describe those and are deliberately inert.

**Order of work, decided 2026-09-22: Portfolios → Ops → Research.** All four nav destinations are
real features; none is a placeholder. Research is last on purpose — it is the only one whose shape
depends on the other two, since research output is about portfolios and anything operational about it
surfaces on Ops.

## Architecture

**Backend — Python 3.13, FastAPI, Postgres on Render.** Layered by domain concept, not by page:
config and pure helpers at the bottom, then the database and cache, then the yfinance boundary, then
features, with `routers/` as the only modules that know about HTTP. Eight tables. `REBUILD.md`'s
"Module map" has the full tier list and the argument for why a per-page split was rejected.

**Frontend — Vite + React + TypeScript, Tailwind v4.** A static SPA with a real router. No component
library, no react-query, no charting library in the main bundle (recharts is lazy-loaded so the
launch page never pays for it). One typed fetch client is the single network boundary.

**The split that matters: shared reference data lives on the server, personal state lives in the
browser.** The Universe is one shared, persisted list. Portfolios are per-browser `localStorage`,
because without auth that is the only thing giving each person their own — server-side storage with
no login means one global list anyone can edit. CSV export is the backup and transfer story.

**Data comes from Yahoo via yfinance, across four endpoints with different requirements.** Price
history and chart metadata need no crumb token and work from Render; `quoteSummary` needs one and
does not. Fundamentals are therefore best-effort enrichment that may be absent, never a precondition.
This is the single most expensive thing in the project to rediscover — `REBUILD.md`, "Which Yahoo
data needs the crumb."

**Freshness is a rule, not a TTL.** Stored data is stale only if its newest bar predates the last
completed trading session, derived empirically from a reference ticker so market holidays come free.
Repeat refreshes are no-ops, which is also what keeps a public, unauthenticated write surface from
being an abuse vector.

**Refreshes are visit-triggered, once per window (09:30 / 12:00 / 16:00 ET).** There is no scheduler
anywhere in this codebase, because Render's free tier sleeps after ~15 minutes idle. The ticker-strip
fetch is the trigger, since it is the one request that fires on every page load.

## Deployment

Three Render services: a Web Service (backend), a Static Site (frontend), and Postgres. One account,
one dashboard.

- **Backend** — root `backend`, build `pip install -r requirements.txt`, start
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Python version from `backend/.python-version`.
- **Frontend** — root `frontend`, build `npm run build`, publish `dist`. `VITE_API_URL` is **baked in
  at build time**, so changing it needs a rebuild, not a restart.
- **SPA rewrite is required** and must be configured in the Render dashboard (`/*` → `/index.html`,
  action *Rewrite*). Render does **not** honour `frontend/public/_redirects` — that file is
  Cloudflare's format and is dead weight here.
- **Deploy order is forced:** backend → frontend (bakes the URL in) → backend redeploy with
  `CORS_ORIGINS` set to the frontend's origin.

A cold start takes ~43 seconds on the free tier. The static site never sleeps, so the page always
loads instantly and only the first API call after idle is slow.

## Known gaps

Honest list, all recorded with detail in `REBUILD.md`:

- **No auth, and writes are ungated.** Anyone who reaches the deployed app can add tickers to the
  shared universe. Accepted knowingly; the freshness rule closes the obvious abuse vector, and
  reversing it is one env var and one header check.
- Concurrent news refreshes are not deduplicated.
- The AI briefing inherits the news feed's relevance problem — Yahoo's per-ticker feeds are only
  loosely on-topic, so publisher preference does the real filtering.
- `UniverseEntry` carries a live price but no quote timestamp; correct only because quotes are
  regular-session-only. Add `quote_as_of` before extending quote coverage.

## Verification

- Backend: `pytest`. Any module doing math or data transformation ships with tests — that is where
  silent wrongness lives.
- Frontend: `npx tsc -p tsconfig.app.json --noEmit` (plain `--noEmit` is **vacuous** in this project
  and must never be used), `npm run build`, and `npm run test` for `src/lib/`. UI component tests are
  skipped deliberately; pure logic is not.
- Every contract also names what a human has to look at, because neither a typecheck nor a grep can
  see a rendered page.

## Working on this

- `rebuild` is the development branch. `main` is the frozen pre-rebuild implementation, read in place
  with `git show main:path/to/file`, never checked out from this tree.
- `reference files/` is **read-only** — snapshots of other working software kept so their behaviour
  can be compared against this rebuild. An edited reference stops being evidence.
- Work is specified as numbered contracts under `contracts/`, executed by coding agents, audited, and
  archived into `contracts/done/`. `agent_prompts/README.md` explains the three-session setup.
- `REBUILD.md` is the decision log and the continuity mechanism across sessions. A decision that only
  exists in one session's context is lost the moment that context is.

## Troubleshooting

**Port already in use error**

If you get `[Errno 48] Address already in use` when starting the backend or frontend, find and kill the process using that port:

```bash
# Backend (port 8000)
kill -9 $(lsof -t -i :8000)

# Frontend (port 5173)
kill -9 $(lsof -t -i :5173)
```

To see what's using a port without killing it:

```bash
lsof -i :8000   # shows the process and PID
```
