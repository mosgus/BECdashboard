# Contract 0157 — Presets: New Portfolio dialog reads them from the API

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Contract 0156 added `GET/POST/PUT/DELETE /presets`, backed by a `presets` table that is seeded
with the two presets currently hard-coded in `frontend/src/lib/presets.ts`. This contract has
four parts:
1. **API client.** Add typed client functions for all four endpoints. Contract 0158, the admin
   editor, uses the write functions; this contract only uses `getPresets`.
2. **Dialog.** `NewPortfolioDialog` loads its preset picker from `GET /presets` instead of the
   `PRESETS` constant.
3. **Remove the hard-coded list.** Delete `frontend/src/lib/presets.ts`.
4. **Tests.** Keep the parser tests in `presets.test.ts`, using literal fixtures instead of
   `PRESETS`.

The user-visible behaviour stays the same, with one exception. If the presets request fails, or
returns no presets, the picker is not rendered at all. Import CSV stays available either way.

## Files

Modify:
- `frontend/src/api/client.ts`
- `frontend/src/components/NewPortfolioDialog.tsx` (small edits only; see below)
- `frontend/src/lib/presets.test.ts`

Delete:
- `frontend/src/lib/presets.ts`. After your change, check that nothing else imports it:
  `grep -rn "lib/presets'\|from './presets'" frontend/src` must print nothing.

Touch nothing else, and make no backend change.

## `client.ts`

1. **Add `'PUT'` to the method type.** Widen `RequestOptions.method` to
   `'GET' | 'POST' | 'PUT' | 'DELETE'`. The retry logic stays GET-only. Extend its comment by one
   clause: PUT is not retried either.
2. **Add the preset types:**
   ```ts
   export interface Preset {
     id: string
     name: string
     description: string
     /** Canonical Blue Eagle portfolio CSV; parse with parsePortfolioCsv. */
     csv: string
     created_at: string
     updated_at: string
   }
   export interface PresetInput { name: string; description: string; csv: string }
   export interface PresetsResponse { presets: Preset[] }
   ```
3. **Add the client functions.** Follow the style of the neighbouring universe functions:
   - `getPresets(): Promise<PresetsResponse>` calls `GET /presets`.
   - `createPreset(input: PresetInput): Promise<Preset>` calls `POST /presets`.
   - `updatePreset(id: string, input: PresetInput): Promise<Preset>` calls `PUT /presets/${encodeURIComponent(id)}`.
   - `deletePreset(id: string): Promise<void>` calls `DELETE /presets/${encodeURIComponent(id)}`.

   **The DELETE returns 204 with an empty body.** Read how `request` parses response bodies
   before writing `deletePreset`. If `request` would call `JSON.parse('')` or `response.json()`
   on a 204, make it return `undefined` for a 204. That change must not affect any other status,
   and you must state in your report which approach you took.

## `NewPortfolioDialog.tsx`

Gunnar hand-formats this file, so **don't run Prettier on it**. Make only these edits:
- **Imports.** Remove `import { PRESETS } from '../lib/presets'`. Import `getPresets` and
  `type Preset` from `../api/client`.
- **State.** Add `const [presets, setPresets] = useState<Preset[]>([])`.
- **Loading.** Add a mount effect that calls `getPresets()`.
  - On success, call `setPresets(response.presets)`.
  - On failure, leave the list empty, swallow the error and log nothing.
  - Guard against setting state after unmount with a `cancelled` flag that the cleanup sets.
  - Every `setState` must happen inside the promise callbacks, never synchronously in the
    effect body. The `set-state-in-effect` lint rule flags the synchronous form.
- **Selection.** In `handlePresetSelection`, change `PRESETS.find` to `presets.find`.
- **Rendering.**
  - In the picker JSX, change `PRESETS.map` to `presets.map`.
  - Render the preset `<Tooltip><select>…</select></Tooltip>` only when `presets.length > 0`.
  - The Import CSV label stays as it is.

Change nothing else.

## `presets.test.ts`

Replace the `PRESETS` import with a local literal `const FIXTURES: Preset[]`, where `Preset` is
imported as a type from `../api/client`.
- **The two entries** are the same two presets, copied character for character from the current
  `presets.ts` before you delete it:
  - the ids, names, descriptions and CSV text all match;
  - add `created_at: '2026-09-01T00:00:00+00:00'` and
    `updated_at: '2026-09-01T00:00:00+00:00'` to the first, and the same with `2026-09-29` to
    the second.
- **Replace `PRESETS[n]`** with `FIXTURES[n]` throughout.
- **Delete two tests**, because they pinned the shipped constant, which no longer exists:
  - `ships exactly the supplied preset`;
  - `uses unique, non-empty ids`.
- **Keep the other five tests** unchanged in behaviour. Update the `describe` title or comments
  so they say these are the seeded presets' CSV shapes. Use the word "seeded"; criterion 6
  greps for it.

## Out of scope

- The admin editor (contract 0158).
- Backend changes.
- Caching presets across dialog openings.
- Showing a loading indicator for the picker.

## Acceptance criteria

Run these in bash from `frontend/`.

1. `npx vitest run` passes. The baseline is 316; afterwards it is **314**, because two pinned
   tests were removed. Paste the totals.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean.
3. `npm run lint` shows only the 2 known warnings.
4. `npm run build` succeeds.
5. `test ! -e src/lib/presets.ts && echo gone` prints `gone`, and
   `grep -rn "lib/presets'\|from './presets'" src` prints nothing.
6. `grep -c "seeded" src/lib/presets.test.ts` prints at least 1.
7. `grep -n "presets.length > 0" src/components/NewPortfolioDialog.tsx` prints 1 line.
8. `grep -rn "74.1847583834589" src` prints exactly 1 line, which is in
   `src/lib/presets.test.ts`. This checks that the fixtures were copied and that no copy of the
   preset data is left in the app code.

**Live check (optional).** This is a read-only GET. Run
`curl -s localhost:8000/presets | head -c 300`. A 500 or a missing table is expected until
Gunnar applies migration 0009, so report what you see. **Don't run migrations, and don't call the
write endpoints against localhost**, because that backend uses the production database.

`BLOCKED` is a valid answer. Report every deviation.

## Human verification — Gunnar

1. **Apply migration 0009 first**, then confirm that `/ops/status` shows revision `0009`.
2. **Locally.** Open New Portfolio and check that the preset picker lists Gunnar Preset and BEC
   Portfolio, and that selecting each fills the draft exactly as before.
3. **Deploy order.** Deploy only after step 1. Before then, the picker is just hidden; nothing
   breaks.

## Open questions

None.
