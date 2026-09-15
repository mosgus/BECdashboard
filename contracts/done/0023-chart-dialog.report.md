# Report — Contract 0023 — Price chart dialog

**Status:** reported

## Summary

Clicking a Universe row opens `ChartDialog`: a `recharts` line chart of `close`, defaulting to
YTD, with 10Y/5Y/1Y/YTD/6M/3M/1M/5D range buttons. Full history is fetched once per open and
sliced client-side — switching ranges makes no network call, verified live via the Network
domain, not inferred.

Files exactly as listed:
- `frontend/src/components/ChartDialog.tsx` (new)
- `frontend/src/lib/ranges.ts` (new, pure)
- `frontend/package.json` — `recharts` added, the only new dependency
- `frontend/src/api/client.ts` — `PriceBar`, `HistoryResponse`, `getHistory`
- `frontend/src/components/UniverseTable.tsx` — clickable rows, `stopPropagation` on download
- `frontend/src/pages/UniversePage.tsx` — `selectedTicker` state, renders `ChartDialog`

No other files touched this session (see the note on pre-existing dirty files below).

## Bundle size — recorded per the contract's requirement

```
Before: dist/assets/index-*.js   287.71 kB │ gzip:  90.12 kB
After:  dist/assets/index-*.js   639.96 kB │ gzip: 192.83 kB
```
`recharts` adds **~352 kB raw / ~103 kB gzipped**. Vite's own build output flags this chunk as
over its 500 kB warning threshold. Whether that's worth it is explicitly left as an open question
in the contract — flagging the exact number since it's now on record, not making the call myself.

## Design decisions

- **`AreaChart` + one `<Area>`, not separate `Line`+`Area`.** The contract asks for "colour the
  line `var(--color-primary)`; optional faint area fill beneath at low opacity" — a single
  `<Area>` with both `stroke` and low-opacity `fill` gives the line and the fill in one primitive,
  rather than layering a `<Line>` on top of a separate `<Area>`. Fewer moving parts, same visual
  result.
- **Y-axis domain computed manually** (`[min - pad, max + pad]` with `pad = (max-min)*0.08 || 1`,
  matching the mockup's own math) rather than relying on recharts' `domain={['auto','auto']}`.
  Explicit numbers guarantee no forced zero baseline and match the mockup's padding behavior
  exactly, rather than trusting an auto-scaling heuristic I can't fully audit.
- **X-axis sparsity via `interval={Math.max(0, Math.ceil(n/5) - 1)}`**, approximating "~5 labels"
  across any range length — recharts' `interval` prop skips N ticks between shown ones, so this
  scales with however many points are in the current range instead of a fixed skip count.
- **Custom tooltip content (`ChartTooltipContent`), not `contentStyle`.** Needed brand tokens
  (`bg-brand-surface`, `border-brand-border`) rather than raw recharts default styling, and needed
  to format the value through the existing `formatPrice` (2-decimal, matches every other price in
  the app). This is recharts' own `Tooltip`, explicitly not the project's `Tooltip` component, per
  the contract's own carve-out for the in-chart hover readout.
- **`pointer-events-none` on disabled range buttons**, same pattern as contract 0022's
  `AddTickerForm`/`Update all` — a disabled range button still needs its tooltip to explain *why*
  it's disabled (no data in that range), which native `title`-on-disabled can't do and is exactly
  what `Tooltip` exists to fix.
- **Ticker-cell tooltip is hover-only in practice**, not focus-triggered. The actual keyboard-
  focusable/openable element is the `<tr>` (`tabIndex={0}`, `role="button"`, `Enter` opens it) per
  the contract's own spec; `Tooltip` wraps a plain `<span>` around the ticker text inside the cell,
  which is never itself the focused element, so its `onFocus` won't fire from Tab-ing to the row.
  The contract only asked for the tooltip "on the ticker cell," not for it to also fire on
  row-focus — flagging this rather than silently deciding it doesn't matter, since it's a real gap
  between "hover explains it" and "keyboard-focus explains it" for this one tooltip specifically
  (every other tooltip in this contract and 0022 is on the actual focusable element itself).

## Verification

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 184ms

$ git diff frontend/package.json
+    "recharts": "^3.10.1",
```
Only entry added.

```
$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/ChartDialog.tsx frontend/src/lib/ranges.ts
(no matches, exit 1)

$ grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/components/ChartDialog.tsx frontend/src/lib/ranges.ts frontend/src/api/client.ts
(no matches, exit 1)

$ grep -n "stopPropagation" frontend/src/components/UniverseTable.tsx
101:                    onClick={(event) => event.stopPropagation()}

$ grep -rn "bar count\|Download CSV\|bars ·" frontend/src/components/ChartDialog.tsx
(no matches, exit 1)

$ grep -n "adj_close" frontend/src/components/ChartDialog.tsx
(no matches at all — adj_close isn't referenced in this file, so there's nothing that could be
the plotted series; criterion 8 is satisfied vacuously)
```

### Criterion 9 — `rangeStart` against the fixed anchor, exercised in `/tmp`

Script written to `/tmp/ranges-check.mjs`, run, and deleted (confirmed gone via `ls` after
deletion — not left in the repo):

```
10Y -> 2016-09-14
5Y  -> 2021-09-14
1Y  -> 2025-09-14
YTD -> 2026-01-01
6M  -> 2026-03-14
3M  -> 2026-06-14
1M  -> 2026-08-14
5D  -> 2026-09-07
```
All four contract-specified values match exactly: `YTD → 2026-01-01`, `1Y → 2025-09-14`,
`5D → 2026-09-07`, `10Y → 2016-09-14`.

### Criteria 10 and 11 — verified live over CDP, not inferred

Same constraint as every prior UI contract this session: I still cannot run the real backend, so I
drove a temporary swap of `frontend/src/main.tsx` (restored to its exact original content
afterward — confirmed via `git diff --stat` showing empty and its absence from `git status`) that
rendered the real `UniverseTable` + `ChartDialog` with a mocked `window.fetch` intercepting only
`/history` JSON requests (a full 2016–2026 synthetic series), leaving the real `request()` helper
in `api/client.ts` completely untouched and exercised as-is.

**Row click opens the dialog on YTD, one history fetch:**
```json
{ "dialogOpened": true, "activeRange": "YTD" }
```
`window.__historyFetchCount` (a counter my mock `fetch` incremented) was **1** immediately after
open.

**Criterion 11 — switching through all seven other ranges made zero additional fetches:**
```
clicked: ["10Y","5Y","1Y","6M","3M","1M","5D"]
history fetch count after clicking through all ranges: 1
```
Still 1. Client-side slicing confirmed, not assumed.

**Criterion 10 — the download icon does not open the dialog:**
```json
{ "dialogOpenedAfterDownloadClick": false, "href": "http://localhost:8000/universe/AAPL/history.csv" }
```
Chrome's `Network.requestWillBeSent` also recorded a real outgoing request to that `.csv` URL —
confirming `stopPropagation()` blocked the React row handler while the anchor's own native
click/navigation still fired normally (`stopPropagation` doesn't call `preventDefault`, which is
exactly the intended split: stop the bubble to the row, don't stop the download).

**Close behavior, matching `FilterDialog`'s convention (also checked live):**
```
click inside dialog (must stay open): {"stillOpen":true}
after Escape:                          {"open":false}
after backdrop click:                  {"open":false}
```

## A note on pre-existing dirty files

`git status` shows `backend/`, `AddTickerForm.tsx`, and `FilterDialog.tsx` as modified. None of
these are from this session — they're uncommitted work from contracts 0021 (backend `/history`
JSON endpoint) and 0022 (tooltips), already in the working tree before I started. I did not open
or edit any of them while executing contract 0023; `git status` immediately before and after this
session confirms the only files I touched are the six listed above.

## Human verification — not done by me

Per the contract's own list, things that need an actual look rather than a DOM query: whether the
~400ms tooltip delay and the hover-readout following the cursor *feel* right, whether the header's
change figure visually reads clearly next to the price, and the 375px layout check. I confirmed the
underlying mechanisms (fetch-once, range-switch-is-local, stopPropagation, close conventions) are
correct; I did not evaluate the visual/interaction feel against the mockup side-by-side in a real
window.
