#!/usr/bin/env bash
# Pairs with the compose gateway and saves the bearer token (zc_...) to a file only you can read, for deploy/check.sh
# and for pasting into Nutq's "Pairing token" field. Neither the one-time code nor the token is printed.
#
#   deploy/pair.sh [token file, default deploy/.local/gateway-token]
#
# Each run makes a new token; earlier ones stay valid (get-paircode --new does not revoke them).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
token_file="${1:-$here/.local/gateway-token}"
gateway="${NUTQ_GATEWAY_HTTP:-http://127.0.0.1:42617}"

umask 077
mkdir -p "$(dirname "$token_file")"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

code="$(docker compose -f "$here/compose.yaml" exec -T zeroclaw bash /nutq/run.sh gateway get-paircode --new 2>/dev/null \
  | grep -oE 'X-Pairing-Code: [0-9]+' | grep -oE '[0-9]+$' || true)"
if [ -z "$code" ]; then
  echo "pair: could not read a pairing code from 'zeroclaw gateway get-paircode --new' (is the zeroclaw service up?)" >&2
  exit 1
fi

status="$(curl -sS -m 10 -o "$tmp" -w '%{http_code}' -X POST -H "X-Pairing-Code: $code" "$gateway/pair")"
if [ "$status" != "200" ]; then
  echo "pair: POST /pair returned HTTP $status" >&2
  exit 1
fi

# The response is {"paired":true,"token":"zc_...",...}; only the token goes to the file.
node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!body.paired || typeof body.token !== "string" || !body.token) { console.error("pair: no token in the /pair response"); process.exit(1); }
  fs.writeFileSync(process.argv[2], body.token + "\n", { mode: 0o600 });
' "$tmp" "$token_file"
echo "pair: paired, token saved to $token_file (mode 600, not printed)"
