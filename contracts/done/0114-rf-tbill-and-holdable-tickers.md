# Contract 0114 — Risk-free rate from the 3-month T-bill, and holdable-only portfolio tickers

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)
**Depends on:** 0113 (remove tilt) must be accepted first. Both edit `routers/portfolio.py` and `schemas.py`. If `grep -n "tilt" backend/app/routers/portfolio.py` prints anything, stop and report `BLOCKED`.

## Goal

This contract makes two changes:

- **The risk-free rate.** The Optimize tab takes it from the 3-month T-bill (`^IRX`) instead of the
  10-year Treasury (`^TNX`). The response says whether the rate was live or the 4.27% fallback, and
  the metric tooltips say so too.
- **Holdable-only portfolio tickers.** Portfolio pickers, presets and CSV import accept only
  holdable tickers: Equity, ETF, Mutual Fund, or a ticker whose type is not known yet. Indices such as
  `^GSPC` stay in the Universe but can no longer be added to a portfolio.

## Why

- **The wrong rate maturity.** Sharpe's risk-free rate is conventionally the 3-month T-bill. The
  10-year yield carries a term premium. On 2026-09-24, Yahoo showed `^IRX` at 4.07% and `^TNX` at
  5.16%, so every Optimize Sharpe and Alpha has been computed against a rate about a point too high.
  `main` used `^TNX`; the rebuild inherited it, nobody chose it.
- **A silent fallback.** When Yahoo fails, `fetch_risk_free_rate()` returns 4.27%, and nothing
  downstream can tell.
- **A lower bound that would break at low rates.** The range check `0.001 < rate < 0.20` rejects
  T-bill yields below 0.1%. In 2020–21 those were normal (`^IRX` traded around 0.03%), so the app
  would have silently used 4.27% for two years. The bound becomes `0.0 <= rate < 0.20`.
- **Indices are pickable holdings.** `^GSPC` and `^IXIC` are universe members (the strip groups them
  as "Indices"). Nothing stops them going into a portfolio, where the optimizer would treat an index
  as a buyable asset.
- **Scope was chosen deliberately small.** On 2026-09-24 Gunnar and the planner considered, and
  **rejected for now**, a separate "reference" universe for rates, FX, crypto and futures. It would
  change what universe membership means for every consumer: strip, news, briefing, signals, export
  and optimizer. This contract therefore does **not** change universe membership, refresh or stored
  data. It filters at the portfolio-building entry points only.

## Files

Modify:
- `backend/app/rates.py` — switch to `^IRX`, add the source, fix the lower bound.
- `backend/app/routers/portfolio.py` — use the rate with its source, and return `rf_source`.
- `backend/app/schemas.py` — `OptimizeResponse.rf_source`.
- `backend/tests/test_rates.py`
- `backend/tests/test_api_optimize.py`
- `frontend/src/api/client.ts` — `rf_source` on `OptimizeResponse`.
- `frontend/src/lib/optimize.ts` — the `metricItems` tooltips.
- `frontend/src/lib/optimize.test.ts`
- `frontend/src/pages/analysis/OptimizePage.tsx` — pass `response.rf_source` to `metricItems`.
- `frontend/src/lib/tickerType.ts` — add `isHoldableType`.
- `frontend/src/lib/tickerType.test.ts` — create it if it doesn't exist.
- `frontend/src/components/NewPortfolioDialog.tsx` — filter to holdable tickers, and new skip copy.
- `frontend/src/components/AddPositionForm.tsx` — filter to holdable tickers.
- `frontend/src/lib/portfolioCsv.ts` — change one failure message only.
- `frontend/src/lib/portfolioCsv.test.ts` — only if a test asserts the old message.

**Touch nothing else.**
- **`frontend/src/pages/PortfoliosPage.tsx` has uncommitted edits by Gunnar and is not on this
  list.** Do the filtering inside the two components, not in the page that renders them.
- If the work appears to require editing a file not on this list, stop and report `BLOCKED`
  instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### 1. `backend/app/rates.py`

- Change the module docstring to `"""Dynamic risk-free rate from the 3-month US Treasury bill yield."""`.
- Rename `_download_tnx` to `_download_irx`. It returns `yf.Ticker("^IRX").history(period="1d")`,
  and its docstring says "Treasury-bill" instead of "Treasury-yield".
- Keep `_FALLBACK_RF = 0.0427`.

Add this function. The cache now stores the rate only on a live success, as it does today:

```python
RateSource = Literal["live", "fallback"]

def fetch_risk_free_rate_with_source() -> tuple[float, RateSource]:
    """Return (rate, source). source is "live" for a fresh or cached ^IRX read, "fallback" otherwise."""
```

- It uses the same logic as today's `fetch_risk_free_rate`, with these differences:
  - It downloads through `_download_irx`.
  - The range check is `0.0 <= rate < 0.20`.
  - Every path that returns `_FALLBACK_RF` returns `(_FALLBACK_RF, "fallback")`.
  - A live read or a cache hit returns `(rate, "live")`.
- `fetch_risk_free_rate() -> float` stays, as a thin wrapper that returns
  `fetch_risk_free_rate_with_source()[0]`.

### 2. `backend/app/routers/portfolio.py` and `schemas.py`

- In `optimize_portfolio`, call `rf, rf_source = fetch_risk_free_rate_with_source()` once before
  `run_optimize`. Pass `rf=rf`.
- Add `"rf_source": rf_source` to the returned dict, directly after `"rf"`.
- Update the import. `fetch_risk_free_rate` may stop being imported here if nothing else in the
  file uses it.
- `OptimizeResponse` gains `rf_source: str`, after `rf`.
- The tilt route is already gone (0113). Change nothing else in this file.

### 3. Frontend rate tooltips

- **`client.ts`:** `OptimizeResponse` gains `rf_source: 'live' | 'fallback'`, after `rf`.
- **`optimize.ts`:** the signature becomes
  `metricItems(metrics: OptimizeMetrics | null, rf: number, rfSource: 'live' | 'fallback'): MetricItem[]`.
  - Keep `const rfPct = (rf * 100).toFixed(2)`.
  - Add
    `const rfNote = rfSource === 'live' ? `3-month Treasury bill yield, ${rfPct}% for this run` : `live rate unavailable, so the ${rfPct}% fallback was used``.
  - Sharpe tooltip:
    `` `(CAGR − risk-free rate) ÷ volatility. Risk-free rate: ${rfNote}. Above 1 is broadly acceptable; above 2 is excellent.` ``
  - Alpha tooltip:
    `` `Annualised return above what beta to SPY predicts. Risk-free rate: ${rfNote}.` ``
  - Labels, values and every other tooltip are unchanged.
- **`OptimizePage.tsx`:** both `metricItems(...)` calls pass `response.rf, response.rf_source`.

### 4. Holdable tickers

**`tickerType.ts`** gains:

```ts
/** Types a portfolio can hold. null (no fundamentals row yet) is allowed: Yahoo always types an
 *  index, so an untyped ticker is an equity whose fundamentals haven't loaded, not an index. */
const HOLDABLE_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND'])
export function isHoldableType(quoteType: string | null): boolean {
  return quoteType === null || HOLDABLE_TYPES.has(quoteType.toUpperCase())
}
```

**`NewPortfolioDialog.tsx`:**
- At the top of the component, add
  `const holdable = universe.filter((entry) => isHoldableType(entry.quote_type))`.
- Use `holdable` in place of `universe` everywhere the component reads the list:
  - `byTicker`;
  - both `new Set(universe.map(...))` calls passed to `parsePortfolioCsv`;
  - `availableTickersFor`;
  - the `universe.length === 0` empty-state check.
- The prop stays named `universe` and keeps its type.
- Change the skipped-rows sentence from `not in your Universe:` to
  `not in your Universe or not holdable (e.g. an index):`. The rest of that block is unchanged.

**`AddPositionForm.tsx`:**
- Add the same `holdable` filter at the top.
- Use `holdable` for:
  - the empty check;
  - `available`;
  - `byTicker`.
- The "Every Universe ticker is already held" message is unchanged.

**`portfolioCsv.ts`:** change only the failure string
`'No portfolio tickers are in the current universe'` to
`'No holdable portfolio tickers are in the current universe'`. Make no other change; the parser
still receives a set and knows nothing about types.

## Out of scope

- Any change to universe membership, the Universe table, the strip, refresh, news, briefing, signals
  or export.
- A reference or macro panel, and storing `^IRX` or any other rate history.
- A historical-average risk-free rate for the backward-looking metrics.
- **Existing portfolios that already hold an index.** They load and optimize as before. This
  contract stops new additions only.
- Backend holdability checks on `/portfolio/optimize`.
- `PortfoliosPage.tsx` and `HoldingsPage.tsx`.
- The CAPM `rf` path. CAPM mode gets the new rate automatically through the same
  router call, and that is intended.

## Acceptance criteria

1. `(cd backend && .venv/bin/python -m pytest -q)` passes.
2. `(cd frontend && npm run build)` and `npm run test` pass. `npm run lint` reports only the two
   existing warnings, in `HelpSidebar.tsx` and `UniversePage.tsx`.
3. **`test_rates.py`** is updated to monkeypatch `_download_irx`, and asserts all of the following:
   - A close of `4.07` gives `(0.0407, "live")`.
   - A close of `0.03` gives `(0.0003, "live")`, which covers the old lower-bound bug.
   - An empty frame, a close of `25.0`, a close of `-0.5` and a download exception each give
     `(0.0427, "fallback")`.
   - A cached second call returns `"live"` without downloading again.
   - `fetch_risk_free_rate()` still returns the bare float.
4. **`test_api_optimize.py`:** the existing rate test monkeypatches
   `fetch_risk_free_rate_with_source`.
   - A patch returning `(0.04, "live")` gives `body["rf"] == 0.04` and `body["rf_source"] == "live"`.
   - A second patch returning `(0.0427, "fallback")` gives `rf_source == "fallback"`.
5. **`tickerType.test.ts`:**
   - `isHoldableType` is true for `'EQUITY'`, `'ETF'`, `'MUTUALFUND'`, `'etf'` and `null`.
   - It is false for `'INDEX'`, `'CURRENCY'`, `'CRYPTOCURRENCY'` and `'FUTURE'`.
6. **`optimize.test.ts`:**
   - For `metricItems(..., 0.0407, 'live')`, the Sharpe tooltip contains
     `3-month Treasury bill yield, 4.07% for this run`.
   - For `'fallback'` with `0.0427`, the Sharpe tooltip contains
     `live rate unavailable, so the 4.27% fallback was used`, and the Alpha tooltip contains the same
     phrase.
7. `grep -n "TNX" backend/app/rates.py` prints nothing.
8. `grep -c "isHoldableType" frontend/src/components/NewPortfolioDialog.tsx frontend/src/components/AddPositionForm.tsx`
   prints at least `2` for the dialog (import plus filter) and at least `2` for the form.
9. `git diff --stat frontend/src/pages/PortfoliosPage.tsx` shows the same line counts as before you
   started. Run it before and after, and paste both.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string, so any script run without that prefix talks to the **production database**.
> `pytest` is covered by `tests/conftest.py`; ad-hoc scripts are not.

From the repo root. Paste the complete, verbatim output.

```bash
git diff --stat frontend/src/pages/PortfoliosPage.tsx   # run BEFORE starting, and again at the end
(cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -2)
(cd backend && .venv/bin/python -m pytest -q tests/test_rates.py tests/test_api_optimize.py -v 2>&1 | grep -E "PASSED|FAILED|ERROR")
(cd frontend && npm run build 2>&1 | tail -2)
(cd frontend && npm run test 2>&1 | grep -E "Tests +[0-9]+|FAIL")
(cd frontend && npm run lint 2>&1 | grep -E "warning|error")
grep -n "TNX" backend/app/rates.py; echo "tnx exit=$?"
grep -nF '0.0 <= rate < 0.20' backend/app/rates.py
grep -c "isHoldableType" frontend/src/components/NewPortfolioDialog.tsx frontend/src/components/AddPositionForm.tsx
grep -nF 'not holdable (e.g. an index)' frontend/src/components/NewPortfolioDialog.tsx
git status --short
```

## Tooltips

No new interactive elements. The changed tooltip copy is specified in Interface §3. No `title=`.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** Restart the backend first: find the owner with
`lsof -nP -iTCP:8000 -sTCP:LISTEN`, kill it, then relaunch.

1. **Optimize tab.** Run any mode and hover **Sharpe**. It should read "3-month Treasury bill
   yield, ~4.0x% for this run". If it says "fallback", the Yahoo fetch failed; that is now visible,
   which is the point.
2. **Portfolios → New Portfolio.** The ticker dropdown no longer lists `^GSPC` or `^IXIC`, but
   equities and ETFs are all still there.
3. **Import a CSV that includes `^GSPC`.** The review says it was skipped as "not in your Universe
   or not holdable (e.g. an index)".
4. **Add position on an existing portfolio.** Indices are not offered.
5. **Universe page and top strip.** Unchanged, and indices still show.

## Open questions

None. Stop and report `BLOCKED` if a portfolio component other than the two listed turns out to
offer universe tickers for adding to a portfolio.
