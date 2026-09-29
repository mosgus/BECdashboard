# Contract 0126 — Optimize: "Cash to deploy" slider

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The Optimize results gain a **Cash to deploy** slider, 0–100% of the portfolio's cash. Moving it
moves that share of cash into the holdings, in the Optimized proportions, with no re-run. The
Weights table, **Export CSV** and **Apply to portfolio** all reflect it. The table and the CSV now
show each holding's share of the **whole** portfolio, and cash gets its own row in the table.

## Why

The optimizer and the backtest work on invested holdings only: `target_weights` sum to 1 and cash
sits outside them. `applyPlan` already rescales to `fraction × (100 − cashWeight)` and keeps cash
fixed. Deploying cash is therefore pure post-processing. The new cash is `c′ = c × (1 − p)` and
each holding becomes `fraction × (100 − c′)`. No backend change and no re-run are needed: the mix
is unchanged, only the invested share grows.

This also fixes a live defect in the export. `optimizeCsv` writes `target_pct` as invested-only
percentages, so they sum to 100. `parsePortfolioCsv` derives cash as `100 − Σ target_pct` when
there is no CASH row, so re-importing a 10%-cash portfolio's export **silently sets cash to 0**.
Writing `target_pct` as % of the whole portfolio makes the round trip carry the remaining cash
correctly, at any slider position.

## Files

Modify:
- `frontend/src/lib/optimize.ts` — new helpers. `applyPlan`, `applyConfirmLines`,
  `tradeBasisNote` and `optimizeCsv` each gain **optional trailing** parameters whose defaults
  reproduce today's output exactly.
- `frontend/src/lib/optimize.test.ts` — new tests. Existing tests must pass **unchanged**.
- `frontend/src/pages/analysis/OptimizePage.tsx` — slider, table changes, and passing the new
  arguments.
- `REBUILD.md` — append the decision paragraph given below, directly after the paragraph beginning
  "**Weight → Shares keeps share counts that already exist (contract 0124).**"

**Touch nothing else.** In particular, `lib/capm.ts`, `CapmSection.tsx` and `portfolioCsv.ts`
don't change. CAPM calls `applyPlan`, `applyConfirmLines`, `tradeRows` and `tradeBasisNote`, and
must keep today's behaviour through the defaults. If the work appears to need another file, report
`BLOCKED`.

## Interface — `lib/optimize.ts`

Notation: `c` = the portfolio's `cashWeight` (0–100), `p` = the deploy percent (0–100), and
`c′` = cash after deploying.

```ts
/** Cash weight left after deploying `deployPct`% of `cashWeight`. Clamps deployPct to [0, 100].
 *  Returns exactly 0 when deployPct >= 100. */
export function cashAfterDeploy(cashWeight: number, deployPct: number): number

/** Invested dollar value after cash moves in: investedValue × (100 − cashAfter) / (100 − cashWeight).
 *  Returns investedValue unchanged when cashAfter === cashWeight. */
export function deployedInvestedValue(investedValue: number, cashWeight: number, cashAfter: number): number

/** Re-express invested-only fractions as shares of the whole portfolio.
 *  current → current × (100 − cashWeight) / 100, target → target × (100 − cashAfter) / 100,
 *  change → new target − new current. Every other field is copied unchanged. */
export function portfolioShareRows<T extends WeightRow>(rows: T[], cashWeight: number, cashAfter: number): T[]
```

Changes to existing functions. Every new parameter is optional and trailing:

- `applyPlan(portfolio, response, lastCloseByTicker, cashAfter: number = portfolio.cashWeight)`
  - Return `{ ok: false, reason: 'invalid' }` if `cashAfter` is not finite, is `< 0`, or is
    `> portfolio.cashWeight`.
  - Each kept position's weight is `fraction × (100 − cashAfter)`.
  - With `'recomputed'` shares, each position's shares are
    `fraction × deployedInvestedValue(investedValue, portfolio.cashWeight, cashAfter) / price`.
  - The returned portfolio's `cashWeight` is `cashAfter`.
  - With the default, output is identical to today.
- `applyConfirmLines(plan, column = 'Optimized', cashBefore?: number)`
  - When `cashBefore` is given and differs from `plan.portfolio.cashWeight` by at least 0.05, the
    first line becomes: ``Holdings weights will be replaced by the ${column} column, scaled up to use cash. Cash goes from ${cashBefore.toFixed(1)}% to ${plan.portfolio.cashWeight.toFixed(1)}%.``
  - Otherwise the line is unchanged. The `ApplyPlan` type does **not** change, because CAPM
    tests compare plans structurally.
- `tradeBasisNote(basis, deployedDollars: number = 0)`
  - For a dollar basis with `deployedDollars >= 0.005`: ``Trades use each holding's last stored close and fractional shares, on ${formatMoney(basis.investedValue)} invested plus ${formatMoney(deployedDollars)} of cash.``
  - Otherwise unchanged.
- `optimizeCsv(response, basis, cashWeight: number = 0, cashAfter: number = cashWeight)`
  - `current_pct`, `target_pct` and `change_pp` come from `portfolioShareRows(…, cashWeight, cashAfter)`.
  - In dollar shape, `target_shares`, `target_value`, `trade_shares` and `trade_value` come from
    `tradeRows(response, basis, deployedInvestedValue(basis.investedValue, cashWeight, cashAfter))`.
  - `current_value` and `current_shares` are unchanged.
  - **Do not add a CASH row.** The importer derives cash as `100 − Σ target_pct`, and a stated CASH
    row triggers a ±0.01 total check that 2-decimal rounding across many rows can fail.
  - With the defaults, output is byte-identical to today.

Order of operations for dollar rows: call `tradeRows(response, basis, targetValue)` **first**,
which computes values from the invested-only fractions. **Then** map the result through
`portfolioShareRows`. `TradeRow extends WeightRow`, so the generic keeps the type.

## Interface — `OptimizePage.tsx`

- **State:** `const [cashDeployPct, setCashDeployPct] = useState(0)` in `OptimizePage`. After a
  successful Apply, set it back to `0` in `handleConfirmApply`.
- **Derived:** `const cashAfter = current === null ? 0 : cashAfterDeploy(current.cashWeight, cashDeployPct)`.
  Compute it after the `current === null` early return, so it's just
  `cashAfterDeploy(current.cashWeight, cashDeployPct)`.
- **Plan:** call `applyPlan(current, run.response, closes, cashAfter)`.
- **Confirm dialog:** call `applyConfirmLines(plan, 'Optimized', current.cashWeight)`.
- **Results props:** pass `cashDeployPct`, `onCashDeployChange` and `cashAfter` into
  `OptimizeResults`. Widen its `portfolio` prop type only as far as it needs.

Inside `OptimizeResults`:

- **The slider** renders only when `portfolio.cashWeight > 0`. It goes in the Weights card, directly
  under the header row (the one with `Weights`, **Export CSV** and **Apply to portfolio**) and above
  the `applied` message. Copy the existing range sliders' markup and classes. Use `min 0`,
  `max 100`, `step 5`.
  - Label: `` `Cash to deploy: ${cashDeployPct}% · cash ${portfolio.cashWeight.toFixed(1)}% → ${cashAfter.toFixed(1)}%` ``
  - Wrap it in a `Tooltip` (block) with the label shown under Tooltips below.
- **Percent columns:** the rows passed to both tables are `portfolioShareRows(weightRows(response), portfolio.cashWeight, cashAfter)`.
  For the dollar table, use `portfolioShareRows(tradeRows(response, basis, deployedInvestedValue(basis.investedValue, portfolio.cashWeight, cashAfter)), portfolio.cashWeight, cashAfter)`.
  The existing row JSX then needs **no edit**, because it already reads
  `row.current`/`row.target`/`row.change`.
- **Cash row:** when `portfolio.cashWeight > 0`, add one `<tr>` as the last row of whichever table
  is showing. The ticker cell reads `Cash` in plain text; don't use `TickerCell`, since cash isn't a
  link. Use the same `TD` classes, and `—` for cells that don't apply.
  - Weights table: `Current = formatWeight(c / 100)`, `Optimized = formatWeight(c′ / 100)`,
    `Change = formatChangePp((c′ − c) / 100)` with `changeColor`.
  - Dollar table: let `total = basis.investedValue / ((100 − c) / 100)`. The cells are:
    - Price: `—`
    - Current shares: `—`
    - Current value: `formatMoney(total × c / 100)`
    - Current: `formatWeight(c / 100)`
    - Optimized shares: `—`
    - Optimized value: `formatMoney(total × c′ / 100)`
    - Optimized: `formatWeight(c′ / 100)`
    - Trade shares: `—`
    - Trade $: `formatSignedMoney(total × (c′ − c) / 100)` with `changeColor`
    - Change: `formatChangePp((c′ − c) / 100)` with `changeColor`
  - Write the cash row across several lines of JSX. It must **not** be appended to the existing
    long lines.
- **Export CSV:** `optimizeCsv(response, basis, portfolio.cashWeight, cashAfter)`.
- **Basis note:** `tradeBasisNote(basis, basis.kind === 'dollar' ? total × (c − c′) / 100 : 0)`, where
  `total` is as above. Compute it only for a dollar basis.
- **Explanatory copy:** replace the paragraph that begins "Weights are constant-mix". Today it
  appends "Cash (x%) is left out and stays as it is." The new text is:
  `Weights are constant-mix: chosen as if held at these proportions every day. The optimizer and backtest use invested holdings only; the table shows each holding's share of the whole portfolio, cash included.`
  The backtest, metrics, chart and pinned banner are **unchanged**. They stay invested-only.

`REBUILD.md` paragraph, verbatim:

```
**Optimize can deploy cash without a re-run (contract 0126).** The optimizer fits invested holdings only, so its target weights are a mix, not an allocation. A "Cash to deploy" slider (0–100% of current cash) sets cash after to `c × (1 − p)` and scales every holding to `fraction × (100 − c′)`, keeping the Optimized proportions. The backtest and metrics are unaffected because they never saw cash. The Weights table and CSV now show shares of the **whole** portfolio with a Cash row in the table. This also fixed a silent loss: `target_pct` used to be invested-only and summed to 100, so re-importing an export of a portfolio holding cash set cash to 0. The export deliberately has no CASH row; the importer derives cash as `100 − Σ target_pct`. CAPM's Apply and export are unchanged.
```

## Out of scope

- No backend change. The optimizer request is unchanged: cash still isn't an asset it optimizes.
- No change to CAPM (`capm.ts`, `CapmSection.tsx`), even though it shares these helpers.
- Don't add the slider to `OptimizeSettings`, `sameSettings` or `DEFAULT_SETTINGS`. It's
  post-processing and must not trigger "Settings have changed since this run".
- Don't change the backtest chart, the metric tiles, the pinned banner or `OptimizerGuide`.
- Don't add a CASH row to the CSV.
- Don't reformat unrelated code, and don't touch the three existing long JSX lines except where a
  value they use must change. The design above means none should need to.

## Acceptance criteria

1. `npx tsc -p tsconfig.app.json --noEmit` exits 0 (run from `frontend/`).
2. `npm run lint` shows no warnings in `optimize.ts`, `optimize.test.ts` or `OptimizePage.tsx`.
3. `npm test` passes, and **every pre-existing test in `optimize.test.ts` and `capm.test.ts` is
   unchanged**. `git diff frontend/src/lib/optimize.test.ts` shows only additions: no `-` lines
   except the import block.
4. New tests use the file's existing `PORTFOLIO`, `DOLLAR_PORTFOLIO`, `DOLLAR_BASIS`, `RESPONSE`
   and `CLOSES`. Both portfolios have 10% cash; the dollar basis has $900 invested, so $1000 total.
   Assert at least the following. Use `toBeCloseTo(x, 6)` for any computed float; don't use exact
   equality on floats.
   - (a) `cashAfterDeploy(10, 0) === 10`, `cashAfterDeploy(10, 50)` ≈ 5,
     `cashAfterDeploy(10, 100) === 0`, `cashAfterDeploy(10, 150) === 0`,
     `cashAfterDeploy(10, -5) === 10`.
   - (b) `deployedInvestedValue(900, 10, 0)` ≈ 1000, `(900, 10, 5)` ≈ 950, and `(900, 10, 10) === 900`.
   - (c) `applyPlan(PORTFOLIO, RESPONSE, CLOSES, 0)` gives weights ≈ [62, 18, 20] and
     `cashWeight === 0`.
   - (d) `applyPlan(DOLLAR_PORTFOLIO, RESPONSE, CLOSES, 0)` gives shares ≈ `[12.4, 12, 4].map(s => s * 1000 / 900)`.
   - (e) `applyPlan(PORTFOLIO, RESPONSE, CLOSES, 5)` gives weights ≈ `[0.62, 0.18, 0.2].map(f => f * 95)`
     and `cashWeight` 5.
   - (f) `applyPlan(PORTFOLIO, RESPONSE, CLOSES, 11)` and `applyPlan(PORTFOLIO, RESPONSE, CLOSES, -1)`
     both return `{ ok: false, reason: 'invalid' }`.
   - (g) `applyConfirmLines(planFrom(c), 'Optimized', 10)[0]` equals
     `'Holdings weights will be replaced by the Optimized column, scaled up to use cash. Cash goes from 10.0% to 0.0%.'`,
     where `planFrom(c)` is the plan from (c). With `cashBefore` equal to the plan's own cash, the
     line is today's text.
   - (h) `tradeBasisNote(DOLLAR_BASIS, 100)` equals
     `"Trades use each holding's last stored close and fractional shares, on $900.00 invested plus $100.00 of cash."`
   - (i) `optimizeCsv(RESPONSE, { kind: 'weights', reason: 'no-shares' }, 10, 10)`: the AAA line is
     `AAA,45,55.8,10.8,false`. That's current 50 × 0.9, target 62 × 0.9, change 55.8 − 45.
   - (j) `optimizeCsv(RESPONSE, DOLLAR_BASIS, 10, 0)`: AAA's `target_value` is `620` and
     `target_pct` is `62`, and `current_pct` is `45`.
   - (k) **Round trip:** parse (i)'s output with `parsePortfolioCsv` (import it from
     `./portfolioCsv`) against `new Set(['AAA', 'BBB', 'YNG'])`. The seed's `cash` parses to ≈ 10.
     Parsing (j)'s output instead gives ≈ 0. (Importing a function in the test file is fine; the
     source file stays untouched.)
   - (l) `portfolioShareRows` doesn't mutate its input rows.
5. `grep -n "cashDeployPct" frontend/src/lib/optimize.ts` prints nothing (the slider state lives in
   the page), and `grep -n "cashDeployPct" frontend/src/pages/analysis/OptimizePage.tsx` prints at
   least 3 lines.
6. `grep -n "is left out and stays as it is" frontend/src/pages/analysis/OptimizePage.tsx` prints
   nothing.
7. `grep -c "Optimize can deploy cash without a re-run" REBUILD.md` prints `1`.
8. Run `awk 'length > 300 {print FILENAME": "FNR": "length}'` over the three frontend files before
   and after editing, and paste both outputs. The after-edit output must list **no more** lines than
   before: today that is 3, all in `OptimizePage.tsx`. **If you collapse JSX onto single lines,
   the contract fails.**

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output, including failures.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/lib/optimize.ts frontend/src/lib/optimize.test.ts frontend/src/pages/analysis/OptimizePage.tsx   # before AND after
grep -n "cashDeployPct" frontend/src/lib/optimize.ts
grep -n "cashDeployPct" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "is left out and stays as it is" frontend/src/pages/analysis/OptimizePage.tsx
grep -c "Optimize can deploy cash without a re-run" REBUILD.md
git diff frontend/src/lib/optimize.test.ts | grep '^-' | grep -v '^---'
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
git diff --stat
```

## Tooltips

- The Cash to deploy slider: `Move this share of the portfolio's cash into the holdings, keeping the Optimized proportions. Updates the table, Export CSV and Apply to portfolio. No re-run needed.`

No other new interactive elements. The Cash row isn't clickable.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** Run `cd frontend && npm run dev`. Use a portfolio that holds
cash. If none does, create one in **New portfolio** with weights such as 50 / 40 and Cash 10, and
add share counts if you want the dollar table. Open **Analysis → Optimize** and click **Run
optimizer**.

1. The slider shows under the Weights header, and the table ends in a Cash row at 10.0%.
2. Drag it to 100%. The Cash row shows 0.0%, each Optimized % rises by about 1/0.9, and the
   chart and metrics don't change. No "Settings have changed" note appears.
3. Click **Export CSV** at 50%, then import that file in **New portfolio**. Cash should be about 5.
4. Click **Apply to portfolio**. The dialog says "Cash goes from 10.0% to …". After applying, the
   Holdings page shows the new cash.
5. On a portfolio with 0% cash, no slider or Cash row appears, and the table matches today's.

## Open questions

None. If a case isn't covered above, report `BLOCKED`. Don't guess.
