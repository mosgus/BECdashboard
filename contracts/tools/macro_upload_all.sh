#!/usr/bin/env bash
# Uploads the 15 real scorecard input files to the Macro data routes (contract 0207).
# Written by the planner on 2026-11-25 for Gunnar's first end-to-end run. This WRITES real data to
# whatever API you point it at; each upload is signed with the name you pass.
#
#   bash contracts/tools/macro_upload_all.sh https://<api-host> "Your Name"
#
# Each slot can be re-uploaded freely for 1 hour after its first upload, then locks until 24 h after it.
set -euo pipefail

API="${1:?usage: macro_upload_all.sh <api base url> <your name>}"
NAME="${2:?usage: macro_upload_all.sh <api base url> <your name>}"
DATA="$(cd "$(dirname "$0")/../.." && pwd)/reference files/new integration/Scorecard_Project_2026-11-09/data"

SLOTS=(
  "cy1:CY1.xlsx" "cy2:CY2.xlsx" "macro:Bloomberg_Macro_Data_Values.xlsx" "pmis:PMIs.xlsx"
  "cons_spx:SPXCONS.xlsx" "cons_ewc:EWCCONS.xlsx" "cons_ewu:EWUCONS.xlsx" "cons_ezu:EZUCONS.xlsx"
  "cons_ewg:EWGCONS.xlsx" "cons_ewq:EWQCONS.xlsx" "cons_ewj:EWJCONS.xlsx" "cons_mchi:MCHICONS.xlsx"
  "cons_ewz:EWZCONS.xlsx" "cons_ewy:EWYCONS.xlsx" "cons_ewt:EWTCONS.xlsx"
)

failures=0
for entry in "${SLOTS[@]}"; do
  slot="${entry%%:*}"; file="${entry#*:}"
  query="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.urlencode({"uploaded_by": sys.argv[1], "filename": sys.argv[2]}))' "$NAME" "$file")"
  status="$(curl -sS -o /tmp/macro_upload_response.json -w '%{http_code}' -X POST \
    -H 'Content-Type: application/octet-stream' --data-binary "@$DATA/$file" \
    "$API/macro/slots/$slot?$query")"
  if [[ "$status" == "201" ]]; then
    echo "OK    $slot ($file)"
  else
    failures=$((failures + 1))
    echo "FAIL  $slot ($file): HTTP $status $(cat /tmp/macro_upload_response.json)"
  fi
done
echo "$((15 - failures))/15 uploaded. The rebuild starts after the 15th; check $API/macro/data in ~2 minutes."
exit "$failures"
