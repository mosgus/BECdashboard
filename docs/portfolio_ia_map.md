# Portfolio IA Map — Epic 5

**Status:** P5-00 complete — authoritative mapping for implementation
**Date:** 2026-02-26
**Epic:** P5 — Portfolio Experience Rebuild (Institutional Flow)

---

## 1. New Tab Structure

```
Portfolio Detail  /portfolios/[id]/
├── holdings          What we own right now
├── targets           What we want to own
├── rebalance         How to get from here to there
├── monitor           What to watch
├── risk              How is it performing / stress tests
└── research          Can we trust it statistically
```

URL scheme: `/portfolios/[id]/[tab]` (URL-based routing — see Design Decision 3).

---

## 2. Design Decisions (locked before implementation)

### Decision 1 — Targets = weights only; Rebalance = shares/dollars

**Targets tab outputs weight percentages only.** No dollar values, no share quantities.
**Rebalance tab is the only place that translates weights → shares → dollars.**

Rationale: prevents two places computing share math from the same source, and keeps the Targets tab usable even when no portfolio value has been set.

Boundary:
- Targets shows: `AAPL 30.0% | MSFT 25.0% | NVDA 20.0% | …`
- Rebalance shows: `AAPL 30.0% | $150,000 | 756 shs | +231 shs | +$25,410 | BUY`

The existing Rebalance Plan table inside the old Optimize tab (which showed weights + delta weights) stays in Targets. The implementation worksheet (which showed shares + dollars) moves to Rebalance.

---

### Decision 2 — Target set persistence: upsert last set per portfolio

Session-only state is fragile: a page refresh kills the last optimizer result, making Rebalance's "Last Optimizer Result" source unreliable.

**Resolution:** persist the most recent target set per portfolio as a JSON blob on the portfolio record.

Migration: add `last_target_set JSONB/TEXT DEFAULT NULL` to the `portfolios` table.
Schema (stored as JSON):
```json
{
  "source": "optimizer" | "tilt" | "manual",
  "weights": { "AAPL": 0.30, "MSFT": 0.25 },
  "mode": "max_sharpe",
  "as_of_date": "2026-02-26",
  "views_applied": false,
  "created_at": "2026-02-26T14:30:00Z"
}
```
No history table needed — just the most recent set. `PATCH /portfolios/{id}/targets` upserts it.
This unblocks Rebalance from depending on session state.

---

### Decision 3 — URL-based tab routing in P5-01

Currently all tabs are `useState` inside one page component — no subtab has its own URL.
**Resolution:** implement URL-based routing: `/portfolios/[id]/holdings`, `/portfolios/[id]/targets`, etc.

Benefits: bookmarkable tabs, "Apply + Open Rebalance" produces a real link, browser back/forward works.
Implementation: Next.js nested routes under `app/portfolios/[id]/[tab]/page.tsx` or a single layout file with `usePathname`.

---

## 3. Tab-Level Feature Mapping

### OLD → NEW (summary)

| Old Tab | New Tab | Action |
|---|---|---|
| Holdings | Holdings | Keep — trim worksheet out, add CTA |
| Watchlist (candidates) | Monitor → Candidates | Move |
| Technicals | Monitor → Technicals | Move |
| Analytics | Risk & Performance → Performance | Move |
| Analytics → Portfolio Health | Risk & Performance → Health | Move (stays adjacent) |
| Optimize | Targets | Rename + restructure |
| Holdings → Implementation Worksheet | Rebalance | Move |
| Validation | Research → Validation | Move |
| Forecast | Research → Forecast | Move |
| Scenarios | Risk & Performance → Scenarios | Move |

---

## 4. Feature-Level Mapping (no-orphan checklist)

Every feature from the inventory mapped to exactly one new home. ✓ = confirmed single owner.

### Holdings Tab → **Holdings** (keep, trimmed)

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Portfolio Value Editor | Holdings | Holdings | Keep |
| Add Holding Form | Holdings | Holdings | Keep |
| Import CSV | Holdings | Holdings | Keep |
| Positions Table | Holdings | Holdings | Keep |
| — Inline weight editing | Holdings | Holdings | Keep |
| — Ticker link to /ticker/[symbol] | Holdings | Holdings | Keep |
| — Remove button | Holdings | Holdings | Keep |
| Weight Footer (total, color-coded) | Holdings | Holdings | Keep |
| QuickTechnicals Accordion (per row) | Holdings | Holdings | Keep (lightweight position health) |
| "Next step: Set Targets →" CTA | — | Holdings | **ADD** |
| Implementation Worksheet | Holdings | **Rebalance** | **MOVE** |

---

### Optimize Tab → **Targets** (rename + restructure)

**Optimization Settings**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Mode Dropdown (9 modes) | Optimize | Targets | Keep |
| Max Weight Slider | Optimize | Targets | Keep |
| Min Weight Slider | Optimize | Targets | Keep |
| Target Volatility Slider | Optimize | Targets | Keep (conditional) |
| Allow Short Positions Checkbox | Optimize | Targets | Keep |
| Return Bump κ Slider | Optimize | Targets | Keep (conditional) |
| Run Optimizer Button | Optimize | Targets | Keep, relabel "Generate Targets" |
| Optimizer Guide Modal | Optimize | Targets | Keep |

**Conviction Tilts Panel**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Tilt Baseline Radio | Optimize → Conviction Tilts | Targets → Conviction Tilts | Keep |
| Aggressiveness λ Slider | Optimize → Conviction Tilts | Targets → Conviction Tilts | Keep |
| Per-Ticker Conviction Inputs | Optimize → Conviction Tilts | Targets → Conviction Tilts | Keep |
| Generate Tilt Targets Button | Optimize → Conviction Tilts | Targets → Conviction Tilts | Keep |
| Reset Views Button | Optimize → Conviction Tilts | Targets → Conviction Tilts | Keep |
| Tilt Results Table (weights only) | Optimize → Conviction Tilts | Targets → Conviction Tilts | Keep; **strip any share columns** |
| Apply Tilt as Targets Button | Optimize → Conviction Tilts | Targets → Conviction Tilts | Keep, relabel "Apply Tilt Weights" |

**Optimizer Results**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| As-of Date + Views Applied badge | Optimize | Targets | Keep |
| Feasibility Alert | Optimize | Targets | Keep |
| Warning Messages | Optimize | Targets | Keep |
| Metrics Comparison Cards (Cur vs Opt) | Optimize | Targets | Keep (quality preview) |
| Rebalance Plan Table (weights + Δ weights) | Optimize | Targets | Keep; **weights only — remove any share/dollar columns** |
| Turnover chip | Optimize | Targets | Keep |
| Export CSV (weights) | Optimize | Targets | Keep |
| Equity Curve Comparison Chart | Optimize | Targets | Keep |
| "Apply as Targets" Button | Optimize | Targets | Keep, relabel "Apply to Portfolio" |
| "Apply + Open Worksheet" Button | Optimize | Targets | Keep, relabel "Apply + Open Rebalance" |
| Apply Success Banner | Optimize | Targets | Keep |
| Save Target Set (persist) | — | Targets | **ADD** (Decision 2) |

---

### Holdings → Implementation Worksheet → **Rebalance** (move)

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Source Radio (Current / Optimizer / Tilt) | Holdings → Worksheet | Rebalance | Keep; add "Saved Target Set" as 4th option |
| Compute Worksheet Button | Holdings → Worksheet | Rebalance | Keep |
| Summary Bar (notional, turnover, residual cash, as-of) | Holdings → Worksheet | Rebalance | Keep |
| Trade Table (Ticker, Price, Cur/Tgt Wt%, Cur/Tgt $Val, Shs, Δ Shs, Δ $, Action) | Holdings → Worksheet | Rebalance | Keep |
| Export Trades CSV | Holdings → Worksheet | Rebalance | Keep |
| "No targets" CTA Banner | — | Rebalance | **ADD** (P5-09) |
| "Back to Targets" Link | — | Rebalance | **ADD** |
| Rounding policy banner (whole shares only) | — | Rebalance | **ADD** |

---

### Watchlist (candidates) + Technicals → **Monitor** (merge)

**Candidates subsection**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Add Candidate Form | Watchlist tab | Monitor → Candidates | Move |
| Refresh Signals Button | Watchlist tab | Monitor → Candidates | Move |
| Candidates Table (Ticker, Last Close, SMA/RSI/MACD, Add to Holdings, Remove) | Watchlist tab | Monitor → Candidates | Move |
| "In portfolio" badge | Watchlist tab | Monitor → Candidates | Move |

**Technicals Drilldown subsection**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Ticker Dropdown (holdings + candidates) | Technicals tab | Monitor → Technicals | Move |
| Date Range Pickers | Technicals tab | Monitor → Technicals | Move |
| Load Chart Button | Technicals tab | Monitor → Technicals | Move |
| Indicator Toggles (EMA, Bollinger, etc.) | Technicals tab | Monitor → Technicals | Move |
| TechnicalsChart | Technicals tab | Monitor → Technicals | Move |
| Indicator Config Panel (per-ticker params) | Technicals tab | Monitor → Technicals | Move |
| Technicals Guide Modal | Technicals tab | Monitor → Technicals | Move |
| Create Alert Rule Link | Technicals tab | Monitor → Technicals | Move |

---

### Analytics + Health + Scenarios → **Risk & Performance** (merge)

**Performance subsection**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Date Range Pickers + Load Analytics | Analytics tab | Risk & Perf → Performance | Move |
| Metric Cards (CAGR, Vol, Sharpe, DD, Beta, Alpha) | Analytics tab | Risk & Perf → Performance | Move |
| Equity Curve Chart (portfolio vs SPY) | Analytics tab | Risk & Perf → Performance | Move |
| Exit Signals Grid (holdings × SMA/RSI/MACD) | Analytics tab | Risk & Perf → Performance | Move |

**Health subsection**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| HHI Card | Analytics → Health | Risk & Perf → Health | Move |
| N_eff Card | Analytics → Health | Risk & Perf → Health | Move |
| Top 5 Card | Analytics → Health | Risk & Perf → Health | Move |
| Beta Card | Analytics → Health | Risk & Perf → Health | Move |
| Ann. Vol Card | Analytics → Health | Risk & Perf → Health | Move |
| Risk Contribution Chart | Analytics → Health | Risk & Perf → Health | Move |
| Risk Contribution Table | Analytics → Health | Risk & Perf → Health | Move |

**Scenarios subsection**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Scenario Type Selector | Scenarios tab | Risk & Perf → Scenarios | Move |
| Market Shock Input | Scenarios tab | Risk & Perf → Scenarios | Move |
| Vol Shock Input | Scenarios tab | Risk & Perf → Scenarios | Move |
| Historical Replay Date Pickers | Scenarios tab | Risk & Perf → Scenarios | Move |
| Run Scenario Button | Scenarios tab | Risk & Perf → Scenarios | Move |
| Market Shock Results | Scenarios tab | Risk & Perf → Scenarios | Move |
| Vol Shock Results | Scenarios tab | Risk & Perf → Scenarios | Move |
| Historical Replay Results (equity curve, asset contributions) | Scenarios tab | Risk & Perf → Scenarios | Move |
| Mitigation Playbook | Scenarios tab | Risk & Perf → Scenarios | Move |
| Scenario Guide Modal | Scenarios tab | Risk & Perf → Scenarios | Move |

---

### Validation + Forecast → **Research** (merge)

**Validation subsection**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Run Validation Button | Validation tab | Research → Validation | Move |
| GO / NO-GO Badge | Validation tab | Research → Validation | Move |
| 7 Statistical Test Cards | Validation tab | Research → Validation | Move |
| Validation Guide Modal | Validation tab | Research → Validation | Move |

**Forecast subsection**

| Feature | Old Location | New Location | Action |
|---|---|---|---|
| Method Dropdown | Forecast tab | Research → Forecast | Move |
| Horizon Buttons (30d/60d/90d) | Forecast tab | Research → Forecast | Move |
| Run Forecast Button | Forecast tab | Research → Forecast | Move |
| Fan Charts (Price + Volatility) | Forecast tab | Research → Forecast | Move |
| Calibration Card | Forecast tab | Research → Forecast | Move |
| Model Info Card | Forecast tab | Research → Forecast | Move |
| Forecast Guide Modal | Forecast tab | Research → Forecast | Move |

---

## 5. Global Components — Unchanged

These components are not moved; they are reused in their new contexts.

| Component | Used In (new) |
|---|---|
| SignalBadge | Holdings (QuickTechnicals), Monitor → Candidates, Monitor → Technicals, Risk & Perf → Performance |
| UniverseTickerPicker | Holdings → Add form, Monitor → Add Candidate |
| InfoTooltip | Everywhere — no changes |
| TechnicalsChart | Monitor → Technicals Drilldown |
| RiskContributionChart | Risk & Perf → Health |
| FanChart | Research → Forecast |
| HelpSidebar | Unchanged |
| All Guide Modals (Optimizer, Validation, Forecast, Technicals, Scenario) | Within their new tabs |

---

## 6. Net-New Elements (not in old inventory)

| Element | Tab | Ticket |
|---|---|---|
| "Next step: Set Targets →" CTA on Holdings | Holdings | P5-02 |
| "No targets computed" CTA on Rebalance | Rebalance | P5-09 |
| "Back to Targets" link on Rebalance | Rebalance | P5-04 |
| Rounding policy banner (whole shares, as-of date) | Rebalance | P5-04 |
| "Save Target Set" button + persist API call | Targets | P5-03 |
| "Saved Target Set" as 4th source option | Rebalance | P5-04 |
| Persistent portfolio header card (name, value, positions, as-of) | All tabs | P5-01 |
| Disclaimer text on Research tab | Research | P5-07 |
| Subsection nav within Monitor / Risk & Perf / Research | Monitor, Risk & Perf, Research | P5-05/06/07 |

---

## 7. Proposed File Structure

Current: one 1800-line `page.tsx` containing all 8 tab components.

Proposed:

```
frontend/app/portfolios/[id]/
├── layout.tsx                     ← persistent header card + tab bar
├── page.tsx                       ← redirect to /holdings (default tab)
├── holdings/
│   └── page.tsx                   ← HoldingsTab
├── targets/
│   └── page.tsx                   ← TargetsTab (from OptimizeTab)
├── rebalance/
│   └── page.tsx                   ← RebalanceTab (from worksheet)
├── monitor/
│   └── page.tsx                   ← MonitorTab (candidates + technicals)
├── risk/
│   └── page.tsx                   ← RiskPerformanceTab (analytics + health + scenarios)
└── research/
    └── page.tsx                   ← ResearchTab (validation + forecast)
```

The shared portfolio query (name, positions, notional_value) lives in `layout.tsx` and is passed to all child tabs via context or props.

---

## 8. Backend Changes Required

| Change | Ticket | Scope |
|---|---|---|
| `portfolios.last_target_set` column + migration | P5-03 | New Alembic migration |
| `PATCH /portfolios/{id}/targets` endpoint | P5-03 | Persists target set JSON |
| `GET /portfolios/{id}` includes `last_target_set` | P5-03 | Additive to existing response |

Everything else is purely frontend reorganization — no new endpoints or data model changes beyond the target set persistence.

---

## 9. State Flow Between Tabs

```
Holdings
  └── positions, notional_value
        ↓ (read by)
  Targets (conviction inputs pre-populated from positions list)
        ↓ (writes)
  Portfolio DB: last_target_set { weights, source, mode, as_of }
        ↓ (read by)
  Rebalance (source: "Saved Target Set" | "Last Optimizer" | "Last Tilt" | "Current")
        ↓ (produces)
  Trade list (read-only, export only)

Monitor
  └── candidates list → add to Holdings (refetches portfolio)

Risk & Performance
  └── reads positions + weights from portfolio (no writes)

Research
  └── reads positions + weights from portfolio (no writes)
```

Key principle: **only Targets and Holdings write to the portfolio.** Rebalance, Monitor, Risk & Perf, and Research are all read-only.

---

## 10. No-Orphan Feature Checklist

Confirm every feature from the inventory has exactly one new home before implementation begins.

- [x] Portfolio Value Editor → Holdings
- [x] Add Holding Form → Holdings
- [x] Import CSV → Holdings
- [x] Positions Table (all columns) → Holdings
- [x] QuickTechnicals Accordion → Holdings
- [x] Implementation Worksheet (all sub-features) → Rebalance
- [x] Optimization Settings (9 modes, sliders, checkbox) → Targets
- [x] Conviction Tilts Panel (all sub-features) → Targets
- [x] Optimizer Results (metrics, table, charts, apply buttons) → Targets
- [x] Candidates Add Form → Monitor
- [x] Candidates Table → Monitor
- [x] Refresh Signals Button → Monitor
- [x] Technicals Chart Panel → Monitor
- [x] Indicator Config Panel → Monitor
- [x] Analytics Metrics Cards → Risk & Performance
- [x] Analytics Equity Curve → Risk & Performance
- [x] Analytics Exit Signals Grid → Risk & Performance
- [x] Portfolio Health Cards → Risk & Performance
- [x] Risk Contribution Chart + Table → Risk & Performance
- [x] Scenarios (all 3 types + results + playbook) → Risk & Performance
- [x] Validation Suite (7 tests) → Research
- [x] Forecasting (all methods + output) → Research
- [x] All guide modals → within their new tabs
- [x] SignalBadge, UniverseTickerPicker, InfoTooltip → reused unchanged
- [x] Home page (ad-hoc scratchpad) → untouched, not in scope

**Result: 0 orphan features. 0 duplicate homes.**

---

## 11. Out of Scope for Epic 5

Per the epic non-goals — do not implement any of the following during this refactor:

- New optimization modes or indicators
- Changes to alert delivery or scheduling
- New backend data pipelines or major schema changes beyond `last_target_set`
- Visual redesign (colors, typography, card styles)
- The Home page (ad-hoc scratchpad) — untouched
- Watchlists at the top-level nav (`/watchlists`) — untouched
- Alerts at the top-level nav (`/alerts`) — untouched
- Ops page — untouched

---

## 12. Implementation Order (from epic)

| Step | Ticket | Deliverable |
|---|---|---|
| 1 | P5-00 | This document ← **you are here** |
| 2 | P5-01 | URL routing shell + layout.tsx + persistent header |
| 3 | P5-02 | Holdings tab (trimmed) |
| 4 | P5-03 | Targets tab + last_target_set persistence |
| 5 | P5-04 | Rebalance tab |
| 6 | P5-05 | Monitor tab |
| 7 | P5-06 | Risk & Performance tab |
| 8 | P5-07 | Research tab |
| 9 | P5-08 | UniverseTickerPicker audit |
| 10 | P5-09 | Guardrails + CTAs |
| 11 | P5-10 | Redirect audit (likely trivial — state-based routing today) |
| 12 | P5-11 | Demo script + docs |
| 13 | P5-12 | QA pass + no-orphan verification |
