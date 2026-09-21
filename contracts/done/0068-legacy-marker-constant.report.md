# Report — Contract 0068 (Legacy marker as a named constant)

**Verdict: accepted.** Both halves done, and the first attempt's `BLOCKED` was correct.

## Verified independently

```
49:const LEGACY_MARKER = '# Blue Eagle Portfolio v1'
150:  const canonical = sourceLines[0] === LEGACY_MARKER
```

One literal, written whole, greppable. `legacyMarker()` gone. The obfuscation grep (concatenation,
template, array-join) finds nothing. 33 tests, `TSC OK`, clean build and lint, `npm ci` fine.

`grep -rn "node:fs\|readFileSync\|reference files\|ts-expect-error" src/` → **nothing**. No test
touches the filesystem, names a directory outside `src/`, or suppresses a type error. The legacy test
passes from the inline `LEGACY_CSV` fixture.

## The first run's BLOCKED was right, and the cause was mine

The original legacy test read `reference files/portfolios/gunnport-2026-09-21.csv`. Gunnar renamed his
portfolio to `Gunnar's Port` and re-exported, replacing that file — so the test failed `ENOENT`. The
coder stopped rather than recreating or editing anything under `reference files/`, which is exactly
right: that directory is read-only by policy and the deny list cannot see a shell redirect.

**Contract 0067 should never have put a fixture there.** `reference files/` holds live artefacts the
user renames at will, and a test pinned to a filename in it is a test the user can break by using the
app as intended. The legacy format is frozen — it will never gain another row — so it belongs inline.

Lesson, now in `REBUILD.md`: **a test fixture must live under `frontend/src/`, inline or in
`__fixtures__/`. Never point a test at a path a user owns.**

## Incidental: the new format confirmed in production use

Gunnar's re-export is the first real-world output of contract 0067:

```
ticker,weight_pct,shares
MU,73.40490607218531,10
...
CASH,0,
```

Plain CSV, no preamble, and the filename `Gunnar's Port-2026-09-21.csv` preserved capitals, a space
**and an apostrophe** — so it round-trips exactly. The case-preserving filename change works.

## Open, low priority: relative weights drifted

Comparing his pre- and post-edit exports, the three original positions did not scale by a common
factor:

```
MU    0.943462596
ORCL  0.939867485
VOO   0.942400349     spread 0.003595
```

Under pure pro-rata dilution these must be identical. Gunnar confirmed he was actively editing and
re-exporting, which explains it — a hand-edited weight or a remove-and-re-add both legitimately break
the ratio. Not pursued. **If it recurs on a portfolio touched only through the Add form, that is a
real bug**: it would mean weights are being recomputed from live quotes, which the position model
forbids. A unit test asserting `addPositionDiluting` preserves relative proportions would settle it
permanently and does not exist yet.

## Status

Accepted and archived, together with contract 0067 — 0067's functional work was complete all along
and only its marker criterion was at fault.
