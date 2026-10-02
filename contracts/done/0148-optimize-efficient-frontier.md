# Contract 0148 — Efficient frontier on the Optimize tab

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Every Optimize run also returns an **efficient frontier**, and the Optimize tab draws it below the
"Return: Current vs Optimized" chart. The chart has:

- a curve of the lowest-volatility mix of the fitted holdings at each level of average return,
  within the run's weight limits and short settings;
- four marked points: **Current**, **Optimized** (the run's mode), **Min Variance** and
  **Max Sharpe**;
- an Expand button, through `ExpandableChart`.

It uses the **same fit window, returns, bounds and short cap as the run itself**. So the dots line
up exactly with the weights table: the Max Sharpe dot sits on the curve, and a mode like Min CVaR
sits inside it.

## Why

- **Where it goes:** Gunnar, 2026-10-01: keep the frontier, and put it on the Optimize tab. Holdings
  and Monte Carlo were rejected. Holdings has no lookback, and would recompute on every visit.
  Monte Carlo simulates; it doesn't optimize. See `REBUILD.md`.
- **Why it's part of the run, not a separate route:** a separate call would re-fit, and could drift
  from the run the user is looking at. The planner timed a 25-point sweep of SLSQP solves at
  0.03 s for 5 holdings, 0.06 s for 15 and 0.18 s for 30. That's cheap enough to include in every
  run.
- **Why historical means, not CAPM returns:** `main`'s frontier used CAPM expected returns. The
  rebuild's Optimize modes (Max Sharpe etc.) use **historical** means. If the frontier used CAPM
  returns, the Max Sharpe dot wouldn't be on it. The frontier must describe the same model as the
  modes.
- **Pinned holdings:** pinned holdings (short history) have no covariance over the full window.
  So the frontier and all four dots cover **the fitted holdings only**, as a mix that sums to
  100%. The response lists the excluded tickers, and the chart says so.
- **Dropped from `main`:**
  - **The random-portfolio cloud.** Uniform random weights don't sample the feasible set once
    there are bounds or shorts, so it's misleading noise.
  - **The Risk Parity dot.** Optimize's Risk Parity is one mode among seven; the Optimized dot
    already shows whichever mode ran.
- **Return units on the chart:** annualized arithmetic mean (`mean × 252`) and annualized vol
  (`√(wᵀΣw)`, Σ = daily cov × 252). That's the scale the optimizer uses. It is **not** the CAGR in
  the metric tiles, so the caption says so.

## Files

Backend, modify:
- `backend/app/optimizer.py`: add `efficient_frontier(...)`, see Interface.
- `backend/app/optimize_run.py`: compute the frontier in `run_optimize`, and add `frontier` to
  `OptimizeResult`.
- `backend/app/schemas.py`: `FrontierPointOut`, `FrontierOut`, and
  `OptimizeResponse.frontier: FrontierOut | None`.
- `backend/app/routers/portfolio.py`: `"frontier": result.frontier` in the optimize response.
- `backend/tests/test_optimizer.py`, `backend/tests/test_optimize_run.py`,
  `backend/tests/test_api_optimize.py`: new tests.

Frontend:
- Create `frontend/src/components/FrontierChart.tsx`: a lazy default export, next to
  `OptimizeChart.tsx`.
- `frontend/src/api/client.ts`: `FrontierPoint`, `Frontier`, and
  `OptimizeResponse.frontier: Frontier | null`.
- `frontend/src/lib/optimize.ts`: `frontierChartData`, and `frontierNote`.
- `frontend/src/lib/optimize.test.ts`: tests. If any typed `OptimizeResponse` fixture stops
  compiling, add `frontier: null` to it.
- `frontend/src/pages/analysis/OptimizePage.tsx`: a new card below the "Return: Current vs
  Optimized" card.
- `frontend/src/components/OptimizerGuide.tsx`: one paragraph, see Copy.

Don't touch: Monte Carlo, CAPM and Outlook files, or any other optimizer mode's math.

## Interface

### `optimizer.py`

```python
def efficient_frontier(
    returns: pd.DataFrame,
    *,
    min_weight: float,
    max_weight: float,
    max_short: float | None = None,
    num_points: int = 25,
) -> list[tuple[float, float]]:
    """(vol, ret) pairs, annualized, from the min-variance mix up to the max-return mix."""
```

1. `mu = returns.mean().values * 252` and `cov = returns.cov().values * 252`. Bounds are
   `(min_weight, max_weight)` for every column. Constraints are sum = 1 plus
   `_short_cap_constraint(max_short)`.
2. **Min variance:** SLSQP minimizing `w @ cov @ w`. Use `_run_optimizer`, or the same options.
3. **Max return:** SLSQP minimizing `-(w @ mu)` under the same bounds and constraints.
4. If `max_ret - min_var_ret < 1e-9`, return the single min-variance point.
5. Otherwise, for `num_points` targets evenly spaced from `min_var_ret` to `max_ret` inclusive,
   minimize `w @ cov @ w` with the extra equality `w @ mu == target`.
   - Warm-start each solve from the previous success.
   - **Drop** any target whose solve fails. Don't raise.
6. Return `[(sqrt(w @ cov @ w), w @ mu), ...]` in ascending `ret`.
7. If the min-variance or max-return solve itself fails, raise `RuntimeError`, as the other modes
   do.

### `optimize_run.py`

Add a dataclass:

```python
@dataclass
class FrontierResult:
    points: list[tuple[float, float]]         # (vol, ret)
    current: tuple[float, float]
    optimized: tuple[float, float]
    min_variance: tuple[float, float]         # == points[0]
    max_sharpe: tuple[float, float] | None
    tickers: list[str]                        # fitted holdings the frontier covers
    excluded: list[str]                       # pinned tickers left out
```

Add `frontier: FrontierResult | None` to `OptimizeResult`. In `run_optimize`, after
`fitted_weights` is final (including the non-convergence fallback):

- Call `efficient_frontier(returns, min_weight=min_w, max_weight=max_fit, max_short=sleeve_short)`.
  These are the **same** sleeve-scaled bounds the modes use.
- Define `point(w) = (sqrt(w @ cov @ w), w @ mu)`, with `mu` and `cov` annualized as above, over
  `fitted_tickers` in `returns.columns` order. Then:
  - **current:** `current_weights` restricted to the fitted tickers and renormalized to sum to 1;
  - **optimized:** `fitted_weights`;
  - **max_sharpe:** `optimize_max_sharpe(returns, rf=rf, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)`.
    Reuse `fitted_weights` when `mode == "max_sharpe"`. If it raises `RuntimeError`, use `None`.
- **Failure:** wrap the frontier step in `try/except (RuntimeError, ValueError)`. On failure,
  `frontier = None` and append the warning
  `"The efficient frontier could not be computed for this run."`. A frontier failure must
  **never** fail the run.
- `excluded = pinned_tickers`.

### `schemas.py`

```python
class FrontierPointOut(BaseModel):
    vol: float
    ret: float

class FrontierOut(BaseModel):
    points: list[FrontierPointOut]
    current: FrontierPointOut
    optimized: FrontierPointOut
    min_variance: FrontierPointOut
    max_sharpe: FrontierPointOut | None
    tickers: list[str]
    excluded: list[str]
```

The router converts the tuples to `{"vol": ..., "ret": ...}`, or passes `None`.

### Frontend

`client.ts` mirrors the schema: `FrontierPoint { vol; ret }`, and `Frontier` with the same
fields.

`lib/optimize.ts`:

```ts
export interface FrontierChartData {
  curve: { vol: number; ret: number }[]           // percent units
  markers: { name: string; vol: number; ret: number }[]
}
export function frontierChartData(frontier: Frontier, modeName: string): FrontierChartData
export function frontierNote(frontier: Frontier): string | null
```

- **Units:** everything is ×100, so it's in percent.
- **Markers,** in this order:
  - `Current`;
  - `` `Optimized (${modeName})` ``;
  - `Min Variance`;
  - `Max Sharpe`, only when it's non-null.
  - Pass the page's existing `modeLabel(response.mode)` as `modeName`.
- **`frontierNote`:** `null` when `excluded` is empty. Otherwise:
  `` `Covers ${tickers.join(', ')} only. ${excluded.join(', ')} ${excluded.length === 1 ? 'is' : 'are'} left out for short history, so these points show the other holdings' mix, scaled to 100%.` ``

`FrontierChart.tsx`:

```ts
export default function FrontierChart({ data, size = 'inline' }:
  { data: FrontierChartData; size?: 'inline' | 'expanded' }): JSX.Element
```

- The wrapper is `h-[22rem]` inline and `h-[70vh]` expanded.
- `ResponsiveContainer` > `ScatterChart`, following `CapmChart.tsx`:
  - `XAxis type="number" dataKey="vol"` named "Volatility", with `%` ticks;
  - `YAxis type="number" dataKey="ret"` named "Average return", with `%` ticks and domain
    `['auto', 'auto']`.
- **The frontier:** one `<Scatter name="Efficient frontier" data={curve} line shape={() => null}>`,
  i.e. a line with no dots. If recharts 3 needs a different no-dot idiom, use it and say which.
- **Markers:** one `<Scatter>` per marker, each with its own `name` so the legend lists it. Colors:
  - Current: `var(--color-muted)`;
  - Optimized: `var(--color-primary)`;
  - Min Variance and Max Sharpe: two distinct existing theme variables. Read `CapmChart.tsx` and
    the CSS for what exists, and don't invent hex values.
- `Legend`, and `ChartTooltip` formatting numbers as `` `${v.toFixed(2)}%` ``.
- `isAnimationActive={false}` on every series.

`OptimizePage.tsx`: when `response.frontier !== null`, add a card after the "Return: Current vs
Optimized" card, with the same card classes, holding:

- an `h3` reading **"Efficient frontier"**;
- the muted caption (see Copy), plus the `frontierNote` line when it isn't null;
- `Suspense` + `ExpandableChart title="Efficient frontier"`, with the same fallback as the
  existing chart;
- `FrontierChart` imported only via `lazy(() => import('../../components/FrontierChart'))`.

When `frontier` is null, render no card. The warning already appears with the run's other
warnings.

## Copy

- **Caption:** **"In-sample, over the fit window. Each point on the curve is the lowest volatility
  these holdings could have had for that average return, within your weight limits. Returns here
  are annualized daily averages, not the CAGR shown above. Past behavior, not a forecast."**
- **OptimizerGuide:** a paragraph after the existing closing paragraph:
  **"The efficient frontier chart draws, for each level of average return, the lowest-volatility
  mix of your holdings within your weight limits. Points on the curve are efficient. Points below
  or to the right of it take more risk for the same return. Max Sharpe always sits on the curve.
  Modes that ignore expected return, like Risk Parity or Min CVaR, usually sit inside it."**

## Tests

### `test_optimizer.py`: `efficient_frontier`

Fixture, which is literal:

```python
A = np.tile([0.01, -0.01, 0.01, -0.01], 65) + 0.0002
B = np.tile([0.02, 0.02, -0.02, -0.02], 65) + 0.0006
R = pd.DataFrame({"A": A, "B": B})
```

A and B are exactly uncorrelated. The planner computed:
- annualized means: A 0.0504, B 0.1512;
- min-variance mix 80/20, with ret 0.07056 and vol 0.142260;
- all-B vol 0.318102.

1. With `min_weight=0, max_weight=1`, the result has **25** points.
   - First point: `ret ≈ 0.07056`, `vol ≈ 0.142260`, abs tolerance 1e-4.
   - Last point: `ret ≈ 0.1512`, `vol ≈ 0.318102`, abs tolerance 1e-4.
2. In the same result, `ret` is strictly ascending, and `vol` is non-decreasing within 1e-6.
3. With `max_weight=0.6`, the last point is `ret ≈ 0.11088` and `vol ≈ 0.201186`, abs tolerance
   1e-4 (40/60).
4. **Max Sharpe sits on the curve:** take `optimize_max_sharpe(R, rf=0.0)`. The planner got about
   57/43, with ret 0.0936 and vol 0.16385. Linearly interpolate the frontier's vol at that ret. It
   is within 1e-3 of the Max Sharpe vol.
5. **Equal means give one point:** `pd.DataFrame({"A": A, "B": B - 0.0004})` (both means 0.0002
   daily) returns exactly 1 point.

### `test_optimize_run.py`

Read the existing fixtures first. `CLOSES` holds A, B and the young holding Y.

6. A `min_variance` run, `run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, lookback_days=365)`.
   This mirrors the first existing test.
   - `result.frontier` is not None, with `tickers == ["A", "B"]` and `excluded == []`.
   - `len(points) == 1`. The planner checked that this fixture's A and B both have annualized
     means of about 0 (about 1e-15), so this is the equal-means case.
   - `frontier.min_variance` equals `points[0]`.
   - `frontier.optimized` is within 1e-4 of `points[0]` in both coordinates, since the run is min
     variance.
7. A run with `Y` included (pinned): `frontier.excluded == ["Y"]`, and `frontier.tickers` doesn't
   contain `"Y"`.
8. A `max_sharpe` run: `frontier.max_sharpe == frontier.optimized`.
9. **Failure is contained:** monkeypatch `app.optimize_run.efficient_frontier` to raise
   `RuntimeError("boom")`. The run succeeds, with `result.frontier is None`, and
   `"The efficient frontier could not be computed for this run."` is in `result.warnings`.
10. **The existing non-convergence test still passes:** with `fitted_weights` falling back to
    current weights, the frontier is either computed or None, but the run doesn't raise.

### `test_api_optimize.py`

11. An existing successful optimize call's JSON has a `frontier` object, with `points` as a list
    of `{vol, ret}`, and the keys `current`, `optimized`, `min_variance`, `max_sharpe`, `tickers`
    and `excluded`.

### `lib/optimize.test.ts`

Fixture, which is literal:

```ts
const F: Frontier = {
  points: [{ vol: 0.1, ret: 0.05 }, { vol: 0.2, ret: 0.1 }],
  current: { vol: 0.18, ret: 0.06 }, optimized: { vol: 0.1, ret: 0.05 },
  min_variance: { vol: 0.1, ret: 0.05 }, max_sharpe: null,
  tickers: ['AAA', 'BBB'], excluded: [],
}
```

12. `frontierChartData(F, 'Min Variance')`:
    - `.curve` equals `[{vol: 10, ret: 5}, {vol: 20, ret: 10}]`, using `toBeCloseTo` per field;
    - `.markers.map(m => m.name)` equals `['Current', 'Optimized (Min Variance)', 'Min Variance']`,
      with no Max Sharpe because it's null.
13. With `max_sharpe: { vol: 0.15, ret: 0.08 }`, there are 4 markers, and the last is
    `Max Sharpe` at `vol` ≈ 15.
14. `frontierNote(F)` is `null`.
    `frontierNote({ ...F, tickers: ['AAA', 'BBB'], excluded: ['YYY'] })` equals
    `"Covers AAA, BBB only. YYY is left out for short history, so these points show the other holdings' mix, scaled to 100%."`

## Out of scope

- CAPM-return frontiers, the random-portfolio cloud, and a Capital Allocation Line.
- Clicking a frontier point to get its weights. That's possible later; record it as an idea, and
  don't build it.
- Any change to how the modes optimize.

## Acceptance criteria

Run from the repo root, **in bash**.

1. `awk 'length > 300 {print FILENAME": "FNR": "length}'` over every touched or created frontend
   file prints no new lines. Run it **before and after**, and paste both.
   - New TSX files only: if a line is over 300 characters, run
     `npx --yes prettier@3 --print-width 120 --single-quote --no-semi --write <file>` on that new
     file. Never run it on `OptimizePage.tsx`.
2. `grep -n "def efficient_frontier" backend/app/optimizer.py` prints one line.
   `grep -c "efficient_frontier(" backend/app/optimize_run.py` prints at least `1`.
3. `grep -n "compute_capm_expected_returns\|compute_betas" backend/app/optimize_run.py` prints
   nothing (the frontier uses historical means).
4. `grep -n "random" backend/app/optimizer.py` prints no new lines related to the frontier.
5. `grep -n "from 'recharts'" frontend/src/pages/analysis/OptimizePage.tsx` prints nothing, and
   `grep -c "lazy(" frontend/src/pages/analysis/OptimizePage.tsx` prints `2`.
6. `grep -n "title=" frontend/src/components/FrontierChart.tsx` prints nothing.
7. **Backend tests:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes. Run
   it **before you start** and at the end, and paste both summary lines. "After" = "before" + your
   new tests.
8. **Frontend tests:** `cd frontend && npm test` passes. Run it before you start and at the end.
   "After" = "before" + your new tests.
9. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. Plain `--noEmit` is vacuous
   here; never use it.
10. `cd frontend && npm run lint` exits 0, with only the existing `HelpSidebar.tsx`/`UniversePage.tsx`
    warnings.
11. `cd frontend && npm run build` succeeds, and then
    `grep -l "ResponsiveContainer" dist/assets/index-*.js` prints nothing.
12. **Timing:** write a throwaway script (not committed, in `/tmp`) that runs `run_optimize` on 30
    synthetic holdings with 1250 business days of random closes and seed 0. Print the elapsed
    seconds with the frontier, and with `efficient_frontier` monkeypatched to return `[]`. Paste
    both. It must be at most **1.0 s more** with the frontier. Any ad-hoc python must be run with
    `DATABASE_URL=""` in front.
13. **Smoke render:** if `/Applications/Google Chrome.app` exists, run
    `node contracts/tools/smoke-render.mjs optimize`, which needs `npm run dev`. Expect no
    `EXCEPTION:` lines and a non-empty `ROOT TEXT`. If Chrome is absent, say so.

`BLOCKED` is the right answer to a criterion that cannot be satisfied, and to an undecided design
question. Don't find a clever way to pass a criterion. A clever pass is worse than a stop.

## Verification to run and paste

Paste the **complete, verbatim** output of every command, including failures. A summary doesn't
count as output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
bash <<'EOF'
FE="frontend/src/components/FrontierChart.tsx frontend/src/components/OptimizerGuide.tsx frontend/src/api/client.ts frontend/src/lib/optimize.ts frontend/src/pages/analysis/OptimizePage.tsx"
awk 'length > 300 {print FILENAME": "FNR": "length}' $FE 2>/dev/null   # before AND after
grep -n "def efficient_frontier" backend/app/optimizer.py
grep -c "efficient_frontier(" backend/app/optimize_run.py
grep -n "compute_capm_expected_returns\|compute_betas" backend/app/optimize_run.py
grep -n "random" backend/app/optimizer.py
grep -n "from 'recharts'" frontend/src/pages/analysis/OptimizePage.tsx
grep -c "lazy(" frontend/src/pages/analysis/OptimizePage.tsx
grep -n "title=" frontend/src/components/FrontierChart.tsx
EOF
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
npm run build
grep -l "ResponsiveContainer" dist/assets/index-*.js
```

Also paste the timing script and its output (criterion 12), and the smoke render's output or the
reason it was skipped (criterion 13).

## Tooltips

The new card has no new controls. The Expand button is `ExpandableChart`'s, with its own tooltip.
Don't use `title` anywhere.

## Human verification — does Gunnar need to run anything?

**Yes.** Run the backend and frontend, and check at ~1440px and ~390px.

1. **Max Sharpe run:** Optimize a 4+ holding portfolio on Max Sharpe. Below the backtest chart
   there's an "Efficient frontier" card.
   - The curve rises to the right.
   - The Optimized and Max Sharpe dots coincide on the curve.
   - Min Variance is at the curve's left end.
   - Current is on or inside the curve. It can sit left of the curve only if today's weights break
     the Max/Min weight limits.
2. **Risk Parity run:** switch to Risk Parity and run. The Optimized dot moves, usually inside the
   curve, and the curve itself doesn't change.
3. **Limits:** lower Max weight and run. The curve gets shorter, because it can't reach as high a
   return.
4. **Young holding:** a portfolio with a pinned holding shows the "left out for short history" line.
5. **Expand:** Expand opens the chart full size, and Escape closes it.
6. **Help:** the Optimizer guide has the new paragraph at the end.

## Open questions

None.

**Expected edge:** the **Current** dot can sit left of the curve. That happens when today's
weights break the run's limits, e.g. a 50% holding under a 30% Max weight, because the curve only
covers mixes within the limits. That's correct; don't change the bounds for it.

The **Optimized** or **Max Sharpe** dot sitting left of the curve would be a bug. If you see that,
report it with the numbers.

## Audit (planner, 2026-10-01)

The planner re-ran the checks and got the same results as the coder:
- backend 709 passed, frontend 288 passed;
- tsc exit 0, and lint shows only the 2 known warnings;
- the build is OK, and `ResponsiveContainer` isn't in the index bundle.

The code matches the spec. A live run (XLK/MS/GLD/SPY, Max Sharpe) puts the Max Sharpe and
Optimized dots at the same spot on the curve, as intended.

**Gunnar's review: the chart looks worse than `main`'s.** The cause is the spec, not the coder's
work. The run's settings are **not** the cause. At the defaults (Max 100%, Min 0%, long-only)
the bounds are the same as `main`'s fixed (0, 1). The actual gaps, compared with
`main:frontend/app/portfolios/[id]/outlook/page.tsx` ~657–705:

1. **Styling.** This chart has no grid and no axis titles. Its X axis starts at 0, so the curve is
   squeezed into the right half. The line is thin, every marker is the same circle, and the legend
   is at the bottom. `main` has a grid, axis titles, both axes on `auto`, a 3px line, distinct
   marker shapes and the legend on top.
2. **There's no random-portfolio cloud.** The spec left it out. The cloud is what makes the curve
   read as the edge of what's possible.
3. **Historical means are noisier than `main`'s CAPM returns.** This is kept on purpose, because
   CAPM returns would put the Max Sharpe dot off this curve. Over 1 year the live curve spans
   15→37% return; over 5 years it spans 16→24%. The caption now points this out.

## Rework 1 — match `main`'s look, and add a random cloud that respects the limits

This **supersedes** "the random-portfolio cloud" under Out of scope, and acceptance criterion 4.
Everything else above still stands.

### Backend

`optimizer.py`, after `efficient_frontier`:

```python
def random_portfolios(
    returns: pd.DataFrame,
    *,
    min_weight: float,
    max_weight: float,
    count: int = 500,
    seed: int = 42,
) -> list[tuple[float, float]]:
    """(vol, ret) of random long-only mixes inside [min_weight, max_weight], annualized."""
```

- Use the same `mu` and `cov` as `efficient_frontier` (×252).
- Set `n = len(columns)` and `free = 1 - n * min_weight`. If `free < 0`, return `[]`.
- Use `rng = np.random.default_rng(seed)`. Draw in batches of 2000, `rng.dirichlet(np.ones(n), 2000)`,
  for at most **10 batches**.
- Map each batch with `w = min_weight + free * d`, so every row meets the minimum and sums to 1.
- Keep the rows with `w.max() <= max_weight + 1e-12`. Stop once `count` rows are kept, and
  truncate to `count`.
- Return `[(sqrt(w @ cov @ w), w @ mu), ...]` in the order drawn. An empty list is a valid result:
  limits that are too tight leave nothing inside them.

`optimize_run.py`:
- Add `cloud: list[tuple[float, float]]` to `FrontierResult`.
- Inside the existing frontier `try`, set
  `cloud = [] if allow_short else random_portfolios(returns, min_weight=min_w, max_weight=max_fit)`.
  There's no cloud with shorts, because Dirichlet only samples long-only mixes.

`schemas.py`: add `cloud: list[FrontierPointOut]` to `FrontierOut`. The router converts it the
same way as `points`. `client.ts` mirrors it.

### Frontend

`lib/optimize.ts`: add `cloud: { vol: number; ret: number }[]` to `FrontierChartData`, in percent,
built from `frontier.cloud`.

`FrontierChart.tsx` restyle. The target is `main`'s chart, using theme variables only, with no
hex values.

- **Height:** the wrapper is `h-[28rem]` inline, and stays `h-[70vh]` expanded.
- **Margin:** give `ScatterChart` a margin that fits the axis titles, e.g.
  `{ top: 8, right: 16, bottom: 28, left: 16 }`. Tune it so neither title is clipped.
- **Grid:** `<CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />`, as in
  `CapmChart.tsx`.
- **Axes:**
  - `XAxis` has `name="Volatility"` and `domain={['auto', 'auto']}` (no more 0 start). Its label
    is **"Annualized volatility"**, at the bottom.
  - `YAxis` has `name="Average return"` and `domain={['auto', 'auto']}`. Its label is
    **"Annualized average return"**, rotated −90°.
  - Both keep their `%` ticks.
- **Legend:** `<Legend verticalAlign="top" />`.
- **Series, in this draw order** (later ones draw on top):
  1. **Random portfolios:** only when `cloud.length > 0`. Use `name="Random portfolios"`,
     `legendType="circle"`, and small dots: radius about 2, fill `var(--color-muted)`,
     `fillOpacity` about 0.25.
  2. **Efficient frontier:** `line={{ stroke: 'var(--color-primary)', strokeWidth: 3 }}` and
     `legendType="line"`. Draw small dots, radius about 3, in `var(--color-primary)`.
  3. **Optimized (mode):** a **hollow ring**, larger than the other markers (`Symbols` size about
     260). It has stroke `var(--color-primary)`, stroke width 2, and no fill. It often sits exactly
     on Max Sharpe or Min Variance, so the ring keeps both visible.
  4. **Current:** a filled circle in `var(--color-accent)`.
  5. **Min Variance:** a diamond in `var(--color-positive)`.
  6. **Max Sharpe:** a star in `var(--color-negative)`.
  - Markers 4–6 use `Symbols` size about 160.
  - The marker colors and shapes match `main`: orange current, green diamond, red star.
- **Shapes:** draw each shape with a custom `shape` render built on recharts' `Symbols`
  (`<Symbols cx={cx} cy={cy} type="star" size={160} … />`). Each series' `legendType` matches
  its shape. If recharts 3 needs a different idiom, use it and say which.
- `frontierChartData` still returns `markers` in the order Current, Optimized, Min Variance,
  Max Sharpe, and tests 12–13 still hold. Map the styles **by marker name**, not by index, and
  render the Optimized marker first.
- `isAnimationActive={false}` on every series, and still no `title=`.

`OptimizePage.tsx` caption: append to the existing caption, as plain text:
- **" Gray dots are random mixes within your limits."**, only when `frontier.cloud.length > 0`;
- always: **" Short lookbacks make this curve jumpy; a longer lookback gives a steadier picture."**

### Tests (add these, and keep every existing one)

`test_optimizer.py`, using the literal A/B fixture `R` above:

R1. `random_portfolios(R, min_weight=0, max_weight=1)` has 500 points.
- Every `vol >= 0.142260 - 1e-6`, which is the min-variance vol.
- Every `ret` is in `[0.0504 - 1e-6, 0.1512 + 1e-6]`.

R2. **Determinism:** calling it twice gives equal lists.

R3. With `max_weight=0.6`, there are 500 points, and every `ret` is in
`[0.09072 - 1e-6, 0.11088 + 1e-6]`. The weights are 40–60% each.

R4. With `min_weight=0.3, max_weight=1`, every `ret` is in `[0.08064 - 1e-6, 0.12096 + 1e-6]`.

R5. With `max_weight=0.5`, there are 2 holdings, so only an exact 50/50 mix fits. The result is
`[]`.

R6. With `min_weight=0.6`, `free < 0`, so the result is `[]`.

`test_optimize_run.py`:

R7. The existing default-settings run (test 6's) has a `frontier.cloud` that is a non-empty list.

R8. A run with `allow_short=True` has `frontier.cloud == []`. Read the existing short-run tests for
the call shape. If the frontier is None on that fixture, find a fixture where it isn't, or report
BLOCKED.

`test_api_optimize.py`:

R9. Test 11's JSON `frontier` also has a `cloud` key, holding a list.

`lib/optimize.test.ts`:

R10. Add `cloud: [{ vol: 0.12, ret: 0.06 }]` to fixture `F`. Then `frontierChartData(F, …).cloud`
is `[{vol: 12, ret: 6}]`, compared with `toBeCloseTo` per field.

### Rework acceptance criteria

Run them in bash from the repo root. Criteria 1–3 and 5–13 above still apply. Criterion 12's
timing covers the cloud too, so the frontier plus cloud must add at most 1.0 s.

- **RW1.** `grep -n "def random_portfolios" backend/app/optimizer.py` prints one line, and
  `grep -n "default_rng(seed)" backend/app/optimizer.py` prints one line.
- **RW2.** `grep -c "CartesianGrid\|verticalAlign=\"top\"\|Annualized volatility\|Annualized average return\|Symbols" frontend/src/components/FrontierChart.tsx`
  prints at least `5`.
- **RW3.** `grep -c "domain={\['auto', 'auto'\]}" frontend/src/components/FrontierChart.tsx` prints `2`
  (the X axis no longer starts at 0).
- **RW4.** `grep -n "#[0-9a-fA-F]\{3,6\}\b" frontend/src/components/FrontierChart.tsx` prints
  nothing.
- **RW5.** Test counts are measured **before you start this rework** and after:
  - backend after = before + 8 (R1–R6 as 6 tests, plus R7 and R8; R9 extends test 11);
  - frontend after = before + 0 or 1, since R10 may extend an existing test.
  - If your split differs, state it.

Paste the full outputs of the original verification block, plus RW1–RW4, the before/after test
summary lines, and the timing script.

### Human verification (replaces step 1 above)

Run a 4+ holding portfolio on Max Sharpe, with a **5-year** lookback.
- The chart has a grid, axis titles and the legend on top.
- There's a gray cloud, and the blue curve hugs its upper-left edge.
- The red star sits inside the primary-colored ring, on the curve.
- The green diamond is at the curve's left end.
- The orange dot is Current.

Then switch to a 1-year lookback: the curve stretches, which is expected. Then enable shorts: the
cloud disappears and the curve still draws. Steps 2–6 above still apply.

## Acceptance (planner, 2026-10-01)

**The planner re-ran these checks:**
- **Tests:** backend 717 passed (709 + 8), frontend 288 passed (R10 extended an existing test).
- **Gates:** tsc exit 0, and lint shows only the 2 known warnings. The build is OK, and
  `ResponsiveContainer` isn't in the index bundle.
- **Greps:** RW1–RW4 pass: RW2 = 7, RW3 = 2, no hex values, no `title=`, and no line over 300
  characters. The `SyntaxWarning` the coder mentions doesn't appear in the planner's pytest run, so
  it came from the throwaway script.

**Live API on Gunnar's backend** (XLK/MS/GLD/SPY, 5-year lookback):
- **Max Sharpe:** 500 cloud points and 25 curve points. Max Sharpe equals Optimized. The cloud's
  lowest vol is 13.97%, and the curve starts at 13.65%. The cloud's highest return is 23.2%, and
  the curve's is 23.9%. So the cloud sits inside the curve, as it should.
- **Shorts on:** the cloud is empty and the curve still draws.
- **Max weight 30%:** 159 cloud points, so it's sparser under tight limits, as designed. The
  cloud's lowest vol is 16.48%, and the curve's is 16.35%.

**Accepted.** The browser render (the Human verification for Rework 1) is still Gunnar's to do,
because Chrome isn't installed.
