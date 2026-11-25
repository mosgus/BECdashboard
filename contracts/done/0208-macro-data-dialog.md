# Contract 0208 — Macro page: the Data dialog (sample download, 15 drop zones, sign-off, revert)

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, the Macro page has a **Data** button at the top. It opens one dialog, which
has:
- a **Sample data** download (with the download icon) for the format templates;
- a "Your name" field used to sign uploads and reverts;
- the rebuild status;
- one row per input file (15), each with:
  - a drag-and-drop zone (also clickable to pick a file);
  - who uploaded the live version and when, and the date the data runs through;
  - the slot's lock state;
  - a two-step **Revert**;
  - a collapsible version history.

When a new snapshot is built, the page reloads its data.

## Why

Gunnar asked for this on 2026-11-25. He then chose (REBUILD.md, Macro tab):
- the sample download is **format templates**, never the real files;
- it is **one** dialog, not a dialog that opens a second one;
- the pipeline came first. It is now done and accepted (0199–0207).

Every upload is signed: "X uploaded this data on dd/mm/yy" (Gunnar, 2026-11-09). The lock rules
come from the backend (0202/0205): a 1 h correction window, then locked until 24 h after the first
upload, with revert always allowed. The dialog only displays the `gate` the API returns. **It never
computes the rules itself.**

**The dialog does not close on a backdrop click.** This is the 0198 reasoning, which applies even
more strongly here: a file dragged onto the dialog and released just outside it would otherwise
close the dialog and drop the user's typed name and any per-row errors. Escape and the close button
close it.

## Files

Create:
- `frontend/src/lib/macroData.ts`: pure formatting helpers, tested.
- `frontend/src/lib/macroData.test.ts`
- `frontend/src/components/MacroDataDialog.tsx`

Modify:
- `frontend/src/api/client.ts`:
  - add the types and functions below;
  - extend `extractDetail` so an object `detail` with a string `message` yields that message (the
    429 body is `{"detail": {"message", "unlocks_at"}}`).
- `frontend/src/pages/MacroPage.tsx`:
  - add the Data button;
  - mount the dialog;
  - reload the scorecard when the dialog reports a new snapshot.

**Touch nothing else.** No backend changes. If the work appears to require editing a file not on
this list, stop and report `BLOCKED` instead of editing it.

## Interface

```ts
// api/client.ts — additions (field names match the backend's Pydantic models exactly)
export interface MacroGate { allowed: boolean; opens_window: boolean; window_closes_at: string | null; locked_until: string | null }
export interface MacroVersion {
  id: number; filename: string; size_bytes: number; data_through: string | null
  uploaded_by: string; uploaded_at: string; reverted_by: string | null; reverted_at: string | null; live: boolean
}
export interface MacroSlot {
  id: string; label: string; source: string; filename: string; market: string | null
  versions: MacroVersion[]; gate: MacroGate; can_revert: boolean
}
export interface MacroBuild { status: string; started_at: string; finished_at: string | null; result: string | null; error: string | null }
export interface MacroDataStatus {
  slots: MacroSlot[]; slots_filled: number; serving: 'uploads' | 'snapshot_file'
  snapshot_built_at: string | null; last_build: MacroBuild | null
  prices: { tickers: number; newest_fetched_at: string | null }
}

export class MacroUploadError extends ApiError {
  readonly unlocksAt: string | null      // set for 429
}

export async function getMacroData(): Promise<MacroDataStatus>                   // GET /macro/data (GET retries apply)
export async function uploadMacroSlot(slotId: string, file: File, uploadedBy: string): Promise<MacroSlot>
export async function revertMacroSlot(slotId: string, revertedBy: string): Promise<MacroSlot>
export function macroTemplateUrl(slotId: string): string                        // `${VITE_API_URL}/macro/templates/${slotId}`
export function macroTemplatesZipUrl(): string                                    // `${VITE_API_URL}/macro/templates.zip`
```

- **`uploadMacroSlot`** cannot use `request()`, which JSON-encodes the body. It calls `fetch`
  directly:
  - `POST ${VITE_API_URL}/macro/slots/${slotId}?uploaded_by=…&filename=…`, built with
    `URLSearchParams`;
  - `body: file`, header `Content-Type: application/octet-stream`;
  - **no retry.** A POST is never retried here; see `request()`'s comment.
  
  On a non-OK response it throws a `MacroUploadError`. Its message comes from `extractDetail`, or a
  generic message if there is none. `unlocksAt` comes from `detail.unlocks_at` on a 429, else
  `null`.
- **`revertMacroSlot`** uses `request()`, with the name in the query string.

```ts
// lib/macroData.ts — pure; every date function takes an optional IANA timeZone (default: the browser's)
export function formatShortDate(iso: string, timeZone?: string): string          // "25/11/26" (dd/mm/yy)
export function formatDateTime(iso: string, timeZone?: string): string           // "25/11/26 14:05" (24 h)
export function signoffText(version: MacroVersion, timeZone?: string): string
//   "Gunnar Balch uploaded this data on 25/11/26"
export function revertText(version: MacroVersion, timeZone?: string): string | null
//   "Sam reverted this on 26/11/26" when reverted_by is set, else null
export function gateText(gate: MacroGate, timeZone?: string): string
//   allowed && opens_window → "Open for upload"
//   allowed && !opens_window → "Corrections open until 25/11/26 13:00"   (window_closes_at)
//   !allowed → "Locked until 26/11/26 12:00"                             (locked_until)
export function dataThroughText(dataThrough: string | null): string | null        // "Data through 30/10/26"; null → null
export function formatBytes(bytes: number): string                                // 4100000 → "3.9 MB"; 5612 → "5.5 KB"
export function buildStatusText(status: MacroDataStatus, timeZone?: string): string
```

**`buildStatusText`, in priority order:**
1. If `last_build?.status === "failure"`:
   `"The last rebuild failed (<formatDateTime(started_at)>): <error>. The page still shows the previous data."`
2. If `slots_filled < 15`:
   `"<n> of 15 files uploaded. The page shows the 9 Nov snapshot until all 15 are in."`
3. If `serving === "uploads"`:
   `"Page built from the uploaded files on <formatDateTime(snapshot_built_at)>."`
4. Otherwise: `"All 15 files uploaded. The page will rebuild shortly."`

`data_through` is a date (`YYYY-MM-DD`). Format it without time-zone conversion: split the string;
don't construct a `Date`.

### The dialog

```tsx
export function MacroDataDialog(props: {
  open: boolean
  onClose: () => void
  onSnapshotChanged: () => void   // snapshot_built_at changed while the dialog was open
}): JSX.Element | null
```

- **Shell.** Use the house dialog shell from `NewPortfolioDialog`: the `fixed inset-0 bg-overlay`
  backdrop, `role="dialog"`, `aria-modal`, `aria-labelledby`, a `max-h-[85vh]` scrolling card, and
  `max-w-3xl`.
  - **No `onClick` on the backdrop.** Copy 0198's one-line comment and adapt it to drag-and-drop.
  - Escape closes it.
  - A close (×) button sits top-right.
- **Header.** The title is "Macro data". Under it, at the right:
  - a **Sample data** `<a>` with `<DownloadIcon />`, `href={macroTemplatesZipUrl()}` and the
    `download` attribute, styled like Universe's "Download Universe" link;
  - a one-line note: "Templates with the real layout and made-up numbers. Fill them from your
    FactSet, Bloomberg and S&P Global exports."
- **Name.**
  - A labelled "Your name" text input, `maxLength={60}`. Its value is persisted in
    `localStorage['blue-eagle.macro-signoff-name']` and restored on open.
  - Uploads and reverts are refused client-side with the row message "Enter your name above
    first." while the name is blank after trimming.
- **Status line.** `buildStatusText(data)`, plus `"<tickers> constituent prices, last fetched
  <formatShortDate(newest_fetched_at)>"`, or "No constituent prices yet" when there are none.
- **Rows.**
  - Grouped under three small headings:
    - **"Earnings estimates · FactSet":** `cy1`, `cy2`;
    - **"Macro series · Bloomberg, S&P Global":** `macro`, `pmis`;
    - **"ETF holdings · FactSet":** the 11 `cons_*`.
  
    Keep API order within each group.
  - Each row shows:
    - **Left:**
      - `label`, then `source` in muted text;
      - the live version's `signoffText`, `dataThroughText`, `filename` and `formatBytes(size)`,
        or "Not uploaded yet";
      - `gateText(gate)`, colored muted when open and amber when in the correction window
        (`text-amber-600` or the theme's warning token, if one exists).
    - **Right:**
      - the **drop zone**, a dashed-border box reading "Drop .xlsx here or click to choose". It
        is backed by a hidden `<input type="file" accept=".xlsx">`. It is highlighted on
        `dragover`, and disabled while that row is uploading or when `gate.allowed` is false
        (then it shows "Locked");
      - beside it, a small "Template" link (`macroTemplateUrl(id)`, `download`).
    - **Under the row:**
      - **Revert:** a button enabled only when `can_revert`. The first click turns it into
        "Confirm revert"; the second performs the revert. Copy the two-step pattern from
        `NewPortfolioDialog`'s Delete. The confirmation resets when the row changes.
      - **History:** a "History (n)" toggle. It lists every version, newest first, with
        `signoffText`, `revertText` when present, `filename` and a "live" marker.
- **Upload flow, per row.**
  - Exactly one file is required. A drop of 0 files or more than 1 shows "Drop one file." A
    non-`.xlsx` name shows "Choose an .xlsx file." Both are refused before any request.
  - While a row uploads, show the spinner (the classes `SweepIndicator` uses) and "Uploading… large
    workbooks take up to a minute". **Other rows stay usable.**
  - On success, refetch `getMacroData()` and show a transient "Uploaded" on that row.
  - On `MacroUploadError`, show its message in `text-brand-negative` under the row. For a 429, show
    `"Locked until <formatDateTime(unlocksAt)>"`.
- **Refresh.**
  - Fetch `getMacroData()` on open.
  - While the dialog is open, poll it every 15 s with `setInterval`, cleared on close and unmount.
  - If `snapshot_built_at` differs from the value seen at the first fetch after opening, call
    `onSnapshotChanged()` once per change.
- **Errors.**
  - A 503 from `getMacroData` shows "Uploads are unavailable: the server has no database."
  - Any other fetch error shows its message, with a Retry button.

### Macro page

- **The Data button** goes in the title row, right-aligned: the title block stays left, the button
  sits right (`flex items-end justify-between`, as on Universe). It reads "Data" and uses the same
  button style as Universe's Filters button. It opens the dialog.
- **Reloading.** `onSnapshotChanged` re-fetches the scorecard. The module-level
  `cachedLoader(getMacroScorecard)` caches forever, so give the page a way to bypass it: for
  example, keep the cached loader for mount and call `getMacroScorecard()` directly on reload.
  Then `setState` with the new data. The backend's ETag makes this cheap.

## Tooltips — required

Every interactive element gets a `Tooltip` describing its effect. Never use `title`.

| Element | Tooltip label |
|---|---|
| Data button | "Download sample data and upload new files to update this page" |
| Sample data link | "Download templates for all 15 files: the real layout with made-up numbers" |
| Close (×) | "Close" |
| Your name input | "Your name is shown next to every upload and revert you make" |
| Drop zone (enabled) | "Upload a new version of this file. The page rebuilds once all 15 files are in" |
| Drop zone (locked) | "This file was updated recently. New uploads open again at the time shown" |
| Template link | "Download a template for this file only" |
| Revert | "Put the previous version back. You can do this at any time" |
| Confirm revert | "Click again to put the previous version back" |
| History toggle | "Show every stored version of this file" |
| Retry | "Try loading the upload status again" |

## Out of scope

- Any backend change, and the price downloader button (next contract).
- Uploading several files at once into a bulk drop zone.
- Showing the rebuild's full traceback. `error` is already its last line.
- Unit tests for React components. There is no render-test setup; the pure helpers carry the tests.

## Acceptance criteria

1. `frontend/src/lib/macroData.test.ts` uses `timeZone: "UTC"` and literal inputs:
   - a. `formatShortDate("2026-11-25T13:05:00Z", "UTC") === "25/11/26"`.
     `formatDateTime("2026-11-25T13:05:00+00:00", "UTC") === "25/11/26 13:05"`. **Both ISO forms
     appear in the API (`Z` and `+00:00`), so test both.**
   - b. `signoffText` with `uploaded_by: "Gunnar Balch"`, `uploaded_at: "2026-11-25T13:05:00Z"`
     gives `"Gunnar Balch uploaded this data on 25/11/26"`. `revertText` gives `null` when
     `reverted_by` is null, and `"Sam reverted this on 26/11/26"` for
     `reverted_by: "Sam"`, `reverted_at: "2026-11-26T09:00:00Z"`.
   - c. `gateText` for each of the three gate shapes, with literal gate objects and the exact
     strings above.
   - d. `dataThroughText("2026-10-30") === "Data through 30/10/26"`, and
     `dataThroughText(null) === null`.
   - e. `formatBytes(4100000) === "3.9 MB"`, `formatBytes(5612) === "5.5 KB"`,
     `formatBytes(900) === "900 B"`.
   - f. `buildStatusText`, one literal `MacroDataStatus` per branch (1–4). Assert the exact
     strings, including that branch 1 wins even when `slots_filled === 15`.
2. `grep -c "event.target === event.currentTarget" frontend/src/components/MacroDataDialog.tsx`
   prints `0`.
3. `grep -c "title=" frontend/src/components/MacroDataDialog.tsx` prints `0`.
   `grep -c "<Tooltip" frontend/src/components/MacroDataDialog.tsx` is at least `10`.
4. `awk 'length > 300' frontend/src/components/MacroDataDialog.tsx frontend/src/pages/MacroPage.tsx`
   prints nothing. Coders have collapsed large TSX files before. If it prints anything, run
   `node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write` on
   **only** the files this contract creates or edits, and re-check.
5. From `frontend/`:
   - `npx vitest run` passes. The baseline is 495; report the new total.
   - `npm run build` exits 0.
   - `npx oxlint` shows no warning in any file this contract creates or edits, beyond the 2
     baseline warnings (`UniversePage.tsx`, `HelpSidebar.tsx`).
6. **Planner-run render check.** With Gunnar's dev servers running:
   `SMOKE_PATH=/macro SMOKE_CLICKS="Data" node contracts/tools/smoke-render.mjs macro`. It shows
   no uncaught exception, and PAGE TEXT includes "Macro data", "Sample data", "Your name",
   "Earnings estimates" and "ETF holdings".

`BLOCKED` is the correct answer to a criterion that cannot be satisfied as written.

## Verification to run and paste

Paste the **complete, verbatim** output of each command.

```bash
cd /Users/gunnarbalch/WebstormProjects/blue-eagle
grep -c "event.target === event.currentTarget" frontend/src/components/MacroDataDialog.tsx
grep -c "title=" frontend/src/components/MacroDataDialog.tsx
grep -c "<Tooltip" frontend/src/components/MacroDataDialog.tsx
awk 'length > 300' frontend/src/components/MacroDataDialog.tsx frontend/src/pages/MacroPage.tsx | wc -l
cd frontend && npx vitest run 2>&1 | tail -4; npm run build >/tmp/build.out 2>&1; echo "build exit=$?"; npx oxlint
```

Report every file you edited or created. Do not launch a browser.

## Human verification — does Gunnar need to run anything?

**Run the frontend and look at it**, with the local backend running. Your local backend uses the
production database, so **uploads here are real**.
1. Open `/macro` and click **Data**. The dialog opens. Clicking the dimmed area does nothing;
   Escape closes it.
2. Click **Sample data**. A zip with 15 `*_sample.xlsx` files downloads.
3. Type your name. Drag a real file (for example `EWJCONS.xlsx`) onto **Japan holdings**. The row
   shows your sign-off with today's date, and the lock text changes to "Corrections open
   until …". **If you ran `macro_upload_all.sh` more than an hour ago, every slot is locked
   until 24 h after that run.** The drop zone then shows "Locked" with the unlock time. That is
   correct behaviour, not a bug.
4. Drag the same file onto **U.S. holdings**. A red message says it doesn't look like the U.S.
   holdings file.
5. Revert the Japan row: click **Revert**, then **Confirm revert**. The previous version becomes
   live. If it was the only version, Revert is disabled instead.
6. Check at about 375 px wide that the rows stack and the drop zones stay usable.

## Open questions

None.
