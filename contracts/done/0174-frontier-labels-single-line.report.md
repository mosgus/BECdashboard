# 0174 audit (planner, 2026-10-26): accepted; criteria 8–9 not browser-run

**Re-run:** tsc (`-p tsconfig.app.json`) exits 0. Tests: 387 passed. Lint shows the 2 known warnings. Build exits 0. `git status` shows no file touched outside `CompareFrontierChart.tsx`.

**Criterion 6 was my error:** `CompareFrontierChart.tsx` is untracked, so `git diff --stat` cannot list it. Future criteria should not assert with git on files created by unaccepted or uncommitted contracts. Use `git status --short` or read the file.

**Criteria 8–9 were not run in a browser.** Gunnar's own uvicorn (:8000) and Vite (:5173) were running, and `smoke-render.mjs` is hard-wired to :5173. Running there would send compare requests through his real backend, which means production reads. One run did go through before I noticed; it found no label nodes, and I ran nothing further. Instead:
- **8 holds by construction.** `renderModeLabel` returns a plain SVG `<text>` with a string child, so no `<tspan>` can be produced.
- **Centre maths verified in the source.** In recharts 3.10.1, `lib/cartesian/Scatter.js:470-473` sets `x = cx − r`, `y = cy − r` and `width = height = 2r`.
- The on-screen check folds into Gunnar's look.

**Tool gap:** `smoke-render.mjs` should take a `SMOKE_BASE_URL` env var, so the planner can run a stub stack beside Gunnar's servers. Small. File it when it next bites.
