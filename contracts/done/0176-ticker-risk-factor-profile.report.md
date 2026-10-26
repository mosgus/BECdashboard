# Report: Contract 0176 — Ticker page: Risk & Factor Profile section

**Audited by:** planner (opus), 2026-10-26
**Verdict:** accepted, with follow-up 0177 (defects in my spec, not deviations by the coder)

## Verification re-run
- Frontend: 412 tests in 29 files pass. The tsc check (`-p tsconfig.app.json`) is clean. Lint shows only the 2 known warnings.
- Diff scope: `tickerProfile.ts` and its test, `ticker/RiskProfileSection.tsx`, and a 2-line insert in `TickerPage.tsx`. In `attribution.ts` and `performance.ts` the only change is the subject param, and the existing default strings are unchanged.
- Criterion 14 printed a line. It is a false positive: Prettier moved the SeriesChart `title` prop onto its own line, so `grep -v SeriesChart` cannot filter it.

## Smoke (isolated stub :8010 + Vite :5180, never Gunnar's servers)
- No exceptions or console errors.
- The section renders after Signal States. The window line reads `2023-10-26 → 2026-10-23 (782 trading days) · risk-free 4.27%`.
- The metrics table shows MS vs SPY, plus Diff, Beta and Alpha.
- The rolling-vol chart renders with % ticks.
- Loadings show ★ on the significant factors, with the "without ★" note, then the summary ("MS returned …") and the footnote.
- The default window is 3Y (aria-pressed). 1Y and 5Y re-request with the correct start dates (2025-10-26 and 2021-10-26), confirmed in the stub log.
- Attribution 422: the metrics table and chart stay visible, and the backend message shows inline.
- Clamp: with the first bar on 2024-03-01, 5Y starts there and shows "MS has stored prices only from 2024-03-01, so the window starts there."

## Defects found (→ 0177)
1. **The rolling-vol chart shows empty RSI (14) and MACD panels.** `SeriesChart` renders the RSI and MACD panes even when there is no indicator data (`components/SeriesChart.tsx:283-290`).
2. **The rolling-vol chart shows a "Net return −9.19%" badge.** That number is the change in volatility, not a return. The badge's tooltip also talks about adjusted closes and dividends.
3. **The loadings tooltip still says "the portfolio's daily return".** I copied that text verbatim into the contract.

## Not checked
- Real data and the theme look. Those are Gunnar's to check, on a liquid ticker and a recent IPO.
