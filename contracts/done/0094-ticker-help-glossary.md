# Contract 0094 — /ticker Help & Glossary

**Status:** accepted
**Scope:** frontend only. No backend file may be edited.

## Why

The reference `/ticker` page has a **Help** button top-right opening a right-hand *Help & Glossary*
drawer. Ours has nothing. This is the last gap in the `/ticker` parity work started in 0091.

## Three places the reference is wrong for us — do not copy it

Read `git show main:frontend/components/HelpSidebar.tsx` for the content and layout, but not for
these:

**1. It documents features we do not have.** Its glossary is 24 entries; eleven describe an
optimizer, a forecaster, an alerting system, a validation suite and portfolio risk decomposition —
none of which exist in the rebuild. A help panel explaining controls that are not on screen is worse
than a shorter one. The entry list below is the applicable subset plus our own indicators.

**2. It has no dialog behaviour.** No Escape handler, no focus restore, no `role="dialog"`, no
`aria-modal`. `frontend/src/components/ChartDialog.tsx` has all four. **Follow ChartDialog, not the
reference** — copying the reference here would ship an accessibility regression against a pattern
this codebase already established.

**3. It imports `lucide-react`.** We have no icon library and the README commits to not adding one;
`DownloadIcon.tsx` and `SettingsIcon.tsx` are hand-rolled inline SVGs. Do the same. **Do not add a
dependency.**

Also dropped: the reference's **"Last Trigger Date"** entry. `TickerSignals` carries `ticker`,
`signals`, `atr` and `atr_pct` — there is no trigger date anywhere in our API, so that entry would
document a hover that does not exist.

## Files

- `frontend/src/lib/indicators.ts` — **new**
- `frontend/src/lib/indicators.test.ts` — **new**
- `frontend/src/components/HelpSidebar.tsx` — **new**
- `frontend/src/pages/TickerPage.tsx`

Do not edit any other file. Do not edit `REBUILD.md` — the planner records the omitted terms there.
Do not edit anything under `backend/`. `reference files/` is read-only.

---

## Criteria

### 1. `INDICATOR_GROUPS` and the glossary live together in `src/lib/indicators.ts`

Move `INDICATOR_GROUPS` out of `TickerPage.tsx` **verbatim** — same six entries, same keys, same
labels, same order — and export it from the new module. `TickerPage` imports it instead. Its rendered
checkboxes must not change.

In the same module:

```ts
export interface GlossaryEntry {
  term: string
  definition: string
  /** Set when this entry documents an INDICATOR_GROUPS toggle, so the two cannot drift apart. */
  indicatorKey?: string
}

export const GLOSSARY: ReadonlyArray<GlossaryEntry> = [ /* ... */ ]
```

They share a module so criterion 2's drift test can import both without either file importing a
React component.

### 2. A test that the glossary cannot drift from the toggles

`frontend/src/lib/indicators.test.ts`, as separate `it` blocks:

- **Every key in `INDICATOR_GROUPS` has exactly one `GLOSSARY` entry carrying that `indicatorKey`.**
  This is the criterion that earns its keep: a seventh indicator added later without a glossary entry
  fails the suite instead of silently shipping a help panel that omits it.
- No two entries share a `term`.
- Every entry has a non-empty `term` and a non-empty `definition`.
- Every `indicatorKey` that is set corresponds to a real `INDICATOR_GROUPS` key — catches the reverse
  drift, a glossary entry for a toggle that was removed.

**Check:** `npm run test` passes and `grep -c "it(" frontend/src/lib/indicators.test.ts` ≥ 4.

### 3. The glossary entries

Fourteen entries, in this order. Definitions are yours to write in the reference's register — one
short paragraph, plain English, no marketing. Six carry an `indicatorKey`.

| # | term | `indicatorKey` | must state |
|---|---|---|---|
| 1 | SMA (Simple Moving Average) | — | average close over N days; SMA 20 reacts faster than SMA 50; bullish crossover is fast above slow |
| 2 | EMA (Exponential Moving Average) | `ema` | weights recent closes more heavily, so it turns sooner than an SMA of the same length |
| 3 | RSI (Relative Strength Index) | — | 0–100 momentum oscillator; above 70 overbought, below 30 oversold, 30–70 neutral |
| 4 | MACD | — | 12-day EMA minus 26-day EMA; signal is the 9-day EMA of that; **histogram = MACD − signal** |
| 5 | ATR (Average True Range) | — | 14-day average true range; a volatility measure. **State plainly that ATR is not directional — it says how far price moves, not which way**, which is why it shows as a number rather than a bullish or bearish badge |
| 6 | Bollinger Bands | `bollinger` | 20-day SMA ± 2 standard deviations; price outside the band suggests a stretch, not a direction |
| 7 | Donchian Channel | `donchian` | rolling 20-day high and low with the midpoint between them; a break above the upper edge is a momentum signal |
| 8 | ADX (Average Directional Index) | `adx` | 0–100 trend *strength*. **State that a high ADX does not mean bullish** — a strong downtrend scores just as high as a strong uptrend |
| 9 | Stochastic %K / %D | `stochastic` | where the close sits in its 14-day range; %K is smoothed over 3 days and %D is a 3-day average of %K; above 80 overbought, below 20 oversold |
| 10 | OBV (On-Balance Volume) | `obv` | cumulative volume, added on up days and subtracted on down days; divergence from price can precede a reversal |
| 11 | Bullish / Bearish / Neutral | — | bullish is upward momentum (fast above slow, MACD above signal), bearish the reverse, neutral neither |
| 12 | Why a signal can be blank | — | **ours.** A blank cell is not neutral — it means there is not enough stored history to compute that indicator yet. Neutral is a real reading; blank is the absence of one |
| 13 | Split adjustment | — | **ours.** Prices are adjusted by `adj_close / close`, and **volume is divided by the same ratio**, so a split does not appear as a jump in either the price line or OBV |
| 14 | Where the data comes from | — | **ours, rewritten — do not copy the reference's wording.** Yahoo Finance. Stored bars are refreshed when someone visits, once per window (09:30 / 12:00 / 16:00 ET), and are considered stale only when the newest bar predates the last completed trading session. Every indicator is computed on stored closes, so nothing here is real-time |

Entries 12–14 have no reference equivalent. They exist because each is a question this app will
actually provoke: a blank signal cell, a chart that does not jump at a split, and a price that
disagrees with a live quote elsewhere.

### 4. `HelpSidebar` follows ChartDialog's behaviour

New `frontend/src/components/HelpSidebar.tsx`, default-exporting a self-contained component holding
its own open state.

Trigger: a bordered button reading `Help` with a hand-rolled inline SVG question-mark-in-circle,
styled to match the existing secondary buttons on the page.

Panel, when open — match **`ChartDialog.tsx`** for each of these, reading it rather than guessing:

- a backdrop using the existing `bg-overlay` class, closing on click of the backdrop itself only
- the panel as a right-hand drawer, full height, ~20rem wide, scrolling its own overflow
- `role="dialog"` and `aria-modal="true"`, labelled `Help & Glossary`
- **Escape closes it**
- focus moves into the panel on open and **returns to the Help button on close**
- a close button in the header

Body: each `GLOSSARY` entry as a term in `text-xs font-semibold` above its definition in
`text-xs text-[var(--color-muted)] leading-relaxed`.

**Check:** `grep -c "lucide" frontend/src/components/HelpSidebar.tsx` returns 0, and each of
`role="dialog"`, `aria-modal`, `Escape` appears at least once in that file.

### 5. Wired into `/ticker`, top right

`TickerPage` renders `<HelpSidebar />` in the page header row, right-aligned, on the same line as the
ticker heading. It must not overlap or displace the existing "More Details" navigation or the date
controls at any width.

### 6. Verification

- `npx tsc -p tsconfig.app.json --noEmit` — clean. Plain `tsc --noEmit` is vacuous here; do not use it.
- `npm run build` — succeeds.
- `npm run test` — passes, with the new `indicators.test.ts` cases.
- Confirm `frontend/package.json` is unchanged: `git diff --stat frontend/package.json` prints
  nothing. This is a read-only git command and is permitted.

---

## Report

Report in chat, covering:

- the full output of the four commands in criterion 6
- the exact output of each `grep -c` named above
- your drift test, pasted
- the definitions you wrote for entries 5, 8, 12 and 13, pasted — these four are the ones that state
  something non-obvious and easy to get subtly wrong
- anything you could not do, or did differently, and why

Do not run any git command that writes: no commit, push, merge, rebase, tag, stash, checkout of
another branch, or `gh` write. Gunnar commits.

## What a human still has to look at

1. **Escape, and backdrop click** — both close the drawer, and focus lands back on the Help button.
2. **Dark mode** — the drawer and backdrop read correctly against the dark surface.
3. **Narrow window (~700px)** — the drawer does not cover the whole viewport awkwardly, and the Help
   button has not collided with the ticker heading.
4. **Scroll the drawer** — all fourteen entries reachable; the page behind does not scroll with it.
