# Contract 0052 — The type label stops guessing

**Status:** reported
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

A ticker whose `quote_type` is unknown renders `—` instead of a confident `Equity`, an index renders
`Index`, and the label is computed in exactly one place instead of three.

**Frontend only. No backend, no endpoint, no migration.**

## Why

Gunnar added PBR, SHNY and VOO on the deployed app on 2026-09-18 and all three rendered as **Equity**
— including VOO, which is an ETF. `UniverseTable.tsx:33`:

```tsx
{isEtf ? 'ETF' : 'Equity'}
```

`quote_type` was `null` (contract 0051 explains why), and `null` falls into the else branch. The
Sector column two lines later gets this right — `{row.sector ?? '—'}` — so the table is already
inconsistent with itself about how it reports "we don't know".

The same expression is duplicated at `ChartDialog.tsx:216`, so the chart header lies the same way.

### `INDEX` is the case this has been quietly getting wrong all along

`^GSPC`, `^IXIC` and `^RUT` are stored with `quote_type = "INDEX"` — `TickerStrip.tsx:33` already
branches on exactly that value — yet the table has always labelled them **Equity**. Fixing the null
case fixes this one too, and `FilterDialog` offers only `EQUITY` and `ETF` as type filters
(`FilterDialog.tsx:36-37`), so today filtering to "Equity" *excludes* the three indices the table
claims are equities.

**Expect the three index rows to change from `Equity` to `Index`. That is the fix, not a regression.**

Contract 0051 is what makes `quote_type` arrive for newly-added tickers on the deployed app. This
contract is what makes an unknown one honest. They are independent and can land in either order.

## Files

Create:
- `frontend/src/lib/tickerType.ts` — the one place the label is derived

Modify:
- `frontend/src/components/UniverseTable.tsx` — `TypePill` uses it; `null` renders `—`
- `frontend/src/components/ChartDialog.tsx` — line 216's inline ternary uses it
- `frontend/src/components/FilterDialog.tsx` — add the `INDEX` type option

**Touch nothing else.** No backend file, no `globals.css`, no `index.html`, no other component or
page, nothing under `reference files/` (read-only, and it never belongs on a file list). **No new
dependency.**

Leave `TickerStrip.tsx:33` alone — it tests `=== 'INDEX'` to decide *behaviour*, not to render a
label, and it is already correct.

## `lib/tickerType.ts` — pure

```ts
/** The display label for a stored quote_type. Yahoo's vocabulary is EQUITY / ETF / INDEX,
 *  stored verbatim from .info's quoteType or the chart endpoint's instrumentType — the two
 *  agree. null means we have no fundamentals row yet, which is a different claim from
 *  "equity" and must not be rendered as one. An unrecognised value is title-cased rather
 *  than swallowed: MUTUALFUND and CURRENCY exist and a silent "Equity" would be a lie. */
export function typeLabel(quoteType: string | null): string
```

`EQUITY → 'Equity'`, `ETF → 'ETF'`, `INDEX → 'Index'`, `null → '—'`, anything else → title-case of
the raw value. Case-insensitive on input. Use `'—'` — the same em dash `lib/format.ts`'s `NIL`
already uses for a missing value; **import `NIL` if it is exported, rather than re-typing the
character.**

No clock, no storage, no network, no `Intl`.

## `TypePill`

Keep the component and keep its pill styling. Two changes:

- The label comes from `typeLabel`.
- **When `quoteType` is `null`, render a plain `—` with no pill**, styled like the Sector column's
  muted `—` (`text-[var(--color-muted)]`). A pill drawn around `—` reads as a category called "dash".

The ETF colour branch (`bg-brand-primary/10 text-brand-primary` vs `bg-brand-border`) stays as it is.
`Index` takes the same non-ETF styling as `Equity`; **do not invent a third colour.**

## `ChartDialog.tsx:216`

Replace `entry?.quote_type === 'ETF' ? 'ETF' : 'Equity'` with `typeLabel(entry?.quote_type ?? null)`.
That line builds an array which is then filtered before joining — check what the filter drops, and
make sure a `—` from `typeLabel` does not end up rendered as a stray dash between two separators. If
it would, exclude the unknown case from the array entirely rather than special-casing the join.

## `FilterDialog.tsx`

Add `{ value: 'INDEX', label: 'Index' }` after the existing `ETF` entry. No other change — do not add
an "unknown" filter option, and do not change how `filters.ts` matches.

## Out of scope

- **No backend change.** Why `quote_type` is null is contract 0051.
- No "unknown" filter option, no change to `lib/filters.ts`.
- No new colour token, no change to `globals.css`.
- No change to `TickerStrip.tsx`.
- No change to the Sector, Name, or any other column.
- No marker for "this row's fundamentals are incomplete" — with 0051 landed, a row with a name but
  no market cap is the normal shape of an ETF, so a marker would fire constantly. Deliberately left
  as an open question below.

## Tooltips

This contract adds one interactive element: the `INDEX` filter option, which follows the existing
type options' pattern exactly. **Match whatever the `EQUITY` and `ETF` options already do** — if they
carry a `Tooltip`, the new one does too, with copy in the same shape; if they do not, do not add one
to a single option and leave its siblings bare.

Add no `title` attribute anywhere — it does not render on `disabled` elements. See `REBUILD.md`,
"Every interactive element gets a hover tooltip."

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
   **Not bare `tsc --noEmit`.**
2. `npm run lint` reports **exactly one** warning, still the `set-state-in-effect` baseline in
   `UniversePage.tsx`. Match on the rule and the count, not the line.
3. `git diff --stat backend/ frontend/src/styles/ frontend/index.html` is **empty**.
4. `grep -rn "'Equity'" frontend/src/` matches **only** `lib/tickerType.ts` and
   `components/FilterDialog.tsx` — the label exists in one derivation and one filter option, nowhere
   else. Quote every match.
5. `grep -n "quote_type === 'ETF'" frontend/src/` matches nothing (exit 1) — both duplicated
   ternaries are gone.
6. `grep -n "INDEX" frontend/src/components/FilterDialog.tsx` matches.
7. `grep -rn "dark:" frontend/src/` matches nothing (exit 1).
8. `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(' frontend/src/lib/tickerType.ts` matches nothing
   (exit 1).
9. `git status --porcelain` lists nothing outside this contract's four files plus the contract file.
   **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

Paste the **complete, verbatim** output of each, including failures.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
grep -rn "'Equity'" frontend/src/
grep -rn "quote_type === 'ETF'" frontend/src/ ; echo "(exit $? — 1 = correct)"
grep -n "INDEX" frontend/src/components/FilterDialog.tsx
grep -rn "dark:" frontend/src/ ; echo "(exit $? — 1 = correct)"
git diff --stat backend/ frontend/src/styles/ frontend/index.html ; echo "(empty = untouched)"
git status --porcelain
```

Plus `typeLabel` exercised directly — a throwaway `.mjs` against the **real compiled module**, which
you delete afterwards. Do not hand-write a mirror of the function:

```bash
cd frontend && npx esbuild src/lib/tickerType.ts --format=esm --outfile=/tmp/_t.mjs --log-level=error
# import it from a /tmp/_c.mjs, run with node, then rm -f /tmp/_t.mjs /tmp/_c.mjs
```

Show the output for: `'EQUITY'`, `'ETF'`, `'INDEX'`, `'etf'`, `null`, `''`, `'MUTUALFUND'`.

## Human verification — does Gunnar need to run anything?

**Yes — look at it, in both themes.** Restart the frontend.

1. `/universe`: `^GSPC`, `^IXIC` and `^RUT` now read **Index**, not Equity. This is the intended
   change.
2. Until contract 0051 is deployed, PBR / SHNY / VOO read `—` in the Type column rather than a wrong
   `Equity`. After 0051 they read their real types.
3. Open a chart for an index and for an ETF — the header line under the title reports the same label
   the table does, with no stray dash or doubled separator when a field is unknown.
4. Filter → Type now offers **Index**. Selecting it shows exactly the three index rows; selecting
   Equity no longer silently excludes them from a set the table claimed they belonged to.
5. Dark mode, then light. The plain `—` should read as muted, not as a broken pill.

## Open questions — do NOT resolve these yourself

- **Whether a row with incomplete fundamentals deserves a visible marker.** `has_fundamentals` is
  already in the payload and rendered nowhere; after 0051 it is true for partial rows too, so it no
  longer answers the question it looks like it answers.
- **Whether `MUTUALFUND` and other Yahoo types should get their own filter options**, or whether
  Equity/ETF/Index is the whole vocabulary this app cares about.
- **What happens to the four `Coming soon` cards.** Still open.
