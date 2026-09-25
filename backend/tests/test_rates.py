import pandas as pd
import pytest

from app import rates


@pytest.fixture(autouse=True)
def clear_rate_cache():
    rates._cache.clear()


def test_returns_tnx_close_as_decimal(monkeypatch):
    monkeypatch.setattr(rates, "_download_tnx", lambda: pd.DataFrame({"Close": [4.30]}))
    assert rates.fetch_risk_free_rate() == pytest.approx(0.043, abs=1e-9)


@pytest.mark.parametrize("frame", [pd.DataFrame(), pd.DataFrame({"Close": [25.0]})])
def test_invalid_tnx_data_uses_fallback(monkeypatch, frame):
    monkeypatch.setattr(rates, "_download_tnx", lambda: frame)
    assert rates.fetch_risk_free_rate() == pytest.approx(0.0427)


def test_download_failure_uses_fallback(monkeypatch):
    def fail():
        raise RuntimeError("network unavailable")

    monkeypatch.setattr(rates, "_download_tnx", fail)
    assert rates.fetch_risk_free_rate() == pytest.approx(0.0427)


def test_success_is_cached(monkeypatch):
    calls = 0

    def download():
        nonlocal calls
        calls += 1
        return pd.DataFrame({"Close": [4.30]})

    monkeypatch.setattr(rates, "_download_tnx", download)
    assert rates.fetch_risk_free_rate() == pytest.approx(0.043)
    assert rates.fetch_risk_free_rate() == pytest.approx(0.043)
    assert calls == 1
