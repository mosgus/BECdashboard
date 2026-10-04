# Contract 0155 — Ops page: passkey-gated Admin section

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Add an **Admin** card at the very bottom of `/ops`, below Job history.

- **Locked (the default).** The card shows only its header row: the title "Admin" and an
  **Admin** button. There is no body.
- **Unlocking.** Clicking the button opens a modal dialog that asks for a passkey.
  - The user submits with **Enter** or the **Confirm** button.
  - A correct passkey closes the dialog and expands the card.
  - A wrong passkey keeps the dialog open, shows an inline error, then clears and re-focuses the
    field.
- **Cancelling.** Cancel, Escape or a backdrop click closes the dialog without unlocking.
- **Staying unlocked.** The unlock lasts for the browser tab's session (`sessionStorage`). A
  reload keeps it unlocked; a new tab or browser starts locked again.
- **Locking again.** Once expanded, the header shows a **Lock** button that collapses the card and
  clears the stored flag.

The passkey is hard-coded as `london`. **This is a UI gate, not security.** The string ships in the
JS bundle, and every `/ops` API endpoint stays as open as it is now. Gunnar has accepted that.

There are no admin tools yet. When unlocked, the body is a single placeholder line. Later
contracts will move tools in.

## Files

Create:
- `frontend/src/lib/admin.ts`
- `frontend/src/lib/admin.test.ts`
- `frontend/src/components/AdminPasskeyDialog.tsx`
- `frontend/src/components/AdminSection.tsx`

Modify:
- `frontend/src/pages/OpsPage.tsx`. Add one import, and add `<AdminSection />` as the last child
  of the `flex flex-col gap-6` div, after `<JobRunsCard … />`. Change nothing else in that file.

Touch nothing else. In particular, make no backend change and don't touch the other dialogs.

## `lib/admin.ts`

Write pure, testable helpers. Copy the guarded-storage style of `lib/theme.ts`, where
`readStoredPreference` and `storePreference` wrap storage access in try/catch.

```ts
export const ADMIN_PASSKEY = 'london'
export const ADMIN_UNLOCKED_KEY = 'blue-eagle.admin-unlocked'

/** Trims surrounding whitespace; otherwise an exact, case-sensitive match. */
export function isAdminPasskey(input: string): boolean

/** True only when sessionStorage holds '1' under ADMIN_UNLOCKED_KEY. False when storage throws or is absent. */
export function readAdminUnlocked(): boolean

/** true → setItem(key, '1'); false → removeItem(key). Swallows storage errors. */
export function storeAdminUnlocked(unlocked: boolean): void
```

Add a short comment above `ADMIN_PASSKEY`. It must say that this is a client-side gate only,
that the value is visible in the bundle, and that a real check must happen on the server.

## `lib/admin.test.ts`

Vitest runs in its default node environment, where there is no `sessionStorage`. Use
`vi.stubGlobal('sessionStorage', fake)`, where `fake` is a small `Map`-backed object, and call
`vi.unstubAllGlobals()` in `afterEach`.

Cover:
1. `isAdminPasskey('london')` and `isAdminPasskey('  london  ')` are true.
2. `isAdminPasskey('London')`, `isAdminPasskey('')` and `isAdminPasskey('londonx')` are false.
3. `readAdminUnlocked()` is false with empty storage. It is true after
   `storeAdminUnlocked(true)`, and false again after `storeAdminUnlocked(false)`.
4. With a `sessionStorage` whose `getItem` and `setItem` throw, `readAdminUnlocked()` is false
   and `storeAdminUnlocked(true)` does not throw.

## `AdminPasskeyDialog.tsx`

Props: `{ onCancel: () => void; onUnlock: () => void }`.

Mirror `NewPortfolioDialog`'s structure:
- the backdrop is `fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]`, and
  clicking it (the target is `currentTarget`) calls `onCancel`;
- the panel has `role="dialog"`, `aria-modal="true"` and `aria-labelledby`, with the same card
  classes but `max-w-sm`;
- a `document` keydown listener calls `onCancel` on Escape, and is removed when the component
  unmounts.

Contents:
- the heading "Admin access";
- a `<form onSubmit>`, so that Enter submits;
- a `type="password"` input with `autoFocus`, `aria-label="Passkey"`,
  `placeholder="Passkey"` and `autoComplete="off"`;
- the error line, styled `text-xs text-brand-negative`, shown only after a failed attempt:
  `Incorrect passkey.`;
- a footer with **Cancel** (`type="button"`) and **Confirm** (`type="submit"`). Copy the button
  classes from `NewPortfolioDialog`'s Cancel and Create buttons.

On submit:
1. Call `event.preventDefault()`.
2. If `isAdminPasskey(value)`, call `onUnlock()`.
3. Otherwise, set the error, clear the value and re-focus the input through a ref.

Disable Confirm while the field is empty. Don't log or store the typed value anywhere.

## `AdminSection.tsx`

- **State:**
  - `unlocked`, initialised lazily with `useState(readAdminUnlocked)`;
  - `dialogOpen`.
- **Card:** `bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5`, the
  same `CARD` string `OpsPage` uses.
- **Header row:** the same layout as `SystemHealthCard`'s, with `<h2>` "Admin" and the
  button(s) on the right.
- **Locked:**
  - the header shows an **Admin** button that opens the dialog, using `SystemHealthCard`'s
    small-button classes;
  - wrap the button in `<Tooltip label="Enter the admin passkey to show admin tools">`;
  - there is no body.
- **Unlocked:**
  - the header shows a **Lock** button that calls `storeAdminUnlocked(false)` and sets `unlocked`
    to false;
  - its tooltip is "Hide admin tools until the passkey is entered again";
  - the body is `<p className="text-sm text-[var(--color-muted)]">No admin tools yet.</p>`.
- **`onUnlock`:** call `storeAdminUnlocked(true)`, set `unlocked` to true, and close the dialog.
- **Dialog:** render `<AdminPasskeyDialog …/>` only while `dialogOpen` is true. Unmounting it
  resets its field and error.
- **Margin:** the locked header row must not leave an empty bottom margin. Only give the header
  `mb-4` when unlocked.

## Formatting

Run Prettier on the **four new files only**:

`node /tmp/prettier3/bin/prettier.cjs --print-width 120 --single-quote --no-semi --write <the 4 new files>`

If `/tmp/prettier3` is missing, report that instead of hand-formatting. **Never run Prettier on
`OpsPage.tsx`.**

## Out of scope

- A server-side passkey.
- Protecting `/ops` endpoints.
- Moving Force update or any other tool into Admin.
- Rate-limiting wrong attempts.
- Remembering the unlock across tabs.
- DOM or component tests. There is no testing-library in this repo; don't add dependencies.

## Acceptance criteria

Run these in bash from `frontend/`.

1. `npx vitest run` passes. The baseline is **312**; after this contract it is 312 plus the number
   of tests in `admin.test.ts`. Paste both numbers.
2. `npx tsc -p tsconfig.app.json --noEmit` is clean.
3. `npm run lint` shows only the 2 known warnings (HelpSidebar, UniversePage).
4. `npm run build` succeeds.
5. `awk 'length > 300' src/lib/admin.ts src/components/AdminPasskeyDialog.tsx src/components/AdminSection.tsx`
   prints nothing.
6. `grep -n "<AdminSection" src/pages/OpsPage.tsx` prints 1 line.
7. `grep -rn "'london'" src` prints exactly 1 line, which is in `src/lib/admin.ts`.

`BLOCKED` is a valid answer. Report every deviation, including any class or text choices that
differ from this contract.

## Human verification (Gunnar)

On `/ops`:
1. **Fresh tab.** Admin is a header-only card below Job history.
2. **Wrong key.** Press Admin and type `nope`, then Enter. You see "Incorrect passkey.", the
   field is empty and the dialog stays open.
3. **Correct key.** Type `london` and press Confirm. The dialog closes and "No admin tools yet."
   appears.
4. **Reload.** The card stays unlocked. In a new tab it is locked.
5. **Lock.** Press Lock and the card collapses.
6. **Cancelling.** Escape and a backdrop click both close the dialog without unlocking.

## Open questions

None. These defaults were chosen by the planner and can be changed:
- the unlock lasts per tab (`sessionStorage`), not forever;
- the passkey match is case-sensitive, with surrounding whitespace trimmed;
- the unlocked body is a placeholder.
