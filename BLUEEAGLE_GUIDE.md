# Blue Eagle Investment Fund Platform Guide

A comprehensive reference for the Emory Master of Finance cohort managing the Blue Eagle Investment Fund.

---

## 1. About This Platform

**Blue Eagle** is an institutional-grade portfolio analytics platform built for the Emory investment fund. It lets you:

- **Build portfolios** — create named portfolios, add positions, import from Bloomberg
- **Optimize** — run eight quantitative optimization strategies (min variance, max Sharpe, risk parity, etc.)
- **Analyze forward-looking risk** — CAPM optimizer, Monte Carlo simulations, price forecasts
- **Monitor holdings** — watch candidate stocks, track technical signals, drill into individual tickers
- **Measure risk** — concentration metrics, factor exposure (Fama-French), stress scenarios
- **Research & decide** — formal decision memos, statistical validation, PDF tearsheets for committee

The platform is built for a single workflow: Universe → Holdings → Backtest → Outlook → Monitor → Risk & Performance.

---

## 2. Getting Started

### Accessing the Platform
1. Navigate to the Blue Eagle URL (provided by your administrator)
2. Enter your display name and the access password
3. You'll land on the **Home** page, which shows the five-tab workflow and quick-analysis tools

### The Global Navigation
Every page has a persistent top bar with:
- **Logo** — click to return Home
- **Health indicator** (small dot) — green = system healthy, amber = stale data, red = failed data refresh
- **Navigation links** — Securities (Universe), Portfolios, Research
- **Gear icon** — Operations page (data refresh, system health)
- **Your name** — shows your login; click to change

### One-Time Setup
- **Populate Universe** — add tickers you want to research. Go to **Securities** tab.
  - Manual: type one ticker at a time, press Enter
  - Bulk: import a CSV file (one ticker per row, or a full Bloomberg holdings export)

---

## 3. Platform Architecture

```
┌────────────────────────────────────────────────────────────┐
│  BLUE EAGLE INVESTMENT PLATFORM                            │
├────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐      ┌──────────────┐  ┌─────────────┐    │
│  │  Universe   │      │  Watchlists  │  │  Research   │    │
│  │  Management │      │  (ad-hoc)    │  │  Suite      │    │
│  └──────┬──────┘      └──────────────┘  └─────────────┘    │
│         │                                                     │
│         └──────────┬──────────────┬──────────────────────┐   │
│                    │              │                      │   │
│              ┌─────▼──┐    ┌────▼────┐  ┌──────────┐   │   │
│              │Holdings│    │Watchlist │  │Candidate │   │   │
│              │        │    │  detail  │  │Technicals│   │   │
│              └─────┬──┘    └────┬─────┘  └──────────┘   │   │
│                    │            │                       │   │
│        ┌───────────┴────────────┴───────────────────┐   │   │
│        │                                             │   │   │
│    ┌───▼────┐  ┌───────┐  ┌──────────┐ ┌──────┐   │   │   │
│    │Backtest│  │Outlook│  │ Monitor  │ │Risk &│   │   │   │
│    │(HIST)  │  │(FORWARD) │(Tracking)│ │Perf │   │   │   │
│    └────────┘  └───────┘  └──────────┘ └──────┘   │   │   │
│                                                     │   │   │
│        ┌──────────────────────────────────────┐    │   │   │
│        │      RESEARCH SUITE (6 Tabs)         │    │   │   │
│        │ Overview · Securities · Asset ·      │◄───┘   │   │
│        │ Portfolio · Stress · Decision Memo   │        │   │
│        └──────────────────────────────────────┘        │   │
│                                                         │   │
│  ┌───────────────────────────────────────────────────┐ │   │
│  │  Operations (System Health, Data Refresh, Logs)  │ │   │
│  └───────────────────────────────────────────────────┘ │   │
│                                                         │   │
└─────────────────────────────────────────────────────────┘   │
```

---

## 4. The Core Workflow (Investment Pipeline)

Successful Blue Eagle fund management follows this six-stage flow:

```
  STAGE 1           STAGE 2             STAGE 3
  Universe      →   Holdings        →   Backtest
  (Setup)          (Positions)          (Optimize Historically)
                                              │
                                              ▼
                                    Apply target weights
                                              │
                                              ▼
  STAGE 6           STAGE 5           STAGE 4
  Risk & Perf   ←   Monitor      ←   Outlook
  (Measure &       (Watch & Signal)   (Project Forward)
   Stress Test)
```

**Stage 1: Universe** — Define the investable security list.  
**Stage 2: Holdings** — Build a portfolio by adding positions.  
**Stage 3: Backtest** — Optimize target weights using historical returns.  
**Stage 4: Outlook** — Project returns forward (CAPM, Monte Carlo, Forecast).  
**Stage 5: Monitor** — Watch candidates, track technicals, drill into individual stocks.  
**Stage 6: Risk & Perf** — Measure concentrated risk, factor exposures, and test against scenarios.

---

## 5. Section-by-Section Deep Dives

### 5.1 Universe — The Investable Stock List

**URL:** `/universe`

**What it is** — The master list of all securities that can be added to portfolios or watchlists. Only "active" tickers are available for portfolio construction.

**Key Features:**

| Feature | Purpose |
|---------|---------|
| **Add Ticker** | Single ticker entry + optional company name. Auto-enriches from yfinance (sector, market cap, P/E, dividend yield, 52-week range). |
| **Import CSV** | Bulk import from Bloomberg or brokerage exports. Headers optional; supports `ticker`, `name`, and other columns. |
| **Search** | Filter tickers by symbol or company name. |
| **Active toggle** | Deactivate tickers (they won't appear in portfolio-building tools, but remain in database). |
| **Refresh All** | Re-fetch current metadata from yfinance for every active ticker. |
| **Sector Distribution** | Pie chart showing sector breakdown of your universe. |

**When to use:**
- Onboarding: import your initial universe once
- Maintenance: refresh metadata quarterly; toggle tickers on/off as investment thesis changes

---

### 5.2 Holdings Tab — Build and Maintain Positions

**URL:** `/portfolios/[id]/holdings`

**What it is** — The foundation of every portfolio. Add positions, set shares, import holdings from your custodian, and track cash.

**Key Sections:**

#### Portfolio Value Banner
Shows total market value (equities + cash) automatically computed from shares × current prices. Updates whenever:
- You add/edit a position's share count
- Live prices refresh
- You update cash balance

#### Positions Table
Each position shows:
- Ticker (click to see full technical chart)
- Shares (edit inline)
- Current price (live from yfinance)
- Market value (shares × price)
- Weight % (auto-computed as position MV ÷ portfolio MV)
- Cost basis (optional; used for P&L calculations)
- Unrealized P&L (color: green = gain, red = loss)
- Technical signals (SMA cross, RSI, MACD — click dropdown to filter which signals to show)

**Add a Position:**
1. Type a ticker (autocomplete from Universe)
2. Enter number of shares
3. Optionally enter cost basis per share
4. Click "Add" or press Enter

**Edit Inline:**
1. Click pencil icon on a row
2. Edit shares and/or cost basis
3. Click checkmark to save or X to cancel

**Import from Bloomberg/Brokerage:**
1. Click "Import CSV"
2. Upload your holdings file
3. Platform auto-adds any new tickers to Universe and maps positions

#### Cash & Equivalents Panel
Set your portfolio's cash balance in two ways:
- **Dollar amount** — directly specify cash on hand
- **Percentage target** — specify desired % of total portfolio value; platform computes the dollar amount

Useful for: cash drag analysis, allocation planning, setting minimum liquidity buffers.

**When to use Holdings:**
- Onboarding: populate with your current holdings
- Ongoing: update shares when rebalancing; use cash allocation for liquidity targets

---

### 5.3 Backtest Tab — Historical Optimization

**URL:** `/portfolios/[id]/targets`

**What it is** — Runs historical optimization on your holdings to find optimal target weights. Uses real past returns to estimate expected returns. Backward-looking; assumes past is prologue.

**Eight Optimization Modes:**

| Mode | What it does | Best for |
|------|-------------|----------|
| **Equal Weight** | 1/N allocation | Baseline, test portfolio |
| **Min Variance** | Minimizes portfolio σ | Conservative, low-vol mandates |
| **Max Sharpe** | Maximizes return/risk ratio | Core institutional approach |
| **Risk Parity** | Equal risk contribution per position | Diversified multi-asset |
| **Max Sortino** | Maximizes return/downside-risk | Focus on drawdown control |
| **Min CVaR** | Minimizes 95% tail loss | Tail-risk aware |
| **Max Diversification** | Maximizes diversification ratio | Diversification-focused |
| **Target Vol** | Scales to hit specified volatility | Risk budget constraints |

**Key Controls:**

- **Lookback** — Historical window: 1Y, 2Y, 3Y, or 5Y
- **Max/Min weight** — Bounds per position (e.g., max 15% per position)
- **Allow short positions** — If enabled, optimizer can go negative (bet against stocks)
- **Vol target** — For Target Volatility mode; specify desired portfolio σ (e.g., 10% per year)
- **Conviction views** (optional) — Analyst estimates of under/overvaluation (%). Views adjust expected returns for CAPM-based modes.

**Running Optimization:**
1. Select mode, lookback, and constraints
2. Optionally enter conviction views (e.g., "AAPL is 20% undervalued")
3. Click "Generate Targets"
4. Review results (metrics comparison, action table, equity curve)
5. Click "Apply to Portfolio" to save target weights

**Results Panel:**

- **Metrics Comparison** — Current weights vs optimized weights (CAGR, Vol, Sharpe, Max DD)
- **Action Table** — Per-stock recommendation: current shares → target shares, with buy/sell quantity and dollar value
- **Equity Curve Chart** — How the optimized portfolio would have performed vs current and SPY benchmark (historical only)
- **Forward-Looking Metrics** (CAPM mode only) — CAPM-derived expected return, volatility, and forward Sharpe

**When to use:**
- Quarterly: test various optimization modes to benchmark your current portfolio
- Before rebalance: generate target weights and import the action table to your trading system
- Research: compare mode outputs to understand risk/return trade-offs

---

### 5.4 Outlook Tab — Forward-Looking Analysis

**URL:** `/portfolios/[id]/outlook`

Three distinct forward-looking tools, each with its own workflow.

#### 5.4.A CAPM Optimizer

**Purpose** — Unlike Backtest (backward-looking), this uses Capital Asset Pricing Model (CAPM) to project forward returns based on beta × market risk premium, plus analyst conviction views.

**Key Inputs:**
- **Target Value** — dollar amount you want to optimize toward (e.g., $1M)
- **Risk-Free Rate** — Leave blank to fetch live 10Y Treasury rate, or enter manually (e.g., 4.5%)
- **Market Risk Premium** — Expected annual equity risk premium (default 5%; typical range 4–6%)
- **Market Ticker** — Proxy for the broad market (default VT, the Vanguard all-world ETF)
- **Per-ticker Freeze** — Lock a position's current weight (won't be optimized)
- **Per-ticker View** — Conviction estimate: −50% (overvalued) to +100% (deeply undervalued)
- **Per-ticker Bounds** — Min/max allowed weight for each position

**Running the Optimizer:**
1. Set target value and risk assumptions
2. Enter per-ticker views (optional)
3. Set weight bounds
4. Click "RUN OPTIMIZATION"
5. Review expected metrics (E[Return], E[Vol], E[Sharpe], Beta)
6. Review action table (current → target shares)
7. Optionally click "Apply to Portfolio"

**Key Results:**
- **Expected Portfolio Statistics** — CAPM-projected return, volatility, Sharpe ratio, portfolio beta vs market
- **VaR at 95%** — Daily through annual value-at-risk (worst expected loss with 95% confidence)
- **Capital Allocation Line (CAL) Chart** — Scatter plot showing each asset's vol vs CAPM expected return, with the CAL line extending from risk-free rate through optimal portfolio to 2x/3x leveraged points
- **CAPM Details Table** — Per-ticker beta, CAPM return, analyst view, adjusted return, optimal weight

**When to use:**
- Forward-looking strategic review: "If market risk premium is 5% and AAPL is 20% cheap, where should we overweight?"
- Factor views: embed consensus research as conviction views and see portfolio implications
- Risk budgeting: set target volatility and let CAPM optimizer scale weights to hit it

#### 5.4.B Monte Carlo Simulation

**Purpose** — Run thousands of forward-looking simulations to see the distribution of possible portfolio outcomes over a time horizon.

**Key Inputs:**
- **Lookback** — Historical window for volatility/correlation calibration (1Y–5Y)
- **Number of Simulations** — How many path runs (default 1,000; higher = better accuracy)
- **Horizon** — Time ahead to simulate (3mo, 6mo, 1yr)
- **Initial Value** — Starting portfolio dollar amount (default $1M)

**Efficient Frontier (loads automatically):**
A scatter plot showing:
- Blue frontier curve (mean-variance efficient frontier)
- Current portfolio (amber diamond)
- Max Sharpe point (green star)
- Min variance point (blue triangle)
- Cloud of random portfolios (grey dots, for reference)

**Running the Simulation:**
1. Set horizon and initial value
2. Click "RUN SIMULATION"
3. Wait for 1,000 paths to compute (~3–5 seconds)
4. Review percentile bands (P5, P25, P50, P75, P95) over time

**Key Results:**
- **Simulated Portfolio Paths Chart** — Area chart showing percentile bands over the horizon. Where does your portfolio likely end up?
- **Terminal Distribution Statistics** — Mean, median, P5 (worst 5% case), P95 (best 5% case), probability of loss
- **Brier Score / Calibration** — Are the simulated percentile bands consistent with realized outcomes? (well-calibrated, overconfident, underconfident)

**When to use:**
- Risk budgeting: "What's the probability we lose more than 10% over 6 months?"
- Liquidity planning: "What's the P5 (worst-case) portfolio value in 1 year?"
- Stress testing: "Does this strategy have tail risk I should hedge?"

#### 5.4.C Forecast (Price & Volatility)

**Purpose** — Forecast the portfolio's equity curve and volatility forward 1–3 months using statistical time-series models.

**Key Inputs:**
- **Method** — EWMA, ARIMA, Prophet, or Ensemble (average of all three)
- **Horizon** — 30, 60, or 90 days out

**Running the Forecast:**
1. Select method (if unsure, use Ensemble for robustness)
2. Select horizon
3. Click "Run Forecast"

**Results:**
- **Price Forecast Chart** — FanChart showing historical series plus forecast band with uncertainty (dark band = high confidence, light band = low confidence)
- **Volatility Forecast Chart** — Projected annualized volatility over the forecast window
- **Calibration Metrics** — RMSE (error magnitude), MAE (average error), directional accuracy (% correct up/down calls)

**When to use:**
- Short-term tactical positioning: "Where are we likely headed in the next month?"
- Volatility regime planning: "Is vol likely to spike or drop?"
- Risk flag: Models show all paths declining sharply → is there a known catalyst?

---

### 5.5 Monitor Tab — Watch Candidates and Track Technicals

**URL:** `/portfolios/[id]/monitor`

Two sub-sections for watching stocks and tracking technical signals.

#### Candidates Section

**What it is** — A watchlist tied to your portfolio. Track tickers under consideration that are *not yet* in the portfolio.

**Add a Candidate:**
1. Type a ticker (autocomplete from Universe)
2. Click "Add"

**Signals shown per candidate:**
- SMA 20/50 crossover (Bullish = 20 > 50, Bearish = 20 < 50)
- RSI 14 (Bullish < 30 = oversold, Bearish > 70 = overbought)
- MACD (Bullish = line > signal, Bearish = line < signal)

**Refresh Signals** — Click to fetch latest data for all candidates.

**Promote to Holdings** — Click the "→ Holdings" button to add the candidate to your portfolio with 0 shares; redirects to Holdings tab to add quantity.

#### Technicals Drilldown Section

**What it is** — Full technical analysis for any holding or candidate. Price chart + indicators.

**Select a ticker and date range, then choose indicator overlays:**

| Indicator | What it shows | Best for |
|-----------|----------------|----------|
| **EMA 20/50** | Exponential moving averages; trend filter | Momentum strategies |
| **Bollinger Bands** | Upper/lower confidence bands (20-day, 2σ) | Overbought/oversold detection |
| **Donchian Channel** | 20-day high/low support/resistance | Breakout trading |
| **ADX 14** | Average Directional Index; trend strength | Is the trend strong or weak? |
| **Stochastic** | %K/%D fast/slow oscillators | Overbought/oversold in trending markets |
| **OBV** | On-Balance Volume; volume confirmation | Do price moves have volume backing? |

**Toolbar below chart** shows current ATR (Average True Range), a measure of daily volatility.

**When to use Monitor:**
- Ongoing: refresh candidate signals weekly to spot breakouts or reversal setups
- Pre-buy: examine technicals to time entry into new positions
- Portfolio review: check exit signals (RSI > 70?) on current holdings

---

### 5.6 Risk & Perf Tab — Measure and Stress Test

**URL:** `/portfolios/[id]/risk`

Four sub-sections covering performance measurement, risk analysis, factor exposure, and crisis scenarios.

#### 5.6.A Performance

**What it is** — Historical performance analytics. Assumes your current weights are held constant and measures your realized returns vs SPY benchmark.

**Metrics shown (side-by-side portfolio vs SPY):**

| Metric | Meaning | Good value |
|--------|---------|-----------|
| **CAGR** | Annualized return | > 10% |
| **Volatility** | Annualized σ | < 12% (depends on mandate) |
| **Sharpe** | Return per unit risk | > 1.0 |
| **Max Drawdown** | Peak-to-trough decline | > −25% is acceptable |
| **Beta vs SPY** | Market sensitivity | 1.0 = moves with market; > 1.0 = amplified |
| **Alpha vs SPY** | Excess return vs index | > 0 means outperformance |

**Charts:**
- **Equity Curve** — Growth of $1 invested, portfolio vs SPY benchmark
- **Exit Signals** — SMA, RSI, MACD states for all holdings (is your portfolio showing buy/sell signals?)

**When to use:**
- Quarterly/annual review: "How did we do vs the benchmark?"
- Post-rebalance: confirm new weights didn't break historical performance
- Annual report: use CAGR, Sharpe, max DD for board presentation

#### 5.6.B Health

**What it is** — Concentration and risk contribution analysis. Are you too concentrated? Which positions are driving risk?

**Key Metrics:**

| Metric | What it measures | Red flag |
|--------|-----------------|----------|
| **HHI (Herfindahl)** | Concentration index (0–1) | > 0.15 is concentrated |
| **N_eff** | Effective number of positions | < 5 suggests overconcentration |
| **Top 5 Weight %** | Combined weight of 5 largest | > 50% is risky |
| **Beta vs SPY** | Portfolio market sensitivity | > 1.3 is high beta |
| **Portfolio Vol** | Annualized σ | > 15% for conservative mandates |

**Risk Contribution (MCTR):**
Shows which holdings contribute most to portfolio risk. A position with high MCTR can dominate portfolio volatility even if its weight is modest (because of high individual volatility + correlation).

**Mitigation Recommendations:**
Auto-flagged issues with "Go to [Tool]" links:
- High HHI → go to Backtest tab to reoptimize
- High beta → go to Outlook tab to stress-test
- Elevated vol → diversify or reduce positions

**When to use:**
- Quarterly health check: are we still diversified?
- Pre-rebalance: identify concentration that needs addressing
- Risk limit breaches: respond to auto-flagged warnings

#### 5.6.C Attribution (Fama-French)

**What it is** — Factor decomposition of your portfolio's return using the Fama-French 3-factor model.

**Three factor exposures:**
- **Market (Mkt-RF)** — broad equity market return (your beta × market return)
- **Size (SMB)** — small-minus-big effect; weight toward small-caps
- **Value (HML)** — high-minus-low book-to-market; weight toward value stocks

**Each factor shows:**
- Factor loading (coefficient, how much exposure you have)
- t-statistic (statistical significance; |t| > 1.96 = significant)
- Dollar contribution to return

**Plain-English Interpretation Examples:**
- "High market exposure (aggressive beta 1.4), modest small-cap tilt, growth lean" → you're a growthy, market-beta portfolio
- "Low market exposure (defensive beta 0.7), strong value bias, no size tilt" → value defensives

**R² and Residual:**
- R² = % of return explained by the three factors (higher = more predictable)
- Residual = unexplained return (alpha, idiosyncratic skill, or noise)

**When to use:**
- Portfolio review: "What style box are we in and how did it drive returns?"
- Strategy validation: "Are we executing our value thesis, or have we drifted?"
- Risk reporting: communicate factor exposures to stakeholders

#### 5.6.D Scenarios

**What it is** — Stress-test your portfolio against historical crises or hypothetical shocks.

**Preset Scenarios:**
- COVID crash (Feb–Mar 2020): 30% equity drawdown
- Global Financial Crisis (Oct 2008–Mar 2009): 50%+ equity decline
- Dot-com bust (2000–2003): tech collapse
- 2022 rate-hike selloff: bonds + growth stocks
- Others: liquidity crises, credit events, geopolitical shocks

**Custom Scenarios:**

| Type | What it does | When to use |
|------|-------------|------------|
| **Market Shock** | −X% instantaneous decline | "If the market drops 20% tomorrow, where are we?" |
| **Vol Shock** | Volatility spiked by X multiplier | "If vol goes 2x, can we liquidate?" |
| **Historical Replay** | Actual price path from a past crisis | "How would we have done in 2008?" |
| **Factor Replay** | Historical factors + modeled projection | "If that factor regime recurred today, what would happen?" |

**Results per Scenario:**
- Portfolio dollar P&L and percentage impact
- Per-holding contribution (which positions hurt most?)
- Peak-to-trough drawdown
- Return over the window
- **Mitigation Playbook** — auto-generated recommendations
  - Market Shock: raise cash, trim concentrated names, consider defensive puts
  - Vol Shock: check margin, widen stops, VIX hedges
  - etc.

**When to use:**
- Quarterly risk committee: "What if?" scenarios to inform risk policy
- New strategy review: test against past crises before deploying
- Portfolio limits: determine max acceptable drawdown for your mandate

---

### 5.7 Research Suite (6 Tabs)

**URL:** `/research`

Deep dive research tools for institutional decision-making. All tabs share a portfolio selector dropdown; select a portfolio first.

#### Tab 1: Overview (Portfolio Health)

**What it is** — One-page health scorecard for a portfolio.

**Composite Research Score** (0–100):
- Green ≥ 70 → strong, ready to go
- Amber 45–69 → mixed, some concerns
- Red < 45 → weak, needs work

**Score Breakdown:**
- Validation (30%) — Statistical tests pass rate
- Concentration (25%) — HHI and diversification
- Performance (25%) — Sharpe-based risk-adjusted return
- Drawdown (20%) — Max drawdown depth

**Key Risk Alerts:**
- High concentration (HHI > 0.15)
- Weak validation (< 4/7 tests passing)
- Negative Sharpe (losing money on a risk-adjusted basis)
- Deep drawdown (> −30%)

**Decision History:**
List of recent investment committee decisions (GO / CONDITIONAL / NO-GO) with dates and rationale.

**PDF Tearsheet Export:**
Downloads a professional PDF report with all metrics, ready for board presentation.

**When to use:**
- Portfolio approval gate: is this strategy ready to launch?
- Committee reporting: annual health check
- Due diligence: demonstrate fund quality to stakeholders

#### Tab 2: Securities Research

**What it is** — Universe-level data quality audit and screening, independent of any portfolio.

**Three sections:**

1. **Universe Summary** — Total tickers, active count, sector distribution pie, market cap distribution bar
2. **Data Quality Audit** — Grades each ticker A/B/C/F on history length, gaps, volume, date range
3. **Eligibility Screening** — Filter by min market cap, max P/E, min dividend yield, excluded sectors

**When to use:**
- Onboarding: validate data quality of your universe
- Maintenance: periodic audit to flag data issues
- Expansion: screen for new tickers matching investment criteria

#### Tab 3: Asset Research

**What it is** — Deep-dive analysis of a single security within the context of your portfolio.

**Search for a ticker, then see:**
- **Return & Risk Profile** — 10 stats (CAGR, vol, Sharpe, Sortino, Calmar, max DD, beta, alpha, capture ratios)
- **Rolling Volatility Chart** — 63-day rolling vol over time
- **Fama-French 3-Factor Exposure** — alpha, market beta, SMB (size), HML (value) with t-stats
- **Portfolio Role** — Is this a Return Engine, Diversifier, Defensive, or Income generator?
- **Correlation vs Holdings** — How correlated is this to your existing positions? (red >0.8 = crowding risk)

**When to use:**
- Pre-buy: understand a new candidate's risk profile
- Portfolio check: confirm each holding plays its intended role
- Correlation analysis: avoid adding redundant exposures

#### Tab 4: Portfolio Research

**What it is** — Quantitative analysis tools for your portfolio's construction.

**Four components:**

1. **Optimizer Comparison** — Run all 8 modes simultaneously; compare metrics, turnover, Sharpe
2. **Efficient Frontier** — Scatter plot with frontier curve, current portfolio, max-Sharpe point, random clouds
3. **Risk Contribution Breakdown** — Per-position marginal risk contribution (MCTR %) and visual bars
4. **Correlation Matrix** — Heatmap of pairwise correlations (red = positive, blue = negative)
5. **Turnover & Cost Sensitivity** (appears after Optimizer Comparison) — Slider to model transaction cost impact on Sharpe across modes

**When to use:**
- Strategy review: compare optimization modes before committing to an approach
- Risk committee: understand concentration and diversification
- Rebalance planning: evaluate turnover vs. benefit

#### Tab 5: Stress & Robustness

**What it is** — Validate your strategy against statistical tests and historical crises.

**Three sections:**

1. **Walk-Forward Out-of-Sample Backtesting** — Train optimizer on historical window, test on future window. Degradation ratio near 1.0 = robust; near 0 = overfit.

2. **Statistical Validation Suite** (7 tests):
   - Sharpe t-test (is Sharpe statistically > 0?)
   - Block permutation (does timing add value?)
   - Bootstrap CI for Sharpe (does confidence interval exclude zero?)
   - ADF stationarity (are returns stationary?)
   - Ljung-Box autocorrelation (are returns random?)
   - Jarque-Bera normality (are returns normally distributed?)
   - Drawdown bootstrap (is max DD consistent with randomness?)

   Result: GO if 5+ tests pass, else NO-GO.

3. **Scenario Engine** — (same as Risk & Perf Scenarios tab; run historical crises and custom shocks)

**When to use:**
- Strategy launch: must have GO on statistical validation
- Quarterly review: are we still robust, or have conditions changed?
- Risk governance: evidence for risk limits and hedging policies

#### Tab 6: Decision Memo

**What it is** — Formal investment decision record. Auto-populates a scorecard; analyst adds recommendation and rationale.

**Workflow:**
1. Platform shows composite score + category breakdown
2. You select recommendation: GO (green), CONDITIONAL (amber), NO-GO (red)
3. You write rationale (why this recommendation?)
4. Platform lists auto-flagged red flags (high HHI, weak Sharpe, etc.); you can dismiss individually
5. You write monitoring plan (how will you track this post-implementation?)
6. Click "Save Decision Memo"; memo is attributed to you and time-stamped

**Result:**
- Memo appears in Overview tab Decision History
- Memo is included in PDF tearsheet
- Committee has formal record of who decided what and why

**When to use:**
- Portfolio approval: final sign-off step before launch
- Quarterly review: update if conditions change
- Post-decision: document monitoring plan and actual vs. forecast

---

### 5.8 Watchlists

**URL:** `/watchlists`

**What it is** — Simple ad-hoc lists of tickers for group monitoring. Independent of portfolios.

**Create a watchlist:**
1. Click "New Watchlist"
2. Name it (e.g., "Q1 2024 Candidates")
3. Add tickers one by one with autocomplete
4. Refresh prices/signals weekly

**Drill into a watchlist:**
Shows table with ticker, last close, SMA/RSI/MACD signals, and refresh button.

**When to use:**
- Sector screening: group tickers by industry to compare valuations
- Opportunity tracking: list of candidates being researched (before portfolio decision)
- Monitoring: light tracking without committing to a position

---

### 5.9 Operations

**URL:** `/ops` (gear icon in top nav)

**What it is** — System health, data refresh controls, and job run history.

**Sections:**
- **System Health** — Last data refresh status, elapsed time, job run details
- **Price Data Refresh** — "Refresh Now" (incremental gap-fill) or "10yr Backfill" (full reload)
- **Recent Job Runs** — Table of last 10 refreshes, status, duration

**When to use:**
- Onboarding: trigger "10yr Backfill" once to load historical data
- Troubleshooting: check Operations tab if results seem stale
- Daily: system health is OK if indicator is green

---

## 6. Common Workflows (Decision Trees)

### Workflow 1: Building a Portfolio from Scratch

```
START
  ↓
1. Create portfolio (Portfolios tab → "New Portfolio")
  ↓
2. Add holdings
   a. Manual: Holdings → type ticker + shares, press Add
   b. Bulk: Holdings → Import CSV → upload Bloomberg file
  ↓
3. Set notional value (used for trade sizing)
   Holdings → "Set Portfolio Value" button → enter $ amount
  ↓
4. Run Backtest
   Backtest → select optimization mode (max Sharpe typical) → Generate Targets
  ↓
5. Review action table (recommended trades)
   Do the trades make sense? Do they fit your convictions?
  ↓
6. Apply weights to portfolio
   Click "Apply to Portfolio"
  ↓
7. Drill into risk
   Risk & Perf → Health (any red flags?)
   Risk & Perf → Attribution (expected factor exposures?)
   Risk & Perf → Scenarios (stress test the portfolio)
  ↓
8. Make decision
   Research → Decision Memo → recommendation + rationale
  ↓
END (portfolio launched)
```

### Workflow 2: Evaluating a New Stock Candidate

```
START (you have an idea)
  ↓
1. Add to Universe (if not already there)
   Securities → type ticker → Auto-enriches from yfinance
  ↓
2. Add to Monitor Candidates
   Monitor → Candidates → type ticker → Add
  ↓
3. Watch technicals
   Monitor → Technicals → select candidate → overlay indicators
   → does price action look good for entry?
  ↓
4. Deep research
   Research → Asset Research → search for candidate
   → review factor exposure, correlations, historical returns
  ↓
5. Add to portfolio (if ready)
   Monitor → Candidates → "+ Holdings" button
   → Holdings → enter share count → Add
  ↓
6. Reoptimize
   Backtest → run optimizer with new position
   → does it improve portfolio Sharpe/reduce concentration?
  ↓
7. Apply new weights or hold steady (depending on conviction)
  ↓
END
```

### Workflow 3: Investment Committee Approval Cycle (Monthly/Quarterly)

```
START (monthly board meeting)
  ↓
1. Gather portfolio analytics
   Holdings → review current positions
   Risk & Perf → Performance → CAGR, Sharpe, max DD (last quarter)
   Risk & Perf → Health → HHI, concentration, risk contributors
   Risk & Perf → Attribution → explain Fama-French factor exposures
  ↓
2. Stress-test
   Risk & Perf → Scenarios → run 2008, COVID, Vol Shock
   → would we breach risk limits in a crisis?
  ↓
3. Validate robustness
   Research → Stress & Robustness → run 7-test statistical suite
   → GO or NO-GO?
  ↓
4. Log decision
   Research → Decision Memo
   → Recommendation (GO / CONDITIONAL / NO-GO)
   → Rationale (why this call?)
   → Monitoring Plan (what will we watch post-approval?)
  ↓
5. Export for board
   Research → Overview → "Export PDF Tearsheet"
   → includes scorecard, metrics, decision memo, recommendations
  ↓
6. Present
   Share tearsheet with board. Decision memo becomes official record.
  ↓
END (decision recorded)
```

---

## 7. Glossary — Key Financial & Platform Terms

| Term | Definition | Example / note |
|------|-----------|-----------------|
| **CAGR** | Compound Annual Growth Rate | 12% CAGR over 5 years = $1M becomes ~$1.76M |
| **Volatility (σ)** | Annualized standard deviation of returns | 10% vol is moderate; 15%+ is high |
| **Sharpe Ratio** | Return per unit of risk; (portfolio return − risk-free rate) / volatility | > 1.0 is strong, < 0 is bad |
| **Sortino Ratio** | Like Sharpe, but penalizes only downside volatility | Stricter on tail risk than Sharpe |
| **Max Drawdown** | Peak-to-trough portfolio decline | −20% drawdown = lost 20% from peak |
| **Beta (β)** | Market sensitivity; β = 1 moves with market, β = 1.5 is 1.5× market moves | AAPL β often > 1 (growth); utilities β often < 1 (defensive) |
| **Alpha (α)** | Excess return not explained by beta; investor's "edge" | α > 0 means outperformance; α < 0 means underperformance |
| **HHI (Herfindahl)** | Concentration index (0–1); higher = more concentrated | HHI = Σ (weight²); if 5 equal positions, HHI = 0.04; if 1 position 100%, HHI = 1.0 |
| **MCTR (Marginal Contribution to Total Risk)** | How much a position increases portfolio volatility | High MCTR despite modest weight = position is volatile |
| **Risk Parity** | Equal risk contribution per position, not equal weight | Lower-vol positions get higher weight to match risk of high-vol positions |
| **CVaR (Conditional Value at Risk)** | 95% tail loss; expected loss given a really bad day | CVaR = −8% means worst 5% of days, you expect to lose 8%+ |
| **SMA (Simple Moving Average)** | Average price over N days (e.g., 20-day SMA) | SMA 20 > SMA 50 = bullish (short-term > long-term trend) |
| **RSI (Relative Strength Index)** | Momentum oscillator 0–100 | RSI < 30 = oversold (buy signal); RSI > 70 = overbought (sell signal) |
| **MACD (Moving Average Convergence Divergence)** | Trend-following momentum indicator | MACD line > signal line = bullish; crossover = potential entry |
| **Efficient Frontier** | Curve of optimal risk/return combinations | Portfolios on the frontier maximize return for a given risk level |
| **Factor Exposure (Fama-French)** | Return decomposed into Market (β), Size (SMB), Value (HML) | High value exposure = tilted toward undervalued stocks; high growth exposure = tilted toward growth stocks |
| **Walk-Forward Test** | Out-of-sample backtest; train on past data, test on unseen future | Checks if strategy is robust or overfit to historical period |

---

## 8. Frequently Asked Questions

**Q: How often should I update my portfolio?**
A: Depends on your mandate. Conservative funds rebalance quarterly; active funds may rebalance monthly. Use the Backtest tab monthly to check if target weights have drifted > 3–5%.

**Q: What optimization mode should I use?**
A: Max Sharpe is the institutional standard (maximize return/risk). Min Variance if you're risk-averse; Risk Parity if you want true diversification; CAPM optimizer if you have strong factor views.

**Q: How do I set conviction views?**
A: Go to Backtest → Conviction Views. Enter a percentage undervaluation (e.g., "AAPL = 20% undervalued"). Modes like Max Sharpe and CAPM will bump expected returns accordingly.

**Q: What does a "GO" decision mean?**
A: Research → Decision Memo shows GO (green) = full approval to implement. CONDITIONAL (amber) = proceed with caveats. NO-GO (red) = do not implement. Use the composite score and risk flags to inform your call.

**Q: How do I interpret the Fama-French factors?**
A: Market beta = market sensitivity. SMB = small-cap tilt (SMB > 0 → overweight small). HML = value tilt (HML > 0 → overweight value stocks). Together they explain what style box you're in.

**Q: Is the Monte Carlo simulation a forecast?**
A: No. It's a probability distribution of outcomes *under the assumption that historical volatility and correlations persist*. If correlations break down in a crisis, the simulation will be inaccurate. Always stress-test scenarios too.

**Q: How do I know if my portfolio is overfit?**
A: Research → Stress & Robustness → Walk-Forward Test. If degradation ratio ≈ 1.0, you're robust. If degradation < 0.5, you're overfit. Also check Statistical Validation; if < 4/7 tests pass, robustness is questionable.

**Q: Should I trust technicals?**
A: Technicals (SMA, RSI, MACD) are good for *timing* entry/exit on already-sound fundamental positions. Don't make a 5-year portfolio decision based on RSI > 70. Use them as a supplement to fundamental and quantitative analysis.

**Q: What's the difference between Backtest and Outlook CAPM?**
A: Backtest = backward-looking (historical returns). CAPM Outlook = forward-looking (CAPM model). Use Backtest to see what *would have worked* historically; use CAPM to project what *should work* forward.

---

## End of Guide

For technical support or questions, contact your fund administrator.

---

**Blue Eagle Investment Fund**  
Emory Master of Finance Program

*This platform is built for institutional decision-making. Every recommendation should be paired with your judgment, peer review, and risk governance.*
