#!/usr/bin/env node
// Downloads the files the optional tiny-tts voice (?tts=tiny, src/tts/) needs into local-assets/tiny-tts/, each pinned to a
// revision and checked against its SHA-256. The folder is gitignored and outside public/, so a production build does not
// copy it: the model's license is not settled yet (docs/THIRD_PARTY.md, "Not bundled"). The dev server serves it.
//
//   node scripts/fetch-tiny-tts.mjs            the model, the pronunciation dictionary, the G2P weights and their licenses
//   node scripts/fetch-tiny-tts.mjs --fp16     also the FP16 export of the model (benchmark only)
//
// Files that are already there with the right hash are not downloaded again.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "local-assets", "tiny-tts");

const HF = "https://huggingface.co/backtracking/tiny-tts/resolve/6d0cc902621451fcd47462b50ee0aabc6a852e25";
const TINY = "https://raw.githubusercontent.com/tronghieuit/tiny-tts/77c278f7a4659181bd7bcf5c5e07c768ae765147";
const G2P = "https://raw.githubusercontent.com/Kyubyong/g2p/c6439c274c42b9724a7fee1dc07ca6a4c68a0538";

const FILES = [
  { name: "tinytts.onnx", url: `${HF}/tinytts.onnx`, sha256: "2a12614685c76597d3eeec6772f2c9ce132001cf6ea8a80609f8db9fd7fb745f" },
  // CMUdict 0.6 with syllable marks, the dictionary tiny-tts's own (Python) frontend reads. Its license is in its header.
  { name: "cmudict.rep", url: `${TINY}/tiny_tts/text/cmudict.rep`, sha256: "d127b5ce8b8e695732701e8efde04b9b0fa11991218b1fb9d21bd0c9264636aa" },
  // The g2p_en 2.1.0 weights (checkpoint20.npz), as base64 JSON in tiny-tts's npm package; byte for byte the same arrays.
  { name: "g2p_model.json", url: `${TINY}/npm-package/g2p_model.json`, sha256: "b9bf424ae0d6fea011960032cee6615097db23ab71c5770576c9c44103f1b49f" },
  { name: "LICENSE-tiny-tts", url: `${TINY}/LICENSE`, sha256: "a0bf9483191ed72cb7da99d604d655ec3394bb8293c7cc1608ca74d2e676b5b6" },
  { name: "LICENSE-g2p", url: `${G2P}/LICENSE.txt`, sha256: "b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1" },
];
const FP16 = { name: "tinytts_fp16.onnx", url: `${HF}/tinytts_fp16.onnx`, sha256: "e577bcf57d88337eee4cd665ca2bf254e6b782eb0354f15b708be828374cd8a9" };

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

mkdirSync(OUT, { recursive: true });
const files = process.argv.includes("--fp16") ? [...FILES, FP16] : FILES;
let failed = 0;
for (const f of files) {
  const path = join(OUT, f.name);
  if (existsSync(path) && sha256(readFileSync(path)) === f.sha256) {
    console.log(`ok       ${f.name} (already there)`);
    continue;
  }
  const res = await fetch(f.url);
  if (!res.ok) {
    console.error(`FAILED   ${f.name}: HTTP ${res.status} from ${f.url}`);
    failed++;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== f.sha256) {
    console.error(`FAILED   ${f.name}: SHA-256 ${sha256(buf)}, expected ${f.sha256}`);
    failed++;
    continue;
  }
  writeFileSync(path, buf);
  console.log(`fetched  ${f.name} (${buf.length} bytes)`);
}
process.exit(failed ? 1 : 0);
