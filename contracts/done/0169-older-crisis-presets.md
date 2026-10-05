# Contract 0169 — Older crisis presets (price history back to 2000)

**Status:** done
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The Scenarios pill offers `main`'s five pre-2020 crisis presets as real Historical Replays.
These are dot-com, 2008, 2011, February 2018 and Q4 2018. To make that possible, stored price
history is extended back to 2000.

## Why

Stored prices start at `HISTORY_START` (2020-01-01), so these windows currently fail with
"Fewer than 2 trading days of prices".

`main` ran these presets as a Fama-French *factor model*. The planner backtested that model on the
real BEC portfolio over windows where both methods work. It overstated the loss by roughly 1.5–2×:

| Window | Factor model | Real replay |
|---|---|---|
| COVID | −27% | −18% |
| 2022 | −17% | −9% |
| Q4 2018 | −15% | −8% |

A one-year beta cannot know that GLD and XLP held up in crises, or that MS fell about 80% in 2008.
Real prices can.

The backfill machinery already exists. `refresh_ticker(history_start=…)` prepends missing early bars
(contract 0016), and every sweep calls it through `universe.refresh`. So changing the constant is
the whole backend change. Holdings that didn't exist yet (CEG, SETM) are already handled by
`run_stress`: they count as flat, with a warning, under the 80% coverage rule.

## Files

Modify:
- `backend/app/universe.py`: `HISTORY_START = date(2000, 1, 1)`.
- `backend/tests/test_stress_run.py`: in `test_old_window`, change the window to
  `start=date(1999,1,4), end=date(1999,3,1)` and the expected text to
  `'Stored prices start at 2000-01-01'`.
- `frontend/src/lib/stress.ts`: add five presets to `STRESS_PRESETS` (see Interface).
- `frontend/src/lib/scenarios.ts`:
  - add the five ids to `PRESET_TAGS`;
  - rewrite the Historical Replay guide caveat (see Interface).
- `frontend/src/lib/stress.test.ts`: in the preset test on line 30, change `'2020-01-01'` to
  `'2000-01-03'`.
- `frontend/src/lib/scenarios.test.ts`: add the one test described in Interface.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` and the `main` branch are read-only.**

## Interface

### `STRESS_PRESETS`

The final array has **10 entries in chronological order**. The five new ones come first, then the
existing five, unchanged. Copy the new ones exactly:

```ts
  {
    id: 'dot-com',
    name: 'Dot-com bust',
    start: '2000-03-24',
    end: '2002-10-09',
    description: 'March 2000 high to the October 2002 low: a multi-year tech unwind.',
  },
  {
    id: 'gfc-2008',
    name: '2008 financial crisis',
    start: '2008-09-02',
    end: '2009-03-09',
    description: 'Lehman collapse through the March 2009 low. S&P 500 down about 45%.',
  },
  {
    id: 'euro-debt-2011',
    name: '2011 euro debt crisis',
    start: '2011-07-22',
    end: '2011-10-03',
    description: 'US credit downgrade and Greek default fears.',
  },
  {
    id: 'volmageddon-2018',
    name: 'Feb 2018 Volmageddon',
    start: '2018-01-26',
    end: '2018-02-08',
    description: 'Short-volatility blow-up: January 2018 high to the February low.',
  },
  {
    id: 'q4-2018',
    name: 'Q4 2018 sell-off',
    start: '2018-09-20',
    end: '2018-12-24',
    description: 'Fed hikes and the trade war: September high to the Christmas Eve low.',
  },
```

The dates are deliberate. GFC starts 2008-09-02 because 09-01 was Labor Day. Volmageddon and Q4 2018
are peak-to-trough, like the existing presets, rather than `main`'s calendar-ish dates. Do not
"fix" them.

### `PRESET_TAGS` additions

```ts
  'dot-com': ['crisis'],
  'gfc-2008': ['crisis'],
  'euro-debt-2011': ['crisis'],
  'volmageddon-2018': ['vol-shock'],
  'q4-2018': ['crisis'],
```

Put them before `'covid-crash'`, in that order.

### Guide caveat

Replace the second sentence of the `'Historical Replay'` text, the one starting `"Caveat: stored
prices start in 2020…"`, so the whole `text` reads exactly:

```
Buys today's holdings at the start of a past window and holds them to the end. Returns, drawdown, best and worst days, and each holding's contribution come from real prices. Caveat: stored prices go back to 2000, but a holding that didn't trade yet (a newer ETF or a later IPO) has no prices for an old window. It counts as flat, and a run with under 80% of the invested money priced is refused.
```

Keep the existing string-concatenation style.

### New test (`scenarios.test.ts`)

One `it` that asserts, in a single test:
- `STRESS_PRESETS.map((p) => p.id)` has 10 entries and no duplicates;
- the ids are sorted by `start` ascending;
- `STRESS_PRESETS[0].id === 'dot-com'`;
- `PRESET_TAGS['volmageddon-2018']` equals `['vol-shock']`.

## Out of scope

- No factor-model / "Factor Replay" scenario type, endpoint or card. The planner rejected it on the
  evidence above.
- No change to `run_stress`, the coverage rule, `MIN_COVERAGE` or any endpoint.
- No change to `ScenariosSection.tsx`. Its `lg:grid-cols-5` grid already lays 10 cards out in two
  rows.
- No migration, no backfill script, and no network calls. The backfill happens on Gunnar's next
  sweep in production.
- No server-side slicing of `/universe/{t}/history` or `/indicators` payloads.
- Do not start a backend, do not run a sweep, and do not launch a browser.

## Acceptance criteria

Baselines: backend **840** passed; frontend **371** tests in **25** files; lint has 2 known warnings
(`UniversePage:77`, `HelpSidebar:44`).

1. `cd backend && .venv/bin/pytest -q` gives **840 passed**. The count is unchanged, because
   `test_old_window` is edited, not added.
2. `grep -n "HISTORY_START = " backend/app/universe.py` prints `HISTORY_START = date(2000, 1, 1)`.
3. `cd frontend && npx vitest run` gives **372** tests in **25** files, all passing.
4. `npx tsc -b`, `npm run build` and `npm run lint` are clean apart from the 2 known warnings.
5. `grep -c "id: '" frontend/src/lib/stress.ts` prints `10`.
6. `grep -n "start in 2020" frontend/src` (recursive) prints nothing.
7. `awk 'length > 300' frontend/src/lib/stress.ts frontend/src/lib/scenarios.ts` prints nothing.
   If the guide string trips it, split it across `+` lines as the existing text does.
8. `git diff --stat` lists only the six files above.

## Verification to run and paste

Paste the output of criteria 1–8 verbatim.

## Report

Use `contracts/TEMPLATE-report.md`. Set **Status:** reported.
