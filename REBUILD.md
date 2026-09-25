# Rebuild Plan

Working notes from the planning conversation that led to this branch. Purpose is continuity across chats, not a spec — update it as decisions change instead of treating it as fixed scope. See `README.md` for the current one-page status; this file is the "why" behind it.

## Why a rebuild instead of an iteration

Limited hands-on development history with the existing app, so the goal is to rebuild page by page, feature by feature, to actually understand what's necessary — rather than carry the old architecture forward by default. Willing to make large changes where the old approach doesn't hold up.

## Module map

Written 2026-09-18, after a proposal to reorganise the backend into per-page folders
(`/launch`, `/universe`, `/ops`). **That was rejected, and this map is why.**

The backend is layered by *domain concept*, not by page, and the layering is load-bearing — the
bottom two tiers are page-agnostic by construction and portfolios will reuse all of them. Three
modules in particular refuse to sit in any one page's folder:

- **`strip.py`** renders in `App.tsx` chrome on *every* page and is served from `/universe/strip`.
- **`autorefresh.py`** is *triggered* by the launch page's strip fetch, *refreshes* universe data,
  and is *displayed* on ops.
- **`news.py`** is *displayed* on launch but imported by `routers/universe.py` for the strip's
  background task.

A page split would produce `launch/news.py` imported by `universe/routes.py`, and
`universe/autorefresh.py` rendered by `ops/`. Every such placement is arbitrary and every one creates
a cross-folder import.

### Backend — `backend/app/`

Nothing on a lower tier imports anything above it.

```
tier 0  config  models  schemas  freshness  schedule  export      (zero app-internal imports)
tier 1  db → config
tier 2  cache → db, models    quotes → cache, db    jobrun → db, models
tier 3  market_data → cache, freshness
tier 4  universe → cache, db, market_data, models, quotes
tier 5  news  briefing  strip  autorefresh  ops                   (features)
tier 6  routers/*                                                 (HTTP only)
```

| module | what it owns |
|---|---|
| `config.py` | `Settings`, `.env` loading, the ambient-variable conflict guard (0041) |
| `models.py` | SQLAlchemy tables. Eight: price bars, fundamentals, universe, quotes, news articles, news summaries, app state, job runs |
| `schemas.py` | Pydantic request/response shapes. No logic |
| `freshness.py` | **Pure.** Is stored history stale, what range is missing, has a split restated it |
| `schedule.py` | **Pure.** The 09:30 / 12:00 / 16:00 ET refresh windows |
| `export.py` | **Pure.** OHLCV → CSV text, byte-compatible with the old `YF.py` |
| `db.py` | Engine and transactional `session()` |
| `cache.py` | Price history read/write, 24-hour in-process `TTLCache` over the database |
| `quotes.py` | Live intraday quotes, 10-minute TTL, market-hours aware |
| `market_data.py` | **The yfinance boundary.** Network calls stay thin; the logic around them is pure |
| `universe.py` | Membership: add / refresh / remove, orchestrating `market_data` + `cache` |
| `news.py` | Broad-market articles from fixed feeds, publisher-filtered at ingest |
| `briefing.py` | The Gemini market briefing over stored headlines |
| `strip.py` | Ticker-strip prices and returns, from stored data only |
| `autorefresh.py` | The visit-triggered universe sweep, claimed per window |
| `jobrun.py` | `record_run` — one `job_runs` row per sweep that actually ran. Never breaks the job it records |
| `ops.py` | System-health aggregation and job-run history. **Booleans and counts only — never a secret** |
| `routers/` | **The only modules that know about HTTP.** Everything below raises domain exceptions |

`cache.py`, `config.py`, `db.py`, `models.py` and `main.py` have no module docstring — their function
docstrings carry the reasoning instead.

### Frontend — `frontend/src/`

```
App.tsx        Header + TickerStrip (chrome, outside <Routes>) + the routes
pages/         LaunchPage, UniversePage, OpsPage
components/    chrome:    Header, NavItem, SettingsIcon, BackendStatus, Tooltip, DownloadIcon, TickerStrip
               launch:    NewsSection, EntryCard
               universe:  UniverseTable, ChartDialog, FilterDialog, AddTickerForm
               ops:       ThemeSelector, SystemHealthCard, JobRunsCard
lib/           pure helpers — change, filters, format, opsFormat, ranges, relativeTime, theme
api/client.ts  the single fetch boundary: base URL, ApiError, GET-only transient retry (0041)
index.html     an inline pre-paint script that sets data-theme from localStorage (see below)
```

**`/ops`'s cards show their errors; everything else hides them.** `TickerStrip` and `NewsSection`
return `null` on a failed fetch so the launch page never breaks because a market endpoint is slow.
`SystemHealthCard` and `JobRunsCard` deliberately invert that — a page whose job is to tell you the
system is unwell must not go blank exactly when it is. If that reads as an inconsistency later, it is
not one.

**Theming is nine custom properties and one attribute.** `globals.css` declares the palette in
`:root`, overrides all nine under `:root[data-theme="dark"]`, and `@theme inline` maps every Tailwind
utility onto them — so setting one attribute on `<html>` flips the entire app, and no component
carries a dark-mode variant. Light mode **removes** the attribute rather than setting
`data-theme="light"`; there is no light block and there must not need to be.

Three consequences worth keeping:

- **A backdrop must never derive from `--color-text`.** All three dialog scrims were
  `bg-foreground/35`, which inverts to a *pale wash over a dark page* — a scrim that lightens what it
  is meant to dim. They use `--color-modal-overlay` instead, dark in both themes. The source token is
  named `--color-modal-overlay` rather than `--color-overlay` precisely so the `@theme inline`
  mapping is not `--color-overlay: var(--color-overlay)`, which is a self-reference that resolves to
  nothing.
- **The pre-paint script in `index.html` duplicates `lib/theme.ts` on purpose.** A module import
  cannot run before first paint, so deduplicating it reintroduces a white flash on every dark-mode
  load. Its `try/catch` is required: `localStorage` throws outright in some privacy modes, and an
  uncaught throw there runs before React mounts and leaves a blank page. `readStoredPreference` /
  `storePreference` carry the same guard on the React side.
- **`resolveTheme(pref, prefersDark)` takes the media-query result as an argument**, the same
  discipline as `now` everywhere else in `lib/`. The subscription lives in `ThemeSelector`, and exists
  only while the preference is `system` — without it "System" would only apply at page load.

**Every `lib/` function takes `now` as an argument and never reads the clock.** That is what makes
them testable, and it is the same discipline `freshness.py` and `schedule.py` follow on the backend.

`components/` is deliberately flat at 13 files. Splitting 7 shared / 4 universe / 2 launch would add
two folders holding four and two files, and `TickerStrip` is arguable either way — chrome that fetches
universe data. Revisit past roughly 25 components.

### Where a request goes

```
GET /              → LaunchPage: NewsSection → /news        (pure read)
                     TickerStrip → /universe/strip          (pure read + schedules both sweeps)
GET /universe      → UniversePage: /universe, /universe/{t}/history, /universe/export.zip
every page load    → /health (BackendStatus)
```

`/universe/strip` is the one endpoint that fires on **every** page load, which is why both background
refreshes hang off it — it is the only reliable signal that a person is present.

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
  it as an ordinary static asset rather than interpreting it. That file is Cloudflare's format; it
  has since been **deleted** (confirmed 2026-09-21 — `frontend/public/` holds only `logo-nav.png`).
  The dashboard rule is the only thing that works here. If the file ever reappears, do not read its
  presence as evidence that routing is handled.
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

**Position model: saved weights are the truth; shares are optional implementation metadata.** Reversed 2026-09-18 after the portfolio's purpose was clarified: Blue Eagle is an allocation-analysis and optimization tool, not a tax lot, P&L, or brokerage-holdings ledger. Its meaningful input to analysis is the allocation, not a current market-value reconstruction.
- Stored per position: ticker + allocation weight (percentage units) + optional share count. Stored at the portfolio level: cash weight (percentage units). Position weights plus cash weight must total 100% (within the form's stated tolerance). A dollar cash field is not meaningful for a portfolio with no required notional value.
- A saved weight remains fixed until the user deliberately edits it or accepts a rebalance. It is not silently recomputed as prices move. This makes a model portfolio reproducible and prevents a quote refresh from rewriting the allocation that analysis is meant to assess.
- The default entry flow is by weight: ticker + weight (and optional cash percentage), with no total portfolio value and no price requirement. A shares entry flow remains available for users who know their holdings; it derives and saves the initial weights from the entered shares and current prices. The flows must not be mixed during one initialization: shares plus a separately-entered target weight has no unambiguous meaning without a portfolio-value convention.
- A future optional notional value may support dollar display or an implementation worksheet, but it is neither a required input nor the source of allocation truth.

**Portfolio CSV: one canonical format we own, parsed client-side. Contracts 0061–0063, 2026-09-18.**
Portfolios are `localStorage`-only, so CSV is the entire backup and cross-device story. Three
contracts: 0061 the pure parser/serializer plus the repo's first frontend test harness, 0062 the
export button, 0063 the import UI.

- **`main:backend/routers/_portfolio_helpers.py` is deliberately not ported.** It sniffs four formats
  (Bloomberg holdings, time-series `AAPL_Weight` columns, headerless, simple) and decides whether
  `0.25` means 25% or 0.25% **by magnitude**. That is a guess no file can support. Our format
  declares its units: `weight_pct` is always percent, a file of `0.25`s parses to 0.25% each and
  lands ~99% in cash, and the user sees that on the draft. Visible and wrong beats silently
  normalized.
- **Superseded 2026-09-21 (contract 0067): the `# Blue Eagle Portfolio v1` / `# name:` preamble is
  dropped.** Exports are now a plain header-plus-rows CSV and the name lives in the **filename**.
  Two reasons. The version marker had exactly one consumer — deciding whether to read line 2 as the
  name — for a format that never had a second version. And the preamble made the file non-portable
  through a spreadsheet: saved from Excel, those lines return **quoted** (`"# Blue Eagle Portfolio
  v1"`), which starts with `"` not `#`, so comment-skipping misses them and the file stops parsing.
  - **`parsePortfolioCsv` was deliberately not changed.** It still skips leading `#` lines and reads
    `# name:`, so every previously-exported file keeps importing. Only the writer moved. A test
    parses Gunnar's real legacy file from `reference files/` to keep that guarantee honest.
  - **The name round-trips because `portfolioCsvFilename` stopped lowercasing.** It had been doing
    `name.toLowerCase()` and hyphenating everything non-alphanumeric — harmless while the name also
    lived inside the file, silently lossy once the filename became the only carrier. It now replaces
    only characters a filesystem rejects (`/ \ : * ? " < > |` and control characters), so `GunnPort`
    survives as `GunnPort`. **Residual and inherent:** a name containing one of those characters
    cannot round-trip, because no filename can hold it.
  - Rejected at the same time: a `portfolio_name` column filled on the `CASH` row. Excel-safe and
    lossless, but it puts metadata in a data column, and Gunnar preferred the plainer file.
- **Presets are canonical CSV text parsed by `parsePortfolioCsv`, not a second format.** Contract
  0070, 2026-09-21. Authoring a preset is "export a portfolio, paste the file", and the preset
  inherits weight validation, the 100% invariant, off-universe dropping with its report, and exact
  numeric round-tripping — all for free. A JSON preset format would need every one of those rebuilt,
  and a preset that cannot pass the parser is a preset that would have produced an invalid portfolio.
  `applySeed` is the single entry point, shared with CSV import.
- **A preset never carries share counts.** A preset is an *allocation*; share counts are metadata
  about one person's specific position. Shipping someone else's shares asserts a portfolio value the
  user does not have and that nothing in the app reconciles. Weights carry the whole meaning. The
  `shares` column stays present and empty so the text is still canonical CSV.
- **Coding agents never author an allocation.** Preset content comes from Gunnar. Contract 0070 pins
  `PRESETS.length` in a test specifically so a later agent cannot helpfully add a 60/40 or a
  conservative/balanced/aggressive ladder nobody asked for.
- **A test fixture must live under `frontend/src/` — inline, or in `__fixtures__/`. Never point a test
  at a path a user owns.** Contract 0067 pinned the legacy-format test to
  `reference files/portfolios/gunnport-2026-09-21.csv`. Gunnar renamed his portfolio and re-exported,
  the file's name changed, and the test failed `ENOENT` — correctly reported `BLOCKED`, since that
  directory is read-only by policy and no coder may recreate a file in it. The legacy format is frozen
  history; it belongs inlined in the test. Repaired by 0068.
- **Numbers serialize with `String(value)`, never `toFixed`.** JS emits the shortest round-trippable
  form, so a hand-typed `25` stays `25` while `100/3` prints long. `toFixed(4)` would break exact
  round-tripping, which is the one property the format exists to have.
- **Cash is stated-or-derived, never recomputed over a stated value.** A `CASH` row is used as
  written; only its absence derives `100 - Σ`. Recomputation is not bit-identical for irrational
  weights, and the round-trip has to be exact. A stated cash row that does not total 100 ± 0.01 is a
  malformed file, not a remainder case, and is rejected.
- **Off-universe tickers are dropped and reported** (Gunnar's call, 2026-09-18, over seeding them as
  unresolvable rows). The orphaned allocation is then handled **asymmetrically, on purpose**: a
  *weighted* file sends the dropped weight to cash, because the file asserted an allocation and
  spreading it across survivors would be exactly the normalization being avoided; a *ticker-only*
  file equal-weights over the **survivors** with 0% cash, because there was no allocation to
  preserve. Anyone reading only one branch will think the other is a bug.
- **Validate the whole file before dropping any row**, or a duplicate ticker among off-universe rows
  goes unreported.
- **A weighted file's share counts are kept on the created positions.** Contract 0099, 2026-09-24,
  Gunnar's request. Before this contract, the app's own export-then-import round trip lost them. The
  parser read `shares` into the seed correctly, but `summariseDraft`'s weight branch hardcoded
  `shares: null`, and `handleCreate` attached shares only in shares mode. The round-trip test
  stopped at the seed, so nothing failed.
  Weights are still saved exactly as the file states them. Shares ride along as metadata and never
  derive, validate or block a weight. This is **not** the forbidden "mixed flow": that rule is
  about a user typing shares and a separate target weight into the composer, with no convention
  for which one wins. A file that carries both has an obvious winner, the weights, and it is the
  format the app itself writes. Disagreement between the two is handled by the existing 0.5-point
  dollar-display rule. Presets still never carry shares (see the preset rule earlier in this
  section). A person's own share counts arrive by importing their own file.
- **The import seam is `DraftSeed`** — `{name, mode, cash, rows}`, exactly `summariseDraft`'s input
  minus React keys. A future preset catalog returns a `DraftSeed` and nothing else changes. That is
  the only accommodation made for presets; no preset content exists or should be invented.
- **Import seeds a draft, never creates or overwrites.** Importing the same file twice mints two
  portfolios, because the format carries no `id`.
- **`vitest` is added as a dev dependency for `src/lib/` only** — `environment: 'node'`, no DOM, no
  component tests. `REBUILD.md`'s "UI unit tests are skipped deliberately" rationale is *"high effort,
  low value while the layout is still moving"*, which does not reach a CSV parser doing weight
  arithmetic, duplicate detection and RFC 4180 quoting. That is the "math or data transformation"
  case the backend standard already requires tests for, and it was the only part of the frontend
  where a wrong answer looks entirely plausible.
- Accepted limit: `CASH` is a reserved ticker and Pathward Financial genuinely trades as `CASH`. It
  is not in the Universe and the Universe is the gate, so the collision is unreachable today.

**Correction to the drop rule, 2026-09-18 (0061 audit).** The entry above said a dropped row's weight
goes to cash for "modes 1 and 2." Mode 2 is the shares-only file, which states no percentages — there
is nothing to transfer. It applies to **mode 1 only**. The implementation was right; the contract text
was wrong, and the coder caught it.

**A contract that adds or removes a dependency must list the lockfile.** Found 2026-09-18: contract
0061's file list named `package.json` but not `package-lock.json`, so the implementer installed
`vitest`, then restored the lockfile because editing an unlisted file is a `BLOCKED` condition. It
followed the rule exactly and disclosed the consequence — and the result was a tree that passed every
acceptance criterion and **could not be installed**: `npm ci` exits non-zero with
`Missing: vitest@4.1.11 from lock file`. A manifest and its lockfile are one edit. Repaired by 0063.

**`grep -c "Tooltip"` counts lines, not elements — fourth recorded grep-as-verification failure.** A
`<Tooltip>` wrapper contributes an opening and a closing line, so a criterion demanding the count move
by one can never pass. It made contract 0062 report `BLOCKED` on correct work. Use `grep -c "<Tooltip"`.
Earlier instances: the `prefers-reduced-motion` fallback (twice, shipped broken behind a passing
keyword grep) and contract 0031's `Query.delete()` pattern against a SQLAlchemy 2.0 codebase.

**An empty result is two different conditions and they need different answers.** Found 2026-09-18 by
probe, not by the test suite: exporting a 100%-cash portfolio — a state `PortfoliosPage` explicitly
supports — produces a file with a `CASH` row and no positions, and re-importing it was rejected with
*"No portfolio tickers are in the current universe."* The round trip was broken for a reachable state,
and the message blamed the Universe for a file that named no tickers to check against it. `surviving.length === 0`
conflated *"every position was dropped"* with *"there were never any positions."* Split on
`positions.length`, measured before the drop filter. Repaired by 0063.

**A fully-invested portfolio sealed itself: no position could ever be added.** Found 2026-09-21 on
Gunnar's real portfolio, built by entering share counts — which sets cash to 0% because no cash
dollars were entered. `AddPositionForm.tsx:50` gated on `weightNumber > cashWeight` and
`addPositionUsingCash` refused the same condition, so any weight above 0 failed the first test and a
weight of exactly 0 failed `weightNumber <= 0`. **No typed value could enable the button.** The CSV
export of that portfolio was flawless and round-tripped byte-identically; the data was never the
problem.

Resolved by contract 0064, with two decisions Gunnar made on 2026-09-21:

- **Funding is cash first, then pro-rata dilution of existing positions for the shortfall.** Where
  cash covers the add, *no existing weight moves* — today's guarantee, kept exactly. Dilution engages
  only when it must, so `addPositionDiluting` strictly supersedes `addPositionUsingCash` rather than
  sitting beside it. Rejected: a user-facing "fund from cash / dilute" toggle, as a decision the user
  should not have to make on every add.
- **Rewriting a weight on a deliberate user action is allowed; recomputing one from a quote is not.**
  Dilution changes saved weights, which reads like a contradiction of the position model until you
  see which half it touches. What the model forbids is *silent* recomputation as prices move — that
  is what makes a model portfolio reproducible. An explicit add is not that.
- **A share count is a weight calculator, not a second allocation input.** `weightFromShares` derives
  `(s × p) / (V + s × p) × 100` against an implied portfolio value `V = M / ((100 − C) / 100)`, and
  the derived weight then goes through the same one funding rule. `V` exists only when **every**
  position carries a share count and a usable price; otherwise the shares input derives nothing and
  says why. Nothing about `V` is stored — `REBUILD.md`'s "no required notional value" stands.

**A 1.4e-14 float residue in cash silently deleted a portfolio.** Found 2026-09-21 in Gunnar's real
`Gunnar Preset` export, which carried `CASH,-1.4210854715202004e-14`. `isValidCurrentPortfolio`
rejects `cashWeight < 0` and `listPortfolios` **filters out** what fails it, so the record stayed in
`localStorage` while the app stopped listing it. Measured: `listPortfolios()` returned **0**. No error
anywhere. Contract 0071.

- **The cause was three implementations of one formula.** `100 - Σweights` was computed inline in
  `addPositionDiluting` (clamped, because 0064's implementer hit this), `removePositionToCash`
  (unclamped) and `PortfoliosPage.handleCashTextChange` (unclamped). Rescaling six weights and
  re-summing lands ~1e-14 either side of 100. The missing clamp was the symptom; **the divergence was
  the defect**, and the fix is one exported `cashFromPositions` helper that all three call.
- **Tolerate the residue on the *component*, not just the total.** The validator accepted a total
  within `±0.01` of 100 while demanding `cashWeight >= 0` exactly — a residue too small to matter for
  the whole was fatal for the part. Any invariant checked on a sum needs the same tolerance on the
  terms.
- **Repair on read; never rewrite during a read.** Records written by the bug already existed, so
  tightening the writer alone would have left them invisible permanently. `listPortfolios` normalises
  a `(-0.01, 0)` cash weight to `0` before validating, and does **not** write back — a read that
  silently mutates storage is a worse property than a stale record. `isValidCurrentPortfolio` keeps
  its strict rule.
- **"Cash is stated-or-derived, never recomputed over a stated value" applies to the editor too, not
  just the CSV parser.** Found 2026-09-21: typing `5` in the Cash field stored `5.000000000000014`.
  `handleCashTextChange` rescaled the positions to fill `100 - 5` and then **discarded the typed
  value**, recomputing cash from the rescaled weights. `cashFromPositions` snaps only within `1e-9` of
  *zero*, so a residue near 5 passed through. The rule already existed for the file format and was
  violated in the UI; contract 0072 stores `parsed` and lets the positions absorb the residue, where
  it is unavoidable anyway.
- **Every cash edit drifts all position weights by an ulp or two**, because the rescale is not
  lossless. Measured across two of Gunnar's exports: `VOO 10.4075329437956 → 10.407532943795601`,
  `PBR ...8987 → ...8996`. **This is inherent and accepted** — the alternative is not rescaling. It
  also explains an earlier unexplained finding: three positions that had scaled by *different*
  factors, which pure dilution cannot produce. A cash edit did it, not a bug in dilution.
- **A noise epsilon and a display tolerance are different numbers.** The first draft of 0071 snapped
  residue below the project's `±0.01`. That is wrong: `cashFromPositions` also serves
  `handleCashTextChange`, where the user *types* a cash percentage — so a typed `0.005` would have
  been silently snapped to `0` by the helper meant to protect it. `WEIGHT_EPSILON = 1e-9` sits about
  five orders above float64 noise on values near 100 (~1.4e-14) and seven below anything a person
  would type. **Never reuse a display tolerance as an equality threshold.**
- **Snap both signs.** Rescaling lands either side of 100 depending on rounding — the stored record
  held `-1.42e-14` while the same arithmetic targeting cash `0` produces `+1.42e-14`. Handling one
  sign leaves `String(cashWeight)` exporting `CASH,1.4210854715202004e-14` into a user-facing CSV, and
  guarantees the unhandled sign becomes the next bug.
- Lesson beyond this bug: **a derived quantity that is validated must be produced by exactly one
  function.** Two call sites computing the same number will eventually disagree about its edge cases,
  and the one that disagrees is the one nobody tested.

**The dilution scale factor turns out to be the old-book-over-new-book ratio, exactly.** Found during
the 0064 audit, and stronger than the contract claimed. With cash at 0, `W = sp / (V + sp)` and
`scale = (100 − W) / 100 = V / (V + sp)`. So a shares-driven add into a fully-invested portfolio
leaves every existing position's `shares × price` at precisely its new weight — shares and weights
stay coherent with no special-casing, and the "one funding rule" claim holds by construction rather
than by approximation.

**Where it does not hold:** when cash is above 0 it absorbs part of the add, `scale ≠ V / (V + sp)`,
and stored share counts drift out of agreement with stored weights. Defensible — shares are metadata,
not truth — but a second shares-driven add after a cash-funded one computes `V` from share counts
that no longer reconcile. Bounded, known, not currently worth a fix.

**`type="number"` steppers truncate their own placeholder, and the fix is selective, not app-wide.**
The spin buttons render *inside* the field's right edge, so `Weight %` displays as `Weight…`.

- **An opt-in `.no-spinners` class, not `input[type="number"]`.** Gunnar's call, 2026-09-21,
  reversing this file's earlier app-wide entry. **`Shares` keeps its steppers** — share counts are
  usually integers and stepping by 1 is genuinely useful there — while weights and cash percentages
  are typed values like `12.5` where the stepper only eats the placeholder. The earlier "every number
  input here is a free-form quantity" argument was wrong about `Shares` specifically.
- The cost of opt-in, accepted knowingly: a number input added later silently gets steppers back
  unless someone remembers the class. That is the trade for keeping `Shares` steppable.
- **Both halves of the CSS rule are required** — WebKit needs
  `::-webkit-inner-spin-button { -webkit-appearance: none }`, Firefox needs `appearance: textfield` —
  so testing one browser proves nothing about the other. `type="number"` is kept for the numeric
  keyboard and input filtering; switching to `type="text"` would lose both.
- **Grep the selector, never the declaration.** Contract 0065 shipped `input.no-spinners` against a
  contract specifying `input[type="number"]`, and both acceptance criteria — `grep "appearance:
  textfield"` and `grep "webkit-inner-spin-button"` — passed, because a declaration reads identically
  under either selector. One of seven fields got the fix and the audit called it done. Fifth recorded
  instance of grep-as-verification failing, and the second in the expensive direction.

**A portfolio CSV round-tripped byte-identically on first real use.** `gunnport-2026-09-21.csv`:
weights summing to exactly `100`, a fractional share count (`2.08`) preserved, `canCreate: true`, no
drops. The `String()`-over-`toFixed` decision is what bought that, and it was worth the ugly output on
irrational weights.

**A round-trip fixture can collapse into the easy case without anyone noticing.** Contract 0061's
criterion 2 used three positions of `100 / 3` to force a non-representable cash value. It does not:
`3 * (100 / 3) === 100` exactly in float64, so cash was `0` and the awkward path never ran. The
*weights* were genuinely irrational and did round-trip strictly, so the criterion still proved the
thing that mattered — `String` over `toFixed` — but by luck rather than by design. **When a fixture
exists to be awkward, assert that it actually is** before relying on it.

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

**A third occurrence, 2026-09-22, and this one was a time bomb rather than a coin flip.**
`test_jobrun.py::test_prune_keeps_rows_within_retention` began failing every run. `jobrun.py:81`
computed its retention cutoff from `datetime.now(timezone.utc)` while the test pinned its fixture at
`2026-09-18`; once the real date drifted more than a day past that, a row the test placed inside the
30-day window fell outside it and was pruned. **It armed itself on 2026-09-19.**

- **Half-pinned is worse than unpinned.** `started_at` came from the fixture and `finished_at` from
  the wall clock, so the test read as deterministic and was not. An unpinned test fails immediately;
  this one waited a day and then failed forever.
- **`jobrun.py` was the last module reading the clock internally.** `freshness.py`, `schedule.py`,
  `quotes.py` and every `frontend/src/lib/` function already take `now` as an argument. One holdout
  was enough to break the suite.
- It also read the clock **twice** in one function — once for `finished_at`, once for the cutoff — a
  second skew source nobody had hit. Contract 0074 collapses both to one injected value.
- **Found by a criterion, not by a person.** Contract 0073 required the *full* backend suite to exit
  0 despite being a strip contract, per the rule below. That is the second time that rule has caught
  a defect nobody was looking for.

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

**The strip's accuracy was a side effect of somebody opening `/universe`.** Found 2026-09-22, after
Gunnar reported the strip showing `^GSPC 7,650.23 +0.16%` against the Universe table's
`7,764.70 +1.49%`. **Not** the deliberate 0028 disagreement — both read `ticker_quotes` through the
identical `QUOTE_TTL_MINUTES` gate. They disagreed about the *moment*.

`get_strip` refreshed nothing, and `refresh_quotes_if_stale` had exactly two callers: `list_all()`
(`GET /universe`) and the window-claimed sweep, a no-op between 09:30 / 12:00 / 16:00 ET. So on a
launch-page-only visit the stored quote went stale, `_quote_is_fresh` returned False, and the strip
fell back to the previous session's move — for hours. Visiting `/universe` silently fixed it, which is
why it looked consistently rather than randomly wrong.

Compounding it: `TickerStrip` is `useEffect(…, [])` *and* lives in `App.tsx` outside `<Routes>`, so it
mounts once and never refetches. It rendered a snapshot taken before any refresh it might have
triggered. Contract 0073 schedules the quote refresh from the strip endpoint and refetches **once**
after 5s when the response reports `quotes_stale`.

Two fixes rejected, both worth remembering:

- *"Point the strip at the Universe's values."* It already reads the same table with the same gate.
  When two views disagree and share a source, suspect timing before data.
- *"Await the fetch before rendering."* `/universe/strip` fires on **every** page load and is the
  app's only reliable visit signal. Awaiting yfinance there puts network latency on every page's
  critical path, on top of a ~43s cold start. Fire-and-forget is the whole reason that endpoint is
  fast.

**A docstring that contradicts the code is worse than no docstring.** `get_strip` said quote refresh
*"stays owned by `list_all()`"* — accurate when written, and the thing that made this bug read as
intentional for longer than it should have.

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

**The strip does not pause on hover.** Gunnar's call, 2026-09-15, reversing a contract 0028
requirement. Two consequences followed from it and were applied at the same time:

- **The per-cell `Tooltip` was removed.** `Tooltip` captures the target's `getBoundingClientRect()`
  once at show time and renders `position: fixed` — it does not track a moving element. With the row
  paused that anchor held; without the pause the bubble sits where the cell used to be and drifts
  apart for the several seconds the cursor stays over it. It was also redundant after 0029: it read
  `<name> (<ticker>) — price and day change` and the name is now in the cell. The project rule that
  every interactive element gets a `Tooltip` does not reach here — a strip cell is display text, not
  clickable, not focusable, and click-through is explicitly out of scope.
- **The reduced-motion fallback had to be fixed**, because it is now the *only* way to read a ticker
  that has scrolled past. See below.

**Fixed 2026-09-15: `prefers-reduced-motion` had no working fallback.** From contract 0028, shipped
through 0029. The media query put `overflow-x: auto` on `.ticker-strip-marquee`, which is `w-max`
(`width: max-content`) and therefore sizes to its children and never overflows *itself* — no
scrollbar, nothing to scroll — while its `overflow-hidden` parent clipped the rest. The animation was
correctly disabled; only the fallback was broken, so a reduced-motion user saw the first screenful of
tickers frozen and could not reach the others.

The fix moves `overflow-x: auto` to `.ticker-strip-track`, and moves the track's base
`overflow: hidden` out of its Tailwind class into the same `<style>` block. That second half matters:
overriding a Tailwind utility from a component `<style>` tag is a specificity tie decided by document
order, which happens to work but is fragile. Declaring both rules in one block makes the override
deterministic.

**Grepping for a word is not verifying a construct.** Contracts 0028 and 0029 both accepted
`grep -n "prefers-reduced-motion"` as proof the reduced-motion path worked. It proved the string was
in the file. The defect above shipped twice behind that check. This is the planner's most repeated
mistake — five earlier instances flagged correct work as broken; this one flagged broken work as
correct, which is the more expensive direction. An acceptance criterion must name the construct and
its effect, not a keyword.

**`yfinance`'s `.news` works from Render even when the crumb flow fails.** Measured 2026-09-15 from
`https://blue-eagle-backend.onrender.com` via the contract 0030 probe, then deleted. This is the
finding the whole news feature hangs on: **no API key, no Currents, no RSS fallback, no new
dependency.**

First call, cold:

```
news_count: 10     crumb_obtained: False     info_works: False     news_elapsed_seconds: 0.28
DEBUG Didn't receive crumb Too Many Requests
DEBUG response code=401
ERROR HTTP Error 401: {"code":"Unauthorized","description":"Invalid Crumb"}
```

So Yahoo rate-limits `getcrumb` from Render's shared IP and `.info` dies on it — reproducing contract
0013 exactly, three months on — while `.news` returns a full payload regardless. The reason is in the
source: `.info` hits `quoteSummary`, which requires a crumb; `.news` POSTs to
`/xhr/ncp?queryRef=latestNews&serviceKey=ncp_fin`, which does not. `_make_request`
(`yfinance/data.py:421`) degrades deliberately — *"the target endpoint may not need a crumb"*.

Three later calls in the same process returned `crumb_obtained: True`, so crumb acquisition is
**intermittent**, not permanently blocked. The load-bearing fact is that news worked in both states.

Latency from Render: **0.11–0.28s** for `.news` alone, *faster* than local (0.34s).

**`.info` fails silently, not loudly.** `info_works: False` with `info_error: None` — it did not
raise, it returned a dict with no `quoteType`. Anything reading `.info` on Render gets a partial dict,
never an exception. That is why fundamentals are best-effort (contract 0013) and must stay that way.

**`.news` is ticker-relevant but not ticker-*specific*.** Measured across three:

| ticker | top story |
|---|---|
| NVDA | "Tech stocks today: CEOs call for pacing AI, as Nvidia CEO says extinction fears are made up" |
| XLV | "Sector Update: Healthcare Stocks Ease Late Afternoon" |
| AAPL | "Rogers Communications (TSX:RCI.B) Moved, So What Is Drawing Attention Now?" |

NVDA and XLV are on point; AAPL drew an algorithmic Simply Wall St piece about a Canadian telecom,
and locally the same call returned a TSMC/MediaTek story. Yahoo's `latestNews` tab is *associated
with* a ticker, not *about* it. **Do not present these as "news about <TICKER>"** — attribution that
strong is not supported by the data. A blended feed across the universe, or per-ticker with the
ticker as a soft label, both survive this; a per-ticker headline card does not.

Payload per item: `{id, content}` with `content` carrying `title`, `summary`, `description`,
`pubDate`, `provider.displayName`, `canonicalUrl`, `thumbnail`.

**News is stored, not fetched live — a fifth table, `news_articles`.** Built 2026-09-15, contract
0031. Deduplicated on Yahoo's article `id`; `source_ticker` records which ticker's feed surfaced it
first and is **provenance, not a claim about the article's subject** (see the 0030 relevance finding
above). Refresh is lazy and request-triggered like everything else here — Render's free tier sleeps
after ~15 minutes, so there is no scheduler anywhere in this codebase.

`needs_refresh` rules, in this order: an empty table refreshes at **any** hour; otherwise nothing
refreshes before **09:00 ET**; otherwise a **6-hour** TTL. Rule 1 beats rule 2 deliberately — the
09:00 gate exists to stop overnight re-fetching, not to leave a fresh deployment blank until morning.
In practice that fires near 09:00 / 15:00 / 21:00 ET with the 03:00 slot blocked.

**The fan-out must stay sequential.** 20 tickers × ~0.2s ≈ 4s. Doing it concurrently is the burst
that got Render's shared IP crumb-throttled in contract 0013.

**`GET /news` never awaits the fetch.** It reads storage, returns, and schedules the refresh via
FastAPI's `BackgroundTasks`. The request that trips the TTL serves slightly stale articles; the next
one gets fresh. Measured: first call on an empty table returned `{"articles": [], "as_of": null}` in
0.83s while the ~8s refresh ran behind it.

**Never delete-then-insert.** The only `DELETE` in `app/news.py` is a 14-day `pub_date` prune. A
refresh in which every ticker fails must leave the table exactly as it was — the reference app's
rule (`_NEWS_SUMMARY_TTL_HOURS`, never delete the last summary) restated for articles. A wiped table
means a blank feed with no error anywhere, the same class of silent-wrong-output as the mock-`fetch`
incident.

**Known gap: concurrent refreshes are not deduplicated.** Two `/news` requests inside the same ~8s
window each schedule a task, both read the same stale `newest_fetched_at`, and both walk all 20
tickers. Two interleaved sequential streams, not a 20-wide burst, so it doubles the rate rather than
multiplying it, and the upserts are idempotent. Fix is a module-level non-blocking lock in
`refresh_news_if_stale`. Unfixed as of 2026-09-15.

**Migrations may not run automatically on Render.** There is no `render.yaml`, no `Procfile` and no
start script in the repo — the build and start commands live only in the Render dashboard, so nothing
in version control proves `alembic upgrade head` runs on deploy. Verify before shipping any contract
that adds a table; a missing one surfaces as a 500 from the new endpoint, not as a deploy failure.

**Grepping for a keyword is not verifying a construct — third recorded instance.** Contract 0031's
criterion 5 grepped `\\.delete\\(\\)|DELETE FROM`, a pattern for the legacy `Query.delete()` API, in a
codebase that uses SQLAlchemy 2.0's `delete()` construct throughout. It could never match. The
implementer correctly refused to rewrite working code to satisfy it and reported the deviation
instead. Earlier instances: the `prefers-reduced-motion` fallback (shipped broken behind a keyword
grep, twice). **An acceptance criterion must name the construct the code actually uses.**

**The launch page renders news as thumbnail cards over a text list.** Built 2026-09-15, contract
0032, porting the split from `reference files/news_section_reference/news_section.py:257`. Order on
`/` is hero → news → the four `Coming soon` cards. Six cards maximum in a
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`; everything else becomes a text row, first five visible
with the remainder behind a native `<details>`.

**Card overflow joins the list rather than disappearing, and keeps global recency order.** The
obvious implementation — `withThumb.slice(6)` concatenated with `withoutThumb` — puts every
card-overflow article ahead of every thumbnail-less one and silently breaks date ordering. Filter the
original list by "not chosen as a card" instead.

**Recency-only ordering concentrates the feed on whoever published last.** Measured 2026-09-15:
storage was evenly spread at 8–10 articles across 18 tickers, but the top 30 by `pub_date` gave
`^GSPC` 8 slots, `NVDA` 6 and `^IXIC` 5 — 19 of 30 from three tickers, with only 10 of 18 tickers
visible. `max_per_ticker` fixes it: at 2, the same query returns **12 distinct tickers** instead of 9.
It defaults to **0 (disabled)** on the endpoint so existing callers are unaffected; the frontend opts
in with `?limit=20&max_per_ticker=2`.

**26% of stored articles have no thumbnail** (41 of 159). The text list is a first-class region, not a
fallback. Note that a *recent* slice can still be 100% thumbnailed — on 2026-09-15 all 20 rendered
articles had one — so the thumbnail-less branch can be live and invisible at the same time.

**`source_ticker` is never displayed.** It is provenance — which feed surfaced the article first — not
subject matter. See the 0030 relevance finding: a chip reading "AAPL" beside a story about Rogers
Communications asserts something measurably false.

**`list-style: none` does not hide WebKit's `<summary>` marker.** Safari needs
`summary::-webkit-details-marker { display: none }`. The reference handled this explicitly
(`news_section.py:352`) and the first port dropped it. In Tailwind:
`[&::-webkit-details-marker]:hidden`.

**Tooltips belong on the news cards but not on the ticker strip**, and the reason is mechanical, not
stylistic. `Tooltip` captures its anchor's `getBoundingClientRect()` **once** at show time and renders
`position: fixed` — it does not follow a moving element. A scrolling strip cell drifts away from its
bubble; a static card does not. Anything animated gets no `Tooltip` until that component tracks its
target.

**News cards are paged six at a time, not capped at six.** Contract 0033, 2026-09-15, correcting
0032. Cards are **every** thumbnailed article, chunked into pages of six and moved by a
`translateX(-page * 100%)` on a `flex` track whose pages are `w-full shrink-0`. `shrink-0` is
load-bearing: without it the pages compress to share one width and the transform lands between them.
The text list reverts to the reference's role — thumbnail-less articles only — and empties out
entirely when every article has a thumbnail, which is correct rather than a regression.

No wrap-around: with a `translateX` track, looping from the last page to the first animates the whole
track backwards and reads as a glitch. Buttons disable at the ends. No auto-advance either — a grid
that moves while you are reading it is hostile.

**Off-screen carousel pages must be `inert`.** Every page stays mounted so the track can slide, which
leaves hidden cards focusable — a keyboard user tabbed through 14 invisible links before reaching
anything visible. `inert={i !== page}` removes them from the tab order *and* the accessibility tree.
React 19.2 accepts it as a real boolean prop. This applies to any future translate-based carousel.

**How to actually verify `prefers-reduced-motion`.** Emulate the media feature — Chrome DevTools
Protocol `Emulation.setEmulatedMedia` — and read back **`transition-property`**, not
`transition-duration`. Tailwind's `motion-reduce:transition-none` compiles to
`transition-property: none`, which leaves no property enrolled so the change applies instantly, but
**`transition-duration` still reports its original value** under the override. Checking duration
makes a working rule look broken. Verified this way for the first time on 2026-09-15, after two
contracts shipped a genuinely broken fallback behind a passing keyword grep.

**`Tooltip` wraps its child in an `inline-flex` span, which makes that child content-sized.** The
child becomes a flex item in a row-direction container and does not stretch along the main axis, so
a tooltipped card in a grid cell is sized by its contents rather than the cell — a card with a small
source thumbnail renders narrower than its neighbours, and `truncate` on a tooltipped row can never
fire. Anything wrapped in `Tooltip` that needs to fill its container must say so explicitly with
`w-full` (and `h-full` for equal heights). Found 2026-09-15 from a screenshot Gunnar flagged.

**Acceptance criteria must not assume files are tracked.** Contract 0033's criterion 12 required
`git diff --name-only` to list the one edited file; that file had been untracked since 0032 because
nothing had been committed in between, and `git diff` only compares tracked files against HEAD. The
criterion was unsatisfiable no matter how correct the work was. With several contracts' worth of
files routinely uncommitted, any criterion phrased in terms of `git diff` changes meaning depending
on commit state — prefer `git status --porcelain`, an explicit file list, or mtimes.

**The AI briefing is Gemini, stored in a sixth table, generated off the news refresh.** Contract
0034, 2026-09-16. `gemini-3.1-flash-lite` via `google-genai==2.23.0`, key in `GEMINI_KEY`, model
overridable with `GEMINI_MODEL`. **With no key the feature is simply off** — `/news` returns
`summary: null` and nothing errors, which is also the state a Render deploy is in until the key is
set.

**Generation piggybacks the news refresh rather than running its own TTL.** The reference used a
2-hour freshness window against a feed that refreshed hourly; ours refreshes every 6 hours, so an
independent 2-hour summary TTL would rewrite the same headlines three times for nothing. One trigger,
one cadence — roughly 09:00 / 15:00 / 21:00 ET. The consequence is that **a newly-set key produces no
briefing until the next refresh**, up to six hours later.

**Port the reference's three-way continuity prompt.** No prior briefing → write from scratch; prior
briefing from *today* → rewrite in place so it grows through the day; prior briefing from an *earlier
day* → open with what has shifted, then cover today. The same-day test must be done in **ET, not
UTC** — the reference used `datetime.utcnow().date()`, which misreads any briefing written after
20:00 ET as belonging to the previous day.

**Do not port the reference's persona.** It says "financial news analyst for a real estate private
equity firm" and focuses on SOFR, credit conditions and commercial investment. Against a universe of
equities, sector ETFs and three indices that produces briefings about the wrong asset class entirely.
Rewritten for this app; confirmed correct against live output 2026-09-16.

**Never wipe on a failed generation.** `if not text: return` sits above the insert, and the prune —
`created_at <= cutoff AND id != keep_id` — runs *only* after a successful insert. A superseded
briefing is deleted for being superseded **and** past retention, never for being superseded alone.
That is what guarantees a stale-but-present briefing stays on the page when Gemini is down, instead
of it going blank.

**The briefing inherits the news feed's relevance problem.** First live output discussed "cyclical
trucking stocks" — there is no trucking exposure in the universe. Loosely-related Yahoo headlines
(see the 0030 finding) enter the prompt and get faithfully summarized. Anchoring the prompt on the
universe's actual sectors is the fix; not yet done.

**`briefing.py` and `news.py` are circularly dependent by design.** `briefing` reads
`news.recent_articles` to reuse the bounded query; `news` calls `briefing.refresh_briefing` at the end
of a refresh. The import inside `refresh_news_if_stale` is deferred deliberately — moving it to module
level deadlocks at import time.

**Write contracts from the file on disk, never from a previous contract's report.** Contract 0035
restated the launch page's element order from 0033's report. In between, Gunnar had hand-edited
`NewsSection.tsx` — moving the carousel controls below the grid and switching them to
`justify-between` so the buttons flank it — and committed that. The contract's ordering line
therefore instructed a revert of his own design change, and the implementer, correctly following the
spec, carried it out. **From inside a contract run a hand-edit and a drift are indistinguishable**,
so the coder cannot catch this; only the planner can, by reading the current source before
describing it.

**The briefing renders above the cards, labelled `Market briefing · AI-generated`.** Contract 0035.
The label is a requirement, not decoration: model-written market commentary on a finance dashboard
must be identified as such on the page itself, not only in a tooltip. Prose is capped at
`max-w-[75ch]` — six sentences run across a 1700px window is unreadable.

**Briefing generation is gated on `needs_summary(latest_created_at, now_utc, articles_refreshed)`.**
No briefing at all → generate regardless. Otherwise → only when articles actually moved **and** the
existing one is past `SUMMARY_MIN_AGE_MINUTES`. Dropping the `articles_refreshed` conjunct turns this
into an independent 30-minute schedule that spends a Gemini call rewriting unchanged headlines on
every page load.

**Silence SDK warnings by configuring the SDK, not by filtering its logger.** `google-genai` warns
about automatic function calling on every `generate_content`; the fix is
`types.GenerateContentConfig(automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))`.
A `logging.Filter` on `google_genai` would also swallow real errors from the same logger.

**The universe refreshes itself on a visit, once per window: 09:30 / 12:00 / 16:00 ET, weekdays.**
Contract 0036, 2026-09-17. `app/schedule.py` is pure (`current_window_start`, `needs_auto_refresh`,
both taking `now_et`); `app/autorefresh.py` does the sweep; `app_state(key, value_at)` — a generic
key→timestamp table — records the claim. Triggered as a `BackgroundTasks` job from
**`GET /universe/strip`**, because `TickerStrip` sits in `App.tsx` outside `<Routes>` and therefore
fires on every page load — the only endpoint that reliably means "somebody visited". `/universe`
would miss anyone who only opens the launch page.

**This is cheap because `refresh_ticker` short-circuits before the network.** `is_stale` returns
early when a ticker is current, and `_cached_last_session` is keyed per *(ET date, past-4pm)*, so a
sweep over 20 already-current tickers costs ~1 reference fetch, not 20. Roughly 21 calls a day total.

**The 12:00 window cannot fetch a bar the 09:30 window would have missed.**
`last_completed_session` excludes today until `now_et_hour >= 16`, so both windows resolve to the
same session date. Noon exists to refresh quotes and to catch a ticker added that morning. **Do not
"fix" this by lowering the 16:00 cutoff** — that cutoff is what stops a partial in-progress bar being
stored as a completed close (the AAPL null-close incident, contract 0024).

**Claim the window before doing the work, and never roll the claim back on failure.** Writing
`app_state` first narrows a two-visitor double-sweep from seconds to milliseconds; it is not a real
lock and the contract says so. Not rolling back on error means a failing sweep waits for the next
window instead of retrying on every page load — which is how you get rate-limited.

**`Update all data N` is now `Refresh prices`** and posts to `POST /universe/quotes/refresh`, forcing
an intraday quote fetch only. It no longer walks tickers. `POST /{ticker}/refresh` and
`client.ts`'s `refreshTicker` both still exist and are called by nothing — deliberately kept as the
only remaining way to force a full bar refresh. **`/universe/quotes/refresh` must be declared above
`/{ticker}/refresh`**: both match `/universe/X/refresh`, and the wrong order resolves it as a ticker
named "quotes" and 404s.

**Testing a clock-injected function against the real database writes real state.** Verifying 0036's
sweep with an injected in-window `now_et` wrote a genuine `app_state` claim eight hours in the
future, pre-claiming the next morning's window. The test method was correct; the side effect was not
anticipated. Any contract whose verification advances a stored timestamp should say so and give the
command to clear it.

**News and the briefing run on the same 09:30 / 12:00 / 16:00 ET windows as the universe.** Contract
0037, 2026-09-17, replacing news's own 6-hour rolling TTL. That TTL **drifted** — measured from the
last refresh, a first run at 10:47 put the next at 16:47, then 22:47, wandering daily. Windows are
fixed wall-clock times. Claimed under `app_state["news_refresh"]`, a separate key from
`app_state["auto_refresh"]` so a failing universe sweep cannot suppress news.

Both are scheduled as **two separate background tasks** from `GET /universe/strip`, and `GET /news`
is now a pure read. The strip is the right trigger because `TickerStrip` sits in `App.tsx` outside
`<Routes>` — it fires on every page load, so news refreshes even for someone who only opens
`/universe`, which `GET /news` could never do.

**`current_window_start` takes `include_weekends`, and the two callers differ.** Bars cannot change
over a weekend, so the universe stays weekday-only; **news publishes at weekends**, and sharing the
gate unchanged would freeze the feed and briefing from Friday 16:00 to Monday 09:30 — about 65 hours.
Same three times, different day coverage, one function. The flag is keyword-only and defaults to
`False` so no existing call site changed behaviour.

**`needs_news_refresh` takes two timestamps and they are not interchangeable.** `newest_fetched_at`
is the newest article row; `last_claim_at` is the window claim. A refresh that ran and legitimately
found nothing new still claims the window — gate on the article timestamp instead and a quiet news
day means re-fetching on every page load. An empty feed still refreshes at any hour, weekend
included, so a fresh deploy is never blank until 09:30.

**A contract that deletes a symbol must list every file that references it.** Contract 0037
instructed deleting `needs_refresh` without listing `tests/test_briefing.py`, which monkeypatched it
— following the file list exactly would have left a broken test. One `grep -rn "<symbol>" backend/`
while writing the file list prevents this. It is the fourth planner spec error of the session and
they all share a shape: **the contract was written from a remembered picture of the tree rather than
from the tree.** The others were a criterion requiring `git diff` to see an untracked file (0033), a
grep pattern matching an API the codebase does not use (0031), and a restated layout that reverted
Gunnar's own hand-edit (0035).

**A prompt constraint placed above the text it constrains gets ignored.** Contract 0039, 2026-09-17.
`_FOCUS` had said *"Use third-person voice … rather than 'we' or first-person"* for two contracts
while every briefing opened with "We are maintaining our exposure." The instruction was real; its
**position** was wrong. `build_prompt` interpolated it mid-paragraph, above the stored earlier
briefing, so the last thing the model read was contaminated prose. Moving the constraint block to sit
immediately before the final `Briefing:` cue — with nothing after it — is what fixed it.

**A rewrite inherits the voice of what it rewrites.** The same-day branch hands the model the previous
briefing and says "rewrite this". Once one briefing acquired first person, every later one copied it,
indefinitely, regardless of instructions. Two things break the chain: an explicit
*"Follow the constraints above even where the earlier briefing does not"* in **both** rewrite
branches, and deleting the contaminated rows once. **Changing the prompt alone would have appeared to
do nothing** — the stored summaries must be cleared for a style change to become visible.

**Do not switch the briefing to Yahoo's `topstories` RSS.** Measured 2026-09-17: HTTP 200, 50 items,
no key required — and roughly **two of fifty** are broad-market. The rest is single-name SEO copy.
The reference app's quality came from **Currents plus a ~45-outlet domain whitelist**, which its own
README calls out as "doing real work, not just tidiness"; the RSS was only its fallback. Swapping
source would trade one pile of single-stock copy for another.

**Publisher preference is the lever, and it is a preference, not a filter.** Measured across 488
stored articles and 46 publishers: `24/7 Wall St.`, `Motley Fool`, `Zacks`, `GuruFocus.com`,
`Trefis` and `Insider Monkey` supplied **213** of them — the source of "investors should pivot from
nuclear utility plays." `MT Newswires` supplied 47 of exactly the wanted broad-market wire copy.
`preferred_headlines` puts the wire and mainstream press first and tops up from everything else, so a
quiet wire day still yields a full-length briefing. **The news cards still show every publisher** —
only what the LLM reads is filtered. After the change: 20 of 20 selected headlines came from
preferred outlets, zero demoted ones.

**Deleting a ticker must evict `cache.py`'s in-process entry, not just the rows.** Contract 0038.
`_cache = TTLCache(maxsize=512, ttl=86400)` is checked before the database, so deleting a ticker's
rows and re-adding it the same day would have `get_cached` serve the pre-deletion DataFrame from
memory, `is_stale` report "current", and no fetch happen — the hard delete silently undoing itself.
`remove()` evicts **after** the transaction commits; evicting first and then rolling back would leave
memory and storage disagreeing in the other direction. The only manual check that distinguishes a
real delete from a cache-reversed one is that re-adding takes seconds and refetches ten years.

**News comes from five fixed market feeds, not from the universe.** Contract 0040, 2026-09-17.
`MARKET_NEWS_TICKERS = ("^GSPC", "^IXIC", "^RUT", "SPY", "QQQ")`, and only articles from
`PREFERRED_PUBLISHERS` are stored at all — the filter runs at **ingest**, in the refresh loop, after
`parse_article` and outside it (a parse failure and an editorial rejection must stay
distinguishable). The whole point is that it is **O(1) in universe size**: five feeds whether the
universe holds 20 tickers or 500, against 500 yfinance calls per refresh under per-ticker
aggregation. The accepted cost is that news about individual holdings disappears.

**Yahoo has no top-stories channel. Do not go looking for one again.** Four routes measured
2026-09-17, all drawing from one provider pool and all dominated by content mills:
`finance.yahoo.com/rss/topstories` gave ~2 of 50 broad-market **and carries no publisher field**, so
it cannot be filtered at all; `yf.Search("stock market")` gave 11 of 15 as Zacks *"Why X Outpaced the
Stock Market Today"*; the `^GSPC`/`^IXIC`/`^RUT` feeds gave the same templates, because Yahoo attaches
anything merely mentioning "the market"; per-ticker feeds gave 6 of 16 preferred. **The channel is
not the variable — the publisher is.** Fixed broad feeds work only *because* they are filtered:
unfiltered they are indistinguishable from the per-ticker feeds they replaced.

**A backend constant can silently starve the frontend through an unrelated parameter.** Cutting the
source feeds from twenty to five turned `MAX_PER_TICKER = 1` in `NewsSection.tsx` from a diversity
control into a hard cap of **five articles** for the whole page. Nothing in either file references the
other. When changing how many things a query iterates, grep the frontend for per-item caps.

**Retention already guarantees freshness — do not add age logic.** The stated worry that per-ticker
feeds pull stale articles was measured and disproved: 380 of 381 stored rows were under two days old,
because `NEWS_RETENTION_DAYS` bounds it. Measure the premise before building against it.

**`client.ts`'s `request` retries transient failures — GET only, 502/503/504 only.** Contract 0041,
2026-09-17. Two retries at 1000ms then 3000ms. Before it, `BackendStatus`, `TickerStrip` and
`NewsSection` each fetched once in `useEffect(…, [])` and **latched broken permanently** on a single
failed request — a uvicorn restart or a Render deploy's few seconds of 502 left the launch page
showing "API offline" with no strip and no news until a manual reload.

The constraints are load-bearing, not caution: **never retry POST or DELETE** (`POST /universe` is
not idempotent — a retried add re-fetches ten years of history), and **never retry 4xx or 500** (a
404 for an unknown ticker must fail immediately; a 500 means the app already raised, so retrying
doubles the load and changes nothing). The implementation gets idempotency from data —
`method === 'GET' ? [1000, 3000] : []` — so a non-GET has no delays to consume rather than relying on
a conditional that could drift. `response.text()` must be read **after** the retry decision; reading
it earlier consumes the body and breaks the retry.

**"Empty means unset" applies to `CORS_ORIGINS` and must never be applied to `DATABASE_URL`.**
`os.getenv("CORS_ORIGINS", "default")` returns `""` for an exported-but-empty variable, so the
default never applies and `cors_origins` becomes `[""]` — a list matching no origin, failing silently.
Fixed with `or`. But `DATABASE_URL=""` meaning *no database* is the safety convention every ad-hoc
command in this project relies on to stay off production; generalising the fix there would invert the
guard into a live production connection.

**`config.py` raises at import when an ambient variable conflicts with `.env`.** Only when both are
non-empty and differ — an empty ambient value is a deliberate opt-out, and a key absent from `.env` is
never a conflict, which is what keeps **Render unaffected** (no `.env` file there, so `dotenv_values`
returns `{}`). The message names the variable but prints no secret: username and host for
`DATABASE_URL`, length only for `GEMINI_KEY`. This exists because the same failure cost two evenings
and neither symptom named its cause — once as *"password authentication failed"*, once as
*"API offline"* while the server logged 200s.

**The refresh lock and the `app_state` claim are complementary, not redundant.** A module-level
non-blocking `threading.Lock` (sync functions in FastAPI's threadpool, so not `asyncio.Lock`) closes
the in-process race the claim-first write only narrowed; the claim is what survives a restart and what
would cover multiple workers. Separate locks per module so a universe sweep never blocks a news
refresh. It mattered more after contract 0034 put a **paid Gemini call** at the end of the news path.

**The test suite blocks the network by default.** Contract 0043, 2026-09-18. `tests/conftest.py`'s
autouse `block_network` fixture patches `socket.socket.connect`, `connect_ex`,
`socket.create_connection` **and `curl_cffi.requests.Session.request`**, raising `RuntimeError` — not
`OSError`, because an `OSError` looks like a genuine connection failure and this codebase has five
`except Exception: continue` handlers that would absorb it. Opt out with
`@pytest.mark.allow_network`, registered in `backend/pytest.ini`. **Never add that marker to make an
existing unit test pass** — patch what it calls instead.

Why it was needed: every contract claimed "tests pass with no network" and that was true only by
accident. Contract 0037 added a second `background_tasks.add_task` to `GET /universe/strip` without
updating the tests that patch the first — and `TestClient` runs background tasks **synchronously**, so
three tests each performed a real news refresh across every `MARKET_NEWS_TICKERS` entry, ~21 live
Yahoo requests per suite run, against the IP Yahoo already rate-limits for this app. They passed
regardless, because the per-ticker `except Exception: continue` swallowed the result. Runtime went
**22.97s → 2.88s**; the slowest test is now 0.06s, previously 3.26s.

**Blocking `socket` does not block a library that binds a native transport.** `yfinance` reaches
libcurl through `curl_cffi`'s C bindings and never touches `socket.socket`. With only the socket
patches installed, `yf.Ticker("AAPL").news` **still returned 10 live articles inside a test** —
measured 2026-09-18. `yfinance/data.py` uses both `requests` and `curl_cffi`: the socket patches break
the cookie/crumb flow, but contract 0030 established that `.news` needs no crumb, so it goes straight
out. The planner initially credited the block for a 22.7s → 7.7s speedup that mostly came from fixing
the tests. **Verify a network block by making a real call through the library you care about, never
through `socket`.**

**The strip reads a bounded date window, not full history.** Audit fix, 2026-09-18.
`build_strip_response` derives only five things from bars — newest close, the one before it, and the
5-session, 30-session and YTD anchors — but read every bar for every ticker to do it: **55,917 rows
transferred where 3,914 sufficed**, on the one endpoint that runs on every page load. `bar_window_start`
bounds it. Measured warm, the bar query went **0.646s → 0.088s and 3,983 KB → 277 KB resident**; the
whole function is ~0.30s median against ~0.86s before, and at 500 tickers it avoids ~1.3M rows.

The window is `min(1 January, today − 75 days)` and **both bounds are load-bearing**. YTD needs the
first session on or after 1 January; `nth_prior_close(bars, 30)` needs 31 sessions, which 1 January
does *not* guarantee — on 5 January only a handful of sessions exist in the year. 75 calendar days is
roughly 52 sessions. **Widening is safe, narrowing fails silently**, because `five_day` /
`thirty_day` / `ytd` are computed and returned but not yet rendered (contracts 0028, 0033) — a short
window drops them to `None` with nothing on screen to notice. Hence the pure, parametrised tests.

`list_all` was already right by contrast — `COUNT`/`MIN`/`MAX` with `GROUP BY`, plus a window function
ranking non-null closes, one row per ticker. The strip was the only place reading whole tables.

**recharts is lazy-loaded; the launch page must never pull it.** Audit fix, 2026-09-18. `ChartDialog`
statically imported recharts (9.3 MB on disk) into the main chunk, so every visitor downloaded the
charting library — including launch-page-only visitors who never chart anything. `React.lazy` plus
**conditional rendering on `selectedTicker`** split it: initial JS **650.63 kB → 296.24 kB**, gzipped
**195.61 kB → 92.56 kB**.

Both halves are required. `ChartDialog` returns `null` internally for a null ticker, so leaving it
mounted-and-returning-null would still fetch the chunk on page load and the split would buy nothing.
And `UniversePage` warms the chunk with a bare `void import(...)` after mount — without it the first
row click waits on a ~103 kB download behind `fallback={null}`, which reads as the click doing
nothing. The preload sits in `UniversePage`, never in `App`, so `/` stays clean.

**`reference files/` is read-only.** It is a snapshot of other working software — the old yfinance
script, the Streamlit news section — kept so its behaviour can be compared against this rebuild.
Read it freely; never edit, move, rename or reformat anything under it, including to fix an obvious
bug or a stale comment. An edited reference stops being evidence, and every measurement taken against
it becomes unverifiable. Both coder role files carry this as a hard rule, the contract template repeats
it, and `.claude/settings.json` denies Edit/Write there — though a deny list cannot see a shell
redirect or `sed -i`, which is why the rule is written down as well as enforced.

**The conflict guard allows exactly one ambient value: the empty string.** Clarified 2026-09-22 after
two coders in eight contracts read it as a malfunction. `DATABASE_URL=""` imports cleanly — the
deliberate opt-out every ad-hoc script relies on. `DATABASE_URL="sqlite:////tmp/x.db"` **raises**,
because the guard rejects any non-empty ambient value differing from `.env`. Both are contract 0041
behaving as designed, but only the first was ever written down, so an agent wanting a throwaway
database hits a wall with no stated remedy. **The remedy is the pytest fixtures**, which build an
isolated SQLite file and strip the variable; both coders found that on their own and both flagged the
wall. Now in `contracts/TEMPLATE-contract.md`.

**An exported `DATABASE_URL` silently beats `backend/.env`.** Cost a debugging session on
2026-09-15. `config.py` calls `load_dotenv(path)`, and `load_dotenv` **does not override a variable
already present in the environment** — so a stale `export DATABASE_URL=...` left in one terminal from
earlier debugging wins, permanently, for every process launched from that shell.

The symptom does not point at the cause. Render reports
`FATAL: password authentication failed for user "<old-user>"` — a username that is not in `.env` at
all — which reads as a rotated-password problem and is not one. **The tell is the username**: if the
user in the error is not the user in `.env`, the process is not reading `.env`. Fix is
`unset DATABASE_URL` in that shell, or a new terminal; it was not in any rc file.

Also in that error: `FATAL: SSL/TLS required` appears alongside, and is **noise**. psycopg defaults
to `sslmode=prefer`, tries SSL first (that attempt is the one that gets the real auth error), then
retries without SSL, which Render rejects. SSL is not the problem — do not chase it.

**Do not "fix" this with `load_dotenv(override=True)`.** Every ad-hoc command in every contract is
prefixed `DATABASE_URL=""` precisely to keep throwaway scripts off production. With `override=True`
that empty string gets replaced by the real URL from `.env`, and the guard silently inverts into a
live production connection — a worse failure than the one it fixes. The correct shape is to detect
the conflict and raise at import when an ambient `DATABASE_URL` and a `.env` `DATABASE_URL` are both
non-empty and differ, while still honouring an explicitly-empty `DATABASE_URL=""` as a deliberate
opt-out. Not yet built.

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

### Which Yahoo data needs the crumb, and which does not

Measured locally 2026-09-18 with **yfinance 1.7.0**, then confirmed from the deployed app the same
day. This is expensive to rediscover — it is the difference between "Yahoo is broken from Render" and
"one of Yahoo's three endpoints is."

Yahoo gates `quoteSummary` behind a crumb token. From Render's shared IP the crumb handshake fails
and `.info` 401s (contract 0013). **It does not follow that nothing works**, because the data is
spread across three endpoints with different requirements:

| source | how | needs crumb | carries |
|---|---|---|---|
| chart | `yf.download`, `yf.Ticker(t).get_history_metadata()` | **no** | bars, `shortName`, `longName`, `instrumentType`, `currency`, `exchangeName`, `regularMarketPrice`, `chartPreviousClose`, 52-week high/low |
| search | `yf.Search(t).quotes` | **no** | `sector`, `industry` — equities only; ETFs genuinely carry neither |
| quoteSummary | `yf.Ticker(t).info` | **yes** | `market_cap`, `trailing_pe`, `forward_pe`, `dividend_yield`, `beta`, `average_volume` |

One `get_history_metadata()` call costs ~0.27s.

**Correction, same day:** the line that stood here — that `market_cap`, `trailing_pe` and
`dividend_yield` have no crumb-free equivalent — was wrong, and was written without checking
yfinance's source. There is a **fourth** endpoint:

| source | how | needs crumb | carries |
|---|---|---|---|
| fundamentals-timeseries | `yf.Ticker(t).get_valuation_measures()`, and `fast_info.shares` via `get_shares_full` | **unproven** — not `quoteSummary` | `Market Cap`, `Trailing P/E`, `Forward P/E`, enterprise-value ratios, `Price/Sales`, `Price/Book` |

It lives at `ws/fundamentals-timeseries/v1/finance/timeseries/{ticker}` on `query2` (`base.py:519`),
**not** `v10/finance/quoteSummary`. For AAPL it returns `Market Cap 4.918e12` and
`Trailing P/E 38.65`, against `.info`'s `4.86T` and `38.2`. Dividend yield is derivable from the
chart/actions endpoint, which is already proven from Render: AAPL's trailing twelve months is `1.06`,
so `1.06 ÷ 337 × 100 = 0.31%` against `.info`'s reported `0.33%` — close, and a defensible
approximation rather than a blank.

Whether that endpoint is crumb-free **from Render's IP** is unproven and cannot be tested from a
laptop where the crumb works. Contract 0054 builds it as a best-effort tier so a failure degrades to
exactly today's behaviour. `beta` and `average_volume` genuinely remain `quoteSummary`-only.

**Confirmed on the deployed app, 2026-09-18 (contract 0054).** After the post-push deployment,
deleting and re-adding AAPL at 13:45 ET produced last close `337.00`, live price `335.41`, and
`-0.47%` immediately — `(335.41 - 337.00) / 337.00`, so the targeted quote-on-add path ran rather
than waiting for the batch claim. The same new row showed `4.92T` market cap, `38.6` P/E, and
`0.31%` yield. Those are the timeseries/actions values above, rather than `.info`'s observed
`4.86T` / `38.2` / `0.33%`, confirming that both tier-1.5 endpoints work from Render's IP while
the crumb-gated `.info` path does not.

The general lesson, which is the part worth keeping: **"Yahoo is blocked" was never true — one of
Yahoo's four endpoints was.** Check which endpoint a yfinance property actually calls before
concluding the data is unreachable; `fast_info` and `.info` do not share a source.

Also load-bearing: **yfinance 1.7.0 degrades rather than failing.** `data.py:_make_request` catches a
429 or transient error from the crumb fetch, logs, and continues **without** a crumb, letting the
endpoint decide. So crumb-free endpoints keep working while the handshake is broken — which is the
only reason the tiering above is possible at all.

Built as contract 0051: `.info` first and **authoritative** when it succeeds (full-row overwrite, one
request, the 22 laptop-populated rows unchanged); the two crumb-free tiers only when it doesn't.
Confirmed on Render 2026-09-18 — PBR came back `Petroleo Brasileiro S.A. Petrob` / `Equity` /
`Energy`, so **both** tier 1 and tier 2 work from that IP.

Two rules that came out of it and must not be quietly dropped:

- **A partial write never overwrites a non-null stored value with `None`.**
  `cache.store_fundamentals` upserted every column unconditionally; routing a two-field crumb-free
  merge through that would have blanked every existing row's market cap, P/E and yield. Hence
  `partial=True`. An authoritative source is still allowed to clear a field — a non-payer really can
  stop paying a dividend — so `partial=False` keeps the old behaviour exactly.
- **Retry on incompleteness, not absence.** Once partial rows exist, "the row is `None`" is never
  true again, so a retry gated on absence never fires. The cost of gating on incompleteness is ≤3
  extra `.info` attempts per day per Render-added ticker, and the benefit is that it self-heals the
  moment Yahoo relents.

### A batch TTL cannot be read off the rows it is meant to cover

`quotes.refresh_quotes_if_stale` gated on `MAX(fetched_at)` across the requested tickers. A ticker
with **no quote row contributes nothing to a MAX**, so a newly-added ticker could never make the
batch look stale — it waited out everyone else's TTL before getting its first quote.

`MIN` is not the fix: a ticker that permanently fails to quote would then make the batch look stale
forever, firing a network request on every page load. The gate belongs on a **last-attempt timestamp
in `app_state`**, claim-written before the fetch — the pattern `autorefresh.run_auto_refresh_if_due`
already uses. An attempt that fetched nothing still claims the window. Contract 0051.

The general shape: **when the decision is "has the batch been tried recently", never derive it from
per-row data, because the rows that most need the work are exactly the rows that are missing.**

**And the claim has the same blind spot** — found 2026-09-18, when a ticker added at 12:08 PM still
showed `0.00%`. A global timestamp knows *when the batch was last tried* and nothing about *which
tickers it covered*, so a ticker added inside a live window waits out the TTL exactly as it did under
`MAX`. Making the gate coverage-aware brings back the storm it exists to prevent. The answer is a
**targeted fetch at the moment of the add** (contract 0054) — bounded by a deliberate user action, so
it cannot fire on a page load. The batch gate stays purely time-based; coverage is handled at the one
point where a ticker is known to be new.

### `add()` stores today's partial bar, and the change % reads 0.00% because of it

Found 2026-09-18, after 0051 deployed. `universe.add()` calls `fetch_history(key, start, end=None)`,
and `end=None` lets yfinance download **through today** — so a ticker added during market hours gets
today's in-progress bar stored as though it were a completed session. `last_close` then reads that
bar, making the change % a comparison of today's price against itself: **~0.00%, by construction, no
matter how good the live quote is.** Every other ticker stops at the previous session, which is why
only the newly-added one shows it.

`refresh_ticker` does not repair it the same day: `is_stale` is `newest < last_session`, and during
the session the stored bar is *newer* than the last completed session. It **does** self-correct at
the next close, when `last_session` advances and `missing_range` re-fetches from the newest stored
date precisely to overwrite a partial bar — that guard exists, it is just unreachable until the row
goes stale.

The fix is at the source: bound `add()`'s `end` to the last completed session so a partial bar is
never written. Not yet built.

**The Backtest tab becomes Optimize: a port of `main`'s optimizer, kept as close to it as practical.**
Gunnar's decision, 2026-09-24, after learning that `main`'s "Backtest" tab is an optimizer (slug
`targets`). Contracts 0103 onward. He accepted a job of about six contracts.

- **Renamed because the old name was misleading.** Its comparison is **in-sample**: the weights are
  fitted and then scored on the same window, so "Optimized" beats "Current" almost by construction.
  The comparison is kept, as in the reference, but it is labelled in-sample and not a forecast.
- **Picking weights and scoring them are two jobs with different models.** Revised 2026-09-24, after
  Gunnar challenged "constant weights, rebalanced daily". This deliberately departs from the
  reference.
  - **Picking: the reference's constant-mix objective, unchanged.** The expected-return (`w·μ`) and
    risk (`w'Σw`) terms computed from daily returns are exact only for a portfolio held at `w` every
    day. That makes it the one consistent thing to optimize. Optimizing for buy-and-hold directly has
    no clean objective, depends on the start date and overfits the window. The UI labels the weights
    "constant-mix".
  - **Scoring and curves: buy-and-hold from the window start by default.** There is an optional
    rebalance schedule: none (the default), monthly, quarterly or annual. These portfolios are held,
    not traded. The shortest hold is about a month. A daily-rebalanced curve sells winners every day at
    no cost. On a concentrated book (Gunnar's is 74% MU), that trims exactly what buy-and-hold lets
    compound, and over a trending multi-year window the two curves diverge a lot. Daily vs monthly vs
    quarterly usually differ little. The large gap is between rebalancing on any schedule and never
    rebalancing, which is why "none" is the default and the others are options.
  - **Built on the `value_series(units, prices)` seam** in `app/portfolio_series.py`:
    - units are set at the window start from the weights (`units_from_weights`), and re-set from the
      running value at each rebalance date
    - per-holding series therefore sum to the total by construction
    - this avoids `main:core/scenarios.py`'s bug, where contributions don't add up to the curve
  - **Anchored at the window start, not today, unlike Holdings.** Anchoring at today would be
    look-ahead: start weights implied by future prices, so winners start small because they later grew
    into today's weight. So the "Current" curve still differs from the Holdings chart. It's the same
    buy-and-hold model with a different anchor, and a one-line note says so.
  - **Still in-sample.** Scoring constant-mix weights as drifting removes one flattering assumption.
    It does not remove fitting and scoring on the same window. The "in-sample, not a forecast" label
    stays. An accepted cost is that "Optimized" will beat "Current" less often. That is the honest
    result, not a regression.
  - **Cash is excluded from both curves**, as in the reference: the weights are renormalised over the
    tickers. The optimizer allocates only the invested sleeve, and Apply keeps cash fixed. A constant
    cash sleeve in both curves would compress their gap without adding information. The UI says
    "invested holdings only".
  - **No flat fill.** The *scored* curves start at the latest first bar among the holdings
    (`backtest_series`, 0104), and the start date is labelled with the holding responsible. Flat fill is
    a labelled Holdings convenience. Here it would invent zero-return days that then get scored.
  - **Young holdings are pinned, not allowed to shrink the fit** (decided 2026-09-24, Gunnar).
    - **Why:** `main` fit on the common history and warned only below 60 days. So one recent listing
      silently cut a 3-year lookback down to months, and the optimizer produced confident weights from
      it. A second planner session raised this, and Gunnar chose pinning over a refusal floor or a
      manual toggle.
    - **Which holdings are pinned:** those whose first bar is more than 7 calendar days after the
      lookback start. The grace absorbs weekends and holidays at the window edge.
    - **What pinning means:** a pinned holding keeps its current weight. The optimizer fits only the
      full-history holdings, on the full requested lookback. Their weights are scaled to `1 − Σ pinned`.
    - **Bounds:** the user's max and min weight apply to the **final** weights, so the optimizer gets
      `bound ÷ (1 − Σ pinned)`, capped at 1, and the feasibility guards use those scaled bounds. A
      pinned holding may itself exceed the max, and the banner says so.
    - **Too few to fit:** fewer than 2 full-history holdings is a 422 ("need at least 2 holdings with
      full history"), mirroring `main`'s two-ticker minimum.
    - **Banner:** a banner, not a warning line, names each pinned holding with its first date and weight.
    - **Scoring window:** scoring still needs every holding, so the curves start at the youngest
      holding's first bar. That is shorter than the fit window, and it is labelled. This is the honest
      cost of pinning: the fit window and the score window differ.
  - **Metrics are computed from the scored curve's daily returns.** Sharpe = (CAGR − rf) / vol, with
    rf = 0, as in the reference and labelled. This overrides, for this tab only, the "not to port"
    note on Sharpe in the buy-and-hold entry.
- **All reference features are ported, including the three the reference coded but never made
  reachable:**
  - conviction views, with the κ return bump
  - the tilt engine (`core/tilt.py`)
  - `max_sharpe_capm` with its forward-looking panel
  The reference's dropdown omits `max_sharpe_capm` and draws no controls for entering views. Gunnar
  chose to wire these up rather than skip them. That part is new design work, not a copy.
- **Reference bugs fixed in the port, not copied.** Each was found by running `main`'s code on literal
  fixtures in the reference venv:
  - **Risk parity** aimed each asset's risk contribution `wᵢ(Σw)ᵢ` at `σ/n`, but those contributions
    sum to `σ²`, not `σ`. On two uncorrelated assets with daily vols of 1% and 2% it returns
    0.788/0.212, where true equal risk contribution (inverse vol) is 0.667/0.333. The fix aims at
    `σ²/n`.
  - **A Sharpe with zero volatility** fell through the `vol > 0` guard because of float noise
    (`vol ≈ 3e-18`), giving Sharpe ≈ 8e16. The guard becomes `vol > 1e-12`, and the result is `None`
    rather than `0.0`. Zero is a false claim, and `None` is shown as "—".
- **Apply to Portfolio also writes share counts.**
  - **When every position has a share count**, the new counts are
    `target weight × invested value ÷ last close`, where invested value = Σ shares × last close.
    Counts are **fractional**, per Gunnar, so the weights land exactly and no remainder goes to cash.
  - **When only some positions have shares**, the weights are applied and **all share counts are
    cleared**, per Gunnar. This deliberately destroys data, so the confirm dialog must say so.
  - **When no position has shares**, only the weights are applied.
  - The price is `last_close`, not the live quote, for the same reason as the Holdings dollar rule.
  - `main` computed target shares in its action table, then threw them away on Apply.
- **Short positions can be optimized but not applied.** Portfolio validation requires positive
  weights, so Apply is disabled whenever any target weight is negative, with an explanation.

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
- ~~**Whether `Research` and `/ops` survive as real features.**~~ **Resolved 2026-09-22: both
  survive, and the order is Portfolios → Ops → Research.** Gunnar's call. All four nav destinations
  are now real features rather than labels awaiting a decision, which removes the contradiction with
  the cut list below — see the corrections recorded there.
  - **Research is deliberately last and is not to be started early.** Not because it is least
    valuable, but because it is the only one whose shape depends on the other two: research output is
    about portfolios, and anything operational about it shows up on Ops. Building it first would mean
    guessing at both.
  - **"Fully done" means Gunnar is satisfied and cannot think of further features** — his
    definition, 2026-09-22, given when asked. It is a judgement call, not a checklist, and it is
    deliberately his to make. **Ops is already close**, subject to revision as Portfolios and Research
    grow and change what operational visibility is worth having.
  - The consequence to stay aware of: the gate to Research is a feeling rather than a list, so it can
    recede. That is an accepted property of this project, not a defect — but if Portfolios work starts
    looking unbounded, the fix is to ask for the list, not to start Research early.

**No cost basis, no dollar P&L. Holdings shows returns instead.** Decided 2026-09-22, contracts 0077
and 0078, re-affirming the 2026-09-18 position model rather than reversing it — *"an
allocation-analysis and optimization tool, not a tax lot, P&L, or brokerage-holdings ledger."* The
reference's Holdings table has `Cost Basis` and `P&L` columns; ours will not.

- **The deciding argument is that share counts cannot carry dollars here.** Shares are optional
  metadata and drift from weights on every cash edit (contract 0072). `P&L = (price − cost) × shares`
  computed from drifting shares yields a figure that *looks* precise and is not — the silent-wrongness
  class this project keeps getting caught by. A return percentage needs neither a share count nor a
  purchase price.
- **One cost-basis number is wrong per lot.** Three purchases at three prices average into something
  that is never right for tax and cannot answer "which lot would I sell." Doing it properly means tax
  lots — dates, quantities, prices — which is the ledger the model rules out. If P&L is ever wanted,
  that is the honest shape, and it is a deliberate expansion rather than a column.
- **Presets cannot have it.** Both shipped presets are allocations; a P&L column would be permanently
  blank for every preset-derived portfolio.
- **It would reopen the importer.** Broker exports carry cost basis, so once the canonical format has
  the column, reading theirs becomes the obvious next ask — and that is the four-format sniffer
  deliberately not ported from `main`.
- Rejected shape, recorded so it is not re-proposed casually: `costBasis?: number` on `Position` plus a
  `cost_basis` CSV column. That *is* the right shape **if** the decision ever reverses — model-level
  and round-tripping, not UI-only.

**Technical signals: SMA cross, RSI, MACD as states; ATR as a number.** Contracts 0082 and 0083,
2026-09-22. Ported in substance from `main:backend/core/{indicators,signals}.py` with three
deliberate departures.

- **ATR is not a signal and the reference's own UI lied about it.** `compute_all_signals` returns
  exactly `sma_cross`, `rsi_threshold`, `macd_cross`; `grep -in "atr" signals.py` finds nothing. The
  reference frontend nevertheless offers an `ATR` dropdown option filtering on `includes('atr')`,
  which matches zero results — **selecting it shows an empty cell.** ATR measures magnitude, not
  direction, so it cannot have a bullish reading. Ours returns `atr_pct` with no state. Gunnar's call.
- **One query for all tickers, not one per row.** The reference's `SignalCell` runs a `useQuery` per
  ticker — 20 positions, 20 requests. Fan-out is what got Render's IP rate-limited (contract 0013),
  and `/universe/returns` already set the bounded-single-query precedent.
- **Insufficient history gives `state: null`, never `NEUTRAL`.** The reference returns `NEUTRAL` for
  an empty RSI, conflating *computed-and-neutral* with *could-not-compute*. Different answers deserve
  different values.

Two data decisions that are easy to get wrong and invisible when you do:

- **Signals compute on `adj_close`, never raw `close`.** A 4:1 split is a 75% single-day drop in raw
  close, which manufactures a fake bearish SMA crossover and a fake oversold RSI out of a corporate
  action. Split-restatement is exactly what `adj_close` exists for.
- **ATR needs high and low, and they must be scaled to match.** `price_bars` stores raw `high`/`low`
  beside both closes. Mixing raw highs with adjusted closes breaks across any split. Scale per bar by
  `adj_close / close` before computing true range. And `atr_pct` is a **percentage of price** — raw
  dollar ATR is not comparable between a $5 stock and a $500 one, which is the whole point of putting
  it in a column beside other tickers.
- **`bar_window_start` is the wrong window for signals.** It bounds to ~52 sessions; a 20/50 SMA
  crossover needs 50 sessions *plus* history before them to detect a cross, so in early January it
  would silently return `state: null` for everything. Signals use their own `SIGNAL_WINDOW_DAYS = 400`.

**RSI saturates at 100 on a flat series, which is wrong.** Found in the 0082 audit, 2026-09-22:
`compute_rsi(pd.Series([50.0] * 30))` returns `100.0`, so `signal_rsi_threshold` reports
`OVERBOUGHT` for a price that has not moved at all. Any ticker with unchanged stored closes across the
window — illiquid, halted, or a repeated-value data gap — gets a false bullish-caution badge.

The cause: with no down moves `avg_loss` is 0, so `rs` is infinite and `100 − 100/(1 + rs)` saturates.
That is **correct when `avg_gain > 0`** and wrong when both are 0. Contract 0083 returns `50.0` for
exactly that per-period condition — not by clamping, and not by adding an epsilon to the divisor,
which would make a genuinely rising series read 99.9.

**The scope of that fix was wrong on the first attempt, and the correction is the interesting part.**
0083 originally also demanded that a *rise followed by a flat stretch* read 50, and specified the
exact condition `avg_gain == 0 and avg_loss == 0`. Those cannot both hold: under EWM smoothing
`avg_gain` decays toward zero but never reaches it, so the condition is never met mid-series. The
coder reported `BLOCKED` rather than guessing between "detect flat windows from recent deltas" and
"change the smoothing."

It was also **wrong on the merits**. Standard RSI — TradingView, StockCharts — *does* return 100 for
rise-then-flat, because every move in the lookback was upward. Diverging would have made our figures
disagree with every public chart, which is exactly the comparison 0082's human verification asks for.
**Only a series that has never moved reads 50**, and a test now pins the rise-then-flat case at 100
with a comment saying it is deliberate, so nobody "fixes" it later.

The general shape: **before correcting a number, check what the established implementations do.** An
intuition about what a figure "should" be is not a specification, and a finance indicator that
disagrees with every charting site is a bug regardless of which is more principled.

**The evidence was in contract 0082's own report and went unnoticed on first read.** Its sample
response shows `ATRADJ` — a fixture seeded flat at 50 for the ATR test — coming back `OVERBOUGHT`.
The contract whose Why section warned that *"a wrong RSI looks entirely plausible"* shipped with a
wrong RSI visible in its own output. **When a report pastes a response body, read the values, not just
the shape.**

**`DATABASE_URL=""` still works and is still the required prefix.** Contract 0082's report claimed an
ad-hoc check was *"blocked by the production-connection conflict guard"*; verified in the audit that
`app.config` imports cleanly under it, exactly as the guard was designed to allow. Correcting the
record matters more than the incident: that prefix is the only thing keeping throwaway scripts off
production, and an agent believing it is blocked would stop using it.

**The Day column is coloured by sign even when the price is not live.** Gunnar's call, 2026-09-22,
contract 0081. Both tables previously greyed the figure whenever `priceChange` reported
`live: false` — outside market hours, or on a stale quote — because the number shown is then the
*last completed session's* move rather than an intraday one.

- **Colour was carrying that distinction, and now the tooltip is the only thing that does.**
  `UniverseTable`'s two messages (`Change from the last close` / `Last completed session's change —
  not a live price`) become load-bearing rather than decorative; do not merge or delete them.
- **`HoldingsPage` had no tooltip at all**, because contract 0078 banned them on data cells. Under the
  old rule grey still signalled *something*; under the new one Holdings would have had no signal
  whatsoever. It gains a `Day` **header** tooltip — consistent with 0078's rule that headers stating a
  convention get one, and cells do not.
- The general shape, which is the part worth keeping: **when you remove a visual encoding, check what
  it was encoding.** Grey looked like styling and was carrying data.

**~~A basis date replaces cost basis~~ — REVERSED 2026-09-24, removed by contract 0095.** Gunnar's
call. Reasons, recorded so it is not re-added casually:
- **It could not answer the question it was wanted for.** "Gains since I bought" needs lots (what,
  when, at what price), which the no-cost-basis decision rules out. What it actually computed was
  "today's allocation held since X", which is a hypothetical, as the limitation note below says.
- **That hypothetical is a backtest**, and the Backtest tab will answer it properly, with a curve, a
  portfolio total and cash included, instead of one number per row. Two places computing
  return-since-a-date would eventually disagree. That is the 0071/0072 lesson.
  **Superseded 2026-09-24:** the Backtest tab became Optimize, which excludes cash and scores fitted
  weights in-sample, so it does not answer this question. The since-a-date hypothetical has no home
  yet.
- **The `basis_date` CSV column got more expensive to remove with every export.** Removal keeps
  compatibility: stored `basisDate` keys are stripped on read, and old CSVs import with the column
  ignored.
- Accepted cost: until Backtest ships, the app has no "since date X" answer at all.

Original entry, kept for the reasoning:

**A basis date replaces cost basis: per-portfolio, percentage only.** Gunnar's idea and call,
2026-09-22, contract 0079. The user names one date; the app reports return since that date's close,
from stored bars.

- **It is a custom return window, not a cost basis**, and the naming matters. Same `pct_return` and
  the same bars as 5D/30D/YTD, with a user-chosen anchor instead of a fixed one — so it costs almost
  nothing now that `app/returns.py` exists. Calling it "cost basis" would re-invite the P&L question
  and imply a tax meaning it does not have.
- **Percentage only, never dollars.** Dollars would drag share counts back in, and those drift from
  weights on every cash edit.
- **Known limitation, and it must be labelled in the UI:** it assumes the *current* allocation was
  held since that date. Add to a position after the date and the figure is a hypothetical — "what if
  I had held today's allocation since then" — rather than a realised return. That is a useful question
  and close kin to what the Backtest tab will do, but it is not the same claim as "your return."
- **Open when 0079 is written: where the date lives in the canonical CSV.** Portfolio-level metadata
  has no natural home in a flat table — the same problem that sent the portfolio *name* into the
  filename (contract 0067). A `basis_date` column populated only on the reserved `CASH` row is the
  leading candidate, since every canonical export has exactly one. Unlike the name, a date cannot be
  recovered from a filename, so "do not round-trip it" is a real loss rather than a simplification.

**Return math is extracted to `app/returns.py`, tier 0.** `pct_return`, `nth_prior_close`,
`ytd_base_close` and `bar_window_start` were inside `strip.py`; the Holdings tab is the second
consumer and Risk & Perf will be the third. **A derived quantity computed in two places eventually
disagrees in one** — contracts 0071 and 0072 spent two rounds proving that for cash, and copying the
math rather than moving it would have been the same mistake with a longer fuse. Returns use
`adj_close`, never `close`.

**The portfolio value line is buy-and-hold, anchored at today, cash included.** Decided 2026-09-24,
for the Holdings portfolio charts (contracts to follow 0095). Gunnar's calls on no rebalancing and
cash included; the anchor is the planner's.
- **No rebalancing, ever, in this series.** Holdings are derived from the declared weights at
  today's prices (`units = weight × V / price_today`) and then held unchanged backwards through
  history. The line's right end is exactly the declared portfolio. **This is a deliberate departure
  from `main`**, which models every curve (`core/portfolio.py: (returns * w).sum(axis=1)`) as
  constant weights rebalanced daily, and says so in a warning.
- **Anchor at today, not at the window start.** A start-anchored buy-and-hold line changes shape
  whenever the start date moves, so every RSI and MACD value would change on zoom. Today-anchoring
  makes the path independent of the visible window. Rebasing to 100 at the visible start is then a
  constant multiplier: RSI is unchanged by it, and SMA, EMA, Bollinger and MACD scale linearly.
- **Cash is included, as a constant dollar amount.** A 30%-cash portfolio really does move about 70%
  as much. Leaving cash out overstates both return and volatility, and makes the chart describe a
  different allocation from the one declared. `main` leaves it out (it renormalises weights over the
  tickers). That is a departure too.
- **Only close-based indicators apply.** A portfolio has no true daily high, low or volume.
  Weighted constituent highs always overstate the portfolio's range, because holdings peak at
  different times. So ATR, Donchian, ADX, Stochastic and OBV are omitted on the portfolio chart
  rather than approximated.
- **The seam that keeps Backtest open:** `value_series(units, prices)` is separate from how the
  units are chosen. Holdings chooses them from today's weights. Backtest will choose them at a start
  date and re-choose them at rebalance dates. Per-holding value series are returned alongside the
  total, so contributions sum to the total by construction. `main:core/scenarios.py` gets this wrong:
  its contributors use buy-and-hold per-asset returns while its equity curve is daily-rebalanced, so
  the parts do not add up to the whole.
- Also not to port from `main`: its Sharpe is `CAGR / vol` with `rf = 0`. **Corrected 2026-09-24:**
  `main` *does* have a tab labelled "Backtest". It is the `targets` slug
  (`main:frontend/app/portfolios/[id]/targets/page.tsx`, 773 lines), and it is really an
  **optimizer**:
  - 8 modes via scipy, with lookback, min/max weight, shorting, vol target and conviction κ.
  - A CAPM forward panel.
  - An **in-sample** current-vs-optimized comparison, i.e. weights fitted and scored on the same
    window.
  - An action table with CSV export, an equity curve vs SPY, and "Apply to Portfolio", which
    overwrites the weights.

  Its other backtest-like code is `/portfolios/{id}/analytics` (equity curve vs SPY, feeding the
  Risk page), `scenarios.py` (historical-window replay) and `walk_forward.py` (optimizer
  out-of-sample folds).
- **Dollars on the y-axis only when the share counts agree with the weights.** Gunnar approved this
  rule 2026-09-24. Dollars are used only when every position has a share count and each position's
  share-implied weight, `shares × last_close / V`, is within **0.5 percentage points** of its declared
  weight. `V = Σ shares × last_close / ((100 − cash) / 100)`, which is `impliedPortfolioValue`'s formula.
  In every other case the chart is an index at 100 on the visible start date, with a note saying the
  share counts don't match the weights. The reason: the line is built from weights. Labelling it in
  dollars while shares and weights disagree would put a dollar figure on a portfolio nobody holds.
  **The price source is the last stored close, not the live quote.** The line's right end is a close,
  so a live-price `V` would put an intraday number on an end-of-day point. For that reason the
  frontend's check uses the `last_close` the series endpoint returns, not `positionPrice`.
- **Before a holding's first stored bar, its value is held flat at its first price. The flat stretch is
  shaded and labelled.** Gunnar approved this 2026-09-24. By default the chart starts at the youngest
  holding's first bar, so nothing is flat. Any earlier date back to the oldest holding's first bar can
  be picked. The label reads, for example, "NEWB listed 2023-04-12; flat before then". Rejected: making
  the youngest holding's start a hard floor, which threw away years of the other holdings' history;
  and renormalising the weights before a listing, which is a form of rebalancing.
- **Per-holding value series exist in `app/portfolio_series.py`, but the HTTP response doesn't carry
  them.** With 30 holdings over six years that is about 50k floats that no current page draws. Backtest
  can add them to its own response when it needs contributions. The seam is the pure function, not the
  wire format.

**Portfolio analysis lives at `/portfolios/:id/<tab>`, portfolio-scoped.** Decided 2026-09-22,
contract 0075, matching `main:frontend/app/portfolios/[id]/`. Five tabs: Holdings (default), Backtest,
Outlook, Monitor, Risk & Perf. The labels match `main`'s tab bar, where "Backtest" is the `targets`
slug and is an optimizer (see the buy-and-hold entry). `main` also has an unlinked `rebalance` page.
*(Corrected 2026-09-24. This previously said the reference had no backtest.)*

- **The id is in the URL because selection is not durable anywhere else.** `PortfoliosPage` holds
  `selectedId` in React state, which a reload destroys, so `/portfolios/holdings` would have no way to
  know what it was analysing. This is the same reasoning as the 2026-09-13 routing decision — real
  URLs that survive a reload — applied one level down.
- **An unknown id renders a not-found card rather than redirecting.** Portfolios are `localStorage`
  -only, so a link opened in a different browser legitimately misses; a silent bounce to the list
  would read as the app having forgotten the portfolio. The copy says where portfolios live.
- The shell ships with **five deliberately empty pages**. A placeholder that quietly grows a feature
  is worse than an empty one, because the next contract has to argue with it.
- ~~**Routing.**~~ **Decided 2026-09-13: real URLs via `react-router-dom`.** Reverses contract 0002's "no router — there is one page," deliberately rather than by drift. `/universe` is a real address that can be linked, bookmarked, and reloaded; the alternative — the header nav swapping views inside one page with the URL never changing — breaks the browser back button and makes every future page a special case. The cost is one dependency and a route tree, both of which `REBUILD.md` had deferred precisely until a second page existed. It now does. The header nav items stop being inert `<span>`s and become real links when the frontend contract lands; until then they stay as built.

## Explicitly cut from the old app

Prophet forecasting; login/identity system (`X-Actor-Name`); watchlists; alerts; audit log; the full
relational Postgres/Supabase schema and Alembic migrations; server-side multi-user portfolio storage.

**Two corrections, 2026-09-22.** This list had gone stale in a way that made the `Research` / `/ops`
open question look like a contradiction when it was really a bookkeeping failure:

- **`job-run tracking` was removed from the cut list — it was rebuilt.** `models.JobRun` exists,
  `jobrun.record_run` writes one row per sweep that actually ran, and `JobRunsCard` renders the
  history on `/ops`. It was cut under "no auth, no multi-user concerns" (contract-era reasoning about
  *audit*), then reintroduced for a different purpose: knowing whether the scheduled refreshes are
  firing. Same table name, different justification.
- **`decision memos` was removed as a *blanket* cut.** It was listed as a Research feature at a time
  when Research itself was expected to go. Research now survives, so what it contains is an open
  design question rather than a settled cut. Nothing about memos is decided either way.

The general failure worth naming: **a cut list is a claim about the present, not a record of a past
decision.** This one kept asserting that something the app demonstrably does was cut, which is how a
resolved question sat in "Open questions" for nine days looking unresolvable.

### Glossary terms deferred, not cut (contract 0094, 2026-09-22)

The reference's `HelpSidebar` glossary is 24 entries. The rebuild's `/ticker` Help drawer ships 14.
The difference is not a judgement that these terms are bad — it is that **a help panel explaining
controls that are not on screen is worse than a shorter one.** Each returns when its feature lands:

| deferred term | returns with |
|---|---|
| Simulated Analytics | portfolio analytics over held weights |
| Sharpe Ratio, Max Drawdown, Beta / Alpha | the Risk & Perf tab |
| Alert Cooldown | alerting, if it is ever rebuilt (currently cut) |
| Allow Short Positions, Optimize Modes | the optimizer |
| Validation Suite (7 Tests) | the optimizer's validation pass |
| Forecast Methods | the Outlook tab |
| HHI, N_eff, RC, MCTR | portfolio risk decomposition |
| Market Shock / Vol Shock / Historical Replay | the Monitor tab's scenarios |

Copy them from `git show main:frontend/components/HelpSidebar.tsx` when the time comes; several of
the definitions there are good and the numbers in them (a 3.64% risk-free rate, a 0.15/0.25 HHI
banding, ≥ 4/7 to pass validation) are decisions in their own right worth inheriting deliberately
rather than re-deriving.

**One entry is dropped rather than deferred: "Last Trigger Date."** `TickerSignals` carries `ticker`,
`signals`, `atr` and `atr_pct` — there is no trigger date in the API and no plan for one, so that
entry would document a hover that does not exist.

**Three entries have no reference equivalent and are ours**: why a signal cell can be blank (blank is
insufficient history, *not* NEUTRAL — the `state: null` distinction from contract 0088), split
adjustment (prices scaled by `adj_close / close` and volume divided by the same ratio), and where the
data comes from (rewritten for the visit-triggered refresh windows, since the reference's "delayed
15–20 minutes" is not how this app's freshness rule works).

`INDICATOR_GROUPS` and `GLOSSARY` live together in `frontend/src/lib/indicators.ts` so a test can
assert every indicator toggle has exactly one glossary entry, in both directions. A seventh indicator
added without an entry fails the suite instead of silently shipping an incomplete help panel.

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
