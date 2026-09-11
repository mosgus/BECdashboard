# Rebuild Plan

Working notes from the planning conversation that led to this branch. Purpose is continuity across chats, not a spec — update it as decisions change instead of treating it as fixed scope. See `README.md` for the current one-page status; this file is the "why" behind it.

## Why a rebuild instead of an iteration

Limited hands-on development history with the existing app, so the goal is to rebuild page by page, feature by feature, to actually understand what's necessary — rather than carry the old architecture forward by default. Willing to make large changes where the old approach doesn't hold up.

## Decided

**Python 3.13** for the backend.
- Prophet's cmdstanpy/Stan toolchain was the one dependency without a clear 3.13 compatibility story — resolved by dropping Prophet (see below), not by staying on an older Python.
- scipy 1.16.1 already requires Python ≥3.12 and dropped older versions — staying on 3.11 (the old app's version) would have capped future dependency upgrades from day one.
- 3.14 was available but skipped: no feature benefit for this app, less ecosystem mileage than 3.13.
- Conda env `blue-eagle` (confirmed Python 3.13.15) is the active rebuild env; `blue-eagle-old` exists separately.

**Drop Prophet as a forecast method.**
- Was one of four methods (`ewma`/`arima`/`prophet`/`ensemble`) in the old `backend/core/forecast.py`, using only generic yearly-seasonality-on-log-price — nothing Prophet-specific (no holidays, custom regressors, changepoint tuning).
- Heaviest, most fragile native dependency in the stack for the least differentiated output. Ensemble already tolerated per-method failures, so losing it doesn't break the pattern.
- Replacement forecaster is an open question, not decided — statsmodels alone (already a dependency) may cover it.

**No auth, no multi-user concerns.** Single-operator prototype. No login, no per-user data isolation, no audit log, no job-run tracking.

**Portfolio/user state moves client-side.** Portfolios, positions, watchlists, alerts, decision memos — all of it was relational (composite PKs, cascading FKs) in the old Postgres/Supabase schema, built for multi-user concurrency this app doesn't need. New plan: define a portfolio (manual entry or CSV upload) and persist it in browser storage so it survives a refresh. No server-side portfolio persistence.

**Backend stays Python, stays server-side, but goes stateless (no DB) for now.**
- Considered dropping the backend entirely — not viable. yfinance is a Python library that can't run in-browser, and Yahoo's endpoints get CORS-blocked/rate-limited fast under direct per-browser client calls. Data fetching has to stay server-side, cached and shared.
- Considered rewriting analysis/optimization (scipy.optimize mean-variance, statsmodels, walk-forward, factor replay, risk, signals, technicals — the real substance of the app, in `backend/core/`) in JS/TS or Rust+WASM. Rejected: a JS/TS backend is still a backend (no deployment simplification, weaker numerical ecosystem); Rust/WASM is the only path that actually removes the server, but the numerical crates (argmin/nalgebra/statrs) aren't close to scipy/statsmodels and data-fetching would still need a server regardless. Not worth the rewrite risk for a POC.
- Price data cache: shared by ticker (composite key `ticker + date`, matching the old `PriceBar` pattern) — **not** one table/collection per ticker (that's a real anti-pattern: schema/migration overhead per ticker, most DBs discourage unbounded table/collection counts). Not per-session either — price data isn't user-specific, so per-session caching would just duplicate fetches.
- Incremental refresh: if a ticker's cached data is 24h+ stale, fetch only the missing date range from yfinance and append, rather than refetching full history. Good pattern, keep it.
- For now: **in-process TTL cache** (`cachetools`, already a dependency), no hosted database. Accept that Render's free tier sleeps after ~15 min idle and has an ephemeral filesystem, so the cache goes cold often — acceptable tradeoff for a POC, not a blocker.
- Build the cache behind a small interface (`get_cached(ticker)` / `store(ticker, df)`) now, so that adding real persistence later is a localized change to one module, not a rewrite.

**No hosted database, deferred not rejected.** Considered MongoDB explicitly and rejected it — "free" isn't a Mongo-specific advantage (Neon/Supabase give free Postgres too), and the schema's relational shape (composite keys, cascades) would just move the referential-integrity work into application code. Since portfolio state is now client-side and the price cache is in-process, there's no current need for a hosted DB at all. A small Postgres table scoped just to the price cache is a plausible later addition if cold-cache-on-restart proves costly in practice — not before an initial deployment exists.

**Deploy: GitHub + Render + Cloudflare Pages. Three services, no DB service for now.**
- Render hosts the backend (Python/FastAPI), same pattern as the old `render.yaml` (root dir `backend`, Dockerfile-based, auto-deploy on push).
- Cloudflare Pages hosts the frontend, auto-deploy on push. Chosen over GitHub Pages: Cloudflare auto-detects Next.js and builds on push; GitHub Pages only serves static files and requires hand-rolling a GitHub Actions build workflow. Cloudflare cannot run the Python backend (no scipy/statsmodels-class native support even in its Python Workers), so it's frontend-only.
- Both platforms can scope their "watch" to a subdirectory (`backend/` vs `frontend/`) so a push to one doesn't trigger a rebuild of the other.
- Deploy order matters: backend needs to go live first to get its Render URL, since the frontend's `NEXT_PUBLIC_API_URL` is baked in at build time, not read at runtime. Then `CORS_ORIGINS` on the backend needs the real frontend URL, requiring one backend redeploy after the frontend is up.

## Open questions (not decided)

- **Write protection for a public deployment.** The old app's `CLASS_WRITE_KEY` gate existed because portfolios were shared, mutable, server-side state anyone could hit. With portfolios moving client-side, is there still anything worth gating (e.g. abuse of the compute/data-fetch endpoints), or is this now moot?
- **Next.js render mode.** Old `frontend/next.config.ts` was set to `output: "standalone"` (Node server), incompatible with Cloudflare Pages static hosting. No SSR/API routes were found in the old app on a quick check, suggesting `output: "export"` would work, but this hasn't been verified page-by-page — confirm before committing to static export.
- **Result caching for analysis/optimization output.** Not yet justified by an actual performance problem — don't build it speculatively.
- **First feature to build.** Proposed starting point: portfolio definition (manual entry + CSV upload), since analysis/optimization has nothing to operate on until that exists. Not yet explicitly confirmed as the starting point.
- **Persistent price-cache table.** Deferred until after an initial deployment exists and cold-cache behavior is actually felt as a problem.

## Explicitly cut from the old app

Prophet forecasting; login/identity system (`X-Actor-Name`); watchlists; alerts; decision memos; audit log; job-run tracking; the full relational Postgres/Supabase schema and Alembic migrations; server-side multi-user portfolio storage.

## Dev workflow

- Work happens on the `rebuild` branch. `main` is untouched and holds the old app.
- **`main` is the reference branch; `rebuild` is the development branch.** `main` is never checked out from this working tree. Read the old implementation in place with `git show main:path/to/file.py` and `git ls-tree -r main --name-only`. There is no reference worktree — an earlier version of this file described one at `../blue-eagle-reference`; it was never created, and reading `main` directly makes it unnecessary.
- Old app files (`backend/`, `frontend/`, `SETUP.md`, `BLUEEAGLE_GUIDE.md`, `docs/`, `jobs/`, `sample_portfolio.csv`, `render.yaml`, `.env.example`) have been removed from tracking on `rebuild`, leaving only `README.md`, `REBUILD.md`, and `.gitignore`.
- When the rebuild is ready to replace the old app: merge `rebuild` into `main` and push. Render/Cloudflare Pages should stay pointed at `main` throughout — don't repoint deploy hooks at `rebuild` mid-build.
- **Only Gunnar commits and pushes.** No agent session does, ever. Enforced in five layers — see `agent_prompts/README.md` § "The commit guarantee". Agents that think a commit is warranted print the command and stop.
- Three agent sessions (Opus planner, Sonnet implementer, Haiku executor) coordinate through contract and report files under `contracts/`. See `agent_prompts/README.md`.
