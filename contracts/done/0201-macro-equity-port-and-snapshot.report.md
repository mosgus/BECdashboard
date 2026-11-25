# Report — Contract 0201 (equity port, quadrant, charts, build_snapshot)

## Audit

**Accepted, 2026-11-25 (planner).** I re-ran the checks myself:
- `macro_port_check.py econ` and `full`: both IDENTICAL.
- `full` took 8.4 s with a process peak RSS of 174 MB, including loading the 15 files.
- The grep criterion prints 0.
- The full suite passes: 1009.

The port reproduces the 2026-11-09 snapshot exactly, so the arithmetic, formatting, rounding and row order are faithful. The departures the coder listed are all output-neutral, and the exact match confirms that:
- the chart code lives in `macro_snapshot.py`;
- `colors_for` returns cell classes directly;
- `FLAG_CODE` is keyed by market;
- `PCT_LOW`, `PCT_HIGH` and `GROUPS` are imported, not redefined.

`test_no_prices_yet` pins the first-deploy state.

The coder disclosed one test fix: the `market_score` breadth literal was re-derived (0.40 → 0.2667). I checked it: `np.interp(0.40, [0, .5, .6, 1], [0, 1/3, 2/3, 1]) = 0.2667`. The test was wrong, not the code.

**Follow-ups, for the rebuild-job contract:**
1. **Memory on Render.** The 174 MB is a standalone process. The web process already holds pandas, scipy and prophet. Run the build in a **subprocess**, or measure the RSS delta in-process, before trusting 512 MB. A subprocess also keeps a crash from taking the API down.
2. **Coverage the templates don't give:**
   - the weekly-grid reindex branch of `load_estimates` (gappy monthly history);
   - the March rollover detection;
   - partially priced markets;
   - a market with no estimates.
   
   The real-data check covers the first two. The rebuild contract should test the last two with literal fixtures, and serialise with `allow_nan=False` so a NaN fails the build instead of the browser.
3. **Time.** 8.4 s locally, about 80–90 s at 0.1 CPU, with `build_econ` run three times (now, 1M, 3M). That is acceptable for a background job. Don't optimise speculatively.
