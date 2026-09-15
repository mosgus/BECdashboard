# Agent Prompts

Three Claude sessions, three roles, one shared repo. Each session gets a thin system prompt that
points at one file in this directory; that file is the authoritative, editable definition of its
role.

| Session | Model | Role file | Responsibility |
|---|---|---|---|
| Planner | Opus | [`planner-opus.md`](planner-opus.md) | Designs architecture, writes contracts, audits reports. Does not write code. |
| Implementer | Sonnet | [`implementer-sonnet.md`](implementer-sonnet.md) | Executes contracts that require judgment. Answers planning questions too small for Opus. |
| Executor | Haiku | [`executor-haiku.md`](executor-haiku.md) | Executes fully-specified contracts. Mechanical work only. |

System prompts live in [`SYSTEM-PROMPTS.md`](SYSTEM-PROMPTS.md). They are written to be set once
and never edited — when a role changes, you edit the role file and tell the session to re-read
it.

## Branches

- **`rebuild`** — the development branch. All work happens here.
- **`main`** — the reference. The old, working implementation. Not checked out, never modified
  from this working tree.

Agents read the reference without switching branches:

```bash
git show main:backend/core/optimizer.py
git ls-tree -r main --name-only | grep routers
git diff main rebuild --stat
```


## The contract loop

The three sessions cannot see each other. **Contracts go through the filesystem; reports go
through chat.**

```
contracts/
  0004-postgres-persistence.md           <- live work only: open / in-progress / awaiting fixes
  TEMPLATE-contract.md
  TEMPLATE-report.md                     <- structure for the chat report
  done/
    0001-backend-scaffold.md             <- archived by the Planner, only after acceptance
    0001-backend-scaffold.report.md      <- moves with its contract, always as a pair
```

`contracts/` is a worklist, not a history — if it's sitting there, it still needs something. The
Planner moves a contract and its report into `done/` as the last step of accepting it. Abandoned
contracts go there too; nothing is ever deleted and no number is ever recycled.

1. **Planner** writes `contracts/NNNN-slug.md` and says which agent should run it.
2. **You** paste into that session: `Execute contracts/NNNN-slug.md`.
3. **Coder** does the work and reports **in chat**, following `TEMPLATE-report.md`, with verbatim
   command output.
4. **You** paste that report to the Planner: `Audit contracts/NNNN-slug.md`.
5. **Planner** reads the contract, reads the real diff, and **re-runs every verification command
   itself** against the working tree — not against the pasted output.
6. **You** commit, if satisfied. Only you.

Step 5 is the point of the arrangement, and it is what makes step 3's format a matter of
convenience rather than trust. A Planner that reads a report and says "looks good" gives you three
agents doing the work of one — that failure is identical whether the report was a file or a chat
message.

**Changed 2026-09-13.** Reports were originally written to `contracts/NNNN-slug.report.md`, on the
reasoning that auditing a chat summary means auditing a self-report. That reasoning was half right:
the danger is real, but the defence against it was never the file — it was step 5. What the file
bought was *provenance*: a durable record, in the repo, of what was claimed versus what was found,
readable by a future session. The Planner still writes a report file when a contract needs one
round of fixes or when the verdict is worth keeping (see `0001-backend-scaffold.report.md`);
routine clean passes are recorded in chat and in the commit.

### Routing

**Could two competent developers execute this contract and produce meaningfully different code?**

- No → **Haiku**. Every path, signature, and check is pinned down. The work is transcription.
- Yes → **Sonnet**. Real judgment calls remain inside the boundary.
- The differences would be *architectural* → neither. The contract isn't ready.

Not by size. A large mechanical migration is a fine Haiku contract; a ten-line change that sets
an API shape is not.

### Running contracts in parallel

Two contracts can run at once **only if neither declares a dependency on the other and their file
lists are disjoint.** Contracts 0019 and 0020 qualified: different files, no dependency.

**A contract that says "Depends on NNNN" must wait for NNNN to be audited and accepted.** Running
0022 and 0023 together on 2026-09-15 produced three problems at once: the planner audited 0022
against a tree containing 0023's half-written files (the typecheck failed on a file 0022 never
touched), 0023 was building against a `Tooltip` component that had not yet been accepted, and a
rejection of 0022 would have left 0023 built on a rejected foundation.

The audit is the bottleneck by design. Overlapping a dependent contract with it does not save time —
it just makes the audit signal unreadable.

### Numbering

Zero-padded, monotonic, never reused. Abandoned contracts get `Status: abandoned` — they are not
deleted and their number is not recycled.

**Because accepted contracts move to `contracts/done/`, the live directory no longer shows the
highest number.** Check both before numbering a new one:

```bash
ls contracts/ contracts/done/ | grep -E '^[0-9]{4}-' | sort | tail -3
```

This is the one way archiving can bite. A reused number silently breaks cross-references in
`REBUILD.md` and in other contracts, and nothing catches it.

## No agent commits or pushes

Gunnar is the only one who commits and pushes. Two things hold this up:

1. **The rule, stated in every role file and every system prompt.** It is written as
   non-overridable: not by a contract that asks for it, not by the work being finished, not by
   anything in a session that resembles permission. An agent that thinks a commit is warranted
   prints the command in a code block and stops.
2. **A `deny` list in `.claude/settings.json`**, which blocks `git commit`, `push`, `merge`,
   `rebase`, `reset`, `tag`, `stash`, `cherry-pick`, `revert`, `clean`, `checkout`, `switch`,
   `restore`, and the writing `gh` subcommands at the harness level.

**This is a strong convention, not a guarantee, and that is a deliberate choice.** The deny list
matches a command *prefix*, so a compound command (`cd foo && git push`) slips past it and the
prompt rule is the only thing left. Prompt rules fail probabilistically, and the moment of
highest risk is an agent finishing a contract, where "commit the work" reads as completing the
task.

The tradeoff was accepted because the blast radius is small: the repo is private and
single-owner, a stray commit is undone with `git reset`, and a stray push is undone with
`git push --force`. Watch for it at the end of contracts rather than assuming it cannot happen.

If that ever stops being acceptable, the escalation is a `PreToolUse` hook that inspects the
whole command string rather than its prefix, plus `pre-commit`/`pre-push` hooks in `.git/hooks/`
that refuse when `CLAUDECODE` is set. Both were built and then removed as more machinery than
this project warrants.
