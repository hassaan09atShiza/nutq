#!/usr/bin/env bash
# Runs zeroclaw with the Anthropic API key taken from the compose secret. The key reaches ZeroClaw only through this
# process's environment, never through the container's configuration, so `docker inspect` and `docker compose config`
# do not show it. Use it for CLI calls too: docker compose exec zeroclaw bash /nutq/run.sh <zeroclaw args>
set -euo pipefail

secret=/run/secrets/anthropic_api_key
if [ -s "$secret" ]; then
  ZEROCLAW_providers__models__anthropic__default__api_key="$(<"$secret")"
  export ZEROCLAW_providers__models__anthropic__default__api_key
else
  echo "run.sh: no Anthropic API key at $secret, the agent cannot answer" >&2
fi
exec zeroclaw "$@"
