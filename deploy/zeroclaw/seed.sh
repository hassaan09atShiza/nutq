#!/usr/bin/env bash
# One-shot: installs the baseline config.toml into the zeroclaw-data volume the first time, then never again, so what
# ZeroClaw writes later (paired tokens, config set) survives restarts. A fresh volume holds the image's own default
# config (an older flat layout aimed at openrouter); it is kept next to ours as config.toml.image-default.
set -euo pipefail

dir=/zeroclaw-data/.zeroclaw
marker="$dir/.nutq-seeded"

mkdir -p "$dir"
if [ -f "$marker" ]; then
  echo "seed: config already installed, left as it is"
  exit 0
fi
if [ -f "$dir/config.toml" ]; then
  cp "$dir/config.toml" "$dir/config.toml.image-default"
fi
cp /nutq/config.toml "$dir/config.toml"
touch "$marker"
echo "seed: installed the baseline config.toml"
