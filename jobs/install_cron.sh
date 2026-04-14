#!/usr/bin/env bash
# Install a local cron entry for the Blue Eagle nightly price refresh.
# Runs every weekday at 10 PM local time. Output logged to logs/refresh_prices.log.
#
# Usage:
#   ./jobs/install_cron.sh
#
# To remove later:
#   crontab -e   # and delete the Blue Eagle line

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PYTHON="${REPO_ROOT}/backend/.venv/bin/python"
SCRIPT="${REPO_ROOT}/jobs/refresh_prices.py"
LOG_DIR="${REPO_ROOT}/logs"
LOG_FILE="${LOG_DIR}/refresh_prices.log"

# Sanity checks
if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "ERROR: ${VENV_PYTHON} not found or not executable."
  echo "Activate and bootstrap the backend venv first."
  exit 1
fi

if [[ ! -f "$SCRIPT" ]]; then
  echo "ERROR: ${SCRIPT} missing."
  exit 1
fi

mkdir -p "$LOG_DIR"

# Cron entry: run at 10 PM local time, Mon-Fri
CRON_LINE="0 22 * * 1-5 cd ${REPO_ROOT} && ${VENV_PYTHON} ${SCRIPT} >> ${LOG_FILE} 2>&1  # blue-eagle"

# Check if already installed
if crontab -l 2>/dev/null | grep -qF "# blue-eagle"; then
  echo "Blue Eagle cron entry already present. Skipping."
  echo "Current entry:"
  crontab -l | grep -F "# blue-eagle"
  exit 0
fi

# Append to existing crontab (preserve anything else the user has)
(crontab -l 2>/dev/null || true; echo "$CRON_LINE") | crontab -

echo "Installed cron entry:"
echo "  $CRON_LINE"
echo ""
echo "Logs will accumulate at: ${LOG_FILE}"
echo "Verify with: crontab -l"
echo "Remove with: crontab -e  (delete the blue-eagle line)"
