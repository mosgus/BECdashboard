# Blue Eagle Portfolio Dashboard 🦅

Production-grade portfolio analytics web app for the Emory Practicum cohort.

**Stack**: Next.js 16 (App Router, TypeScript, Tailwind v4) + FastAPI (Python 3.11) + PostgreSQL
**Charts**: Recharts | **Optimizer**: CAPM + Analyst Views (scipy SLSQP) | **Identity**: Actor-header (X-Actor-Name)

## Features

| Feature | Details |
|---------|---------|
| **Overview** | Equity curve, rolling vol, drawdown, correlation heatmap, performance table |
| **Optimization** | Min-Variance · Max-Sharpe (historical) · Max-Sharpe CAPM with analyst views + per-asset bounds |
| **Technicals** | SMA(20/50), RSI(14), MACD(12,26,9) for any ticker |
| **Portfolios** | CRUD portfolios; add/remove/edit holdings from Universe; simulated analytics (CAGR, Sharpe, MaxDD, β, α + equity curve vs SPY); per-position signal badges; portfolio-level min-variance / max-Sharpe optimization with implied-trades rebalance plan |
| **Alert Rules** | 8 rule types (SMA/RSI/MACD cross + price threshold); scope to ticker, watchlist, or portfolio; cooldown enforcement; *Evaluate Now* synchronous sweep; events inbox with evidence payload |
| **Alerts** | SMA crossover, RSI threshold, price threshold — with email stub (SendGrid-ready) |
| **Universe** | 15 pre-seeded tickers; CSV import (header or headerless); active/inactive toggle |
| **Watchlists** | Full CRUD watchlists; add/remove tickers; one-click refresh populates SMA/RSI/MACD signal badges |
| **Ticker Detail** | OHLCV bar chart, ATR14, signal panel (no look-ahead), help glossary |
| **Identity** | Display name entered once at `/login`; stored in localStorage; sent as `X-Actor-Name` header on every request; logged to Postgres `audit_log` |

---

## Quick Start (Docker — recommended)

```bash
cp .env.example .env
# Edit .env: set NEXT_PUBLIC_API_URL if not using localhost
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend docs: `http://localhost:8000/docs`

---

## Quick Start (Local Dev)

### 1. Backend

Requires Python 3.11 and a running Postgres instance (easiest: `docker compose up db` for just the DB).

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgresql://blueeagle:blueeagle@localhost:5432/blueeagle

alembic upgrade head          # run migrations
uvicorn main:app --reload --port 8000
```

API docs: `http://localhost:8000/docs`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev          # binds to 0.0.0.0:3000 — accessible from iPad on same Wi-Fi
```

App: `http://localhost:3000` → redirects to `/login`

---

## Authentication / Identity

No passwords, no JWT. Anyone can use the app:

1. Visit `/login`
2. Enter your display name (e.g. "Alice Chen") → stored in `localStorage`
3. Every API request sends `X-Actor-Name: <name>` → logged to `audit_log.actor`

**Optional write-key gate** (for public deployments): set `CLASS_WRITE_KEY` in `.env`. When set, all mutation requests must include a matching `X-Class-Key` header — the frontend reads `NEXT_PUBLIC_CLASS_WRITE_KEY` and adds it automatically.

---

## iPad / LAN Access

Set `NEXT_PUBLIC_API_URL` in `.env` to your machine's IP (or Tailscale address) before building:

```
NEXT_PUBLIC_API_URL=http://100.108.230.75:8000
```

Then rebuild the frontend image and restart. The value is baked into the JS bundle at build time.

---

## Architecture

```
blue-eagle/
├── backend/
│   ├── main.py              # FastAPI app factory, CORS, AuditMiddleware, lifespan
│   ├── config.py            # pydantic-settings (CLASS_WRITE_KEY optional, DATABASE_URL required)
│   ├── auth.py              # get_actor_name(), require_write_key() dependency
│   ├── middleware/audit.py  # AuditMiddleware — writes every POST/PUT/PATCH/DELETE to DB
│   ├── db/                  # SQLAlchemy engine, Base, models (all Sprint 2+3 tables)
│   ├── alembic/             # 0001_baseline (audit_log, universe), 0002_sprint2_schema (7 tables)
│   ├── routers/             # portfolio, portfolios, optimize, technicals, alerts, alert_rules,
│   │                        #   universe, watchlists, ticker
│   ├── core/                # portfolio, indicators, cache (TTLCache), signals, provider (YFinance)
│   └── tests/               # test_signals.py (34 tests), test_universe_import.py
└── frontend/
    ├── app/                 # Next.js App Router pages: overview, optimize, technicals, alerts,
    │                        #   universe, watchlists/[id], ticker/[symbol], login
    ├── components/          # Charts, AuthNav, Providers, SignalBadge, InfoTooltip, HelpSidebar
    ├── types/               # sprint2.ts (Sprint 2), sprint3.ts (portfolios, alert rules, events)
    ├── hooks/useAuth.ts     # Auth guard — redirects to /login if no actor name set
    └── lib/                 # api.ts (typed fetch), auth.ts (actor helpers), utils.ts
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `NEXT_PUBLIC_API_URL` | | `http://localhost:8000` | Backend URL baked into JS bundle |
| `CLASS_WRITE_KEY` | | unset | If set, mutations require matching `X-Class-Key` header |
| `NEXT_PUBLIC_CLASS_WRITE_KEY` | | unset | Frontend counterpart — sent as `X-Class-Key` header |
| `CORS_ORIGINS` | | `*` | Comma-separated allowed origins (production) |
| `DATA_PROVIDER` | | `yfinance` | Data source stub |

---

## Deploy

### Backend → Render
1. Connect GitHub repo, root directory: `backend`
2. Build command: `pip install -r requirements.txt && alembic upgrade head`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add env vars: `DATABASE_URL` (from Render's Postgres addon)

### Frontend → Vercel
1. Connect GitHub repo, root directory: `frontend`
2. Environment variable: `NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com`

### Or: Single Docker Compose on Railway / Fly.io

---

## CAPM Optimizer

The `max_sharpe_capm` mode (★ default) implements Black-Litterman-flavoured CAPM:

```
E[R_i] = rf + β_i × MRP + MRP × view_i
```

- **β** calculated via OLS regression vs the market ticker (default: `VT`)
- **Views** = analyst conviction that a stock is undervalued (additive boost)
- **Per-asset bounds** = min/max weight constraints per ticker
- **Reserved cash** = fraction of portfolio held in cash (excluded from optimization)

---

## Data Notes

- Source: Yahoo Finance (`yfinance`), adjusted close prices
- Cache: 1-hour TTL server-side cache (no rate-limit hammering)
- Optimization uses annualised covariance (daily cov × 252)

---

## Sprint 2 Verification

```bash
# All 34 unit tests pass
docker exec blue-eagle-backend-1 python -m pytest tests/ -v

# Universe endpoint (15 seeded tickers)
curl http://localhost:8000/api/universe | python3 -m json.tool

# Create watchlist
curl -X POST http://localhost:8000/api/watchlists \
  -H "Content-Type: application/json" -H "X-Actor-Name: demo" \
  -d '{"name": "Tech Picks"}'

# Ticker technicals + signals (no look-ahead)
curl "http://localhost:8000/api/ticker/AAPL/technicals?signals=1" \
  -H "X-Actor-Name: demo"

# Sprint 2 tables in DB
docker exec blue-eagle-db-1 psql -U blueeagle -c \
  "\dt" | grep -E "universe_tickers|watchlists|portfolios|alerts|positions"

# Actor captured in audit_log
docker exec blue-eagle-db-1 psql -U blueeagle -c \
  "SELECT actor, method, path FROM audit_log ORDER BY ts DESC LIMIT 5;"
```

---

## Sprint 3 Verification

```bash
# API version
curl http://localhost:8000/health
# → {"status":"ok","db":"ok","version":"3.0.0"}

# Create portfolio
curl -X POST http://localhost:8000/api/portfolios \
  -H "Content-Type: application/json" -H "X-Actor-Name: demo" \
  -d '{"name": "Core Holdings"}'

# Add holdings (must be active universe tickers)
PORT_ID=<id from above>
curl -X POST "http://localhost:8000/api/portfolios/$PORT_ID/positions" \
  -H "Content-Type: application/json" -H "X-Actor-Name: demo" \
  -d '{"ticker": "AAPL", "weight": 0.4}'

# Portfolio analytics (simulated — current weights held constant)
curl "http://localhost:8000/api/portfolios/$PORT_ID/analytics"
# → {simulated: true, metrics: {cagr, sharpe, max_dd, beta, alpha}, equity_curves, signals_by_ticker}

# Portfolio optimization
curl -X POST "http://localhost:8000/api/portfolios/$PORT_ID/optimize" \
  -H "Content-Type: application/json" -H "X-Actor-Name: demo" \
  -d '{"mode": "max_sharpe", "max_weight": 0.6}'
# → {target_weights, implied_trades, metrics: {current, optimized}, equity_curves}

# Create alert rule (default params auto-populated)
curl -X POST http://localhost:8000/api/alert_rules \
  -H "Content-Type: application/json" -H "X-Actor-Name: demo" \
  -d '{"scope": "ticker", "ticker": "AAPL", "rule_type": "sma_cross_up", "cooldown_days": 3}'

# Evaluate all enabled rules synchronously
curl -X POST http://localhost:8000/api/alert_rules/evaluate_now -H "X-Actor-Name: demo"
# → {evaluated: N, triggered: N, skipped: N, asof_date, events}

# Events inbox
curl http://localhost:8000/api/alert_rules/events
```

---

## 5-Minute Demo Script

1. **Login** — enter your name → lands on Overview
2. **Overview** — default tickers (AAPL, MSFT, GOOGL, AMZN, NVDA) + SPY → Run Analysis → equity curve + drawdown
3. **Universe** — 15 seeded tickers; toggle TSLA inactive to see it blocked in Portfolios
4. **Portfolios** — Create "Core Holdings" → add AAPL 40%, MSFT 35%, NVDA 25%
   - **Holdings tab** → click AAPL row ▶ to expand Quick Technicals (SMA/RSI/MACD badges + ATR14)
   - **Analytics tab** → equity curve vs SPY + per-holding exit signals
   - **Optimize tab** → Max Sharpe, max weight 60% → Run → see Sharpe jump + rebalance plan
5. **Alert Rules** — create SMA Cross Up on AAPL, cooldown 3 days → **Evaluate Now** → check Inbox tab
6. **Watchlists** — Create "Tech Picks" → add tickers → Refresh → signal badges appear
7. **Technicals** — look up any ticker → OHLCV bars + signals
8. **Optimization** — Max Sharpe CAPM, analyst view NVDA = 0.5 → Run

Total: ~7 minutes
