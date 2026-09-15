# Report — Contract 0017 — Per-ticker CSV download

**Status:** reported

## Summary

Each Universe row now has a download-icon link that hits
`GET /universe/{ticker}/history.csv`, which reads only what's already stored (`cache.get_cached`)
and renders it via a new pure `history_to_csv` — never touches yfinance. Files exactly as listed:

Created:
- `backend/app/export.py`
- `backend/tests/test_export.py`
- `frontend/src/components/DownloadIcon.tsx`

Modified:
- `backend/app/routers/universe.py` — one new route
- `backend/tests/test_api_universe.py` — 7 new endpoint tests
- `frontend/src/components/UniverseTable.tsx` — new column, re-tuned widths

No other files touched. `git status` confirms this — see the note below about *other* dirty files
in the tree that are not mine.

## Two acceptance criteria that can't literally pass, and why

**Criterion 5** (`grep -rn "lucide-react" frontend/src/` must match nothing) **cannot pass in this
repo regardless of what I do.** `frontend/src/components/SettingsIcon.tsx` — pre-existing, not on
this contract's file list, not touched — already contains the line `// lucide-react v0.575.0
"settings" icon, verbatim path from node_modules/lucide-react/dist/esm/icons/settings.js (ISC
licensed).` I grepped before making any change to confirm this predates me. The contract's own
Interface section says to write `DownloadIcon.tsx` "exactly as `SettingsIcon.tsx` does it" and to
"keep an attribution comment naming lucide and the ISC licence" — which I did, matching the
existing convention verbatim (same wording pattern, same node_modules path style). Doing so adds a
second, identical-in-kind "lucide-react" match. I could have phrased my new comment to dodge the
literal grep (e.g. writing "lucide" without "-react"), but that would (a) leave `SettingsIcon.tsx`
itself still failing the same grep, so the criterion still wouldn't pass, and (b) make the new
file's attribution inconsistent with the one it was told to copy, for zero actual benefit. I kept
the attribution comment and did not chase the grep.

**Criterion 6** (`grep -n "download" frontend/src/components/UniverseTable.tsx` should show "only
the URL path, title and aria-label", implying visible output) **produced no output at all** — not
because anything is missing, but because I capitalized "Download" everywhere (`DownloadIcon`,
`Download {ticker} history as CSV` in both `title` and `aria-label`), and the grep pattern
`"download"` is lowercase and case-sensitive. Zero matches is a strictly stronger confirmation that
no `download` HTML attribute exists than the criterion's phrasing anticipated — I'm noting the
mismatch between what was expected to print and what actually printed so it isn't mistaken for the
check having been skipped.

## A note on `frontend/src/pages/UniversePage.tsx`, `REBUILD.md`, and `mockup-universe-filters.html`

Criterion 9's diff check includes `frontend/src/pages/` and came back non-empty:

```
frontend/src/pages/UniversePage.tsx | 57 ++++++++++++++++++-------------------
```

**I did not touch this file in this session** — I never opened, read, or edited it while executing
contract 0017; the only frontend files I touched are `DownloadIcon.tsx` (new) and
`UniverseTable.tsx`. `git log` shows a commit (`72c5afa`) landed between the previous contract and
this one that includes prior filter/prepend work; the working tree also currently shows
`REBUILD.md` modified and `mockup-universe-filters.html` deleted, neither of which I touched
either. This is pre-existing local state from before I started this contract, not a side effect of
this contract's work — flagging it so the non-empty diff on that one path isn't attributed to me.

## Design decisions

- **Membership check reuses `universe.get_one()`** rather than querying `UniverseTicker` directly
  from the router. `get_one` raises the existing `NotInUniverse` (same exception the other routes
  already catch), and its own fundamentals lookup is a cache/DB read, never a network call — so
  this keeps the router from importing `app.models`/`app.db` directly, without violating "no
  fetching from yfinance in this path, ever." Verified explicitly by test 13
  (`_download_history` monkeypatched to raise; request still succeeds).
- **Column widths**: rather than hand-deriving new percentages, I restored the exact widths the
  table had *before* contract 0014 removed the per-row Refresh column (recovered via
  `git show 79849af^:...`), and gave the new Download column the old Refresh column's exact width
  classes (`w-[25%] sm:w-[8%]`, always visible, no `hidden` class). That's a layout that was live
  and presumably already visually checked, rather than a new guess — lower risk than inventing
  fresh fractions. Contract 0014's actual redistribution had spread the freed space across several
  columns (Name got the largest single share, but not all of it); restoring the exact prior state
  satisfies "reversing contract 0014's redistribution" literally rather than partially.

## Verification

### Backend

```
$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
146 passed, 2 warnings in 1.23s
```
146 > 133 (baseline stated in the contract).

One test I wrote initially was wrong, not the code: I asserted `333.08` renders as
`333.08000000000000`, copying the contract's illustrative example literally. `333.08` is not
exactly representable in binary64 — `'%.14f' % 333.08` is `333.07999999999998` in plain Python,
nothing to do with this code. Fixed the test to use `100.5` (exactly representable), which
isolates "14 digits after the decimal point" from float64 representation error.

```
$ grep -rnE "except\s*:|except Exception" backend/app/export.py backend/app/routers/universe.py
(no matches, exit 1)

$ ls -1 backend/migrations/versions/
0001_initial.py
0002_add_adj_close.py
0003_universe_tickers.py
```

Contract's own ad-hoc snippet:
```
Date,Open,High,Low,Close,Adj Close,Volume
2016-01-04,100.50000000000000,101.00000000000000,99.00000000000000,100.75000000000000,99.09999999999999,1234567
2016-01-05,,102.00000000000000,100.00000000000000,101.50000000000000,100.20000000000000,
```
Header exact; 14-decimal prices; `1234567` with no decimal point; empty fields for both nulls
(the null `open` and the null `volume`) — no `nan`, no `None`.

### Frontend

```
$ npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ built in 113ms

$ git diff --stat frontend/package.json
(empty)

$ grep -rn "lucide-react" frontend/src/
DownloadIcon.tsx and SettingsIcon.tsx both match — see "criteria that can't literally pass" above

$ grep -n "download" frontend/src/components/UniverseTable.tsx
(no output — see above)

$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(' frontend/src/components/
(no matches, exit 1)
```

### 11. 375px, no horizontal scroll — **NOT independently verified in a browser**

Same sandbox limitation as contract 0015: this environment hard-blocks executing any binary from
inside a Python virtualenv (confirmed then; still true now — I did not re-attempt it here since
that's a backend constraint anyway and doesn't block a frontend-only manual check, but I have no
headless browser tooling available in this session either). What I did instead: restored the exact
pre-contract-0014 column widths, which were live in production before and (per that contract's own
history) fit without horizontal overflow at the same breakpoint. This is evidence, not a
substitute for actually looking — please check this one yourself per the contract's "Human
verification" section, along with the actual download-vs-open-in-tab behavior, which no amount of
static analysis can confirm.

## Human verification — not done by me

Per the contract's own instructions, both halves need a human:
1. Local: click MSFT's download icon, confirm the file *saves* (not opens in a tab), check the
   header/line count/first date/whole-number Volume, optionally diff against an old `YF.py` output.
2. **Deployed**: confirm it still downloads rather than opening a tab of text cross-origin — the
   one check that cannot be done locally, and the reason `Content-Disposition` exists at all.
