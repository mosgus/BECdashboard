# Blue Eagle Capital Portfolio Dashboard

A full-stack portfolio analytics platform built for the Emory Practicum cohort. Manage portfolios, run CAPM/mean-variance optimizations, validate strategies with research-grade statistical tests, and monitor risk — all from a single browser tab.

**Stack:** Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · FastAPI · Python 3.12 · PostgreSQL 16 · Alembic · SQLAlchemy 2 · Recharts · scipy SLSQP

---

## Who this README is for

| You are… | Start here |
|---|---|
| A developer who wants to run it locally | [Quick Start](#quick-start) below |
| A non-technical evaluator setting up from scratch | [SETUP.md](SETUP.md) — full click-by-click guide |
| Looking to understand the architecture | [Architecture](#architecture) |
| Deploying to production | [Deploy](#deploy) |

---

## What it does

Blue Eagle is organized around a 5-tab portfolio workflow plus a separate Research & Validation suite.

### Portfolio workflow (`/portfolios/[id]`)

1. **Holdings** — manage positions (shares, cost basis, cash). Add holdings manually or via CSV import; unknown tickers are auto-backfilled into the universe and enriched via yfinance.
2. **Outlook** — forward-looking expected returns, CAPM β/α, analyst views.
3. **Rebalance** — implied trades from target weights; supports optimizer, tilt, and manual target sources.
4. **Monitor** — live prices, daily/lifetime P&L, per-position signal states (SMA/RSI/MACD/ATR).
5. **Risk & Performance** — concentration (HHI, N_eff), drawdown, factor scenarios, tear sheet.

### Research & Validation suite (`/research`)

- **Overview** — composite score blending statistical validation (Lo 2002 Sharpe t-test, block permutation, bootstrap CI, stationarity, autocorrelation, normality, drawdown significance), concentration, performance, drawdown.
- **Asset research** — per-ticker enrichment, technicals, data quality audit.
- **Universe audit** — grade A/B/C/F for every ticker based on history length, gap rate, volume.
- **Strategy** — walk-forward optimization across multiple modes.
- **Stress / scenarios** — factor replay, historical regime analysis.
- **Decision memo** — capture rationale, red flags, go/no-go decision.

### Cross-cutting

- **Optimization** — Min-Variance, Max-Sharpe (historical), Max-Sharpe CAPM with analyst views + per-asset bounds + reserved cash.
- **Universe management** — CSV import, active/inactive toggle, yfinance metadata enrichment.
- **Watchlists** — signal badges with on-demand refresh.
- **Alerts** — 8 rule types, scope-based (ticker / watchlist / portfolio), cooldown enforcement, events inbox.
- **Identity** — actor-header based (`X-Actor-Name`), no passwords or JWT. Optional `CLASS_WRITE_KEY` gate for public deployments.

---

## Quick Start

Prerequisites: Python 3.12+, Node.js 20+, PostgreSQL 16.

```bash
# 1. Clone
git clone https://github.com/ngrom17/blue-eagle.git
cd blue-eagle

# 2. Database (defaults match .env.example)
createdb blueeagle
psql blueeagle -c "CREATE USER blueeagle WITH PASSWORD 'blueeagle' SUPERUSER;"

# 3. Env files
cp .env.example .env
cp .env.example backend/.env
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > frontend/.env.local

# 4. Backend (one terminal)
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 8000

# 5. Frontend (second terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` and enter your name to begin. API docs are at `http://localhost:8000/docs`.

For a step-by-step guide from zero — including installing every dependency on a fresh Mac or Windows machine — see **[SETUP.md](SETUP.md)**.

---

## Architecture

```
blue-eagle/
├── backend/                        FastAPI · Python 3.12
│   ├── main.py                     app factory, CORS, audit middleware, lifespan
│   ├── config.py                   pydantic-settings (DATABASE_URL required)
│   ├── auth.py                     X-Actor-Name / X-Class-Key dependencies
│   ├── middleware/audit.py         writes every mutation to audit_log
│   ├── db/                         SQLAlchemy engine, Base, models
│   ├── alembic/                    13 migrations (baseline → portfolio_cash)
│   ├── routers/                    portfolio, portfolios_*, research, universe,
│   │                               technicals, ticker, watchlists, optimize, ops
│   ├── core/                       portfolio, indicators, signals, provider (yfinance),
│   │                               cache, risk, stats, walk_forward, price_loader
│   └── tests/                      87 tests (integration + signal unit tests)
└── frontend/                       Next.js 16 · React 19 · TypeScript 5
    ├── app/                        App Router pages (see table below)
    ├── components/                 charts, pickers, badges, tooltips
    ├── hooks/useAuth.ts            redirects to /login if no actor name set
    ├── lib/                        typed API client, utils
    └── types/                      strongly-typed API responses
```

### Top-level pages

| Route | Purpose |
|---|---|
| `/login` | Enter display name (stored in `localStorage`, sent as `X-Actor-Name`) |
| `/portfolios` | List + create portfolios |
| `/portfolios/[id]/holdings` | Positions, CSV import, cash |
| `/portfolios/[id]/outlook` | CAPM views, expected returns |
| `/portfolios/[id]/rebalance` | Implied trades from targets |
| `/portfolios/[id]/monitor` | Live P&L and signals |
| `/portfolios/[id]/risk` | Concentration, drawdown, scenarios |
| `/research` + subpages | Validation, universe audit, strategy, stress, decision memo |
| `/optimize` | Standalone optimizer playground |
| `/technicals` | Ticker OHLCV + signals |
| `/universe` | Universe management (active/inactive, CSV import) |
| `/watchlists` | Watchlist CRUD + signal refresh |
| `/alerts` | Alert rules + events inbox |

---

## Development

### Running tests

```bash
cd backend
source .venv/bin/activate
python -m pytest tests/ -q
# 87 passed
```

### Creating a new migration

```bash
cd backend
source .venv/bin/activate
alembic revision -m "your change description"
# Edit the new file in alembic/versions/
alembic upgrade head
```

### Type-checking the frontend

```bash
cd frontend
npx tsc --noEmit
```

### Hot reload

Both `uvicorn --reload` (backend) and `next dev` (frontend) auto-restart on file changes. Edit and save — the browser will pick it up.

---

## Environment variables

All variables are read from `backend/.env` (backend) and `frontend/.env.local` (frontend at build time).

| Variable | Scope | Required | Default | Description |
|---|---|---|---|---|
| `DATABASE_URL` | backend | ✅ | — | PostgreSQL connection string |
| `NEXT_PUBLIC_API_URL` | frontend | | `http://localhost:8000` | Backend URL baked into JS bundle |
| `CLASS_WRITE_KEY` | backend | | unset | If set, mutations require `X-Class-Key` header |
| `NEXT_PUBLIC_CLASS_WRITE_KEY` | frontend | | unset | Paired with above; sent automatically by API client |
| `CORS_ORIGINS` | backend | | `*` | Comma-separated allowed origins for production |
| `DATA_PROVIDER` | backend | | `yfinance` | Data source (currently only yfinance is implemented) |

`NEXT_PUBLIC_*` vars are read at **build time**, not runtime. Restart `npm run dev` after changing them.

---

## Security model

**Important:** Portfolios are shared across all users of a deployment — there is no per-user isolation. Identity is a display name (`X-Actor-Name` header) used only for audit logging, not access control.

For any deployment reachable beyond `localhost`, you **must** set both:

- Backend: `CLASS_WRITE_KEY=<strong random string>` (env var on the server)
- Frontend: `NEXT_PUBLIC_CLASS_WRITE_KEY=<same value>` (env var at build time)

Without this, anyone who discovers the URL can read, modify, or delete any portfolio, import CSVs, trigger expensive backtests, and run price refreshes. The `/health` endpoint exposes `write_key_set: true|false` so an operator can verify the gate is active.

Also set `CORS_ORIGINS` to your actual frontend URL(s) — the default (`localhost:3000,localhost:3001`) covers local dev only.

---

## Deploy

### Backend → Render

1. Connect GitHub repo, root directory: `backend`
2. Build: `pip install -r requirements.txt && alembic upgrade head`
3. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Env vars: `DATABASE_URL` (attach Render's Postgres), optional `CLASS_WRITE_KEY`, `CORS_ORIGINS=https://your-frontend.vercel.app`

### Frontend → Vercel

1. Connect GitHub repo, root directory: `frontend`
2. Env var: `NEXT_PUBLIC_API_URL=https://your-backend.onrender.com`
3. (If backend `CLASS_WRITE_KEY` is set) `NEXT_PUBLIC_CLASS_WRITE_KEY=<same value>`

Free-tier caveats: Render free web services sleep after 15 min idle — the first request after a quiet period takes ~30 s to wake. Suitable for demos, not production.

---

## Identity & authentication

No passwords, no JWT. Anyone can use the app:

1. Visit `/login`, enter display name → stored in `localStorage`.
2. Every API request sends `X-Actor-Name: <name>` → logged to `audit_log.actor`.
3. For public deployments, set `CLASS_WRITE_KEY` to require an additional `X-Class-Key` header on all POST/PUT/PATCH/DELETE requests. The frontend reads `NEXT_PUBLIC_CLASS_WRITE_KEY` and attaches the header automatically.

---

## Data notes

- Source: Yahoo Finance (`yfinance`), adjusted close prices
- Server-side 1-hour TTL cache to avoid rate-limit hammering
- `price_history` table backfills OHLCV for any ticker seen by the app; falls back to yfinance only on cache miss
- Unknown tickers added to portfolios are auto-created in the universe and enriched with yfinance metadata (name, sector, market cap, P/E, dividend yield, 52-week range)
- Covariance and beta use daily returns × 252 for annualisation

---

## CAPM optimizer

`max_sharpe_capm` mode implements a Black-Litterman-flavoured CAPM:

```
E[R_i] = rf + β_i × MRP + MRP × view_i
```

- **β** — OLS regression vs the market ticker (default `VT`)
- **Views** — analyst conviction that a stock is over/undervalued (additive boost)
- **Per-asset bounds** — min/max weight constraints per ticker
- **Reserved cash** — fraction of portfolio held in cash (excluded from optimization)

---

## LAN / iPad access

Blue Eagle binds the frontend to `0.0.0.0:3000`, so any device on the same Wi-Fi can reach it. Find your machine's IP (`ipconfig getifaddr en0` on Mac, `hostname -I` on Linux/WSL), then set:

```
NEXT_PUBLIC_API_URL=http://<your-machine-ip>:8000
```

Restart the frontend and visit `http://<your-machine-ip>:3000` from your iPad.
