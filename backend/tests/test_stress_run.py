from datetime import date
import re
import pandas as pd
import pytest
from app.stress_run import StressInputError, run_stress

DATES = [d.date() for d in pd.bdate_range('2024-01-02', periods=5)]
A = pd.Series([100, 90, 80, 85, 88], index=DATES, dtype=float); B = pd.Series([50, 50, 55, 55, 60], index=DATES, dtype=float); M = pd.Series([200, 180, 170, 175, 180], index=DATES, dtype=float); Y = pd.Series([10, 11, 12], index=DATES[2:], dtype=float)
START, END = DATES[0], DATES[-1]
def run(weights={'A': 1, 'B': 1}, cash=2, closes={'A': A, 'B': B}, market=M, **kw): return run_stress(weights, cash, closes, market, market_ticker=kw.pop('market_ticker', 'M'), start=kw.pop('start', START), end=kw.pop('end', END))
def test_base():
 r=run(); assert (r.cash_weight,r.portfolio_return,r.max_drawdown,r.worst_day,r.market_return,r.coverage)==pytest.approx((.5,.02,-.025,-.025,-.1,1),abs=1e-9); assert (r.worst_day_date,r.n_days,r.start,r.end,r.warnings)==(DATES[1],4,DATES[0],DATES[-1],[])
def test_holdings():
 r=run(); assert [h.asset_return for h in r.holdings]==pytest.approx((-.12,.2),abs=1e-9); assert [h.contribution for h in r.holdings]==pytest.approx((-.03,.05),abs=1e-9); assert [h.weight for h in r.holdings]==pytest.approx((.25,.25),abs=1e-9)
def test_path():
 r=run(); assert [p.value for p in r.path]==pytest.approx([1,.975,.975,.9875,1.02],abs=1e-9); assert [p.market for p in r.path]==pytest.approx([1,.9,.85,.875,.9],abs=1e-9)
def test_missing_warning():
 r=run({'A':3,'B':3,'Y':1},0,{'A':A,'B':B,'Y':Y}); assert r.coverage==pytest.approx(6/7,abs=1e-9); assert r.holdings[-1].asset_return is None and 'counted as flat' in r.warnings[0]
def test_coverage_error():
 with pytest.raises(StressInputError,match=re.escape('Only 66.7% of the invested money has prices for this window (missing: Y). At least 80% is needed.')): run({'A':1,'B':1,'Y':1},0,{'A':A,'B':B,'Y':Y})
def test_late_market():
 r=run(market=Y,market_ticker='Y'); assert r.market_return is None and all(p.market is None for p in r.path) and 'Y has no prices' in r.warnings[0]
def test_old_window():
 with pytest.raises(StressInputError,match='Stored prices start at 2020-01-01'): run(start=date(2019,1,2),end=date(2019,3,1))
@pytest.mark.parametrize(('kw','msg'),[({'weights':{'A':0}},'weights must be finite and greater than zero'),({'cash':-1},'cash must be finite and zero or more'),({'start':END,'end':START},'start must be before end'),({'weights':{'A':1,'Z':1}},"missing closes for weighted ticker 'Z'")])
def test_invalid(kw,msg):
 with pytest.raises(StressInputError,match=re.escape(msg)): run(**kw)
