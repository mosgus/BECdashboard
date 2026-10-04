import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar

DATES = [d.date() for d in pd.bdate_range('2024-01-02', periods=5)]
DATA = {'A': [100, 90, 80, 85, 88], 'B': [50, 50, 55, 55, 60], 'M': [200, 180, 170, 175, 180]}

@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{tmp_path}/stress.db')
    Base.metadata.create_all(get_engine())

@pytest.fixture
def client():
    return TestClient(app)

def seed():
    for ticker, values in DATA.items():
        with session() as db:
            for day, value in zip(DATES, values, strict=True):
                db.add(PriceBar(ticker=ticker, date=day, open=value, high=value, low=value, close=value, adj_close=value, volume=1))

def body(**more):
    return {'tickers': ['A', 'B'], 'weights': [1, 1], 'cash': 2, 'start': '2024-01-02', 'end': '2024-01-08', 'market_ticker': 'M', **more}

def test_success(client, db_mode):
    seed(); response = client.post('/portfolio/stress', json=body())
    assert response.status_code == 200 and response.json()['portfolio_return'] == pytest.approx(.02, abs=1e-9) and len(response.json()['path']) == 5

def test_unknown_market(client, db_mode):
    seed(); response = client.post('/portfolio/stress', json=body(market_ticker='VT'))
    assert response.status_code == 422 and 'No stored price history for market ticker' in response.json()['detail']

def test_bad_window(client, db_mode):
    seed(); response = client.post('/portfolio/stress', json=body(start='2024-01-08', end='2024-01-02'))
    assert response.status_code == 422 and response.json()['detail'] == 'start must be before end'
