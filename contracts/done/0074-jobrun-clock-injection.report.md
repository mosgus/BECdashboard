# Report — Contract 0074 (Job-run clock injection)

**Verdict: accepted.** The suite is green for the first time since 2026-09-19.

## Verified independently

`460 passed` — was `1 failed, 459 passed`. `_now()` is restored to `datetime(2026, 9, 18, 10, 0)`.

The fix is structural, not a fixture bump:

```python
def _clock_at_exit(now: datetime | None) -> datetime:
    return now if now is not None else datetime.now(timezone.utc)
...
_prune_old_runs(keep_id=new_id, now=finished_at)
...
cutoff = now - timedelta(days=JOB_RETENTION_DAYS)
```

One clock resolution point, and the cutoff derives from the same `finished_at` value rather than a
second reading. `grep "datetime.now" app/jobrun.py` prints exactly one line. **The test is now
date-independent by construction** — the fixture governs both the inserted row and the cutoff — which
is stronger than the criterion-3 demonstration and is why I did not need to re-run it with a fake
date.

Production call sites are untouched and still take the default wall clock:

```
app/autorefresh.py:108:  with record_run("universe_refresh", now_utc) as detail:
app/news.py:378:         with record_run("news_refresh", now_utc) as detail:
```

The `keep_id` guard survives in the delete.

## The docstring judgement was right

Criterion 8 asked whether *"a slow-clock test"* still describes real behaviour. The coder kept it and
argued it does. Checking: the guard exists because a caller-supplied `started_at` older than retention
would otherwise delete its own just-written row — and that hazard is unchanged by injection, since a
test can still pass an old `started_at` relative to an injected `now`. The docstring is accurate.

Correctly reasoned rather than reflexively deleted, which is the failure mode that criterion was
guarding against in the other direction.

## What this closes

`jobrun.py` was the last module in the backend reading the clock internally. `freshness.py`,
`schedule.py`, `quotes.py` and every `frontend/src/lib/` function already took `now` as an argument;
one holdout was enough to break the whole suite, silently, on a delay.

Both defects found in this pair — the strip staleness and this — surfaced from a criterion rather
than from someone looking: contract 0073 required the **full** backend suite to exit 0 despite being a
frontend-adjacent strip contract. Second time that rule has paid for itself.

## Status

Accepted and archived.
