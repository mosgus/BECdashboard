# Contract 0064 — Adding a position to a fully-invested portfolio: dilution and shares-driven entry

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

**Run after contract 0063.** Both touch `PortfoliosPage.tsx`; 0063's change there is a wrapper `<div>`
around two header buttons and does not overlap this work, but running them concurrently will conflict.

## Goal

A position can be added to a portfolio holding 0% cash, by weight or by share count, with existing
positions diluting pro rata to make room.

## Why

Gunnar built a real portfolio on 2026-09-21 by entering share counts. That path sets cash to 0%,
because no cash dollars were entered. `AddPositionForm.tsx:50` then gates the Add button on
`weightNumber > cashWeight`, and `portfolio.ts:192` refuses the same condition inside
`addPositionUsingCash`. With `cashWeight === 0`:

- any weight above 0 fails `weightNumber > cashWeight`
- a weight of exactly 0 fails `weightNumber <= 0`

**There is no value that enables the button.** A fully-invested portfolio permanently seals itself.
Verified against his exported file (`MU 77.80 / ORCL 11.15 / VOO 11.04 / CASH 0`), which is otherwise
perfectly well-formed and round-trips byte-identically.

Cash-only funding was the right first cut — it is the rule that guarantees an existing saved weight
never moves unless the user moves it (`REBUILD.md`, "Position model: saved weights are the truth").
This contract keeps that guarantee wherever cash can cover the add, and dilutes only when it cannot.

The second half: the composer can initialize by shares, but the editor cannot *add* by shares. Both
decided by Gunnar, 2026-09-21.

## The one rule

Both features are the same operation. A share count is a weight calculator; funding is one rule
applied to whatever weight comes out of it.

**Funding: cash first, dilute the shortfall pro rata across positions.**

Given existing position total `P`, cash `C` (`P + C = 100`), and a target weight `W`:

```
fromCash  = min(W, C)
shortfall = W - fromCash
scale     = shortfall > 0 ? (P - shortfall) / P : 1
```

Every existing position's weight is multiplied by `scale`. Cash becomes `100 - Σ(new weights) - W`,
**recomputed from the positions** rather than tracked independently — the idiom
`addPositionUsingCash` and `migrateLegacyPortfolio` already use, and what keeps the 100% invariant
exact.

When `C >= W` the scale is 1 and **no existing weight moves**, which is today's behaviour exactly.
Dilution engages only when it must. That is why this replaces `addPositionUsingCash` rather than
sitting beside it.

**Weight from shares:** buying `s` shares at price `p` grows the book, so the new holding's weight is
its share of the larger total:

```
impliedValue V = M / ((100 - C) / 100)       where M = Σ(shares_i × price_i) over existing positions
weight W       = (s × p) / (V + s × p) × 100
```

`V` is available only when **every** existing position carries a share count and a usable price. When
it is not, the shares input is unavailable with a stated reason — never a silent fallback to some
other number.

## Files

Modify:
- `frontend/src/lib/portfolio.ts` — replace `addPositionUsingCash` with `addPositionDiluting`; add
  `impliedPortfolioValue` and `weightFromShares`.
- `frontend/src/lib/portfolio.test.ts` — **create** if absent; add the tests below.
- `frontend/src/components/AddPositionForm.tsx` — the shares-driven entry and the new gate.
- `frontend/src/pages/PortfoliosPage.tsx` — `handleAddPosition` calls `addPositionDiluting`.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

`AddPositionForm.tsx` carries an uncommitted hand-edit — the `!available.some(...)` line at 46. **Keep
it.** It is the rule that a typed ticker must exist in the Universe, and it stays.

**`reference files/` is read-only and never belongs on a file list.** In particular
`reference files/portfolios/gunnport-2026-09-21.csv` is Gunnar's real exported portfolio; read it if
useful, do not copy a fixture out of it into the repo, and do not edit it.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

## Interface

```ts
/** Total portfolio value implied by share counts and current prices.
 *  null when any position lacks a share count or a usable price, when there are no
 *  positions, or when positions hold 0% of the allocation. Pure. */
export function impliedPortfolioValue(
  portfolio: Portfolio,
  byTicker: Map<string, UniverseEntry>,
): number | null

/** The weight `shares` at `price` would hold in a portfolio worth `impliedValue`
 *  once added. null for any non-finite or non-positive input. Pure. */
export function weightFromShares(
  shares: number,
  price: number,
  impliedValue: number,
): number | null

/** Add a position at its stated weight, funding from cash first and diluting existing
 *  positions pro rata for the shortfall. Returns null rather than producing an invalid
 *  portfolio. Replaces addPositionUsingCash — delete that export. */
export function addPositionDiluting(portfolio: Portfolio, position: Position): Portfolio | null
```

`addPositionDiluting` returns `null` when: the portfolio or position fails the existing validators,
the ticker is already held, `weight >= 100`, or the shortfall would drive the position total to zero
or below. It must never return a portfolio whose total is outside `100 ± 0.01` or whose cash is
negative — `portfolioStore.isValidCurrentPortfolio` rejects both and the save would silently no-op.

`positionPrice(entry)` is the existing `current_price ?? last_close ?? regular_market_price` chain.
Use it; do not write a second one.

### `AddPositionForm` behaviour

The weight and shares inputs become **two ways to specify one allocation**, not two independent
fields. Exactly one is authoritative at a time:

- Typing in **Weight %** derives nothing; shares stays whatever the user typed and is saved as
  metadata, as today.
- Typing in **Shares** *while the weight field is empty* derives the weight and shows it read-only,
  the same pattern `NewPortfolioDialog` already uses for its shares mode (`FIELD_READONLY`, an
  `aria-label="Derived weight"` input showing `formatPercent`).
- If the user types a weight, the weight wins and the derived display is dropped. Do not silently
  overwrite a typed weight.

When `impliedPortfolioValue` is `null`, the shares input still accepts a value as plain metadata but
derives nothing, and a short line explains why — name the actual cause:
`Add by shares needs a share count and a price on every existing position.`

**The Add button's gate becomes:** ticker chosen and in the Universe, an effective weight that is
finite and `> 0` and `< 100`, and shares either empty or finite and `> 0`. The
`weightNumber > cashWeight` condition is **deleted** — it is the bug.

When the effective weight exceeds available cash, show the consequence before the click, not after:

`Funding 10% will scale existing positions to make room.`

Use `formatPercent` from `lib/format.ts` for every percentage shown.

## Out of scope

- **No import UI.** File input and draft seeding are contract 0065.
- **No presets.** Do not add, stub, or name any preset portfolio or allocation.
- **Do not add a fund-from toggle.** "From cash or dilute" as a user-facing choice was considered and
  declined; one rule, applied automatically.
- **Do not add a stored notional value.** `impliedPortfolioValue` is derived at render time and
  persisted nowhere. `REBUILD.md` is explicit that no portfolio value is a required input or a source
  of allocation truth.
- Do not change `NewPortfolioDialog` or `summariseDraft`. Initialization already works.
- Do not change the CSV format, `portfolioCsv.ts`, `portfolioStore.ts`, or `download.ts`.
- Do not recompute any weight from a quote outside this explicit user action. Saved weights do not
  drift with prices — that is the whole position model.
- No new dependency.

## Acceptance criteria

1. `cd frontend && npm run test` exits 0, and the count is 23 (0063's total) plus the new tests.
2. `grep -rn "addPositionUsingCash" frontend/src/` prints nothing. The old export is gone, not
   shadowed.
3. `grep -n "weightNumber > cashWeight" frontend/src/components/AddPositionForm.tsx` prints nothing.
4. A test reproduces **Gunnar's exact portfolio** — `MU 77.8037268463051`, `ORCL 11.152630234572266`,
   `VOO 11.043642919122638`, `cashWeight 0` — adds a position at weight 10, and asserts: the result is
   not `null`, the four weights plus cash total `100 ± 0.01`, cash is still `0 ± 0.01`, and the three
   original positions retain their **relative** proportions (each original weight ÷ its new weight is
   the same value to within 1e-9).
5. A test asserts that when cash covers the add (`cashWeight: 40`, add at weight 10), **every existing
   position weight is strictly unchanged** (`===`) and cash becomes 30. This is the regression guard on
   the old guarantee.
6. A test asserts a partial-shortfall case (`cashWeight: 5`, add at weight 20) consumes all cash,
   dilutes the remainder, and ends with cash `0 ± 0.01`.
7. A test asserts `addPositionDiluting` returns `null` for a duplicate ticker, for `weight >= 100`,
   and for a weight that would drive the position total to zero or below.
8. A test asserts the result of `addPositionDiluting` passes `portfolioStore`'s validation — import
   the module and round-trip through `savePortfolio`/`listPortfolios` against a stubbed
   `localStorage`, or assert the invariant directly if stubbing proves awkward. Say which you did.
9. A test asserts `impliedPortfolioValue` returns `null` when one position has no share count, and
   `null` when one position's `UniverseEntry` yields no usable price.
10. A test asserts `weightFromShares` is strictly between 0 and 100 for finite positive inputs, and
    `null` for zero, negative, and non-finite ones.
11. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
    this project — see `REBUILD.md`.)
12. `cd frontend && npm run build` exits 0.
13. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
14. `cd frontend && npm ci` exits 0 — 0063 fixed the lockfile and this contract must not re-break it.
15. `git diff frontend/src/components/AddPositionForm.tsx` still contains the
    `!available.some((entry) => entry.ticker === ticker)` line.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npm run test
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm ci && echo "NPM CI OK"
grep -rn "addPositionUsingCash" src/ ; echo "old-export grep exit: $?"
grep -n "weightNumber > cashWeight" src/components/AddPositionForm.tsx ; echo "old-gate grep exit: $?"
grep -n "available.some" src/components/AddPositionForm.tsx
```

Report the derived weight your implementation produces for **5 shares of a $180 stock** added to
Gunnar's portfolio, given MU at $10, ORCL at $10 and VOO at $10 (so `M = 10×10 + 10×10 + 2.08×10`).
State `V`, the derived weight, and the four resulting weights. This is the number the audit checks by
hand.

## Tooltips — required for any contract adding interactive elements

The existing three inputs and the Add button keep their tooltips. Two change because their meaning
changes:

| element | tooltip label |
|---|---|
| `Shares` input | `Number of shares to add — sets this position's weight when the weight field is empty` |
| `Add` button | `Add this allocation, scaling existing positions if there is not enough cash` |
| `Weight %` input | `Percentage of the portfolio allocated to this security.` (unchanged) |
| `Ticker` input | `Type a ticker and choose a matching security from your Universe` (unchanged) |
| Derived-weight display (new) | `Weight derived from the share count and current prices` |

Phrased as the effect, not the label. Do **not** use the `title` attribute — it does not render on
`disabled` elements, which is exactly when this form needs to explain itself.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

At `http://localhost:5173/portfolios`, against your real `GunnPort`:

1. **The actual bug.** Select GunnPort (cash 0%). Type a Universe ticker and a weight of `10`. The
   Add button must now enable, and the line above it must say the existing positions will scale.
   Click it. MU/ORCL/VOO should drop to roughly 70.0 / 10.0 / 9.9 and the new position sit at 10.0,
   with cash still 0.00%.
2. **Add by shares.** Remove that position, then add a ticker by typing only a **share count**,
   leaving Weight empty. A derived weight should appear read-only beside it. Sanity-check it against
   what you'd expect from that stock's price — this is derived from live quotes, so it is the one
   number no test can confirm is sensible.
3. **The no-regression case.** Set Cash to `20`, then add something at weight `5`. The three existing
   weights must not move at all — only cash should drop to 15.
4. **Export afterwards and re-import the file** once 0065 lands, or at minimum re-export and confirm
   the weights still total 100 in the file.
5. Check the form at **1024px and 1023px** and at 375px. It is `flex flex-wrap` with four controls
   plus a new derived-weight field and an explanatory line; confirm it wraps rather than clipping.
   `REBUILD.md` records that a `min-width` breakpoint's worst case is exactly at its trigger point.

No backend restart is needed — this contract changes no server code.

## Open questions — do not resolve these yourself

None. The two design questions (dilute vs cash-only, shares-driven add) were decided by Gunnar on
2026-09-21 and are recorded in `REBUILD.md`. If you find a third, report `BLOCKED` and stop.
