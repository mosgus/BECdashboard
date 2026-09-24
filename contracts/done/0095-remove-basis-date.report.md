# Report — Contract 0095: Remove the portfolio basis date

**Status:** accepted
**Agent:** sonnet (two runs)

## Audit

**Accepted, 2026-09-24.** Every verification command was re-run by the planner and passed.

**Run 1 — BLOCKED, correctly.** Criterion 1 ("no non-test frontend source mentions `basisDate`")
contradicted the Interface requirement to strip a stored `basisDate` key in `portfolioStore.ts`.
That was a planner error, and it is the exact failure the "name what each criterion forces" check
exists to catch. The coder refused to split the string to dodge the grep. That refusal is the
precedent worth keeping. The contract was revised with a banner, and criterion 1 now allows the
single strip, proven by an `awk` check to sit inside `normaliseStoredPortfolio`.

**Run 2 — complete.** Verified independently:
- The acceptance greps all hold: one allowed reference, at line 72, inside the function. Zero
  `since` in the five files. `HelpSidebar` count is 2, so Gunnar's uncommitted edit is preserved.
  The CSV header has three columns. Exactly one `since`-named backend test.
- `npm run build` ok; `npm run test` 75/75; lint shows only the two warnings that were already
  there before this work (`HelpSidebar.tsx:44`, `UniversePage.tsx:60`); pytest 506 passed.
- The backend test count reconciles exactly: `test_api_universe.py` went from 68 `def test_` at
  HEAD to 62 (−7 + 1).

What is good, concretely:
- The strip-on-read is a single destructure in `normaliseStoredPortfolio` that every stored entry
  passes through. That is why the sibling case is covered and not just the saved portfolio.
- The tests can fail on the things that matter. "Malformed basisDate loads" would have failed
  under the old validation, which dropped the portfolio (length 0). The sibling test parses the raw
  stored string, not `listPortfolios()`, which would have hidden a leak. The legacy-CSV test compares
  against the three-column parse, not against restated literals.
- The one unrequested edit (`stubStorage` typed as `unknown[]`) was forced: the legacy fixtures
  carry a property `Portfolio` no longer has. It is in a contract-listed file, and the coder
  disclosed it.

Not verified by the planner: the browser checks in "Human verification". Gunnar should run
steps 1–4 there, especially step 1, loading an existing portfolio that had a basis date.
