# Blue Eagle — Pre-Sprint Codebase Audit

> Generated: 2026-02-24
> Purpose: Full inventory of the prototype before the 4-sprint production build.

---

## A) What Exists Now

### 1. Repo Inventory

**Full tree** (excluding node_modules / .next / .venv / __pycache__ / .git):

```
blue-eagle/
├── backend/
│   ├── core/
│   │   ├── cache.py           ← TTLCache(128, 1h) wrapping yf.download
│   │   ├── indicators.py      ← SMA, RSI (EWM Wilder), MACD, 3 alert checks
│   │   └── portfolio.py       ← returns/metrics/equity curve + 3 SLSQP optimizers
│   ├── routers/
│   │   ├── alerts.py          ← POST /api/alerts/check (stateless eval, no persistence)
│   │   ├── optimize.py        ← POST /api/optimize (3 modes, manual tickers/weights)
│   │   ├── portfolio.py       ← POST /api/portfolio/metrics (stateless)
│   │   └── technicals.py      ← POST /api/technicals
│   ├── main.py                ← FastAPI app, 4 routers, CORS *, /health
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── alerts/page.tsx
│   │   ├── optimize/page.tsx
│   │   ├── technicals/page.tsx
│   │   ├── layout.tsx         ← nav bar, no auth guard
│   │   ├── page.tsx           ← overview (tickers + metrics + charts)
│   │   └── globals.css
│   ├── components/            ← 8 components: MetricsBar, EquityCurve, DrawdownChart,
│   │                             CorrelationHeatmap, PerformanceTable, WeightBarChart,
│   │                             TechnicalsChart, AlertPanel
│   ├── lib/
│   │   ├── api.ts             ← 4 typed fetch wrappers (uses native fetch, not axios)
│   │   └── utils.ts           ← fmtPct, fmtNum, apiPost, downsample
│   ├── types/portfolio.ts     ← all request/response TS interfaces
│   ├── .env.local             ← NEXT_PUBLIC_API_URL=http://100.108.230.75:8000
│   ├── next.config.ts         ← output: "standalone"
│   ├── tsconfig.json          ← strict: true
│   ├── package.json
│   └── Dockerfile             ← 3-stage: deps → builder → runner
├── docker-compose.yml         ← backend:8000 + frontend:3000 (NO postgres)
├── .gitignore
└── README.md
```

**What runs end-to-end today (exact commands):**

```bash
# Backend (currently live)
cd ~/blue-eagle/backend
.venv/bin/python3.11 -c "import uvicorn; uvicorn.run('main:app', host='0.0.0.0', port=8000)"

# Frontend (currently live)
cd ~/blue-eagle/frontend
npm run dev        # binds to 0.0.0.0:3000

# Docker (builds and runs without postgres)
docker-compose up
```

All 4 API endpoints work end-to-end: portfolio metrics, 3-mode optimizer, technicals, alert check.

**Real vs Stubbed:**

| Component | Status | Notes |
|-----------|--------|-------|
| Portfolio analytics (metrics, equity curve, drawdown, rolling vol, correlation) | ✅ Real | Solid math |
| 3-mode optimizer (min_var, max_sharpe, CAPM+views) | ✅ Real | scipy SLSQP |
| Technicals (SMA, RSI Wilder EWM, MACD) | ✅ Real | No look-ahead bias |
| Alert condition check (SMA crossover, RSI, price) | ✅ Real logic | Stateless only — no persistence |
| Email alert delivery | 🟡 Stub | Returns dict, nothing sent |
| Auth / login | ❌ Missing | Zero auth |
| Database / persistence | ❌ Missing | No DB anywhere |
| Nightly scheduler | ❌ Missing | APScheduler not installed |
| Price cache (persistent) | ❌ Missing | In-RAM TTLCache only, lost on restart |
| Audit logging | ❌ Missing | Nothing logged |

---

### 2. Architecture Decisions Already Made

**Frontend:**
- Next.js 16 App Router + TypeScript (`strict: true`) + Tailwind v4 (CSS-first, no `tailwind.config.ts`)
- Routing: file-based App Router. 4 routes: `/`, `/optimize`, `/technicals`, `/alerts`
- Data fetching: manual `useState` + native `fetch` via `apiPost()`. **`@tanstack/react-query` is installed but zero usage.** **`axios` is installed but zero usage.**
- Charts: Recharts 3.x (BarChart, LineChart, AreaChart, ComposedChart, custom SVG heatmap)

**Backend:**
- FastAPI + Pydantic v2 + uvicorn
- Structure: flat `core/` (business logic) + `routers/` (HTTP layer). Clean separation.
- CORS: `allow_origins=["*"]`, `allow_methods=["*"]`, `allow_headers=["*"]` — hardcoded, no config module
- No `config.py`, no pydantic-settings, no env var loading at all
- No middleware of any kind (no auth, no audit, no rate limiting)
- No lifespan hooks (no startup/shutdown events)

**Auth:** None. Every endpoint is public.

**DB:** None. No SQLAlchemy, no Alembic, no postgres in docker-compose.

**Data access layer:** `yf.download()` → thread-safe `TTLCache(maxsize=128, ttl=3600)` in process RAM. Cache key = sorted tickers + date range. Lost on every restart.

---

### 3. Data Model + API Contract

**DB schema:** None exists.

**Missing entities vs roadmap:**

| Entity | Status |
|--------|--------|
| `universe` | ❌ Missing |
| `watchlists` | ❌ Missing |
| `portfolio_holdings` | ❌ Missing |
| `alert_rules` | ❌ Missing |
| `alerts_inbox` | ❌ Missing |
| `audit_log` | ❌ Missing |
| `price_cache` (DB table) | ❌ Missing (only in-RAM TTLCache) |
| `scheduler_runs` / `job_runs` | ❌ Missing |
| `users` / sessions | ❌ Missing |
| `optimization_runs` | ❌ Missing |

**All current API routes:**

```
GET  /health                     → {"status":"ok"}
POST /api/portfolio/metrics      → full analytics (stateless, params in request body)
POST /api/optimize               → 3-mode optimizer (stateless)
POST /api/technicals             → SMA/RSI/MACD (stateless)
POST /api/alerts/check           → evaluate 1 alert condition right now (stateless)
```

Everything is request-scoped and stateless. Zero DB reads or writes.

---

### 4. Quality / Ops

**Tests:** Zero. No test files anywhere — backend or frontend.

**Lint / typecheck:**
- `tsc --noEmit` ✅ passes
- ESLint configured via `eslint.config.mjs` with `eslint-config-next`
- Python: no ruff, no flake8, no mypy configured

**Env vars:**
- Backend: no `.env`, no `config.py`, no env var handling. CORS hardcoded.
- Frontend: `.env.local` with Tailscale IP. No `.env.example`.
- No `docker.env` or `docker.env.example` for compose.

**Docker:**
- Backend `Dockerfile`: `python:3.11-slim`, single stage, no health CMD in image
- Frontend `Dockerfile`: proper 3-stage multi-stage build, uses `standalone` output ✅
- `docker-compose.yml`: backend + frontend only. **No postgres.** No named volumes. No migrations-on-boot.
  - Backend healthcheck via `curl /health` ✅
  - Frontend `depends_on: backend: condition: service_healthy` ✅
- **Bug**: `NEXT_PUBLIC_API_URL=http://backend:8000` in docker-compose.yml is silently ignored at runtime — Next.js bakes `NEXT_PUBLIC_*` vars into the JS bundle at `npm run build` time. The compose env var has no effect.

---

## B) Critical Issues / Rework Risks

Ranked by blast radius:

### 1. `NEXT_PUBLIC_API_URL` bake-time bug in Docker — `BLOCKER`

`NEXT_PUBLIC_*` vars are embedded at `next build` time, not at container startup. Setting them in `docker-compose.yml` environment does nothing for the already-built image. The frontend Docker container falls back to `http://localhost:8000` (the fallback hardcoded in `utils.ts`), which doesn't exist inside the container.

**Fix:** Pass as `ARG NEXT_PUBLIC_API_URL` in the frontend `Dockerfile` builder stage so it gets baked in at image build time.

---

### 2. No auth = no audit actor = no audit log — `Sprint 1 foundation`

Every downstream feature requires an actor identity:
- `audit_log.actor`
- `universe.added_by`
- `portfolio_holdings.added_by`
- `alert_rules.created_by`

JWT + display_name must be Sprint 1 item #1 or nothing else in the DB layer builds correctly.

---

### 3. `@tanstack/react-query` installed but unused — `Decision needed before Sprint 2`

All 4 pages use raw `useState` + manual fetch. If we adopt React Query for caching/loading/invalidation in Sprint 2+, every page needs refactoring. If we don't, it's dead weight.

**Recommend:** Commit to React Query now (it's installed, it fits the fetch pattern perfectly) and migrate the 4 existing pages as part of Sprint 1 cleanup so Sprint 2+ pages use `useQuery`/`useMutation` consistently from day one.

---

### 4. `axios` installed but never used — `Minor`

`apiPost()` uses native fetch. Axios adds ~14KB to the bundle for nothing. Remove it.

---

### 5. In-memory TTLCache lost on restart — `Sprint 1/2 design impact`

The nightly price refresh job must write to a `price_cache` DB table, not just the in-process cache. All analytics in Sprint 2+ should read from the DB table, not trigger fresh yfinance calls on every request. The current cache layer is a prototype convenience that becomes a liability once persistence is added.

---

### 6. Tailwind v4 design token approach — `Sprint 1 complexity`

Tailwind v4 is CSS-first — there is no `tailwind.config.ts` by default. The design token system using CSS custom properties (`--color-primary: ...`) needs to live in `globals.css` inside a `@theme` block (v4 syntax), not via `extend.colors` in a JS config. This is doable but different from v3 patterns. The approach must be verified before building all Sprint 1 components on top of it.

---

### 7. No `.env.example` — `Sprint 1 docs gap`

Without this file, the next cohort cannot know what env vars are needed. Blocks the "clone → `docker-compose up` in 5 minutes" promise.

---

### 8. `core/portfolio.py` will become unwieldy — `Manageable`

At 236 lines it handles returns + metrics + CAPM helpers + 3 optimizers. Will grow as Sprint 3 adds portfolio-from-DB logic. Suggest splitting to `core/analytics.py` + `core/optimizer.py` in Sprint 1 refactor to keep files navigable.

---

## C) Recommended Next Steps (Ordered)

### Sprint 1 Punch List — Foundation

```
 1. Fix NEXT_PUBLIC_API_URL Docker bake-time bug
    → Add ARG NEXT_PUBLIC_API_URL to frontend/Dockerfile builder stage

 2. Add config.py (pydantic-settings)
    → CLASS_PASSWORD, JWT_SECRET, DATABASE_URL, DATA_PROVIDER, CORS_ORIGINS
    → Create .env.example with all keys and placeholder values

 3. Add JWT auth
    → pip: python-jose[cryptography] passlib[bcrypt]
    → POST /api/auth/login {password, display_name} → JWT (HS256, 8h)
    → JWTMiddleware: verify Bearer on all POST/PUT/DELETE
    → Frontend: /login page, useAuth() hook, token in localStorage,
      redirect guard in layout.tsx

 4. Add AuditMiddleware
    → Starlette BaseHTTPMiddleware: intercept POST/PUT/DELETE
    → Write (actor, method, path, body_hash, status_code, latency_ms, timestamp)
      to audit_log table
    → actor = JWT sub claim (display_name)

 5. Add Postgres + SQLAlchemy + Alembic
    → pip: sqlalchemy[asyncio] asyncpg alembic
    → docker-compose.yml: add postgres:16-alpine service with named volume pgdata
    → db/models.py: audit_log, universe, price_cache, scheduler_runs (Sprint 1 scope)
    → alembic/versions/0001_baseline.py

 6. Add universe router
    → GET /api/universe, POST /api/universe, DELETE /api/universe/{ticker}
    → Seed ~20 tickers on first migration

 7. Add provider adapter
    → providers/base.py (DataProvider ABC)
    → providers/yfinance_provider.py (wraps current cache.py + writes to price_cache)
    → providers/bloomberg_provider.py (NotImplementedError stub)

 8. Add APScheduler + nightly_price_refresh job (22:00 ET)
    → pip: apscheduler
    → Reads universe table, calls YFinanceProvider, writes OHLCV to price_cache
    → Writes success/failure row to scheduler_runs

 9. Design token system
    → frontend/styles/tokens.css: --color-primary, --color-accent, --color-bg,
      --color-surface, --font-heading, --font-body, --radius-card, --radius-btn
    → Import in globals.css via @theme block (Tailwind v4 syntax)
    → Replace all hardcoded hex values in 8 components with token references

10. Commit to React Query
    → Migrate 4 existing pages from useState/fetch to useQuery/useMutation
    → Add QueryClientProvider to layout.tsx
    → Consistent pattern for all Sprint 2+ pages from day one

11. Remove axios (dead dependency, ~14KB bundle cost)
12. Add .env.example
13. Split core/portfolio.py → core/analytics.py + core/optimizer.py
```

---

### Sprint 2 Additions — Universe + Watchlists + Signals

```
- db/models.py: watchlists table (migration 0002)
- GET/POST/DELETE /api/watchlist
- POST /api/watchlist/{ticker}/promote  ← pre-fills entry_price from price_cache
- Frontend: universe page, watchlist page
- Nightly signal scan: RSI + SMA crossover for all watchlist tickers → signals table
```

---

### Sprint 3 Additions — Portfolio + Optimization

```
- db/models.py: portfolio_holdings, optimization_runs (migration 0003)
- Portfolio CRUD + metrics computed from price_cache (not live yfinance)
- /api/optimize: auto-derive weights from portfolio_holdings
- Optimization run saved to optimization_runs with actor + timestamps
```

---

### Sprint 4 Additions — Alerts + Ops + Deploy

```
- db/models.py: alert_rules, alerts_inbox (migration 0004)
- nightly_alert_eval job (22:30 ET, deduped by rule_id + date)
- GET /api/alerts/inbox, unread badge in nav
- Admin audit log page (/admin)
- docker-compose.prod.yml, fly.toml, GitHub Actions CI
- Rate limiting (slowapi on /api/auth/login)
- Error boundaries + loading skeletons (all pages)
- RUNBOOK.md, ARCHITECTURE.md, BRANDING.md
```

---

## Summary

The analytics core — portfolio math, CAPM optimizer, technicals, alert condition checks — is production-quality and carries forward untouched. The entire infrastructure layer (auth, DB, persistence, scheduler, config, design tokens) is a greenfield add. Sprint 1 is the heaviest sprint by file count (~15 new files) but none of it conflicts with existing code.

**Start with Sprint 1 items 1–5 in order.** Everything else unblocks once auth + DB are in place.
