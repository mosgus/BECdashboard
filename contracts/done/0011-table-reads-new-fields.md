# Contract 0011 — Universe table reads market cap, P/E and yield

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

The Mkt Cap, P/E and Yield columns display real values instead of a hardcoded em dash.

## Why

Planner defect. Contract 0010 widened `GET /universe` to return `market_cap`, `trailing_pe` and
`dividend_yield`, and asserted "no frontend change is needed — the columns already render `—` for
null and will light up on their own." **That was wrong.** `UniverseTable.tsx` passes a literal
`null` to each formatter (lines ~83–94, with a comment explaining that the list shape lacked the
fields), so the data is never read. Verified against the live API on 2026-09-13: the backend returns
`MSFT market_cap=3680323239936, trailing_pe=27.63, dividend_yield=0.73` while the page shows `—`.

Two small edits: put the fields on the list type, and read them.

**Depends on contracts 0009 and 0010.** If `GET /universe` does not return `market_cap`, stop and
report `BLOCKED`.

## Files

Modify:
- `frontend/src/api/client.ts` — move three fields from `UniverseDetail` to `UniverseEntry`
- `frontend/src/components/UniverseTable.tsx` — read the entry instead of passing `null`

**Touch nothing else.** Do not modify `globals.css`, `index.html`, `App.tsx`, `Header.tsx`,
`NavItem.tsx`, `lib/format.ts`, `AddTickerForm.tsx`, any page, or anything under `backend/`. No new
dependencies. If the work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `client.ts`

`UniverseEntry` gains these three, positioned after `regular_market_price`:

```ts
market_cap: number | null
trailing_pe: number | null
dividend_yield: number | null
```

**Remove them from `UniverseDetail`**, which extends `UniverseEntry` and would otherwise declare
them twice. `forward_pe` stays on `UniverseDetail` only — the table shows trailing P/E.

All three stay `| null`. ETFs genuinely have no `market_cap`, and non-dividend payers omit
`dividend_yield` entirely. QQQ is in the live database right now and returns `market_cap: null`.

### `UniverseTable.tsx`

Replace the three hardcoded nulls with the entry's values:

```tsx
{formatMarketCap(entry.market_cap)}
{formatRatio(entry.trailing_pe)}
{formatPercent(entry.dividend_yield)}
```

Delete the comment above them explaining that the list shape lacks the fields — it is no longer
true, and a stale comment is worse than none.

Change nothing else: same columns, same order, same responsive hiding, same alignment, same
`table-fixed` widths. The 375px overflow fix from contract 0009 must survive untouched.

## Out of scope

- No new columns. `beta`, `forward_pe`, `average_volume` and the 52-week range stay detail-only.
- No sorting, filtering, or pagination.
- No changes to `lib/format.ts` — the formatters already handle `null` correctly.
- No backend changes of any kind.
- No detail route.

## Acceptance criteria

0. Both files modified; nothing else.
1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0 with no output. **Not bare
   `tsc --noEmit`** — the root tsconfig has `files: []` and checks nothing.
2. `npm run build` succeeds.
3. `grep -n "formatMarketCap(null)\|formatRatio(null)\|formatPercent(null)" frontend/src/components/UniverseTable.tsx`
   matches nothing (exit 1).
4. `grep -cE '^\s+(market_cap|trailing_pe|dividend_yield):' frontend/src/api/client.ts` prints `3`,
   not `6` — no duplication across the base and subclass.
5. `git diff --stat frontend/package.json` is empty — no dependency added.
6. `git diff --stat frontend/src/lib/format.ts frontend/src/components/AddTickerForm.tsx frontend/src/pages/`
   is empty.
7. With the backend running, MSFT's row shows a market cap around `3.68T`, a P/E near `27.6`, and a
   yield near `0.73%`; **QQQ still shows `—` under Mkt Cap.**

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
grep -n "formatMarketCap(null)\|formatRatio(null)\|formatPercent(null)" frontend/src/components/UniverseTable.tsx ; echo "exit=$? (1 means clean)"
grep -cE '^\s+(market_cap|trailing_pe|dividend_yield):' frontend/src/api/client.ts ; echo "(must print 3)"
git diff --stat frontend/package.json frontend/src/lib/format.ts frontend/src/components/AddTickerForm.tsx frontend/src/pages/ ; echo "(empty = untouched)"
```

## Human verification — does Gunnar need to run anything?

**Yes — it is the entire point of the contract, and it takes ten seconds.**

Reload `http://localhost:5173/universe` with the backend running. MSFT should read roughly
`3.68T / 27.6 / 0.73%`, and **QQQ must still show `—` under Mkt Cap** — ETFs genuinely have none.
A number there would mean something is fabricating data.

## Open questions — do NOT resolve these yourself

- **Sorting by market cap or P/E.** Open; the list stays ticker-ordered.
- **Whether `beta` or the 52-week range join the table.** Not included; width is already tight at
  375px.
