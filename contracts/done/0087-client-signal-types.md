# Contract 0087 — The typed client declares `value` and `atr`; delete the local shim

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`SignalOut` and `TickerSignals` in `client.ts` match what the API actually returns, and
`TickerPage.tsx` uses them directly.

## Why

Contract 0085 added `value` to each signal and `atr` to each ticker's payload. It was **backend-only
by design**, and contract 0086 did not list `client.ts` in its files — so the typed client still
declares the pre-0085 shape:

```ts
// client.ts:101
export interface SignalOut {
  signal: string
  label: string
  state: string | null
  last_trigger_date: string | null      // no `value`
}

export interface TickerSignals {
  ticker: string
  signals: SignalOut[]
  atr_pct: number | null                // no `atr`
}
```

`TickerPage.tsx` works around it with a local intersection:

```ts
type SignalWithValue = SignalOut & { value: number | null }
type TickerSignalsWithAtr = Omit<TickerSignals, 'signals' | 'atr'> & { ... }
```

The coder was right not to touch a file outside its boundary. **The file lists were the error, mine.**

**The canonical type now lies about the API**, and the shim is the seed of the pattern contracts 0071
and 0072 spent two rounds removing for cash: one concept, two definitions, drifting apart. The
`Omit<TickerSignals, 'atr'>` is itself a tell — it omits a key that does not exist on the type, which
is a silent no-op.

Slice 2 of the ticker page, and Risk & Perf after it, will both consume this response. Each would
either repeat the shim or hit the same wall.

## Files

Modify:
- `frontend/src/api/client.ts` — add the two fields.
- `frontend/src/pages/TickerPage.tsx` — delete the local types, use the client's.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**No backend file.** The API already returns both fields; this aligns the client to it.

Do not change `HoldingsPage.tsx`, `SignalBadge.tsx`, or `TickerChart.tsx`.

**Gunnar hand-styles `TickerPage.tsx`.** This is a type change — do not touch markup, spacing or
class names while you are in there.

**`reference files/` is read-only and never belongs on a file list.**

## Interface

```ts
export interface SignalOut {
  signal: string
  label: string
  state: string | null
  last_trigger_date: string | null
  /** The indicator's current scalar reading where one exists: the RSI for `rsi_threshold`,
   *  the histogram for `macd_cross`, null for `sma_cross` — a crossover is a relationship
   *  between two lines, not a single number. Null whenever `state` is null. */
  value: number | null
}

export interface TickerSignals {
  ticker: string
  signals: SignalOut[]
  /** ATR(14) in the ticker's price units. Null together with `atr_pct`. */
  atr: number | null
  atr_pct: number | null
}
```

Both fields are **required, not optional** — the API always returns them, and `| null` already carries
"no value". Marking them `?` would push the same uncertainty back into every consumer.

In `TickerPage.tsx`, delete `SignalWithValue` and `TickerSignalsWithAtr` and use `SignalOut` and
`TickerSignals` directly. **Nothing else about the page changes** — the runtime behaviour is identical
because the data was always there; only the declaration was wrong.

## Out of scope

- No backend change. The API is correct.
- Do not add `trigger_values` — 0085 deliberately deferred it.
- Do not touch the Holdings column, which reads `atr_pct` and is unaffected.
- Do not reformat `TickerPage.tsx` beyond removing the two type aliases and their usages.
- Do not add tests. The 63 `src/lib/` tests must stay untouched and passing.
- No new dependency.

## Acceptance criteria

1. `grep -n "SignalWithValue\|TickerSignalsWithAtr" frontend/src/` prints nothing — both shims gone.
2. `grep -n "value" frontend/src/api/client.ts` shows `value: number | null` inside `SignalOut`, and
   `grep -n "atr" frontend/src/api/client.ts` shows both `atr` and `atr_pct` on `TickerSignals`.
   Quote both.
3. `grep -n "Omit<" frontend/src/pages/TickerPage.tsx` prints nothing.
4. Neither new field is optional — `grep -n "value?:\|atr?:" frontend/src/api/client.ts` prints
   nothing.
5. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project — see `REBUILD.md`.) **This is the real check**: if the API shape and the declared
   shape disagree anywhere, the page stops compiling.
6. `cd frontend && npm run build` exits 0. Report the main chunk's gzip size; it was **108.18 kB** and
   a type-only change should move it by roughly nothing.
7. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
   `UniversePage.tsx:60`.
8. `cd frontend && npm run test` exits 0 with **63** tests — unchanged.
9. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0 with **493** — no backend
   file is in scope.
10. `git status --porcelain frontend/` lists only `client.ts` and `TickerPage.tsx` as changed **by
    you**. Other files are dirty from earlier contracts; state which ones you touched.
11. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
grep -rn "SignalWithValue\|TickerSignalsWithAtr" frontend/src/ ; echo "shims-gone exit: $?"
grep -n "value\|atr" frontend/src/api/client.ts | sed -n '1,20p'
grep -n "Omit<" frontend/src/pages/TickerPage.tsx ; echo "omit-gone exit: $?"
grep -n "value?:\|atr?:" frontend/src/api/client.ts ; echo "not-optional exit: $?"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

## Tooltips

Not applicable — a type change with no interactive element.

## Human verification — does Gunnar need to run anything?

**Nothing new to run.** Runtime behaviour is identical: the data was always in the response and only
the declaration was wrong. A passing `tsc` is the whole verification.

The `/ticker` page checks from contract 0086 are still outstanding and unaffected by this — in
particular whether the layout is right, which nothing here can judge.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
