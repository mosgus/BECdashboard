# Report — Contract 0055

## Audit

**Initial verdict:** rejected

The backend half is implemented and tested, but the frontend does not typecheck or build. The
agent's claim that the contract was complete is therefore wrong.

## What was claimed

The report claimed that `prior_close` was present in both backend read paths and the schema, that
`priceChange` had the intended live/non-live branches, and that `UniverseTable` passed the third
argument and muted non-live figures.

## What I found

- `list_all()` ranks non-null closes in one window query and returns rank 2 as `prior_close`.
  `get_one()` uses the second-to-last non-null DataFrame close. The two contract-specific backend
  tests are present and passed.
- `UniverseTable` passes `row.prior_close`; the non-live label and muted class match the contract.
- `priceChange` declares `priorClose?: number | null`, but the `priorClose !== null` guard does not
  exclude `undefined`. `npx tsc -p tsconfig.app.json --noEmit` fails on both uses in the fallback
  formula with TS18048 (`priorClose` is possibly `undefined`). `npm run build` fails for the same
  reason.
- Acceptance criterion 7 also fails: `grep -n "0.00%" frontend/src/lib/change.ts` finds a docstring
  example. The fabricated return was removed, but the criterion is explicit and the report did not
  disclose the mismatch.
- `backend/app/schemas.py` presently repeats `current_price`, `last_close`, and `quote_fetched_at`
  after `prior_close`. Pydantic's effective field shape is not broken, but this is source drift to
  resolve in the separate 0054 audit because 0055 did not introduce those repeated fields.

## Verification re-run independently

```text
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q
449 passed, 2 warnings in 3.64s

git show HEAD:backend/app/universe.py | grep -c 'select('  -> 5
grep -c 'select(' backend/app/universe.py                   -> 5

cd frontend && npx tsc -p tsconfig.app.json --noEmit
src/lib/change.ts(36,35): error TS18048: 'priorClose' is possibly 'undefined'.
src/lib/change.ts(36,49): error TS18048: 'priorClose' is possibly 'undefined'.

cd frontend && npm run build
Fails with the same two TS18048 errors.

cd frontend && npm run lint
One warning: react(set-state-in-effect) in src/pages/UniversePage.tsx.

grep -n '0.00%' frontend/src/lib/change.ts
19: * green "+0.00%", contradicting the number. `percent` is unrounded; only direction/label round.

grep -rn 'dark:' frontend/src/                             -> exit 1
grep -rnE '#[0-9a-fA-F]{3,8}\\b|rgb\\(|rgba\\(' frontend/src/lib/change.ts -> exit 1
git diff --stat -- frontend/src/components/TickerStrip.tsx -> empty
git status --porcelain -- backend/migrations/              -> empty
git diff --check                                           -> clean
```

## Required correction

Contract 0056 owns the mechanical frontend fix. Do not accept or archive 0055 until 0056 is
reported and audited successfully.

## Follow-up audit — Contract 0056

**Final verdict:** accepted

0056 changed only `frontend/src/lib/change.ts`: it explicitly excludes `undefined` before using
`priorClose`, and removes the prohibited literal from its comment. I independently re-ran the
frontend typecheck, production build, lint, relevant greps, `git diff --check`, and the full
backend suite: all passed (449 tests in 3.43s; lint retains only the known single warning).

The original esbuild harness cannot run because no `esbuild` executable is installed in this
checkout. Instead, I transpiled the exact on-disk TypeScript source in memory using the installed
TypeScript compiler and executed its exported function. All seven contract cases matched: live
`-0.56%`, completed-session `+2.12%`, blank incomplete cases, no division by zero, and genuine
live `0.00%`.
