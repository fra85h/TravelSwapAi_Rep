#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sign-and-post.sh -u <WEBHOOK_URL> -s <FB_APP_SECRET> [-f payload.json | -d '<json inline>']

Options:
  -u  Webhook URL, es: https://travelswapai.onrender.com/webhooks/facebook
  -s  FB App Secret (da Meta → Impostazioni di base → App secret)
  -f  Percorso file JSON con il payload (opzionale)
  -d  JSON inline (opzionale; usa -f oppure -d)
  -H  Header aggiuntivi per curl (ripetibile), es: -H 'X-Test: 1'
  -v  Verbose: stampa body e firma

Esempi:
  ./sign-and-post.sh -u https://.../webhooks/facebook -s "$FB_APP_SECRET" -d '{"object":"page","entry":[{"id":"PAGE_ID","time":1730000000,"messaging":[{"sender":{"id":"USER_ID"},"recipient":{"id":"PAGE_ID"},"timestamp":1730000000,"message":{"mid":"m_123456","text":"Test Messenger da curl"}}]}]}'

  ./sign-and-post.sh -u https://.../webhooks/facebook -s "$FB_APP_SECRET" -f payload.json
EOF
}

WEBHOOK_URL=""
FB_APP_SECRET=""
PAYLOAD_FILE=""
PAYLOAD_INLINE=""
VERBOSE=0
CURL_EXTRA_HEADERS=()

# Parse args
while (( "$#" )); do
  case "$1" in
    -u) WEBHOOK_URL="$2"; shift 2 ;;
    -s) FB_APP_SECRET="$2"; shift 2 ;;
    -f) PAYLOAD_FILE="$2"; shift 2 ;;
    -d) PAYLOAD_INLINE="$2"; shift 2 ;;
    -H) CURL_EXTRA_HEADERS+=("-H" "$2"); shift 2 ;;
    -v) VERBOSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argomento sconosciuto: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$WEBHOOK_URL" || -z "$FB_APP_SECRET" ]]; then
  echo "Errore: specifica -u e -s"; usage; exit 1
fi
if [[ -z "$PAYLOAD_FILE" && -z "$PAYLOAD_INLINE" ]]; then
  echo "Errore: specifica -f <file.json> oppure -d '<json>'"; usage; exit 1
fi

minify_json() {
  # Legge JSON da stdin e stampa in una riga (separators senza spazi)
  if command -v jq >/dev/null 2>&1; then
    jq -c .
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data, separators=(',',':')))
PY
  else
    echo "Errore: serve 'jq' o 'python3' per minimizzare il JSON" >&2
    exit 1
  fi
}

# Carica e minimizza il body
if [[ -n "$PAYLOAD_FILE" ]]; then
  if [[ ! -f "$PAYLOAD_FILE" ]]; then
    echo "Errore: file non trovato: $PAYLOAD_FILE" >&2; exit 1
  fi
  BODY=$(minify_json < "$PAYLOAD_FILE")
else
  BODY=$(printf '%s' "$PAYLOAD_INLINE" | minify_json)
fi

# Calcola la firma HMAC-SHA256 (binario → hex)
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$FB_APP_SECRET" -binary | xxd -p -c 256)

if [[ $VERBOSE -eq 1 ]]; then
  echo "== BODY (minified) =="
  echo "$BODY"
  echo "== SIG (hex) =="
  echo "$SIG"
fi

# Invia la richiesta firmata
echo "POST $WEBHOOK_URL"
curl -i -X POST "$WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  "${CURL_EXTRA_HEADERS[@]}" \
  --data-binary "$BODY"
