# Report — Contract 0094 (/ticker Help & Glossary)

**Verdict: accepted.** tsc clean, 77 tests across 6 files (up from 73), build succeeds,
`git diff --stat frontend/package.json` empty — no dependency was added for the icon.

All fourteen glossary terms are present in the specified order:

```
 1 SMA (Simple Moving Average)      8 ADX (Average Directional Index)
 2 EMA (Exponential Moving Average) 9 Stochastic %K / %D
 3 RSI (Relative Strength Index)   10 OBV (On-Balance Volume)
 4 MACD                            11 Bullish / Bearish / Neutral
 5 ATR (Average True Range)        12 Why a signal can be blank
 6 Bollinger Bands                 13 Split adjustment
 7 Donchian Channel                14 Where the data comes from
```

`INDICATOR_GROUPS` moved with its labels intact — `EMA 20/50 | Bollinger (20, 2σ) | Donchian (20) |
ADX 14 | Stochastic (14,3) | OBV` — so the checkboxes render exactly as before.

## The drift guard actually fires

The point of that test was to fail when someone adds an indicator without documenting it. I checked
that rather than assuming it, by replaying the assertions against mutated inputs:

```
as shipped       -> test1: true   test4: true
add a 7th toggle -> test1: false   (correctly fails)
bogus indicatorKey -> test4: false (correctly fails)
remove a toggle  -> test4: false   (correctly fails)
```

All three drift directions are caught. This is the criterion in 0094 that will still be earning its
keep in six months.

Its one blind spot, noted and not worth fixing: every assertion is inside a `for` loop, so emptying
`INDICATOR_GROUPS` entirely would make test 1 vacuous. Emptying `GLOSSARY` is still caught — test 1
would find zero matches where it requires one.

## Dialog behaviour is present in code

`role="dialog"`, `aria-modal="true"`, `aria-label="Help & Glossary"`, an `Escape` handler, focus into
the panel on open and `triggerRef.current?.focus()` on close, over the existing `bg-overlay`
backdrop. One `<svg>`, zero occurrences of `lucide` in the component or in `package.json`.

The coder deviated on focus restore: a direct ref to the Help button rather than ChartDialog's
"restore whatever was previously focused". Correct call. `ChartDialog` is opened from a table row and
genuinely does not know its trigger; `HelpSidebar` owns its button, so the general mechanism would be
indirection with no payoff.

## The four definitions that had to say something non-obvious

All four say it. ATR states it is not directional and that this is *why* it renders as a number
rather than a badge. ADX states that a strong downtrend scores as high as a strong uptrend. The blank
entry states plainly that blank is the absence of a reading and neutral is a real one — the
`state: null` distinction from 0088, which is the single most confusing thing on the Holdings page.
Split adjustment states that volume is divided by the same ratio, which is the part everyone omits.

## The z-index question the coder raised

They flagged that `HelpSidebar`'s `z-[100]` matches `ChartDialog`'s, and said they had not traced
every render path. Confirmed: `grep -c "ChartDialog" src/pages/TickerPage.tsx` returns 0 — it is
mounted only from `/universe`, `HelpSidebar` only from `/ticker`, so the two cannot coexist. Raising
an uncertainty they could not close rather than asserting it was fine was the right way to report it.

## Planner action taken

The eleven deferred terms are recorded in `REBUILD.md` under "Explicitly cut from the old app", as a
table mapping each to the feature that brings it back, plus a note that the reference's definitions
carry inheritable decisions (the 3.64% risk-free rate, the 0.15/0.25 HHI banding, ≥ 4/7 to pass
validation). "Last Trigger Date" is recorded as dropped rather than deferred, since no trigger date
exists in the API.

## What still needs a human

1. Escape and backdrop click both close it, and focus lands back on the Help button.
2. Dark mode — drawer and backdrop read correctly against the dark surface.
3. ~700px wide — the drawer does not swallow the viewport; Help has not collided with the heading.
4. Scroll the drawer — all fourteen entries reachable, page behind does not scroll with it.
