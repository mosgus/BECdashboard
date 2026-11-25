# Report — Contract 0207 (macro data routes)

## Audit

**Accepted, 2026-11-25 (planner).** I re-ran the full suite: 1105 tests pass.

**Planner-run end-to-end check.** I ran it in-process against a throwaway SQLite database, never production. The config guard ran before the database was switched.
1. The 15 real files went through `POST /macro/slots/{id}` over HTTP. They took 3.0 s locally and returned 201 each. Exactly one rebuild was requested, with a key, after the 15th.
2. Prices were seeded through `store_series`.
3. `run_build` was run with now = 2026-11-09 17:00 UTC and returned `built`.
4. `/macro/data` showed 15 slots filled, `serving: "uploads"` and 1809 tickers.
5. **The `/macro/scorecard` served afterwards is IDENTICAL to `hard_data/macro_scorecard.json`, apart from `generated_at`.** That is the whole pipeline, upload to served page, reproducing the 11-09 snapshot.
6. A broken workbook got a 422 with the user-facing message, and `templates.zip` returned 200 (1.24 MB).

**The deviations are fine:**
- the extra `built_at` query;
- the 404-before-503 order;
- the mixed `Z` / `+00:00` timestamps. Both parse in JavaScript.

**Accepted risks:**
- **A chunked body with no `Content-Length` is read fully before the 20 MB check.** Render's edge caps request size, so the memory exposure is bounded there.
- **`/macro/data` has no missing-table fallback.** Migrations are run by hand before deploy; that is in REBUILD.md.
- **Still unexercised: Postgres and the real rebuild subprocess on Render.** Gunnar's production run in the human-verification steps is that test.
