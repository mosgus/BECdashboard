# Blue Eagle Capital — Session Context Dump

## Project Overview

Blue Eagle Capital is a **portfolio analytics web app** for the Emory FIN673 Practicum cohort.

**Stack**: Next.js 16 (React 19, TypeScript, Tailwind v4) + FastAPI (Python 3.11) + PostgreSQL 16
**Repo**: `git@github.com:ngrom17/blue-eagle.git`
**Working branch**: `de-docked-db` (PostgreSQL-based; teammate has a separate `de-docked` branch using CSV storage)
**Working directory**: `/home/ngrom/emoryCourseWork/FIN673/BLUE-EAGLE`

## Architecture

- **No Docker** — runs locally via `uvicorn` + `npm run dev` + local PostgreSQL
- **Backend**: `/backend/` — FastAPI with SQLAlchemy ORM, Alembic migrations (8 migrations), 10 router modules, `core/` business logic
- **Frontend**: `/frontend/` — Next.js App Router, React Query (TanStack v5), Recharts, Tailwind v4 CSS-first
- **Database**: PostgreSQL 16 at `postgresql://blueeagle:blueeagle@localhost:5432/blueeagle`
- **Frontend env**: `frontend/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:8001`

## How to Start

```bash
# PostgreSQL (if not running)
sudo service postgresql start

# Backend (port 8001)
cd backend && source .venv/bin/activate && uvicorn main:app --reload --port 8001

# Frontend (port 3000) — separate terminal
cd frontend && npm run dev
```

## Tab Structure (Portfolio Detail: `/portfolios/[id]/`)

| Tab | Slug (URL) | Purpose |
|-----|-----------|---------|
| **Holdings** | `holdings` | Add/edit positions (shares, cost basis), CSV import with auto universe backfill, portfolio value display |
| **Historical** | `targets` | Backward-looking optimization (8 modes: equal weight, min variance, max sharpe, risk parity, max sortino, min cvar, max diversification, target volatility). Full action table with shares/$/%/color-coded BUY/SELL. Apply to Portfolio button (green, top). |
| **Outlook** | `outlook` | Forward-looking analysis with 3 subtabs: |
| | | — **CAPM Optimizer**: per-ticker freeze/view controls, action table, VaR (5 horizons), CAL chart, Apply to Portfolio button |
| | | — **Monte Carlo**: GBM simulation, fan chart (percentile bands), terminal stats, Brier scoring (hold-out calibration), efficient frontier with 500-point random portfolio cloud + highlighted Max Sharpe/Min Var/Risk Parity/Current Portfolio |
| | | — **Forecast**: EWMA, ARIMA, Prophet, Ensemble (moved from Research tab) |
| **Monitor** | `monitor` | Candidates watchlist + Technicals Drilldown with indicator configs |
| **Risk & Perf** | `risk` | Performance (Portfolio vs Benchmark comparison table + equity curve + exit signals), Health (HHI, N_eff, risk contributions + mitigation recommendations panel), Scenarios (market shock, vol shock, historical replay + playbook) |
| **Research** | `research` | Validation suite only (7 statistical tests) |

**Removed**: Rebalance tab (functionality absorbed into Historical and Outlook action tables), Conviction Tilts (removed from Historical), max_sharpe_capm mode (moved to Outlook CAPM Optimizer)

## Key Backend Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/portfolios/{id}/optimize` | Historical optimization (8 modes) |
| `POST /api/portfolios/{id}/capm_optimize` | CAPM optimization with freeze/view/action table/VaR/CAL |
| `POST /api/portfolios/{id}/monte_carlo` | GBM simulation + Brier scoring |
| `POST /api/portfolios/{id}/efficient_frontier` | Mean-variance frontier + random cloud + key portfolio points |
| `POST /api/portfolios/{id}/forecast` | EWMA/ARIMA/Prophet/Ensemble forecasting |
| `POST /api/portfolios/{id}/import_csv` | CSV import with auto universe backfill + notional recompute |
| `GET /api/portfolios/{id}/analytics` | Historical performance metrics + bench_metrics + equity curves |
| `GET /api/portfolios/{id}/health` | Concentration, risk contributions, beta, vol |
| `POST /api/portfolios/{id}/scenarios/run` | Stress testing (3 scenario types) |
| `PATCH /api/portfolios/{id}/targets` | Save target weights to last_target_set (used by Apply buttons) |

## Key Files

**Backend**:
- `backend/routers/portfolios.py` — Main router (~2100 lines), all portfolio endpoints
- `backend/core/portfolio.py` — Optimization math (betas, CAPM, 9 optimizer modes)
- `backend/core/forecast.py` — EWMA/ARIMA/Prophet forecasting
- `backend/core/risk.py` — Health metrics, risk contributions
- `backend/core/cache.py` — TTLCache + yfinance price fetching
- `backend/config.py` — Pydantic settings (no DATABASE_URL — using .env)
- `backend/db/models.py` — SQLAlchemy models (15 tables)

**Frontend**:
- `frontend/app/portfolios/[id]/layout.tsx` — Tab bar definition
- `frontend/app/portfolios/[id]/outlook/page.tsx` — Outlook tab (CAPM + MC + Forecast, ~700 lines)
- `frontend/app/portfolios/[id]/targets/page.tsx` — Historical tab (~750 lines)
- `frontend/app/portfolios/[id]/risk/page.tsx` — Risk & Perf tab (~850 lines)
- `frontend/lib/api.ts` — All typed API functions
- `frontend/lib/utils.ts` — apiGet/apiPost/apiPatch/apiPut/apiDelete + formatters
- `frontend/types/outlook.ts` — CAPM, MC, frontier TypeScript types
- `frontend/types/sprint3.ts` — Core portfolio types (Position, PortfolioDetail, etc.)
- `frontend/components/MonteCarloGuide.tsx` — MC guide slide-over panel
- `frontend/components/InfoTooltip.tsx` — Uses `<span>` (not `<button>`) to avoid hydration errors

## Database

- 15 tables across 8 Alembic migrations (auto-run on startup via `Base.metadata.create_all`)
- Key tables: `portfolios`, `positions`, `universe_tickers`, `watchlists`, `alerts`, `alert_events`, `job_runs`, `email_config`, `audit_log`
- `positions` has: `ticker`, `weight` (%), `shares`, `cost_basis`, `updated_at`
- `portfolios` has: `notional_value` (auto-computed from shares × price), `last_target_set` (JSON blob for saved optimizer weights)

## Recent Fixes Applied

1. **CSV import recompute** — `_recompute_portfolio_from_shares()` now called after CSV import so notional_value is populated
2. **InfoTooltip hydration** — Changed inner `<button>` to `<span>` to avoid nested-button HTML error
3. **Efficient frontier** — Extracted computation to `_compute_frontier_data()` helper to avoid lambda closure issues in FastAPI thread context
4. **Frozen tickers** — CAPM action table shows frozen tickers with 0 action and "FROZEN" label; optimizer respects freeze by setting min=max=current_weight

## Git State

- Branch: `de-docked-db`
- Last commit: `199e552` — all changes from this session
- Remote push pending (SSH agent issue — push manually: `git push -u origin de-docked-db`)
- Teammate's `de-docked` branch has a different architecture (CSV-based, no PostgreSQL) — do not merge

## Team Context

- User: ngrom (Emory FIN673 student)
- Teammate pushed a CSV-based rewrite to `de-docked` — user wants to demonstrate the PostgreSQL version works better
- The notebook-based CAPM optimizer was a teammate's contribution that needed to be replicated in the web app (done — Outlook tab)
- `sample_portfolio.csv` in repo root: 20-asset $1M portfolio with real tickers for testing

## What's NOT Done / Potential Next Work

- Random Forest prediction (mentioned in original plan but not yet implemented)
- Git push to remote (SSH agent not available in Claude Code's shell — user must push from their terminal)
- The `de-docked` (CSV) vs `de-docked-db` (PostgreSQL) architecture decision needs team alignment
- Performance tab could still use drawdown chart and rolling Sharpe chart (planned but deferred)
- OptimizerGuide still lists "Max Sharpe — CAPM" mode which was removed from Historical tab
