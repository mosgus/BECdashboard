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

There is no reference worktree. `REBUILD.md` used to describe one at `../blue-eagle-reference`;
it does not exist.

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

## The commit guarantee

No agent commits or pushes. Five layers, each catching what the one above it misses:

| # | Layer | Catches | Defeated by |
|---|---|---|---|
| 1 | System prompt + role file | Intent | Any lapse in instruction-following |
| 2 | `.claude/settings.json` deny list | `git push ...` at the start of a command | `cd foo && git push` |
| 3 | **PreToolUse hook** (`scripts/block-git-writes.py`) | Every git/gh invocation anywhere in a compound command, plus evasion attempts (`--no-verify`, `core.hooksPath`, `env -u CLAUDECODE`, writes to `.git/hooks`) | git invoked from inside a script the hook can't see into |
| 4 | **Git hooks** (`pre-commit`, `pre-push`, `pre-merge-commit`, `pre-rebase`) | Any commit or push made while `CLAUDECODE`/`AI_AGENT` is set, *regardless of how git was invoked* | `--no-verify` (blocked by layer 3), or deleting the hook (blocked by layers 3 and 5) |
| 5 | Bash sandbox | Direct reads/writes under `.git/` and `.claude/` from the Bash tool | — |

Layer 3 is tested. `node scripts/run-tests.js` runs 43 cases including every bypass above.
Layer 4 must be installed per clone — `.git/hooks/` is not tracked:

```bash
bash scripts/install-git-hooks.sh
```

**What this does not guarantee.** Layers 3 and 4 are enforced by code an agent can read. Layer 4
keys off `CLAUDECODE`, which is an environment variable, not a cryptographic claim. A determined
agent with shell access has no *sanctioned* path through, but "no sanctioned path" is not "no
path." The blast radius is bounded by the fact that a commit is local and reversible
(`git reset`) — the irreversible operation is **push**, and push is the one you can actually
close completely:

> Your remote is SSH (`git@github.com-emory:ngrom17/blue-eagle.git`) and `SSH_AUTH_SOCK` is
> present in the agent's environment — so today an agent that got past layers 1–4 could
> authenticate. Running `ssh-add -D && ssh-add -c ~/.ssh/<your-emory-key>` makes every use of
> that key pop a confirmation dialog you have to click. At that point an agent cannot push, not
> because it's forbidden, but because it lacks something only you can supply.

That last step is yours to make; it also prompts on your own pushes, which is the point.
