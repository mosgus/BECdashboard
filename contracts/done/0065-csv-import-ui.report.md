# Report — Contract 0065 (CSV import UI and number-input steppers)

**Verdict: rejected.** Part 2 (CSV import) is correct and stays. Part 1 (steppers) does not do what
the contract specified, does not fix the bug Gunnar reported, and **both of my acceptance criteria
passed anyway.**

## Part 1 — rejected

The contract specified an app-wide element selector:

```css
input[type="number"] { appearance: textfield; ... }
input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; ... }
```

What shipped (`globals.css:120-131`) is an **opt-in class**, commented *"Hide number input spinners
for weight field only"*:

```css
input.no-spinners { appearance: textfield; ... }
input.no-spinners::-webkit-inner-spin-button { -webkit-appearance: none; ... }
```

The class is applied to **one of seven** number inputs in the app:

| file | `type="number"` inputs | carrying `no-spinners` |
|---|---|---|
| `AddPositionForm.tsx` | 2 | 1 |
| `PortfoliosPage.tsx` | 1 | 0 |
| `NewPortfolioDialog.tsx` | 4 | 0 |

**Gunnar reported "the `Weight %` and `Cash` fields" on `/portfolios`. The Cash field is one of the
six that was missed.** The reported bug is half-fixed.

Two further problems:

- **Scope was widened.** `AddPositionForm.tsx` is named in Out of scope — *"Do not change ...
  `AddPositionForm`"* — and it was edited to add the class. It is one line on an existing `className`
  (the larger diff against `HEAD` in that file is contract 0064's, not this contract's), so the cost
  is small, but the file list was explicit.
- **The contract's stated rationale was inverted.** It said the rule is removed *"app-wide rather
  than per-field"* and gave the reason: every number input here is a free-form quantity. Shipping a
  per-field opt-in is the option the contract argued against, without saying so.

## My criteria failed — fifth instance of the same shape

Criterion 6 required:

```
grep -n "webkit-inner-spin-button" frontend/src/styles/globals.css   → printed a line ✓
grep -n "appearance: textfield" frontend/src/styles/globals.css      → printed a line ✓
```

Both pass against the wrong selector, because **I grepped the declarations and never the selector.**
I even wrote in the contract that *"these greps prove the rules are present, not that they work"* —
and then shipped them as the only automated check anyway.

This is the fifth recorded instance of "grepping for a keyword is not verifying a construct," and the
second in the expensive direction — flagging broken work as correct. The earlier expensive one was
the `prefers-reduced-motion` fallback, which shipped broken twice behind a passing keyword grep.

**The criterion that would have caught it, and is now in 0066:**

```bash
grep -n 'input\[type="number"\]' frontend/src/styles/globals.css   # the selector, not the property
grep -rn "no-spinners" frontend/src/ ; echo "must be empty"
```

Plus the count check that makes it unfakeable: the number of `type="number"` inputs carrying any
spinner-related class must be **zero**, because the rule is supposed to need no class at all.

## Part 2 — accepted in substance

Read the implementation rather than the summary. It is right:

- `applySeed` (`NewPortfolioDialog.tsx:48-53`) sets `name`, `mode`, `cashText`, `rows` directly and
  **does not route through `handleModeChange`**, which would have recomputed the file's own numbers
  from an empty draft. This was the subtlest requirement in the contract and it was honoured.
- A parse rejection returns at line 64-66, before the single `applySeed` call at line 68 — a failed
  import cannot half-apply a seed.
- `input.value = ''` sits in a `finally`, so re-picking the same file works after a failure as well
  as a success.
- A `try/catch` around `file.text()` with *"Could not read the selected CSV file."* is not in the
  contract and is correct — an unreadable file is a real case and a thrown promise would otherwise
  surface as nothing at all.
- The dropped-ticker block (`163-174`) is guarded by `droppedRows.length > 0`, renders weights via
  `formatPercent`, and switches between the weighted and ticker-only wording as specified.
- `pristine` is the exact three-part condition, and `grep -rn "preset\|Preset"` is empty.

Verified independently: 30 tests, `TSC OK`, clean build, lint clean, `npm ci` exits 0.

The reported "deviation" — `applySeed`'s comment saying *"future catalog selection"* rather than
*"preset"* — is not a deviation. It is the coder correctly keeping the word out of the source so
criterion 10 stays meaningful. Good instinct.

## Disposition

Part 2 stays on disk untouched. Contract **0066** repairs Part 1: replace the class selector with the
element selector and remove the class from `AddPositionForm`. This contract archives with 0066 once
that is accepted.

## Final status — updated 2026-09-21

**Accepted.** Part 1 was redone by contract 0066 under a revised policy (selective opt-in class,
`Shares` keeps its steppers — Gunnar's call). Part 2, the CSV import UI, was correct as shipped and
was never touched. Archived alongside 0066.
