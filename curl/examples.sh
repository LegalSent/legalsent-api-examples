#!/usr/bin/env bash
# The LegalSent API with nothing but curl.
#
#   export LEGALSENT_API_KEY=ls_live_...
#   bash curl/examples.sh                 # reads only
#   bash curl/examples.sh send ./lettera.pdf mario.rossi@example.com   # SENDS FOR REAL
#
# Reference: https://api.legalsent.com/llms-full.txt
set -euo pipefail

BASE="${LEGALSENT_BASE_URL:-https://api.legalsent.com}"
: "${LEGALSENT_API_KEY:?set LEGALSENT_API_KEY first}"
AUTH=(-H "Authorization: Bearer ${LEGALSENT_API_KEY}")

if [ "${1:-}" != "send" ]; then
  echo "== Credit"
  curl -sS "$BASE/api/payment/balance" "${AUTH[@]}"; echo

  echo "== Standard rates"
  curl -sS "$BASE/api/system-settings/rates" "${AUTH[@]}"; echo

  echo "== Latest dispatches"
  curl -sS "$BASE/api/dispatches?limit=3" "${AUTH[@]}"; echo

  echo "== Campaigns"
  curl -sS "$BASE/api/campaigns?limit=3" "${AUTH[@]}"; echo

  echo "== A request that is refused on purpose (JSON instead of a form): proves the key and the route, sends nothing"
  curl -sS -X POST "$BASE/api/dispatches" "${AUTH[@]}" -H "Content-Type: application/json" -d '{"requestType":"ERDS"}'; echo
  exit 0
fi

# ---------------------------------------------------------------- a real send
FILE="${2:?usage: examples.sh send <file.pdf> <recipient email>}"
EMAIL="${3:?usage: examples.sh send <file.pdf> <recipient email>}"

echo "This sends $FILE to $EMAIL as a real ERDS communication and charges the wallet."
read -r -p "Type SEND to go ahead: " answer
[ "$answer" = "SEND" ] || { echo "Nothing was sent."; exit 1; }

# multipart/form-data. recipientData is a JSON object sent as text.
# channels is always given: the default would be email and SMS, two deliveries.
curl -sS -X POST "$BASE/api/dispatches" "${AUTH[@]}" \
  -F "requestType=ERDS" \
  -F "channels=EMAIL" \
  -F "emailSubject=Comunicazione" \
  -F "recipientData={\"firstName\":\"Mario\",\"lastName\":\"Rossi\",\"email\":\"${EMAIL}\"}" \
  -F "file=@${FILE};type=application/pdf"
echo
echo "Keep the requestId above: it is the dispatch id."
echo "  status:  curl -sS \"$BASE/api/dispatches/<id>\" -H \"Authorization: Bearer \$LEGALSENT_API_KEY\""
echo "  proof:   curl -sS \"$BASE/api/dispatches/<id>/audit\" -H \"Authorization: Bearer \$LEGALSENT_API_KEY\" -o proof.pdf"
