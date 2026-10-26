# 0175 audit (planner, 2026-10-26): accepted; criteria 20–21 browser-run against a stub

**Re-run:** tsc (`-p tsconfig.app.json`) exits 0. Tests: **403 passed in 28 files** (387 + 16). Lint shows
the 2 known warnings only. Build exits 0. The `title=` and green/red/amber greps print nothing, and awk
finds no line over 300 characters. `git status --short` shows exactly the 5 created files plus
`ResearchPage.tsx` and `PortfoliosPage.tsx`. The `PortfoliosPage.tsx` diff is one import, one call and one
sentence, nothing else.

**Code read against the interface.**
- `lib/memo.ts` matches the spec: flag order, strict comparisons, copy, null handling, and the
  shares-vs-weights rule in `holdingsChanged`.
- `memoStore.ts` guards every access, validates on read, and `saveMemo` returns `false` on a throw.
- The coder's deviations are all sound, and each is an improvement:
  - Dismissed ids plus custom flags are derived from state, instead of copying suggestions into state.
  - The too-few error is derived rather than set inside an effect.
  - The confirm buttons have no tooltips, because the table gave no copy for them.

**Browser checks run on an isolated stack, so Gunnar's :8000/:5173 were untouched.**
- The stack:
  - a stub API on :8010: the 0172 stub plus a `/portfolio/risk` fixture with MS at 36% invested, a 45% risk share and 2.97 effective holdings;
  - `VITE_API_URL=http://127.0.0.1:8010 npx vite --port 5180`;
  - a `/tmp` copy of `smoke-render.mjs` with the port changed and `awaitPromise` added.
- **20:** no `EXCEPTION:` lines. PAGE TEXT has the disclaimer, the evidence with all three windows, `Recommendation`, `Rationale`, `Red flags`, `Monitoring plan`, `Save memo` and `Saved memos (0)`.
- **21:** the expected flags render in spec order with the correct severities: Concentrated (High), One holding dominates (Medium), Drives the risk (Medium), Too little history (`GLD, SETM`, Medium). Then I:
  - added a custom flag;
  - dismissed "drives the risk";
  - typed a two-line rationale;
  - chose NO-GO and saved.

  The results:
  - Save was disabled while the rationale was blank.
  - The stored memo has flags `concentration, largest-holding, short-history, custom`, the holdings with shares, and cash 38.
  - The list shows `Saved memos (1)` with the date, NO-GO and the first line only.
  - The form reset to CONDITIONAL, an empty rationale and the 4 suggested flags.
  - Expanding the memo shows the full rationale, the flags without `×`, and `XLK 20.0%, MS 22.0%, GLD 20.0%, Cash 38.0%`.
- **Persistence, the "changed" note and delete:** I re-ran with XLK at 11 shares instead of 10.
  - The memo survived the reload and shows `Holdings have changed since this memo.`
  - Delete asks `Delete this memo?`. Confirming leaves `Saved memos (0)` and storage `[]`.
- **One holding:** the compare request is not sent. The evidence shows `—` for the Sharpe and drawdown
  rows, plus `Add at least two holdings to run the holdout comparison.`. Risk evidence still shows.

**Not checked:**
- Real BEC data. That is Gunnar's look.
- The portfolio-delete cascade in the browser. `memoStore.test.ts` criterion 10 and the one-line call cover it.
- The storage-full message. It is unit-tested through `saveMemo` only.

**Minor issues. None blocks acceptance, and none is worth a contract yet.**
- **Duplicate compare request.** Opening Research runs the compare on the Compare Optimizers pill, and switching to Decision Memo runs it again. That is about 1 s of backend time, twice. Fix it only if it bothers Gunnar, for example with a shared per-visit cache.
- **Stale "Saved." note.** `Saved.` stays on screen after the next edit, until the next save.
- **Same-millisecond sort.** `listMemos` sorts on the ISO string, so two memos saved in the same millisecond tie. This is harmless.

**Tool gap, still open:** `smoke-render.mjs` should take `SMOKE_BASE_URL`, and an `awaitPromise` for `SMOKE_EVAL`.
This audit worked around both with a `/tmp` copy.
