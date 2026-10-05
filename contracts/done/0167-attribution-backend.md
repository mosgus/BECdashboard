# Contract 0167 — Attribution backend: Fama-French 3 factor table, refresh job, `POST /portfolio/attribution`

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

After this contract the backend can answer "what drove this portfolio's return?" using the real Fama-French daily factors:
- A new table `ff3_factors`, created by Alembic migration `0010`, stores Ken French's daily Mkt-RF, SMB, HML and RF from 2000-01-01 on.
- A background refresh downloads the file at most once a week, and retries once a day if the table is still empty. It hangs off `GET /universe/strip` like the news refresh, and every attempt is recorded as a `job_runs` row named `ff3_refresh`.
- A new pure module, `app/attribution_run.py`, regresses the portfolio's daily excess returns on the three factors. It splits the period return into parts that add up exactly.
- `POST /portfolio/attribution` exposes it.

There is no frontend change. The Attribution pill is contract 0168.

## Why

This is contract 4 of the Risk & Perf port (see REBUILD.md, "Risk & Perf port (0164)"). Gunnar picked option A: store the real academic factors in a table and refresh them from the data job, rather than build proxies from ETFs. Ken French publishes about a month late; the live file on 2026-10-04 ends on **2026-08-31**. So the window always ends at the last factor date, and the response says so.

Read `main`'s version first:
- `git show main:backend/core/asset_research.py | grep -n "def fetch_ff3_factors" -A 45`
- `git show main:backend/core/asset_research.py | grep -n "def compute_portfolio_attribution" -A 90`

**What changes from `main`, and why:**

| `main` | Here |
|---|---|
| Portfolio returns used renormalised weights rebalanced daily, and cash was ignored. | Returns come from `run_stress`'s path: today's holdings bought at the start and held, with cash flat at 0%, the 80% coverage rule and its warnings. This is the same path Performance and Scenarios use. |
| "Residual" was `period_return − (sum of daily parts)`. OLS with an intercept makes residuals sum to exactly zero, so this was really the compounding gap, mislabelled. | No residual item. A **compounding** item equals `(1+p).prod() − 1 − p.sum()` and is labelled as such. The six parts add up to `period_return` exactly. |
| Factors were fetched on every request, with a 24 h in-memory cache. | They're stored in the database and refreshed in the background, so a request never touches the network. |
| The window was the last N trading days, ending today, and was silently cut short by the factor lag. | The `start`/`end` request matches Performance. The end is clipped to the last factor date, with a warning, and `factor_end` is always returned. |
| Cash drag was invisible. | Cash earns 0% in `run_stress`, which lowers alpha by roughly `cash × T-bill rate`. A warning says so, with the number. |

## Files

Create:
- `backend/app/ff3.py`: download, parse, validate, store and load the factors, plus the refresh entry point.
- `backend/app/attribution_run.py`: the pure regression and decomposition.
- `backend/migrations/versions/0010_ff3_factors.py`
- `backend/tests/test_ff3.py`
- `backend/tests/test_attribution_run.py`
- `backend/tests/test_api_attribution.py`

Modify:
- `backend/app/models.py`: add `FF3Factor`.
- `backend/app/schemas.py`: add `AttributionRequest`, `FactorLoadingOut`, `AttributionContributionsOut` and `AttributionResponse`.
- `backend/app/routers/portfolio.py`: add `POST /portfolio/attribution`.
- `backend/app/routers/universe.py`: in `get_strip`, add `background_tasks.add_task(run_ff3_refresh_if_due, now_utc)` after the news task.
- `backend/tests/conftest.py`: add one autouse fixture that replaces `app.routers.universe.run_ff3_refresh_if_due` with a no-op. Without it, every existing strip test would try the download, hit the network block and write a failure `job_runs` row. Some tests count those rows. The docstring should say exactly that. `test_ff3.py` calls `app.ff3.run_ff3_refresh_if_due` directly, so the patch doesn't affect it.

**Touch nothing else.** If the work needs another file, stop and report `BLOCKED`.

`reference files/` and the `main` branch are read-only.

**Never run `alembic upgrade` against a real database.** `backend/.env` points at production, and Gunnar applies migrations himself.

## Interface

### Model (`app/models.py`)

```python
class FF3Factor(Base):
    """One trading day of Ken French's daily Fama-French 3 factors (contract 0167), stored as decimals
    (the source file is in percent). Replaced wholesale by app/ff3.py on each successful refresh."""

    __tablename__ = "ff3_factors"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    mkt_rf: Mapped[float] = mapped_column(Float, nullable=False)
    smb: Mapped[float] = mapped_column(Float, nullable=False)
    hml: Mapped[float] = mapped_column(Float, nullable=False)
    rf: Mapped[float] = mapped_column(Float, nullable=False)
```

Match whatever import style `models.py` already uses for `Date` and `Float`.

### Migration `0010_ff3_factors.py`

- Copy `0009_presets.py`'s header: docstring "ff3_factors table (contract 0167).", `revision = "0010"`, `down_revision = "0009"`, Create Date 2026-10-04.
- `upgrade()` creates the table with the five columns above. `date` is the primary key, and the other columns are `sa.Float()` with `nullable=False`.
- `downgrade()` drops it.
- No seed data: the refresh job fills the table.

### `app/ff3.py`

```python
FF3_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip"
FF3_START = date(2000, 1, 1)
FF3_REFRESH_KEY = "ff3_refresh"          # app_state key
FF3_JOB_NAME = "ff3_refresh"             # job_runs.job_name
MIN_ROWS = 5000
MAX_STALENESS_DAYS = 120
RETRY_AFTER = timedelta(days=1)
REFRESH_EVERY = timedelta(days=7)

class FF3DataError(ValueError): ...

@dataclass(frozen=True)
class FactorRow:
    date: date
    mkt_rf: float
    smb: float
    hml: float
    rf: float

def download_ff3_zip() -> bytes: ...
def parse_ff3_csv(text: str) -> list[FactorRow]: ...
def extract_ff3_csv(zip_bytes: bytes) -> str: ...
def validate_rows(rows: list[FactorRow], today: date) -> None: ...
def store_rows(rows: list[FactorRow]) -> None: ...
def load_factors() -> pd.DataFrame: ...
def needs_ff3_refresh(last_claim_at: datetime | None, has_rows: bool, now_utc: datetime) -> bool: ...
def run_ff3_refresh_if_due(now_utc: datetime, *, download: Callable[[], bytes] = download_ff3_zip) -> None: ...
```

**`download_ff3_zip`**
- `urllib.request.urlopen(urllib.request.Request(FF3_URL, headers={"User-Agent": "blue-eagle/1.0"}), timeout=30).read()`.
- Standard library only; add nothing to `requirements.txt`.

**`extract_ff3_csv`**
- Opens the zip with `zipfile.ZipFile(io.BytesIO(...))`.
- Reads the single member whose name ends in `.csv` (case-insensitive) and decodes it as `latin-1`.
- Raises `FF3DataError` if there is no `.csv` member.

**`parse_ff3_csv`**
- Splits on lines and strips `\r` and whitespace from each line. The real file uses CRLF.
- Keeps only lines whose first comma-separated field is exactly 8 digits and that have at least 5 fields.
- Parses the date as `YYYYMMDD` and drops dates before `FF3_START`.
- Divides fields 2–5 by 100, in the order Mkt-RF, SMB, HML, RF.
- Returns the rows sorted by date. The preamble, the `,Mkt-RF,SMB,HML,RF` header, blank lines and the copyright line all fall out of the 8-digit rule.

**`validate_rows`** raises `FF3DataError` with a readable message when any of these holds:
- there are fewer than `MIN_ROWS` rows;
- the newest date is more than `MAX_STALENESS_DAYS` before `today`;
- any value is not finite;
- any value has an absolute size of 0.5 or more.

This check keeps a truncated or garbled download from wiping good data.

**`store_rows`**
- Runs inside one `with session() as db:`.
- Calls `db.execute(delete(FF3Factor))`, then `db.execute(insert(FF3Factor), [dict, ...])`.
- Doing it as one transaction means a failure leaves the old rows in place. A full replace also picks up Ken French's occasional revisions of past values.

**`load_factors`**
- Returns a `DataFrame` indexed by `datetime.date` and sorted ascending, with float columns `["mkt_rf", "smb", "hml", "rf"]`.
- With no rows, it returns an empty frame with those columns.
- Callers check `is_enabled()` first.

**`needs_ff3_refresh`** is pure:
- `last_claim_at is None` → `True`.
- `now_utc - last_claim_at < RETRY_AFTER` → `False`.
- `not has_rows` → `True`.
- `now_utc - last_claim_at >= REFRESH_EVERY` → `True`.
- Otherwise → `False`.

**`run_ff3_refresh_if_due`** follows `app.news.run_news_refresh_if_due` (read it):
- Its own module-level `threading.Lock`, acquired with `blocking=False`. Return if it is already held.
- A no-op when `not is_enabled()`.
- Reads the claim from `app_state[FF3_REFRESH_KEY]`. Copy the `_get_state` / `_set_state` / `_as_utc` helpers from `autorefresh.py`; don't import its private functions.
- Computes `has_rows` with `select(FF3Factor.date).limit(1)`.
- If `needs_ff3_refresh` is false, returns.
- Otherwise it **writes the claim first**, then works inside `with record_run(FF3_JOB_NAME, now_utc) as detail:`:
  - download;
  - extract;
  - parse;
  - `validate_rows(rows, now_utc.date())`;
  - `store_rows`;
  - `detail["rows"] = len(rows)` and `detail["last_date"] = rows[-1].date.isoformat()`.
- Wrap the `record_run` block in `try/except Exception: logger.exception(...)`. `record_run` records the failure and re-raises, and a background task must not raise.
- Release the lock in `finally`.

### `app/attribution_run.py`

```python
MIN_OBS = 60
SHORT_OBS = 126
DEFAULT_WINDOW_DAYS = 365
FACTOR_SOURCE = "Kenneth R. French Data Library — daily Fama/French 3 factors"

class AttributionInputError(ValueError): ...

@dataclass(frozen=True)
class FactorLoading:
    key: str            # "market" | "size" | "value"
    label: str          # "Market (Mkt-RF)" | "Size (SMB)" | "Value (HML)"
    beta: float
    t_stat: float | None

@dataclass(frozen=True)
class AttributionResult:
    start: date                 # first price date of the stress window
    end: date                   # last price date of the stress window
    factor_end: date            # last date in the factor table
    n_obs: int                  # daily returns that also have factor data
    cash_weight: float
    coverage: float
    period_return: float        # (1+p).prod() - 1 over the n_obs aligned days
    alpha_daily: float
    alpha_annual: float         # (1 + alpha_daily) ** 252 - 1
    r_squared: float | None
    loadings: list[FactorLoading]
    contributions: dict[str, float]   # keys exactly: alpha, market, size, value, risk_free, compounding
    source: str
    warnings: list[str]

def run_attribution(
    weights: dict[str, float], cash: float, closes: dict[str, pd.Series], market: pd.Series,
    factors: pd.DataFrame, *, market_ticker: str, start: date | None, end: date | None, today: date,
) -> AttributionResult: ...
```

**Steps**

1. If `factors` is empty, raise `AttributionInputError("No Fama-French factor data is stored yet.")`. The route maps this case to 503 before calling. This check is a guard.
2. `factor_end = factors.index.max()`.
   - `end_resolved = min(end or today, factor_end)`.
   - If `end` was given and `end > factor_end`, add the warning `f"Factor data ends on {factor_end} (Ken French publishes about a month late), so the window ends there."`
   - `start_resolved = start or end_resolved - timedelta(days=DEFAULT_WINDOW_DAYS)`.
3. Call `run_stress(weights, cash, closes, market, market_ticker=..., start=start_resolved, end=end_resolved)`.
   - Re-raise `StressInputError` as `AttributionInputError(str(exc))`.
   - Start `warnings` with the stress warnings, then append any warning from step 2.
4. `p = value.pct_change().dropna()`, where `value` is a `pd.Series` of `point.value` indexed by `point.date` over the stress path.
   - Inner-join `p` with `factors` on date.
   - If fewer than `MIN_OBS` rows remain, raise `AttributionInputError(f"Only {n} trading days have both prices and factor data. At least {MIN_OBS} are needed. Factor data ends on {factor_end}.")`.
5. Regression:
   - `y = p - rf` and `X = [1, mkt_rf, smb, hml]`, solved with `np.linalg.lstsq(X, y, rcond=None)`.
   - `resid = y - X @ b`, `ssr = resid @ resid` and `sst = ((y - y.mean()) ** 2).sum()`.
   - `r_squared = 1 - ssr / sst` if `sst > 0`, else `None`.
   - `sigma2 = ssr / (n - 4)` and `se = sqrt(diag(sigma2 * pinv(X.T @ X)))`.
   - `t = b / se`. A t-stat is `None` where `se` is 0 or not finite. This is plain homoskedastic OLS, like `main`; no Newey-West.
6. Contributions:
   - `alpha = b0 * n`;
   - `market = b1 * mkt_rf.sum()`, `size = b2 * smb.sum()`, `value = b3 * hml.sum()`;
   - `risk_free = rf.sum()`;
   - `period_return = (1 + p).prod() - 1` and `compounding = period_return - p.sum()`.

   OLS with an intercept makes `alpha + market + size + value + risk_free == p.sum()` hold to floating-point precision. So the six parts sum to `period_return`. Don't add a residual term.
7. Warnings, appended in this order:
   - If `n < SHORT_OBS`: `f"Only {n} trading days in this window, so the loadings and t-stats are noisy."`
   - If the stress `cash_weight > 0`: `f"Cash ({cash_weight:.1%} at the start) is counted at 0% return, so alpha is about {cash_weight * rf.mean() * 252:.2%} a year lower than if it earned the T-bill rate."`
8. Every float in the result is a plain Python `float`, not a numpy scalar.

### Schemas (`app/schemas.py`)

- `AttributionRequest` has the same fields and defaults as `PerformanceRequest`.
- `FactorLoadingOut`: `key: str`, `label: str`, `beta: float`, `t_stat: float | None`.
- `AttributionContributionsOut`: `alpha`, `market`, `size`, `value`, `risk_free`, `compounding`, all `float`.
- `AttributionResponse` mirrors `AttributionResult`, plus `market_ticker: str`:
  - `loadings: list[FactorLoadingOut]`;
  - `contributions: AttributionContributionsOut`;
  - `r_squared: float | None`.

### Route (`POST /portfolio/attribution`)

- Copy `performance_portfolio`'s shape:
  - `_require_database()` (503 with no DB);
  - `_normalise_request`;
  - load closes;
  - the same market-ticker 422.
- Then `factors = load_factors()`. If it's empty, raise HTTP **503** with `"Fama-French factor data hasn't been downloaded yet. It loads in the background with the next data refresh; try again in a minute."`
- Call `run_attribution(..., today=date.today())`. Map `AttributionInputError` to 422.
- Return `{**asdict(result), "market_ticker": market_ticker}`.
- No risk-free rate fetch: RF comes from the factor file.

## Tests

### Shared literal fixture

Use it in `test_attribution_run.py` and `test_api_attribution.py`; copy it into each file rather than sharing a module.

```python
DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=301)]
T = np.arange(1, 301)
MKT = 0.01 * np.sin(0.7 * T)
SMB = 0.006 * np.cos(1.3 * T)
HML = 0.004 * np.sin(0.4 * T + 1)
RF = np.full(300, 0.0002)
NOISE = 0.003 * np.sin(2.9 * T)
EXACT = RF + 0.0001 + 0.9 * MKT + 0.3 * SMB - 0.2 * HML
NOISY = EXACT + NOISE
def prices(returns): return pd.Series(100 * np.concatenate([[1.0], np.cumprod(1 + returns)]), index=DATES)
FACTORS = pd.DataFrame({"mkt_rf": MKT, "smb": SMB, "hml": HML, "rf": RF}, index=DATES[1:])
```

The market series is `prices(MKT + RF)`.

### `test_ff3.py`: 17 tests

These use this literal CSV, zipped in memory with `zipfile` as `F-F_Research_Data_Factors_daily.csv` when a test needs bytes:

```
"This file was created by using the 202608 CRSP database.\r\nThe Tbill return is the simple daily rate.\r\n\r\n,Mkt-RF,SMB,HML,RF\r\n19991231,    0.50,    0.10,   -0.20,    0.02\r\n20000103,   -0.71,    0.53,   -0.48,    0.02\r\n20260831,   -0.33,   -0.02,   -0.39,    0.01\r\n\r\nCopyright 2026 Eugene F. Fama and Kenneth R. French\r\n"
```

1. `parse_ff3_csv` returns exactly 2 rows:
   - `2000-01-03` with `(-0.0071, 0.0053, -0.0048, 0.0002)`;
   - `2026-08-31` with `(-0.0033, -0.0002, -0.0039, 0.0001)`;
   - both compared with `pytest.approx`. 1999 is dropped.
2. `extract_ff3_csv` round-trips the in-memory zip, and raises `FF3DataError` for a zip with only a `.txt` member. This is one test with two asserts.
3. `validate_rows` with the 2 parsed rows and `today=date(2026, 10, 4)` raises `FF3DataError` (too few rows).
4. `validate_rows` raises for stale data:
   - monkeypatch `MIN_ROWS` to 1;
   - use only the `2000-01-03` row;
   - `today=date(2026, 10, 4)`.
5. `validate_rows` raises for a row with `mkt_rf=0.6` (`MIN_ROWS` patched to 1, row dated 2026-09-30).
6. –11. One parametrized test of `needs_ff3_refresh` with six cases (`now = 2026-10-04 12:00 UTC`):

| claim | has_rows | expected |
|---|---|---|
| `None` | `True` | `True` |
| now − 2 h | `False` | `False` |
| now − 2 days | `False` | `True` |
| now − 2 days | `True` | `False` |
| now − 7 days | `True` | `True` |
| now − 30 days | `True` | `True` |

12. Success (SQLite `db_mode` like `test_autorefresh.py`; `MIN_ROWS` patched to 1; download fake returns the zip):
    - `ff3_factors` holds 2 rows;
    - `app_state["ff3_refresh"]` equals `now_utc`;
    - the latest `job_runs` row is `ff3_refresh` with `status == "success"` and detail `{"rows": 2, "last_date": "2026-08-31"}`.
    - Use `now_utc = 2026-10-04 12:00 UTC` so validation's staleness check passes.
13. Not due: the claim is set to 3 days ago and one row is seeded. The download fake raises `AssertionError` if called, and nothing changes.
14. Download raises `OSError`:
    - the function returns normally;
    - the seeded row is still there;
    - the latest `job_runs` row has `status == "failure"`;
    - the claim **is** updated, because the claim is written before the work.
15. Invalid data (`MIN_ROWS` left at 5000): the seeded row is still there and a failure row is recorded.
16. Replace:
    - seed two rows, `2000-01-03` with `mkt_rf = 0.9` and `2010-06-01` (any values);
    - after a successful refresh, `2000-01-03` has `mkt_rf == pytest.approx(-0.0071)` and `2010-06-01` is gone.
    - Also in this test: `load_factors()` returns a frame of `len == 2`, sorted by date, with columns `["mkt_rf", "smb", "hml", "rf"]`.
17. No database: `run_ff3_refresh_if_due` returns without calling the download fake.

### `test_attribution_run.py`: 8 tests

1. **Exact recovery.**
   - `weights={"A": 1.0}`, `cash=0`, `closes={"A": prices(EXACT)}`.
   - `start=DATES[0]`, `end=DATES[-1]`, `today=DATES[-1]`.
   - Results:
     - betas `0.9, 0.3, -0.2`, within `1e-9`;
     - `alpha_daily == approx(0.0001, abs=1e-10)`;
     - `alpha_annual == approx(1.0001**252 - 1)`;
     - `r_squared == approx(1, abs=1e-12)`;
     - `n_obs == 300`;
     - `loadings` keys in order `market, size, value`.
2. **Additivity (NOISY).**
   - `sum(contributions.values()) == approx(period_return, abs=1e-12)`.
   - `alpha + market + size + value + risk_free == approx(NOISY.sum(), abs=1e-12)`.
   - `period_return == approx(np.prod(1 + NOISY) - 1, abs=1e-12)`.
   - `risk_free == approx(0.06)`.
3. **Statistics (NOISY).** `r_squared` and the three beta t-stats match an independent computation in the test using `np.linalg.inv(X.T @ X)`, within `1e-9`.
4. **Cash.**
   - `cash=1.0` with `weights={"A": 1.0}` gives `cash_weight == 0.5`.
   - One warning starts with `"Cash (50.0% at the start) is counted at 0% return"`.
5. **Clipping.**
   - The factors are truncated to `FACTORS.loc[:DATES[250]]`, with `end=DATES[-1]`.
   - `end == DATES[250]`, `factor_end == DATES[250]`, and a warning starts with `f"Factor data ends on {DATES[250]}"`.
6. **Default window.** `start=None`, `end=None`, `today=DATES[-1] + timedelta(days=40)` give:
   - `factor_end == DATES[-1]`;
   - `end == DATES[-1]`;
   - `(DATES[-1] - start).days <= 365`;
   - no "Factor data ends" warning, because `end` wasn't given.
7. **Too few observations.** With `start=DATES[250]`, it raises `AttributionInputError` with a message containing `"At least 60 are needed"`.
8. **Short window.** With `start=DATES[180]`, a warning starts with `"Only 120 trading days in this window"`.

### `test_api_attribution.py`: 5 tests

Seed `PriceBar` rows for `A = prices(NOISY)` and `M = prices(MKT + RF)`, plus `FF3Factor` rows from `FACTORS`. Follow `test_api_performance.py`'s `db_mode` / `seed` / `body` pattern.

1. 200:
   - `n_obs == 300`;
   - three loadings;
   - `contributions` has exactly the six keys and they sum to `period_return` within `1e-9`;
   - `source` starts with `"Kenneth R. French"`;
   - `market_ticker == "M"`.
2. No factor rows → 503 with detail starting `"Fama-French factor data hasn't been downloaded yet"`.
3. `start=DATES[250]` → 422.
4. `market_ticker="ZZZ"` → 422.
5. No database configured → 503.

**Expected totals:** the backend baseline is **810**. Paste the `pytest -q` totals before and after. The expected count is **840** (17 + 8 + 5).

## Out of scope

- The frontend: the Attribution pill and charts are contract 0168.
- Factor Replay for Scenarios presets, which comes later on the same table.
- `/ops/status` fields for the FF3 claim; `job_runs` already shows each attempt.
- A manual "refresh factors now" button.
- Newey-West or robust standard errors.

## Acceptance criteria

Run these from `backend/`:

1. `.venv/bin/pytest -q` passes with the totals above. Paste them.
2. `.venv/bin/pytest -q tests/test_ff3.py tests/test_attribution_run.py tests/test_api_attribution.py` passes with no network access. The autouse `block_network` fixture must stay untouched.
3. Run `env -u DATABASE_URL .venv/bin/alembic upgrade 0009:0010 --sql > /tmp/0010.sql`.
   - It succeeds.
   - `grep -c "CREATE TABLE ff3_factors" /tmp/0010.sql` prints `1`.
   - The file contains `UPDATE alembic_version SET version_num='0010'`.
   - Paste the `CREATE TABLE` statement.
4. `grep -n "run_ff3_refresh_if_due" app/routers/universe.py tests/conftest.py` shows the import, the `add_task` line and the conftest patch.
5. `grep -rn "urlopen" app/` shows only `app/ff3.py`.
6. `git status --short` shows only the files listed above, and nothing outside `backend/`.

**Planner-run** (coders skip this and write "live download and endpoint checks left for the Planner" under Not done):

7. A one-off script, run with `DATABASE_URL=""`, calls `download_ff3_zip` → `extract_ff3_csv` → `parse_ff3_csv` → `validate_rows` against the live file. It expects about 6,700 rows ending on 2026-08-31 or later.
8. After Gunnar applies the migration and a strip visit fills the table, `POST localhost:8000/portfolio/attribution` returns 200 for a real portfolio. Its contributions sum to `period_return`.

`BLOCKED` is a valid outcome. Report any deviation.

## Human verification — Gunnar

1. **Apply migration 0010** from `backend/`: `PATH="$PWD/.venv/bin:$PATH" alembic upgrade head`. Do this locally, and on production unless Render's start command already runs it. Until it's applied, the strip's background refresh logs a failure and `/portfolio/attribution` returns 500. Nothing else breaks.
2. Load any page, which triggers `GET /universe/strip`. Within a minute `/ops/job-runs` shows an `ff3_refresh` success with about 6,700 rows and `last_date` 2026-08-31.

## Open questions

None.
