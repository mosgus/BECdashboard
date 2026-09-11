# Contract NNNN — <short title>

**Status:** open <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

<One sentence. What exists after this contract that didn't before.>

## Why

<2–4 sentences of context. Link the decision in REBUILD.md this serves, if any.
A coder that understands why makes better calls at the edges than one that doesn't.>

## Files

Create:
- `path/to/new_file.py` — <one line on its responsibility>

Modify:
- `path/to/existing.py` — <what changes, specifically>

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

## Interface

<Exact signatures, types, route shapes, component props. The more precise this is, the more
mechanical the work becomes. For a Haiku contract this section should leave zero decisions open.>

```python
def get_cached(ticker: str) -> pd.DataFrame | None: ...
def store(ticker: str, df: pd.DataFrame) -> None: ...
```

## Out of scope

<Explicit list. This is the section that prevents scope creep — be specific about the adjacent,
tempting work that is NOT part of this contract.>

- Do not add persistence.
- Do not refactor <X>.
- Do not add dependencies beyond those listed above.

## Acceptance criteria

<Each one objectively checkable. No "works correctly" — say how you'd know.>

1. `<command>` exits 0.
2. `<command>` prints `<expected>`.
3. <Behavior a reader could verify by reading the diff.>

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
<command 1>
<command 2>
```

## Open questions — do NOT resolve these yourself

<Anything genuinely undecided. If the coder hits one, it reports BLOCKED and stops. Guessing here
is worse than stopping, because a plausible guess gets silently accepted.>

- <question>
