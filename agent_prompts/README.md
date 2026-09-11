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

The three sessions cannot see each other. If the Planner pastes a contract into chat and a coder
pastes a summary back, the Planner ends up auditing a **self-report** — the least reliable signal
available, because an agent that silently stubbed the hard part still reports success in good
faith. So the handoff goes through the filesystem:

```
contracts/
  0001-price-cache-interface.md          <- Planner writes. The contract.
  0001-price-cache-interface.report.md   <- Coder writes. The report.
  TEMPLATE-contract.md
  TEMPLATE-report.md
```

1. **Planner** writes `contracts/NNNN-slug.md` and says which agent should run it.
2. **You** paste into that session: `Execute contracts/NNNN-slug.md`.
3. **Coder** does the work, writes `contracts/NNNN-slug.report.md` with verbatim command output.
4. **You** tell the Planner: `Audit contracts/NNNN-slug.md`.
5. **Planner** reads the contract, reads the real diff, and **re-runs the verification itself**
   rather than trusting the report. Writes a verdict into the report file.
6. **You** commit, if satisfied. Only you.

Step 5 is the point of the arrangement. A Planner that reads the report and says "looks good"
gives you three agents doing the work of one.

### Routing

**Could two competent developers execute this contract and produce meaningfully different code?**

- No → **Haiku**. Every path, signature, and check is pinned down. The work is transcription.
- Yes → **Sonnet**. Real judgment calls remain inside the boundary.
- The differences would be *architectural* → neither. The contract isn't ready.

Not by size. A large mechanical migration is a fine Haiku contract; a ten-line change that sets
an API shape is not.

### Numbering

Zero-padded, monotonic, never reused. Abandoned contracts get `Status: abandoned` — they are not
deleted and their number is not recycled.

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
