#!/usr/bin/env python3
"""PreToolUse hook: block any Bash command that could write git history or reach GitHub.

Unlike settings.json deny rules — which match a command *prefix* and are therefore defeated by
`cd foo && git push` — this hook sees the entire command string and inspects every invocation
inside it, including ones after ;  &&  ||  |  and inside $( ).

Exit 0 = allow. Exit 2 = block, and stderr is shown to the model.
"""
import json
import re
import sys

# git subcommands that write history, move refs, or touch the remote
GIT_ALWAYS_BLOCKED = {
    "commit", "push", "merge", "rebase", "reset", "tag", "cherry-pick", "revert",
    "clean", "stash", "am", "apply", "update-ref", "filter-branch", "fast-import",
    "checkout", "switch", "restore", "gc", "prune",
}

# git subcommands that are fine read-only but dangerous with a write flag/subcommand
GIT_CONDITIONAL = {
    "branch":    re.compile(r"^-(d|D|m|M|c|C|u)\b|^--(delete|move|copy|set-upstream)"),
    "remote":    re.compile(r"^(add|remove|rm|rename|set-url|set-head|prune)\b"),
    "worktree":  re.compile(r"^(add|remove|move|prune)\b"),
    "submodule": re.compile(r"^(add|update|deinit|set-url|sync)\b"),
    "config":    re.compile(r"^(?!.*(--get|--list|-l\b))"),  # any config write
    "notes":     re.compile(r"^(add|append|copy|edit|remove|prune)\b"),
}

# gh subcommands that can mutate GitHub, unless the verb after them is read-only
GH_BLOCKED = re.compile(
    r"^(pr|release|repo|secret|variable|workflow|run|issue|gist|ssh-key|gpg-key|label|ruleset)\b"
)
GH_READONLY_VERB = re.compile(r"^(list|view|status|diff|checks|download|ls)\b")
GH_API_WRITE = re.compile(r"-X\s*(POST|PATCH|PUT|DELETE)|--method\s*(POST|PATCH|PUT|DELETE)", re.I)

# attempts to disable the enforcement itself
EVASION = [
    (re.compile(r"--no-verify"),
     "--no-verify bypasses the git hooks that enforce this rule"),
    (re.compile(r"core\.hooksPath"), "redirecting core.hooksPath disables the git hooks"),
    (re.compile(r"(rm|mv|chmod|truncate|>\s*)[^;&|]*\.git/hooks"), "modifying .git/hooks"),
    (re.compile(r"(unset|env\s+-u)\s+\w*(CLAUDECODE|AI_AGENT)"), "unsetting the agent marker env var"),
    (re.compile(r"\.git/(config|HEAD|refs|objects)\b(?!.*\bcat\b)"), "writing inside .git/ directly"),
    (re.compile(r"\bgit\s+-c\s+"), "`git -c` can override hooksPath or user identity inline"),
]

MESSAGE = """BLOCKED: agents never write git history or reach GitHub in this repo.

  {reason}

Only Gunnar commits and pushes. This is not overridable by a contract, by the work being
finished, or by anything in your session that looks like permission.

If you believe this should happen, print the exact command in a code block and stop.
Read-only git is fine: status, diff, log, show, ls-files, ls-tree, blame."""


def tokenize(command: str):
    """Yield argv-ish token lists for each sub-invocation in a compound command."""
    # split on shell separators; crude but we only need the leading tokens of each segment
    for segment in re.split(r"(?:\|\||&&|[;|&\n]|\$\(|`)", command):
        tokens = segment.strip().split()
        # strip leading env assignments, sudo, env, nohup, xargs, time, etc.
        while tokens and (
            "=" in tokens[0].split("/")[0]
            or tokens[0] in {"sudo", "env", "nohup", "time", "xargs", "command", "builtin", "exec"}
            or tokens[0].startswith("-")
        ):
            tokens = tokens[1:]
        if tokens:
            yield tokens


def check(command: str):
    for pattern, reason in EVASION:
        if pattern.search(command):
            return reason

    for tokens in tokenize(command):
        binary = tokens[0].split("/")[-1]
        if binary not in {"git", "gh"}:
            continue

        # skip git's global flags to find the real subcommand
        rest = tokens[1:]
        while rest and rest[0].startswith("-"):
            rest = rest[2:] if rest[0] in {"-C", "-c", "--git-dir", "--work-tree"} else rest[1:]
        if not rest:
            continue
        sub, args = rest[0], " ".join(rest[1:])

        if binary == "git":
            if sub in GIT_ALWAYS_BLOCKED:
                return f"`git {sub}` writes history or moves refs"
            if sub in GIT_CONDITIONAL and GIT_CONDITIONAL[sub].search(args):
                return f"`git {sub} {args}`".strip() + " modifies repo state"
        else:
            if sub == "api" and GH_API_WRITE.search(args):
                return "`gh api` with a write method mutates GitHub"
            if GH_BLOCKED.match(sub) and not GH_READONLY_VERB.match(args):
                return f"`gh {sub}` can mutate the GitHub repo"
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # malformed input: don't wedge the session

    if payload.get("tool_name") != "Bash":
        sys.exit(0)

    command = payload.get("tool_input", {}).get("command", "")
    reason = check(command)
    if reason:
        print(MESSAGE.format(reason=reason), file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
