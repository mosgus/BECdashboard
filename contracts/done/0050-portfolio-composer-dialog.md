# Contract 0050 — Portfolio composer dialog, weight entry, and 0049 fixes

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

`New portfolio` opens a dialog on `/portfolios` where you name the portfolio, set cash, add assets
with either share counts or target weights, and press `Create portfolio` — the portfolio does not
exist until that press. Plus the four defects the 0049 audit found.

**Frontend only. No backend, no endpoint, no migration.**

## Why

Gunnar's request, 2026-09-18: creating a portfolio currently produces an empty shell you then fill in
place, and the layout swap from empty-state to list-plus-detail reads as a page change. A composer
dialog makes creation one deliberate act.

It also pulls **slice 1b** (target weights) forward, because he asked for a weight field per asset.

### Shares and weight cannot both be free inputs — this is the whole design problem

`weight = shares × price ÷ total`, and the total depends on every row plus cash. A typed weight means
nothing until something pins the total. With both fields live and nothing anchoring them, the first
asset added is 100% of the portfolio by definition and every later row silently rewrites the ones
above it.

**Gunnar's decision, 2026-09-18: a mode toggle at the top of the dialog.**

- **By shares** — type shares. Weight is computed live and rendered **read-only**. Cash is a `$`
  amount. This is the existing behaviour, moved into the dialog.
- **By weight** — type one **Total portfolio value** at the top. Every asset is a weight `%`, cash is
  a weight `%` too, and shares are derived at the current price and rendered **read-only**. Weights
  must sum to 100% before `Create portfolio` enables.

`REBUILD.md`'s decision holds unchanged: **shares are the stored truth, weights are derived.** Weight
mode is a converter at entry time only. Nothing downstream — `Portfolio`, `Position`,
`valuePortfolio`, `portfolioStore` — changes shape. A stored weight would describe what you intended
the day you typed it, which is why it is not stored.

### A missing price blocks weight mode only

Gunnar's decision, same date. Weight mode cannot convert a weight into shares without a price, so a
ticker with no price is **disabled in the picker** with a note. Shares mode allows it — a share count
is a fact that does not need a price, and `valuePortfolio` already renders such a row as `—`.

## Files

Create:
- `frontend/src/components/NewPortfolioDialog.tsx` — the composer

Modify:
- `frontend/src/lib/portfolio.ts` — add two pure conversion helpers and a draft summariser. **Do not
  change `Position`, `Portfolio`, `ValuedRow`, `ValuedPortfolio`, `positionPrice` or
  `valuePortfolio`.**
- `frontend/src/lib/portfolioStore.ts` — `savePortfolio` upserts **in place**, preserving order (fix 1)
- `frontend/src/lib/format.ts` — add `formatShares` (fix 4). Change no existing formatter.
- `frontend/src/pages/PortfoliosPage.tsx` — open the dialog instead of creating inline; fixes 1, 2, 3
- `frontend/src/components/PositionsTable.tsx` — `formatShares` for the shares column (fix 4)

**Touch nothing else.** No backend file, no migration, no `globals.css`, no `index.html`, no other
component or page. Nothing under `reference files/` — read-only, and it never belongs on a file list.
**No new dependency** — no form library, no state library, no decimal library.

`AddPositionForm.tsx` is **unchanged**. It remains the edit path for an existing portfolio; the
dialog is the create path only.

## Environment

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

`npm run lint` (oxlint) reports **exactly one** warning, the `set-state-in-effect` baseline in
`UniversePage.tsx`. Do not fix it, do not exceed it. Match on the rule and the count, not the line.

There is **no frontend test runner.** The greps fix the mechanics; Gunnar judges the result.

**Dark mode is live.** Every colour from a token — `bg-btn-action text-btn-action-text`,
`bg-btn-danger text-btn-danger-text`, `bg-overlay`, `text-brand-negative`, `text-[var(--color-muted)]`.
**No literal colour, no Tailwind palette colour, and no `dark:` variant** — `dark:` keys off the OS,
not the theme attribute, and that bug was removed in contract 0048.

## `lib/portfolio.ts` — additions, all pure

```ts
/** Weight of a value against a portfolio total, in percent units (33.3 means 33.3%) —
 *  the units lib/format.ts's formatPercent already expects. null when the total is not
 *  positive, so an empty or fully-unpriced draft yields "—" rather than NaN or Infinity. */
export function weightOf(value: number | null, totalValue: number): number | null

/** Shares implied by a target weight. null when price is null or <= 0, when totalValue is
 *  not positive, or when weightPercent is not finite — every path that would otherwise
 *  divide by zero. */
export function sharesForWeight(
  weightPercent: number,
  totalValue: number,
  price: number | null,
): number | null
```

Plus one summariser, so the dialog's enable/disable logic is testable without a browser:

```ts
export type EntryMode = 'shares' | 'weight'

export interface DraftRow {
  id: string            // crypto.randomUUID(), row identity — NOT the ticker, which starts empty
  ticker: string        // '' until chosen
  shares: string        // raw text, shares mode
  weight: string        // raw text, weight mode
}

export interface DraftSummary {
  rows: Array<{
    id: string
    ticker: string
    price: number | null
    shares: number | null     // typed in shares mode, derived in weight mode
    value: number | null
    weight: number | null     // derived in shares mode, typed in weight mode
  }>
  cash: number
  positionsValue: number
  totalValue: number
  cashWeight: number | null
  allocatedPercent: number | null   // weight mode: cash weight + row weights. null in shares mode.
  remainderPercent: number | null   // 100 - allocatedPercent. null in shares mode.
  canCreate: boolean
  problem: string | null            // one short line naming the first blocker, or null
}

export function summariseDraft(
  draft: {
    name: string
    mode: EntryMode
    totalValue: string    // raw text, weight mode only
    cash: string          // raw text, shares mode: dollars. weight mode: percent.
    rows: DraftRow[]
  },
  byTicker: Map<string, UniverseEntry>,
): DraftSummary
```

**Every numeric field crosses this boundary as raw text, not as a number.** That is deliberate — see
fix 2 below; it is the same bug in the dialog if the fields are bound to numbers.

No clock, no storage, no network, no `Intl`, no `crypto` inside `summariseDraft` — row ids arrive on
the draft. `NaN` and `Infinity` must not appear in any field of the returned object for any input.

### `canCreate` and `problem`

`canCreate` is true only when all of:

- `name.trim()` is non-empty
- every row has a ticker chosen
- **shares mode**: every row's shares text parses to a finite number `> 0`; cash text parses to a
  finite number (`0` is fine, and empty text counts as `0`)
- **weight mode**: total-value text parses to a finite number `> 0`; every row's weight text parses
  finite and `> 0`; every chosen ticker has a non-null price; and
  `|allocatedPercent - 100| <= 0.01` — a tolerance, because `1/3 + 1/3 + 1/3` in floating point does
  not land on exactly 100

**Zero assets is valid.** An all-cash portfolio is a real thing; do not require a row.

`problem` names the **first** unmet condition in plain words — `Weights must add up to 100%`,
`Every asset needs a share count`, `Give the portfolio a name`. One line, shown next to the disabled
button. A disabled button with no stated reason is the thing users file bugs about.

## `NewPortfolioDialog.tsx`

```tsx
export function NewPortfolioDialog({
  universe, onCancel, onCreate,
}: {
  universe: UniverseEntry[]
  onCancel: () => void
  onCreate: (portfolio: Portfolio) => void
}): JSX.Element
```

`onCreate` receives a fully-built `Portfolio` — `crypto.randomUUID()` id, trimmed name, resolved
`cash` in dollars, and `positions` as `{ticker, shares}` with **shares resolved to numbers in both
modes**. The page persists it; the dialog does not touch storage.

Layout, top to bottom:

1. **Portfolio name** — a text input, `autoFocus`, placeholder `Portfolio name`.
2. **Entry mode** — two toggle buttons, `By shares` / `By weight`, using the contract 0048 selected
   tokens the way `/ops`'s theme toggles do.
3. **Total portfolio value** — weight mode only. A text input.
4. **Cash** — a text input. Shares mode: a `$` amount, with its computed weight shown beside it
   read-only. Weight mode: a `%`, with the computed `$` shown beside it read-only.
5. **Asset rows** — each row is: ticker `<select>`, shares field, weight field, and a remove control.
   The field for the mode you are **not** in is read-only and visibly muted, showing the derived
   value or `—`.
6. **`+ Add asset`** — below the rows. Appends one empty row. This is the button Gunnar described:
   it stays below whatever rows exist, so pressing it repeatedly stacks rows.
7. **Footer** — the running allocation in weight mode (`3.5% unallocated` / `over-allocated by 2.0%`,
   from `remainderPercent`), `Cancel`, and `Create portfolio`.

Constraints:

- Each row's `<select>` excludes tickers already chosen in **other** rows, so a draft cannot hold the
  same ticker twice. In **weight mode**, a ticker with no price renders as a `disabled` `<option>`
  labelled `TICKER — no price available`.
- Dialog chrome matches `ChartDialog`/`FilterDialog`: `bg-overlay` backdrop, `role="dialog"`,
  `aria-modal="true"`, `aria-labelledby`, `z-[110]`, closes on backdrop click and on `Escape`
  (`document.addEventListener('keydown', …)` with a cleanup that removes it — see
  `FilterDialog.tsx:89`). **Do not import from either file.**
- The body scrolls: `max-h-[85vh] overflow-y-auto`. Twenty rows must not push the `Create` button off
  screen.
- `Create portfolio` is `disabled` when `canCreate` is false, with `problem` rendered beside it.

### Switching modes must convert, never blank

This is the defect I expect. Toggling `By shares` → `By weight` prefills **Total portfolio value**
with the computed total and each row's weight with its computed weight; toggling back fills each
row's shares with the derived count and cash with the derived dollars. Where a conversion is
impossible (no total typed yet, or a row with no price), leave that field **empty** — never `NaN`,
never `0`, and never silently drop a row. Losing typed input on a toggle is the classic form bug and
the fastest way to make the dialog feel broken.

### When the Universe is empty or unreachable

`universe.length === 0`: hide the mode toggle, force shares mode, disable `+ Add asset`, and show one
muted line pointing at `/universe`. Name and cash still work — a cash-only portfolio is still
creatable. This matches 0049's rule that local data never depends on the network.

## The four 0049 audit fixes

**1. Editing a portfolio must not reorder the list.** `PortfoliosPage.tsx:48` does
`[...prev.filter(p => p.id !== next.id), next]`, which appends. Since `persist` runs on every
keystroke of rename and every cash change, with two or more portfolios the one being typed in walks
to the bottom of the sidebar as you type, and `savePortfolio` persists that order. Replace in place
when the id exists, append only when it does not — **in both `PortfoliosPage.persist` and
`portfolioStore.savePortfolio`.**

**2. The cash input cannot take decimals.** `PortfoliosPage.tsx:174` binds a controlled
`type="number"` to a number. Type `1234.5` and at the intermediate `1234.` the DOM reports
`value === ''` (a trailing point is not a valid floating-point number per HTML), so
`Number('') || 0` writes `0` and React wipes the field. Hold the cash field as **text** in local
state, seeded from the selected portfolio and re-seeded when the selection changes, and persist only
when it parses to a finite number. `AddPositionForm` already does exactly this for shares — follow
it. **Every numeric field in the new dialog follows the same rule**; that is why `summariseDraft`
takes strings.

**3. Deleting a portfolio while others remain leaves a half-blank page.**
`PortfoliosPage.tsx:81` sets `selectedId` to `null` unconditionally, so the sidebar lists the
survivors while the right pane renders nothing and explains nothing. Select the first remaining
portfolio; `null` only when none remain.

**4. Fractional shares display rounded to three decimals.** `formatCount` is
`toLocaleString('en-US')`, whose default maximum is 3 fraction digits, so `10.123456` shares renders
`10.123`. Add to `lib/format.ts`:

```ts
/** Share counts. Thousands separators like formatCount, but up to 6 fraction digits and no
 *  trailing zeros — fractional shares are ordinary, and 0.5 should not read as 0.500000.
 *  Separate from formatCount, which formats bar counts and must stay integral. */
export function formatShares(v: number): string
```

Use it for the shares column in `PositionsTable` and for the derived/typed share display in the
dialog. **Change no existing formatter** — `formatCount` has other callers.

## Out of scope

- **No editing of an existing portfolio through the dialog.** It is the create path only; the inline
  panel and `AddPositionForm` remain the edit path. A future contract may unify them.
- **No stored target weights.** Weight mode converts at entry and stores shares. The
  `portfolio_target_set` question stays open.
- **No rebalancing**, no drift display, no "restore to target".
- No metrics: no volatility, beta, drawdown, correlation, Sharpe, optimisation. Slice 2, and it needs
  a backend endpoint.
- No CSV import or export, no non-Universe tickers, no charts.
- No server-side persistence, no endpoint, no migration.
- No change to the Universe page, the launch page, `/ops`, or the theme system.
- No change to `AddPositionForm.tsx`.

## Tooltips — required

| element | copy |
|---|---|
| `New portfolio` (page) | `Create a portfolio` |
| Name input | `Name this portfolio` |
| `By shares` toggle | `Enter how many shares you hold` |
| `By weight` toggle | `Enter target weights against a total portfolio value` |
| Total portfolio value input | `The total this portfolio's weights are measured against` |
| Cash input, shares mode | `Uninvested cash, counted in the total and in weights` |
| Cash input, weight mode | `Share of the portfolio held in cash` |
| Row ticker select | `Choose a security from your Universe` |
| Row shares field | `Number of shares held — fractions allowed` |
| Row weight field | `Target share of the portfolio` |
| Row remove | `Remove this asset from the draft` |
| `+ Add asset` | `Add another asset to this portfolio` |
| `Cancel` | `Discard this portfolio without creating it` |
| `Create portfolio` | `Create this portfolio with the assets above` |

Project `Tooltip`, never `title` — `title` does not render on `disabled` elements, which is exactly
when `Create portfolio` most needs explaining. See `REBUILD.md`, "Every interactive element gets a
hover tooltip."

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
2. `npm run lint` reports **exactly one** warning, still `set-state-in-effect`.
3. `git diff --stat backend/ frontend/src/styles/ frontend/index.html` is **empty**.
4. `git diff --stat -- frontend/src/components/AddPositionForm.tsx` is **empty**.
5. `grep -rn "dark:" frontend/src/` matches nothing (exit 1).
6. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/components/NewPortfolioDialog.tsx frontend/src/lib/portfolio.ts frontend/src/pages/PortfoliosPage.tsx`
   matches nothing (exit 1).
7. `grep -rnE "\b(bg|text|border|divide)-(white|black|gray|slate|zinc|red|green|blue|amber)-?[0-9]{0,3}\b" frontend/src/components/NewPortfolioDialog.tsx frontend/src/pages/PortfoliosPage.tsx`
   matches nothing (exit 1).
8. `grep -rn "localStorage" frontend/src/components/ frontend/src/pages/` matches nothing (exit 1).
9. `grep -n "export function valuePortfolio\|export function positionPrice" frontend/src/lib/portfolio.ts`
   shows both signatures **unchanged** from 0049. Quote them.
10. `grep -n "type=\"number\"" frontend/src/components/NewPortfolioDialog.tsx frontend/src/pages/PortfoliosPage.tsx`
    — for **every** match, quote the `value={…}` bound to it and show it is a **string** state, not a
    number. This is fix 2, and it is the criterion most easily faked.
11. `grep -n "filter(\|map(" frontend/src/lib/portfolioStore.ts` — quote `savePortfolio`'s upsert and
    show it preserves position for an existing id (fix 1).
12. `grep -n "setSelectedId" frontend/src/pages/PortfoliosPage.tsx` — quote the delete handler showing
    it selects a survivor (fix 3).
13. `grep -n "formatShares" frontend/src/lib/format.ts frontend/src/components/PositionsTable.tsx frontend/src/components/NewPortfolioDialog.tsx`
    matches in all three; `grep -n "formatCount" frontend/src/lib/format.ts` shows it **unchanged**.
14. `grep -n "Escape" frontend/src/components/NewPortfolioDialog.tsx` matches, and the listener is
    removed in the effect's cleanup. Quote both.
15. `git status --porcelain` lists nothing outside this contract's six files plus the contract file.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

Run each and paste the **complete, verbatim** output, including failures. Do not summarise or trim.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -rn "dark:" frontend/src/ ; echo "(exit $? — 1 = correct)"
grep -rn "localStorage" frontend/src/components/ frontend/src/pages/ ; echo "(exit $? — 1 = correct)"
grep -n "type=\"number\"" -A 3 frontend/src/components/NewPortfolioDialog.tsx frontend/src/pages/PortfoliosPage.tsx
grep -n "formatShares" frontend/src/lib/format.ts frontend/src/components/PositionsTable.tsx frontend/src/components/NewPortfolioDialog.tsx
grep -n "Escape" -A 4 frontend/src/components/NewPortfolioDialog.tsx
git diff --stat backend/ frontend/src/styles/ frontend/index.html ; echo "(empty = untouched)"
git diff --stat -- frontend/src/components/AddPositionForm.tsx ; echo "(empty = untouched)"
git status --porcelain
```

Plus the math, exercised against the **real compiled module** — not a hand-written mirror of it.
Transpile and import it, then delete both files:

```bash
cd frontend && npx esbuild src/lib/portfolio.ts --format=esm --outfile=/tmp/_p.mjs --log-level=error
# write /tmp/_check.mjs importing /tmp/_p.mjs, run with node, then rm -f /tmp/_p.mjs /tmp/_check.mjs
```

Show, from `summariseDraft`:

- **shares mode**, two rows plus cash: row weights and `cashWeight` sum to 100, `canCreate` true
- **weight mode**, 50/30/20 with cash at 20% and a total of 100000: derived shares equal
  `total × weight ÷ price` for each row, `allocatedPercent` 100, `remainderPercent` 0, `canCreate` true
- **weight mode summing to 90**: `canCreate` false and `problem` names the weights
- **weight mode, 1/3 each with cash 0**: `canCreate` **true** — proving the 0.01 tolerance works and
  floating point does not block a legitimate draft
- **a row with a null price in weight mode**: `canCreate` false; the same draft in shares mode with a
  share count: `canCreate` true
- **an empty draft** and a **name-only, zero-asset, zero-cash draft**: no division by zero
- **`totalValue` of 0 in weight mode**: `canCreate` false, no `Infinity` in any field

**`NaN` or `Infinity` anywhere in any output is a failure.** Paste it all.

## Human verification — does Gunnar need to run anything?

**Yes — all of it, in both themes.** Restart the frontend; `npm run dev` is fine, but if the backend
was stopped for point 7, restart it with `--reload` before anything else. A `uvicorn` started without
`--reload` serves the code it was launched with, forever.

1. `New portfolio` opens a **dialog**, and no portfolio exists until `Create portfolio` is pressed.
   `Cancel`, backdrop click, and `Escape` all discard it with nothing created.
2. **Shares mode**: name it, set cash to `1234.50` — *the decimal must survive typing*, which is
   fix 2 — add two assets with share counts, watch weights compute live. Create it. Value =
   price × shares, and the weights plus cash weight come to 100%.
3. **Weight mode**: total `100000`, cash `20%`, two assets at `50%` and `30%`. Derived share counts
   should appear as you type. Create it, then check the table's weights land on 50 / 30 / 20.
4. **The toggle.** Fill the dialog in shares mode, switch to weight, switch back. Nothing you typed
   should vanish or turn into `NaN`. This is the one I expect to be got wrong.
5. `Create portfolio` stays disabled until the draft is valid, and the line beside it says why.
6. **With two or more portfolios**, rename one and change its cash. It must **not** jump to the
   bottom of the sidebar as you type (fix 1). Delete one: a survivor is selected, not a blank pane
   (fix 3).
7. **Stop the backend, reload `/portfolios`.** Portfolios and share counts still render, prices read
   `—`. `New portfolio` still opens, with the muted line pointing at `/universe`.
8. Fractional shares — add `10.123456` shares of something. It should render in full, not `10.123`.
9. Dark mode, then light. Read-only derived fields must look clearly inert in both, and the
   over/under-allocated line legible.

## Open questions — do NOT resolve these yourself

- **Whether a portfolio should store its target weights** for later rebalancing. This contract
  converts and discards them. The reference's `portfolio_target_set` and `portfolio_last_rebalance`
  tables were cut with the relational schema; whether the concept returns is undecided.
- **Whether the dialog should later become the edit path too**, replacing the inline panel.
- **Whether cash should support multiple currencies.** It does not; it is one number.
- **Whether portfolios need an export file** as the backup story `REBUILD.md` mentions.
- **What happens to the four `Coming soon` cards.** Still open.
