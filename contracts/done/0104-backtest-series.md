# Contract 0104: `backtest_series`, a pure scoring curve for Optimize

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Add one pure function, `backtest_series(weights, closes, rebalance="none", anchor_value=100.0)`, to
`backend/app/portfolio_series.py`. It produces the value curve that the Optimize tab uses to **score**
the Current and Optimized portfolios.

- It buys at the start of the window, then either holds (`"none"`) or resets to the target weights at
  the first trading day of each month, quarter or year.
- It returns the total and per-holding series, and the per-holding series sum to the total.
- It has no database, endpoint or UI code. The endpoint is 0105.

## Why

REBUILD.md, "The Backtest tab becomes Optimize", says **picking and scoring are two jobs**:

- **Picking** uses the reference's constant-mix objective. That is 0103's `app/optimizer.py`.
- **Scoring** uses buy-and-hold from the window start, with an optional rebalance. It is built on the
  existing `units_from_weights` / `value_series` seam, anchored at the window start rather than today,
  so there is no look-ahead.
- Cash is excluded, since the chart shows invested holdings only.
- There is **no flat fill before a holding's first bar**. The window starts at the latest first bar.

This contract is the scoring function alone.

## Files

Modify:
- `backend/app/portfolio_series.py`: **append** the dataclass and function below. Do not change
  `align_closes`, `units_from_weights`, `value_series`, `build_portfolio_series` or `PortfolioSeries`.
- `backend/tests/test_portfolio_series.py`: **append** tests. Leave the existing tests unchanged.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and report
`BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** The same applies to
`~/WebstormProjects/blue-eagle-reference`. Read `main` only through `git show main:<path>`. There is no
`main` equivalent of this function. `main` scored with daily-rebalanced constant weights, and this
replaces that on purpose.

**`backend/.env` holds the live production database URL.** Every ad-hoc `python -c` must be prefixed
with `DATABASE_URL=""`.

## Interface

```python
Rebalance = Literal["none", "monthly", "quarterly", "annual"]

@dataclass(frozen=True)
class BacktestSeries:
    dates: list[date]                    # from `start` to the last date, inclusive
    total: list[float]                   # total[0] == anchor_value
    by_holding: dict[str, list[float]]   # same keys and order as `weights`; sums to total on every date
    start: date                          # the latest first bar among the weighted tickers
    rebalance_dates: list[date]          # dates units were reset; never includes `start`

def backtest_series(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    rebalance: Rebalance = "none",
    anchor_value: float = 100.0,
) -> BacktestSeries: ...
```

Every float in the output is a Python `float`, not a numpy scalar.

### Rules

1. **Validation.** Raise `ValueError` in each of these cases. The messages are not asserted.
   - `weights` is empty.
   - `sum(weights.values()) <= 0`.
   - A weighted ticker is missing from `closes`, or its series is empty.
   - `rebalance` is not one of the four values.
2. **Normalisation.** Divide the weights by their sum. Negative weights are allowed (shorts), and they
   produce negative units and negative holding values. Tickers in `closes` but not in `weights` are
   ignored.
3. **Window.** `start` is the maximum, across the weighted tickers, of each series' first index date.
   Align the weighted tickers' closes on the union of their dates, keep only dates `>= start`, and
   forward-fill interior gaps. Do **not** back-fill. Because every ticker has a bar at or before
   `start`, no value is missing after the forward fill. Use `align_closes` only if you can show it
   gives the same result. Its `bfill` is what this function must avoid, so writing the steps out
   directly is fine.
4. **Initial units.** On `start`, set `units = w × anchor_value / close_start` for each ticker. Reusing
   `units_from_weights(normalised, 0.0, prices_at_start, anchor_value)` is preferred.
5. **Rebalance dates.** A date `d` after `start` is a rebalance date when its period key differs from
   the previous row's:
   - `"monthly"`: `(year, month)`
   - `"quarterly"`: `(year, (month - 1) // 3)`
   - `"annual"`: `year`
   - `"none"`: no rebalance dates.

   Do not use `resample` or calendar month-starts. It is the **first row present** in the new period.
6. **Rebalancing at the close.** On a rebalance date `d`:
   - First value the portfolio with the **old** units at `d`'s close to get `V`.
   - Then set the new units to `w × V / close_d`.
   - `total[d]` equals `V` either way. `by_holding[d]` reports the **new** units × `close_d`, which is
     the post-rebalance mix.
   - Segments therefore run `[rebalance_date_k, rebalance_date_{k+1})`. `value_series` can value each
     segment.
7. **No cash.** There is no `cash_value`. `sum(by_holding[t][i]) == total[i]` for every `i` (±1e-9).

## Out of scope

- Metrics, the SPY curve, the lookback slice, warnings and the endpoint all belong to 0105. The caller
  slices `closes` to the lookback before calling. This function does not.
- Don't edit `app/optimizer.py`, `app/returns.py` or any router.

## Fixtures (literal)

```python
from datetime import date

def S(values, dates):
    return pd.Series(values, index=list(dates), dtype=float)

X3 = [10, 20, 10]
Y3 = [10, 10, 10]
QTR = (date(2024, 3, 28), date(2024, 4, 1), date(2024, 4, 2))    # crosses a month and a quarter
YEAR = (date(2023, 12, 29), date(2024, 1, 2), date(2024, 1, 3))  # crosses a month, a quarter and a year
MID = (date(2024, 1, 10), date(2024, 1, 11), date(2024, 1, 12))  # crosses nothing

D5 = (date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4), date(2024, 1, 5), date(2024, 1, 8))
```

Hand-computed with weights `{"X": .5, "Y": .5}` and anchor 100 on `X3`/`Y3`:

- Without a rebalance, the units are X 5 and Y 5, and the totals are **[100, 150, 100]**.
- With a rebalance on the middle date, `V = 150`, and the new units are X 75/20 = 3.75 and Y 75/10 = 7.5.
- The last total is then 37.5 + 75 = **112.5**. `by_holding` on the middle date is X 75, Y 75, and on
  the last date X 37.5, Y 75.

## Acceptance criteria

Tolerance is **±0.01** unless one is given. Never assert float equality.

1. `(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q)` passes. The count is **555 + at
   least 10**. Paste the before and after counts.
2. **Rebalance table.** One parametrized test using `X3`/`Y3` on each date triple. It asserts
   `total[-1]` and `rebalance_dates`:

| dates | none | monthly | quarterly | annual |
|---|---|---|---|---|
| `QTR` | 100, `[]` | 112.5, `[QTR[1]]` | 112.5, `[QTR[1]]` | 100, `[]` |
| `YEAR` | 100, `[]` | 112.5, `[YEAR[1]]` | 112.5, `[YEAR[1]]` | 112.5, `[YEAR[1]]` |
| `MID` | 100, `[]` | 100, `[]` | 100, `[]` | 100, `[]` |

3. **Full series, monthly on `QTR`:**
   - `total == [100, 150, 112.5]`
   - `by_holding == {"X": [50, 75, 37.5], "Y": [50, 75, 75]}`
4. **Buy and hold, none on `QTR`:**
   - `total == [100, 150, 100]`
   - `by_holding == {"X": [50, 100, 50], "Y": [50, 50, 50]}`
5. **Late start, no flat fill.** Use `X = S([10, 20, 20, 10, 10], D5)` and `Y = S([10, 10, 20], D5[2:])`
   with weights .5/.5 and `"none"`. Expect:
   - `start == D5[2]` and `dates == list(D5[2:])`
   - `total == [100, 75, 125]`
   - `by_holding["X"] == [50, 25, 25]`
6. **Interior gap forward-fills.** Use `X = S(X3, MID)` and `Y = S([10, 30], (MID[0], MID[2]))` with
   weights .5/.5 and `"none"`. Expect:
   - `dates == list(MID)`
   - `total == [100, 150, 200]`. On `MID[1]`, Y is filled at 10, so the total is 5×20 + 5×10 = 150.
     On `MID[2]` it is 5×10 + 5×30 = 200.
7. **Normalisation.** `{"X": 2, "Y": 2}` gives the same `total` as `{"X": .5, "Y": .5}` on `QTR`. An
   extra ticker in `closes` that is not in `weights` is ignored: its key is absent from `by_holding`
   and the total is unchanged.
8. **Shorts.** Use `{"X": 1.5, "Y": -0.5}` on `QTR` with `"none"`. Expect:
   - `total == [100, 250, 100]`
   - `by_holding["Y"] == [-50, -50, -50]`
9. **Sum invariant.** On `SEEDED`-like random data, sum-of-holdings equals the total within 1e-9 on
   every date, for all four rebalance modes. Build 300 business days from 2023-01-02 with
   `np.random.default_rng(3)`, prices `100 * cumprod(1 + normal(0, .01))` for three tickers, and
   weights `{A: .5, B: .3, C: .2}`. Also assert `total[0] == 100` (±1e-9).
10. **Errors.** Each of these raises `ValueError`:
    - `weights={}`
    - `{"X": 1, "Y": -1}` (the sum is 0)
    - a weighted ticker absent from `closes`
    - `rebalance="weekly"`
11. **Existing behaviour untouched.**
    `git diff --stat backend/app/portfolio_series.py backend/tests/test_portfolio_series.py` shows only
    insertions (no `-` count). Also, `grep -n "return prices.ffill().bfill()" backend/app/portfolio_series.py`
    prints one line.

If a criterion cannot be met as written, for example if a hand-computed value above is wrong,
**report `BLOCKED` and show the value you got and your arithmetic**. Don't change a fixture or the
expected value to make it pass.

## Verification to run and paste

Run each from the repo root. Paste the **complete, verbatim** output.

```bash
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q 2>&1 | tail -3)
(cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q tests/test_portfolio_series.py -v 2>&1 | tail -40)
git diff --stat backend/app/portfolio_series.py backend/tests/test_portfolio_series.py
grep -n "return prices.ffill().bfill()\|^def backtest_series\|^class BacktestSeries" backend/app/portfolio_series.py
git status --short
```

## Tooltips — required for any contract adding interactive elements

This is a backend-only contract with no interactive elements.

## Human verification — does Gunnar need to run anything?

No. This is pure math, and the hand-computed fixtures prove it.

## Open questions

None.
