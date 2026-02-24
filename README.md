# Blue Eagle Portfolio Dashboard

Production-grade portfolio analytics web app.

**Stack**: Next.js 16 (App Router, TypeScript, Tailwind v4) + FastAPI (Python 3.11)
**Charts**: Recharts | **Optimizer**: CAPM + Analyst Views (scipy SLSQP)

## Features

| Feature | Details |
|---------|---------|
| **Overview** | Equity curve, rolling vol, drawdown, correlation heatmap, performance table |
| **Optimization** | Min-Variance · Max-Sharpe (historical) · Max-Sharpe CAPM with analyst views + per-asset bounds |
| **Technicals** | SMA(20/50), RSI(14), MACD(12,26,9) for any ticker |
| **Alerts** | SMA crossover, RSI threshold, price threshold — with email stub (SendGrid-ready) |

---

## Quick Start (Local)

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API docs: `http://localhost:8000/docs`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev          # binds to 0.0.0.0:3000 — accessible from iPad on same Wi-Fi
```

App: `http://localhost:3000`
From iPad/phone: `http://<your-mac-ip>:3000`

Get your Mac's IP: `ipconfig getifaddr en0`

---

## iPad / LAN Access

The frontend dev server binds to `0.0.0.0` so any device on the same Wi-Fi network can access it.

1. Run backend: `uvicorn main:app --host 0.0.0.0 --port 8000`
2. Run frontend: `npm run dev` (from `frontend/`)
3. On iPad, open: `http://<mac-local-ip>:3000`

To find your Mac's IP:
```bash
ipconfig getifaddr en0
```

---

## Docker (Production-like)

```bash
docker compose up --build
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`

For LAN access from Docker, update `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://<your-mac-ip>:8000
```

---

## Deploy

### Backend → Render
1. Connect GitHub repo
2. Root directory: `backend`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Python 3.11

### Frontend → Vercel
1. Connect GitHub repo
2. Root directory: `frontend`
3. Environment variable: `NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com`

---

## CAPM Optimizer

The `max_sharpe_capm` mode (★ default) implements the notebook's logic:

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
- Cache: 1-hour TTL server-side cache (no rate limit hammering)
- Optimization uses annualised covariance (daily cov × 252)

---

## 3-Minute Demo Script

1. **Overview** — default tickers (AAPL, MSFT, GOOGL, AMZN, NVDA) + SPY benchmark → Run Analysis
2. Walk equity curve, drawdown, correlation heatmap
3. **Optimization** — mode: "Max Sharpe (CAPM + Views)", set NVDA view = 0.5, click Run → show CAPM table + weight shift
4. **Technicals** — ticker: NVDA, Load Chart → walk SMA crossover + RSI + MACD
5. **Alerts** — NVDA, RSI Overbought/Oversold → Check Alert → Simulate Email Payload

Total: ~3 minutes
