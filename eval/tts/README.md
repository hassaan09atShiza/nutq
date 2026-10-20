# TTS evaluation: tiny-tts

An evaluation of [tiny-tts](https://github.com/tronghieuit/tiny-tts) as a local, natural voice for Nutq: the pinned artifacts,
their licenses, a browser benchmark on fixed text, and the voice inside Nutq as an optional engine (`?tts=tiny`). This is an
**independent evaluation**, not a reproduction of earlier results: the benchmark artifacts behind those were not available,
so the artifacts below were chosen and pinned here.

Measured on 2026-10-20 in the Claude Code cloud environment, which is **not** the reference machine (an Intel i5-8365U laptop).
Nothing here establishes acceptance on that laptop. The **voice quality has not been judged**: that needs people listening.

## Results against the requirements

| Requirement | Target | Result | Status |
|---|---|---|---|
| Hardware | CPU first, GPU optional | ONNX Runtime Web on the CPU (wasm), no GPU used | Pass in the cloud; i5-8365U unverified |
| Reference environment | Linux, Chrome, browser wasm, one thread | Linux, Chromium 141.0.7390.37 headless, wasm, one thread, on a 4 vCPU Xeon VM | Measured, but not on the reference machine |
| TTS download | under 100 MB | 14.1 MiB for the voice (model, dictionary, G2P weights; 7.1 MiB with gzip, computed); 35.0 MiB with the ONNX Runtime wasm, which Nutq already downloads for Moonshine | Pass |
| Speech startup | under 1.5 s | Loading the voice: 3.65 s cold, 2.23 s warm (files in the HTTP cache). In Nutq it loads in a worker at page load and was ready (3.9 to 4.0 s) before Moonshine (5.9 to 6.0 s) in all three runs | **Fail** as measured; hidden behind Moonshine's load in the app |
| Synthesis throughput | faster than real time | Real-time factor 0.08 to 0.16 (model time over audio length) on the fixed texts | Pass in the cloud; i5-8365U unverified |
| Memory | as low as practical | The tab with Moonshine and the voice: 636 to 643 MiB after loading, 882 to 992 MiB at peak in a reply; with the browser voice instead: 456 MiB and 598 MiB (PSS) | Reported, no limit agreed |
| Voice | natural, not robotic | Samples exist (below); nobody has listened yet | **Unverified** |
| Licensing | free use and distribution, no paid license, no GPL | Code, dictionary, G2P weights and runtime: permissive, no GPL, no eSpeak. The model weights: **no license** at their source | **Fail for shipping** until the author licenses the weights; evaluation only |
| Language | English | English only | Pass |

## What is evaluated

| Piece | Exactly what | Pinned by |
|---|---|---|
| Model | `tinytts.onnx` from https://huggingface.co/backtracking/tiny-tts, a VITS2-style model (MeloTTS layout) with about 1.22 million weights, 44.1 kHz, one speaker labelled `MALE`; the repository's `config.json` names an LJSpeech training list | revision `6d0cc902621451fcd47462b50ee0aabc6a852e25`, SHA-256 `2a12614685c76597d3eeec6772f2c9ce132001cf6ea8a80609f8db9fd7fb745f` |
| Model as loaded | the same graph cut in three (encoder and duration predictor, flow, decoder) and pre-optimized by `scripts/prepare-tiny-tts.py`; with the noise off it gives the same samples (largest difference 0.0) | onnx 1.23.2, onnxruntime 1.29.0; hashes in [docs/THIRD_PARTY.md](../../docs/THIRD_PARTY.md) section 8 |
| Runtime | ONNX Runtime Web: the npm package's JavaScript (1.27.0) with the 1.22.0 `ort-wasm-simd-threaded.jsep.wasm` Nutq already serves for Moonshine, in a Web Worker, `numThreads` 1 | `package.json`, `public/vendor/` |
| Pronunciation | Nutq's text normalization (`src/tts/tiny-text.ts`), then tiny-tts's steps re-implemented in `src/tts/tiny-g2p.ts`: CMUdict 0.6 lookup, words split at apostrophes and hyphens as in training, the g2p_en neural model for other words, ARPAbet stress as tone. Nutq adds: acronyms spelled, joined names split ("ZeroClaw" is "Zero Claw"). No eSpeak | `cmudict.rep` and `g2p_model.json` from tiny-tts commit `77c278f7a4659181bd7bcf5c5e07c768ae765147` (hashes in THIRD_PARTY) |
| Voice | the model's only speaker, at its default settings (noise 0.667, duration noise 0.8, speed 1.0) | |

The upstream npm package (tiny-tts 5.0.1) has no text normalization, so "$1,249.99" reaches its neural G2P as one word. The native
samples below come from that package, as it is, for comparison.

## Licenses

Per component, with sources: [docs/THIRD_PARTY.md](../../docs/THIRD_PARTY.md) section 8. In short:

- **Code**: tiny-tts is Apache-2.0 ("Copyright 2025 tronghieuit"). Nutq's `src/tts/` is MIT and borrows the symbol table (identical
  in tiny-tts and MeloTTS, MIT) and the order of the steps; credits are in the file headers.
- **Model weights**: no license. The Hugging Face repository has no card and no license field. The GitHub repository's Apache-2.0
  covers its own files, and this model file was never in it. **Unresolved; not to be bundled or deployed.**
- **Voice data**: the config names LJSpeech, which is public domain. Not confirmed by the authors.
- **Dictionary**: CMUdict 0.6, "completely unrestricted", acknowledgement requested.
- **G2P weights**: g2p_en 2.1.0 (Kyubyong Park and Jongseok Kim), Apache-2.0; byte for byte the PyPI wheel's arrays.
- **Runtime**: ONNX Runtime Web, MIT (already shipped).
- No GPL component and no eSpeak anywhere in this pipeline.

## Measurements

Cloud environment: Intel Xeon @ 2.10 GHz (family 6, model 207), 4 vCPUs, AVX2 and AVX-512, 16 GB, KVM; Chromium 141.0.7390.37
headless from Playwright; the files served by the local Vite dev server (so downloads take milliseconds and say nothing about a
network). One thread throughout; no other thread count was run. Raw results: [results/](results/).

### Download and size ([results/2026-10-20-split-t1.json](results/2026-10-20-split-t1.json))

| File | Bytes (served, uncompressed) | gzip -9 | brotli 11 |
|---|---|---|---|
| `tinytts.p1.onnx` + `p2` + `p3` | 6,308,415 | 3,274,271 | 2,770,971 |
| `cmudict.rep` | 3,969,309 | 901,363 | 751,992 |
| `g2p_model.json` | 4,486,462 | 3,319,824 | 3,297,534 |
| **The voice** | **14,764,186** (14.1 MiB) | **7,495,458** | **6,820,497** |
| ONNX Runtime wasm and loader (1.22.0, shared with Moonshine) | 21,916,893 | 5,136,465 | 3,051,070 |
| **With the runtime** | **36,681,079** (35.0 MiB) | 12,631,923 | 9,871,567 |

The compressed sizes are computed from the files (what a compressing server would send), not measured: the dev server sends
them uncompressed. Nothing is unpacked: the files are used as served (the dictionary is parsed into 129,463 words). The single
`tinytts.onnx` instead of the three parts is 6,510,795 bytes.

### Loading

| | Cold (empty cache) | Warm (HTTP cache) |
|---|---|---|
| Fetch | 108 ms | 106 ms |
| Parse dictionary and G2P weights | 291 ms | 297 ms |
| Sessions (the first one also starts the wasm runtime) | 3,254 ms (979 + 1,687 + 588) | 1,823 ms (485 + 812 + 527) |
| **Total** | **3,654 ms** | **2,226 ms** |
| The single `tinytts.onnx` instead ([results/2026-10-20-single-file-t1.json](results/2026-10-20-single-file-t1.json)) | 4,806 ms | 3,956 ms |

Almost all of a session's time is ONNX Runtime planning memory for the graph (seen natively with verbose logs: 3.1 s of a 3.3 s
load, before any weights are touched). Natively, turning memory reuse off cuts it from 2.6 s to 1.1 s, but ONNX Runtime Web has
no such option; cutting the graph in three and pre-optimizing it was the measured way down (2.6 s to 0.72 s natively). Turning
off ONNX Runtime's memory arena or memory pattern in the browser changed neither the load time nor the memory much.

The first synthesis after loading is slower (650 ms for "Sure, I can do that." against a median of 258 ms after), so the engine
synthesizes one short sentence, unheard, as soon as it has loaded.

### Synthesis (3 runs per text, median)

| Text | Characters | Model ms | G2P ms | Audio s | RTF |
|---|---|---|---|---|---|
| short-ack | 20 | 258 | 0.2 | 2.73 | 0.095 |
| short-fact | 31 | 287 | 0.2 | 3.19 | 0.090 |
| question | 57 | 367 | 0.3 | 4.49 | 0.082 |
| names | 77 | 633 | 21.1 | 6.85 | 0.092 |
| numbers | 82 | 1,658 | 0.4 | 13.37 | 0.124 |
| dates | 71 | 814 | 0.3 | 8.29 | 0.098 |
| abbreviations | 91 | 1,196 | 19.2 | 11.04 | 0.108 |
| paragraph (one call) | 266 | 3,129 | 0.3 | 19.40 | 0.161 |

Audio length includes the model's own padding (about 0.2 s before and 0.4 s after each clip), which the engine trims. The G2P
time is the neural model for words the dictionary lacks: "Ayesha", "Nutq", "kilohertz"; "U.S.", "API" and "CPU" are spelled.

### From text to sound, in the engine

Text handed to `speak()` until its first sound is due on the AudioContext; headless Chrome reported an output latency of 32 ms on
top. Pieces are synthesized while the one before plays.

| Text | First sound | Of which: queue | synthesis | scheduling | Pieces | Extra silence between pieces |
|---|---|---|---|---|---|---|
| short-ack | 268 ms | 0.5 | 221 | 6 | 1 | |
| short-fact | 350 ms | 82 | 262 | 5 | 1 | |
| question | 378 ms | 0.3 | 372 | 6 | 1 | |
| names | 682 ms | 29 | 646 | 6 | 1 | |
| numbers | 563 ms | 0.6 | 555 | 6 | 2 | 0 ms |
| dates | 834 ms | 0.5 | 827 | 6 | 1 | |
| abbreviations | 812 ms | 1 | 804 | 6 | 2 | 0 ms |
| paragraph | 243 ms | 0.3 | 237 | 6 | 5 | 0 to 9 ms |

"Extra silence" is silence beyond the pause the engine means to leave (about 0.3 s after a sentence, about 0.2 s after a clause
cut at a comma): 0 means the next piece was ready in time. Sentences longer than 120 characters once normalized are cut at commas, so a
long sentence does not hold back the first sound (the numbers text went from 1.7 s to 0.56 s with that).

Cancellation, in the benchmark: a paragraph stopped 800 ms after it started never reported an end or an error, nothing of it was
scheduled after the stop, and the next reply's first sound came 172 ms after it was asked for.

### Inside Nutq (the real page, real Moonshine; the reply stream is simulated)

`run-page.mjs`: the page with a WAV as the microphone ("What is the capital of France?", espeak-ng audio), against a stub gateway
that streams a 186-character reply at the pace of a real ZeroClaw 0.8.5 reply measured on 2026-10-19. Moonshine transcribed the
question exactly in every tiny-tts run.

The speech queue holds the first utterance of a reply for up to `FIRST_UTTERANCE_WAIT_MS` (700 ms) to merge the next sentences
into it. With tiny-tts:

| First-utterance wait | Reply's first chunk to first sound | Silences |
|---|---|---|
| 700 ms (the default, unchanged) | 900 ms | one utterance of 3 pieces, extra silence 0 to 6 ms |
| 0 ms (`?eval=1&first_wait=0`) | 366 ms | **866 ms** of silence after the first sentence |

With no wait, the first sentence is spoken alone, and the queue hands the rest over only when it has ended, so the engine starts
synthesizing it then. The default stays at 700 ms for both voices. Getting both (first sound at about 0.37 s and no hole) needs
the queue to hand the next utterance to an engine that can synthesize ahead while one plays; that is a change to
`src/speech-queue.ts`, proposed, not made.

Interruption (a mic tap 1.5 s into the reply): speech stopped (`tts_cancelled`, reason `mic_press`) and nothing of that reply was
scheduled afterwards.

Memory, PSS from `/proc` (the browser's processes only; the dev server and ZeroClaw are separate containers):

| | Tab after loading | Tab at peak | All Chrome processes after loading | At peak |
|---|---|---|---|---|
| Browser voice, Moonshine loaded | 456 MiB | 598 MiB | 688 MiB | 834 MiB |
| tiny-tts, Moonshine loaded | 636 to 643 MiB | 882 to 992 MiB | 871 to 876 MiB | 1,117 to 1,230 MiB |

The peak includes Moonshine transcribing while the voice synthesizes the first sentences. The voice's worker has its own
ONNX Runtime wasm instance, apart from Moonshine's on the main thread, so the runtime's code and memory are there twice; the
benchmark page alone went from 72 MiB to 418 MiB on loading the voice.

### A real turn

With the compose stack (`deploy/`), ZeroClaw 0.8.5 and Anthropic: `deploy/capture-speech.sh` with `--nutq-url
"http://127.0.0.1:5173/?tts=tiny"`. Moonshine transcribed the question exactly, the answer came back, and the page spoke it with
tiny-tts in three pieces; the recording is 21.0 s long and does not clip (peak -4.3 dB).

## Samples

| Set | Made by | How to get it |
|---|---|---|
| `browser-wasm/` (8 texts) | the benchmark page: the worker's output in the browser, before playback | `node eval/tts/run-bench.mjs` writes them |
| `native-npm/` (8 texts) | the upstream npm package tiny-tts 5.0.1 in Node with onnxruntime-node, its own frontend, the pinned model | not part of this repository |
| `real-turn-tiny.trimmed.wav` | Chrome's audio output during the real turn, recorded through PulseAudio | `deploy/capture-speech.sh` as above |

The samples are not committed (they come from a model with no license). They were sent with the report of this evaluation.

## Running it

```
npm install
node scripts/fetch-tiny-tts.mjs
python3 -m venv .venv-tts && .venv-tts/bin/pip install onnx==1.23.2 onnxruntime==1.29.0 numpy==2.5.4
.venv-tts/bin/python scripts/prepare-tiny-tts.py
CHROME_BIN=/usr/bin/google-chrome node eval/tts/run-bench.mjs              # writes eval/tts/results/<date>-split-all-t1.json and samples
CHROME_BIN=/usr/bin/google-chrome node eval/tts/run-bench.mjs --model tinytts.onnx   # the single file, for comparison
CHROME_BIN=/usr/bin/google-chrome node eval/tts/run-page.mjs --say question.wav [--first-wait 0] [--interrupt-ms 1500]
```

`run-bench.mjs` takes `--threads`, `--model` (`split`, `tinytts.onnx`, `tinytts_fp16.onnx` after `fetch-tiny-tts.mjs --fp16`),
`--opt` (graph optimization at load), `--arena` and `--pattern` (0 turns ONNX Runtime's memory arena or pattern off), `--runs` and
`--no-play`. More than one thread needs a cross-origin isolated page (COOP and COEP headers), which the dev server does not send:
not run. Memory is read from Linux `/proc`, so the drivers run on Linux only. By hand, in any Chrome: open
`/eval/tts/bench.html` on the dev server and press the button; the result is the JSON on the page (no memory or download sizes).

`question.wav` can be made with espeak-ng: `espeak-ng -v en-us -s 150 -w q.wav "What is the capital of France?"`, then
`ffmpeg -i q.wav -af "aresample=48000,adelay=1000:all=1,apad=pad_dur=4" -ar 48000 -ac 1 question.wav`.

## Open questions

For the author of tiny-tts: the license of the Hugging Face weights; the training data (only LJSpeech, as the config says?);
whether "MALE" means anything for this voice (LJSpeech is one female reader); and whether the authors would publish a
lighter export (the graph's size, not its weights, is what makes loading slow).

For the earlier evaluation (Abdullah):

- Which artifacts gave 30.6 MB, 0.5 to 1 s to first audio and an RTF of 0.1 to 0.27: the Hugging Face model, the older
  four-file export in the GitHub repository (33.4 MB), or another; which runtime and thread count; and whether "first audio"
  included loading.
- What "speech startup" should measure: loading the voice (3.65 s cold, 2.23 s warm here), or the first reply's first sound once
  the page is open (the voice is ready before Moonshine is).
- How the voice sounds to you, and whether it is natural enough for conversation: the verdict that matters here.
- The i5-8365U's RAM, and whether about 180 MiB more in the tab after loading, and up to about 390 MiB more at peak, is acceptable.
- Whether a voice in a worker beside Moonshine (two wasm instances) is acceptable, or the voice should share Moonshine's
  instance on the main thread (less memory, but synthesis would then block the page for up to a second per piece).
