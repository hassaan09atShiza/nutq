// The tiny-tts voice's Web Worker: loads the model and the pronunciation data, then turns text into audio, one request at a
// time, off the page's main thread (Moonshine and the microphone stay responsive while it synthesizes).
//
// Messages in:  { type: "init", base, wasmPaths, threads, model }  then  { type: "synth", id, text, speed, normalized }  or  { type: "drop", below }
// `model` is "split" (the three files of scripts/prepare-tiny-tts.py, which load several times faster; the single
// tinytts.onnx when they are missing), or a file name, or several comma-separated files run one after the other.
// Messages out: { type: "ready", timings }  |  { type: "audio", id, audio, timings }  |  { type: "error", id?, message }
// "drop" discards queued requests with an id below `below` (a cancelled utterance); one already running finishes and is
// ignored by the engine.

import * as ort from "onnxruntime-web";
import { normalizeText } from "./tiny-text";
import { parseG2pModel, parseRep, textToPhones, toModelIds, type G2pModel, type Lexicon, type Trace } from "./tiny-g2p";

type Init = { type: "init"; base: string; wasmPaths: string; threads: number; model: string; optimization?: "disabled" | "basic" | "extended" | "all"; memArena?: boolean; memPattern?: boolean };
type Synth = { type: "synth"; id: number; text: string; speed?: number; normalized?: boolean };
type Drop = { type: "drop"; below: number };

const SPLIT = ["tinytts.p1.onnx", "tinytts.p2.onnx", "tinytts.p3.onnx"];

// The model's parts, run in order: each takes the inputs it names from the tensors so far and adds its outputs.
let sessions: ort.InferenceSession[] = [];
let lexicon: Lexicon | null = null;
let g2p: G2pModel | null = null;
let fp16 = false;
const queue: Synth[] = [];
let busy = false;

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

// A missing file can come back as the app's index.html with status 200 (a dev server or a single-page host does that), so an
// HTML answer counts as missing too.
async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  const html = (res.headers.get("content-type") ?? "").includes("text/html");
  if (!res.ok || html) throw new Error(`missing ${url} (HTTP ${res.status}${html ? ", an HTML page" : ""})`);
  return res;
}
const fetchBytes = (url: string) => fetchOk(url).then((r) => r.arrayBuffer());

async function init(msg: Init) {
  const t0 = performance.now();
  ort.env.wasm.wasmPaths = msg.wasmPaths;
  ort.env.wasm.numThreads = msg.threads;
  const text = (name: string) => fetchOk(`${msg.base}${name}`).then((r) => r.text());
  let files = msg.model === "split" ? SPLIT : msg.model.split(",");
  const models = Promise.all(files.map((f) => fetchBytes(`${msg.base}${f}`))).catch((e) => {
    if (msg.model !== "split") throw e;
    files = ["tinytts.onnx"];
    return Promise.all(files.map((f) => fetchBytes(`${msg.base}${f}`)));
  });
  const [modelBytes, rep, g2pJson] = await Promise.all([models, text("cmudict.rep"), text("g2p_model.json").then(JSON.parse)]);
  const fetched = performance.now();
  lexicon = parseRep(rep);
  g2p = parseG2pModel(g2pJson);
  const parsed = performance.now();
  // The smallest file first: the first session also starts ONNX Runtime's wasm (compiling it, unless the browser cached
  // the compiled code), so that cost shows up on its own in session_ms_each instead of inside the large part.
  const sessionMs: number[] = new Array(files.length).fill(0);
  sessions = new Array(files.length);
  const order = modelBytes.map((b, i) => [b.byteLength, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  for (const i of order) {
    const t = performance.now();
    sessions[i] = await ort.InferenceSession.create(modelBytes[i], { executionProviders: ["wasm"], graphOptimizationLevel: msg.optimization ?? "all", enableCpuMemArena: msg.memArena ?? true, enableMemPattern: msg.memPattern ?? true });
    sessionMs[i] = performance.now() - t;
  }
  fp16 = files.length === 1 && files[0].includes("fp16");
  const created = performance.now();
  post({
    type: "ready",
    timings: { fetch_ms: fetched - t0, parse_ms: parsed - fetched, session_ms: created - parsed, session_ms_each: sessionMs, first_created: files[order[0]], total_ms: created - t0, lexicon_words: lexicon.size, model_files: files, model_bytes: modelBytes.reduce((n, b) => n + b.byteLength, 0) },
  });
}

// float32 to IEEE half, for the FP16 export's inputs.
function toHalf(v: number): number {
  const f = new Float32Array([v]);
  const i = new Uint32Array(f.buffer)[0];
  const sign = (i >> 16) & 0x8000;
  const exp = ((i >> 23) & 0xff) - 127 + 15;
  const mant = (i >> 13) & 0x3ff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | mant;
}
function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

async function synth(msg: Synth) {
  if (sessions.length === 0 || !lexicon) throw new Error("not initialized");
  const t0 = performance.now();
  const normalized = msg.normalized ? msg.text : normalizeText(msg.text);
  const trace: Trace = [];
  const phones = textToPhones(normalized, lexicon, g2p, trace);
  const ids = toModelIds(phones);
  const t1 = performance.now();
  const T = ids.x.length;
  const i64 = (a: number[]) => new ort.Tensor("int64", BigInt64Array.from(a, (v) => BigInt(v)), [1, a.length]);
  const scalar = (v: number) => (fp16 ? new ort.Tensor("float16", Uint16Array.from([toHalf(v)]), [1]) : new ort.Tensor("float32", Float32Array.from([v]), [1]));
  const zeros = (d: number) => (fp16 ? new ort.Tensor("float16", new Uint16Array(d * T), [1, d, T]) : new ort.Tensor("float32", new Float32Array(d * T), [1, d, T]));
  const feeds: Record<string, ort.Tensor> = {
    x: i64(ids.x),
    x_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(T)]), [1]),
    sid: new ort.Tensor("int64", BigInt64Array.from([0n]), [1]),
    tone: i64(ids.tone),
    language: i64(ids.language),
    bert: zeros(1024),
    ja_bert: zeros(768),
    noise_scale: scalar(0.667),
    noise_scale_w: scalar(0.8),
    length_scale: scalar(1 / (msg.speed ?? 1)),
  };
  const tensors: Record<string, ort.Tensor> = { ...feeds };
  for (const s of sessions) Object.assign(tensors, await s.run(Object.fromEntries(s.inputNames.map((n) => [n, tensors[n]]))));
  const t2 = performance.now();
  const data = tensors.audio.data;
  const audio = data instanceof Float32Array ? data : Float32Array.from(data as Uint16Array, fromHalf);
  post(
    { type: "audio", id: msg.id, audio, timings: { g2p_ms: t1 - t0, run_ms: t2 - t1, tokens: T, phones: phones.phones.length, normalized, not_in_dictionary: trace.filter((t) => t.from !== "dictionary") } },
    [audio.buffer],
  );
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const msg = queue.shift() as Synth;
    try {
      await synth(msg);
    } catch (e) {
      post({ type: "error", id: msg.id, message: String((e as Error)?.message ?? e) });
    }
  }
  busy = false;
}

self.onmessage = (ev: MessageEvent<Init | Synth | Drop>) => {
  const msg = ev.data;
  if (msg.type === "init") init(msg).catch((e) => post({ type: "error", message: String((e as Error)?.message ?? e) }));
  else if (msg.type === "synth") {
    queue.push(msg);
    pump();
  } else if (msg.type === "drop") {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id < msg.below) queue.splice(i, 1);
  }
};
