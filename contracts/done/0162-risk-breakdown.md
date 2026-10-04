# Contract 0162 — Risk & Perf: risk breakdown (and remove the dead Research nav item)

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

At the moment the portfolio **Risk & Perf** tab is a stub (`frontend/src/pages/analysis/RiskPage.tsx`).
This contract builds its first section, a **risk breakdown** of the portfolio as it is now. It shows:

- portfolio volatility and beta, with cash counted;
- how concentrated the portfolio is (effective number of holdings, top-5 weight);
- **each holding's share of total portfolio risk** next to its share of the money. This is the main
  point of the section: e.g. "TSLA is 7% of the money but 25% of the risk";
- a **market-move estimate**: "if SPY moves −20%, the portfolio moves about β × −20%", in total and per holding.

The contract also removes the header's **Research** nav item, which has no route and goes nowhere.

Gunnar decided on 2026-10-04 to deliberately leave the following out of `main`'s Risk tab:
- the Performance section (Historical Optimize covers it);
- the uniform Market Shock and the Vol Shock (both just restate their input);
- the canned Mitigation panel;
- Fama-French attribution.

Historical stress replay is the next contract (0163).

## Math (backend)

Inputs:
- `weights`: positive numbers per ticker, in the same units as `cash`.
- `cash`: zero or more.
- `closes` per ticker.
- `market` closes.
- `lookback_days`.

1. `total = Σweights + cash`, `w_i = weight_i / total`, and `cash_weight = cash / total`.
   `invested_weight_i = weight_i / Σweights`.
2. Window:
   - `end` = the earliest last-bar date across holdings and market.
   - `lookback_start = end − lookback_days`.
   - If the market's first bar is after `lookback_start + PIN_GRACE_DAYS`, raise the CAPM-style error
     `Market ticker {M} has prices only from {first}, after the lookback start ({lookback_start}). Choose a shorter lookback or another market ticker.`
3. Prices: build a DataFrame of every holding plus the market. If the market ticker is also a
   holding, don't add a duplicate column. Restrict it to `[lookback_start, end]`, sort it, `ffill`,
   then use `compute_returns` from `app.optimizer` (`pct_change().dropna()`). The returns therefore
   start on the first date every holding and the market have prices.
   - `start` = first return date and `n_returns` = number of return rows.
   - If `n_returns < 2`, raise
     `Not enough overlapping prices to measure risk. Choose a longer lookback.`
   - If `n_returns < 60`, warn
     `Fewer than 60 trading days of history — risk figures may be unreliable.`
   - If any holding's first bar is after `lookback_start + PIN_GRACE_DAYS`, add one warning:
     `Risk figures use prices from {start} onward, the first date every holding has prices. Later starts: {T1} ({first_bar}), {T2} ({first_bar}).`
     List the late holdings in request order.
4. `Σ = cov(holding returns) × 252`, using pandas `.cov()` (sample covariance).
   - `vol_i = √Σ_ii`
   - `portfolio_vol = √max(wᵀΣw, 0)` (cash has zero variance, so it only shrinks `w`)
   - `risk_share_i = w_i (Σw)_i / (wᵀΣw)`; these sum to 1. If `portfolio_vol ≤ 1e-12`, every
     `risk_share` is `None`.
5. Betas:
   - Compute them with `compute_betas(returns_including_market, market_ticker)`.
   - If the market ticker is a holding, its beta is `1.0`, as in `capm_run`.
   - A NaN beta raises the CAPM-style "cannot be estimated" error.
   - `portfolio_beta = Σ w_i β_i` (cash counts as beta 0).
6. Concentration uses invested weights:
   - `hhi = Σ invested_weight_i²`
   - `effective_holdings = 1 / hhi`
   - `top5_weight` = the sum of the 5 largest invested weights.

Validation, raising `RiskInputError(ValueError)`. These are the same messages `capm_run` and
`montecarlo_run` use:
- `lookback_error(lookback_days)` (from `app.optimize_run`);
- `weights must be finite and greater than zero`;
- `cash must be finite and zero or more`;
- `missing closes for weighted ticker {ticker!r}`.

## Change

### 1. New `backend/app/risk_run.py`

Module docstring: `"""Pure orchestration for the Risk & Perf tab's risk breakdown."""`

```python
class RiskInputError(ValueError): ...   # router maps to 422 with str(exc), like CapmInputError

@dataclass(frozen=True)
class RiskHolding:
    ticker: str
    weight: float           # of total, including cash
    invested_weight: float  # of invested money only
    vol: float
    beta: float
    risk_share: float | None

@dataclass(frozen=True)
class RiskResult:
    tickers: list[str]
    holdings: list[RiskHolding]   # request order
    market_ticker: str
    lookback_days: int
    start: date
    end: date
    n_returns: int
    cash_weight: float
    portfolio_vol: float
    portfolio_beta: float
    hhi: float
    effective_holdings: float
    top5_weight: float
    warnings: list[str]

def run_risk(weights: dict[str, float], cash: float, closes: dict[str, pd.Series], market: pd.Series,
             *, market_ticker: str, lookback_days: int = 365) -> RiskResult
```

A single holding is allowed: its `risk_share` is 1.0 and `effective_holdings` is 1.0.

### 2. `backend/app/schemas.py`

Add `RiskRequest` with these fields:
- `tickers: list[str]`
- `weights: list[float]`
- `cash: float = 0.0`
- `lookback_days: int = 365`
- `market_ticker: str = "SPY"`

Add `RiskHoldingOut` and `RiskResponse`, mirroring the dataclasses. Dates are `date`, and
`risk_share` is `float | None`.

### 3. `backend/app/routers/portfolio.py`

Add `POST /portfolio/risk` (`response_model=RiskResponse`) and copy the shape of `capm_portfolio`:
- `_require_database()`;
- `_normalise_request`;
- the same holdings and market close loading, with the same 422 message when the market ticker
  has no stored prices;
- map `RiskInputError` to 422;
- return `asdict`-based JSON.

### 4. Backend tests (+14)

**New `backend/tests/test_risk_run.py`.**
- Copy the fixture block from `tests/test_capm_run.py`: `DATES`, `m`, `e1`, `e2`, `prices`, `M`,
  `A`, `B`, `K` and `Y`.
- Use `V = 0.0001 * 260 / 259`, the daily sample variance of each ±1% pattern.
- `m`, `e1` and `e2` are mutually orthogonal, so:
  - `Var(A) = 3.25V`
  - `Var(B) = 1.25V`
  - `Cov(A,B) = 0.75V`
  - `β_A = 1.5` and `β_B = 0.5`
- Call `run_risk(..., market=M, market_ticker="M", lookback_days=365)` unless a test says otherwise.
- Use `pytest.approx(…, abs=1e-9)` for every float.

1. **50/50, no cash.**
   - Weights `{A: 1, B: 1}`.
   - Risk shares are `2/3` and `1/3`.
   - Betas are `1.5` and `0.5`, and `portfolio_beta` is `1.0`.
   - `portfolio_vol` is `sqrt(1.5 * 252 * V)`, and `vol` for A is `sqrt(3.25 * 252 * V)`.
   - `hhi` is `0.5`, `effective_holdings` is `2.0`, `top5_weight` is `1.0`, and `cash_weight` is `0`.
   - `n_returns` is `260`, `start == DATES[1]`, `end == DATES[-1]`, and `warnings == []`.
2. **Cash halves risk, not shares.**
   - Weights `{A: 1, B: 1}` with cash `2`.
   - `weight` is `0.25` each, `invested_weight` is `0.5` each, and `cash_weight` is `0.5`.
   - `portfolio_vol` is half of test 1's, and `portfolio_beta` is `0.5`.
   - Risk shares are still `2/3` and `1/3`, and `effective_holdings` is still `2.0`.
3. **Unequal weights.**
   - Weights `{A: 3, B: 1}`.
   - Risk shares are `0.9` and `0.1`.
   - `hhi` is `0.625` and `effective_holdings` is `1.6`.
4. **Late-starting holding.**
   - Weights `{A: 1, B: 1, Y: 1}`.
   - `start == DATES[K + 1]`.
   - There is exactly one warning, and it contains `"Y ("` and `str(DATES[K])`.
5. **Holding is the market.**
   - Weights `{M: 1, A: 1}` and closes `{M: M, A: A}`.
   - Beta is `1.0` for M and `1.5` for A.
6. **Validation**, parametrized with 4 cases, each matching its message:
   - weight `0`;
   - cash `-1`;
   - `lookback_days=10`;
   - a weighted ticker missing from `closes`.
7. **Late market.**
   - Pass `market=prices(m[K:], index=DATES[K:])`.
   - Raises `RiskInputError` matching `Market ticker M has prices only from`.
8. **Single holding.**
   - Weights `{A: 1}`.
   - `risk_share` is `1.0` and `effective_holdings` is `1.0`.
   - `portfolio_vol` equals A's `vol`.

**New `backend/tests/test_api_risk.py`.** Copy the DB fixtures and seeding from `tests/test_api_capm.py`.
1. **Success.**
   - Seed A, B and M.
   - POST `{"tickers": ["a", "B"], "weights": [1, 1], "cash": 0, "lookback_days": 365, "market_ticker": "m"}`.
   - Expect 200 with `tickers == ["A", "B"]` and `market_ticker == "M"`.
   - The `risk_share` values are approximately `2/3` and `1/3`.
2. **Unknown market ticker.** Returns 422, and the detail contains `No stored price history for market ticker`.
3. **`lookback_days: 10`.** Returns 422.

Together: 11 + 3 = **+14**.

### 5. `frontend/src/api/client.ts`

Add:
- `RiskRequest`, `RiskHoldingOut` and `RiskResponse` types, mirroring the schemas (dates as `string`);
- `riskPortfolio(body)`, which POSTs to `/portfolio/risk` (copy `capmPortfolio`).

### 6. New `frontend/src/lib/risk.ts`

```ts
export interface RiskSettings { lookbackDays: number; marketTicker: string }
export const DEFAULT_RISK_SETTINGS: RiskSettings = { lookbackDays: 365, marketTicker: 'SPY' }
export const DEFAULT_SHOCK_TEXT = '-20'
```

**`buildRiskRequest(portfolio, settings, basis: TradeBasis)`**
- Returns `{ ok: true; request } | { ok: false; message }`.
- No positions → `'Add at least one holding to measure risk.'`
- Blank market ticker → `'Choose a market ticker.'`
- `tickers`, `weights` and `cash` are built **exactly** like `buildMonteCarloRequest`:
  dollar basis uses shares × price and `cashDollars`, otherwise position weights and `cashWeight`.
- `market_ticker` is trimmed, and `lookback_days` comes from settings.

**`sameRiskRequest(a, b)`**
- True when every field is equal, comparing arrays element by element.

**`riskTiles(response): MetricItem[]`**
Uses `MetricItem` from `./optimize`. Four tiles, in order:

| Label | Value | Tooltip |
|---|---|---|
| `'Volatility'` | `(portfolio_vol*100).toFixed(2)%` | `'Annualised volatility of the whole portfolio, cash included, over the lookback.'` |
| `` `Beta vs ${market_ticker}` `` | `portfolio_beta.toFixed(2)` | `` `How much the portfolio tends to move when ${market_ticker} moves 1%. Cash counts as a beta of 0.` `` |
| `'Effective holdings'` | `` `${effective_holdings.toFixed(1)} of ${holdings.length}` `` | `'How many equal-sized holdings would be this concentrated. Lower means more concentrated.'` |
| `'Top 5 weight'` | `(top5_weight*100).toFixed(1)%` | `'Share of the invested money in the five largest holdings.'` |

**`riskRows(response): RiskRow[]`**
- `RiskRow` is `{ ticker, weight, vol, beta, riskShare: number | null, ratio: number | null }`.
- `ratio = riskShare / weight` when both are present and `weight > 0`; otherwise `null`.
- Sort by `riskShare` descending, with `null`s last.

**`parseShock(text)`**
- Returns `{ ok: true; value } | { ok: false; message }`.
- Trim the text and drop a trailing `%`. The value must be a finite number from −50 to 50 inclusive.
- Otherwise return `'Market move must be a number from -50% to +50%.'`

**`shockImpact(response, shockPct)`**
- Returns `{ portfolio: number; byTicker: Record<string, number> }`, in percentage points.
- `portfolio = portfolio_beta × shockPct`.
- `byTicker[t] = weight × beta × shockPct`.

**`formatSigned(value)`**
- Returns `+x.x%` for positive values, `-x.x%` for negative, and `0.0%` when the value rounds to
  zero at one decimal place.

**`riskSummary(response)`**
- `` `${lookbackLabel(lookback_days)} lookback · market ${market_ticker} · ${start} → ${end} (${n_returns} daily returns)` ``
- Append `` ` · ${(cash_weight*100).toFixed(1)}% cash` `` when `cash_weight > 0`.

### 7. New `frontend/src/lib/risk.test.ts` (+8)

Use a literal `RiskResponse` fixture `R`:
- `tickers ['A','B','C']`, market `'SPY'`, `lookback_days 365`;
- `start '2025-10-06'`, `end '2026-10-02'`, `n_returns 250`;
- `cash_weight 0.2`, `portfolio_vol 0.1834`, `portfolio_beta 0.81`;
- `hhi 0.40625`, `effective_holdings 2.4615`, `top5_weight 1`, `warnings []`.

Holdings:

| Ticker | `weight` | `invested_weight` | `vol` | `beta` | `risk_share` |
|---|---|---|---|---|---|
| A | .4 | .5 | .3 | 1.5 | .62 |
| B | .3 | .375 | .2 | .7 | .3 |
| C | .1 | .125 | .25 | 0 | .08 |

The tests:
1. **`riskTiles(R)`.**
   - Labels are `['Volatility','Beta vs SPY','Effective holdings','Top 5 weight']`.
   - Values are `['18.34%','0.81','2.5 of 3','100.0%']`.
2. **`riskRows(R)`.**
   - The order is A, B, C, and A's `ratio` is close to `1.55`.
   - With C's `risk_share` set to `null`, C is last and its `ratio` is `null`.
3. **`parseShock` accepts.** `'-20'` → -20, `' -20% '` → -20, `'15'` → 15, `'50'` → 50.
4. **`parseShock` rejects.** `'-51'`, `'abc'` and `''` each give the message above.
5. **`shockImpact(R, -20)`.**
   - `portfolio` is close to `-16.2`.
   - A is close to `-12`, B close to `-4.2`, and C close to `0`.
6. **`formatSigned`.** `-16.2` → `'-16.2%'`, `3.14` → `'+3.1%'`, `0` → `'0.0%'`, `-0.01` → `'0.0%'`.
7. **`buildRiskRequest`.**
   - Weights basis, using a portfolio with `cashWeight 20`: the request's weights are the position
     weights, `cash` is `20`, and `market_ticker` is trimmed from `' SPY '`.
   - Dollar basis: weights are shares × price.
   - Empty positions return the "Add at least one holding…" error.
   - A blank market ticker returns `'Choose a market ticker.'`
8. **`sameRiskRequest` and `riskSummary`.**
   - `sameRiskRequest` is true for a `structuredClone` and false when `lookback_days` or one weight differs.
   - `riskSummary(R)` is
     `'1Y lookback · market SPY · 2025-10-06 → 2026-10-02 (250 daily returns) · 20.0% cash'`.
   - With `cash_weight: 0`, the summary has no `cash` part.

Build the portfolio and basis fixtures the way `src/lib/monteCarlo.test.ts` does.

### 8. New `frontend/src/pages/analysis/risk/RiskSection.tsx`

Follow `outlook/MonteCarloSection.tsx` and `outlook/CapmSection.tsx` for:
- loading the portfolio;
- loading the universe and computing `tradeBasis(current, universe.lastClose)`;
- the run state (idle, running, error, done) storing the request it ran;
- the error display;
- the "Settings have changed since this run. Run it again to update the results." note.

Show the note when `buildRiskRequest` on the current settings fails, or when
`!sameRiskRequest(built, run.request)`.

Layout, using the same card classes as those sections:

1. **Settings card: "Risk settings".**
   - `LookbackPicker`.
   - A Market ticker `<select>`, with the same options as CAPM.
   - A **Measure risk** button.
2. **Summary line.** `riskSummary(response)`, followed by each warning on its own line.
3. **Card: "Portfolio risk".** Tiles from `riskTiles`, rendered the way CapmSection renders its
   `Tiles`. The tooltip goes on each tile.
4. **Card: "Where the risk comes from".**
   - A table with columns: Ticker, Weight, Volatility, Beta, Share of risk, Risk ÷ weight, and
     `` `If ${market_ticker} moves ${shockText}%` ``.
   - Rows come from `riskRows`.
   - Formats:
     - weight, vol and share: `(x*100).toFixed(1)%`;
     - beta: `toFixed(2)`;
     - ratio: `` `${ratio.toFixed(2)}×` ``;
     - `null` values: `'—'`;
     - the last column: `formatSigned(shockImpact(...).byTicker[ticker])`, or `'—'` when the
       shock text is invalid.
   - Colour the "Risk ÷ weight" cell `text-brand-negative` when `ratio > 1`, and muted otherwise.
   - Under the table: `Share of risk is each holding's contribution to the portfolio's volatility; the shares add up to 100%. Risk ÷ weight above 1 means the holding adds more risk than its size suggests. Cash adds no risk.`
5. **Card: "Market move".**
   - A text input for the move in %, defaulting to `DEFAULT_SHOCK_TEXT`. It is local state and does
     not trigger a re-run.
   - When valid, show `` `If ${market_ticker} moves ${formatSigned(shock)}, the portfolio moves about ${formatSigned(impact.portfolio)}` ``.
     When the basis is `'dollar'`, append
     `` ` (about ${formatMoney(impact.portfolio / 100 * (basis.investedValue + cashDollars(current, basis)))})` ``.
   - When invalid, show the `parseShock` message.
   - Caveat line, muted: `Linear estimate from beta. In real sell-offs, correlations rise and losses are usually larger than beta alone suggests.`

There is no CSV export and no guide in this contract.

### 9. `frontend/src/pages/analysis/RiskPage.tsx`

Replace the stub body with `return <RiskSection />` and import it from `./risk/RiskSection`.

### 10. `frontend/src/components/Header.tsx`

Delete the line `<NavItem label="Research" />`. Make no other change.

### Formatting

Run Prettier on the **new** frontend files only: `risk.ts`, `risk.test.ts` and `RiskSection.tsx`:
`node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <files>`.
If `/tmp/prettier3` is missing, report it and skip this step. Don't run Prettier on any existing
file.

## Out of scope

- Historical stress replay (0163).
- Performance metrics, Fama-French attribution, Vol Shock and the mitigation advice.
- CSV export and a guide panel.
- Any change to the CAPM, Monte Carlo or Optimize code.

## Acceptance criteria

Run these from `backend/`, with the repo's `.venv/bin` on PATH if needed:

1. `DATABASE_URL="" PYTHONPATH=. pytest -q` passes. Baseline 770; afterwards **784**. Paste the totals.
2. `DATABASE_URL="" PYTHONPATH=. pytest -q tests/test_risk_run.py tests/test_api_risk.py` passes,
   with 14 tests.

Run these from `frontend/`:

3. `npx vitest run` passes. Baseline 323; afterwards **331**. Paste the totals.
4. `npx tsc -p tsconfig.app.json --noEmit` is clean, `npm run lint` shows only the 2 known
   warnings, and `npm run build` succeeds.
5. `awk 'length > 300' src/pages/analysis/risk/RiskSection.tsx src/lib/risk.ts` prints nothing.
6. `grep -n 'label="Research"' src/components/Header.tsx` prints nothing.
7. `grep -n "not built yet" src/pages/analysis/RiskPage.tsx` prints nothing.

Then, from the repo root, with the dev server running:

8. `node contracts/tools/smoke-render.mjs risk` reports no uncaught exception. Its ROOT TEXT
   contains `Risk settings`.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

1. The header no longer shows **Research**.
2. Open a portfolio → **Risk & Perf** → **Measure risk**. Check that:
   - the tiles show volatility, beta, effective holdings and top-5 weight;
   - the table lists every holding, sorted by share of risk;
   - the shares add up to about 100%.
3. On a portfolio with cash, volatility and beta are lower than they would be fully invested,
   but the shares still add up to 100%.
4. Change the market move to `-10`. The table column and the sentence update without re-running.
   Typing `abc` shows the error message.
5. Change the lookback. The "Settings have changed" note appears.

## Open questions

None.
