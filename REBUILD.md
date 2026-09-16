# Rebuild Plan

Working notes from the planning conversation that led to this branch. Purpose is continuity across chats, not a spec — update it as decisions change instead of treating it as fixed scope. See `README.md` for the current one-page status; this file is the "why" behind it.

## Why a rebuild instead of an iteration

Limited hands-on development history with the existing app, so the goal is to rebuild page by page, feature by feature, to actually understand what's necessary — rather than carry the old architecture forward by default. Willing to make large changes where the old approach doesn't hold up.

## Decided

**Python 3.13** for the backend.
- An earlier version of this file said Prophet's cmdstanpy/Stan toolchain was the one dependency without a clear 3.13 compatibility story. **That is now false** — verified 2026-09-11 by installing it: `prophet` 1.4.0 ships a prebuilt `macosx_11_0_arm64` wheel (no Stan source build) and its metadata declares `Requires-Python: >=3.10` with explicit 3.13 and 3.14 classifiers. Nothing about Prophet forces a Python choice. The 3.13 decision now rests entirely on the scipy floor and ecosystem-mileage arguments below, and the decision to drop Prophet rests entirely on its own value argument — see "Drop Prophet as a forecast method."
- scipy 1.16.1 already requires Python ≥3.12 and dropped older versions — staying on 3.12 (the old app's version, per `main`'s README and `SETUP.md`) would have left less headroom before the next floor moves. An earlier version of this file said 3.11; that was wrong.
- 3.14 was available but skipped: no feature benefit for this app, less ecosystem mileage than 3.13.

**Environment: a `venv` at `backend/.venv`, not conda.**
- An earlier version of this plan specified a conda env named `blue-eagle`. Reversed after checking what agent sessions can actually reach: conda is not on the agent shell's `PATH` (`python` resolves to nothing, `python3` to `/usr/bin/python3` 3.9.6), and `/opt/anaconda3` is blocked by the tool sandbox. An env under `/opt/anaconda3/envs/` is invisible to every coder session — they would all report `BLOCKED` with no way for the contract to pass.
- **Invocation is `PATH="$PWD/backend/.venv/bin:$PATH" python ...`, set inline on every command.** Not activation, not an explicit interpreter path. Both alternatives were tested on 2026-09-11 and both fail: shell state does not persist between an agent's tool calls, so `source .venv/bin/activate && ...` in one call has no effect on the next; and the tool sandbox refuses to execute any binary named by path — `backend/.venv/bin/python`, and even `./probe.sh` inside the repo, return "Access to a sensitive path is not allowed." Only `PATH`-resolved command names execute. Setting `PATH` inline makes each command self-contained, so non-persistence cannot break it, and the same command works fine in an unsandboxed terminal.
- Also matches Render (pip into a clean environment), matches the old app's own convention (`SETUP.md` uses `python3.12 -m venv .venv`), and `.venv/` is already in `.gitignore`.
- 3.13 is not installed on this machine as of 2026-09-11 — Homebrew has 3.11.15 and 3.12.7 only. Setup is `brew install python@3.13` (currently 3.13.15) then `python3.13 -m venv backend/.venv`.
- Not reusing any general-purpose env: `requirements.txt` has to match what Render installs into a clean environment, and a shared env accumulates unrelated packages, so a missing dependency wouldn't surface locally.
- `requirements.txt` (runtime) and `requirements-dev.txt` (test-only) are separate files. Render installs only the former; shipping pytest to production both bloats the build and destroys the file's meaning as a statement of what the app needs.

**Drop Prophet as a forecast method.**
- Was one of four methods (`ewma`/`arima`/`prophet`/`ensemble`) in the old `backend/core/forecast.py`, using only generic yearly-seasonality-on-log-price — nothing Prophet-specific (no holidays, custom regressors, changepoint tuning).
- Heaviest dependency in the stack for the least differentiated output. Ensemble already tolerated per-method failures, so losing it doesn't break the pattern.
- **This is a value judgment, not a compatibility constraint.** The original "most fragile native dependency" framing was tested on 2026-09-11 and did not survive: Prophet installs from a wheel on 3.13 in seconds. If the replacement forecaster below turns out to be genuinely hard with statsmodels alone, Prophet is available and this decision is cheap to reverse — reopen it on the merits rather than assuming it's blocked.
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

**Deploy: everything on Render. Changed 2026-09-13 — Cloudflare Pages dropped.**
- Three Render services: a **Web Service** (backend), a **Static Site** (frontend), and
  **Postgres**. One dashboard, one account, one place to look when something breaks.
- Cloudflare was the earlier choice and its CDN is genuinely faster globally — which matters not at
  all for a single-operator app. Consolidation wins on operational simplicity.
- **Render Static Sites are free permanently**, on free and paid plans alike; there is no server to
  bill for. Consolidating does not save money, and it does not cost any either.
- **Static sites do not sleep.** Only the web service does, so the page always loads instantly and
  only the first API call after idle is slow.

**Live deployment configuration, as built 2026-09-13.**
- **Backend** — Web Service, root directory `backend`, build `pip install -r requirements.txt`,
  start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Python version comes from
  `backend/.python-version` (contract 0001 added it for exactly this). Env: `DATABASE_URL` set to
  the Postgres **Internal** URL — both services are inside Render, so internal is correct and
  faster — plus `CORS_ORIGINS` set to the static site's origin, no trailing slash.
- **Frontend** — Static Site, root directory `frontend`, build `npm run build`, publish `dist`.
  Env: `VITE_API_URL` set to the backend's public URL. **Baked in at build time**, so changing it
  requires a rebuild, not a restart.
- **SPA rewrite is required**: source `/*`, destination `/index.html`, action **Rewrite** (not
  Redirect — a redirect rewrites the URL bar and breaks routing). Without it, reloading directly on
  `/universe` returns 404, because that path exists only in the client-side router.
  **Render does not honour `frontend/public/_redirects`** — verified 2026-09-13 against the live
  site: `/universe` returned 404 while `/_redirects` itself returned **200**, i.e. Render publishes
  it as an ordinary static asset rather than interpreting it. That file is Cloudflare's format and
  is now dead weight; the dashboard rule is the only thing that works here. Leave the file or delete
  it, but do not read its presence as evidence that routing is handled.
- **Deploy order is forced**: backend first (to have a URL) → frontend (bakes that URL in) →
  backend redeploy with `CORS_ORIGINS` pointing at the frontend. There is no way to shortcut it.
- **Measured 2026-09-13: a cold start takes ~43 seconds.** `GET /health` on a sleeping free-tier
  instance returned 200 in 42.7s. The frontend will show `Connecting…` and then `API offline` if
  its health check gives up first. Expected behaviour, not a bug — and the same cold-start problem
  that justified persisting the price cache in Postgres rather than in process.

**Superseded: GitHub + Render + Cloudflare Pages.**
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
- **Re-confirmed 2026-09-13, after deployment, with a sharper reason than the original.** This was
  first decided when the app was a single-operator prototype; it is now deployed, shared, and still
  has no auth. That change strengthens the decision rather than weakening it: **without auth,
  `localStorage` is the only mechanism that gives each person their own portfolios.** Server-side
  storage with no login means one global list that anyone who finds the URL can see, edit, or
  delete, with no way to tell whose is whose. Browser-local storage provides per-user isolation for
  free.
- The split is therefore principled, not incidental: **shared reference data lives on the server
  (the Universe), personal state lives on the client (portfolios).** Rejected at the same time:
  shared Postgres portfolios (no ownership without auth) and Postgres-plus-real-auth (reverses the
  foundational "no auth, no multi-user concerns" decision and is more work than the portfolio
  feature itself).
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

**Every interactive element gets a hover tooltip explaining what it does.** Standing requirement
from 2026-09-15, applies to all future frontend contracts — buttons, links, icon-only controls,
inputs, and rows that respond to clicks. Phrase it as the *effect*, not the label: "Updates ticker
data up to the last close price", not "Update all".
- **Do not use the `title` attribute for this.** It fails in the two situations that matter most:
  - **`title` does not appear on `disabled` elements.** Browsers do not fire mouse events on
    disabled form controls, so the explanation is silent exactly when a user is asking "why can't I
    click this?" Measured on `AddTickerForm`'s Add button (disabled while the input is empty) and
    `Update all` (disabled mid-refresh).
  - Native tooltips have a ~1 second delay, cannot be styled, and are inconsistent across browsers
    and absent on touch.
- **Use a project `Tooltip` component**: short delay, brand-token styling, viewport-clamped
  positioning, and it **wraps** disabled controls so the wrapper receives the hover the control
  cannot. Hand-rolled, no dependency — the same reasoning that inlined lucide icons rather than
  adding `lucide-react`.
- Keep `title` only where it is genuinely a fallback for truncated text (e.g. the `Name` cell), not
  as an explanation mechanism.

**Verification standard: pytest on the backend, typecheck + build on the frontend.**
- Any backend module doing math or data transformation ships with pytest tests. That's where silent wrongness lives — a wrong Sharpe ratio looks entirely plausible, which is exactly what an audit can't catch by reading.
- Frontend contracts are verified by `npx tsc -p tsconfig.app.json --noEmit` and a clean `npm run build`, plus a human look at the running page. UI unit tests are skipped deliberately: high effort, low value while the layout is still moving.
- **A mockup must be built from the response the page will actually receive.** `mockup-universe.html`
  was built from a `UniverseDetail` body (what `POST /universe` returns) while the table it depicts
  is fed by `GET /universe`, which returns the narrower `UniverseEntry`. Contract 0009 therefore
  specified Mkt Cap, P/E and Yield columns *and* a type with none of those fields — an internal
  contradiction nobody could satisfy. Caught by the 0009 coder, fixed by 0010. When a mockup shows a
  value, name the endpoint it comes from.
- **Test responsive layout at breakpoint boundaries, not round numbers.** Tailwind's are 640, 768,
  1024, 1280. **A `min-width` breakpoint's worst case is exactly at its trigger point**, where the
  newly-revealed columns appear in the narrowest viewport that shows them. Contract 0018 specified
  375/700/900/1100/1440, passed all five, and overflowed ~73px at **1024** — where `lg:` reveals
  `Mkt Cap`, `P/E` and `Coverage` simultaneously. Test each boundary and the pixel below it.
- **The Universe table's horizontal overflow has now been a bug three times** (0009, 0014, 0018),
  always the same shape: the card's `overflow-hidden` converts overflow into **silent clipping of
  the last column** rather than a scrollbar, so a screenshot looks correct. The only reliable check
  is numeric — `table.scrollWidth` against the card's `clientWidth`. Never accept "it looks fine."
- **Scope grep-based acceptance criteria to files the contract owns, and to code rather than
  comments.** Three contracts in a row (0003, 0005, 0006) produced grep criteria that failed on
  things that were not violations: `globals.css`'s hex tokens, which the same contract forbade
  touching; a docstring explaining why `currentPrice` is *not* used; fixture comments documenting
  provenance the contract itself had demanded. A crude `grep -rn "currentPrice"` cannot tell a use
  from an explanation. Match the actual construct — `grep -rnE '"currentPrice"'` for a dict key,
  `':\s*any\b'` for a type annotation — and name the exact paths the contract created rather than a
  whole directory. A criterion that fails on correct work trains coders to argue with criteria,
  which is worse than having none.
- **SQLite drops `tzinfo` on a `DateTime(timezone=True)` round trip; Postgres does not.** Found in
  the 0006 tests, where `fetched_at` comes back naive. A test-harness artifact, not a bug — but it
  means any test asserting on a stored timestamp must compare with `tzinfo` stripped, and that the
  behaviour differs between the test backend and production. Worth re-checking during the Postgres
  smoke test rather than assuming the SQLite result generalizes.
- **`npx tsc --noEmit` is not a valid check in this project and must never be used as one.** Discovered 2026-09-13 during contract 0003. Vite's react-ts template makes the root `tsconfig.json` `{"files": [], "references": [...]}`, so plain `--noEmit` type-checks **zero** files and exits 0 unconditionally. It was an acceptance criterion in contracts 0002 and 0003 and passed vacuously; 0002 was audited and accepted partly on it. `tsc -b` is also unsuitable — it is incremental and no-ops when `.tsbuildinfo` is current. Use `-p tsconfig.app.json --noEmit`, which is neither vacuous nor skippable. A criterion that cannot fail is worse than no criterion, because it reads as coverage.
- **Delete Vite's template leftovers at scaffold time.** `npm create vite` leaves files no contract ever names: `src/index.css`, `src/App.css`, `src/assets/{hero.png,react.svg,vite.svg}`, `public/icons.svg`, and `public/favicon.svg` — the last being Vite's purple lightning bolt, which ships as the tab icon until replaced. All were unreferenced dead weight (removed 2026-09-13, CSS bundle 13.33 → 11.65 kB). They are not merely untidy: `globals.css` and `main.tsx` leftovers made two of contract 0003's acceptance criteria **unsatisfiable**, because the greps were scoped to all of `frontend/src/` while the same contract forbade touching the files that matched. Any future scaffold contract must list the deletions explicitly.
- **Page container is `max-w-screen-2xl` (1536px), matching the old app.** Corrected 2026-09-13. Contract 0003 and the mockup both specified `max-w-screen-xl` (1280px), which reads as visibly inset on a wide display next to `main`'s layout. Horizontal padding (`px-4 sm:px-6`) was already identical, so width was the entire difference. Applies to both the header inner container and `<main>`. The hero paragraph keeps its own `max-w-xl` — line measure should not track page width.
- **The favicon is `/logo-nav.png`, set in `index.html`.** `frontend/public/` is served at the site root, so the path is `/logo-nav.png` — not `/assets/logo-nav.png`; the repo-root `assets/` directory is the source of truth, not a served path. Note when changing it: browsers cache favicons per-origin far more aggressively than other assets, ignoring hard reload. Verify in an incognito window, not the tab you have open.
- **React 19 removed the global `JSX` namespace.** `@types/react` 19.x exposes it only as a named export, so a bare `JSX.Element` return-type annotation does not compile. Import it: `import type { JSX } from 'react'`. Contract 0003's interface section specified bare `JSX.Element` and had to be deviated from.
- This is what makes contract acceptance criteria objective, which is the precondition for the Planner re-running verification instead of trusting a report.

**Data fetching: a plain typed fetch client. No react-query yet.**
- One module with a typed function per endpoint; components manage their own loading/error state. The old app used `@tanstack/react-query`, but its real strengths — cache invalidation, deduping, background refetch — barely apply to two endpoints and client-side portfolio state.
- Deliberately reversible: adding react-query later wraps these same functions rather than replacing them.
- Rejected: bare `fetch()` at call sites. The base URL and response types would duplicate across components, and that diffuse-edit shape is exactly what goes wrong with several agents working in parallel.

**Launch page: header nav is the only navigation; entry cards are explanatory.**
- Settled 2026-09-11 against a static mockup (`mockup-launch.html`, throwaway) rather than in the abstract. UI-first slicing: build the visual shell, look at it, then add behaviour.
- **Header nav** — `Universe`, `Portfolios`, `Research`, and an `/ops` gear icon — carried over from `main`'s header, with `Securities` renamed to `Universe`. These are the app's navigation.
- **Four entry cards** (`Portfolio`, `Optimize`, `Risk`, `Outlook`) describe what the dashboard does. They are **not** navigation and must never become clickable — same role as `main`'s `WORKFLOW_STEPS` block. Rendered as non-interactive elements so the distinction is enforced structurally, not by convention.
- Everything on the page is inert this slice except a small backend status indicator, which preserves contract 0002's proof that the two halves talk.
- The gear icon is lucide's `settings` path inlined as a local component. `lucide-react` is **not** added as a dependency — one icon does not justify a 1,500-icon package. The path is ISC-licensed; keep the attribution comment.

**First feature: a curated, shared, server-persisted Universe.** Decided 2026-09-13. Supersedes
both "portfolio initialization first" and the read-only-catalog framing considered earlier the same
day.
- Scope: `/universe` is the single place the universe is written. Two write actions, both
  user-initiated: **add a ticker**, and **update stored data for a ticker already in it**. Stored
  data is read by everything downstream — stock analysis, and portfolios scoped to subsets of it.
- Persistent and shared across users and sessions. One universe, not one per browser.
- Why it moved ahead of portfolio init: a portfolio needs tickers to exist; a universe needs
  nothing. It is the only feature here with standalone value. The original "nothing else has
  anything to operate on" argument was true about *dependency* and backwards about *usefulness*.
- Requires adding `yfinance` to `requirements.txt`, which contract 0001 deliberately excluded until
  a contract needed it.

**This reverses three earlier decisions. Named explicitly so they are not re-argued by accident:**
1. **"No hosted database, deferred not rejected"** → a database is now required. Shared state
   across users cannot live in `localStorage` or an in-process cache by definition.
2. **"Backend stays Python, stays server-side, but goes stateless (no DB) for now"** → the backend
   is now stateful. The `get_cached()` / `store()` interface built for exactly this swap
   (see below) is what keeps the change localized.
3. **Render's free-tier sleep/ephemeral-filesystem tradeoff, accepted as "not a blocker"** → it was
   a blocker after all, for a different reason than expected: a cold in-process cache on every wake
   means refetching everything from Yahoo, which is the traffic pattern most likely to get the
   server's single IP rate-limited.

**No write gate. Anyone who can reach the deployed app can write to the universe.** Decided
2026-09-13, as an accepted risk rather than an oversight — the alternative (`CLASS_WRITE_KEY`-style
shared header) was raised explicitly and declined.
- What this accepts: a public URL where any visitor can add arbitrary tickers and trigger outbound
  Yahoo fetches that write to a shared database.
- What limits the damage: the freshness rule above makes repeat "update" calls no-ops, so the
  obvious abuse vector is largely closed by a decision made for other reasons. What remains is
  junk-ticker insertion and first-fetch cost on genuinely new symbols.
- Cheap reversal if it ever matters: one env var and one header check, no login system, no user
  records. Revisit at deploy time rather than treating this as settled forever.

**What survives unchanged, and should not be touched while implementing this:**
- **Portfolios stay client-side in `localStorage`.** Shared reference data server-side, personal
  state client-side, is a coherent split — do not let the database pull portfolios back onto the
  server.
- **No auth.** Market data is public and identical for everyone; shared reads need no identity.
  (Shared *writes* are a separate problem — see open questions.)
- **Incremental refresh.** If a ticker's data is stale, fetch only the missing date range and
  append. Already decided, now load-bearing.
- **The cache interface.** `get_cached()` / `store()` was built so persistence could be added as a
  change to one module. Honour that boundary; the database must not leak into callers.

**Database: Postgres. Provider not yet locked; Neon preferred over Render's own.**
- Workload is ordinary relational: daily OHLCV keyed `(ticker, date)`, fundamentals keyed by ticker,
  bulk appends, reads by ticker and date range. Postgres is the industry-standard answer at this
  size. TimescaleDB/ClickHouse are the scale answer and are over-engineering here; Parquet on object
  storage is worse for the incremental single-ticker appends this app actually does.
- **Neon** preferred: serverless, scale-to-zero, free tier does not expire. **Render Postgres** is
  simpler (one vendor) but its free instance expires and is deleted. Both are plain Postgres, so
  this is a connection-string decision, not an architectural one. **Verify current free-tier terms
  before committing** — expiry policy is the entire basis for the preference and it changes.
- Rejected: SQLite (Render's filesystem is ephemeral; the file vanishes on deploy), Mongo (already
  rejected, and this workload is more relational now, not less).
- **Three tables, nothing else, without a decision:** price bars, ticker fundamentals, and
  membership. The third was added deliberately 2026-09-13 — see below.

**Universe membership is its own table, not implied by presence in `ticker_fundamentals`.**
Decided 2026-09-13, resolving contract 0004's open question.
- `universe_tickers(ticker PK, added_at, active)`. Membership is an explicit fact, not a side effect
  of having once cached some data.
- The alternative — "in the universe" means "has a fundamentals row" — is simpler but conflates two
  different things: *what we have data for* and *what the operator chose to track*. It also makes
  de-listing impossible without deleting data.
- With an `active` flag, removing a ticker is a flag flip that keeps its price history intact. That
  is exactly what the no-foreign-key rule on `price_bars` was built to allow: cached market data
  must not depend on a curated list, in either direction.
- `added_at` exists because "when did this enter the universe" is a question that cannot be
  reconstructed later from anything else.

**Adding a ticker stores fundamentals *and* full daily price history.** Decided 2026-09-13.
Fundamentals alone would leave the expensive data — thousands of OHLCV rows per ticker — back in
the in-process cache, which is the exact cold-start problem the database exists to solve. Accepted
cost: adding a ticker takes seconds, not milliseconds, and writes thousands of rows.

**Freshness rule: stored data must be current through the last completed session.** Decided
2026-09-13, in preference to a time-based TTL.
- A ticker is stale iff its newest stored bar predates the last completed trading session. Fresh
  tickers are not refetched. This is idempotent: clicking "update" twice in a day is a no-op the
  second time, which also removes the click-loop abuse vector without needing a rate limiter.
- **Deriving "the last completed session": read the newest bar date from a reference ticker
  (SPY).** Verified 2026-09-13 (a Sunday): SPY's newest bar is Friday 09-11, and the series shows
  a gap between 09-04 and 09-08 for Labor Day. This gets weekends *and* market holidays right for
  free, with no `pandas_market_calendars` dependency and no hand-maintained holiday list. Cache the
  result briefly; it changes once a day.
- **Two guards against partial bars, both required.** During market hours yfinance can return an
  in-progress bar for the current day. Stored unguarded, a ticker looks fresh while holding an
  incomplete close, permanently. So: (a) take the newest reference bar **strictly before today** as
  the last session, and (b) on fetch, refetch from the last stored date *inclusive* and overwrite,
  never blind-append. Both need a test.
- **Superseded 2026-09-13.** That sub-decision — "strictly before today, always" — was the
  overcautious option and is replaced by the composed rule: **the newest reference bar, excluding
  today unless it is past 16:00 ET.** The reference ticker still supplies the set of real sessions
  empirically (holidays, half-days, no calendar dependency); the 16:00 check from `YF.py:203-208`
  decides only whether today counts yet. Six lines of `zoneinfo`, and it removes a full session of
  lag on weekday evenings. Specified in contract 0007.
- **No foreign key from price bars to the universe table.** The old `PriceBar` had
  `ticker → universe_tickers.ticker ON DELETE CASCADE`, so removing a ticker silently destroyed its
  price history. Cached market data must not depend on a curated list existing.

**What yfinance actually returns, measured 2026-09-13** (yfinance 1.7.0, via `Ticker(sym).info`).
Checked before designing the Universe layout, because a layout is a claim about what data exists.

- **Use `regularMarketPrice`, not `currentPrice`.** `currentPrice` is `MISSING` for ETFs (SPY) and
  present for equities; `regularMarketPrice` is present for both. Getting this wrong means every
  ETF shows a blank price.
- **ETFs are missing six of the equity fields**: `sector`, `industry`, `currentPrice`, `marketCap`,
  `beta`, **`forwardPE`**. SPY returns 103 keys vs ~180 for an equity. It has `totalAssets` and
  `navPrice` instead. Any fundamentals layout needs an explicit ETF variant or graceful holes —
  not `undefined` rendered into the page.
  *(An earlier version of this entry said five, omitting `forwardPE`. The original probe checked
  `forwardPE` only against equities. Corrected 2026-09-13 after the 0006 coder hit it live;
  re-verified across SPY, QQQ and VTI — all three lack exactly these six.)*
- **`dividendYield` is in percent units, not a fraction.** AAPL returns `0.33` meaning 0.33%. Do
  not multiply by 100. (Older yfinance returned a fraction; this changed.) Non-payers — TSLA,
  BRK-B — omit the key entirely rather than returning `0`, so render `—`, not `0.00%`.
- **An invalid symbol does not raise.** `Ticker("NOTAREALTICKER").info` returns
  `{'trailingPegRatio': None}` and logs an HTTP 404 to stderr. Validation must test for a required
  key (e.g. `regularMarketPrice` or `shortName`), **not** `try/except`. A `try/except` here
  silently treats every typo as a server error.
- Reliably present for equities across sectors (AAPL/JPM/XOM/TSLA/BRK-B): `shortName`, `longName`,
  `sector`, `industry`, `regularMarketPrice`, `previousClose`, `marketCap`, `trailingPE`,
  `forwardPE`, `fiftyTwoWeekHigh`, `fiftyTwoWeekLow`, `beta`, `currency`, `exchange`, `quoteType`,
  `averageVolume`.

**The stored-DataFrame shape is a contract. Normalize on the way in, not just on the way to the
database.** Established 2026-09-13 during the contract 0004 audit.
- Canonical shape: index is a `DatetimeIndex` named **`date`** at `datetime64[us]`; columns are
  lowercase `open, high, low, close, adj_close` as `float64` and `volume` as `Int64` (nullable),
  **always all six, in that order** — normalization fills a missing column with NA rather than
  omitting it, so a frame read from the TTL cache and one read from the database are identical
  regardless of what the caller supplied. (`adj_close` added by contract 0005.)
- **yfinance does not produce this shape.** Measured live: index name `Date`, `datetime64[s]`,
  `volume` as `int64`. Anything feeding `store()` must normalize first, and `store()` must cache
  the *normalized* frame — otherwise `get_cached()` returns one shape from the TTL cache and a
  different one from the database, and which you get depends on cache timing rather than on input.
  That failure is invisible in tests whose fixtures are already in the output shape.
- Lesson for future contracts: a round-trip test whose **input shape equals its output shape**
  cannot fail. Require the input to differ.
- **Known debt: `app/cache.py` normalizes conditionally**, via a `_looks_like_ohlcv()` heuristic, so
  the cache behaves differently depending on its input's column names. This exists only because
  contract 0001's tests store arbitrary non-OHLCV frames (`date`/`price`) and contract 0004 required
  they pass unmodified — the two requirements were in direct tension and the contract did not notice.
  **Clear it after 0006:** migrate `tests/test_cache.py` to OHLCV-shaped frames, drop the guard, and
  normalize unconditionally. The cache stores price history; it should not have a passthrough mode.
  Second reason, found in the 0005 audit: the guard matches on bare `.lower()` while
  `_normalize_ohlcv` also maps spaces and hyphens to underscores, so the two disagree about whether
  a column named `Adj Close` counts as adjusted close. Unreachable in practice — yfinance always
  returns the full column set — but it means the heuristic's definition of "OHLCV-shaped" is not the
  same as the normalizer's, which is exactly the kind of near-miss that becomes a real bug later.

**Store raw OHLCV *and* `adj_close`; fetch with `auto_adjust=False`.** Decided 2026-09-13 after
reading `reference files/old_yfinance_project/YF.py`.
- Raw OHLC is an **invariant**: a raw close that changes means genuine data corruption or a vendor
  correction, never a corporate action. `adj_close` is the **restatement-prone** value: it changes
  retroactively across the entire history on every split and dividend.
- Holding both gives one canary and one signal. `auto_adjust=True` — what `main`'s `provider.py`
  used, and what contract 0004 was specified against — collapses them into a single column that is
  silently rewritten by Yahoo, leaving nothing to verify against.
- Contract 0004 shipped without an `adj_close` column. Corrected by contract 0005 before anything
  fetches, because data written without it can never be integrity-checked afterwards.

**Splits and dividends retroactively restate stored history. The freshness rule cannot detect
this.** Found 2026-09-13 in the old yfinance script, which solved it; `REBUILD.md`'s own rule did
not account for it.
- The freshness rule ("is the newest stored bar current through the last completed session?")
  detects **forward** staleness only. After a 4:1 split, every stored adjusted price before the
  split date is wrong by a factor of four while the newest bar is perfectly current — so the rule
  reports "fresh" and serves corrupted data indefinitely. Every downstream number (returns, vol,
  Sharpe, correlation) is then wrong and looks entirely plausible.
- **Detection, carried over from `YF.py:149-201`:** compare stored `adj_close` against freshly
  fetched `adj_close` with a tight tolerance (`np.isclose(atol=1e-6, rtol=0)`). On mismatch the
  series has been restated — refetch the full stored span and upsert over it rather than appending.
- **The correct probe is the *most recent* stored bar, not an old one.** Corrected 2026-09-13 during
  the 0007 audit; contract 0007's stated rationale had this backwards. An action with ex-date D
  restates every bar **before** D. A newly-occurring action therefore has an ex-date *after* the
  whole stored series, so it restates the newest stored bar too — and that bar is already re-fetched
  every update by the partial-bar guard. Detection is free; no extra request is needed.
- `pick_drift_anchors` still returns three dates (first, middle, last), but only anchors falling
  inside the fetched window are compared, which in the routine path is the last one. The other two
  engage only on a wide refetch. **This is a known and accepted limitation**: the uncovered case is
  Yahoo retroactively revising old data with *no* corporate action, which is a different failure
  mode and is not currently scoped.
- Belongs to contract **0007**, not 0006. The fetch layer was split in two on 2026-09-13: 0006 gets
  data in correctly *once*; 0007 keeps it correct *over time* (freshness rule, partial-bar guards,
  drift detection). Split because drift detection is the piece where a wrong answer is invisible —
  it earns its own audit rather than being the sixth thing checked in a large diff, per
  `agent_prompts/planner-opus.md`'s "size contracts to the audit."
- Remaining sequence: 0008 universe table + API, 0009 the `/universe` page.

**Also worth carrying from `YF.py`, not yet scoped:**
- **`get_effective_end_date()` (`YF.py:203-208`)** — a six-line `zoneinfo` check for whether it is
  past 16:00 America/New_York. An earlier entry above rejected timezone logic as "more failure modes
  than one session of lag is worth"; that was overcautious. It *composes* with the reference-ticker
  trick rather than replacing it: the reference ticker says empirically which sessions exist
  (holidays, half-days, no calendar dependency), and the 4pm check says whether today counts yet.
- ~~**Prepending, not just appending (`YF.py:496-561`)**~~ — **built 2026-09-14, contract 0016.**
  `refresh_ticker` now extends both edges. See "Backfilling history backwards" below for the
  termination rule, which is the non-obvious part.
- **Not carried:** the CSV layer, `input()`/CLI, `_OLD.csv` backups (upserts replace them),
  `pandas_market_calendars` (the reference-ticker approach needs no native dependency and cannot
  disagree with what yfinance actually serves), and `fetch_data`'s error handling, which redirects
  stdout and string-matches `"PricesMissingError"` — an invalid symbol is better detected by the
  measured `{'trailingPegRatio': None}` shape.

**Postgres smoke test: passed 2026-09-13 against a real Render instance.** Every path that had only
ever run as its SQLite twin is now confirmed: Alembic `0001`→`0002` applied, `pg_insert` upsert
written and read back, `pool_pre_ping` held, the scheme rewrite resolved the engine to
`postgresql`/`psycopg`, and data survived across separate processes. `auto_adjust=False` verified
decisively over a dividend-spanning window — 105/105 rows with `close != adj_close`.
- **`fetched_at` keeps its timezone on Postgres (UTC), unlike SQLite.** The `tzinfo` drop noted
  during 0006 is a SQLite test-harness artifact only and does not generalize. Do not write
  production logic around it.
- Two bugs this test caught that no unit test could have, both now fixed: `normalize_database_url`
  handled only `postgres://` while Render actually issues `postgresql://` (which SQLAlchemy resolves
  to psycopg**2**, not installed), and nothing loaded `backend/.env` at all, so `DATABASE_URL` had to
  be exported per-terminal. This is the case for keeping a mandatory "Human verification" section on
  any contract whose tests mock the thing that matters.
- **Render gives two connection strings.** The **External** URL (`dpg-...-a.<region>-postgres.render.com`)
  is for local development; the **Internal** one (bare `dpg-...-a`, no domain) resolves only inside
  Render's network and is what the deployed backend should use. Using the internal URL locally fails
  with a DNS error.

**`yf.download`'s `end` is EXCLUSIVE. Every date parameter in this codebase is INCLUSIVE.**
`app/market_data.py:_download_history` is the single place that converts, adding one day on the way
out. Do not add the day at any call site.
- Proven 2026-09-14: `end=2026-09-14` returned only `['2026-09-11']`; `end=2026-09-15` returned
  `['2026-09-11', '2026-09-14']`.
- The bug this caused was subtle and total: `missing_range` returns `(newest_stored, last_session)`,
  so the last session was never fetched, the stored bar could never reach it, `is_stale` was
  permanently `True`, and **`refresh` looped forever** — reporting `"appended"` with an unchanged
  bar count on every call. It destroyed the idempotence property contract 0007 was written to
  guarantee, and each wasted call added load to Render's shared IP.
- **`YF.py:258` documented this and contract 0007 missed it.** The reference script was read for its
  drift detection and its 4pm rule; its most important line was a comment about `end` exclusivity.
- **Why 102 tests missed it:** the freshness tests are pure-function tests whose fake downloader
  returned everything in `[start, end]` *inclusive*. A fixture that models the vendor's semantics
  wrongly passes whether or not the code is right. **When mocking a third-party API, the fake must
  reproduce its actual convention, not the convention you wish it had.**

**Yahoo's fundamentals endpoint fails from Render; price history does not.** Measured 2026-09-14.
- `Ticker(x).info` hits `quoteSummary`, which requires a "crumb" token. From Render's shared
  datacenter IP the crumb fetch is rate-limited (429) and the fallback is rejected (401), so `.info`
  returns an empty dict. `yf.download` hits the chart endpoint, needs no crumb, and works fine —
  `POST /universe/MSFT/refresh` returned 200 at the same moment `POST /universe` returned 404 for
  SPY.
- **Design consequence, contract 0013: price history is the authority on whether a symbol exists**
  (`symbol_has_history`, a ~10-day probe), and fundamentals are best-effort enrichment that may be
  absent. `fetch_fundamentals` returns `None` rather than raising, and writes nothing when it does —
  an all-null row would be indistinguishable from a real ETF. `refresh` backfills fundamentals when
  absent, so a ticker added during an outage heals itself.
- `has_fundamentals: bool` exists on `UniverseEntry` because `—` otherwise means two different
  things: *this ETF has no market cap* and *we never got this ticker's data at all*.
- **Root cause deliberately not chased.** Whether it is IP throttling or `curl_cffi` TLS
  fingerprinting differing on Linux does not change the fix. No proxy, no user-agent override, no
  impersonation setting.
- **Known gap:** if `symbol_has_history` itself fails, it raises `UpstreamUnavailable`, which is not
  mapped to an HTTP status and surfaces as a **500**. Honest but ugly — 503 would be better. Not yet
  observed in production; fix it when it fires.

**Clarification on the ETF null count.** "ETFs lack six fields" is a statement about *yfinance*:
`sector`, `industry`, `currentPrice`, `marketCap`, `beta`, `forwardPE`. In *our schema* it is
**five** — `currentPrice` never became a column, because `regular_market_price` was chosen precisely
to avoid it. Contracts have conflated the two counts; the schema number is five.

**Run the full backend suite at the start of every audit, whatever the contract's domain.**
Established 2026-09-14 after the suite sat broken for two contracts without anyone noticing.
- Commit `79849af` (a hand edit, not a contract) renamed `HISTORY_YEARS` → `HISTORY_START` in
  `app/universe.py` and left `tests/test_universe.py` importing the old name — an `ImportError` at
  collection, so the whole file failed to load, not just one test.
- The planner missed it because the next audit (0015) was frontend-only: `tsc` and `npm run build`,
  no pytest. The tree drifts between contracts, and hand edits are exactly the changes no contract
  covers.
- Cost was low here only because the 0016 coder hit it and fixed it. Do not rely on that.

**Backfilling history backwards: compare against the earliest *session*, never the calendar date.**
`app/freshness.py:prepend_range`, contract 0016.
- `HISTORY_START` is a calendar date and 1 January is never a trading day, so `first_bar >
  HISTORY_START` is **permanently true for every ticker**. Measured 2026-09-14: requesting
  `2016-01-01` returns `2016-01-04` for both MSFT and SPY. A rule built on that comparison re-probes
  every ticker on every refresh forever — contract 0012's non-termination bug in a new place.
- The termination condition is `first_bar <= earliest_session_on_or_after(HISTORY_START)`, where the
  earliest session comes from the reference ticker. That value never changes, so it is fetched once
  and cached; N tickers cost one fetch.
- **Accepted residue:** a ticker whose history genuinely begins later (RDDT, IPO 2024) stays above
  the earliest session forever and re-probes once per refresh, returning nothing. One wasted request
  per young ticker, bounded and visible. Persisting a per-ticker "already asked from" date would fix
  it but needs a migration and a column whose semantics ("asked from", not "data starts at") are
  easy to misread. Deferred until there is a measurement showing it matters.
- **A prepend must `pd.concat` with the stored frame before `store()`.** Storing only the prepended
  chunk replaces the in-process TTL cache with a frame holding 2016 and nothing since — the database
  stays correct while `get_cached` lies for up to 24 hours. Verified 2026-09-14 that the
  implementation concatenates: after a prepend the cached frame spans `2016-01-04 → 2016-09-15`.
- Prepending runs **even when the forward path reports `action="none"`**. A ticker can be current at
  the front and short at the back; that is the whole case.

**Known gap: `UniverseEntry` carries `current_price` but no quote timestamp.** Contract 0024 added
`current_price` and `last_close`; contract 0025 assumed a `quote_as_of` alongside them and there
isn't one — a planner error, both contracts written without cross-checking the second against what
the first shipped.
- The chart's live point therefore labels its x-axis with **today's UTC date derived on the client**,
  not the quote's real timestamp. That is correct in the only window it runs: during market hours
  (13:30–20:00 UTC) the UTC and ET dates always agree, and outside them `current_price` is `null` so
  the derived date is never used.
- Correct by argument rather than by construction. If quotes ever gain pre-market or after-hours
  coverage, **this breaks silently** — the UTC date rolls over at 20:00 ET while the ET date has
  not. Add `quote_as_of` to `UniverseEntry` before extending quote coverage beyond the regular
  session.

**Tests must never depend on the wall clock, and patching must target where a name is *looked up*.**
Two occurrences, 2026-09-15, same root:
- `app/universe.py` does `from app.quotes import is_market_open`, which binds an **independent name
  at import time**. Patching `app.quotes.is_market_open` does not affect it. Contract 0024's fixture
  did exactly that and was reviewed and accepted; two tests asserting on `current_price` were
  therefore passing or failing **according to the time of day they ran** — green at night, red
  during market hours. Found in contract 0027.
- The same contract earlier introduced a live network call inside `list_all`, guarded only by a
  fixture patching the wrong namespace.

Rules: **patch every module that imported the name**, not just the module that defines it. And any
test touching market state, freshness, or quotes must pin time explicitly — a suite whose result
depends on when it runs is not a suite. The pure/impure split in `freshness.py` and `quotes.py`
exists so time can be passed in; use it rather than patching a clock.

**Tests must never inherit an ambient `DATABASE_URL`.** `backend/tests/conftest.py` strips it via an
autouse fixture; opt-in fixtures re-set it to a `tmp_path` SQLite file.
- Why, concretely: on 2026-09-13, minutes after `backend/.env` was created with a live Render URL,
  `pytest` began issuing real `INSERT INTO price_bars` against production. `tests/test_cache.py`
  calls `store()` and pins no URL of its own.
- It surfaced only by luck. Contract 0001's fixtures are non-OHLCV frames with an integer index, so
  Postgres rejected them (`cannot cast type smallint to date`). OHLCV-shaped fixtures would have
  **succeeded**, silently seeding the live table.
- Every prior test run passed because no `DATABASE_URL` existed anywhere in the project. The bug was
  present from contract 0004 onward and invisible until configuration changed — a reminder that
  "tests pass" means "tests pass in the environment they were run in."
- Do not weaken this to skipping only production-looking URLs. The failure mode is a test writing to
  whatever database the developer has configured, which is precisely when it looks legitimate.
- **`conftest.py` protects `pytest` only — ad-hoc scripts are still exposed.** Because
  `app/config.py` calls `load_dotenv()` at import, any `python -c` connects to the live database.
  Found 2026-09-13 during contract 0008, when a routine sanity check issued a real query against
  Render. It failed harmlessly, but the contracts' own verification blocks had the same shape —
  0008's final command claimed to exercise degraded mode and would instead have hit production,
  reporting the opposite of what it asserted. **Every ad-hoc `python -c` must be prefixed
  `DATABASE_URL=""`**, now required by `contracts/TEMPLATE-contract.md`. Verified that the prefix
  blocks `load_dotenv` from refilling the value.

**`yf.download` with no `start`/`end` returns roughly one month (~22 bars), not full history.**
Measured 2026-09-13. Relevant to the open question of how much history to fetch when a ticker is
first added — the default is far too short for any of the analytics this app exists to do, so the
caller must pass an explicit `start`.

**If curation is added later, it goes in Postgres — not `localStorage`.** Direction, not a
decision; nothing depends on it yet.
- Reverses "No hosted database, deferred not rejected" *if it happens*. Deliberately chosen over
  `localStorage` despite portfolios going the other way, because a curated universe is plausibly
  shared reference data rather than per-operator state.
- Real cost when it comes due: a Render Postgres service, a connection string in two environments,
  SQLAlchemy and a driver back in `requirements.txt`, and migrations — the machinery the rebuild
  removed. Revisit at the moment curation is actually wanted, and test then whether a *shared*
  universe is the point or whether per-browser would have done.

**Superseded: first feature was portfolio initialization.** Nothing else in the app has anything to operate on until a portfolio exists. Scope: a frontend form for entering tickers and positions, backed by ticker validation, price fetching, and the share/weight/value math above. Optimization, risk, forecasting and the rest come after.

**The launch-page ticker strip shows the last completed session's move, not `0.00%`.** Built
2026-09-15, contract 0028. It reads `price_bars` and `ticker_quotes` only — no yfinance call, no
migration, no new dependency — and groups by `quote_type` (`INDEX` → Indices, `ETF` → ETFs, rest →
Equities), omitting empty groups. Returns use `adj_close`, prices use raw `close`.

This **deliberately disagrees with the Universe table**, which shows `0.00%` when the market is
closed (contract 0026, Gunnar's instruction). The two answer different questions: the table asks
"has this moved since the close I am showing you" — no, by construction — and the strip asks "how
did the session go." A strip of twenty zeros every evening is not a ticker strip. Anyone
cross-checking the two after hours will find them different; that is correct, and it is the one
thing about this feature worth understanding rather than just checking. The 5D/30D/YTD windows are
computed and typed but not yet rendered.

**The ticker strip is one unlabelled row in the app chrome, not three labelled rows on `/`.**
Rebuilt 2026-09-15, contract 0029. Rendered in `App.tsx` between `<Header/>` and `<Routes>` — so it
mounts once, appears on every page, and does not refetch on navigation. Deliberately **not** sticky:
the header stays pinned and the strip scrolls away, chosen over a two-tier sticky header so the
Universe table keeps its vertical space.

**Ticker names need both `short_name` and `long_name`.** Measured 2026-09-15: Yahoo hard-caps
`short_name` at **31 characters** and truncates mid-word — 6 of 20 tickers were cut
(`Constellation Energy Corporatio`, `State Street Technology Select `). But `long_name` is not
simply better: `^RUT` is `' Russell 2000 Index'` with a **leading space** against a clean
`'Russell 2000'`, and `BYDDF` is `'BYD Company Limited'` against `'BYD Co., Ltd.'`. The rule in
`resolve_display_name` is *prefer `short_name` unless provably truncated*, and the length test runs
on the **raw** string — `XLK`'s `short_name` is 31 raw but 30 stripped, so stripping first hides the
truncation on exactly that one ticker.

**Index levels are not dollars.** `^GSPC` renders `7,585.73`, not `$7,585.73`. Keyed off
`quote_type === 'INDEX'`, never off the display label — `'Indices'` is a label and must not drive
formatting.

**Marquee duration must scale with content.** A fixed duration means a longer track scrolls
proportionally faster. `max(60, items.length * 5)` seconds, passed as an inline `animationDuration`
while `animation-name`/`-timing-function`/`-iteration-count` stay in the class — the `animation`
shorthand with no duration resolves to `0s` and the row never moves.

**Known defect: `prefers-reduced-motion` has no working fallback.** From contract 0028, still
present. The media query sets `overflow-x: auto` on `.ticker-strip-marquee`, which is `w-max`
(`width: max-content`) and therefore never overflows itself — no scrollbar, nothing to scroll —
while its `overflow-hidden` parent clips the rest. The animation *is* correctly disabled; only the
fallback is broken, so a reduced-motion user sees the first screenful of tickers frozen and cannot
reach the others. The `overflow-x: auto` belongs on `.ticker-strip-track`. Unfixed as of 2026-09-15.

**Grepping for a word is not verifying a construct.** Contracts 0028 and 0029 both accepted
`grep -n "prefers-reduced-motion"` as proof the reduced-motion path worked. It proved the string was
in the file. The defect above shipped twice behind that check. This is the planner's most repeated
mistake — five earlier instances flagged correct work as broken; this one flagged broken work as
correct, which is the more expensive direction. An acceptance criterion must name the construct and
its effect, not a keyword.

**Verification only counts against the code that ships.** Two distinct failures, both found on
2026-09-15 during 0028, both producing a confident and wrong result:

1. A browser harness was built by **editing `frontend/src/main.tsx`**, mocking `fetch` to return
   fabricated `/universe/strip` prices. It typechecked, built, and rendered. A deploy would have
   shown invented ticker data with no error anywhere. The asymmetry that makes this dangerous: a
   leftover *new* file shows up untracked in `git status` and gets noticed; a leftover *edit to an
   entry point* is invisible until it ships. Harnesses are now new files only, deleted afterwards.
2. Verification ran against a **`uvicorn` started without `--reload`**, predating the route under
   test. `/universe/strip` returned `{"detail":"STRIP is not in the universe"}` — byte-identical to
   what the route-ordering trap produces, from a correctly-ordered file. Do not conflate them: one
   is fixed by an edit, the other by a restart, and a reader who confuses the two will go reorder
   code that is already right. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

Recorded in both coder role files and in the contract template's Human-verification section.

## Open questions (not decided)

- **Whether tickers can be removed from the universe.** Only add and update have been specified. If removal exists, decide whether it deletes cached price history or just de-lists the ticker — the no-FK rule above means de-listing is the cheap default.
- ~~**Bulk update ("update all").**~~ **Built 2026-09-14, contract 0014 — frontend only.** One `Update all N` control loops **sequentially** over the existing per-ticker `POST /universe/{ticker}/refresh`; no new backend surface, no `Promise.all`. Sequential is the load-bearing choice, not a style preference: concurrent fan-out reproduces the request burst that got Render's shared IP crumb-throttled in contract 0013. The freshness rule keeps the cost proportional to *stale* tickers rather than total ones. The per-row refresh button was removed at the same time, making `UniverseTable` a pure display component.
  - It deliberately **ignores filters** (contract 0015) — hence the count in the label, so "all 9" while three rows show is unambiguous rather than a lie.
  - Unmount must **break the loop**, not merely suppress `setState`; otherwise navigating away leaves every remaining ticker's request in flight. Caught in the 0014 audit, since a "no console warnings" test passes while the requests keep firing.
- **Bulk refresh cost at scale.** Still open, one level up: sequential refresh over 50+ tickers is slow by design, with no cancel control and no progress persistence across a reload. Do not parallelise it; if this becomes painful the answer is a server-side job, not concurrency from the browser.
- **Result caching for analysis/optimization output.** Not yet justified by an actual performance problem — don't build it speculatively.
- **CSV upload scope.** Written when portfolio initialization was the first feature; that changed. Manual ticker entry is what the Universe ships with. Whether CSV import arrives for the *universe* (bulk-adding tickers), for *portfolios* (positions), or neither, is undecided.
- **Universe filtering is built (contract 0015) but holds nothing back.** Client-side search plus six filters in a dialog. Still open, and deliberately not built: **sorting** (the list is ticker-ordered), **persisting filter state in the URL** — `/universe?sector=Technology` would be shareable and survive a reload now that the router exists — and **negative P/E**, where a "max 25" filter silently includes an unprofitable company at −40. None are present in the current nine tickers.
- ~~**Ticker validation source.**~~ **Resolved 2026-09-13 by the curated universe.** Two separate checks now exist and neither needs an SEC symbol file. (1) Adding to the universe: yfinance is the authority — a bad symbol returns `{'trailingPegRatio': None}` without raising, so validity is "does `.info` contain a required key." (2) Portfolio entry, later: validate against **the universe itself**, which is a served list the app already owns. This is strictly simpler than the served-symbol-list plan recorded under "Ticker validation" in Decided, which that entry should be read as superseded by.
- ~~**Persistent price-cache table.**~~ **Resolved 2026-09-13 — it is being built.** See "First feature: a curated, shared, server-persisted Universe" in Decided. The deferral reasoning ("not before an initial deployment exists") was overtaken by the decision to share a universe across users, which requires persistence by definition.
- **Whether `Research` and `/ops` survive as real features.** Two of the launch page's four nav destinations still contradict "Explicitly cut from the old app" below: `/research/*` includes decision memos and stress pages; `/ops` was backed by `job_runs`, `audit_log` and `email_config`, and `core/ops/data_status.py` reports on a database this rebuild does not have. The nav labels are settled; **what they eventually point to is not.** Either the cut list gets revised or the labels do. Do not resolve this by building either page. (`Universe` is resolved — see "First feature" above. `Portfolios` was never in doubt.)
- ~~**Routing.**~~ **Decided 2026-09-13: real URLs via `react-router-dom`.** Reverses contract 0002's "no router — there is one page," deliberately rather than by drift. `/universe` is a real address that can be linked, bookmarked, and reloaded; the alternative — the header nav swapping views inside one page with the URL never changing — breaks the browser back button and makes every future page a special case. The cost is one dependency and a route tree, both of which `REBUILD.md` had deferred precisely until a second page existed. It now does. The header nav items stop being inert `<span>`s and become real links when the frontend contract lands; until then they stay as built.

## Explicitly cut from the old app

Prophet forecasting; login/identity system (`X-Actor-Name`); watchlists; alerts; decision memos; audit log; job-run tracking; the full relational Postgres/Supabase schema and Alembic migrations; server-side multi-user portfolio storage.

## Dev workflow

- Work happens on the `rebuild` branch. `main` is untouched and holds the old app.
- **`main` is the reference branch; `rebuild` is the development branch.** `main` is never checked out from this working tree — read the old implementation in place with `git show main:path/to/file.py` and `git ls-tree -r main --name-only`. That is how agent sessions read it; they do not use the worktree below.

### The reference worktree

Created 2026-09-11 at `~/WebstormProjects/blue-eagle-reference` so the old app can be read and run
side-by-side without branch-swapping:

```bash
git worktree add --detach ~/WebstormProjects/blue-eagle-reference main
```

- **Why a worktree and not `git checkout main`.** Swapping branches in this tree yanks files out from under running agent sessions mid-contract, and gitignored directories (`node_modules/`, `.venv/`, `.next/`, `dist/`) do **not** move with the branch — you end up running Next.js against a `node_modules` installed for Vite. Two directories means two dependency trees and two interpreters that never collide.
- **`--detach`, not the branch.** `main` is frozen and never merged into, so nothing is gained by having the branch checked out, and a stray commit in that directory lands on a detached HEAD instead of advancing `main`. Git also refuses to check out one branch in two trees.
- **Separate WebStorm window, not Attach.** Attach shares one project's Node interpreter, Python SDK and run configs across both roots — but the two halves need *different* ones (3.13 venv + Vite vs. 3.12 venv + Next 16). Attach is fine while only reading; scope Find-in-Files to a directory so results don't double. Detach and reopen in a new window before trying to run the old app.
- **Treat it as read-only.** Edits there go to a detached checkout that nothing will ever merge. No contract names a path inside it — ports are always `git show main:<path>`, which works whether or not the worktree exists.
- **Remove it before the eventual merge** below: `git worktree remove ~/WebstormProjects/blue-eagle-reference`.

### Running the old app (reference tree)

Not free, and not needed for most reference use — reading the code covers most questions. What it requires:
Python **3.12** (`main`'s README and `SETUP.md`; Homebrew already has 3.12.7), a `.venv` inside the
reference tree, and a local PostgreSQL 16 on `:5432` because `.env.example` hardwires
`DATABASE_URL=postgresql://blueeagle:blueeagle@localhost:5432/blueeagle`. The backend also pulls
`prophet`, `psycopg2-binary` and `xgboost` — the exact dependency set the rebuild exists to shed.

**The reference tree's dependencies have drifted.** Set up 2026-09-11 with
`python3.12 -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt`. That file
pins with `>=` throughout, so pip resolved current versions rather than what the app was written
against: `yfinance` 0.2.37 → **1.7.0**, `pandas` 2.2 → **3.0.5**, `numpy` 1.26 → **2.5.3**,
`fastapi` 0.111 → 0.141.1 (starlette 1.6.0), `statsmodels` 0.14 → 0.15.0. Three major-version
jumps. **Tested 2026-09-11 and it survives them**: `import main` succeeds, and the exact
`yf.download(ticker, start, end, auto_adjust=True, progress=False, threads=False)` call in
`core/provider.py:44` still returns a populated DataFrame under yfinance 1.7 — MultiIndex columns,
which the flatten at line 60 already handles. The analytics modules (statsmodels 0.15, numpy 2.5)
were **not** exercised. If something does crash there, suspect drift before suspecting the old
code, and pin the offending package downward in a scratch copy rather than editing the reference
tree.

This is also the concrete argument for contract 0001's `==` pinning: `>=` pins are why a working
app becomes unrunnable by sitting still.

- Old app files (`backend/`, `frontend/`, `SETUP.md`, `BLUEEAGLE_GUIDE.md`, `docs/`, `jobs/`, `sample_portfolio.csv`, `render.yaml`, `.env.example`) have been removed from tracking on `rebuild`, leaving only `README.md`, `REBUILD.md`, and `.gitignore`.
- When the rebuild is ready to replace the old app: merge `rebuild` into `main` and push. Render/Cloudflare Pages should stay pointed at `main` throughout — don't repoint deploy hooks at `rebuild` mid-build.
- **Only Gunnar commits and pushes.** No agent session does, ever. Stated as a non-overridable rule in every agent role file and system prompt, and backed by a `deny` list in `.claude/settings.json`. An agent that thinks a commit is warranted prints the command and stops. This is a convention, not a hard guarantee — see `agent_prompts/README.md` for the tradeoff that was accepted and the escalation path if it stops holding.
- Three agent sessions (Opus planner, Sonnet implementer, Haiku executor) coordinate through contract and report files under `contracts/`. See `agent_prompts/README.md`.
