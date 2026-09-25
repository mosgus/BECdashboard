import pandas as pd
import pytest

from app import rates


@pytest.fixture(autouse=True)
def clear_rate_cache():
    rates._cache.clear()


def test_returns_irx_close_as_decimal(monkeypatch):
    monkeypatch.setattr(rates, "_download_irx", lambda: pd.DataFrame({"Close": [4.07]}))
    assert rates.fetch_risk_free_rate_with_source() == (pytest.approx(0.0407, abs=1e-9), "live")


def test_low_irx_close_is_live_not_fallback(monkeypatch):
    monkeypatch.setattr(rates, "_download_irx", lambda: pd.DataFrame({"Close": [0.03]}))
    assert rates.fetch_risk_free_rate_with_source() == (pytest.approx(0.0003, abs=1e-9), "live")


@pytest.mark.parametrize(
    "frame", [pd.DataFrame(), pd.DataFrame({"Close": [25.0]}), pd.DataFrame({"Close": [-0.5]})]
)
def test_invalid_irx_data_uses_fallback(monkeypatch, frame):
    monkeypatch.setattr(rates, "_download_irx", lambda: frame)
    assert rates.fetch_risk_free_rate_with_source() == (pytest.approx(0.0427), "fallback")


def test_download_failure_uses_fallback(monkeypatch):
    def fail():
        raise RuntimeError("network unavailable")

    monkeypatch.setattr(rates, "_download_irx", fail)
    assert rates.fetch_risk_free_rate_with_source() == (pytest.approx(0.0427), "fallback")


def test_success_is_cached(monkeypatch):
    calls = 0

    def download():
        nonlocal calls
        calls += 1
        return pd.DataFrame({"Close": [4.07]})

    monkeypatch.setattr(rates, "_download_irx", download)
    assert rates.fetch_risk_free_rate_with_source() == (pytest.approx(0.0407), "live")
    assert rates.fetch_risk_free_rate_with_source() == (pytest.approx(0.0407), "live")
    assert calls == 1


def test_fetch_risk_free_rate_returns_bare_float(monkeypatch):
    monkeypatch.setattr(rates, "_download_irx", lambda: pd.DataFrame({"Close": [4.07]}))
    assert rates.fetch_risk_free_rate() == pytest.approx(0.0407)
