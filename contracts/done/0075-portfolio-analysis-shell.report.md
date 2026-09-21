# Report — Contract 0075 (Portfolio analysis shell)

**Verdict: accepted.** `PARTIAL` was correct: the frontend suite fails in `presets.test.ts`, a file
this contract was explicitly forbidden to touch, for reasons that predate it.

## Verified independently

`TSC OK`, clean build, lint unchanged, **backend 460 passed**. Main chunk gzip `103.70 → 104.26 kB`,
+0.56 kB for six components — in the range the contract predicted, so nothing unexpected was pulled in.

The structural criteria all hold:

- `grep` over `pages/analysis/` matches `listPortfolios` **only** in `AnalysisLayout.tsx`, at exactly
  the two expected lines. The five pages have no hooks and no data access.
- `ANALYSIS_TABS` is declared once and mapped, not five hand-written links.
- `grep "rebalance\|targets"` is empty — the two reference tabs Gunnar did not ask for are absent.
- The Universe guard survives at `AddPositionForm.tsx:57`.

The tooltip judgement was right and correctly explained: the `Analysis` link carries one, the five tab
links do not, because a tooltip repeating a visible label is noise. Stating it in the report is what
stops the audit reading it as an omission.

## The blocker is pre-existing and is my error

Three `presets.test.ts` failures. I probed both presets through the real parser: **both parse cleanly,
both have empty share columns, cash resolves to `0` and `38.02`.** The data is fine.

The test is not. `presets.test.ts:7`:

```ts
const presetTickers = new Set(['MU', 'ORCL', 'VOO', 'PBR', 'SHNY', 'XIACF'])
```

That is the *first* preset's ticker set, and the loop applies it to **every** preset. Gunnar added a
second one — `BEC Portfolio`, tickers `VEA, SETM, XLK, CEG, GLD, XLP, XLV, MS` — and every one of them
is off-universe against that hardcoded set, so all eight drop and `parsePortfolioCsv` correctly
returns *"No portfolio tickers are in the current universe."* The shares assertion fails for the same
reason: it never reaches a seed.

**Contract 0070's criterion 2 said "against `<all its tickers>`", meaning each preset's own.** The
implementation used one shared constant. That passed while exactly one preset existed and broke the
moment a second arrived — so I accepted a test that could not survive the event its *sibling* test
(`toHaveLength(1)`) exists to detect. The tripwire fired; the tests around it were not built to move
with it.

The `toHaveLength(1)` failure itself is the design working: Gunnar authored a preset, so the count
changes with him. It needs updating to 2, not removing.

Repaired by contract **0076**.

## Note for whoever audits 0076

`BEC Portfolio`'s eight tickers are unlikely to all be in the live Universe. Selecting it will drop
the missing ones and route their weight to cash, with the skipped-ticker line explaining it. That is
the CSV path behaving correctly, not a preset defect — do not "fix" it by filtering presets against
the Universe, which contract 0070 explicitly ruled out.

## Status

Accepted and archived.
