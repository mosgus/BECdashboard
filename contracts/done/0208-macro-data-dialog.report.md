# Report — Contract 0208 (Macro Data dialog)

## Audit

**Accepted, 2026-11-25 (planner).** I re-ran the checks myself:
- the grep criteria give 0 / 0 / 10, and no line is over 300 characters;
- vitest passes 513;
- the build exits 0;
- oxlint shows only the 2 baseline warnings.

**The tooltip count is legitimate.** The contract's table lists the enabled and locked drop zone, and Revert and Confirm revert, as separate labels. The ten `<Tooltip>`s are exactly the dialog-side rows of that table.

**Planner-run render check.** The dev frontend ran against a planner-started backend on :8000 backed by a **throwaway SQLite database**, never production. It was stopped afterwards.
- `SMOKE_PATH=/macro SMOKE_CLICKS="Data"`: the dialog opened with "Macro data", Sample data, Your name, the status line "0 of 15 files uploaded…", "No constituent prices yet", all three group headings, and 15 rows showing "Not uploaded yet" / "Open for upload".
- **A real upload through the dialog's own file input** (a `DataTransfer` file with the EWJ template, in a `change` event) produced on the Japan row: "Planner render check uploaded this data on 25/11/26 · EWJCONS.xlsx · 5.5 KB | Corrections open until 25/11/26 13:56". The name was persisted to `localStorage`.
- **The EWJ file uploaded to the U.S. slot** showed "This doesn't look like the U.S. (SPX) holdings file." under that row, and the slot stayed "Not uploaded yet".

`contracts/tools/smoke-render.mjs` gained `SMOKE_PATH` and an awaited `SMOKE_EVAL` (`awaitPromise`) for this check.

**The coder's judgment calls are good:**
- the dialog swallows `dragover`/`drop` so a near-miss drop doesn't make the browser navigate to the file;
- a sequence counter guards against out-of-order polls;
- the revert confirmation is bound to the live version's id.

**Not covered by the render check:**
- a real mouse drag;
- the 375 px layout;
- dark mode.

Those are in Gunnar's human-verification steps.
