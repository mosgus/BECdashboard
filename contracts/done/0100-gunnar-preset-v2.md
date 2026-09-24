# Contract 0100 — Update the Gunnar Preset allocation

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

The `Gunnar Preset` entry in `PRESETS` carries the allocation from Gunnar's 2026-09-24 export, with
no share counts.

## Why

Gunnar supplied a new allocation. `REBUILD.md` rules that **a preset never carries share counts**:
a preset is an allocation, and presets ship in the public bundle of an app with no auth. So the
weights are copied exactly as written and the `shares` column stays present but empty. Gunnar's own
share counts reach his portfolio by importing his CSV file, which contract 0099 makes work.

Coding agents never author an allocation. Every value below is Gunnar's, copied from his file.
Transcribe it exactly. Do not round, reorder or add anything.

## Files

Modify:
- `frontend/src/lib/presets.ts`: replace the `csv` array of the entry whose `id` is
  `'test-concentrated'`, and nothing else. `id`, `name` and `description` stay unchanged, and the
  `BEC Portfolio` entry is untouched.
- `frontend/src/lib/presets.test.ts`: in the test
  `drops only off-universe holdings through the normal parser path`, replace the expected `dropped`
  array only.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`reference files/` is read-only.** Do not edit, copy or move anything in it. The values you need
are all written out below, so you do not need to open the file at all.

## Interface

The new `csv` array for the `'test-concentrated'` entry, exactly:

```ts
    csv: [
      'ticker,weight_pct,shares',
      'MU,74.1847583834589,',
      'VOO,10.104829494715357,',
      'PBR,6.8215124159481295,',
      'ORCL,4.426503750208732,',
      'SHNY,4.163845785064591,',
      'XIACF,0.2985501706042959,',
      'CASH,0,',
      '',
    ].join('\n'),
```

The new expected value in the `drops only off-universe holdings` test, exactly. The test's universe
is still `new Set(['MU', 'VOO'])`, and the order follows the new CSV's row order:

```ts
    expect(result.dropped).toEqual([
      { ticker: 'PBR', weightPct: 6.8215124159481295 },
      { ticker: 'ORCL', weightPct: 4.426503750208732 },
      { ticker: 'SHNY', weightPct: 4.163845785064591 },
      { ticker: 'XIACF', weightPct: 0.2985501706042959 },
    ])
```

## Out of scope

- Do not add share counts to any preset. The test `contains no share counts` must keep passing
  unchanged.
- Do not change `expect(PRESETS).toHaveLength(2)`, the `BEC Portfolio` preset, or any other test.
- Do not touch `NewPortfolioDialog.tsx`, `portfolio.ts` or `portfolioCsv.ts`. Contract 0099 is
  editing those in parallel.

## Acceptance criteria

1. `cd frontend && npm run test` exits 0.
2. `grep -c "'MU,74.1847583834589,'" frontend/src/lib/presets.ts` prints `1`.
3. `grep -c "'MU,73.40490607218531,'" frontend/src/lib/presets.ts` prints `0`. The old allocation is
   gone.
4. `grep -c "{ ticker: 'PBR', weightPct: 6.8215124159481295 }" frontend/src/lib/presets.test.ts`
   prints `1`.
5. `grep -c "3.1979752499318987" frontend/src/lib/presets.test.ts` prints `0`.
6. State in your report which files you edited. Do not use `git diff` to prove this: another
   contract is running in the same working tree.

If any criterion cannot be met without editing another file or another test, report `BLOCKED`.

## Verification to run and paste

Paste the complete, verbatim output.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend && npm run test
grep -c "'MU,74.1847583834589,'" /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/lib/presets.ts
grep -c "'MU,73.40490607218531,'" /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/lib/presets.ts
grep -c "{ ticker: 'PBR', weightPct: 6.8215124159481295 }" /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/lib/presets.test.ts
grep -c "3.1979752499318987" /Users/gunnarbalch/WebstormProjects/blue-eagle/frontend/src/lib/presets.test.ts
```

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.** On `/portfolios`, open New Portfolio and choose the
`Gunnar Preset` preset. The draft should show MU 74.18…, VOO 10.10…, PBR 6.82…, ORCL 4.43…,
SHNY 4.16… and XIACF 0.30…, with 0% cash.
