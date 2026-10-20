# Third-party software and assets

What Nutq ships, bundles or downloads at runtime, where each piece comes from, under which license, and whether it
may be redistributed inside this MIT repository. Audited on 2026-10-05 against the installed `node_modules`, a
production build, and a real page load with the network requests recorded.

Nutq's own code is MIT, see [LICENSE](../LICENSE). Nothing below changes that; each item keeps its own license.

"Redistribution OK" means the license text found allows copying the file into this repository provided the notices
are kept. It is a reading of the license files named in the "Where found" column, not legal advice.

## 1. What the page loads at runtime

Every asset below is bundled in `public/vendor/` or `public/fonts/` and served from the app's own origin. Before
they were bundled, the same files came from `cdn.jsdelivr.net`, `download.moonshine.ai`
and Google Fonts; the URLs below are those original sources, recorded in headless Chrome on 2026-10-05, and the
files were downloaded from them.

| Bundled file | Original source | Size in bytes | SHA-256 |
|---|---|---|---|
| `public/vendor/moonshine/model/base/quantized/encoder_model.onnx` | `https://download.moonshine.ai/model/base/quantized/encoder_model.onnx` | 20,513,063 | `1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751` |
| `public/vendor/moonshine/model/base/quantized/decoder_model_merged.onnx` | `https://download.moonshine.ai/model/base/quantized/decoder_model_merged.onnx` | 42,498,870 | `cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3` |
| `public/vendor/onnxruntime-web-1.22.0/ort-wasm-simd-threaded.jsep.mjs` | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.mjs` | 44,677 | `1cbcba8f2c769c1eecbab66a1b1e55ef11704515bf4306373e3db3c37cf6dcd8` |
| `public/vendor/onnxruntime-web-1.22.0/ort-wasm-simd-threaded.jsep.wasm` | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.wasm` | 21,872,216 | `b45970d0632383a057c27ca5b660b216f8e00c17cf8db9f6207b5e4abc839368` |
| `public/vendor/onnxruntime-web-1.14.0/ort-wasm-simd.wasm` | `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort-wasm-simd.wasm` | 10,014,674 | `9bd07bababc65f53d061f457233eeae501be7ceb8a2adb9eef52d87fe776d865` |
| `public/vendor/vad-web-0.0.24/silero_vad_v5.onnx` | `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.24/dist/silero_vad_v5.onnx` | 2,327,524 | `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f` |
| `public/vendor/vad-web-0.0.24/vad.worklet.bundle.min.js` | `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.24/dist/vad.worklet.bundle.min.js` | 2,642 | `c187b8546aa8e8d91c8cbfccdd00407ca44724e7f3369770a5524efc76d441a0` |
| `public/fonts/*.woff2` (10 files) | the files Google Fonts' CSS pointed to on 2026-10-05 | see the directory | not recorded |

The Silero model, the worklet and the 1.14.0 wasm were compared byte for byte with the copies inside the installed npm
packages `@ricky0123/vad-web@0.0.24` and its nested `onnxruntime-web@1.14.0`, and are identical.

Each directory holds the license files of what is in it (`LICENSE`, `ThirdPartyNotices.txt`, `LICENSE-*`, `OFL-*.txt`).
They are the same texts that section 2 cites. The pinned versions and base paths are set in
`src/vendor/constants.ts` (`Settings.BASE_ASSET_PATH`, through `assetURL`) and, for the VAD runtime, in
`src/vendor/transcriber.ts` (`onnxWASMBasePath`). The VAD also fetches `vad.worklet.bundle.min.js` from its base path;
that request comes from the audio thread and is not visible to Playwright, which is why the test checks it separately.

Only the files requested on a plain load are bundled. ONNX Runtime 1.14.0 has threaded wasm variants
(`ort-wasm-simd-threaded.wasm` and others) that it would request only if the page were cross-origin isolated
(COOP and COEP headers); those are not bundled and that setup is untested.

## 2. Runtime assets

| Asset | Version / source | License | Where the license was found | Redistribution OK |
|---|---|---|---|---|
| Moonshine base encoder and decoder weights (quantized, English) | `download.moonshine.ai/model/base/quantized/` (no version published there; `last-modified` header 2026-08-01) | MIT, Copyright (c) 2025 Useful Sensors, Inc. (dba Moonshine AI) | `LICENSE` in https://github.com/moonshine-ai/moonshine at commit `547d00660e70aa976d506842cb1c851688043024` (2026-08-24): "the English Tiny and Base models" are MIT; only the legacy non-English models listed there are under the Moonshine Community License. Also the `LICENSE` inside the npm package `@moonshine-ai/moonshine-js` 0.1.29, which says the English model is MIT. The Hugging Face card for `moonshine-ai/moonshine-base` says `license: mit` | Yes, with the MIT notice. `download.moonshine.ai` serves no license file next to the weights (`/LICENSE`, `/model/base/LICENSE` and `/model/base/quantized/LICENSE` all return 404), and we did not byte-compare the ONNX files with the Hugging Face release, so the MIT status rests on the upstream license text naming the English Base model |
| ONNX Runtime Web wasm 1.22.0 (`ort-wasm-simd-threaded.jsep.mjs`, `.jsep.wasm`) | npm `onnxruntime-web@1.22.0`, via jsDelivr | MIT, Copyright (c) Microsoft Corporation | `LICENSE` of https://github.com/microsoft/onnxruntime at tag `v1.22.0`. The npm package and the jsDelivr listing contain no license file; `package.json` says MIT | Yes, with the MIT notice. The wasm build contains third-party components; their notices are in `ThirdPartyNotices.txt` of the same tag |
| ONNX Runtime Web wasm 1.14.0 (`ort-wasm-simd.wasm`) | npm `onnxruntime-web@1.14.0`, via jsDelivr (this is the version `@ricky0123/vad-web@0.0.24` depends on) | MIT, Copyright (c) Microsoft Corporation | `LICENSE` of https://github.com/microsoft/onnxruntime at tag `v1.14.0` (identical text to v1.22.0) | Yes, same conditions |
| Silero VAD v5 model (`silero_vad_v5.onnx`) and the VAD audio worklet (`vad.worklet.bundle.min.js`) | npm `@ricky0123/vad-web@0.0.24`, via jsDelivr | model: MIT, Copyright (c) 2020-present Silero Team; worklet (vad-web code): ISC, Copyright (c) 2022-present ricky0123 | model: `LICENSE` of https://github.com/snakers4/silero-vad at commit `caddb3b7ce1dee88a14d5621a0e9a8fdeb2c2c48`. Worklet: `LICENSE` of https://github.com/ricky0123/vad at commit `2778c913ad04c2b49635ac900a44066dafc81a83`; `package.json` of the npm package says ISC, and the package contains no license file | Yes for both, with their notices. The file is byte-identical to the copy inside the npm package; we did not compare it with the file in the silero-vad repository |
| Amiri (regular, italic; latin and arabic subsets) | Google Fonts | SIL Open Font License 1.1, Copyright 2010-2022 The Amiri Project Authors | `ofl/amiri/OFL.txt` in https://github.com/google/fonts, commit `39d11bc313031c9f68e21a297ce5e4a15cc5365e` | Yes (OFL permits bundling and redistribution of unmodified fonts) |
| Cormorant Garamond (300 to 500 normal, 300 and 400 italic; latin subset) | Google Fonts | SIL OFL 1.1, Copyright 2015 the Cormorant Project Authors | `ofl/cormorantgaramond/OFL.txt`, commit `6a386aadc0a33dd3d810b833d9c5105345cbb0e6` | Yes |
| Inter (400 to 700; latin subset) | Google Fonts | SIL OFL 1.1, Copyright 2020 The Inter Project Authors | `ofl/inter/OFL.txt`, commit `b0928647ba26c8d55548aa19feb2f7aeba622d4a` | Yes |
| Spectral (400 normal and italic; latin subset) | Google Fonts | SIL OFL 1.1, Copyright 2017 The Spectral Project Authors | `ofl/spectral/OFL.txt`, commit `9c96641e1f222219ce1fd949e919f0258b6ec2ee` | Yes |
| JetBrains Mono (400, 500; latin subset) | Google Fonts | SIL OFL 1.1, Copyright 2020 The JetBrains Mono Project Authors | `ofl/jetbrainsmono/OFL.txt`, commit `2e05c1cf00a6e4f40a4b931600a90881c26e15cd` | Yes |

### Brand assets

Served from `public/brand/`. They were supplied for the two themes; Nutq did not create them.
The SVGs were reduced once with svgo 3.3.5 (run through `npx`, not a dependency of this repository). `shiza-logo.svg` is
the supplied file with only the embedded C2PA metadata block and its namespace declaration removed; it renders pixel for
pixel the same. `zeroclaw-logo.svg` and `shiza-icon.svg` also had their path data rewritten at 3 decimals; at display
size (44 and 24 px high, at 1x and 2x) the largest difference in any colour channel against the original is 19 of 255. The PNG tab
icons were recompressed losslessly with oxipng 8.0.0 (`-o max --strip safe`), and decode to the same pixels.

| File | What it is | Size in bytes | Rights |
|---|---|---|---|
| `shiza-logo.svg`, `shiza-icon.svg`, `favicon-shiza-32.png`, `favicon-shiza-180.png` | SHIZA wordmark, icon and tab icons | see the directory | SHIZA brand marks, shown in the SHIZA theme. Whether they may be redistributed under this repository's MIT license: TBD, to be confirmed by SHIZA |
| `zeroclaw-logo.svg`, `favicon-zeroclaw-32.png`, `favicon-zeroclaw-180.png` | ZeroClaw logo and tab icons | see the directory | Source and license of the supplied files: TBD, not verified. Shown in the ZeroClaw theme only to identify the product Nutq talks to |

ZeroClaw and its logo are trademarks of ZeroClaw Labs. This project is not affiliated with or endorsed by ZeroClaw Labs.

## 3. Code in the production bundle

Found by building with source maps and listing the `node_modules` sources inside the output. All are MIT or ISC; the
notices are listed here because the minified bundle carries none.

| Package | Version | License | Notes |
|---|---|---|---|
| `onnxruntime-web` | 1.27.0 (top level) | MIT, Copyright (c) Microsoft Corporation | A direct dependency (pinned). Its JavaScript is bundled; the wasm it loads at runtime is the 1.22.0 build above, because `src/vendor/model.ts` sets `ort.env.wasm.wasmPaths` to `Settings.BASE_ASSET_PATH.ONNX_RUNTIME` |
| `onnxruntime-common` | 1.21.0 | MIT | Dependency of `onnxruntime-web` (installed by npm, not listed in `package.json`) |
| `@ricky0123/vad-web` | 0.0.24 | ISC, Copyright (c) 2022-present ricky0123 | A direct dependency (pinned); it brings its own `onnxruntime-web` 1.14.0 |
| `llama-tokenizer-js` | 1.2.2 | MIT, Copyright 2023 belladore.ai | A direct dependency (pinned); used by `src/vendor/model.ts` to decode tokens |

`@moonshine-ai/moonshine-js` is not a dependency: no source file imports it. Its MIT-licensed source is the origin of the vendored files in section 4 (copied from version 0.1.29).

## 4. Vendored source

`src/vendor/constants.ts`, `error.ts`, `log.ts`, `model.ts` and `transcriber.ts` are copies of
`@moonshine-ai/moonshine-js` 0.1.29 `src/`, with local edits (listed in the header of each file). Compared with the
installed package, `constants.ts`, `error.ts` and `log.ts` differ only by the header; `model.ts` and `transcriber.ts` carry the
edits. They are MIT, Copyright (c) 2025 Useful Sensors, Inc. Each file now carries a notice header and the license text
is in [src/vendor/LICENSE](../src/vendor/LICENSE). `src/vendor/pre-roll.ts` is original to this project.

## 5. Development dependencies (not shipped in the build)

| Package | Version | License |
|---|---|---|
| `vite` | 8.2.2 | MIT, Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| `typescript` | 6.0.3 | Apache-2.0 |
| `playwright-core` | 1.63.0 | Apache-2.0 |

`public/icons.svg` is byte-identical to the file in `packages/create-vite/template-vanilla-ts/public`
of https://github.com/vitejs/vite (compared on 2026-10-05), so it falls under the Vite MIT license. It is not
referenced by the app. The Vite template's `favicon.svg`, which this page used as its tab icon before the themes, is gone.

## 6. Not shipped, used by the user's browser

The Web Speech API (`speechSynthesis`) uses the voices the user's browser and operating system provide. Nothing is
downloaded or bundled by Nutq. An online browser voice (such as Google voices in Chrome or Microsoft online voices in Edge)
is a service of the browser's vendor, not of Nutq: the browser sends the reply text to that provider to be spoken.

## 7. Container images used by `deploy/` (not shipped, pulled by Docker)

The Docker Compose setup in [deploy/](../deploy/README.md) pulls two images when someone runs it. Nothing from them is
copied into this repository or into the page. Checked on 2026-10-19.

| Image | Pinned digest | License |
|---|---|---|
| `ghcr.io/zeroclaw-labs/zeroclaw` (ZeroClaw 0.8.5, Debian bookworm base) | `sha256:1876f4cfc85d1fd3f418e0607fc9207ef6525113e985092ac09b8dcd179df05e` | **TBD**: the image has no license label and no license file outside Debian's package docs (`/usr/share/doc`), and the upstream repository was not checked |
| `public.ecr.aws/docker/library/node:22-bookworm-slim` (Node.js 22.23.3), the Docker official image mirrored on ECR | `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` | Node.js: MIT, read from `/usr/local/LICENSE` in the image; its Debian packages keep their own licenses under `/usr/share/doc` |

`deploy/capture-speech.sh` also expects system packages on the machine that runs it (PulseAudio, speech-dispatcher,
espeak-ng, Xvfb). The script does not install them; they come from that machine's own package manager.

## 8. Fetched locally, not shipped: the optional tiny-tts voice

`?tts=tiny` (src/tts/, eval/tts/README.md) uses files that `scripts/fetch-tiny-tts.mjs` downloads into `local-assets/tiny-tts/`,
each pinned and checked by SHA-256. The folder is gitignored and outside `public/`, so neither the repository nor a production
build contains them; the dev server serves them, and the `nutq` container has them only if they were fetched before it was
built. **They are not to be bundled or deployed until the model's terms in the first row are settled.** Checked on 2026-10-20.

| File | Source (pinned) | Size in bytes | SHA-256 | License | Evidence and what is unresolved |
|---|---|---|---|---|---|
| `tinytts.onnx` (the model, about 1.22 million weights, 44.1 kHz) | https://huggingface.co/backtracking/tiny-tts, revision `6d0cc902621451fcd47462b50ee0aabc6a852e25` | 6,510,795 | `2a12614685c76597d3eeec6772f2c9ce132001cf6ea8a80609f8db9fd7fb745f` | **Unresolved** | The Hugging Face repository has no model card and no license field. The GitHub repository https://github.com/tronghieuit/tiny-tts (commit `77c278f7a4659181bd7bcf5c5e07c768ae765147`, `LICENSE`: Apache-2.0, "Copyright 2025 tronghieuit") links to it as its model and its code downloads from it, but the license file covers that repository's own files, and this file was never in it. The repository's `config.json` names the training list `train_ljspeech.list`; the LJ Speech Dataset is public domain (https://keithito.com/LJ-Speech-Dataset/: "All text, audio, and annotations are in the public domain"), but no statement from the authors confirms the training data, or that no other data or pretrained model was used. To ask the author: the license of the Hugging Face weights, and the training data |
| `tinytts.p1.onnx`, `tinytts.p2.onnx`, `tinytts.p3.onnx` | made locally from `tinytts.onnx` by `scripts/prepare-tiny-tts.py` (split in three, ONNX Runtime 1.29.0 basic optimizations) | 2,196,184; 3,083,231; 1,029,000 | `9d8c2a19...92935`, `292426a2...8d4bb`, `9aba0a53...0070c` | as `tinytts.onnx` | Derived from the model, so the same terms. The hashes are from one run with onnx 1.23.2 and onnxruntime 1.29.0; other versions may write different bytes |
| `cmudict.rep` (CMU Pronouncing Dictionary 0.6 with syllable marks, 129,463 words) | `tiny_tts/text/cmudict.rep` in the tiny-tts repository, commit `77c278f` | 3,969,309 | `d127b5ce8b8e695732701e8efde04b9b0fa11991218b1fb9d21bd0c9264636aa` | CMU: "Use of this dictionary, for any research or commercial purpose, is completely unrestricted", acknowledgement requested | The file's own header (cmudict 0.6, 1998). The current CMUdict (https://github.com/cmusphinx/cmudict, commit `74790861f652b15e4ac49015a90074ad62a27690`) is under a BSD 2-clause style license that requires keeping its notice; this older release states no such condition. Kept with its header |
| `g2p_model.json` (the g2p_en 2.1.0 neural G2P weights, base64) | `npm-package/g2p_model.json` in the tiny-tts repository, commit `77c278f` | 4,486,462 | `b9bf424ae0d6fea011960032cee6615097db23ab71c5770576c9c44103f1b49f` | Apache-2.0, Kyubyong Park and Jongseok Kim | All twelve arrays are byte for byte those of `checkpoint20.npz` in the PyPI wheel `g2p_en-2.1.0-py3-none-any.whl` (SHA-256 `2a7aabf1fc7f270fcc3349881407988c9245173c2413debbe5432f4a4f31319f`), compared on 2026-10-20. License: `LICENSE.txt` of https://github.com/Kyubyong/g2p at commit `c6439c274c42b9724a7fee1dc07ca6a4c68a0538` (the Apache template, copyright line not filled in) and the wheel's metadata (author "Kyubyong Park & Jongseok Kim", Apache Software License). Fetched as `LICENSE-g2p` |
| `LICENSE-tiny-tts`, `LICENSE-g2p` | the two `LICENSE` files above, pinned | 8,144; 11,357 | `a0bf9483...b5b6`, `b40930bb...33e1` | | Kept next to the files they cover |

Code in `src/tts/` is Nutq's (MIT), with three borrowed pieces credited in its comments: the 219-symbol table and the English
language and tone offsets (identical in tiny-tts, Apache-2.0, and in MeloTTS, https://github.com/myshell-ai/MeloTTS commit
`209145371cff8fc3bd60d7be902ea69cbdb7965a`, MIT, "Copyright (c) 2024 MyShell.ai"; tiny-tts's repository does not credit
MeloTTS), the order of the pronunciation steps (tiny-tts), and the GRU decoding procedure of g2p_en (written anew here, not
copied). The text normalization in `src/tts/tiny-text.ts` was written for Nutq. The voice runs on the ONNX Runtime Web wasm
already listed in section 1, so it adds no runtime.

No part of this pipeline uses eSpeak or any GPL component: pronunciation is the dictionary plus the g2p_en network (checked in
tiny-tts's code at commit `77c278f`: no eSpeak or phonemizer import). tiny-tts's Python package depends on `g2p-en`, `nltk`,
`transformers` and `torch`, and its npm package on `onnxruntime-node`; neither is used by Nutq.

## 9. Not found

One license is missing, and it is in section 8: the tiny-tts model weights on Hugging Face have none, which is why they are
fetched locally and not shipped. In what Nutq ships, nothing was left without a license. Two gaps in the evidence are stated
in the table: the Moonshine weights have no license file at their download host, and the Silero model was not compared byte
for byte with the file in its upstream repository (only with the npm package copy).
