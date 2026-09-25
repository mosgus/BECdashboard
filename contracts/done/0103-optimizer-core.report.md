# Report 0103: Optimizer math (planner audit)

**Verdict:** accepted
**Coder:** sonnet · **Auditor:** planner (opus)

## Re-run by the planner
- Full backend suite: **555 passed** (524 before, +31).
- `requirements.txt` has `numpy==2.5.3` (line 4) and `scipy==1.18.1` (line 5).
- Purity grep (`from app|import app|sqlalchemy|fastapi|yfinance`) prints nothing.
- Fix greps: line 63 has `vol > 1e-12`; line 192 has `target = port_var / n`.
- I diffed `git show main:backend/core/portfolio.py` and `core/tilt.py` against `app/optimizer.py`. The
  logic is identical apart from the two contracted fixes: Sharpe returns `None` when vol ≤ 1e-12, and
  the ERC target is variance/n. `compute_tilt` is appended. The docstring has the nine modes plus a note
  naming both fixes.

## Criteria vs tests (`tests/test_optimizer.py`)
- C4, analytic: every row is present. The `sharpe is None` check is on line 92.
- C5, parity: all five are parametrized. The risk-parity equal-contribution check (within 1%) is on lines 139–143.
- C6, properties: all nine are parametrized, with `vol_target=.20` and the capm expected returns as specified.
- C7, short min-variance: asserts only the sum and the bounds. The comment says the optimum stays long-only.

## Deviations (non-blocking)
- Style: the port compresses `main`'s multi-line calls onto long lines (18 lines over 120 chars), and it
  drops most function docstrings and section comments. Behaviour is unchanged, and no lint rule applies
  to the backend. Accepted as is. I don't think a reformat-only follow-up is worth a contract.
