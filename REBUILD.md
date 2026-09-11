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

**Deploy: GitHub + Render + Cloudflare Pages. Two services, no DB service for now.**
- Render hosts the backend (Python/FastAPI). **No Docker** — Render's native Python runtime, with a build command (`pip install -r requirements.txt`) and a start command (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`). The old app's Dockerfile/`render.yaml` pattern is dropped; it added a container build step this project doesn't need.
- Cloudflare Pages hosts the frontend, auto-deploy on push. Chosen over GitHub Pages: Cloudflare auto-detects the build and runs it on push; GitHub Pages only serves static files and requires hand-rolling a GitHub Actions workflow. Cloudflare cannot run the Python backend (no scipy/statsmodels-class native support even in its Python Workers), so it's frontend-only.
- Both platforms can scope their "watch" to a subdirectory (`backend/` vs `frontend/`) so a push to one doesn't trigger a rebuild of the other.
- Deploy order matters: backend needs to go live first to get its Render URL, since the frontend's API base URL is baked in at build time, not read at runtime. Then `CORS_ORIGINS` on the backend needs the real frontend URL, requiring one backend redeploy after the frontend is up.

**Frontend: Vite + React + TypeScript. Not Next.js.**
- The old app used Next.js, and an earlier version of this plan carried it forward by default. Reconsidered once the architecture settled: with a stateless Python API, portfolio state in browser storage, no auth, no SEO and no SSR, every distinguishing Next.js feature would be switched off. Static export is Next.js with its hands tied — you still pay for App Router, the server/client component split, and export-mode constraints (`next/image` loaders, `generateStaticParams`) while using none of the benefit.
- Vite is a smaller mental model, a much faster dev loop, and roughly one config file. That matches the stated reason for rebuilding: understand what's actually necessary.
- Tradeoff accepted knowingly: Next.js is the more market-standard React skill, and this forgoes learning it here. Migration later is bounded — React components and the API client carry over; routing and entry points get rewritten.
- This resolves the old "Next.js render mode" open question. There is no render mode; the frontend is a static SPA.

**Portfolio persistence: browser `localStorage`, behind an interface.**
- Confirms and sharpens the client-side decision above. No SQL, no hosted database, no server-side portfolio storage.
- All reads/writes go through a small module (`save` / `load` / `list`), so swapping in a server-backed store later is a change to one file rather than a rewrite. Same reasoning as the price-cache interface.
- Known limits, accepted: portfolios are tied to one browser on one machine, and clearing site data loses them. CSV export is the backup story.

**Position model: shares are the stored truth; weights are derived.**
- A share count is a fact that doesn't change on its own. A weight changes every time prices move, so a stored weight silently goes stale sitting in `localStorage` — it describes what you intended on the day you typed it, not what you hold.
- Stored per position: ticker + share count. Cash is a portfolio-level field (carried over from the old app's late-stage fix, which was the right shape).
- Derived at display time: price × shares = value; value / total = weight.
- The entry form offers both modes — type shares directly, or type target weights plus a total portfolio value and convert to shares once on submit. Entry mode is a UI affordance; storage is always shares.

**API shape: cheap per-ticker validation, one heavy analyze call.**
- `GET /tickers/{symbol}` — called as the user types. Returns validity plus the company name, so typos surface inline instead of after submitting the whole form.
- `POST /portfolio/analyze` — takes the finished position list, does prices, shares, weights and metrics in one round trip, returns the computed portfolio.
- Rejected: a single do-everything endpoint (the user only learns they typo'd after filling the entire form) and fully granular endpoints (pushes orchestration and intermediate state into the frontend, where less of the substance should live).

**Styling: Tailwind v4, carried over from the old app. No component library.**
- Verified what `main` actually does rather than assuming: Tailwind v4 via `@tailwindcss/postcss`, exactly one real stylesheet (`frontend/app/globals.css`, 60 lines, almost entirely CSS custom properties for the Emory brand palette — navy `#012169`, gold `#F2A900`, Outfit/DM Sans), and hand-built components with utility classes inline. No shadcn, no MUI.
- Keeping it means old components port with their class names unchanged, and it avoids re-learning styling while simultaneously learning a new build tool and a new architecture.
- Considered CSS Modules (stated preference for "just CSS"). Rejected on a maintenance argument specific to this project: three agents write this UI, and with styles on the element an agent cannot leave an orphaned rule behind or mismatch a class against a file it never opened. CSS Modules drift under agent editing in a way Tailwind doesn't.
- The `globals.css` token file carries over as-is. It is plain CSS variables and is independent of this choice.

**Ticker validation: a served symbol list for instant feedback, yfinance as the authoritative check.**
- `GET /tickers` returns the valid-symbol list once on page load, cached both sides. The frontend validates as the user types with zero network calls per keystroke.
- `POST /portfolio/analyze` is the real check — it fetches prices anyway, so a symbol yfinance can't serve fails there and comes back in a `warnings` list.
- Rejected: live yfinance lookup per ticker. ~200–500ms each and Yahoo rate-limits aggressively; entering a dozen positions would throttle you, and that's the failure you'd hit first in a demo.
- Open: where the symbol list itself comes from (SEC `company_tickers.json`, an exchange file, or something else).

**Verification standard: pytest on the backend, typecheck + build on the frontend.**
- Any backend module doing math or data transformation ships with pytest tests. That's where silent wrongness lives — a wrong Sharpe ratio looks entirely plausible, which is exactly what an audit can't catch by reading.
- Frontend contracts are verified by `tsc --noEmit` and a clean `npm run build`, plus a human look at the running page. UI unit tests are skipped deliberately: high effort, low value while the layout is still moving.
- This is what makes contract acceptance criteria objective, which is the precondition for the Planner re-running verification instead of trusting a report.

**Data fetching: a plain typed fetch client. No react-query yet.**
- One module with a typed function per endpoint; components manage their own loading/error state. The old app used `@tanstack/react-query`, but its real strengths — cache invalidation, deduping, background refetch — barely apply to two endpoints and client-side portfolio state.
- Deliberately reversible: adding react-query later wraps these same functions rather than replacing them.
- Rejected: bare `fetch()` at call sites. The base URL and response types would duplicate across components, and that diffuse-edit shape is exactly what goes wrong with several agents working in parallel.

**First feature: portfolio initialization.** Confirmed. Nothing else in the app has anything to operate on until a portfolio exists. Scope: a frontend form for entering tickers and positions, backed by ticker validation, price fetching, and the share/weight/value math above. Optimization, risk, forecasting and the rest come after.

## Open questions (not decided)

- **Write protection for a public deployment.** The old app's `CLASS_WRITE_KEY` gate existed because portfolios were shared, mutable, server-side state anyone could hit. With portfolios moving client-side, is there still anything worth gating (e.g. abuse of the compute/data-fetch endpoints), or is this now moot?
- **Result caching for analysis/optimization output.** Not yet justified by an actual performance problem — don't build it speculatively.
- **CSV upload scope.** Manual entry is confirmed for the first feature. Whether CSV import ships alongside it or immediately after is not yet decided.
- **Ticker validation source.** `GET /tickers/{symbol}` needs something to validate against — a live yfinance lookup per ticker, a cached symbol list, or both. Not decided.
- **Persistent price-cache table.** Deferred until after an initial deployment exists and cold-cache behavior is actually felt as a problem.

## Explicitly cut from the old app

Prophet forecasting; login/identity system (`X-Actor-Name`); watchlists; alerts; decision memos; audit log; job-run tracking; the full relational Postgres/Supabase schema and Alembic migrations; server-side multi-user portfolio storage.

## Dev workflow

- Work happens on the `rebuild` branch. `main` is untouched and holds the old app.
- **`main` is the reference branch; `rebuild` is the development branch.** `main` is never checked out from this working tree — read the old implementation in place with `git show main:path/to/file.py` and `git ls-tree -r main --name-only`.
- Old app files (`backend/`, `frontend/`, `SETUP.md`, `BLUEEAGLE_GUIDE.md`, `docs/`, `jobs/`, `sample_portfolio.csv`, `render.yaml`, `.env.example`) have been removed from tracking on `rebuild`, leaving only `README.md`, `REBUILD.md`, and `.gitignore`.
- When the rebuild is ready to replace the old app: merge `rebuild` into `main` and push. Render/Cloudflare Pages should stay pointed at `main` throughout — don't repoint deploy hooks at `rebuild` mid-build.
- **Only Gunnar commits and pushes.** No agent session does, ever. Stated as a non-overridable rule in every agent role file and system prompt, and backed by a `deny` list in `.claude/settings.json`. An agent that thinks a commit is warranted prints the command and stops. This is a convention, not a hard guarantee — see `agent_prompts/README.md` for the tradeoff that was accepted and the escalation path if it stops holding.
- Three agent sessions (Opus planner, Sonnet implementer, Haiku executor) coordinate through contract and report files under `contracts/`. See `agent_prompts/README.md`.
