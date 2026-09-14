# Report — Contract 0009

**Outcome:** COMPLETE
**Agent:** sonnet

## What I did

- `frontend/src/pages/LaunchPage.tsx` (new) — the previous `App.tsx` body, moved verbatim minus the `<Header />` call (which now renders once, outside `Routes`, in the new `App.tsx` shell). Same hero, same four `EntryCard`s, same classes, same copy.
- `frontend/src/pages/UniversePage.tsx` (new) — `useState`/`useEffect`, no data-fetching library. Four states (`loading`/`error`/`ready` with `entries.length === 0` for empty/`ready` populated). A `503` (`ApiError.status === 503`) gets the specific "Database not configured…" message; anything else (including a fully-unreachable backend, which fails at the network layer before any status code exists) falls back to the generic error message.
- `frontend/src/components/AddTickerForm.tsx` (new) — uppercase-styled input (`maxLength={10}`, `spellCheck={false}`), disabled while submitting or empty/whitespace, `Adding…` while in flight, clears and calls `onAdded()` (a refetch trigger, not a local splice — see below) on success, shows the caught error inline while keeping the typed value on failure.
- `frontend/src/components/UniverseTable.tsx` (new) — the eleven columns in the specified order/alignment/hide-breakpoints, per-ticker in-flight tracking via a `Set<string>` (not a page-wide boolean), row-patch-in-place after a successful refresh (`onRowRefreshed`, no refetch). See the table-layout fix below — this went through two real iterations, not one.
- `frontend/src/lib/format.ts` (new) — the six functions exactly as specified.
- `frontend/public/_redirects` (new) — one line, `/*    /index.html   200`.
- `frontend/package.json` — `react-router-dom` added, nothing else (confirmed via `git diff`).
- `frontend/src/App.tsx` — now the router shell only, exactly the structure given in the contract.
- `frontend/src/components/Header.tsx` — one line changed: `<NavItem label="Universe" to="/universe" />`. `Portfolios`, `Research`, and the gear are untouched — no `to`, still inert.
- `frontend/src/components/NavItem.tsx` — extended with the optional `to` prop; `NavLink`'s `isActive` render prop drives the active state, no `useLocation`.
- `frontend/src/api/client.ts` — `request<T>` extended (see below), the three `UniverseEntry`/`UniverseDetail`/`RefreshResult` interfaces, `getUniverse`/`addTicker`/`refreshTicker`, and a new `ApiError` class carrying the HTTP status so the UI can distinguish a `503` from every other failure without string-matching the message.

## `react-router-dom` version

`^7.18.3`, whatever `npm install react-router-dom` resolved. Confirmed via `git diff frontend/package.json` that it's the only new entry (`package-lock.json` also changed, as expected from any `npm install`).

## How `request<T>` was extended

```ts
interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
}
async function request<T>(path: string, options: RequestOptions = {}): Promise<T>
```

One optional-options-object parameter, defaulting to `{}` so every existing call site (`getHealth()`) needed no changes. When `options.body` is present, it's JSON-stringified and a `Content-Type: application/json` header is added; otherwise the request is a plain GET, matching current behavior exactly. This is still the only fetch path in the module — `getUniverse`/`addTicker`/`refreshTicker` all call through it.

On a non-2xx response, the response body is parsed once and searched for a string `detail` field (`extractDetail`); if found, the thrown error's message is `` `${detail} (${response.status})` `` — e.g. `"AAPL is already in the universe (409)"` — directly displayable without further parsing, and still contains both the status and the detail text as the acceptance criterion requires. If the body isn't JSON or has no `detail`, it falls back to the original `Request failed with status ${status}: ${text}` shape. I also added a small `ApiError extends Error` class carrying `.status: number`, since `UniversePage` needs to reliably tell a `503` apart from a fully-down backend (which fails at the fetch layer with no status at all, before any response exists) — string-matching `"(503)"` in the message would have worked but felt fragile compared to a typed field.

## A real bug I found and fixed while verifying, not while writing

My first pass at `UniverseTable` used `table-auto` (the default) with `whitespace-nowrap` on every cell, matching the mockup's plain CSS table. Verifying at 375px (headless Chrome, checked `document.querySelector('table').scrollWidth` against the card wrapper's `clientWidth`, not just eyeballing a screenshot) showed the table was **449px wide inside a 341px-wide card** — the *visible* columns' `nowrap` content (`Name`, mainly — "Microsoft Corporation" alone needs ~200px) still exceeded the container even after the `hidden` columns correctly dropped to zero width. Because the card wrapper has `overflow-hidden` (needed for the rounded corners), the excess wasn't a horizontal scrollbar — it was **silent clipping**, and the clipped content was the entire `Refresh` button column, at the far right. A column the spec says must *never* hide was invisible at the narrowest breakpoint, and nothing about it looked broken in a first screenshot — the table just looked complete with three columns of data. I only caught it by checking `scrollWidth` numerically before trusting the screenshot.

Fixed by switching the table to `table-fixed` with explicit per-breakpoint width percentages on each `<th>` (mirrored implicitly by `table-fixed`'s column-width algorithm, which takes widths from the first row), and changing text-bearing cells (`Name`, `Sector`, `Coverage`) from `whitespace-nowrap` to a truncate treatment (`overflow-hidden text-ellipsis`) so any remaining overflow ellipsizes instead of forcing the table wider than its container. Re-verified numerically at 375, 700, 900, 1100, and desktop widths — `table.scrollWidth` never exceeds the container at any of them. Screenshotted all five.

**Consequence, and a real tradeoff:** long names now truncate with an ellipsis at some intermediate widths (e.g. "Microsoft Corporation" → "Microsoft Corporati…" at exactly 900px, where `Sector` and `Yield` have just reappeared and are competing for space) even though nothing is actually hidden or scrolling. The mockup's plain table never does this, because it never solved the container-overflow problem it also has (see below) — I verified this too.

## Discrepancies from the mockup — all forced by acceptance criteria or the API's actual shape, reported per the contract's own instruction

1. **The mockup itself overflows at narrow width.** Its plain-CSS table is `table-auto`/`nowrap` with no fixed-width discipline; I didn't port it verbatim for exactly the reason above. This contract's "never scrolls horizontally" criterion overrides the mockup where they conflict, per the contract's own stated precedence.
2. **`Mkt Cap`, `P/E`, and `Yield` always render `—`.** `GET /universe` (this contract's own verbatim `UniverseEntry` interface, matching what `list_all()` in contract 0008 actually returns) has no `market_cap`, `trailing_pe`, or `dividend_yield` fields — those exist only on `UniverseDetail`, the per-ticker view. The mockup shows real values in these columns because — per its own comment — "MSFT and QQQ are verbatim... the other rows are plausible fills," and its data most likely came from the detail endpoint, not the list endpoint it's visually presenting as. I did not add a per-row detail fetch to backfill these (explicitly out of scope: no detail route, no per-row expansion) or touch the backend (also out of scope). The columns exist structurally, matching the required column set, but are honestly empty rather than fabricated. **This is the one open item I'd want Gunnar's read on** — whether contract 0008's list schema should eventually widen, or whether these three columns should be dropped from the list view entirely.
3. **Four literal hex colors in the mockup have no corresponding design token**, and criterion 5 forbids hardcoded colors in new files: the button hover (`#01184d`), the table header/row-hover tints (`#fbfcfe`/`#fafbfe`), the "nil" dash color (`#b3bccd`), and the ETF pill background (`#e8eefb`). Substituted with opacity-modified existing tokens instead of inventing new hex values: button hover → `hover:opacity-90` on `bg-brand-primary`; row hover → `hover:bg-brand-border/40`; "nil" dashes → the same `text-[var(--color-muted)]` used elsewhere (no separate lighter shade); ETF pill → `bg-brand-primary/10 text-brand-primary` instead of a new pale-blue literal. Visually close, not pixel-identical.

## Commands run

```
$ ls -1 frontend/src/pages/ frontend/src/lib/ frontend/public/
LaunchPage.tsx  UniversePage.tsx
format.ts
_redirects  logo-nav.png

$ cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
typecheck clean

$ npm run build
✓ 35 modules transformed.
dist/index.html                   0.60 kB
dist/assets/index-*.css          15.54 kB
dist/assets/index-*.js          272.78 kB
✓ built in 93ms

$ git diff frontend/package.json
+    "react-router-dom": "^7.18.3",

$ cat frontend/public/_redirects
/*    /index.html   200

$ grep -rnE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' frontend/src/pages/ frontend/src/components/ frontend/src/lib/ ; echo "exit=$?"
exit=1 (clean)

$ grep -rnE ':\s*any\b|<any>|\bas any\b|\)!|\w!\.' frontend/src/pages/ frontend/src/lib/ frontend/src/api/client.ts ; echo "exit=$?"
exit=1 (clean)

$ grep -nE '\*\s*100' frontend/src/lib/format.ts ; echo "exit=$?"
exit=1 (clean)

$ grep -rn "useLocation" frontend/src/components/NavItem.tsx ; echo "exit=$?"
exit=1 (clean)
```

**Criteria 10–12 (manual, browser-driven), observed via headless Chrome + CDP against the real backend, not just described:**

I ran the backend against an isolated throwaway SQLite file (`sqlite:////tmp/be-manual-verify/verify.db`), not the real `.env` Postgres — see the note below on why. Seeded it directly (bypassing yfinance) with MSFT/QQQ rows matching the mockup's real values, for a populated view to check against.

- **Criterion 10:** navigated to `/`, confirmed `h1` = "Blue Eagle Capital"; clicked the "Universe" nav link (`a.click()`, not a direct URL navigation) and confirmed (a) `window.location.pathname` became `/universe`, (b) a `beforeunload` listener registered before the click never fired — proving no full page load happened, (c) the nav item's active-state class was present, (d) the table rendered MSFT/QQQ. Then called `window.history.back()` and confirmed the path returned to `/`. Zero console errors throughout.
- **Criterion 11:** `Page.navigate` directly to `http://localhost:5173/universe` (a fresh navigation, not a client-side route change) rendered the Universe page with its `h1` and table intact — not a blank screen. This confirms Vite's dev server handles the deep link, which the contract itself notes is not a real test of the *production* Cloudflare Pages behavior (`_redirects` exists specifically because dev-server correctness here doesn't transfer to static hosting) — I can't test the production case from this environment; `_redirects`'s presence and exact content are the deliverable and are verified above.
- **Criterion 12:** stopped the backend entirely (`kill` on the port, confirmed via `curl` returning connection-refused) and reloaded `/universe`: page rendered fully (header, page head, add form, error card, retry button), no blank screen, zero console errors/exceptions. Message shown: `"Failed to fetch"` (the browser's own network-layer error, since there's no HTTP response to read a status from) — I separately verified the *specific* `503` path too, by starting the backend with `DATABASE_URL=""` (up, but degraded): message shown was exactly `"Database not configured — the backend is running without persistence."`, matching the spec.
- Also checked 375, 700, 900, and 1100px widths numerically (`table.scrollWidth` vs. container `clientWidth`) and visually (screenshots) — see the table-layout section above.

## Not done

Nothing from the Files/Interface/Acceptance-criteria lists. Per Out of Scope: no detail route, no sorting/filtering/pagination, no delete/de-list control, no "refresh all," no charts/sparklines, no react-query/state library/component library/toast library, launch page unmodified in substance, `Portfolios`/`Research`/gear still inert, no tests (typecheck + build + human look per `REBUILD.md`'s frontend standard).

## Gaps and uncertainty

- **The `Mkt Cap`/`P/E`/`Yield`-always-`—` issue above is the main thing I'm unsure was the right call** versus stopping and reporting `BLOCKED` for a schema mismatch between contracts. I chose to proceed because the contract's own `UniverseEntry` interface is given verbatim and matches the real backend exactly — there's no ambiguity about what data is available, only a mismatch between the mockup's *visual* promise and what the wired-up page can actually show. Building the columns honestly-empty seemed more useful than blocking the whole contract on a schema question that's really contract 0008's to revisit.
- **The exact column-width percentages in `UniverseTable.tsx` are hand-tuned against two rows of real-length test data (MSFT, QQQ)**, not derived from any formal constraint. A ticker with a much longer company name than anything in my test data, or a longer sector name, could still truncate more aggressively than these two rows show. The "never overflow" property is verified (numerically, at five widths); the "how much truncates" property is only spot-checked.
- **`AddTickerForm`'s uppercase styling is CSS-only** (`className="uppercase"`), not a JS-level transform of the input value — matching the mockup's own technique (`text-transform: uppercase` in its CSS) rather than forcing the state value itself to uppercase on every keystroke. The value sent to the API may therefore be mixed-case if a user's IME or paste behavior does something unusual; the backend already uppercases internally (`ticker.upper()`), so this doesn't affect correctness, only worth noting since it means the visual case and the stored-in-state case can differ.
- **I did not test what happens if two different browser tabs/sessions both have the Universe page open and one adds a ticker** — the other tab's list only updates on its own next load or user-triggered retry, which seems like expected behavior for a `useState`/`useEffect`-only page with no shared cache, but wasn't a scenario I specifically drove.
- I ran all manual verification against an isolated SQLite database, not the real Postgres from `backend/.env` — a deliberate choice given the live-database exposure I flagged in the 0008 report (`app/config.py`'s unconditional `load_dotenv()`). I did not re-verify this contract's UI against the real database with real yfinance-fetched data; the human-verification section in the contract itself expects Gunnar to do exactly that.

## Files changed

```
$ git status --short frontend/
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/src/App.tsx
 M frontend/src/api/client.ts
 M frontend/src/components/Header.tsx
 M frontend/src/components/NavItem.tsx
?? frontend/public/_redirects
?? frontend/src/components/AddTickerForm.tsx
?? frontend/src/components/UniverseTable.tsx
?? frontend/src/lib/
?? frontend/src/pages/
```

---

## Audit — Planner only

**Verdict:**

**Verification I re-ran myself:**

**Findings:**

**Follow-up contracts filed:**
