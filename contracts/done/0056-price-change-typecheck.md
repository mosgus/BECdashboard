# Contract 0056 — Make the honest change path compile

**Status:** accepted
**Assigned to:** haiku
**Author:** planner

## Goal

Complete the rejected contract 0055 by making `priceChange` type-safe under its existing optional
third parameter, without changing its runtime behavior. The frontend must typecheck and build.

## Why

0055's non-live branch is conceptually correct but cannot ship: TypeScript still permits
`priorClose` to be `undefined` after a `priorClose !== null` check. The exact source must make the
existing null-or-undefined contract explicit. The prior report also claimed criterion 7 passed while
the literal `0.00%` remains in a comment, so its required grep did not pass.

## Files

Modify only:

- `frontend/src/lib/change.ts`

Touch nothing else. No dependency, test, API, backend, CSS, or `TickerStrip.tsx` change. Do not
modify `contracts/0055-*`; the planner owns the audit record and status.

## Interface

Keep this signature exactly:

```ts
export function priceChange(
  current: number | null,
  lastClose: number | null,
  priorClose?: number | null,
): PriceChange
```

Keep every existing `PriceChange` field and all 0055 behavior:

- non-null `current` with non-zero `lastClose`: live intraday result;
- null `current`, non-null/non-zero `lastClose`, and defined/non-null/non-zero `priorClose`:
  completed-session result with `live: false`;
- all other input: `{ percent: null, direction: 'flat', label: '', live: false }`.

Make the fallback guard narrow `priorClose` to `number` before arithmetic. A direct, acceptable
shape is `priorClose !== undefined && priorClose !== null && priorClose !== 0`; equivalent
type-safe logic is allowed. Do not change the parameter from optional to required: `TickerStrip`
intentionally omits it.

Remove the literal string `0.00%` from `change.ts`, including comments. This is only to satisfy
0055's exact acceptance check; do not alter the genuine live-flat runtime label, which must still
be produced by `rounded.toFixed(2)`.

## Out of scope

- No redesign of price changes, market-hours behavior, quote fetching, or tooltips.
- No deduplication of fields in `schemas.py`; that belongs to the pending 0054 audit.
- No test edits. The existing backend tests already prove the data path.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0.
2. `cd frontend && npm run build` exits 0.
3. `cd frontend && npm run lint` reports exactly one warning, `set-state-in-effect`.
4. `grep -n "0.00%" frontend/src/lib/change.ts` exits 1.
5. `git diff --stat -- frontend/src/components/TickerStrip.tsx` is empty.
6. The backend suite remains green: `PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q`.

## Verification to run and paste

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -n "0.00%" frontend/src/lib/change.ts ; echo "(exit $? — 1 = correct)"
git diff --stat -- frontend/src/components/TickerStrip.tsx ; echo "(empty = untouched)"
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q 2>&1 | tail -10
git status --porcelain
```

## Agent prompt

You are the Haiku executor. Read `agent_prompts/executor-haiku.md`, then this contract in full.
Implement only this contract. Do not commit, push, stage, or edit files outside its explicit file
list. Report the complete verbatim verification output in chat, including failures or deviations.
