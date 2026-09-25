# Contract 0111 — Import optimization-result CSVs as portfolios

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

`parsePortfolioCsv` accepts the CSVs the Optimize tab exports (`optimizeCsv` in
`frontend/src/lib/optimize.ts`). A new portfolio takes its weights from `target_pct` and its share
counts from `target_shares`. Every existing format imports exactly as it does today.

## Why

Gunnar wants to turn an optimizer result into a new portfolio through the existing import flow.
The export has two shapes, and both must import:

- **Dollar mode:**
  `ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned`
- **Weights only:** `ticker,current_pct,target_pct,change_pp,pinned`

Decisions already made. Do not revisit them.

- **Target columns replace, never add.** `target_pct` is the weight and `target_shares` is the share
  count. `current_*` is never read.
- **Shorts are rejected, not clipped.** Portfolios cannot hold short positions. Clipping a short to
  zero, or dropping it, would silently change the allocation the optimizer produced. The error names
  every short ticker.
- **A 0% target means "hold none" and is left out.** This is not an error. Optimizers routinely set
  weights to exactly 0, and the export writes those rows. The existing parser rejects a weight of 0,
  which would make most long-only exports unimportable. The left-out tickers are listed in the import
  review.
- **Rounding overshoot is trimmed, visibly (Gunnar's call, 2026-09-24).** The export rounds
  `target_pct` to 2 decimals, so a valid long-only result can sum to slightly over 100. Measured by
  simulation: about 1% of 6-holding exports, 4% at 10 and 12% at 20 exceed the current `100.01`
  limit. An overshoot small enough to come from rounding is taken from the largest position, and the
  review says so. Anything larger is still rejected. This is the one deliberate exception to "visible
  and wrong beats silently normalized", and it is scoped to target columns only.
- **An imported optimizer result starts at about 0% cash.** The export carries no cash row, and its
  `target_pct` is a share of the invested sleeve. This is accepted; do not try to recover cash.
- The example file `reference files/portfolios/Gunnar Preset V2-optimize-min_variance-2026-09-24.csv`
  has four short targets, so it must be **rejected** with the short error. That is correct
  behaviour, not a failure of this contract.

## Files

Modify:
- `frontend/src/lib/portfolioCsv.ts`: the parser changes below, plus the two optional result fields.
- `frontend/src/components/NewPortfolioDialog.tsx`: show the two new review notices. No other change.
- `frontend/src/lib/portfolioCsv.test.ts`: new tests only, in one new `describe` block at the end
  of the file. **Do not edit any existing test or assertion.**

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. That includes `optimize.ts`, since the export is out of
scope, and `portfolio.ts`.

**`reference files/` is read-only.** Every fixture you need is written out below. Tests must use
inline strings and never read a path under `reference files/` (see REBUILD.md, "A test fixture must
live under `frontend/src/`").

## Interface

### Result type

Add two **optional** fields to the success branch. Nothing else in the type changes:

```ts
export interface TargetAdjustment {
  ticker: string        // the position that was reduced
  fromPct: number       // its target_pct as written in the file
  toPct: number         // its weight after the trim
  fileTotalPct: number  // sum of the file's position target_pct values, before the trim
}

export type CsvImportResult =
  | { ok: true; seed: DraftSeed; dropped: DroppedRow[]; adjustment?: TargetAdjustment; zeroTargets?: string[] }
  | { ok: false; error: string; line: number | null }
```

**Set each key only when it applies.** `adjustment` appears only when a trim happened.
`zeroTargets` appears only when at least one row was left out. On every other result both keys are
**absent**: not `undefined`, not `[]`. This matters because existing tests compare whole results with
`toEqual`, and those tests must pass unedited.

### Column resolution

- `weightIndex`: the column named `target_pct` if the header has one, otherwise the existing
  `['weight_pct', 'weight']` lookup.
- `sharesIndex`: the column named `target_shares` if the header has one, otherwise the existing
  `['shares', 'quantity', 'qty']` lookup.
- Header matching stays exact and case-insensitive, as `headerIndex` does now. `current_pct`,
  `current_shares`, `price`, `current_value`, `target_value`, `trade_shares`, `trade_value`,
  `change_pp` and `pinned` must not be read. Verify that none of them matches an existing alias.
- Let `targetWeights = (the header has target_pct)`. **Every rule in the next section applies only
  when `targetWeights` is true.** A file without `target_pct` follows today's code path unchanged.
  That includes today's error messages, the `100.01` limit, and the rejection of a zero or negative
  `weight_pct`.

### Rules when `targetWeights` is true

Apply them in this order. Each rule looks at the whole file (off-universe rows included) before any
universe drop, as the existing "validate the whole file before dropping any row" rule requires.

1. **Non-finite target.** If a position row's `target_pct` is not blank and `Number(raw)` is not
   finite, fail with `Target weight for ${ticker} must be a number` and that row's line. A blank
   `target_pct` behaves as a blank weight does today.
2. **Shorts.** Collect every position row whose `target_pct` is finite and `< 0`. If there are any,
   fail with this message and the **first** short row's line:
   `Short target weights can't be imported: ${list}. Portfolios hold long positions only; re-run the optimizer with shorting turned off.`
   Here `list` joins `${ticker} (${raw.trim()}%)` with `, `, in file order. This check must run
   **before** the per-row shares validation. Short rows also have negative `target_shares`, and the
   short error, not `Shares for X must be…`, must be the one reported.
3. **Zero targets.** A position row whose `target_pct` satisfies `Number(raw) === 0` (this covers
   `0`, `0.00` and `-0`) is left out. It is not a position, it is not in `dropped`, and its
   `target_shares` is not validated. Its ticker goes into `zeroTargets`, in file order.
4. **Remaining rows** go through the existing per-row logic: duplicate tickers, `CASH`, the shares
   check and so on.
5. **Overshoot.** Let `fileTotal` be the sum of the remaining positions' target weights, in file order.
   If there is **no** stated `CASH` row and `fileTotal - 100 > WEIGHT_EPSILON` (`1e-9`, import it
   from `./portfolio`):
   - Let `bound = Math.max(0.01, 0.005 * n)`, where `n` is the number of remaining position rows.
   - If `fileTotal - 100 > bound`, fail with
     `Target weights add up to ${fileTotal.toFixed(2)}%, which is more than export rounding can explain.`
     and line `null`.
   - Otherwise, **after the universe drop**, reduce the largest **surviving** position by
     `fileTotal - 100`. Ties go to the first one in file order. Its new weight string is
     `String(Number((weightPct - (fileTotal - 100)).toFixed(6)))`. Set `adjustment`, and set the seed's
     `cash` to `String(droppedWeight)`, where `droppedWeight` is `'0'` when nothing was dropped.

   A stated `CASH` row keeps today's rule, with no trimming.
6. **Cash when nothing was trimmed.** Compute cash as today, then pass it through
   `String(Number(value.toFixed(6)))` so a rounding residue shows as `0.01`, not
   `0.010000000000005116`. If `Math.abs(value) < WEIGHT_EPSILON`, use `'0'`. This applies to target
   files only.

`mode` is `'weight'` whenever `targetWeights` is true. Surviving rows carry `shares` from
`target_shares` when present, so contract 0099's shares-through-weight-mode path saves them.

### Dialog notices (`NewPortfolioDialog.tsx`)

Add state alongside `droppedRows`:
`const [adjustment, setAdjustment] = useState<TargetAdjustment | null>(null)` and
`const [zeroTargets, setZeroTargets] = useState<string[]>([])`.

Reset both in every place `setDroppedRows([])` is called now. Set both where `setDroppedRows(result.dropped)`
is called, using `result.adjustment ?? null` and `result.zeroTargets ?? []`. This covers both the
file-import and preset paths.

Render the notices directly after the existing dropped-rows block, in the same
`text-xs text-[var(--color-muted)]` style. Each one appears only when it applies. Copy, exactly:

- Zero targets:
  `Left out ${n} ${n === 1 ? 'ticker' : 'tickers'} with a 0% target: ${zeroTargets.join(', ')}.`
- Adjustment:
  `Target weights in the file add up to ${formatPercent(adjustment.fileTotalPct)} because the export rounds them. ${adjustment.ticker} was reduced from ${formatPercent(adjustment.fromPct)} to ${formatPercent(adjustment.toPct)} so the portfolio totals 100%.`

`formatPercent` is already imported in that file.

## Out of scope

- The optimize export (`optimizeCsv`, `optimizeCsvFilename`) and every backend file.
- Stripping `-optimize-<mode>` from the filename-derived name. It stays as
  `portfolioNameFromFilename` produces it.
- Recovering a cash weight for optimizer imports.
- Trimming, or any other change, for files without `target_pct`.
- Tests for `NewPortfolioDialog`. The project does not test components.
- No new dependencies.

## Acceptance criteria

All fixtures below are literal. Use them exactly. `universe` is the test file's existing
`new Set(['AAPL', 'MSFT', 'GOOG', 'AMZN'])` unless a fixture says otherwise.

1. **Dollar export, target values win.**
   ```
   ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned
   AAPL,200,10,2000,50,5,1000,25,-5,-1000,-25,false
   MSFT,400,5,2000,50,7.5,3000,75,2.5,1000,25,true
   ```
   The result `toEqual`s
   `{ ok: true, seed: { name: '', mode: 'weight', cash: '0', rows: [{ ticker: 'AAPL', weight: '25', shares: '5' }, { ticker: 'MSFT', weight: '75', shares: '7.5' }] }, dropped: [] }`.
   Neither `adjustment` nor `zeroTargets` is present.
2. **Weights-only export.**
   ```
   ticker,current_pct,target_pct,change_pp,pinned
   AAPL,50,40,-10,false
   MSFT,50,60,10,true
   ```
   The seed `toEqual`s
   `{ name: '', mode: 'weight', cash: '0', rows: [{ ticker: 'AAPL', weight: '40', shares: '' }, { ticker: 'MSFT', weight: '60', shares: '' }] }`.
3. **Target columns beat canonical columns.**
   ```
   ticker,weight_pct,shares,target_pct,target_shares
   AAPL,50,10,20,4
   MSFT,50,10,80,16
   ```
   The rows are `[{ ticker: 'AAPL', weight: '20', shares: '4' }, { ticker: 'MSFT', weight: '80', shares: '16' }]`.
4. **Shorts rejected, even with negative shares.** This is the real export, inlined:
   ```
   ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned
   MU,1080.53,10,10805.3,74.18,-0.657262,-710.19,-4.88,-10.657262,-11515.49,-79.06,false
   VOO,707.6,2.08,1471.81,10.1,20.261565,14337.08,98.43,18.181565,12865.27,88.33,false
   PBR,21.14,47,993.58,6.82,89.303,1887.87,12.96,42.303,894.29,6.14,false
   ORCL,144.56,4.46,644.74,4.43,-4.189537,-605.64,-4.16,-8.649537,-1250.38,-8.58,false
   SHNY,8.81,68.84,606.48,4.16,-30.619489,-269.76,-1.85,-99.459489,-876.24,-6.02,false
   XIACF,3.345,13,43.49,0.3,-22.113077,-73.97,-0.51,-35.113077,-117.45,-0.81,false
   ```
   Test with universe `new Set(['MU', 'VOO', 'PBR', 'ORCL', 'SHNY', 'XIACF'])`. The result `toEqual`s
   `{ ok: false, line: 2, error: "Short target weights can't be imported: MU (-4.88%), ORCL (-4.16%), SHNY (-1.85%), XIACF (-0.51%). Portfolios hold long positions only; re-run the optimizer with shorting turned off." }`.
5. **Zero targets are left out and listed.** Weights only:
   ```
   ticker,current_pct,target_pct,change_pp,pinned
   AAPL,30,0,-30,false
   MSFT,30,40,10,false
   GOOG,40,60,20,false
   ```
   The rows are MSFT `'40'` and GOOG `'60'` only. `zeroTargets` `toEqual`s `['AAPL']`, `dropped` is
   `[]`, and cash is `'0'`.
   Dollar mode, where a zero row's `target_shares` of `0` must not trip the shares check:
   ```
   ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned
   AAPL,100,3,300,30,0,0,0,-3,-300,-30,false
   MSFT,100,7,700,70,10,1000,100,3,300,30,false
   ```
   `ok` is `true`, and the rows are `[{ ticker: 'MSFT', weight: '100', shares: '10' }]`.
6. **Rounding overshoot trimmed.** Universe `new Set(['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA'])`:
   ```
   ticker,current_pct,target_pct,change_pp,pinned
   AAPL,20,40.01,20.01,false
   MSFT,20,30.01,10.01,false
   GOOG,20,20,0,false
   AMZN,20,5,-15,false
   NVDA,20,5,-15,false
   ```
   AAPL's row weight is `'39.99'` and the other rows are unchanged. Cash is `'0'`.
   `adjustment.ticker === 'AAPL'`, `adjustment.fromPct === 40.01`, `adjustment.toPct === 39.99`, and
   `adjustment.fileTotalPct` `toBeCloseTo(100.02, 9)`.
7. **Overshoot beyond rounding rejected.**
   ```
   ticker,target_pct
   AAPL,60.02
   MSFT,40.02
   ```
   The result `toEqual`s
   `{ ok: false, line: null, error: 'Target weights add up to 100.04%, which is more than export rounding can explain.' }`.
8. **Non-finite target.** `'ticker,target_pct\nAAPL,abc\nMSFT,100\n'` gives
   `{ ok: false, line: 2, error: 'Target weight for AAPL must be a number' }`.
9. **Existing formats are unchanged.** Every test that existed in `portfolioCsv.test.ts` and
   `presets.test.ts` before this contract passes **with no edit to it**. In your report, list the
   `it(...)` names you added, and say explicitly that you edited no existing test.
10. `cd frontend && npm run test` exits 0, `npx tsc -p tsconfig.app.json --noEmit` exits 0, and
    `npm run build` succeeds.
11. `grep -cF 'adjustment?: TargetAdjustment' frontend/src/lib/portfolioCsv.ts` prints `1`, and
    `grep -cF 'Left out ${' frontend/src/components/NewPortfolioDialog.tsx` prints `1`. Use `-F`
    because both patterns contain regex metacharacters.
12. State in your report which files you edited. Do not use `git diff` or `git status` to prove
    this. Nothing is committed between contracts, and other work is uncommitted in the same tree.

If any criterion cannot be met without breaking another, or without editing a file not listed or an
existing test, report `BLOCKED`. `BLOCKED` is the correct answer to an unsatisfiable contract, not
only to an undecided design question. Do not find a clever way to pass a criterion.

## Verification to run and paste

Paste the complete, verbatim output, including failures.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend && npm run test
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend && npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend && npm run build
grep -cF 'adjustment?: TargetAdjustment' /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/lib/portfolioCsv.ts
grep -cF 'Left out ${' /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/components/NewPortfolioDialog.tsx
```

## Tooltips

This contract adds no interactive element. Both notices are plain text.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** `cd frontend && npm run dev`, then open http://localhost:5173/portfolios
and use New Portfolio → Import.

1. Import `reference files/portfolios/Gunnar Preset V2-optimize-min_variance-2026-09-24.csv`. The
   short-weights error should appear in red, naming MU, ORCL, SHNY and XIACF. No draft opens.
2. On the Optimize tab, run a **long-only** optimization and export it in dollar mode, then import it.
   The draft should show the Optimized weights, not the current ones. After creating the portfolio,
   Holdings → Shares should show the target share counts.
3. Export the same result without share counts (weights only) and import it. The weights should
   match, and Shares should show `—`.
4. If either export has a 0% row or triggers the rounding trim, the corresponding notice should
   appear under the import button.
5. Import an ordinary portfolio export. It should behave exactly as before, with no new notices.

## Open questions

None. Anything that looks undecided is `BLOCKED`, not a judgment call.
