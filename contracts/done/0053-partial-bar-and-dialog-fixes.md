# Contract 0053 — No partial bar on add, and the three 0050 dialog defects

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Adding a ticker during market hours no longer stores today's in-progress bar as a completed session,
so its change % is a real number on day one. And the portfolio composer focuses its first field,
validates cash in both modes, and stops writing `33.33333333333333` into an input.

Two unrelated parts, one small contract. **Part A is backend, Part B is frontend.** They share no
file; do them in either order.

---

# Part A — `add()` stores today's partial bar

## Why

Found 2026-09-18 on the deployed app, immediately after contract 0051. PBR was added during market
hours and showed `0.00%` change with coverage running to `2026-09-18`, while every other ticker
stopped at `2026-09-17`.

`universe.add()` does:

```python
start = _history_start(date.today())
stored = fetch_history(key, start=start, end=None)
```

`end=None` reaches `_download_history`, which passes it straight to `yf.download` — so the download
runs **through today** and today's in-progress bar is stored as though it were a completed session.
`last_close` reads the newest stored bar, so the change % compares today's price against **today's
own partial bar**: `0.00%` by construction, however good the live quote is. This is not the quote
gate — contract 0051 fixed that, and it works.

`refresh_ticker` cannot repair it the same day. `is_stale` is `newest < last_session`, and during the
session the stored bar is *newer* than the last completed session, so the row is not stale and
nothing re-fetches. **It does self-correct at the next close**, when `last_session` advances and
`missing_range` re-fetches starting from the newest stored date — that guard exists precisely for
partial bars, it is simply unreachable until the row goes stale.

So this is a one-day wrongness, not corruption. Fix it at the source anyway: a partial bar should
never be written, rather than written and later overwritten.

## Files

Modify:
- `backend/app/market_data.py` — expose the last completed session
- `backend/app/universe.py` — bound both first-fetch calls
- `backend/tests/` — tests

**Touch nothing else.** No migration, no model change, no frontend file, nothing under
`reference files/` (read-only, and it never belongs on a file list). No new dependency.

## Interface

```python
def last_completed_session() -> date | None:
    """The most recent session whose bars are final, or None when it cannot be determined.
    The public wrapper over _cached_last_session(_now_et().date(), _now_et().hour) — callers
    outside this module need the value and should not reach for the private helpers or call
    datetime.now() themselves."""
```

Both first-fetch sites in `universe.py` change from `end=None` to a bounded end:

```python
end = last_completed_session() or (date.today() - timedelta(days=1))
```

- `universe.add()` — the initial history fetch (currently `universe.py:104`)
- `universe.refresh()` — the zero-bar heal added by contract 0042 (currently `universe.py:175`)

**`_download_history`'s `end` is INCLUSIVE** — it adds a day before calling yfinance, whose `end` is
exclusive. It is the only place in the codebase that converts. Pass an inclusive date; do not
pre-adjust.

### Why the fallback is yesterday, not today

`_cached_last_session` returns `None` when the reference fetch fails — a real state, not a
hypothetical. Falling back to `end=None` would reintroduce the exact bug on every such failure.
Yesterday is safe: at worst it omits a *completed* session (running after 4pm on a trading day), and
`refresh_ticker` runs immediately after both call sites and fills that gap through `missing_range`.
Omitting a bar that is about to be fetched is strictly better than storing one that is wrong.

### The edge case to accept, not defend against

A symbol whose only bar would be today's — a first-day listing — now fetches nothing and raises
`HistoryUnavailable` instead of being added with one partial bar. That is the correct outcome:
`symbol_has_history` uses a 10-day window and would also have found nothing on a true first day. Do
**not** add a retry-with-today fallback to work around it.

## Acceptance criteria (Part A)

1. `PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q` passes, **428 or more** tests, still
   about 3 seconds, still hermetic.
2. `grep -n "end=None" backend/app/universe.py` matches nothing (exit 1).
3. A test proves `add()` passes an `end` equal to the last completed session — mock
   `last_completed_session` to a fixed date and assert on the `fetch_history` call, not on the
   network.
4. A test proves the fallback is used when `last_completed_session()` returns `None`, and that the
   fallback is **not** `None` and **not** today.
5. `git status --porcelain backend/migrations/` is empty — no migration.
6. `git diff --stat frontend/` shows **only** Part B's files.

---

# Part B — three defects in the composer dialog (from the 0050 audit)

## Why

All three were found auditing contract 0050 and reported to Gunnar on 2026-09-18. None is fatal;
together they are most of what makes the dialog feel unfinished.

## Files

Modify:
- `frontend/src/components/NewPortfolioDialog.tsx` — defects 1 and 3
- `frontend/src/lib/portfolio.ts` — defect 2, and the `toFieldText` helper defect 3 needs

**Touch nothing else.** No backend file, no `globals.css`, no other component or page. **Do not
change** `Position`, `Portfolio`, `ValuedRow`, `ValuedPortfolio`, `positionPrice`, `valuePortfolio`,
`weightOf` or `sharesForWeight`. No new dependency.

## Defect 1 — the dialog steals focus from the name field

`NewPortfolioDialog.tsx:32` calls `dialogRef.current?.focus()` inside the mount effect, while the
name input at line 139 has `autoFocus`. React applies `autoFocus` during commit and passive effects
run after paint, **so the container wins and the name field is never focused** — the dialog opens and
typing does nothing.

There is a second-order version: the effect's dependency is `onCancel`, which `PortfoliosPage.tsx`
passes as an inline arrow. Typing inside the dialog does not re-render the parent, so it is usually
inert — but if the `/universe` fetch resolves mid-typing, the parent re-renders, the effect re-runs,
and focus jumps to the container.

**Fix: delete the `dialogRef.current?.focus()` call.** Both problems go with it. The `Escape`
listener is on `document` and needs no focus inside the dialog, so it keeps working. Keep
`tabIndex={-1}` on the container; it is harmless and makes the dialog programmatically focusable if
a later contract adds a focus trap.

**Do not** "fix" this by removing `autoFocus` and keeping the container focus — the name field is
where typing should start.

## Defect 2 — weight mode silently swallows an invalid cash percentage

`summariseDraft`'s shares branch checks it (`portfolio.ts:195`, `Cash must be a valid number`); the
weight branch does not. Confirmed: total `1000`, cash `abc`, one row at `100%` → `canCreate: true`,
and the portfolio is created with cash `0`.

Add the matching check to the weight branch, in the existing ordered chain, **after** the
total-portfolio-value check and **before** the per-row weight check. Copy the shares branch's
semantics exactly: empty text counts as `0` and is valid; text that does not parse to a finite number
is the problem. Copy is `Cash must be a valid percentage`.

## Defect 3 — switching modes writes raw float strings into the inputs

`handleModeChange` uses `String(...)` on computed values, so toggling puts `33.33333333333333` in a
weight box and `166.66500000000005` in a shares box. The arithmetic is right; it just looks broken.

Add to `lib/portfolio.ts`, beside the other composer helpers so it is testable without a browser:

```ts
/** A computed number as text for a controlled number input. Plain digits only — no
 *  thousands separators (a "1,000" would parse back as NaN) and no exponent (a number
 *  input rejects "1e+21"). Trailing zeros are trimmed: 0.5 stays "0.5", not "0.500000".
 *  Not a display formatter — lib/format.ts is for reading, this is for re-parsing. */
export function toFieldText(value: number, maxDecimals: number): string
```

Non-finite input returns `''`. **Do not use `Intl` or `toLocaleString`** — separators are exactly
what breaks this.

Apply it in `handleModeChange`:

| field | maxDecimals |
|---|---|
| total portfolio value | 2 |
| cash (dollars or percent) | 2 |
| row weight | 4 |
| row shares | 6 |

4 decimals on a weight is deliberate: three rows at `33.3333` sum to `99.9999`, which is inside
`summariseDraft`'s existing `0.01` tolerance, so a round trip through the toggle still leaves
`Create portfolio` enabled. **Do not tighten the weight rounding past 4 without re-checking that
tolerance.** 6 on shares matches `formatShares`'s precision.

The "leave it empty when it cannot be computed" rule from 0050 is unchanged — `toFieldText` is
applied to values that exist, never as a way to turn a missing one into `'0'`.

## Out of scope

- No change to `AddPositionForm.tsx`, `PositionsTable.tsx`, `portfolioStore.ts` or
  `PortfoliosPage.tsx`.
- **No focus trap, no `inert` on the background, no scroll lock.** Defect 1 is a deletion; do not
  turn it into an accessibility project.
- No editing of an existing portfolio through the dialog. No stored target weights. No metrics.
- No change to the Universe page, the launch page, `/ops`, or the theme system.

## Acceptance criteria (Part B)

7. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
   **Not bare `tsc --noEmit`.**
8. `npm run lint` reports **exactly one** warning, still the `set-state-in-effect` baseline in
   `UniversePage.tsx`. Match on the rule and the count, not the line.
9. `grep -n "dialogRef.current?.focus\|\.focus()" frontend/src/components/NewPortfolioDialog.tsx`
   matches nothing (exit 1), and `grep -n "autoFocus" …` still matches on the name input.
10. `grep -n "String(" frontend/src/components/NewPortfolioDialog.tsx` matches nothing (exit 1) —
    every prefill goes through `toFieldText`.
11. `grep -rn "Intl\.\|toLocaleString" frontend/src/lib/portfolio.ts` matches nothing (exit 1).
12. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/components/NewPortfolioDialog.tsx`
    matches nothing (exit 1); `grep -rn "dark:" frontend/src/` matches nothing (exit 1).
13. `git status --porcelain` lists nothing outside this contract's five files plus the contract file.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

Paste the **complete, verbatim** output of each, including failures.

```bash
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q 2>&1 | tail -10
grep -n "end=None" backend/app/universe.py ; echo "(exit $? — 1 = correct)"
grep -n "last_completed_session" backend/app/market_data.py backend/app/universe.py
git status --porcelain backend/migrations/ ; echo "(empty = no migration)"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -n "\.focus()" frontend/src/components/NewPortfolioDialog.tsx ; echo "(exit $? — 1 = correct)"
grep -n "autoFocus" frontend/src/components/NewPortfolioDialog.tsx
grep -n "String(" frontend/src/components/NewPortfolioDialog.tsx ; echo "(exit $? — 1 = correct)"
grep -rn "Intl\.\|toLocaleString" frontend/src/lib/portfolio.ts ; echo "(exit $? — 1 = correct)"
git status --porcelain
```

Plus the frontend math against the **real compiled module** — transpile, import, run, delete both
files. Do not hand-write a mirror:

```bash
cd frontend && npx esbuild src/lib/portfolio.ts --format=esm --outfile=/tmp/_p.mjs --log-level=error
```

Show:

- `toFieldText` for `33.33333333333333` at 4 → `"33.3333"`; `166.66500000000005` at 6; `0.5` at 6 →
  `"0.5"` (no trailing zeros); `1000` at 2 → `"1000"`; `0` at 2 → `"0"`; `NaN` and `Infinity` → `""`.
  **No comma and no `e` in any output.**
- `summariseDraft` in **weight mode with cash `"abc"`**: `canCreate: false` and `problem` naming the
  cash. The same draft with cash `""` and a row at `100`: `canCreate: true`.
- A **round trip**: three rows at `100/3` percent each, cash `0`, rendered through `toFieldText(…, 4)`
  and fed back in as weight text — `canCreate` must still be `true`. This is the tolerance check, and
  it is the one that would break if the rounding were tightened.

## Human verification — does Gunnar need to run anything?

**Yes, both parts, and Part A only proves itself on a trading day.**

Restart the backend with `--reload` before anything visual. A `uvicorn` started without it serves the
code it was launched with, forever; `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound
port.

1. **Part A, during market hours:** add a ticker you do not already hold. Its Coverage should end at
   the **previous** session, like every other row — not today — and its change % should be a real
   non-zero number immediately.
2. Outside market hours the same add should behave exactly as it does now. Nothing about the closed
   market path changes.
3. **Part B, defect 1:** open `New portfolio` and start typing immediately. The name field should
   take the keystrokes with no click.
4. **Defect 3:** fill the dialog in shares mode, toggle to weight, toggle back. Numbers should read
   `33.3333`, not `33.33333333333333` — and `Create portfolio` must still be enabled after the round
   trip.
5. **Defect 2:** in weight mode, put something non-numeric in cash. `Create portfolio` should
   disable, with the reason beside it.
6. Dark mode, then light. Nothing here changes styling, so this is a regression check only.

## Open questions — do NOT resolve these yourself

- **Whether `last_close` should ignore a bar dated today regardless of how it got there.** This
  contract stops writing the bar; it does not make the read defensive. If a partial bar ever arrives
  by another path, the change % breaks the same way.
- **Whether the dialog should later become the edit path too**, replacing the inline panel.
- **Whether a portfolio should store its target weights** for rebalancing.
- **What happens to the four `Coming soon` cards.** Still open.
