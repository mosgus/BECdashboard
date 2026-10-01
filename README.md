# Blue Eagle

A portfolio analysis tool: a curated, shared universe of securities on the server, and allocation
work — portfolios and optimization now, and eventually outlook and risk — in the browser.

This branch (`rebuild`) is a ground-up rewrite of an earlier implementation still intact on `main`.
The rewrite is well past the exploratory stage: the architecture below is what the app is being made
production-ready on, not a proposal. `REBUILD.md` carries the reasoning behind every line here,
including the decisions that were reversed and why.

## Status

These pages ship, all backed by a live deployment on Render.

| page | what works |
|---|---|
| `/` | Market briefing (Gemini, over stored headlines), news cards and text list, four explanatory entry cards |
| `/universe` | Add, refresh and delete tickers; filters; charts; CSV and zip export; live quotes and day change; an "updating" note while a sweep runs, then a reload without blanking the table |
| `/ticker/:symbol` | Price chart with technical indicators and signal states for one universe ticker |
| `/portfolios` | Portfolios in browser storage, either weight-based or **shares-based** (see below). Create by weight or by shares. CSV import and export, including brokerage-style `ticker,shares` files and the Optimize tab's export |
| `/portfolios/:id/holdings` | Positions with a Cash row in dollars, plus buy-and-hold value/return charts anchored at today's weights |
| `/portfolios/:id/optimize` | Eight optimizer modes; an in-sample current-vs-optimized comparison with metrics and a %-return chart vs SPY; a "Cash to deploy" slider; a share-and-dollar trade table; CSV export; Apply to portfolio |
| `/portfolios/:id/outlook` | **CAPM Optimizer** sub-tab: expected returns with per-holding conviction views, Current vs Target statistics, a sized trade table with dollar VaR, a risk-vs-return chart with the Capital Allocation Line, CSV export, and Apply. The Monte Carlo and Forecast sub-tabs are placeholders |
| `/ops` | System health, job-run history, a **Force update** button that runs the universe sweep now, theme selector |

Chrome on every page: a scrolling ticker strip, a backend status indicator, and light/dark theming
off a single attribute.

**Shares-based portfolios (contracts 0129–0137, finished 2026-10-01).** When a portfolio has cash in
dollars and a share count on every position, shares are the source of truth. On every price load,
the weights are re-marked from shares × last close plus the fixed cash. Every edit is a trade at
the last close, the same price Optimize and Outlook use (contract 0139). Only the Holdings tab's Price
and Day % columns show the live quote, and only for display:
- the Cash editor takes dollars;
- Add buys a new ticker, or more of a held one, out of the cash (no margin);
- Remove opens a dialog that sells some or all of a holding in 0.5-point weight steps, with the
  proceeds going to cash;
- Optimize's table and Apply size trades from the real cash dollars, and Apply keeps the portfolio
  shares-based.

Portfolios without full share counts stay weight-based and behave as before.

Not built: the Monte Carlo and Forecast sub-tabs of Outlook, the Monitor and Risk & Perf portfolio
tabs (they render empty on purpose), and the `Research` nav destination. The four entry cards on `/`
describe the unbuilt features and are deliberately inert.

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

**Refreshes are visit-triggered, once per window (09:30 / 12:00 / 16:00 ET, every day including
weekends).** There is no scheduler
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

## Running locally

Two terminals, both from the repo root. Backend on `:8000`, frontend on `:5173`.

**One-time setup**

```bash
brew install python@3.13
./backend/install.sh                     # creates backend/.venv, installs requirements-dev.txt
(cd frontend && npm install)
```

`backend/.env` holds `DATABASE_URL` (Render's **External** URL — the Internal one fails DNS off
Render), and optionally `GEMINI_KEY` / `GEMINI_MODEL`. `frontend/.env.local` needs
`VITE_API_URL=http://localhost:8000`; on a fresh clone, create it with:

```bash
[ -f frontend/.env.local ] || echo 'VITE_API_URL=http://localhost:8000' > frontend/.env.local
```

**Heads up: `backend/.env` points at the production database.** A local backend reads and writes the
same shared universe the deployed app does. To run with no database at all (in-process cache only),
prefix the backend command with `DATABASE_URL=""`.

**Backend** (terminal 1)

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" uvicorn app.main:app --reload --port 8000
```

**Frontend** (terminal 2)

```bash
cd frontend && npm run dev
```

Open http://localhost:5173.

**Migrations** — only needed against a fresh database, or after a contract adds one:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" alembic upgrade head
```

**Checks**

```bash
(cd backend && PATH="$PWD/.venv/bin:$PATH" pytest)
(cd frontend && npx tsc -p tsconfig.app.json --noEmit && npm run test && npm run build)
```

If the backend refuses to start with `Environment variable X is set in your shell and differs from
backend/.env`, a stale export is shadowing `.env` — `unset X` and retry.

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
