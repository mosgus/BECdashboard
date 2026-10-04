# Contract 0158 — Admin → Presets: cards, create, edit, delete

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

When the Admin card on `/ops` is unlocked, replace its "No admin tools yet." line with a
**Presets** section:
- **Header.** A "Presets" heading with a **Create preset** button on the right.
- **Cards.** A grid with one card per preset, showing:
  - its name;
  - its description, in muted text;
  - a bullet list of its first 3 holdings;
  - a final `…` bullet when it has more than 3.
- **Editing.** Clicking a card opens `NewPortfolioDialog` in a new **preset-edit mode**,
  pre-filled with the preset.
  - The admin can change weights, share counts, cash, name and description, and add or remove
    assets.
  - **Save** writes the preset with `PUT /presets/{id}`.
  - **Delete** removes it with `DELETE`. It takes two clicks: Delete, then Confirm delete.
- **Creating.** Create preset opens the same dialog empty. Its Save calls `POST /presets`.

Contracts 0156 and 0157 already provide the API and the client functions `getPresets`,
`createPreset`, `updatePreset` and `deletePreset`, plus the `Preset` and `PresetInput` types in
`api/client.ts`. Don't change `client.ts`.

## The rule that protects real allocations

When an existing preset loads, `parsePortfolioCsv(csv, holdableUniverseTickers)` drops any ticker
that isn't holdable in the Universe. If Save were allowed afterwards, those holdings would be
permanently deleted from the preset. So:

> **In edit mode, Save is disabled whenever the initial load dropped any ticker.** Show:
> `This preset holds tickers that are not in your Universe ({tickers, comma-separated}). Add them to the Universe before editing, or delete the preset.`

Only the **initial load** of an existing preset sets this block. A CSV imported later inside a
"New preset" dialog keeps today's behaviour: skipped rows are reported, not blocking.

## Files

Create:
- `frontend/src/lib/presetPreview.ts`
- `frontend/src/lib/presetPreview.test.ts`
- `frontend/src/components/PresetsAdmin.tsx`

Modify:
- `frontend/src/lib/portfolio.ts`: add one exported pure function, below.
- `frontend/src/lib/presets.test.ts`: add 2 round-trip tests.
- `frontend/src/components/NewPortfolioDialog.tsx`: edit mode, below.
- `frontend/src/components/AdminSection.tsx`: replace the placeholder `<p>` with
  `<PresetsAdmin />`.

Touch nothing else, and make no backend change.

## 1. `lib/portfolio.ts` — `buildDraftPortfolio`

Move the body of the dialog's `handleCreate` into an exported pure function. It must return
exactly the `Portfolio` that `handleCreate` builds today:

```ts
/** The Portfolio a valid draft produces, or null when the draft cannot be created. Shared by
 *  New Portfolio's Create and the preset editor's Save so both serialise identically. */
export function buildDraftPortfolio(
  name: string,
  mode: EntryMode,
  summary: DraftSummary,
  byTicker: Map<string, UniverseEntry>,
  id: string,
  updatedAt: string,
): Portfolio | null
```

- It returns `null` when `!summary.canCreate || summary.cashWeight === null`.
- Otherwise it builds the positions, the trimmed name, `cashWeight`, `id`, `updatedAt`, and the
  `creationCashDollars` spread, exactly as `handleCreate` does now.

`handleCreate` then becomes a call to
`buildDraftPortfolio(name, mode, summary, byTicker, crypto.randomUUID(), new Date().toISOString())`,
followed by `onCreate?.(portfolio)` when the result isn't null. Its behaviour must not change.

## 2. `lib/presetPreview.ts`

```ts
export interface PresetPreview { ok: boolean; lines: string[]; more: number }

/** The first `limit` holdings of a preset CSV, for its admin card. */
export function presetPreview(csv: string, limit = 3): PresetPreview
```

- **Parse.** Use `parsePortfolioCsv(csv, ownTickers)`, where `ownTickers` is the set of
  first-column values from every data line, uppercased and trimmed, excluding blanks and `CASH`.
  This is the same approach as `tickersOf` in `presets.test.ts`. A preview ignores the Universe.
- **When parsing fails**, return `{ ok: false, lines: [], more: 0 }`.
- **Weight mode.** Each line is `` `${ticker} · ${formatPercent(Number(row.weight))}` ``.
- **Shares mode.** Each line is `` `${ticker} · ${row.shares} sh` ``.
- **Order and count.** Keep the rows in seed order. `more` is the number of rows beyond `limit`.

### `lib/presetPreview.test.ts` (+4)

Use these literal inputs, copied from the fixtures in `presets.test.ts`:
1. The Gunnar weights CSV gives `ok: true`,
   `lines: ['MU · 74.18%', 'VOO · 10.10%', 'PBR · 6.82%']` and `more: 3`.
2. The BEC shares CSV gives `lines: ['XLK · 184 sh', 'XLP · 559 sh', 'XLV · 410 sh']` and
   `more: 5`.
3. `'ticker,weight_pct,shares\nAAPL,60,\nMSFT,40,\nCASH,0,\n'` gives 2 lines and `more: 0`.
4. `'nonsense'` gives `{ ok: false, lines: [], more: 0 }`.

## 3. `presets.test.ts` — round-trip tests (+2)

These prove that Save doesn't corrupt a seeded preset. For each `FIXTURES[n]`, do the following:
1. Parse it with `tickersOf`.
2. Convert the seed to a draft. Use the same `rows.map((row) => ({ ...row, id: row.ticker }))`
   pattern as the existing createable test.
3. Run `summariseDraft` with a `byTicker` whose entries are
   `{ ticker, last_close: 100, quote_type: 'EQUITY' } as UniverseEntry`.
4. Call `buildDraftPortfolio(...)` with id `'x'` and updatedAt `'2026-10-03T00:00:00Z'`, then
   `serializePortfolioCsv`, then parse again.

Then check:
- **Gunnar Preset (weight mode):** the mode is still `'weight'`, the tickers come back in the same
  order, each re-parsed weight is within `1e-9` of the original, and the cash is unchanged.
- **BEC Portfolio (shares mode):** the mode is still `'shares'`, every `Number(shares)` is equal,
  and `Math.abs(Number(cash) - 292406.58) < 1e-6`.

If either check fails, that is a real finding. Report it and **stop. Don't weaken the assertion.**

## 4. `NewPortfolioDialog.tsx` — preset-edit mode

Gunnar hand-formats this file, so **don't run Prettier on it**. Keep the edits targeted.

### Props

- Make `onCreate` optional.
- Add `presetEdit` to the props:

```ts
presetEdit?: {
  /** null = creating a new preset. */
  initial: Preset | null
  onSave: (input: PresetInput) => Promise<void>
  /** null hides Delete (new preset). */
  onDelete: (() => Promise<void>) | null
}
```

**When `presetEdit` is absent, the dialog must render and behave exactly as today.**

### Initial load

Don't use an effect for this, because the `set-state-in-effect` lint rule flags it. Use one lazy
initializer, declared before the other state:

```ts
const [initialLoad] = useState(() =>
  presetEdit?.initial
    ? parsePortfolioCsv(presetEdit.initial.csv, new Set(universe.filter((e) => isHoldableType(e.quote_type)).map((e) => e.ticker)))
    : null,
)
```

Then initialise the existing state from it:
- When `initialLoad?.ok`:
  - `name` comes from `presetEdit.initial.name`;
  - `mode` and `cashText` come from the seed;
  - `rows` come from the seed rows, each with a fresh `crypto.randomUUID()` id;
  - `droppedRows`, `adjustment` and `zeroTargets` come from the result, using the same fields
    `handlePresetSelection` reads.
- When `initialLoad` exists but isn't ok:
  - set `importError` to `` `This preset could not be read: ${error}` ``;
  - set `loadFailed` (a `const` derived from `initialLoad`) to true;
  - leave the rest empty.
- **Description.** Add a `description` state, initialised from
  `presetEdit?.initial?.description ?? ''`.
- **Blocked tickers.** Derive
  `const blockedTickers = initialLoad?.ok ? initialLoad.dropped.map((row) => row.ticker) : []`.

### Rendering, in preset mode only

- **Heading:** `Edit preset` when `initial` is set, and `New preset` when it isn't.
- **Description field.** Add a description `<input>` directly below the name input: placeholder
  `Description (optional)`, `maxLength={200}`, and the same `FIELD` classes. Wrap it in a Tooltip
  labelled `One line shown beside the preset name`.
- **Hide the reopen hint.** The non-pristine `Reopen this dialog to import a CSV.` line is not
  shown in preset mode. The pristine import and picker row stays as it is.
- **Blocked message.** When `blockedTickers.length > 0`, show it in
  `text-xs text-brand-negative`.
- **Footer buttons**, which replace the Create portfolio button in preset mode:
  - **Delete**, shown only when `onDelete` isn't null.
    - The first click sets `confirmingDelete`, and the label becomes `Confirm delete`.
    - The second click runs `onDelete`.
    - Style it like Cancel, but with `text-brand-negative`.
  - **Save.** It is disabled when any of these is true:
    - `!summary.canCreate`;
    - `loadFailed`;
    - `blockedTickers.length > 0`;
    - `busy`.
  - **Cancel**, unchanged.

### Save and Delete

- **Save:**
  1. Build the portfolio with `buildDraftPortfolio(name, mode, summary, byTicker, presetEdit.initial?.id ?? 'new', new Date().toISOString())`.
  2. If the result is null, return.
  3. Set `busy` and clear `actionError`.
  4. Call `await presetEdit.onSave({ name: name.trim(), description: description.trim(), csv: serializePortfolioCsv(portfolio) })`.
- **Delete:** set `busy`, then call `await presetEdit.onDelete()`.
- **On error, for both:** set `actionError` to the `ApiError` message, or
  `'Could not save the preset.'` / `'Could not delete the preset.'`, and clear `busy`. Show
  `actionError` in the footer's existing `text-xs text-brand-negative` slot. Inside that slot,
  `actionError` takes priority over `summary.problem`.
- **On success**, set no state. The parent unmounts the dialog.

## 5. `PresetsAdmin.tsx`

State: `presets`, `universe`, and `editing`. The `editing` state is one of three values:
- `null`;
- `{ kind: 'new' }`;
- `{ kind: 'edit', preset: Preset }`.

**Loading.**
- On mount, load `getPresets()` and `getUniverse()` independently.
- Every `setState` happens inside promise callbacks, behind a `cancelled` guard set in the
  cleanup.
- Track each one as `'loading' | 'error' | ready data`.
- Write a `reloadPresets()` that refetches presets only.

**Layout.**
- **Header row:**
  - on the left, `<h3 className="text-sm font-semibold text-foreground">Presets</h3>`;
  - on the right, a **Create preset** button using `AdminSection`'s small `BUTTON` classes, with
    the tooltip `Make a new preset from scratch or from a CSV`. The button is disabled until the
    Universe is ready.
- **Body:**
  - while loading, `Loading…`;
  - if presets fail to load, `Could not load presets.`;
  - if there are no presets, `No presets yet.`;
  - if the Universe fails to load, show `Could not load the Universe, so presets cannot be edited.`
    and disable every card. All of these messages are `text-sm text-[var(--color-muted)]`.
- **Card grid:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`. Each card is a
  `<button type="button">` with
  `text-left border border-brand-border rounded-[var(--radius-card)] p-4 hover:bg-brand-border/40 disabled:opacity-50 disabled:cursor-not-allowed`.
  It contains:
  - the name, as `text-sm font-semibold text-foreground`;
  - the description, if non-empty, as `text-xs text-[var(--color-muted)] mt-0.5`;
  - a `<ul className="list-disc pl-5 mt-2 text-xs text-foreground">` of
    `presetPreview(preset.csv).lines`;
  - a final `<li className="list-none">…</li>` when `more > 0`;
  - or `Unreadable CSV` in muted text when the preview isn't ok.

  The card is still clickable when its CSV can't be read, so the preset can be deleted.
- **Dialog.** Render
  `<NewPortfolioDialog universe={universe} onCancel={() => setEditing(null)} presetEdit={…} />`
  while `editing` isn't null, with `key` set to the preset id or `'new'`.
  - **For `'new'`:** `onSave` calls `createPreset`, then `setEditing(null)` and
    `reloadPresets()`. `onDelete` is `null`.
  - **For `'edit'`:** `onSave` calls `updatePreset(preset.id, input)`, and `onDelete` calls
    `deletePreset(preset.id)`. Each then does `setEditing(null)` and `reloadPresets()`.
  - **Errors** are left for the dialog to catch. Don't catch them here.

## Formatting

Run Prettier only on the three new files:
`node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <the 3 new files>`.

Don't run it on any modified file.

## Out of scope

- Reordering presets.
- Duplicate-name checks.
- Server-side authentication.
- Changing how New Portfolio itself uses presets.
- Any backend change.

## Acceptance criteria

Run these in bash from `frontend/`.

1. `npx vitest run` passes. The baseline is 314; afterwards it is **320** (+4 preview, +2
   round-trip). Paste the totals.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean.
3. `npm run lint` shows only the 2 known warnings.
4. `npm run build` succeeds.
5. `awk 'length > 300' src/lib/presetPreview.ts src/lib/presetPreview.test.ts src/components/PresetsAdmin.tsx`
   prints nothing.
6. `grep -n "buildDraftPortfolio(" src/components/NewPortfolioDialog.tsx` prints 2 lines: Create
   and Save.
7. `grep -n "<PresetsAdmin" src/components/AdminSection.tsx` prints 1 line, and
   `grep -c "No admin tools yet" src/components/AdminSection.tsx` prints 0.
8. `grep -n "Add them to the Universe before editing" src/components/NewPortfolioDialog.tsx`
   prints 1 line.

**Don't call `POST`, `PUT` or `DELETE /presets` against `localhost:8000`.** It uses the
production database.

`BLOCKED` is a valid answer. Report every deviation, including class or copy changes.

## Human verification — Gunnar

These steps need migration 0009 applied.

1. **Cards.** Unlock Admin on `/ops`. You should see two cards:
   - Gunnar Preset: MU, VOO, PBR, then `…`;
   - BEC Portfolio: XLK, XLP, XLV, then `…`.
2. **Edit without changes.** Open BEC, change nothing and press Save. Reopen it and check that
   the share counts and the $292,406.58 cash are the same.
3. **Edit with a change.** Edit Gunnar Preset, change one weight and Save. In New Portfolio →
   preset picker, check that the change shows up.
4. **Create and delete.**
   - Create a throwaway preset and check that it appears as a card.
   - Delete it and check that Confirm delete is needed.
5. **Blocked save.** Remove a ticker that a preset holds from the Universe, then open that
   preset. Save should be disabled, with the message. Add the ticker back afterwards.

## Open questions

None.
