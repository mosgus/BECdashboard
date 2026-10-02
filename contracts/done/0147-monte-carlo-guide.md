# Contract 0147 — Monte Carlo help guide

**Status:** accepted (browser check outstanding)
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The Monte Carlo settings card gets a **Help** button that opens a "Monte Carlo guide" side panel.
The panel explains:
- what the simulation does;
- how a path is built under each model;
- each setting;
- the short-history window;
- how to read the results;
- the model's limits.

It's built the same way as the existing CAPM guide.

## Why

0146 shipped the Monte Carlo section without help (REBUILD.md: "Help comes with 0147"). Every other
analysis on Outlook and Optimize has a guide.

`main` has `frontend/components/MonteCarloGuide.tsx`. Read it with `git show`, but **don't copy
it**. It describes a different engine:
- it says "GBM";
- it covers the efficient frontier (now on Optimize);
- it covers Brier/calibration, which isn't built.

The copy below matches what `backend/app/montecarlo_run.py` actually does.

## Files

Create:
- `frontend/src/lib/monteCarloGuide.ts` — `MONTE_CARLO_SETTING_TERMS` and `MONTE_CARLO_GUIDE`.
- `frontend/src/lib/monteCarloGuide.test.ts` — tests.
- `frontend/src/pages/analysis/outlook/MonteCarloGuide.tsx` — the panel.

Modify:
- `frontend/src/pages/analysis/outlook/MonteCarloSection.tsx` — the Help button, the open state,
  and rendering the guide.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. `reference files/` is read-only.

## Interface

`lib/monteCarloGuide.ts` reuses the types from `lib/capmGuide.ts`. **Import** them, and don't
redeclare them:

```ts
import type { GuideSection } from './capmGuide'

export const MONTE_CARLO_SETTING_TERMS = [
  'Lookback',
  'Model',
  'Horizon',
  'Simulations',
  'Starting value',
] as const

export const MONTE_CARLO_GUIDE: GuideSection[] = [ /* see Copy */ ]
```

`MonteCarloGuide.tsx` is a copy of `pages/analysis/outlook/CapmGuide.tsx` with three changes:
- the title is `"Monte Carlo guide"`;
- the data is `MONTE_CARLO_GUIDE`;
- the export is `MonteCarloGuide`.

Change nothing else, so the markup and classes stay identical.

`MonteCarloSection.tsx`:
- Add `const [guideOpen, setGuideOpen] = useState(false)` with the other state hooks. It must come
  **before** the `if (portfolio === null) return null` early return (rules of hooks).
- Replace `<h2 className="text-sm font-semibold mb-4">Monte Carlo settings</h2>` with the same
  header row CapmSection uses:

  ```tsx
  <div className="flex items-center justify-between gap-4 mb-4">
    <h2 className="text-sm font-semibold">Monte Carlo settings</h2>
    <HelpButton tooltip="What the Monte Carlo simulation does and how each setting works" onClick={() => setGuideOpen(true)} />
  </div>
  ```

- Render `{guideOpen && <MonteCarloGuide onClose={() => setGuideOpen(false)} />}` as the last child
  of the outer `space-y-5` div.
- Import `HelpButton` from `../../../components/GuidePanel`, and `MonteCarloGuide` from
  `./MonteCarloGuide`.

## Copy

Use it **verbatim**. Curly apostrophes (’) match `capmGuide.ts`. Each bullet below is one string
in `paragraphs`, or one `{ term, text }` in `entries`. Sections go in this order.

### 1. `What this does`

paragraphs:
- `Monte Carlo simulates many possible paths for this portfolio’s value by replaying its own past daily returns in random order. The spread of the paths shows how wide the range of outcomes could be over the horizon you choose.`
- `It is a simulation of past behavior, not a forecast. Nothing is applied to the portfolio.`

### 2. `How a path is built`

paragraphs:
- `First, the holdings’ daily returns over the lookback are combined into one daily return series for the portfolio at its current weights, as if it were rebalanced back to those weights every day. Cash is part of the weights and earns nothing.`
- `Each path then starts at the starting value and compounds one simulated daily return per trading day until the horizon. A day can lose at most everything, so values never go below zero.`
- `The random draws use a fixed seed (42), so the same settings always give the same result.`

entries:
- `Bootstrap` — `Each simulated day is a real day from the lookback, picked at random with replacement. It keeps the real shape of daily returns, including fat tails and big moves. Each day is picked independently, so streaks and calm or stormy periods are not reproduced.`
- `Normal` — `Each simulated day is drawn from a bell curve with the same daily mean and volatility as the lookback. Extreme days are rarer than in real markets, so the bands are usually a little narrower than with Bootstrap.`

### 3. `Settings`

entries, **in `MONTE_CARLO_SETTING_TERMS` order**:
- `Lookback` — `How far back the daily returns that the paths are drawn from go: 1, 3 or 5 years, or a custom start date at least 3 months ago. A longer lookback includes more kinds of markets; a shorter one reflects recent behavior but rests on fewer days.`
- `Model` — `Bootstrap or Normal. See How a path is built.`
- `Horizon` — `How far ahead each path runs: 3 months (63 trading days), 6 months (126), 1 year (252) or 2 years (504).`
- `Simulations` — `How many paths to simulate, from 100 to 10,000. More paths give smoother, more stable percentiles. They don’t make the result more accurate, because every path comes from the same past days.`
- `Starting value` — `The portfolio value on day 0. It defaults to the holdings at their last close plus cash. If the holdings have no share counts or prices, it is a hypothetical $10,000. Changing it scales every result in proportion; the percentage changes stay the same.`

### 4. `Short history`

paragraphs:
- `The simulation needs every holding to have a price on every day it uses. If a holding’s prices start more than a week after the lookback start, the simulation uses only the days from that holding’s first price onward, and a note under the results says so. At least 60 shared daily returns are needed to run.`

### 5. `Reading the results`

entries:
- `Summary` — `The number of paths, the horizon, the starting value and the exact window the returns came from.`
- `Chance of ending below the starting value` — `The share of paths that finish under the starting value at the horizon.`
- `Chart` — `The dark band holds the middle half of the paths (25th to 75th percentile) and the light band holds 90% of them (5th to 95th). The line is the median path, and the dashed line is the starting value. A wider fan means more uncertainty.`
- `Terminal values` — `Where the paths end at the horizon: the 5th, 25th, 75th and 95th percentiles, the median and the mean, each with its change from the starting value. The 5th percentile means 1 path in 20 ended lower.`
- `Mean and median` — `Compounding stretches the upside, so the mean usually sits a little above the median: a few strong paths pull the average up. Read the median as the typical outcome.`
- `Export CSV` — `Downloads the percentile paths shown in the chart.`

### 6. `Limits of the model`

paragraphs:
- `Every path comes from one window of the past. If that window was unusually calm or unusually strong, the simulation will be too. Try a different lookback to see how much the result depends on it.`
- `Days are drawn independently, so the simulation does not capture momentum, mean reversion, volatility clustering or changes in how the holdings move together.`
- `The weights are held fixed. Taxes, fees, trading costs, deposits and withdrawals are not included.`

## Tests (`lib/monteCarloGuide.test.ts`)

Model the file on `lib/capmGuide.test.ts`.

1. The `Settings` section's entry terms equal `[...MONTE_CARLO_SETTING_TERMS]`.
2. **Complete copy:** this is the same loop as the CAPM test. Every heading is non-empty and every
   section has at least one paragraph or entry. Every paragraph and every entry text is non-empty
   and ends with `.`.
3. **Horizons don't drift:** for every `option` in `HORIZON_OPTIONS` (from `./monteCarlo`), the
   `Horizon` entry's text contains `String(option.days)`.
4. **The headings in order:** `['What this does', 'How a path is built', 'Settings', 'Short history', 'Reading the results', 'Limits of the model']`.

## Out of scope

- Any change to the simulation, the chart (including its X-axis tick density) or the CAPM guide.
- Refactoring `OptimizerGuide` onto `GuidePanel`.
- Calibration copy, which comes with the later calibration contract.

## Acceptance criteria

Run from the repo root, **in bash**.

1. **Long lines:** `awk 'length > 300 {print FILENAME": "FNR": "length}'` over
   `MonteCarloSection.tsx` prints the same lines before and after. Paste both.
   - New `.tsx` files print nothing.
   - The copy strings in `monteCarloGuide.ts` can go over 300 characters. List them, and don't
     wrap them.
   - Never run prettier on `MonteCarloSection.tsx`.
2. `grep -n "HelpButton\|MonteCarloGuide\|guideOpen" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx`
   shows the import lines, the state hook, the button and the render.
3. `grep -n "GBM\|Brier\|frontier\|forecast" frontend/src/lib/monteCarloGuide.ts` prints exactly
   one line: the `not a forecast` paragraph.
4. `grep -n "interface GuideSection\|interface GuideEntry" frontend/src/lib/monteCarloGuide.ts`
   prints nothing (the types are imported).
5. `grep -rn "title=" frontend/src/pages/analysis/outlook/MonteCarloGuide.tsx` prints nothing.
6. **Frontend tests:** `cd frontend && npm test` passes. Run it **before you start** and at the
   end. "After" = "before" + your new tests (4 if you follow the list).
7. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
8. `cd frontend && npm run lint` exits 0, with only the existing `HelpSidebar.tsx`/`UniversePage.tsx`
   warnings.
9. `cd frontend && npm run build` succeeds, and then
   `grep -l "ResponsiveContainer" dist/assets/index-*.js` prints nothing.
10. **Smoke render:** if `/Applications/Google Chrome.app` exists, run
    `node contracts/tools/smoke-render.mjs outlook` with `npm run dev` running. Expect no
    `EXCEPTION:` line and a non-empty `ROOT TEXT`. If Chrome is absent, say so.

The backend is untouched, so there's no backend run.

`BLOCKED` is the right answer to a criterion that cannot be satisfied. Don't find a clever way to
pass a criterion.

## Verification to run and paste

Paste the **complete, verbatim** output of every command, including failures.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
bash <<'EOF'
awk 'length > 300 {print FILENAME": "FNR": "length}' frontend/src/pages/analysis/outlook/MonteCarloSection.tsx frontend/src/pages/analysis/outlook/MonteCarloGuide.tsx frontend/src/lib/monteCarloGuide.ts 2>/dev/null   # before AND after
grep -n "HelpButton\|MonteCarloGuide\|guideOpen" frontend/src/pages/analysis/outlook/MonteCarloSection.tsx
grep -n "GBM\|Brier\|frontier\|forecast" frontend/src/lib/monteCarloGuide.ts
grep -n "interface GuideSection\|interface GuideEntry" frontend/src/lib/monteCarloGuide.ts
grep -rn "title=" frontend/src/pages/analysis/outlook/MonteCarloGuide.tsx
EOF
cd frontend
npx tsc -p tsconfig.app.json --noEmit; echo "tsc exit $?"
npm run lint
npm test
npm run build
grep -l "ResponsiveContainer" dist/assets/index-*.js
```

## Tooltips

There's one new control: the Help button, with the tooltip
**"What the Monte Carlo simulation does and how each setting works"**. It goes through
`HelpButton`, which already wraps `Tooltip`. The panel's close button already has its tooltip from
`GuidePanel`. Don't use `title` anywhere.

## Human verification — does Gunnar need to run anything?

**Yes, in about a minute.** Go to Outlook → Monte Carlo.
- A **Help** button sits at the right of "Monte Carlo settings", and hovering it shows the tooltip.
- Clicking it opens the "Monte Carlo guide" panel with six sections.
- Escape, the ×, or clicking outside the panel closes it, and focus returns to the Help button.
- At about 390px the panel fits on screen.

## Open questions

None.

## Audit (planner, 2026-10-01)

The planner re-ran the checks:
- **Frontend tests:** 292 passed (288 + 4).
- **tsc:** exit 0.
- **Copy:** all 24 strings in the Copy section appear verbatim in `monteCarloGuide.ts`.
- **Tests:** the four tests match the spec.
- **`MonteCarloSection.tsx`:** the diff is exactly the specified header row, state hook, imports
  and render.

**One defect: the "deviation" is a gamed check.** `<GuidePanel {...{ title: 'Monte Carlo guide' }}>`
exists only so that `grep "title="` prints nothing. That's the "clever pass" the contract
forbids. The right move was to report the conflict.

The conflict was the planner's fault. Criterion 5 was meant to catch the HTML `title`
attribute, but `GuidePanel`'s required `title` prop matches it too. The prop is correct, and
`CapmGuide.tsx` uses `title="CAPM guide"`.

## Rework 1

1. In `MonteCarloGuide.tsx`, replace `{...{ title: 'Monte Carlo guide' }}` with
   `title="Monte Carlo guide"`. Then the file differs from `CapmGuide.tsx` only in the title, the
   data import and the export name.
2. **Criterion 5 is replaced by:**
   `grep -n "title=" frontend/src/pages/analysis/outlook/MonteCarloGuide.tsx` prints exactly one
   line, `<GuidePanel title="Monte Carlo guide" onClose={onClose}>`.
   `grep -n "{\.\.\.{" frontend/src/pages/analysis/outlook/MonteCarloGuide.tsx` prints nothing.
3. Re-run criteria 6–9. The test count is unchanged: 292 if nothing else moved, otherwise "same
   as before this rework".

Touch nothing else.

## Acceptance (planner, 2026-10-01)

**Rework 1 verified by the planner:**
- **Title:** `title=` prints only the `GuidePanel` line, and there's no spread prop.
- **Structure:** `MonteCarloGuide.tsx` is identical to `CapmGuide.tsx` apart from the title, the
  data import and the export name.
- **Gates:** 292 frontend tests pass, tsc exit 0, lint shows only the 2 known warnings, and the
  build is OK with no `ResponsiveContainer` in the index bundle.

**Accepted.** Gunnar's browser check (open, close, focus return, 390px) is still to do.
