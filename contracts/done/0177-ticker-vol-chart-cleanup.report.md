# Report: Contract 0177 — Ticker Risk Profile: plain rolling-vol chart + tooltip wording

**Audited by:** planner (opus), 2026-10-26
**Verdict:** accepted

## Verification re-run
- vitest: 412 tests in 29 files pass.
- `tsc -p tsconfig.app.json` exits 0.
- `npm run lint` (oxlint) shows only the 2 known warnings.
- SeriesChart diff:
  - `plain = false` is the default;
  - when `plain` is true, both `renderNetReturn()` calls are skipped;
  - one `{!plain && (<>…</>)}` wraps the RSI/MACD, ADX/Stochastic and OBV panes.
  
  With `plain` false the output is the same as before. The block was not re-indented, as the contract asked.
- RiskProfileSection passes `plain` once. The tooltip now uses `${symbol}'s daily return`.

## Criteria notes (spec errors, not coder errors)
- #3: the project uses oxlint through `npm run lint`, not `npx eslint`. Future contracts should say `npm run lint`.
- #5: the second `plain` match is the existing tooltip phrase "plain OLS standard errors". This is a false positive.

## Smoke (isolated stub :8010 + Vite :5180)
- No exceptions or console errors.
- Risk section, inline view: the vol chart title and line are present. RSI, MACD and Net return are absent. The only other SVG is the 14×14 legend icon.
- Expanded dialog: only the vol chart. Net return and RSI both count 0.
- The main price chart is unchanged. Its RSI (14) panel and Net return badge are each still present once on the page.

## Not checked
- Real data and the theme look. Those are Gunnar's to check.
