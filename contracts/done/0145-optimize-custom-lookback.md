# Contract 0145 — Custom lookback for every portfolio analysis; drop 2Y

**Status:** accepted (with deviations, see Acceptance)
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Every portfolio analysis that takes a lookback accepts a **custom start date**, not just the four
fixed values.

- **Today's lookback rows:** on the Optimize tab and on the Outlook → CAPM Optimizer, the Lookback
  row changes from `1Y 2Y 3Y 5Y` to **`Custom 1Y 3Y 5Y`**. It's one shared component.
- **Custom:** opens a dialog where the user types a start date, or sets one with a preset button
  (**1 Mo**, **3 Mo**, **6 Mo**, **YTD**), then presses **Confirm**.
- **After Confirm:** the Custom button's label becomes that date, e.g. `2026-04-01`, and it's styled
  as selected.
- **Reset:** clicking 1Y, 3Y or 5Y clears the custom date. The button reads `Custom` again, and the
  user has to go through the dialog again.
- **Backend:** all three backends accept any `lookback_days` from **28** to **3650**. That's
  `optimize_run`, `capm_run`, and `montecarlo_run` (Monte Carlo, which has no UI yet).

## Why

Gunnar wants lookbacks other than whole years, for "any and all analysis on portfolios", with a
minimum of about a month. Decided 2026-10-01:

- **The floor is 28 calendar days.** The 1 Mo preset has to be valid on every date. The shortest
  "1 calendar month ago" span is 28 days (1 Mar back to 1 Feb), so 28 is the floor. 5-day was
  dropped.
- **A month of data is noisy, and the user is choosing that knowingly.** About 20 daily returns is
  enough to run, but:
  - Max Sharpe annualizes a 20-day mean, so it will tend toward corner weights.
  - Min CVaR (95%) has about one tail day.
  - A CAPM beta from 20 points has a wide error.

  This contract doesn't add warnings; the run summary already shows the fit window. One case is
  genuinely broken rather than just noisy, and it gets a hard guard: **more holdings than daily
  returns.** The sample covariance is then singular, and the "optimal" weights are arbitrary.
  Optimize and CAPM raise a 422 when `n_returns <= n_fitted_holdings`.
- **Monte Carlo keeps its own `MIN_RETURNS = 60`** (contract 0144). Bootstrapping from 20 days just
  replays the same 20 days. Its validation range widens to 28–3650 like the others, so its existing
  60-return check is what refuses short windows, with its existing clear message. When the Monte
  Carlo tab is built, its picker should start the dialog at about 3 months. That belongs to that
  contract.
- **The ceiling is 3650 days (10 years).** Holdings without that much history are pinned by the
  existing `PIN_GRACE_DAYS` rule, exactly as under 5Y today.
- **The wire format stays `lookback_days: int`.** The frontend converts the chosen date into
  calendar days before today. The backend counts back from the last common close, so on a weekend
  `fit_start` can land up to about three days before the chosen date. The run summaries show the
  real fit window. Accepted.
- **YTD is disabled while it's under the floor** (1–28 January), with a tooltip saying why.

## Files

Backend, modify:
- `backend/app/optimize_run.py`:
  - Remove `LOOKBACK_DAYS = (365, 730, 1095, 1825)`.
  - Add `MIN_LOOKBACK_DAYS = 28`, `MAX_LOOKBACK_DAYS = 3650`, and
    `def lookback_error(lookback_days: int) -> str | None`. It returns
    `f"lookback_days must be between {MIN_LOOKBACK_DAYS} and {MAX_LOOKBACK_DAYS}"` when the value is
    out of range, and `None` otherwise.
  - `run_optimize` uses `lookback_error`.
  - Add the holdings-vs-returns guard right after `returns = compute_returns(fit_prices)`.
- `backend/app/capm_run.py`:
  - Import `MIN_LOOKBACK_DAYS`/`lookback_error` instead of `LOOKBACK_DAYS`, and use
    `lookback_error`.
  - Add the same guard after `fit_returns = compute_returns(fit_prices)`, counting
    `fitted_tickers`.
- `backend/app/montecarlo_run.py`: the same import change, and use `lookback_error`. No guard,
  because `MIN_RETURNS` already covers it.
- Tests:
  - `backend/tests/test_optimize_run.py` and `backend/tests/test_capm_run.py`: new tests.
  - `backend/tests/test_api_optimize.py`, `backend/tests/test_api_capm.py`,
    `backend/tests/test_capm_run.py` and `backend/tests/test_montecarlo_run.py`: update the existing
    `lookback_days: 400` cases. 400 is now valid. Replace each with `27`, expecting the new
    `between 28 and 3650` message wherever the old test asserted a message.

Frontend, create:
- `frontend/src/components/LookbackPicker.tsx`: the `Custom 1Y 3Y 5Y` row plus the dialog wiring.
- `frontend/src/components/LookbackDialog.tsx`

Frontend, modify:
- `frontend/src/lib/optimize.ts`:
  - `LOOKBACK_OPTIONS` becomes 1Y/3Y/5Y.
  - Add the date helpers (below).
  - The `runSummary` label fallback.
- `frontend/src/lib/capm.ts`: the `capmSummary` label fallback only.
- `frontend/src/lib/optimize.test.ts` and `frontend/src/lib/capm.test.ts`: new tests.
- `frontend/src/lib/capmGuide.ts`: change the Lookback glossary text (below).
- `frontend/src/pages/analysis/OptimizePage.tsx` and
  `frontend/src/pages/analysis/outlook/CapmSection.tsx`: replace the inline Lookback button grid
  with `<LookbackPicker … />`.

**Touch nothing else.** That includes `schemas.py` and the routers: the field is already a plain
`int`. If the work appears to need another file, stop and report `BLOCKED`.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

### Backend guard (Optimize and CAPM)

```python
if len(returns) <= len(fitted_tickers):
    raise OptimizeInputError(   # CapmInputError in capm_run
        f"The lookback has {len(returns)} daily returns for {len(fitted_tickers)} holdings. "
        "Choose a longer lookback so there are more daily returns than holdings."
    )
```

### `frontend/src/lib/optimize.ts`

```ts
export const LOOKBACK_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '1Y', days: 365 }, { label: '3Y', days: 1095 }, { label: '5Y', days: 1825 },
]
export const MIN_LOOKBACK_DAYS = 28     // mirrors backend optimize_run.MIN_LOOKBACK_DAYS
export const MAX_LOOKBACK_DAYS = 3650   // mirrors backend optimize_run.MAX_LOOKBACK_DAYS
export type LookbackPreset = '1M' | '3M' | '6M' | 'YTD'

/** Whole calendar days from `date` (YYYY-MM-DD) to `today`'s local calendar date. */
export function customLookbackDays(date: string, today: Date): number
/** The YYYY-MM-DD start date for a preset, counted back from `today`'s local date. */
export function presetLookbackDate(preset: LookbackPreset, today: Date): string
/** null when `date` is a usable lookback start; otherwise the message to show. */
export function customLookbackError(date: string, today: Date): string | null
/** The label used in run summaries: '1Y' / '3Y' / '5Y', '2Y' for 730, otherwise `${days}-day`. */
export function lookbackLabel(days: number): string
```

- **Local calendar dates only.** Read `today` with `getFullYear()`, `getMonth()` and `getDate()`,
  and take differences with `Date.UTC(y, m, d)`. Never parse `YYYY-MM-DD` with `new Date(string)`:
  that parses as UTC midnight, which is the previous day in US time zones.
- **1M, 3M and 6M subtract calendar months, clamped to the end of the month.** 31 May minus 3
  months is 28 Feb, not 3 Mar. **YTD** is 1 January of `today`'s year.
- **`customLookbackError` messages, checked in this order:**
  - `''`, or not a real `YYYY-MM-DD` date → `'Choose a start date.'`
  - `days < MIN_LOOKBACK_DAYS` (which includes future dates) →
    `'Choose a date at least 4 weeks ago.'`
  - `days > MAX_LOOKBACK_DAYS` → `'Choose a date within the last 10 years.'`
- **`lookbackLabel`:**
  - `'2Y'` for 730 is kept on purpose, so a response from a pre-change request still reads sensibly.
  - `runSummary` (in `optimize.ts`) and `capmSummary` (in `capm.ts`) both switch to
    `lookbackLabel(response.lookback_days)`. A custom run reads e.g. `183-day lookback`.
- `DEFAULT_SETTINGS.lookbackDays` (365) and the CAPM default (1825) are unchanged.

### `LookbackPicker.tsx`

```tsx
interface LookbackPickerProps {
  lookbackDays: number
  onChange: (days: number) => void
  /** Tooltip for a fixed option, e.g. (years) => `Fit the weights on the last ${years} …`. */
  optionTooltip: (option: { label: string; days: number }) => string
  customTooltip: string
}
export function LookbackPicker(props: LookbackPickerProps): JSX.Element
```

- **It keeps two pieces of internal state:** `customDate: string | null` (initially `null`) and
  `open: boolean`.
- **Layout:** the existing label `Lookback` and a `grid grid-cols-4 gap-2`. Use the existing
  selected and unselected button classes unchanged.
- **The Custom button comes first:**
  - Its label is `customDate ?? 'Custom'`.
  - It's selected when `customDate !== null`.
  - Clicking it opens the dialog.
- **Then the three `LOOKBACK_OPTIONS` buttons:**
  - Each is selected when `customDate === null && lookbackDays === option.days`.
  - Clicking one calls `onChange(option.days)` **and** `setCustomDate(null)`.
- **Selection follows `customDate`, never a day-count match.** A custom date exactly 365 days ago
  leaves Custom selected, not 1Y.
- **On Confirm:** call `onChange(customLookbackDays(date, new Date()))`, then `setCustomDate(date)`,
  then close. Cancel and × change nothing.
- **Each page passes its current tooltip text through `optionTooltip`:**
  - Optimize: `Fit the weights on the last N year(s) of daily prices`.
  - CAPM: `Estimate betas and covariances from the last N year(s) of daily prices`.
- **Each page's `customTooltip`:**
  - Optimize: **"Fit the weights on daily prices from a start date you choose"**.
  - CAPM: **"Estimate betas and covariances from a start date you choose"**.
- Each page's existing "settings changed since the last run" logic keys off `lookbackDays` and
  needs no change.

### `LookbackDialog.tsx`

```tsx
interface LookbackDialogProps {
  initialDate: string | null
  onConfirm: (date: string) => void
  onCancel: () => void
}
```

- **Follow `SellPositionDialog.tsx`'s shell exactly:**
  - backdrop and panel classes;
  - `role="dialog"`, `aria-modal="true"` and `aria-labelledby`;
  - focus on open, and Escape cancels;
  - a click on the backdrop itself cancels;
  - focus returns to the opener.

  Match how that dialog is mounted. No focus trap and no scroll lock.
- **Header:** the title `Custom lookback`, with a `×` close button at the top right.
- **Body:**
  - A labelled `<input type="date">`. Its `min` is today minus `MAX_LOOKBACK_DAYS` and its `max` is
    today minus `MIN_LOOKBACK_DAYS`, both as `YYYY-MM-DD`. It's prefilled with `initialDate`, or
    with `presetLookbackDate('6M', today)` when that's null.
  - A row of preset buttons: `1 Mo`, `3 Mo`, `6 Mo` and `YTD`. Each sets the field. **It doesn't
    confirm.**
  - Disable YTD when `customLookbackError(presetLookbackDate('YTD', today), today) !== null`.
  - The `customLookbackError` message for the current value, in `text-xs text-brand-negative`,
    when it isn't null.
- **Footer:** `Cancel` and `Confirm`. Confirm is disabled while there's an error.

### `capmGuide.ts`

Replace the Lookback term's text with:

> How far back the daily prices used to estimate betas, volatilities and correlations go: 1, 3 or 5
> years, or a custom start date at least 4 weeks ago. Longer lookbacks are steadier but slower to
> reflect change; shorter ones react faster but are noisier.

## Tests

### Backend

Use the existing fixtures in each test file. Read the helpers first.

`test_optimize_run.py` uses business days from 2024-01-02 to 2024-12-31, and `Y` starts on
2024-06-03.

1. `lookback_days=180` succeeds:
   - `result.lookback_days == 180`;
   - `date(2024, 7, 4) <= result.fit_start <= date(2024, 7, 10)` (2024-12-31 minus 180 days is
     2024-07-04).
2. `lookback_days=28` succeeds with `{"A": 1, "B": 1}`.
3. `lookback_days=27` and `lookback_days=3651` each raise `OptimizeInputError`, matching
   `"between 28 and 3650"`.
4. `lookback_days=730` still succeeds.
5. **The guard:**
   - Closes for `A` and `B` sit only on `[date(2024, 12, 3), date(2024, 12, 17), date(2024, 12, 31)]`,
     with values `A = [100, 101, 102]` and `B = [100, 99, 101]`. `SPY` is a copy of `A`.
   - Run with `lookback_days=28` (start 2024-12-03, which is in the window).
   - It raises `OptimizeInputError` matching `"2 daily returns for 2 holdings"`.

`test_capm_run.py`: the same guard test (case 5) through `run_capm`, with the market series on the
same three dates. It raises `CapmInputError` matching `"daily returns for 2 holdings"`. Also, case 1
with `lookback_days=180` succeeds.

### Frontend

Write these in `optimize.test.ts`, using the literal values below. `new Date(y, m, d)` is a local
date, and months are zero-based.

| call | expected |
|---|---|
| `customLookbackDays('2026-07-01', new Date(2026, 9, 1))` | `92` |
| `presetLookbackDate('1M', new Date(2026, 9, 1))` | `'2026-09-01'` |
| `presetLookbackDate('3M', new Date(2026, 9, 1))` | `'2026-07-01'` |
| `presetLookbackDate('6M', new Date(2026, 9, 1))` | `'2026-04-01'` |
| `presetLookbackDate('YTD', new Date(2026, 9, 1))` | `'2026-01-01'` |
| `presetLookbackDate('3M', new Date(2026, 4, 31))` | `'2026-02-28'` |
| `presetLookbackDate('1M', new Date(2026, 2, 31))` | `'2026-02-28'` |
| `customLookbackError('2026-09-03', new Date(2026, 9, 1))` | `null` (28 days) |
| `customLookbackError('2026-09-04', new Date(2026, 9, 1))` | `'Choose a date at least 4 weeks ago.'` (27 days) |
| `customLookbackError('2026-12-01', new Date(2026, 9, 1))` | `'Choose a date at least 4 weeks ago.'` (future) |
| `customLookbackError('2015-01-01', new Date(2026, 9, 1))` | `'Choose a date within the last 10 years.'` |
| `customLookbackError('', new Date(2026, 9, 1))` | `'Choose a start date.'` |
| `customLookbackError(presetLookbackDate('1M', new Date(2026, 2, 1)), new Date(2026, 2, 1))` | `null` (1 Feb → 1 Mar, 28 days) |
| `customLookbackError(presetLookbackDate('YTD', new Date(2026, 0, 20)), new Date(2026, 0, 20))` | `'Choose a date at least 4 weeks ago.'` (19 days) |
| `lookbackLabel(1825)` / `lookbackLabel(730)` / `lookbackLabel(183)` | `'5Y'` / `'2Y'` / `'183-day'` |
| `runSummary({ ...RESPONSE, lookback_days: 183 })` | contains `'183-day lookback'` |

In `capm.test.ts`: `capmSummary({ ...RESPONSE, lookback_days: 183 })` contains `'183-day lookback'`.

The existing `5Y lookback` summary tests in both files must still pass unchanged.

## Out of scope

- A Monte Carlo UI, or any lookback picker for it.
- Lookbacks under 28 days, and a 5-day preset.
- Low-sample warnings beyond the holdings-vs-returns guard.
- Sending a date over the wire.
- Persisting the custom date across page loads.
- A shared modal shell.
- Reformatting unrelated code. Note any lines over 300 characters before you start, and add none.

## Acceptance criteria

Run from the repo root, **in bash**.

1. `grep -rn "LOOKBACK_DAYS = (\|not in LOOKBACK_DAYS" backend/app` prints nothing.
2. `grep -c "lookback_error(" backend/app/optimize_run.py backend/app/capm_run.py backend/app/montecarlo_run.py`
   prints at least `1` for each file. (`optimize_run.py` counts the definition and its use.)
3. `grep -c "daily returns for" backend/app/optimize_run.py backend/app/capm_run.py` prints `1` for each.
4. `grep -n "MIN_RETURNS = 60" backend/app/montecarlo_run.py` still prints a line.
5. `grep -n "'2Y'" frontend/src/lib/optimize.ts` prints only the `lookbackLabel` line, not a
   `LOOKBACK_OPTIONS` entry.
6. `grep -c "<LookbackPicker" frontend/src/pages/analysis/OptimizePage.tsx frontend/src/pages/analysis/outlook/CapmSection.tsx`
   prints `1` for each, and `grep -c "LOOKBACK_OPTIONS.map" <same two files>` prints `0` for each.
7. `grep -c 'role="dialog"' frontend/src/components/LookbackDialog.tsx` prints `1`, and
   `grep -n "title=" frontend/src/components/LookbackDialog.tsx frontend/src/components/LookbackPicker.tsx`
   prints nothing.
8. `grep -n "new Date('" frontend/src/lib/optimize.ts` prints nothing.
9. `git diff --stat -- backend/app/schemas.py backend/app/routers` prints nothing.
10. `cd backend && PATH="$PWD/.venv/bin:$PATH" pytest` passes in full, including the new tests.
11. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. Plain `--noEmit` is vacuous here;
    never use it.
12. `cd frontend && npm run lint` exits 0, with no new warnings. The two existing ones are in
    `HelpSidebar.tsx` and `UniversePage.tsx`.
13. `cd frontend && npm test` passes in full (the existing tests plus the new ones), and
    `npm run build` succeeds.
14. After the build, `grep -l "ResponsiveContainer" frontend/dist/assets/index-*.js` prints nothing.
15. `awk 'length > 300 {print FILENAME": "FNR": "length}'` over every touched or created frontend
    file prints no new lines. Run it before and after, and paste both.

`BLOCKED` is the right answer to a criterion that cannot be satisfied, and to an undecided design
question. Don't find a clever way to pass a criterion. A clever pass is worse than a stop.

## Verification to run and paste

Paste the **complete, verbatim** output of every command, including failures. A summary doesn't
count as output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
bash <<'EOF'
FE="frontend/src/lib/optimize.ts frontend/src/lib/capm.ts frontend/src/lib/capmGuide.ts frontend/src/pages/analysis/OptimizePage.tsx frontend/src/pages/analysis/outlook/CapmSection.tsx frontend/src/components/LookbackPicker.tsx frontend/src/components/LookbackDialog.tsx"
PAGES="frontend/src/pages/analysis/OptimizePage.tsx frontend/src/pages/analysis/outlook/CapmSection.tsx"
awk 'length > 300 {print FILENAME": "FNR": "length}' $FE 2>/dev/null   # before AND after
grep -rn "LOOKBACK_DAYS = (\|not in LOOKBACK_DAYS" backend/app
grep -c "lookback_error(" backend/app/optimize_run.py backend/app/capm_run.py backend/app/montecarlo_run.py
grep -c "daily returns for" backend/app/optimize_run.py backend/app/capm_run.py
grep -n "MIN_RETURNS = 60" backend/app/montecarlo_run.py
grep -n "'2Y'" frontend/src/lib/optimize.ts
grep -c "<LookbackPicker" $PAGES
grep -c "LOOKBACK_OPTIONS.map" $PAGES
grep -c 'role="dialog"' frontend/src/components/LookbackDialog.tsx
grep -n "title=" frontend/src/components/LookbackDialog.tsx frontend/src/components/LookbackPicker.tsx
grep -n "new Date('" frontend/src/lib/optimize.ts
git diff --stat -- backend/app/schemas.py backend/app/routers
EOF
(cd backend && PATH="$PWD/.venv/bin:$PATH" pytest -q)
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
npm run build
grep -l "ResponsiveContainer" dist/assets/index-*.js
```

## Tooltips

Every control uses the `Tooltip` component, never `title`.

- Custom button: the page's `customTooltip` (see `LookbackPicker`).
- 1Y/3Y/5Y: the page's existing generated text, passed through `optionTooltip`.
- 1 Mo: **"Set the start date to 1 month ago"**
- 3 Mo: **"Set the start date to 3 months ago"**
- 6 Mo: **"Set the start date to 6 months ago"**
- YTD: **"Set the start date to January 1 of this year"**. When disabled:
  **"Too short this early in the year. A lookback needs at least 4 weeks of prices."**
- Confirm: **"Use this start date for the next run"**
- Cancel and ×: **"Close without changing the lookback"**

## Human verification — does Gunnar need to run anything?

**Yes.** Run the backend and frontend, and check at ~1440px and ~390px.

1. **Optimize tab:**
   - The row reads `Custom 1Y 3Y 5Y`, with 1Y selected.
   - Click Custom, then 1 Mo. The field updates and the dialog stays open. Confirm. The button
     shows the date and is highlighted.
   - Run. The summary reads `N-day lookback`, and `fitted` starts within a few days of the date.
2. **Reset:** click 3Y. Custom reads `Custom` again. Reopening it shows the last date prefilled.
3. **Outlook → CAPM:** the same row, with 5Y selected by default. A 3 Mo custom run works, and the
   summary shows `N-day lookback`.
4. **Dialog validation:** in the dialog, a date from last week shows the 4-weeks message and
   disables Confirm. Escape, ×, and a click on the backdrop all close it without changes.
5. **Optional stress test:** a portfolio with 25+ holdings on a 1 Mo custom lookback shows the
   "more daily returns than holdings" error, not weights.

## Open questions

None. If a mode crashes on real data at 28 days instead of returning noisy weights (for example a
solver failure in Min CVaR), report the error. Don't raise the floor silently.

## Audit (planner, 2026-10-01): PARTIAL, rework required

**What's correct, and checked by the planner:**
- **Backend:** `lookback_error` is used in all three run modules, `LOOKBACK_DAYS` is gone,
  `MIN_RETURNS = 60` is kept, and both guards are present.
- **The guard:** run directly against the contract's three-date fixture, it raises
  "The lookback has 2 daily returns for 2 holdings…".
- **The frontend helpers:** checked by hand against every row of the Tests table, and all match,
  including the month-end clamps and the YTD-in-January case.
- **Checks:** pytest 702 passed; tsc exit 0; lint shows only the two existing warnings; 278 tests
  passed; the build succeeds; the entry bundle has no recharts.

The `schemas.py` and `routers/portfolio.py` diffs are contract 0144's uncommitted Monte Carlo work,
not this contract's.

## Rework 1

Fix only these items, then re-run and paste the **full** "Verification to run and paste" block,
verbatim.

1. **Layout bug: `LookbackPicker` returns a fragment.** Both parents are CSS grids:
   `md:grid-cols-3` on Optimize and `md:grid-cols-4` on CAPM. The label and the button row
   therefore land in **two separate grid cells**, which breaks both settings layouts. Wrap the
   picker's output in a single `<div>`, as the replaced markup was.
2. **Focus bug: `LookbackDialog`'s effect depends on `[onCancel]`.**
   - `LookbackPicker` passes a new arrow function on every render, so any parent re-render re-runs
     the effect. A parent re-renders when, for example, prices finish loading.
   - Each re-run overwrites `priorRef` with the currently focused element (the dialog or its
     input) and refocuses the panel. That steals focus mid-typing and breaks focus return.
   - The fix: use `SellPositionDialog.tsx`'s pattern exactly. Keep `onCancelRef = useRef(onCancel)`,
     and run the effect once with `[]` deps.
3. **The required tests aren't written.** Add every backend test in the Tests section (cases 1–5
   for `test_optimize_run.py`, the guard and 180-day cases for `test_capm_run.py`), every row of
   the frontend table, and the `capmSummary` test. These are what make the work auditable.
   PARTIAL without them is the right outcome; this rework is them.
4. **Collapsed lines.** `LookbackDialog.tsx` has lines of 374 and 2392 characters, and
   `LookbackPicker.tsx` one of 808, which fails criterion 15. Don't reformat by hand. After
   fixing 1 and 2, run exactly:
   `cd frontend && npx --yes prettier@3 --print-width 120 --single-quote --no-semi --write src/components/LookbackDialog.tsx src/components/LookbackPicker.tsx`
   Run it on those two files only.
5. **Small fixes:**
   - Give the dialog's `×` button `aria-label="Close"`.
   - Give the preset buttons `disabled:opacity-50`, so a disabled YTD looks disabled.
   - Remove the unused `MIN_LOOKBACK_DAYS` import from `capm_run.py`.

**Touch nothing else.**

## Acceptance (planner, 2026-10-01): ACCEPTED

Rework 1 report: PARTIAL, citing criterion 15 only. The planner re-ran the full verification
block after Gunnar ran the mandated Prettier command himself.

- **Rework items 1, 2 and 5 are done:** the picker is wrapped in one `<div>`; the dialog uses
  `onCancelRef` with a `[]`-deps effect; `aria-label="Close"` and `disabled:opacity-50` are
  present; the unused import in `capm_run.py` is gone.
- **Item 3, the tests, is done:** backend guard and custom-lookback cases, every frontend table
  row, and `runSummary`/`capmSummary` with 183.
- **Item 4, collapsed lines:** the agent reported that Prettier "produced no output and left the
  files unchanged". That was false. The command works. The line lengths had grown since the
  audit, so the files were edited after the formatter ran, or it never ran. Gunnar ran it, and
  it printed both files.
- **Criterion 15:** awk still prints `capmGuide.ts:77` and three lines in `OptimizePage.tsx`
  (445/450/455). All four are in HEAD at identical lengths and the diff doesn't touch them, so
  they are not new. Pass.
- **Results:** pytest 705 passed; tsc exit 0; lint shows only the two existing warnings
  (HelpSidebar, UniversePage); 281 tests passed; the build succeeds; the entry bundle has no
  recharts.
- **Deviation, criterion 9:** `schemas.py` and `routers/portfolio.py` show a diff. It is contract
  0144's uncommitted Monte Carlo work, not this contract's. 0145 also edited
  `montecarlo_run.py` and its tests, so the two land in the same commit.
- **Process note:** the agent reported a verification failure without checking it. A formatter
  that prints nothing on `--write` didn't run.
