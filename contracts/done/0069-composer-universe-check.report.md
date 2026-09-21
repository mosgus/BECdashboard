# Report — Contract 0069 (Composer rejects off-universe tickers)

**Verdict: accepted.** The `BLOCKED` was criterion 12, which was mine and wrong for the fourth time.

## Verified

`portfolio.ts:343` carries the clause exactly as specified, in the right position:

```ts
else if (draft.rows.some((row) => row.ticker === '')) problem = 'Choose a ticker for every asset'
else if (byTicker.size > 0 && draft.rows.some((row) => row.ticker !== '' && !byTicker.has(row.ticker))) problem = 'Every asset must be a ticker in your Universe'
else if (cashWeight === null) problem = 'Cash must be a valid percentage'
```

All three load-bearing details are present: the `byTicker.size > 0` outage guard, the
`row.ticker !== ''` condition leaving the empty case to the earlier message, and placement after the
empty check. Shares mode untouched at line 381. Five tests added, `TSC OK`, clean build and lint,
`npm ci` fine. The suite went 33 → 38 on this contract.

## Criterion 12 was mine, and it is the fourth of its kind

`git diff frontend/src/components/AddPositionForm.tsx` printed nothing because **Gunnar committed the
file** (`b8c89ee Portfolio Exports`). The working tree matches `HEAD`, so there is no diff. The guard
itself is alive and correct at `AddPositionForm.tsx:57`.

This is the fourth acceptance criterion in this feature phrased against git state, after 0062 twice
and 0063 once — and it is the first one written **after** I added a checklist item to
`agent_prompts/planner-opus.md` telling myself not to. Writing the rule did not stop me applying it.

The specific defect: I used `git diff` to assert **a line still exists**. `git diff` answers "has this
changed since HEAD", which is a different question and changes meaning the moment anything is staged
or committed. The right check for "this line still exists" is `grep`, always:

```bash
grep -n "available.some" frontend/src/components/AddPositionForm.tsx   # unaffected by git state
```

Every future contract protecting a line uses that form. The role file now says so specifically rather
than in general terms.

## Status

Accepted and archived.
