# Nutq and ZeroClaw with Docker Compose

A reproducible local baseline: a ZeroClaw gateway from a pinned prebuilt image, and Nutq's dev server, as two services.
Nothing is compiled from source; the only image built here is Nutq's (an `npm ci` on a pinned Node image).

| Piece | What it is |
|---|---|
| `zeroclaw` | `ghcr.io/zeroclaw-labs/zeroclaw@sha256:1876f4cf...df05e`, which reports `zeroclaw 0.8.5`. Gateway on `127.0.0.1:42617`. |
| `zeroclaw-seed` | One-shot: copies [zeroclaw/config.toml](zeroclaw/config.toml) into the `zeroclaw-data` volume the first time, then exits. |
| `nutq` | Nutq's vite dev server (eval mode available) on `127.0.0.1:5173`, built from [nutq.Dockerfile](nutq.Dockerfile). |
| `zeroclaw-data` | Named volume holding ZeroClaw's live config, paired tokens, sessions and runtime trace. Survives restarts. |

Both ports are published on the host's loopback only.

## What is configured

- **Provider** `anthropic.default` (`[providers.models.anthropic.default]`). The model comes from the environment,
  `NUTQ_ZEROCLAW_MODEL`, default `claude-haiku-4-5-20251001` (the model behind the repo's live eval runs, see
  [ARCHITECTURE](../docs/ARCHITECTURE.md), "Test backend").
- **Agent** `default`, with `model_provider = "anthropic.default"` and the `default` risk and runtime profiles, which are
  ZeroClaw's own defaults. ZeroClaw 0.8.5 reserves the name: `zeroclaw agents create default` refuses it, but the
  section in `config.toml` is accepted, and `zeroclaw agents list` shows it.
- **Gateway** on `0.0.0.0:42617` inside the container, pairing required (ZeroClaw's default).
- **The API key** is read from `NUTQ_ANTHROPIC_API_KEY` in the shell that runs compose, handed to the `zeroclaw` service
  only, as a compose secret, and exported by [zeroclaw/run.sh](zeroclaw/run.sh) as
  `ZEROCLAW_providers__models__anthropic__default__api_key`, ZeroClaw's env override for that config field. It is never
  written to `config.toml` or the volume, and it is not in the container's configuration, so `docker inspect` and
  `docker compose config` do not show it. The `nutq` service has no access to it: the page talks to the gateway, never to
  Anthropic.

The volume is seeded once. After a change to `zeroclaw/config.toml`, reset it with `docker compose ... down -v` (this
also drops the paired tokens and sessions), or change the live copy with
`docker compose -f deploy/compose.yaml exec zeroclaw bash /nutq/run.sh config set <path> <value>`.

## Start it

On a laptop (Linux, macOS, or Windows with WSL 2), from the repository root:

```
export NUTQ_ANTHROPIC_API_KEY=...        # your key; never commit it
docker compose -f deploy/compose.yaml up -d --build
deploy/check.sh                          # automated checks, below
```

In an environment whose outbound HTTPS is re-signed by its own CA (the Claude Code cloud environment does this), add the
overlay [compose.cloud.yaml](compose.cloud.yaml), which explains why it is needed:

```
NUTQ_EXTRA_CA_FILE=/root/.ccr/ca-bundle.crt \
  docker compose -f deploy/compose.yaml -f deploy/compose.cloud.yaml up -d --build
```

## Automated checks

All of them print no credential: the key is only tested for presence and the gateway token stays in its file.

| Script | What it checks | Needs |
|---|---|---|
| [check.sh](check.sh) | Both services healthy, the seed ran, gateway `/health`, the page and the speech model are served, container to container networking, the containers reach `api.anthropic.com` (a 401 without a key), the key boundary, memory limits and usage, and one real turn over `/ws/chat` (pairs first if needed). `--no-chat` skips the turn. | docker, curl, Node 22 |
| [pair.sh](pair.sh) | Pairs with the gateway and saves the `zc_...` bearer token to `deploy/.local/gateway-token` (mode 600, gitignored). | docker, curl, Node |
| [ws-chat-check.mjs](ws-chat-check.mjs) | One turn over `/ws/chat`, the same frames Nutq sends. | Node 22 |
| [page-check.mjs](page-check.mjs) | The real page in Chrome against the real gateway: connect, speech model ready, `--test-voice` (Test voice through the page's speech code), `--say question.wav` (a full spoken turn from a WAV used as the microphone). | `npm install`, Chrome in `CHROME_BIN` |
| [capture-speech.sh](capture-speech.sh) | Linux without speakers (a cloud container): records what the page speaks to a WAV. The voice is espeak-ng's, not your laptop browser's. | PulseAudio, speech-dispatcher, espeak-ng, Xvfb |

## The listening test, on your own computer

The page has to run in a browser on a machine with speakers, and the voice is whatever that browser offers (Google voices
in Chrome, Microsoft voices in Edge; see the [README](../README.md#voice)). A cloud container cannot be opened from your
laptop: its `localhost` is not yours.

1. Start the services and run `deploy/check.sh` as above. It saves a token to `deploy/.local/gateway-token`.
2. Open http://localhost:5173 in Chrome or Edge. `localhost` counts as a secure page, so the browser offers the microphone.
   This setup was not tried on WSL 2 yet (TBD); if the page does not open from Windows, check WSL's `localhostForwarding`
   setting in `.wslconfig` first.
3. Gateway URL `ws://127.0.0.1:42617/ws/chat`, agent alias `default`.
4. Paste the token from `deploy/.local/gateway-token` into "Pairing token". The Pair button cannot work here: the page
   and the gateway are on different origins, and ZeroClaw 0.8.5 answers the browser's CORS preflight for `/pair` with 405
   and no `Access-Control-*` headers, so the page shows a `curl` command instead. `deploy/pair.sh` does the same thing.
5. Connect, wait for "Tap to start listening", press **Test voice** to hear the voice alone, then tap the microphone and
   ask something short. The answer is spoken sentence by sentence.

## The tiny-tts voice, on Windows with WSL 2

The optional neural voice (`?tts=tiny`, see [eval/tts/README.md](../eval/tts/README.md)) runs in your browser; its files are
fetched on your machine, not committed. This sequence was not run on WSL 2 yet (TBD); each step was run in the Linux cloud
environment. In an Ubuntu WSL 2 shell with Docker available inside WSL (Docker Desktop's WSL integration, or Docker Engine
installed in WSL), Node 22, git, curl and `python3-venv`:

```
git clone https://github.com/hassaan09atShiza/nutq.git
cd nutq
git checkout claude/ecstatic-keller-yudy3d
node scripts/fetch-tiny-tts.mjs                                   # model, dictionary, G2P weights, licenses; SHA-256 checked
python3 -m venv .venv-tts
.venv-tts/bin/pip install onnx==1.23.2 onnxruntime==1.29.0 numpy==2.5.4
.venv-tts/bin/python scripts/prepare-tiny-tts.py                  # the three-part model that loads faster (optional)
export NUTQ_ANTHROPIC_API_KEY=...                                 # your key; never commit it
docker compose -f deploy/compose.yaml up -d --build               # after the fetch: the files are copied into the image
deploy/check.sh                                                   # 16 checks, one real turn; saves the gateway token
cat deploy/.local/gateway-token                                   # to paste into the page; do not share it
```

Then, in Chrome on Windows:

1. http://localhost:5173/?tts=tiny, gateway `ws://127.0.0.1:42617/ws/chat`, agent `default`, the token, Connect. The line under
   the microphone says "Reply voice: tiny-tts". Test voice, then ask something. http://localhost:5173/ is the browser voice,
   for comparison.
2. http://localhost:5173/eval/tts/bench.html, then **Run the benchmark**: the fixed texts, timed in your browser (one thread);
   the result is the JSON on the page. `?runs=1` is quicker. Chrome's task manager (Shift+Esc) shows the tab's memory.

Without `prepare-tiny-tts.py`, the voice loads the single `tinytts.onnx`, which takes longer to start (4.0 s instead of 2.2 s
warm, in the cloud benchmark). If the
voice's files are missing, the page uses the browser voice and the log says why.

## Troubleshooting

| You see | Cause and fix |
|---|---|
| Gateway never healthy; the trace says `Address family not supported by protocol (os error 97)` | The gateway was told to bind `[::]` (the image's own default) on a Docker network without IPv6. The seed config uses `0.0.0.0`. |
| Every turn ends with `AGENT_INIT_FAILED ... risk_profile does not name a configured risk_profiles entry` | ZeroClaw 0.8.5 needs `[risk_profiles.<alias>]` and `[runtime_profiles.<alias>]` and the agent's references to them. The seed config has both. |
| `PROVIDER_ERROR Cannot reach the model provider`; the trace says `invalid peer certificate: UnknownIssuer` | Outbound HTTPS is re-signed by a CA the container does not trust. Use `compose.cloud.yaml` with a full CA bundle. |
| `PROVIDER_ERROR The selected model provider rejected the request`; the trace says `Your credit balance is too low` | The key works but its Anthropic organization has no API credit. Add credit (Plans and Billing in the Anthropic Console) or use a key from a funded organization. |
| `docker pull` from Docker Hub fails with `429 Too Many Requests` | Anonymous pull limit. The Nutq image already uses the ECR mirror of the official Node image. |
| Building `nutq` fails with `public.ecr.aws ... 429 Too Many Requests`, `Data limit exceeded` | The ECR mirror's own limit. Build from Docker Hub, same digest: `docker compose ... build --build-arg NODE_IMAGE=docker.io/library/node:22-bookworm-slim@sha256:<digest>`, with the digest from [nutq.Dockerfile](nutq.Dockerfile), then `up -d`. |
| The page closes the connection at once (`1006`) | Wrong or missing token, see the [README](../README.md#troubleshooting). |
| `capture-speech.sh` records silence and the page logs `tts_error synthesis-failed` | A speech-dispatcher that started before PulseAudio. The script stops it; if you set things up by hand, start PulseAudio first. |

The ZeroClaw daemon logs almost nothing to `docker logs`. Its errors are in
`/zeroclaw-data/.zeroclaw/data/state/runtime-trace.jsonl` in the `zeroclaw` container; `check.sh` prints the last
provider error from it when a turn fails.

## Checked on 2026-10-20 (Claude Code cloud environment)

The same stack, with the Nutq image rebuilt from this branch after `scripts/fetch-tiny-tts.mjs` and
`scripts/prepare-tiny-tts.py`. Real runs.

- `deploy/check.sh`: 16 passed, 0 failed, including one real turn over `/ws/chat` answered by Anthropic (first chunk 834 ms and
  done 945 ms after sending). The `nutq` container served the tiny-tts files (`/local-assets/tiny-tts/`).
- A full spoken turn with `?tts=tiny` (`capture-speech.sh --nutq-url "http://127.0.0.1:5173/?tts=tiny"`): Moonshine transcribed
  "What is the capital of France?" exactly, Anthropic answered, and the page spoke the answer with tiny-tts in three pieces,
  recorded from Chrome's audio output (21.0 s, peak -4.3 dB). The voice's own measurements are in
  [eval/tts/README.md](../eval/tts/README.md).
- The first `up -d --build` of the day needed no workaround.

## Checked on 2026-10-19 (Claude Code cloud environment)

Docker 29.8.2, Compose v5.6.0, cgroup v1, no IPv6 on the Docker network; ZeroClaw 0.8.5 with the default model,
`claude-haiku-4-5-20251001`; Node 22.22.0 on the host; Chromium 141.0.7390.37 from Playwright; PulseAudio 16.1,
speech-dispatcher 0.12.0-rc2 and eSpeak NG 1.51 for the recording. Real runs unless marked otherwise.

- `deploy/check.sh`: 16 passed, 0 failed, twice (with the old 512m limit for `zeroclaw` and with the new 128m), each
  time including one real turn over `/ws/chat` answered by Anthropic.
- Reply latency over `/ws/chat`, measured from sending the message: first chunk 460 to 914 ms and done 533 to 1350 ms
  over seven short turns ("What is the capital of France?" and check.sh's own message); two long replies (1,903 and
  2,180 characters) had their first chunk at 668 and 628 ms and were done at 6.2 and 6.7 s.
- A full spoken turn on the real page against the real gateway, from a synthetic question (espeak-ng audio, 48 kHz mono,
  used as the microphone): connected in 2.5 s, speech model ready at 6.4 s; Moonshine transcribed "What is the capital
  of France?" exactly; the turn was sent after 1000 ms without speech; the done frame came 1003 ms after sending; the
  page spoke the three-sentence answer in the espeak-ng voice (ranked choice, robotic hint shown) and
  `capture-speech.sh` recorded it. The trimmed recording is 15.7 s long; espeak-ng on the command line, default rate,
  reads the whole answer in 15.3 s and its first sentence alone in 2.0 s.
- Memory, from cgroup v1 `memory.max_usage_in_bytes` (`failcnt` stayed 0): `zeroclaw` peaked at 19.2 MiB from start
  through pairing and seven answered turns, and at 21.7 MiB during one long answered turn (counter reset just before
  it); under the new 128m limit it peaked at 14.9 MiB over two answered turns, one of them long. `nutq` peaked at
  337.9 MiB after one page session; an earlier run the same day measured 351.6 MiB.
- From an earlier run the same day, not repeated here: Test voice spoke through the browser's speech synthesis and was
  recorded.
- The first `up -d --build` failed with the ECR 429 above. A retry went through, after the same digest had been pulled
  from Docker Hub; whether ECR answered the second time or the build used the pulled copy was not established. The
  `--build-arg` workaround above was then run and built from cache.
- `npx tsc --noEmit` clean; `npm test` with `CHROME_BIN` set: 483 tests, 480 passed, 3 skipped (they need the recorded
  test audio, `EVAL_AUDIO_DIR`).
