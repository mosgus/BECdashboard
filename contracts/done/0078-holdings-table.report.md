# Report — Contract 0078 (Holdings table)

**Verdict: accepted.** Clean run, no deviations.

## Verified independently

`TSC OK`, clean build, lint unchanged, 55 frontend tests, 467 backend. Main chunk gzip
`104.27 → 105.18 kB`, +0.91 kB — well inside the 3 kB threshold, so nothing unexpected was pulled in.
`AnalysisLayout.tsx` untouched. No dollars, no cost, no recharts.

Read the implementation rather than trusting the greps:

- **Storage first.** `valuePortfolio(current, universeByTicker).rows` renders immediately from
  `localStorage`; the two fetches only fill name, price, day and returns. Weight never waits on the
  network, which was the central requirement.
- **Both failure states are independent and both render**, exactly as specified — `universe.status`
  and `returns.status` are separate `LoadState`s, so a returns outage does not blank the prices.
- **Sort is `.slice().sort(...)` descending** — on a copy, so `valuePortfolio`'s array is not mutated.
- **Cash row at 147-149**, weight from `current.cashWeight`, everything else `—`.
- Existing helpers reused: `positionPrice`, `priceChange`, `valuePortfolio`, `formatPercent`,
  `formatPrice`, `formatShares`. Nothing reimplemented.

**The overflow handling is better than what the contract asked for.** The table is
`min-w-[54rem]` inside an `overflow-x-auto` wrapper, and the card carries **no `overflow-hidden`** —
so nine columns produce a scrollbar instead of silently clipping the last one. `REBUILD.md` records
that exact failure three separate times on the Universe table (contracts 0009, 0014, 0018), always
invisible in a screenshot. Avoided here by construction.

`tickerKey` as the effect dependency — a joined string rather than the array — is the right call:
an array literal would be a new reference every render and refetch forever.

## Two things noted, neither a defect

- `if (current === null) return <></>` is unreachable. `AnalysisLayout` renders its not-found card
  instead of `<Outlet/>` for an unknown or legacy id, so `HoldingsPage` never mounts in that state.
  Harmless defensive code, same shape as the `?? ''` fallback accepted in 0063.
- The card is `rounded-[var(--radius-card)]` without `overflow-hidden`, which is deliberate and
  correct for scrolling — but it means the table's square corners can sit proud of the rounded card
  at the scroll edges. Purely cosmetic, and Gunnar styles these himself.

## Still unverified

The browser checks, and specifically the numbers. Nothing in this environment can judge whether a YTD
figure is *right* — only that it is computed from `adj_close`, which contract 0077 proved.

## Status

Accepted and archived.
