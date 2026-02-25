"""Portfolio statistical validation suite — 7 tests on a daily return series.

Tests:
  1. sharpe_ttest        — Lo (2002) autocorrelation-corrected t-test (Sharpe > 0)
  2. block_permutation   — block-shuffle null distribution, p = P(null SR >= obs SR)
  3. block_bootstrap_ci  — circular block bootstrap 95% CI for annualised Sharpe
  4. stationarity_adf    — Augmented Dickey-Fuller unit root test
  5. autocorrelation_lb  — Ljung-Box serial correlation test (lag 10)
  6. normality_jb        — Jarque-Bera normality test (fat tails expected)
  7. drawdown_bootstrap  — block-shuffle MDD null distribution

GO decision: n_passing >= 4 out of 7.
"""
from __future__ import annotations

import numpy as np
from scipy import stats as scipy_stats
from scipy.stats import norm


def _annualised_sharpe(returns: np.ndarray, rf_daily: float = 0.0) -> float:
    excess = returns - rf_daily
    std = float(np.std(excess, ddof=1))
    if std == 0.0:
        return 0.0
    return float(np.mean(excess) / std * np.sqrt(252))


def _max_drawdown(returns: np.ndarray) -> float:
    equity = np.cumprod(1.0 + returns)
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / peak
    return float(np.min(dd))


def _circular_block_bootstrap(
    returns: np.ndarray,
    block_size: int,
    n_samples: int,
    rng: np.random.Generator,
) -> list[np.ndarray]:
    n = len(returns)
    n_blocks = int(np.ceil(n / block_size))
    samples = []
    for _ in range(n_samples):
        starts = rng.integers(0, n, size=n_blocks)
        blocks = [returns[np.arange(s, s + block_size) % n] for s in starts]
        boot = np.concatenate(blocks)[:n]
        samples.append(boot)
    return samples


# ── Individual tests ──────────────────────────────────────────────────────────

def test_sharpe_ttest(returns: np.ndarray, rf: float = 0.0) -> dict:
    """Lo (2002) autocorrelation-corrected t-test: is annualised Sharpe > 0?"""
    n = len(returns)
    sr_ann = _annualised_sharpe(returns, rf / 252)

    # AR(1) autocorrelation correction
    rho1 = float(scipy_stats.pearsonr(returns[:-1], returns[1:])[0]) if n > 2 else 0.0
    rho1 = max(-0.99, min(0.99, rho1))
    denom = 1.0 - rho1**2
    t_eff_factor = 1.0 + 2.0 * rho1 * (n - 1) / (n * denom) if denom > 0 else 1.0
    t_eff_factor = max(0.01, t_eff_factor)

    sr_daily = sr_ann / np.sqrt(252)
    t_stat = float(sr_daily * np.sqrt(n / t_eff_factor))
    p_value = float(1.0 - norm.cdf(t_stat))

    return {
        "test": "sharpe_ttest",
        "label": "Sharpe t-test (Lo 2002)",
        "passed": bool(t_stat > 1.96),
        "statistic": round(t_stat, 4),
        "p_value": round(p_value, 4),
        "details": {"sharpe": round(sr_ann, 4), "rho1": round(rho1, 4), "n": n},
    }


def test_block_permutation(
    returns: np.ndarray,
    n_perms: int = 500,
    block_size: int = 20,
    seed: int = 42,
) -> dict:
    """Block-shuffle null distribution. p = P(null Sharpe >= observed Sharpe)."""
    rng = np.random.default_rng(seed)
    obs_sr = _annualised_sharpe(returns)
    null_srs = [_annualised_sharpe(s) for s in _circular_block_bootstrap(returns, block_size, n_perms, rng)]
    p_value = float(np.mean(np.array(null_srs) >= obs_sr))
    return {
        "test": "block_permutation",
        "label": "Block Permutation (20-day blocks)",
        "passed": bool(p_value < 0.05),
        "statistic": round(obs_sr, 4),
        "p_value": round(p_value, 4),
        "details": {
            "observed_sharpe": round(obs_sr, 4),
            "n_perms": n_perms,
            "null_mean_sharpe": round(float(np.mean(null_srs)), 4),
        },
    }


def test_block_bootstrap_ci(
    returns: np.ndarray,
    n_samples: int = 1000,
    block_size: int = 20,
    seed: int = 42,
) -> dict:
    """Circular block bootstrap 95% CI for annualised Sharpe. Pass if CI lower > 0."""
    rng = np.random.default_rng(seed)
    boot_srs = [_annualised_sharpe(s) for s in _circular_block_bootstrap(returns, block_size, n_samples, rng)]
    ci_lower = float(np.percentile(boot_srs, 2.5))
    ci_upper = float(np.percentile(boot_srs, 97.5))
    obs_sr = _annualised_sharpe(returns)
    return {
        "test": "block_bootstrap_ci",
        "label": "Bootstrap 95% CI for Sharpe",
        "passed": bool(ci_lower > 0.0),
        "statistic": round(obs_sr, 4),
        "p_value": None,
        "details": {
            "ci_lower": round(ci_lower, 4),
            "ci_upper": round(ci_upper, 4),
            "observed_sharpe": round(obs_sr, 4),
            "n_samples": n_samples,
        },
    }


def test_stationarity(returns: np.ndarray) -> dict:
    """Augmented Dickey-Fuller: reject unit root → stationary returns."""
    try:
        from statsmodels.tsa.stattools import adfuller
        result = adfuller(returns, autolag="AIC")
        adf_stat = float(result[0])
        p_value = float(result[1])
        passed = bool(p_value < 0.05)
    except Exception as exc:
        return {
            "test": "stationarity_adf",
            "label": "Stationarity (ADF)",
            "passed": False,
            "statistic": None,
            "p_value": None,
            "details": {"error": str(exc)},
        }
    return {
        "test": "stationarity_adf",
        "label": "Stationarity (ADF)",
        "passed": passed,
        "statistic": round(adf_stat, 4),
        "p_value": round(p_value, 4),
        "details": {"lags_used": int(result[2])},
    }


def test_autocorrelation(returns: np.ndarray) -> dict:
    """Ljung-Box lag-10 serial independence test. Pass if p > 0.05 (no autocorrelation)."""
    try:
        from statsmodels.stats.diagnostic import acorr_ljungbox
        lb = acorr_ljungbox(returns, lags=[10], return_df=True)
        lb_stat = float(lb["lb_stat"].iloc[0])
        p_value = float(lb["lb_pvalue"].iloc[0])
        passed = bool(p_value > 0.05)
    except Exception as exc:
        return {
            "test": "autocorrelation_lb",
            "label": "Serial Independence (Ljung-Box)",
            "passed": False,
            "statistic": None,
            "p_value": None,
            "details": {"error": str(exc)},
        }
    return {
        "test": "autocorrelation_lb",
        "label": "Serial Independence (Ljung-Box)",
        "passed": passed,
        "statistic": round(lb_stat, 4),
        "p_value": round(p_value, 4),
        "details": {"lag": 10, "note": "FAIL = autocorrelation present (may be exploitable)"},
    }


def test_normality(returns: np.ndarray) -> dict:
    """Jarque-Bera normality test. Pass if p < 0.05 (fat tails — reject normality)."""
    jb_stat, p_value = scipy_stats.jarque_bera(returns)
    skew = float(scipy_stats.skew(returns))
    excess_kurt = float(scipy_stats.kurtosis(returns))
    return {
        "test": "normality_jb",
        "label": "Fat Tails (Jarque-Bera)",
        "passed": bool(p_value < 0.05),
        "statistic": round(float(jb_stat), 4),
        "p_value": round(float(p_value), 4),
        "details": {
            "skewness": round(skew, 4),
            "excess_kurtosis": round(excess_kurt, 4),
            "note": "Rejection (fat tails) is expected for real returns",
        },
    }


def test_drawdown_significance(
    returns: np.ndarray,
    n_samples: int = 500,
    block_size: int = 20,
    seed: int = 42,
) -> dict:
    """Block-bootstrap MDD null. p = P(null MDD <= observed MDD). Pass if p > 0.05."""
    rng = np.random.default_rng(seed)
    obs_mdd = _max_drawdown(returns)
    null_mdds = [_max_drawdown(s) for s in _circular_block_bootstrap(returns, block_size, n_samples, rng)]
    # p = fraction of null MDDs worse (more negative) than observed
    p_value = float(np.mean(np.array(null_mdds) <= obs_mdd))
    return {
        "test": "drawdown_bootstrap",
        "label": "Max Drawdown vs Null",
        "passed": bool(p_value > 0.05),
        "statistic": round(obs_mdd, 4),
        "p_value": round(p_value, 4),
        "details": {
            "observed_mdd": round(obs_mdd, 4),
            "null_median_mdd": round(float(np.median(null_mdds)), 4),
            "n_samples": n_samples,
        },
    }


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run_validation_suite(returns: np.ndarray, quick: bool = True) -> dict:
    """Run all 7 tests. GO if n_passing >= 4."""
    n_perms = 500 if quick else 2000
    n_boot = 1000 if quick else 5000

    tests = [
        test_sharpe_ttest(returns),
        test_block_permutation(returns, n_perms=n_perms),
        test_block_bootstrap_ci(returns, n_samples=n_boot),
        test_stationarity(returns),
        test_autocorrelation(returns),
        test_normality(returns),
        test_drawdown_significance(returns, n_samples=n_perms),
    ]

    n_passing = sum(1 for t in tests if t["passed"])
    return {
        "tests": tests,
        "n_passing": n_passing,
        "n_total": len(tests),
        "go_decision": bool(n_passing >= 4),
        "quick_mode": quick,
    }
