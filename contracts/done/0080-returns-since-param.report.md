# Report — Contract 0080 (`since` parameter)

**Verdict: accepted.** 475 backend tests, up from 467. The one unmet criterion was mine.

## Verified independently

`ytd_base_close` is a true one-line delegation (`returns.py:33-35`), so there is one implementation,
not two.

**The behaviour-preservation proof exists, just not the way I asked for it.** Criterion 1 said to diff
against `git show HEAD:backend/tests/test_returns.py` — but that file was *created* by contract 0077
and nothing has been committed since, so it does not exist at `HEAD`. Unsatisfiable by construction.

The ten original tests are still committed in `HEAD:backend/tests/test_strip.py`, where they lived
before 0077 moved them. Diffed against that:

```
39a40,48
> def test_base_close_on_or_after_uses_the_cutoff_bar_or_the_first_later_bar():
```

The only difference is the **added** helper test. The ten pre-existing bodies are byte-identical.
Criterion 1's substance holds.

**The semantic trap was avoided** (`routers/universe.py:172-176`):

```python
since_base = (
    base_close_on_or_after(bars, since_date)
    if since_date is not None and bars and since_date >= bars[0][0]
    else None
)
```

Without `since_date >= bars[0][0]`, a pre-history anchor would return the *first available* bar and
silently answer "return since your data starts" instead of "return since 2000" — a plausible number
answering a different question. `test_get_returns_since_before_earliest_bar_is_null_without_affecting_other_windows`
pins it with `since=2000-01-01`, asserting `since is None` while the other three still compute.

The window is widened, not dropped: `window_start = min(bar_window_start(today, today.year), since_date)`.
Contract 0073's 55,917-row measurement stands.

The disclosed gap — an untested row with `adj_close = null` before the first usable bar — is a missing
test, not a defect. `bars_by_ticker` only admits non-null `adj_close`, so `bars[0][0]` already *is* the
first usable bar and the guard covers it.

## Criterion 1 was my ninth criterion error, and the ninth is the same family as the first four

I used `git show HEAD:<file>` to assert a file had not changed — against a file the immediately
preceding contract created and which therefore cannot exist at `HEAD` in a repo where nothing is
committed between contracts. That is the git-state class the drafting checklist's rule 1 exists to
prevent; I had written the rule and then applied git to a *different* question ("has this changed")
rather than the one it names ("does this line exist").

**The checklist entry is too narrow.** Rule 1 now needs to read: *never phrase any criterion against
git history in a repo where nothing is committed between contracts* — not merely "do not use git to
assert a line exists." When behaviour preservation needs proving, name the **last committed location**
of the code explicitly, which is what made this audit work.

## Status

Accepted and archived.
