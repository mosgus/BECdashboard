# Contract 0083 — RSI on a flat price series must not read OVERBOUGHT

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

> ## ⚠ REVISED 2026-09-22 — re-read this file before executing
>
> **If you executed this before, the version you read was self-contradictory.** It required the exact
> condition `avg_gain == 0 and avg_loss == 0` *and* required a rise-then-flat series to read 50. With
> EWM smoothing `avg_gain` decays toward zero but never reaches it, so those cannot both hold. The
> previous run reported `BLOCKED` rather than guessing, which was correct.
>
> **Criterion 3 was also wrong on the merits and is now inverted.** Standard RSI returns 100 for
> rise-then-flat, because every move in the lookback was upward. Matching that is deliberate — it is
> what public charts show, and contract 0082's verification asks Gunnar to compare against them.
>
> The fix is narrower than first written: **only a series with no movement at all** reads 50.
>
> Do not execute from a remembered copy. Read this from disk, in a fresh session.

## Goal

A price series with no movement produces `state: "NEUTRAL"`, not `"OVERBOUGHT"`.

## Why

Found in the contract 0082 audit, 2026-09-22:

```
compute_rsi(pd.Series([50.0] * 30)).iloc[-1]  ->  100.0
```

A price that has not moved has no momentum in either direction. RSI on a constant series is
conventionally **50**, or undefined — never 100. `signal_rsi_threshold` then reports `OVERBOUGHT`,
so any ticker whose stored closes are unchanged across the window shows a false bullish-caution badge:
illiquid names, halted names, or a data gap that repeats a value.

The cause is the standard RSI division. With no down moves, `avg_loss` is `0`, so `rs = avg_gain /
avg_loss` is infinite and `100 - 100 / (1 + rs)` saturates at 100. That is **correct for a rising
series** — criterion 2 of contract 0082 asserts exactly that and must keep passing — and **wrong when
`avg_gain` is also 0**, because then there is no gain to saturate on.

**This is a planner gap, not a coder error.** Contract 0082 specified strictly-rising, strictly-falling
and narrowly-oscillating series. It never specified the degenerate flat case, which is the one that
produces a confidently wrong answer. The evidence was visible in 0082's own sample response —
`ATRADJ`, seeded flat at 50, came back `OVERBOUGHT` — and was not caught until the audit.

## Files

Modify:
- `backend/app/indicators.py` — the flat-series case in `compute_rsi`.
- `backend/tests/test_indicators.py` — the tests below.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not change `signals.py`. The fix belongs in the indicator, not in the signal that reads it —
anything else consuming `compute_rsi` later would otherwise inherit the same wrong value.

Do not change `compute_sma`, `compute_ema`, `compute_macd`, or `compute_atr`.

**`reference files/` is read-only and never belongs on a file list.**

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** That prefix works and is honoured
> as a deliberate opt-out — contract 0082's report claimed it was blocked and that claim was wrong,
> verified in the audit. `app/config.py` calls `load_dotenv()` at import and `backend/.env` holds a
> live Render connection string, so an unprefixed script talks to the **production database**.

## Interface

In `compute_rsi`, when a period has **both** `avg_gain == 0` and `avg_loss == 0`, the RSI for that
period is **`50.0`**.

Express it as exactly that condition. Do not:

- clamp the output to a range,
- add an epsilon to `avg_loss` to avoid the division — that shifts every value slightly and makes a
  genuinely rising series read 99.9 instead of 100,
- special-case "the input is constant" by inspecting the whole series — the condition is per-period
  and must be expressed that way, even though in practice only a never-moved series satisfies it,
- change the behaviour when `avg_loss == 0` but `avg_gain > 0`, which must stay `100.0`.

**A flat stretch inside a moving series keeps reading 100**, because `avg_gain` decays but never hits
zero while `avg_loss` stays at zero. That is conventional RSI behaviour and is deliberately preserved
— an earlier draft of this contract wrongly demanded 50 there. The only case that changes is a series
that has never moved, where both averages are exactly 0 and there is genuinely no information.

`signal_rsi_threshold` needs no change: 50 sits between the 30 and 70 thresholds and already yields
`NEUTRAL`.

## Out of scope

- No frontend. The Holdings column is contract **0084**.
- Do not change the 30/70 thresholds or make them configurable.
- Do not change the other indicators, the signal functions, the endpoint, or the schemas.
- Do not "fix" `ATRADJ`'s fixture in `test_api_universe.py` — it is a flat series on purpose, for the
  ATR adjustment test, and its RSI reading is incidental to what it checks. Its value will change from
  `OVERBOUGHT` to `NEUTRAL` as a result of this fix; if an assertion there breaks, report it rather
  than editing the fixture.
- No new dependency.

## Acceptance criteria

1. A test asserts `compute_rsi(pd.Series([50.0] * 30)).iloc[-1] == 50.0`.
2. A test asserts a **strictly rising** series still gives `100.0`, and a **strictly falling** series
   still gives `0.0`. These are contract 0082's criterion 2 and must not regress — the failure mode of
   this fix is breaking them.
3. **Inverted 2026-09-22.** A test asserts a series that rises, then goes **flat for 20 bars**, still
   reads `100.0` at the end — and a comment in the test says this is deliberate, not an oversight.
   Every move in the lookback was upward, so `avg_loss` is exactly 0 and RSI saturates; that is what
   TradingView and StockCharts show, and diverging would break the public-chart comparison contract
   0082 asks for. **Only a series with no movement whatsoever reads 50.**
4. A test asserts `signal_rsi_threshold` on a flat series returns `state == "NEUTRAL"`, not
   `"OVERBOUGHT"` and not `None`. It is computed; it is neutral.
5. `grep -n "1e-\|epsilon\|EPS" backend/app/indicators.py` prints nothing — no epsilon was added to
   dodge the division.
6. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
   **488**.
7. If any existing test's expected value changes as a result — the likely candidate is
   `test_get_signals_uses_adjusted_close_and_adjusted_high_low`, whose `ATRADJ` fixture is flat —
   **report which and why** rather than editing the fixture. Changing an assertion from `OVERBOUGHT`
   to `NEUTRAL` is correct here; changing the fixture data is not.
8. `git status --porcelain frontend/` — confirm you changed nothing there.
9. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_indicators.py tests/test_signals.py -q
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
import pandas as pd
from app.indicators import compute_rsi
print('flat    :', compute_rsi(pd.Series([50.0]*30)).iloc[-1])
print('rising  :', compute_rsi(pd.Series([float(i) for i in range(30)])).iloc[-1])
print('falling :', compute_rsi(pd.Series([float(30-i) for i in range(30)])).iloc[-1])
"
grep -n "1e-\|epsilon\|EPS" app/indicators.py ; echo "no-epsilon grep exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
```

The three printed values must be `50.0`, `100.0`, `0.0`.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Nothing to run.** No visible surface; the column does not exist yet. The three printed values are
the whole verification.

Worth knowing for when contract 0084 lands: after this fix, a ticker whose price has genuinely not
moved shows a neutral RSI rather than an overbought one. If you see `NEUTRAL` on something you expect
to be moving, the question is whether its stored bars are stale — not whether the indicator is wrong.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
