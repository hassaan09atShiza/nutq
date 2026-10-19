#!/usr/bin/env bash
# Automated checks for the compose baseline. Run from anywhere after `docker compose ... up -d`:
#
#   deploy/check.sh            all checks, including one real turn through ZeroClaw to Anthropic (costs a few tokens)
#   deploy/check.sh --no-chat  everything except that turn
#
# Prints no credential: the API key is only ever tested for presence, and the gateway token stays in its file.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose -f "$here/compose.yaml")
token_file="${NUTQ_TOKEN_FILE:-$here/.local/gateway-token}"
chat=1
[ "${1:-}" = "--no-chat" ] && chat=0

pass=0
fail=0
ok() { echo "PASS  $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }
info() { echo "      $*"; }

echo "== Tools"
info "$(docker version --format 'docker client {{.Client.Version}}, server {{.Server.Version}}' 2>&1)"
info "$(docker compose version 2>&1)"
info "node $(node --version 2>&1)"

echo "== Services"
for svc in zeroclaw nutq; do
  status="$("${compose[@]}" ps "$svc" --format '{{.Status}}' 2>/dev/null)"
  if [[ "$status" == *"(healthy)"* ]]; then ok "$svc is running and healthy ($status)"; else bad "$svc is not healthy: '${status:-not running}'"; fi
done
seed="$("${compose[@]}" ps -a zeroclaw-seed --format '{{.Status}}' 2>/dev/null)"
if [[ "$seed" == Exited\ \(0\)* ]]; then ok "zeroclaw-seed exited cleanly"; else bad "zeroclaw-seed: '${seed:-missing}'"; fi
info "zeroclaw: $("${compose[@]}" exec -T zeroclaw zeroclaw --version 2>&1)"

echo "== Gateway and page, from the host"
health="$(curl -sS -m 5 http://127.0.0.1:42617/health 2>&1)"
if node -e 'const h = JSON.parse(process.argv[1]); process.exit(h.status === "ok" && h.runtime.components.gateway.status === "ok" ? 0 : 1)' "$health" 2>/dev/null; then
  ok "GET http://127.0.0.1:42617/health: status ok, gateway component ok"
  info "require_pairing=$(node -e 'console.log(JSON.parse(process.argv[1]).require_pairing)' "$health")"
else
  bad "gateway health: ${health:0:200}"
fi
page="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>&1)"
if [ "$page" = "200" ]; then ok "GET http://127.0.0.1:5173/ (Nutq page): HTTP 200"; else bad "Nutq page: HTTP $page"; fi
model="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/vendor/moonshine/model/base/quantized/encoder_model.onnx 2>&1)"
if [ "$model" = "200" ]; then ok "speech model file served by Nutq: HTTP 200"; else bad "speech model file: HTTP $model"; fi

echo "== Networking inside the containers"
if "${compose[@]}" exec -T nutq node -e "fetch('http://zeroclaw:42617/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
  ok "nutq container reaches zeroclaw:42617 by service name"
else
  bad "nutq container cannot reach zeroclaw:42617"
fi
# No credential is sent: a 401 proves DNS, routing and TLS to the API all work.
api="$("${compose[@]}" exec -T zeroclaw bash -c 'ca=(); [ -f /etc/nutq/extra-ca.crt ] && ca=(--cacert /etc/nutq/extra-ca.crt); curl -sS -m 15 "${ca[@]}" -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/models' 2>&1)"
if [ "$api" = "401" ]; then ok "zeroclaw container reaches https://api.anthropic.com (HTTP 401 without a key, as expected)"; else bad "zeroclaw container to api.anthropic.com: '$api'"; fi

echo "== API key boundary (presence only, never the value)"
if [ -n "${NUTQ_ANTHROPIC_API_KEY:-}" ]; then ok "NUTQ_ANTHROPIC_API_KEY is set in this shell"; else bad "NUTQ_ANTHROPIC_API_KEY is not set in this shell"; fi
n="$("${compose[@]}" exec -T zeroclaw bash -c 'tr "\0" "\n" < /proc/1/environ | grep -c "^ZEROCLAW_providers__models__anthropic__default__api_key=."' 2>/dev/null)"
if [ "$n" = "1" ]; then ok "the zeroclaw daemon has the provider key in its environment"; else bad "the zeroclaw daemon has no provider key"; fi
for svc in zeroclaw nutq; do
  cid="$("${compose[@]}" ps -q "$svc")"
  if docker inspect "$cid" --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1 | grep -qiE 'api_key'; then
    bad "$svc container configuration mentions an API key variable"
  else
    ok "$svc container configuration (docker inspect) has no API key variable"
  fi
done
if "${compose[@]}" exec -T nutq sh -c 'test ! -e /run/secrets/anthropic_api_key'; then ok "nutq has no access to the key secret"; else bad "nutq can see the key secret"; fi

echo "== Memory (limit from compose, usage now)"
for svc in zeroclaw nutq; do
  cid="$("${compose[@]}" ps -q "$svc")"
  limit="$(docker inspect "$cid" --format '{{.HostConfig.Memory}}')"
  usage="$(docker stats --no-stream --format '{{.MemUsage}}' "$cid")"
  if [ "${limit:-0}" -gt 0 ]; then ok "$svc memory limit $((limit / 1024 / 1024)) MiB is set; usage $usage"; else bad "$svc has no memory limit"; fi
done

if [ "$chat" = 1 ]; then
  echo "== Real conversation: /ws/chat, agent default, Anthropic"
  if [ ! -s "$token_file" ]; then "$here/pair.sh" "$token_file" || bad "pairing failed"; fi
  if [ -s "$token_file" ]; then
    out="$(node "$here/ws-chat-check.mjs" --token-file "$token_file")"
    rc=$?
    echo "$out" | sed 's/^/      /'
    if [ $rc = 0 ]; then
      ok "one real turn completed (done frame with a non-empty reply)"
    else
      bad "the real turn did not complete"
      # The gateway only sends a generic PROVIDER_ERROR; the provider's own answer is in the runtime trace. Anything
      # shaped like a key or a token is masked before it is shown.
      info "last provider error in the runtime trace:"
      "${compose[@]}" exec -T zeroclaw bash -c 'grep "ModelProvider error\|UnknownIssuer" /zeroclaw-data/.zeroclaw/data/state/runtime-trace.jsonl | tail -n 1' \
        | sed -E 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-REDACTED/g; s/zc_[0-9a-f]{8,}/zc_REDACTED/g' \
        | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { try { console.log("      " + JSON.parse(s).attributes.error.slice(0, 400)); } catch { console.log("      (none found)"); } })'
    fi
  fi
else
  info "real conversation skipped (--no-chat)"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
