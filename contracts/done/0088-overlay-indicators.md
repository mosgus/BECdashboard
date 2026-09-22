# Contract 0088 — Five overlay indicators: Bollinger, Donchian, ADX, Stochastic, OBV

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

> ## ⚠ REVISED 2026-09-22 — re-read this file before executing
>
> **Criteria 8 and 9 were ambiguous and are now written as literal series.** They described fixtures
> in prose — "three rising days" — which does not specify the bar count. OBV's first bar has no prior
> close and contributes zero, so a three-bar series of rises gives 200 and a four-bar series gives
> 300. Both readings were defensible and I meant the second.
>
> **The previous run reported `BLOCKED` rather than implementing a non-standard OBV to satisfy the
> number, which was exactly right.** The reference formula is correct and is unchanged.
>
> Do not execute from a remembered copy. Read this from disk, in a fresh session.

## Goal

`app/indicators.py` gains the five pure functions the `/ticker` page's overlays need, each with
known-value tests.

## Why

Slice 2 of the `/ticker` page, Gunnar's call 2026-09-22. **This contract is the maths only** — no
endpoint, no frontend, nothing consumes these yet.

`compute_sma`, `compute_ema`, `compute_rsi`, `compute_macd` and `compute_atr` landed in contract 0082.
These five complete the set the reference's page offers.

The split is deliberate and follows 0082's shape, which worked: numerical code lands with its tests
and gets audited on its own, before an endpoint and a chart make it harder to see. `REBUILD.md`:
*"a wrong Sharpe ratio looks entirely plausible."*

**The two contracts that follow:** 0089 the endpoint, 0090 the toggles and chart overlays.

## Files

Modify:
- `backend/app/indicators.py` — the five functions.
- `backend/tests/test_indicators.py` — the tests below.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not change the five existing indicators, `signals.py`, `returns.py`, any schema, any router, or any
frontend file.

**`reference files/` is read-only and never belongs on a file list.** Read the reference in place with
`git show main:backend/core/indicators.py` — lines 115-224 hold all five. It is a reference, not a
template: its guards are thinner than this contract requires.

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** It works and is honoured as a
> deliberate opt-out. `app/config.py` calls `load_dotenv()` at import and `backend/.env` holds a live
> Render connection string, so an unprefixed script talks to the **production database**.

## Interface

```python
def compute_bollinger(series: pd.Series, window: int = 20, num_std: float = 2.0
                      ) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Upper band, middle (SMA), lower band."""

def compute_donchian(high: pd.Series, low: pd.Series, window: int = 20
                     ) -> tuple[pd.Series, pd.Series]:
    """Rolling highest high and lowest low over `window`."""

def compute_adx(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 14) -> pd.Series:
    """Average Directional Index, Wilder smoothing. 0-100, direction-agnostic."""

def compute_stochastic(high: pd.Series, low: pd.Series, close: pd.Series,
                       k_window: int = 14, d_window: int = 3) -> tuple[pd.Series, pd.Series]:
    """%K and %D."""

def compute_obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """On-balance volume, cumulative."""
```

Port the reference's formulas. **Do not invent variants** — these are standard indicators and a
non-standard one disagreeing with every charting site is a defect regardless of how principled the
deviation is. `REBUILD.md` records that lesson from contract 0083, where an RSI "correction" would
have diverged from TradingView.

### The three guards the reference does not have

**1. Stochastic with a zero range.** When the highest high equals the lowest low over the window,
`(close - low) / (high - low)` divides by zero. Return **`NaN`**, not a number.

**Do not reuse the RSI-50 precedent here.** RSI has a conventional midpoint — 50 means "no net
momentum" and every implementation agrees. A stochastic over a zero-range window has **no defined
value**, and inventing 50 would assert a position in a range that does not exist. `NaN` becomes
`null` in the response and the chart skips the point, which is the honest rendering.

**2. ADX division guards.** The directional-index calculation divides by the true range and then by
the sum of +DI and −DI. Either can be zero on a flat stretch. Guard both; produce `NaN`, not `inf`
and not a clamped number.

**3. OBV and flat days.** A day whose close equals the previous close contributes **zero** — neither
adding nor subtracting the day's volume. That is the standard definition and the easiest part to get
subtly wrong.

### What these functions do *not* do

They take series and return series. **No split adjustment, no database, no clock, no `app.*`
imports.** Contract 0089 owns the adjustment when it reads bars — the same division of labour that
keeps `returns.py` pure.

Worth stating because it will matter in 0089: **OBV needs volume, and raw volume is not
split-adjusted** — a 4:1 split multiplies share volume by four. That is 0089's problem, not this
contract's, and it is recorded here so it is not forgotten.

## Out of scope

- **No endpoint, no schema, no router change.** Contract 0089.
- **No frontend.** Contract 0090.
- Do not port `check_sma_crossover`, `check_rsi_threshold`, `check_price_threshold`, or
  `simulate_email_alert`. They are alert plumbing on the cut list.
- Do not add these to `compute_all_signals`. They are overlays, not signals — none produces a
  bullish/bearish state and pretending otherwise is the ATR mistake again.
- Do not add configurable parameters beyond the defaults in the signatures.
- No new dependency. `pandas` and `numpy` are present.

## Acceptance criteria

Known-value tests. Each must be checkable by hand.

1. **Bollinger, constant series.** All three bands equal the constant — standard deviation is zero, so
   the bands collapse onto the middle.
2. **Bollinger middle is exactly `compute_sma`.** Assert equality against `compute_sma(series, 20)` on
   a non-trivial series, and that `upper - middle == middle - lower` to within floating tolerance. The
   bands are symmetric by construction; a test that does not check it would miss a sign error.
3. **Donchian on a strictly rising series.** Upper equals the current high; lower equals the high 19
   bars back. Exact values, stated in the test.
4. **ADX is bounded and discriminates.** On a strongly trending series it reads **above 25**; on an
   alternating up/down series it reads **below 20**. Assert both, and that every non-NaN value lies in
   `[0, 100]`.
5. **Stochastic at the extremes.** A series whose last close equals the window's highest high gives
   `%K == 100`; equal to the lowest low gives `%K == 0`. Exact.
6. **Stochastic with a zero range gives `NaN`, not 50 and not 0.** This is the guard the reference
   lacks and the one most likely to be "helpfully" filled in.
7. **%D is the `d_window` SMA of %K.** Assert against `compute_sma(k, 3)` rather than recomputing.
8. **OBV over literal series.** Written out, because "three rising days" does not say how many bars:

   ```python
   compute_obv(pd.Series([100.0, 101.0, 102.0, 103.0]), pd.Series([100.0]*4)).iloc[-1]  ==  300.0
   compute_obv(pd.Series([103.0, 102.0, 101.0, 100.0]), pd.Series([100.0]*4)).iloc[-1]  == -300.0
   ```

   Four bars, three moves. **The first bar contributes zero** — it has no prior close — so three moves
   at volume 100 accumulate to 300.

8b. **A test asserts the first bar is exactly `0.0`**, for both series above. That convention is
   standard and must not be "fixed" later by seeding with the first bar's volume.

9. **OBV treats a flat day as zero**, also literal:

   ```python
   compute_obv(pd.Series([100.0, 101.0, 101.0, 102.0]), pd.Series([100.0]*4)).iloc[-1]  ==  200.0
   ```

   Bar 0 contributes 0, bar 1 rises (+100), bar 2 is flat (0), bar 3 rises (+100). Assert it is **not**
   300 as well, so a flat day adding volume would fail rather than pass silently.
10. **ADX produces no `inf`** on a flat series — assert `np.isfinite(...) | np.isnan(...)` holds for
    every value. A missed guard shows as `inf`, which renders as a spike rather than a gap.
11. `grep -n "round(" backend/app/indicators.py` still prints nothing — rounding happens at the edge,
    never in the maths (established in contract 0085).
12. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
    **493**.
13. `git status --porcelain frontend/` — confirm you changed nothing there.
14. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_indicators.py -q
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
import pandas as pd, numpy as np
from app.indicators import compute_bollinger, compute_donchian, compute_adx, compute_stochastic, compute_obv
n = 60
trend = pd.Series([100.0 + i for i in range(n)])
hi, lo = trend + 1, trend - 1
vol = pd.Series([100.0] * n)
u, m, l = compute_bollinger(trend)
print('bollinger upper/mid/lower :', round(u.iloc[-1],3), round(m.iloc[-1],3), round(l.iloc[-1],3))
du, dl = compute_donchian(hi, lo)
print('donchian upper/lower      :', du.iloc[-1], dl.iloc[-1])
print('adx (strong trend)        :', round(compute_adx(hi, lo, trend).iloc[-1],2))
k, d = compute_stochastic(hi, lo, trend)
print('stochastic %K/%D          :', round(k.iloc[-1],2), round(d.iloc[-1],2))
print('obv (all up days)         :', compute_obv(trend, vol).iloc[-1])
flat = pd.Series([100.0]*n)
print('adx (flat) finite or nan  :', bool(np.isfinite(compute_adx(flat+1, flat-1, flat)).all() or compute_adx(flat+1, flat-1, flat).isna().any()))
print('stochastic zero-range     :', compute_stochastic(flat, flat, flat)[0].iloc[-1])
"
grep -n "round(" app/indicators.py ; echo "no-rounding exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
```

The last line must print `nan`, not a number.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Nothing yet.** These are pure functions with no caller; the known-value tests are the verification
until contract 0090 draws them.

Worth knowing about what is coming: **overlays validate themselves visually in a way the signal badges
never could.** Bollinger bands that do not hug the price, a Donchian channel that does not touch the
highs, a stochastic pinned at 100 — all are obvious on a chart. That is a real advantage of slice 2
over slice 1, and it is why the outstanding "check a crossover against TradingView" item stays worth
doing but is no longer the only external check available.

## Open questions — do not resolve these yourself

None. If you find one — particularly a formula where the reference and the standard definition
disagree — report `BLOCKED` and say which, rather than choosing.
