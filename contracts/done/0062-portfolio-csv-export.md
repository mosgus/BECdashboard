# Contract 0062 — Export a portfolio as CSV from the Portfolios page

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

**Blocked on contract 0061 being accepted.** `serializePortfolioCsv` and `portfolioCsvFilename` must
already exist in `frontend/src/lib/portfolioCsv.ts`. If they do not, report `BLOCKED` and stop.

## Goal

An `Export CSV` button beside `Delete portfolio` on `/portfolios` that downloads the selected
portfolio in the canonical Blue Eagle format.

## Why

Portfolios live in `localStorage` only (`REBUILD.md`, "Portfolio persistence"), so they are tied to
one browser on one machine and clearing site data loses them. CSV export was named as the backup
story when that decision was made and is the half of it that ships first — a file you can carry to
another device is useful before the importer that reads it back exists.

## Files

Create:
- `frontend/src/lib/download.ts` — a single browser-side download helper. There is no existing one:
  the Universe export is an `<a href>` straight at a backend route
  (`UniversePage.tsx:227`), and nothing in `frontend/src/` constructs a `Blob`. Portfolios are
  client-side by design and must not gain a backend route to be downloadable.

Modify:
- `frontend/src/pages/PortfoliosPage.tsx` — add the button to the header row that currently holds the
  rename input and `Delete portfolio` (around line 228–246).

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**`frontend/src/components/AddPositionForm.tsx` has an uncommitted hand-edit in the working tree.**
Do not revert, reformat, or touch that file.

**`reference files/` is read-only and never belongs on a file list.** `.claude/settings.json` denies
Edit and Write there; that deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

```ts
// frontend/src/lib/download.ts

/** Trigger a browser download of `text` as `filename`. Creates an object URL, clicks a
 *  detached anchor, and revokes the URL — the revoke is required or the Blob leaks for the
 *  lifetime of the document. */
export function downloadTextFile(filename: string, text: string, mimeType: string): void
```

Use `'text/csv;charset=utf-8'` as the MIME type at the call site, not as a default inside the helper.

In `PortfoliosPage.tsx`, inside the existing `valued && current ?` branch:

```tsx
<Tooltip label="Download this portfolio as a CSV you can re-import on another device">
  <button
    type="button"
    onClick={() => downloadTextFile(
      portfolioCsvFilename(current, new Date()),
      serializePortfolioCsv(current),
      'text/csv;charset=utf-8',
    )}
    className="text-xs font-medium px-2.5 py-1.5 rounded-[var(--radius-btn)] border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground whitespace-nowrap"
  >
    Export CSV
  </button>
</Tooltip>
```

Place it immediately **before** the `Delete portfolio` tooltip so the destructive control stays
last. The two buttons share a class string; keep them identical apart from `Delete portfolio`'s
`hover:bg-btn-danger hover:text-btn-danger-text`.

`new Date()` is read at click time in the component, not inside `portfolioCsvFilename` — that
function takes `now` as an argument precisely so it stays pure (`REBUILD.md`, "Every `lib/` function
takes `now` as an argument").

## Out of scope

- **No import.** No file input, no drag-and-drop, no changes to `NewPortfolioDialog`. That is 0063.
- **No presets.** Do not add, stub, or name any preset portfolio or allocation.
- **No export for legacy portfolios.** The `isLegacyPortfolio(selected)` branch renders its own card
  and gains nothing. A `LegacyPortfolio` has no `cashWeight` and `serializePortfolioCsv` does not
  accept one.
- **No bulk export.** One button, the selected portfolio only. No "export all" and no zip.
- No backend route, no server persistence, no Python file touched.
- No new dependency, runtime or dev.
- Do not modify `lib/portfolio.ts`, `lib/portfolioStore.ts`, or `lib/portfolioCsv.ts`.

## Acceptance criteria

1. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
   this project and is not a substitute — see `REBUILD.md`.)
2. `cd frontend && npm run build` exits 0.
3. `cd frontend && npm run lint` exits 0.
4. `cd frontend && npm run test` exits 0 — the 0061 suite still passes, unchanged.
5. `grep -n "revokeObjectURL" frontend/src/lib/download.ts` prints a line. The object URL is revoked,
   not leaked.
6. `grep -n "Export CSV" frontend/src/pages/PortfoliosPage.tsx` prints exactly one line, and that
   line sits inside the `valued && current ?` branch — not in the `isLegacyPortfolio` branch. State
   the line numbers of both in the report.
7. `grep -c "Tooltip" frontend/src/pages/PortfoliosPage.tsx` is exactly one greater than before the
   change. Report both counts.
8. `git status --porcelain frontend/` lists only `frontend/src/lib/download.ts`,
   `frontend/src/pages/PortfoliosPage.tsx`, and the pre-existing
   ` M frontend/src/components/AddPositionForm.tsx`. Nothing else.
9. `git diff frontend/src/components/AddPositionForm.tsx` still shows only the single added
   `!available.some(...)` line.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
grep -n "revokeObjectURL" src/lib/download.ts
grep -n "Export CSV" src/pages/PortfoliosPage.tsx
grep -c "Tooltip" src/pages/PortfoliosPage.tsx
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git diff frontend/src/components/AddPositionForm.tsx
```

## Tooltips — required for any contract adding interactive elements

One element is added. Exact copy, to be checked against what ships:

| element | tooltip label |
|---|---|
| `Export CSV` button | `Download this portfolio as a CSV you can re-import on another device` |

Phrased as the effect, not the label, per `REBUILD.md`. Do **not** use the `title` attribute.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it.**

```bash
cd frontend && npm run dev
```

Then, at `http://localhost:5173/portfolios`:

1. Select a portfolio with at least one position and click **Export CSV**. A file downloads. Open it
   in a text editor — not Excel, which will reformat the numbers. It must begin with
   `# Blue Eagle Portfolio v1`, carry `# name: <the portfolio's name>` on line 2, and end with a
   `CASH` row whose weight plus the position weights is 100.
2. Check the filename is `<slug>-YYYY-MM-DD.csv` with today's date.
3. Confirm the button's tooltip appears on hover and reads exactly as specified above.
4. Check the header row at **1024px wide** — the boundary where `lg:` fires — and at 375px. Three
   controls now share that row (rename input, Export, Delete) where two did before; confirm it wraps
   rather than pushing `Delete portfolio` out of the card. `REBUILD.md` records this table's
   horizontal overflow as a bug three separate times, always as silent clipping rather than a
   scrollbar, so look at the boundary specifically and not just a round number.
5. Select a **legacy** portfolio if one exists in your browser storage, and confirm no Export button
   appears on it.

No backend restart is needed — this contract changes no server code.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
