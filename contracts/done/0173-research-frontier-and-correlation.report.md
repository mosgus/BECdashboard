# 0173 audit (planner, 2026-10-26): accepted, label wrapping filed as 0174

**Re-run:** tsc (`-p tsconfig.app.json`) exits 0. Tests: 387 passed in 26 files (382 + 5). Build exits 0. Lint shows only the 2 known warnings. The colour grep and the >300-char check print nothing.

**Criterion 10 was a contradiction in my spec, not a coder failure.** The placement section mandated `<ExpandableChart title="Efficient frontier">`, which is a component prop and also what `OptimizePage.tsx:730` uses. The grep was meant to catch the HTML `title` attribute. Accepted as is. Future greps should be `grep -n ' title="' … | grep -v ExpandableChart`.

**Criterion 7:** `CompareFrontierChart` is lazy and gets its own chunk. Recharts code is already in the main chunk because `ChartDialog` is imported statically by 2 files. That predates this contract; 0173 did not cause it.

**Browser (14–16), against the stub API on :8000 with no production reads:**
- No exception. `Efficient frontier`, `Correlation`, `Move together (+1)`, `Move opposite`, the in-sample note, the correlation explainer and `Daily returns 2025-10-24 …` are all present. The heatmap renders in backend order.
- `--color-foreground` resolves at runtime (`#30578e` in light mode), so the label fill is the themed text colour. The coder's worry was unfounded.
- Historical Optimize still renders with no exception.
- **Defect:** every multi-word mode label wraps onto two `tspan` lines (`Min` / `Var`, `Max` / `Sharpe`). recharts passes each label the point's width, and `<Text>` breaks at spaces. This is filed as **0174**. Criterion 15 (eight short labels) was effectively 7 of 7 plotted points, because the stub's Target Vol errored and so has no point.
- **Not verified:** real BEC data, and dark theme legibility. Both are left to Gunnar.
