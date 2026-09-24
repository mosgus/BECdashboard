> ## ⚠ REVISED 2026-09-24 — re-read this file before executing
>
> **The first run was correct and reported `BLOCKED` correctly.** Criterion 1 as first written
> ("no non-test frontend source mentions `basisDate`") contradicted the Interface requirement to
> strip a stored `basisDate` key in `portfolioStore.ts`. Stripping a key means naming it. That was
> the planner's error, not the coder's.
>
> **What changed:** criterion 1 (and its verification line) now allows `portfolioStore.ts` as the
> single exception, but only inside `normaliseStoredPortfolio`. A new check proves no reference
> exists outside that function.
>
> **What must NOT change in response:** the existing `normaliseStoredPortfolio` implementation
> (`const { basisDate: _basisDate, ...withoutBasisDate } = candidate`) is exactly what was wanted.
> Do not rename, split, or indirect the key to shrink a grep count. The edits already on disk for
> this contract are in place and should be kept. Resume by confirming the criteria and running
> the full verification block, including build, test, lint and pytest, which the first run
> stopped before.

# Contract 0095 — Remove the portfolio basis date ("Return since")

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The per-portfolio basis date is gone from the entire stack: the model, browser storage, the CSV
format, the Portfolios editor, the Holdings column, the API client, and the backend `since`
parameter. Data saved while the feature existed still loads and imports without error.

## Why

Contract 0079 added it; Gunnar reversed it on 2026-09-24. See REBUILD.md, "A basis date replaces
cost basis", which now records the reversal. In short: it computes "what if today's allocation had
been held since date X", which is a backtest question, and the Backtest tab will answer it properly.
Keeping two places that compute return-since-a-date guarantees they eventually disagree. The CSV
column also becomes more expensive to remove with every file exported. So remove it now.

**The one thing that needs care is the data that already exists**, not the deletion itself:

- Browser storage holds portfolios with `basisDate` on them. They must keep loading, and the field
  must not survive a re-save.
- Exported CSVs have a `basis_date` column with a date on the `CASH` row. They must keep importing,
  with the column ignored and not rejected.

## Files

Modify:
- `backend/app/routers/universe.py` — `get_returns`: remove the `since` parameter, its parsing and
  400 error, the window widening, `since_base`, and the `"since"` key. Drop `base_close_on_or_after`
  from the `app.returns` import if nothing else in the file uses it.
- `backend/app/schemas.py` — remove `since` from `TickerReturns`.
- `backend/tests/test_api_universe.py` — delete the seven `test_get_returns_*since*` tests (currently
  starting at the `def` lines matching `grep -n "since" backend/tests/test_api_universe.py`). Remove
  the `"since": None` entries from the two dict assertions in
  `test_get_returns_keeps_missing_tickers_and_request_order`. Add the one new test listed under
  Interface.
- `frontend/src/api/client.ts` — remove `since` from `TickerReturns`; `getReturns(tickers)` takes one
  argument.
- `frontend/src/lib/portfolio.ts` — remove `basisDate` from `Portfolio`, remove `isValidBasisDate`,
  its use in `isValidCurrentPortfolio`, and the `basisDate:` lines in `addPositionDiluting` and
  `removePositionToCash`.
- `frontend/src/lib/portfolioStore.ts` — remove the `isValidBasisDate` import and check, and the
  `basisDate:` line in `savePortfolio`. Strip a stored `basisDate` key on read (see Interface).
- `frontend/src/lib/portfolioCsv.ts` — remove `basisDate` from `DraftSeed`, `withBasisDate`,
  `basisDateIndex`, and the CASH-row date parsing. Serialize with a three-column header.
- `frontend/src/components/NewPortfolioDialog.tsx` — remove the `basisDate` state and its use.
- `frontend/src/pages/PortfoliosPage.tsx` — remove `basisDateText`, `handleBasisDateChange`, the
  `isValidBasisDate` import, the reseed line in the `useEffect`, and the whole `<label
  htmlFor="return-since">` plus its `<Tooltip>`/`<input type="date">`. The Cash input, the `%`
  span and `cashProblem` stay exactly as they are.
- `frontend/src/pages/analysis/HoldingsPage.tsx` — remove `basisDate`, the `getReturns` second
  argument, `basisDate` from the effect deps, the conditional header `<th>`, the conditional
  `ReturnCell`, and the conditional CASH-row `<td>`.
- `frontend/src/lib/portfolio.test.ts`, `frontend/src/lib/portfolioStore.test.ts`,
  `frontend/src/lib/portfolioCsv.test.ts` — remove or rewrite the basis-date tests as specified
  under Interface.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**Two files have uncommitted edits by Gunnar that are not part of this contract:**
- `HoldingsPage.tsx` imports and renders `<HelpSidebar />` next to the signal `<select>`, inside a
  `div` with `flex items-center justify-end gap-2 mb-3`. **Leave both exactly as they are.**
- `PortfoliosPage.tsx` line ~306 reads `Return basis`. That line is deleted as part of this contract
  anyway; that's expected.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs, since that is what it is for. It is a snapshot of other working software kept so its
behaviour can be compared against this rebuild, and an edited reference stops being evidence of
anything. `.claude/settings.json` denies Edit and Write there, but that deny list cannot see a
shell redirect, `sed -i`, `cp` or `mv`, so do not route around it.

## Interface

**Backend**

```python
@router.get("/returns", response_model=ReturnsResponse)
def get_returns(tickers: str = "") -> dict: ...
```

```python
class TickerReturns(BaseModel):
    ticker: str
    five_day: float | None
    thirty_day: float | None
    ytd: float | None
```

`window_start` goes back to `bar_window_start(today, today.year)` unconditionally.
`base_close_on_or_after` **stays in `app/returns.py`**, because `ytd_base_close` calls it. Do not
touch `returns.py` or `test_returns.py`.

New test in `test_api_universe.py`:

```python
def test_get_returns_ignores_a_stale_since_parameter(db_mode, client):
```

This covers a cached old frontend build still sending `?since=`. Request
`/universe/returns?tickers=AAA&since=2026-02-30` (a malformed date, which used to be a 400). Assert
status 200 and that the returned entry's keys are exactly
`{"ticker", "five_day", "thirty_day", "ytd"}`. Seed data the same way the neighbouring returns tests
do.

**Frontend**

```ts
export async function getReturns(tickers: string[]): Promise<ReturnsResponse>
```

```ts
export interface TickerReturns {
  ticker: string
  five_day: number | null
  thirty_day: number | null
  ytd: number | null
}
```

`serializePortfolioCsv` header becomes exactly `ticker,weight_pct,shares`, and every row has three
fields. The CASH row is `CASH,<cashWeight>,`.

**Stored-data compatibility (`portfolioStore.ts`).** Extend the existing `normaliseStoredPortfolio`
so that an object with a `basisDate` key comes back without it, regardless of the key's value
(valid date, garbage, or `null`). Keep its current cash-epsilon behaviour unchanged. Strip on read,
not only on save: `savePortfolio` rewrites *sibling* portfolios from `listPortfolios()`, so a
save-only strip would leave the field on every portfolio except the one being saved.

A behaviour change that is intended: today a stored portfolio whose `basisDate` is malformed is
**dropped** from the list by validation. After this contract it loads, with the field stripped.
Losing a user's portfolio over a field the app no longer reads would be wrong.

**CSV compatibility (`portfolioCsv.ts`).** The parser already ignores columns it does not look up.
After removing `basisDateIndex`, a `basis_date` column is simply one more unread column. Do not add
special handling for it, and do not add an error for it.

**Tests to leave in place (rewritten where noted):**

- `portfolioCsv.test.ts`
  - The header assertion now expects `'ticker,weight_pct,shares'`.
  - Replace "round-trips a basis date through the CASH row" with: **"imports a legacy export
    with a basis_date column and ignores it"**. Input, literally:
    `'ticker,weight_pct,shares,basis_date\nAAPL,60,2,\nCASH,40,,2026-01-02\n'`. Assert success, that
    `'basisDate' in result.seed` is `false`, and that the seed's rows and cash match what the same
    file without the fourth column produces.
  - Replace "rejects an invalid basis date on the CASH row" with: **"imports a legacy export whose
    basis_date is malformed"**, using
    `'ticker,weight_pct,shares,basis_date\nAAPL,60,2,\nCASH,40,,2026-02-30\n'`. Assert success.
    This is the case that used to fail, and it must now pass.
  - Delete "leaves the basis date undefined when it is absent" and "ignores a basis date on a
    position row".
  - Keep "accepts three-column exports without a basis date". Delete only its
    `expect(result.seed.basisDate)…` line and rename it to "accepts three-column exports".
- `portfolioStore.test.ts`
  - Replace "persists a valid basis date when saving and reading" with: **"strips a legacy
    basisDate on read"**. Stub storage with `[{ ...storedPortfolio(0), basisDate: '2026-01-02' }]`,
    call `listPortfolios()`, assert length 1 and `'basisDate' in result[0]` is `false`.
  - Replace "rejects malformed stored basis dates…" with: **"loads a portfolio whose legacy
    basisDate is malformed"**. Use `basisDate: 'not-a-date'`, assert length 1 and the key is absent.
  - Add **"does not re-save a legacy basisDate on a sibling"**. Use the same stateful stub as the
    old persist test (a `stored` string with `getItem`/`setItem`). Seed two portfolios with distinct
    ids, both carrying `basisDate: '2026-01-02'`. Call `savePortfolio` on the first. Then
    `JSON.parse(stored)` must contain no element with a `basisDate` key.
- `portfolio.test.ts` — delete the `describe('isValidBasisDate', …)` block and the import.

## Out of scope

- Do not change the Help sidebar on Holdings, its glossary, or `HelpSidebar.tsx`. That is a separate
  question, still open with Gunnar.
- Do not touch `app/returns.py`, `tests/test_returns.py`, or the 5D/30D/YTD computations.
- Do not add a replacement feature: no "since" date range on Holdings, no portfolio chart. Portfolio
  charting is the next contract and is being designed separately.
- Do not bump or change `LEGACY_MARKER` or the portfolio storage key. No version migration is
  needed, since the strip-on-read handles it.
- Do not edit `REBUILD.md`. The planner has already recorded the reversal.
- No new dependencies.

## Acceptance criteria

1. No non-test frontend source mentions the feature, except the one compatibility strip.
   (a) This command prints exactly one line, `frontend/src/lib/portfolioStore.ts`:
   `grep -rln -E "basisDate|basis_date|isValidBasisDate|return-since|Return since|Return basis" frontend/src | grep -v '\.test\.ts$'`
   (b) Every `basisDate` reference in that file sits inside `normaliseStoredPortfolio`. This
   command prints no line beginning `OUTSIDE:` and at least one line beginning `inside:`:
   `awk '/^function normaliseStoredPortfolio/{f=1} /basisDate/{print (f?"inside:":"OUTSIDE:") NR} f&&/^}/{f=0}' frontend/src/lib/portfolioStore.ts`
2. `grep -ci "since" backend/app/routers/universe.py backend/app/schemas.py frontend/src/api/client.ts frontend/src/pages/analysis/HoldingsPage.tsx frontend/src/pages/PortfoliosPage.tsx`
   reports `0` for every file.
3. `grep -n "def base_close_on_or_after" backend/app/returns.py` still prints one line.
4. `grep -c "HelpSidebar" frontend/src/pages/analysis/HoldingsPage.tsx` prints `2` (the import plus
   the one element, whose tag is self-closing).
5. `grep -n "ticker,weight_pct,shares'" frontend/src/lib/portfolioCsv.ts` prints one line, and
   `grep -c "ticker,weight_pct,shares,basis_date" frontend/src/lib/portfolioCsv.ts` prints `0`.
6. `grep -n "def test_get_returns_ignores_a_stale_since_parameter" backend/tests/test_api_universe.py`
   prints one line. `grep -c "^def test_get_returns.*since" backend/tests/test_api_universe.py`
   prints `1` (only the new test).
7. The five named frontend tests under Interface exist. Each of these prints one line:
   `grep -n "imports a legacy export with a basis_date column and ignores it" frontend/src/lib/portfolioCsv.test.ts`,
   `grep -n "imports a legacy export whose basis_date is malformed" frontend/src/lib/portfolioCsv.test.ts`,
   `grep -n "strips a legacy basisDate on read" frontend/src/lib/portfolioStore.test.ts`,
   `grep -n "loads a portfolio whose legacy basisDate is malformed" frontend/src/lib/portfolioStore.test.ts`,
   `grep -n "does not re-save a legacy basisDate on a sibling" frontend/src/lib/portfolioStore.test.ts`.
   Plus `grep -c "isValidBasisDate" frontend/src/lib/portfolio.test.ts` prints `0`.
8. `cd frontend && npm run build` exits 0.
9. `cd frontend && npm run test` exits 0.
10. `cd frontend && npm run lint` introduces no new warnings in the modified files.
11. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count. It
    should be the previous total minus 7 plus 1.

**If any criterion cannot be satisfied as written, report `BLOCKED` with the reason. Do not
engineer around it.** A clever pass (a split string, a renamed identifier chosen to dodge a grep)
is worse than a stop, because it costs the project the ability to trust its own checks. This
applies to an impossible or contradictory criterion just as much as to an undecided design
question.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.** `app/config.py`
> loads `backend/.env`, which holds a live Render connection string. There are no ad-hoc scripts in
> this contract. If you add one, prefix it.

Run each of these and paste the **complete, verbatim** output into the report, including failures.

```bash
grep -rln -E "basisDate|basis_date|isValidBasisDate|return-since|Return since|Return basis" frontend/src | grep -v '\.test\.ts$'; echo "exit: done"
awk '/^function normaliseStoredPortfolio/{f=1} /basisDate/{print (f?"inside:":"OUTSIDE:") NR} f&&/^}/{f=0}' frontend/src/lib/portfolioStore.ts
grep -ci "since" backend/app/routers/universe.py backend/app/schemas.py frontend/src/api/client.ts frontend/src/pages/analysis/HoldingsPage.tsx frontend/src/pages/PortfoliosPage.tsx
grep -n "def base_close_on_or_after" backend/app/returns.py
grep -c "HelpSidebar" frontend/src/pages/analysis/HoldingsPage.tsx
grep -n "ticker,weight_pct,shares'" frontend/src/lib/portfolioCsv.ts; grep -c "ticker,weight_pct,shares,basis_date" frontend/src/lib/portfolioCsv.ts
grep -n "def test_get_returns_ignores_a_stale_since_parameter" backend/tests/test_api_universe.py; grep -c "^def test_get_returns.*since" backend/tests/test_api_universe.py
grep -n -E "imports a legacy export with a basis_date column and ignores it|imports a legacy export whose basis_date is malformed" frontend/src/lib/portfolioCsv.test.ts
grep -n -E "strips a legacy basisDate on read|loads a portfolio whose legacy basisDate is malformed|does not re-save a legacy basisDate on a sibling" frontend/src/lib/portfolioStore.test.ts
grep -c "isValidBasisDate" frontend/src/lib/portfolio.test.ts
cd frontend && npm run build && npm run test && npm run lint; cd ..
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q; cd ..
```

State in the report which files you edited. Do not use `git diff` to derive this, since several
contracts' worth of uncommitted work sits in the tree.

## Tooltips

This contract adds no interactive element; it removes one (the date input and its Tooltip). No new
copy.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it**, with the backend restarted first (`lsof -nP -iTCP:8000
-sTCP:LISTEN` names any stale process; kill it).

1. `/portfolios`, with an existing portfolio that had a basis date set: it still appears in the
   list. The Cash row shows `Cash [input] %` and nothing after it.
2. `/portfolios/<id>/holdings`: columns end `… 5D | YTD | Signal (…)`, with no `Since …` column. The
   CASH row has the same number of cells as the header (no misaligned trailing cell). The Help
   button is still next to the signal dropdown.
3. Export that portfolio's CSV and open it. The header is `ticker,weight_pct,shares`.
4. Import an **old** export that still has the `basis_date` column. It imports with no error.

## Open questions

None. The design decision (remove, don't replace) is Gunnar's and is made. If something here
contradicts the code as you find it, report `BLOCKED`. Do not guess.
