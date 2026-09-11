#!/usr/bin/env bash
# Install git-level hooks that refuse commits/pushes made from an AI agent session.
#
# This is the layer that does not care *how* git was invoked — Bash tool, a Python subprocess,
# an obfuscated one-liner. Git itself refuses. Run once per clone:
#
#     bash scripts/install-git-hooks.sh
#
# Hooks live in .git/hooks/, which is not tracked by git, so this must be re-run after a
# fresh clone. It is idempotent.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
HOOKS=".git/hooks"

GUARD='#!/usr/bin/env bash
# Installed by scripts/install-git-hooks.sh — do not edit by hand.
# Refuses the operation when run from inside an AI agent session.
if [ -n "${CLAUDECODE:-}${AI_AGENT:-}${CLAUDE_CODE_ENTRYPOINT:-}" ]; then
  cat >&2 <<"EOF"

  ############################################################
  #  REFUSED: this repo does not accept commits or pushes     #
  #  made from an AI agent session.                           #
  #                                                           #
  #  Only Gunnar commits and pushes. Print the command and    #
  #  let him run it in his own terminal.                      #
  ############################################################

EOF
  exit 1
fi
exit 0'

for hook in pre-commit pre-push pre-merge-commit pre-rebase; do
  printf '%s\n' "$GUARD" > "$HOOKS/$hook"
  chmod +x "$HOOKS/$hook"
  echo "installed $HOOKS/$hook"
done

echo
echo "Done. Verify with:  CLAUDECODE=1 git commit --allow-empty -m test   (should refuse)"
