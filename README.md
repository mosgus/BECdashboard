# Blue Eagle Portfolio Dashboard

Production-grade portfolio analytics web app for the Emory Practicum cohort.

**Stack**: Next.js 16 (App Router, TypeScript, Tailwind v4) + FastAPI (Python 3.11) + PostgreSQL
**Charts**: Recharts | **Optimizer**: CAPM + Analyst Views (scipy SLSQP) | **Auth**: JWT (HS256)

## Features

| Feature | Details |
|---------|---------|
| **Overview** | Equity curve, rolling vol, drawdown, correlation heatmap, performance table |
| **Optimization** | Min-Variance · Max-Sharpe (historical) · Max-Sharpe CAPM with analyst views + per-asset bounds |
| **Technicals** | SMA(20/50), RSI(14), MACD(12,26,9) for any ticker |
| **Alerts** | SMA crossover, RSI threshold, price threshold — with email stub (SendGrid-ready) |
| **Auth** | Class-wide shared password → 8-hour JWT; all API calls audited to Postgres |

---

## Quick Start (Docker — recommended)

```bash
cp .env.example .env
# Edit .env: set CLASS_PASSWORD and JWT_SECRET
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend docs: `http://localhost:8000/docs`

Generate a strong JWT secret:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## Quick Start (Local Dev)

### 1. Backend

Requires Python 3.11 and a running Postgres instance (or skip Postgres — SQLite fallback not included; easiest is `docker compose up db` for just the DB).

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Set env vars (or create a .env in backend/ — pydantic-settings reads it)
export CLASS_PASSWORD=yourpassword
export JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
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

## Authentication

All pages require a JWT. Login at `/login` with the class password (`CLASS_PASSWORD` from `.env`).
Enter any display name — it's used for audit logging, not identity verification.
Tokens expire after 8 hours (configurable via `JWT_EXPIRY_HOURS`).

---

## iPad / LAN Access

The frontend dev server binds to `0.0.0.0` so any device on the same Wi-Fi network can access it.

1. Run backend + frontend as above
2. On iPad, open: `http://<mac-local-ip>:3000`

Find your Mac's IP: `ipconfig getifaddr en0`

---

## Architecture

```
blue-eagle/
├── backend/
│   ├── main.py              # FastAPI app factory, CORS, AuditMiddleware, lifespan
│   ├── config.py            # pydantic-settings (CLASS_PASSWORD, JWT_SECRET, DATABASE_URL)
│   ├── auth.py              # JWT create/decode, get_current_actor dependency
│   ├── middleware/audit.py  # AuditMiddleware — writes every POST/PUT/PATCH/DELETE to DB
│   ├── db/                  # SQLAlchemy engine, Base, models (AuditLog, Universe)
│   ├── alembic/             # Migrations (0001_baseline creates audit_log + universe)
│   ├── routers/             # auth, portfolio, optimize, technicals, alerts
│   └── core/                # portfolio analytics, indicators, cache (TTLCache)
└── frontend/
    ├── app/                 # Next.js App Router pages + layout
    ├── components/          # Charts, AuthNav, Providers
    ├── hooks/useAuth.ts     # Auth guard — redirects to /login if no valid token
    └── lib/                 # api.ts (typed fetch), auth.ts (token helpers), utils.ts
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLASS_PASSWORD` | ✅ | — | Shared class login password |
| `JWT_SECRET` | ✅ | — | HS256 signing secret (min 32 chars) |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_EXPIRY_HOURS` | | `8` | Token lifetime |
| `NEXT_PUBLIC_API_URL` | | `http://localhost:8000` | Backend URL baked into JS bundle |
| `CORS_ORIGINS` | | `*` | Comma-separated allowed origins (production) |
| `DATA_PROVIDER` | | `yfinance` | Data source stub |

---

## Deploy

### Backend → Render
1. Connect GitHub repo, root directory: `backend`
2. Build command: `pip install -r requirements.txt && alembic upgrade head`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add env vars: `CLASS_PASSWORD`, `JWT_SECRET`, `DATABASE_URL` (from Render's Postgres addon)

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

## 3-Minute Demo Script

1. **Login** — enter any display name + class password → 8h token issued
2. **Overview** — default tickers (AAPL, MSFT, GOOGL, AMZN, NVDA) + SPY benchmark → Run Analysis
3. Walk equity curve, drawdown, correlation heatmap
4. **Optimization** — mode: "Max Sharpe (CAPM + Views)", set NVDA view = 0.5, click Run → show CAPM table + weight shift
5. **Technicals** — ticker: NVDA, Load Chart → walk SMA crossover + RSI + MACD
6. **Alerts** — NVDA, RSI Overbought/Oversold → Check Alert → Simulate Email Payload

Total: ~3 minutes
