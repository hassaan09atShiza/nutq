// The tiny-tts voice as a TtsEngine (src/tts-engine.ts): a neural model running in a Web Worker (tiny-worker.ts) with
// ONNX Runtime Web on the CPU, played through Web Audio. Optional: main.ts uses it for ?tts=tiny, the browser voice
// stays the default.
//
// One speak() is one utterance, which the speech queue may have merged from several sentences. The engine splits it
// into sentences again, asks the worker for all of them at once (the worker takes them in order), and schedules each
// one on the AudioContext as soon as it is ready and the one before it is scheduled, so the next sentence is
// synthesized while the current one plays. onStart fires when the first sentence's audio is due, onEnd when the last
// one has played. cancel() stops what plays, forgets what was asked, and tells the worker to drop what it has not begun.
//
// The model pads every clip with silence (about 0.2 s before, 0.4 s after, measured on the fixed benchmark texts).
// The lead is cut to LEAD_KEEP_S, which brings the first sound forward, and the tail to TAIL_KEEP_S; SENTENCE_GAP_S is
// added between two sentences. Both are judgements (a short pause between sentences, about 0.3 s in all), not measured
// against listeners.

import type { StartInfo, TtsEngine } from "../tts-engine";
import { SentenceSplitter } from "../sentence-splitter";
import { normalizeText } from "./tiny-text";

export const SAMPLE_RATE = 44100;
const SILENCE = 0.01; // below this, a sample counts as silence when trimming
const LEAD_KEEP_S = 0.01;
const TAIL_KEEP_S = 0.15;
export const SENTENCE_GAP_S = 0.15;
export const CLAUSE_GAP_S = 0.03;

export type TinyReady = { fetch_ms: number; parse_ms: number; session_ms: number; total_ms: number; lexicon_words: number };

// One sentence's path from text to sound, in performance.now() milliseconds (the *_at fields) and durations.
export type TinyTiming = {
  utterance: number;
  index: number;
  chars: number;
  gap_s: number; // the pause designed before it: 0 for the first piece, else SENTENCE_GAP_S or CLAUSE_GAP_S
  requested_at: number; // handed to the worker
  audio_at: number; // its audio came back
  start_at: number; // when the AudioContext plays it (scheduled), on the performance.now() clock
  g2p_ms: number; // normalization and pronunciation, in the worker
  run_ms: number; // the model, in the worker
  wait_ms: number; // in the worker's queue or in transit: audio_at - requested_at - g2p_ms - run_ms
  audio_s: number; // after trimming
  raw_audio_s: number; // as the model produced it
  normalized: string;
};

export type TinyOptions = {
  base: string; // URL of the folder with tinytts.onnx, cmudict.rep and g2p_model.json
  wasmPaths: string; // ONNX Runtime's wasm folder (the one Moonshine already uses)
  threads?: number; // ONNX Runtime wasm threads; 1 unless the page is cross-origin isolated
  model?: string; // "split" (default: the prepared three-part model, or tinytts.onnx when it is missing), or a file name
  optimization?: "disabled" | "basic" | "extended" | "all"; // ONNX Runtime graph optimization at load, default "all"
  memArena?: boolean; // ONNX Runtime's CPU memory arena, default on
  memPattern?: boolean; // ONNX Runtime's memory pattern planning, default on
  warmup?: boolean; // synthesize one short sentence after loading, unheard, so the first reply does not pay the first run's cost
  onTiming?: (t: TinyTiming) => void;
  onLog?: (line: string) => void;
  fallback?: TtsEngine | null; // speaks instead when the model cannot be loaded
};

export type TinyEngine = TtsEngine & { ready: Promise<TinyReady>; worker: Worker };

// Where a clip's sound starts and ends once the silence is cut.
export function trimBounds(a: Float32Array, rate = SAMPLE_RATE, leadKeep = LEAD_KEEP_S, tailKeep = TAIL_KEEP_S): [number, number] {
  let first = 0;
  while (first < a.length && Math.abs(a[first]) < SILENCE) first++;
  if (first === a.length) return [0, 0];
  let last = a.length - 1;
  while (last > first && Math.abs(a[last]) < SILENCE) last--;
  return [Math.max(0, first - Math.round(leadKeep * rate)), Math.min(a.length, last + 1 + Math.round(tailKeep * rate))];
}

// A sentence longer than this is cut at its commas (or semicolons), into pieces of at least MIN_PIECE_CHARS where it can
// be, and one still longer than MAX_PIECE_CHARS at the space nearest its middle. A piece is synthesized whole before it
// plays, so long pieces delay the first sound and grow the worker's memory (the decoder's buffers scale with the
// clip's length, and wasm memory does not shrink). The numbers are judgements, not tuned.
export const LONG_SENTENCE_CHARS = 120;
const MIN_PIECE_CHARS = 30;
const MAX_PIECE_CHARS = 200;

function cut(sentence: string): string[] {
  if (sentence.length <= LONG_SENTENCE_CHARS) return [sentence];
  const pieces: string[] = [];
  let current = "";
  for (const clause of sentence.split(/(?<=[,;])\s+/)) {
    if (current && current.length >= MIN_PIECE_CHARS && current.length + clause.length + 1 > LONG_SENTENCE_CHARS) {
      pieces.push(current);
      current = clause;
    } else current = current ? `${current} ${clause}` : clause;
  }
  if (current) {
    if (current.length < MIN_PIECE_CHARS && pieces.length) pieces[pieces.length - 1] += ` ${current}`;
    else pieces.push(current);
  }
  return pieces.flatMap(function halve(p: string): string[] {
    if (p.length <= MAX_PIECE_CHARS) return [p];
    const mid = p.length / 2;
    let at = -1;
    for (let i = p.indexOf(" "); i >= 0; i = p.indexOf(" ", i + 1)) if (at < 0 || Math.abs(i - mid) < Math.abs(at - mid)) at = i;
    return at < 0 ? [p] : [...halve(p.slice(0, at)), ...halve(p.slice(at + 1))];
  });
}

// The pieces one utterance is synthesized in: its sentences, the long ones cut. `ends` tells whether a piece ends a sentence
// (the pause after it is SENTENCE_GAP_S) or only a clause (CLAUSE_GAP_S).
export function splitSentences(text: string): { text: string; ends: boolean }[] {
  const s = new SentenceSplitter();
  return [...s.push(`${text}\n`), ...s.flush()].flatMap((sentence) => cut(sentence).map((p, i, all) => ({ text: p, ends: i === all.length - 1 })));
}

export function tinyEngine(opts: TinyOptions): TinyEngine {
  const worker = new Worker(new URL("./tiny-worker.ts", import.meta.url), { type: "module" });
  // Absolute URLs: a relative wasm path inside the worker is rewritten by the dev server (?import) and fails to load.
  const abs = (u: string) => new URL(u, location.href).href;
  worker.postMessage({ type: "init", base: abs(opts.base), wasmPaths: abs(opts.wasmPaths), threads: opts.threads ?? 1, model: opts.model ?? "split", optimization: opts.optimization, memArena: opts.memArena, memPattern: opts.memPattern });
  let failed = false;
  let resolveReady!: (r: TinyReady) => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<TinyReady>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => {
    failed = true;
  });

  let ctx: AudioContext | null = null;
  let generation = 0;
  let nextId = 1;
  let warmupId = -1;
  // The utterance being spoken: its sentences, what has come back, and the sources playing.
  type Part = { id: number; index: number; text: string; ends: boolean; requested_at: number; audio?: Float32Array<ArrayBuffer>; timings?: Record<string, number | string>; audio_at?: number };
  let parts: Part[] = [];
  let scheduled = 0; // how many of `parts` are on the AudioContext
  let playhead = 0; // AudioContext time where the next sentence may start
  let sources: AudioBufferSourceNode[] = [];
  let callbacks: { onStart: (i: StartInfo) => void; onEnd: () => void; onError: (c: string | undefined) => void } | null = null;
  let utterance = 0;

  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data;
    if (msg.type === "ready") {
      opts.onLog?.(`tiny-tts ready in ${Math.round(msg.timings.total_ms)} ms (fetch ${Math.round(msg.timings.fetch_ms)}, parse ${Math.round(msg.timings.parse_ms)}, session ${Math.round(msg.timings.session_ms)})`);
      resolveReady(msg.timings);
      if (opts.warmup !== false) {
        warmupId = nextId++;
        worker.postMessage({ type: "synth", id: warmupId, text: "Hello there." });
      }
    } else if (msg.type === "error" && msg.id === undefined) {
      opts.onLog?.(`tiny-tts failed to load: ${msg.message}`);
      rejectReady(new Error(msg.message));
    } else if (msg.id === warmupId) {
      opts.onLog?.(msg.type === "audio" ? `tiny-tts warm-up run ${Math.round(msg.timings.run_ms)} ms` : `tiny-tts warm-up failed: ${msg.message}`);
    } else {
      const part = parts.find((p) => p.id === msg.id);
      if (!part) return; // from a cancelled utterance
      if (msg.type === "error") {
        opts.onLog?.(`tiny-tts synthesis failed: ${msg.message}`);
        const cb = callbacks;
        stop();
        cb?.onError("synthesis-failed");
        return;
      }
      part.audio = msg.audio;
      part.timings = msg.timings;
      part.audio_at = performance.now();
      schedule();
    }
  };
  // A worker that dies (out of memory, for one) answers nothing more: the utterance in progress fails instead of waiting forever.
  worker.onerror = (ev) => {
    opts.onLog?.(`tiny-tts worker error: ${ev.message}`);
    rejectReady(new Error(ev.message));
    const cb = callbacks;
    if (cb) {
      stop();
      cb.onError("synthesis-failed");
    }
  };

  function schedule() {
    const ac = ctx as AudioContext;
    while (scheduled < parts.length && parts[scheduled].audio) {
      const part = parts[scheduled];
      const raw = part.audio as Float32Array<ArrayBuffer>;
      const [from, to] = trimBounds(raw);
      const clip = raw.subarray(from, to);
      const lead = scheduled === 0 ? 0 : parts[scheduled - 1].ends ? SENTENCE_GAP_S : CLAUSE_GAP_S;
      const when = Math.max(ac.currentTime + 0.005, playhead + lead);
      const isLast = scheduled === parts.length - 1;
      if (clip.length > 0) {
        const buffer = ac.createBuffer(1, clip.length, SAMPLE_RATE);
        buffer.copyToChannel(clip, 0);
        const src = ac.createBufferSource();
        src.buffer = buffer;
        src.connect(ac.destination);
        src.start(when);
        sources.push(src);
        playhead = when + buffer.duration;
      }
      const startAt = performance.now() + (when - ac.currentTime) * 1000;
      const t = part.timings as Record<string, number | string>;
      opts.onTiming?.({
        utterance,
        index: part.index,
        chars: part.text.length,
        gap_s: lead,
        requested_at: part.requested_at,
        audio_at: part.audio_at as number,
        start_at: startAt,
        g2p_ms: t.g2p_ms as number,
        run_ms: t.run_ms as number,
        wait_ms: (part.audio_at as number) - part.requested_at - (t.g2p_ms as number) - (t.run_ms as number),
        audio_s: clip.length / SAMPLE_RATE,
        raw_audio_s: raw.length / SAMPLE_RATE,
        normalized: t.normalized as string,
      });
      if (scheduled === 0) {
        const cb = callbacks;
        const gen = generation;
        const info = { voice: "tiny-tts", engine_model: opts.model ?? "split", first_run_ms: Math.round(t.run_ms as number), output_latency_s: ac.outputLatency ?? null, base_latency_s: ac.baseLatency ?? null };
        setTimeout(() => gen === generation && cb?.onStart(info), Math.max(0, startAt - performance.now()));
      }
      if (isLast) {
        const cb = callbacks;
        const gen = generation;
        setTimeout(() => {
          if (gen !== generation) return;
          parts = [];
          callbacks = null;
          cb?.onEnd();
        }, Math.max(0, (playhead - ac.currentTime) * 1000));
      }
      part.audio = undefined;
      scheduled++;
    }
  }

  function stop() {
    generation++;
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        // never started: nothing to stop
      }
    }
    sources = [];
    parts = [];
    scheduled = 0;
    callbacks = null;
    worker.postMessage({ type: "drop", below: nextId });
  }

  return {
    name: "tiny-tts",
    ready,
    worker,
    speak(text, onStart, onEnd, onError) {
      if (failed && opts.fallback) return opts.fallback.speak(text, onStart, onEnd, onError);
      if (failed) return onError("load-failed");
      ctx ??= new AudioContext();
      if (ctx.state === "suspended") ctx.resume();
      stop();
      const gen = generation;
      utterance++;
      callbacks = { onStart, onEnd, onError };
      playhead = 0;
      const now = performance.now();
      // Normalized here, before the cut, so a sentence that is short as written but long as spoken ("$1,249.99") is cut too.
      parts = splitSentences(normalizeText(text)).map((s, index) => ({ id: nextId++, index, text: s.text, ends: s.ends, requested_at: now }));
      if (parts.length === 0) {
        callbacks = null;
        return onEnd();
      }
      // Asked only once the model is ready; until then the request would only wait in the worker's queue anyway.
      ready.then(
        () => {
          if (gen !== generation) return;
          for (const p of parts) {
            p.requested_at = performance.now();
            worker.postMessage({ type: "synth", id: p.id, text: p.text, normalized: true });
          }
        },
        () => {
          if (gen !== generation) return;
          callbacks = null;
          parts = [];
          if (opts.fallback) opts.fallback.speak(text, onStart, onEnd, onError);
          else onError("load-failed");
        },
      );
    },
    cancel() {
      stop();
      opts.fallback?.cancel();
    },
  };
}
