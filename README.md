# Blue Eagle — Rebuild in Progress

This branch (`rebuild`) is a ground-up rewrite, not an iteration. The implementation described in the old README (still intact on `main`) works, but is being replaced page by page, feature by feature — kept where it earns its place, cut where it doesn't, rebuilt where the old approach turns out to be the wrong shape. How much changes, and how much survives, is genuinely unknown until it's actually being built. Don't treat anything below as a spec — it's a snapshot of decisions made so far, not a plan for what this ends up looking like.

## Status

No rebuilt pages exist yet. This section will be wrong shortly after anything ships — update it as pages land rather than trying to predict the final shape now.

## Decided so far

- **Python 3.13** for the backend — stateless, no ORM required.
- **No auth, no multi-user concerns.** Single-operator prototype. Portfolios are defined client-side (manual entry or CSV upload) and persisted in browser storage, not a shared database.
- **No hosted database for now.** Price data is cached in-process (TTL) rather than in Postgres/Supabase. A small persistent table may get added later if cold-cache-on-every-restart turns out to be too costly in practice — deferred, not ruled out.
- **Analysis/optimization stays in Python** (scipy/statsmodels) — no plan to port the numerical work to JS/WASM.
- **Deploy target:** GitHub → Render (backend) + Cloudflare Pages (frontend), both auto-deploying independently on push to `main`.

## Not decided

Everything else — page layout, which old-app features carry over as-is vs. get cut vs. get rebuilt differently, exact API shape, whether any persistence comes back beyond the price cache. Expect this list to shrink and the "Decided so far" list to grow as development proceeds.

## Reference

The pre-rebuild implementation lives on `main` — check it out there (or in a separate worktree, if you have one set up locally) for how the old app worked. It won't be kept in sync with this branch.
