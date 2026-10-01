# Contract 0138 — Make `strict` explicit in the frontend tsconfigs

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

Both frontend tsconfigs set `"strict": true` explicitly, so the project typechecks identically under
TypeScript 5.x and 6.x.

## Why

Neither `frontend/tsconfig.app.json` nor `frontend/tsconfig.node.json` sets `strict`. The project's
TypeScript (6.0.3) defaults `strict` to on, so `tsc` passes. TypeScript 5.x defaults it to **off**.
WebStorm was pointed at the reference worktree's TypeScript 5.9.3, and there the same source
produces 30 `TS2339` errors (`Property 'reason' does not exist on type 'ApplyPlan'`, and others like
it). Narrowing a discriminated union on `!result.ok` needs `strictNullChecks`.

Verified by the planner on 2026-10-01: TS 5.9.3 with `--strict` reports 0 errors on both configs, and
without it reports 30 on `tsconfig.app.json`. The strictness of the typecheck should be written in
the config, not inherited from whichever compiler version happens to read it.

## Files

Modify:
- `frontend/tsconfig.app.json` — add `"strict": true,` as the first line under the `/* Linting */`
  comment.
- `frontend/tsconfig.node.json` — the same.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it. In particular, if any typecheck below fails after the edit,
do **not** change source files to make it pass. Report `BLOCKED` with the output.

**`reference files/` is read-only and never belongs on a file list.** The reference *worktree* at
`/Users/gunnarbalch/WebstormProjects/blue-eagle-reference` is also read-only. You run its `tsc`
binary below, and you modify nothing in it.

## Interface

In each file, the `/* Linting */` block becomes exactly:

```jsonc
    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
```

No other option is added, removed or reordered.

## Out of scope

- Do not add any other compiler option (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  etc.). Each of those is a separate decision with its own fallout.
- Do not change the `typescript` version in `package.json`.
- Do not edit `.idea/` or any IDE setting. Gunnar changes the WebStorm TypeScript path himself.
- Do not edit any `.ts` / `.tsx` file.

## Acceptance criteria

1. `grep -c '"strict": true' frontend/tsconfig.app.json` prints `1`.
2. `grep -c '"strict": true' frontend/tsconfig.node.json` prints `1`.
3. The project typecheck (TS 6) exits 0 for both configs.
4. The reference worktree's TS 5.9 typecheck, run **without** a `--strict` flag, exits 0 for both
   configs. This is the criterion that proves the fix: before this change, the app config produces
   30 errors under this command.
5. `npm run test` and `npm run build` exit 0.
6. The coder states which files it edited. It must be exactly the two above.

`BLOCKED` is the correct answer if any criterion cannot be met without editing a file outside the
list, including the case where the reference worktree's `tsc` binary does not exist at the path
below. Do not substitute a different TypeScript.

## Verification to run and paste

Run from the repository root and paste the complete, verbatim output:

```bash
grep -n '"strict": true' frontend/tsconfig.app.json frontend/tsconfig.node.json
grep -c '"strict": true' frontend/tsconfig.app.json
grep -c '"strict": true' frontend/tsconfig.node.json
(cd frontend && npx tsc -p tsconfig.app.json --noEmit; echo "ts6 app exit=$?")
(cd frontend && npx tsc -p tsconfig.node.json --noEmit; echo "ts6 node exit=$?")
(cd frontend && /Users/gunnarbalch/WebstormProjects/blue-eagle-reference/frontend/node_modules/.bin/tsc -v)
(cd frontend && /Users/gunnarbalch/WebstormProjects/blue-eagle-reference/frontend/node_modules/.bin/tsc -p tsconfig.app.json --noEmit; echo "ts5 app exit=$?")
(cd frontend && /Users/gunnarbalch/WebstormProjects/blue-eagle-reference/frontend/node_modules/.bin/tsc -p tsconfig.node.json --noEmit; echo "ts5 node exit=$?")
(cd frontend && npm run test 2>&1 | tail -5)
(cd frontend && npm run build 2>&1 | tail -3)
```

## Tooltips — required for any contract adding interactive elements

This contract adds no interactive elements.

## Human verification — does Gunnar need to run anything?

Yes, in WebStorm: **Settings → Languages & Frameworks → TypeScript → TypeScript:** change it from
`…/blue-eagle-reference/frontend/node_modules/typescript` to
`…/blue-eagle/frontend/node_modules/typescript`, then restart the TypeScript service. The 30 errors
should be gone. With this contract applied, they also disappear under the old 5.9 path. The path
change is still right, because the IDE should use the compiler the build uses.

## Open questions

None.
