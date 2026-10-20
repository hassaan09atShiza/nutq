// The tiny-tts benchmark page: the same engine Nutq uses (src/tts/tiny-engine.ts), on fixed texts (texts.json), without
// ZeroClaw, Anthropic or the microphone. eval/tts/run-bench.mjs opens it and reads window.__bench; the URL parameters are
//   threads=1      ONNX Runtime wasm threads (more than 1 only works on a cross-origin isolated page)
//   model=split | tinytts.onnx | tinytts_fp16.onnx   (split: scripts/prepare-tiny-tts.py; the default)
//   runs=3         synthesis runs per text after the first one
//   play=1         also play every text through the engine (time to first sound, gaps, cancellation)
//   opt=all        ONNX Runtime graph optimization level when the session is created (disabled, basic, extended, all)
//   arena=1, pattern=1   ONNX Runtime's CPU memory arena and memory pattern (0 turns each off)
// Phases, in order: load (worker, fetch, parse, session), the first synthesis after load, the timed runs, playback.

import { tinyEngine, SAMPLE_RATE, trimBounds, type TinyTiming } from "../../src/tts/tiny-engine";
import texts from "./texts.json";

const params = new URLSearchParams(location.search);
const threads = Number(params.get("threads") ?? "1");
const model = params.get("model") ?? "split";
const runs = Number(params.get("runs") ?? "3");
const play = params.get("play") !== "0";
const optimization = (params.get("opt") ?? "all") as "disabled" | "basic" | "extended" | "all";
const memArena = params.get("arena") !== "0";
const memPattern = params.get("pattern") !== "0";

type Bench = Record<string, unknown> & { status: string; error?: string };
const bench: Bench = { status: "loading", params: { threads, model, runs, play, optimization, memArena, memPattern }, user_agent: navigator.userAgent, cross_origin_isolated: crossOriginIsolated, hardware_concurrency: navigator.hardwareConcurrency };
(window as unknown as { __bench: Bench }).__bench = bench;
const out = document.getElementById("out") as HTMLPreElement;
const show = () => (out.textContent = JSON.stringify(bench, (k, v) => (k === "wav_base64" ? `(${String(v).length} chars)` : v), 1));

const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function wavBase64(samples: Float32Array, rate: number): string {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function main() {
  const t0 = performance.now();
  const timings: TinyTiming[] = [];
  const engine = tinyEngine({ base: "/local-assets/tiny-tts/", wasmPaths: "/vendor/onnxruntime-web-1.22.0/", threads, model, optimization, memArena, memPattern, warmup: false, onTiming: (t) => timings.push(t) });
  const ready = await engine.ready;
  bench.load = { ...ready, wall_ms: round(performance.now() - t0), js_heap_bytes: heap() };
  bench.status = "loaded";
  show();

  // Synthesis only, straight to the worker (the engine ignores ids it did not ask for).
  let id = 1_000_000;
  const synth = (text: string) =>
    new Promise<{ audio: Float32Array; timings: Record<string, unknown>; wall_ms: number }>((resolve, reject) => {
      const my = id++;
      const t = performance.now();
      const onMsg = (ev: MessageEvent) => {
        if (ev.data.id !== my) return;
        engine.worker.removeEventListener("message", onMsg);
        if (ev.data.type === "error") reject(new Error(ev.data.message));
        else resolve({ audio: ev.data.audio, timings: ev.data.timings, wall_ms: performance.now() - t });
      };
      engine.worker.addEventListener("message", onMsg);
      engine.worker.postMessage({ type: "synth", id: my, text });
    });

  const first = await synth(texts.items[0].text);
  bench.first_synthesis = { id: texts.items[0].id, run_ms: round(first.timings.run_ms as number), g2p_ms: round(first.timings.g2p_ms as number), wall_ms: round(first.wall_ms), audio_s: round(first.audio.length / SAMPLE_RATE, 2) };
  bench.status = "synthesizing";
  show();

  const items = [];
  for (const item of texts.items) {
    const rs = [];
    let last: Awaited<ReturnType<typeof synth>> | null = null;
    for (let r = 0; r < runs; r++) {
      last = await synth(item.text);
      const audio_s = last.audio.length / SAMPLE_RATE;
      const [a, b] = trimBounds(last.audio);
      rs.push({ g2p_ms: last.timings.g2p_ms as number, run_ms: last.timings.run_ms as number, wall_ms: last.wall_ms, audio_s, trimmed_s: (b - a) / SAMPLE_RATE });
    }
    const runMs = median(rs.map((r) => r.run_ms));
    const g2pMs = median(rs.map((r) => r.g2p_ms));
    const audioS = median(rs.map((r) => r.audio_s));
    const l = last as Awaited<ReturnType<typeof synth>>;
    items.push({
      id: item.id,
      kind: item.kind,
      chars: item.text.length,
      normalized: l.timings.normalized,
      not_in_dictionary: l.timings.not_in_dictionary,
      tokens: l.timings.tokens,
      g2p_ms: round(g2pMs),
      run_ms: round(runMs),
      run_ms_all: rs.map((r) => round(r.run_ms)),
      audio_s: round(audioS, 2),
      trimmed_s: round(median(rs.map((r) => r.trimmed_s)), 2),
      rtf_model: round(runMs / 1000 / audioS, 3),
      rtf_with_g2p: round((runMs + g2pMs) / 1000 / audioS, 3),
      wav_base64: wavBase64(l.audio, SAMPLE_RATE),
    });
    bench.items = items;
    show();
  }
  bench.after_synthesis_js_heap_bytes = heap();

  if (play) {
    bench.status = "playing";
    show();
    const speak = (text: string) =>
      new Promise<{ called_at: number; started_at: number | null; ended_at: number; error: string | null; info: unknown }>((resolve) => {
        const r = { called_at: performance.now(), started_at: null as number | null, ended_at: 0, error: null as string | null, info: null as unknown };
        engine.speak(
          text,
          (info) => {
            r.started_at = performance.now();
            r.info = info;
          },
          () => resolve({ ...r, ended_at: performance.now() }),
          (code) => resolve({ ...r, ended_at: performance.now(), error: code ?? "error" }),
        );
      });
    const playback = [];
    for (const item of texts.items) {
      timings.length = 0;
      const r = await speak(item.text);
      const sentences = timings.map((t) => ({
        chars: t.chars,
        wait_ms: round(t.wait_ms),
        g2p_ms: round(t.g2p_ms),
        run_ms: round(t.run_ms),
        schedule_ms: round(t.start_at - t.audio_at), // from its audio being back to its scheduled start
        audio_s: round(t.audio_s, 2),
      }));
      // Silence beyond the designed pause between two pieces: 0 when the next piece was ready in time.
      const extraGaps = timings.slice(1).map((t, k) => round(Math.max(0, t.start_at - (timings[k].start_at + timings[k].audio_s * 1000) - t.gap_s * 1000)));
      playback.push({
        id: item.id,
        first_sound_ms: timings[0] ? round(timings[0].start_at - r.called_at) : null,
        on_start_ms: r.started_at === null ? null : round(r.started_at - r.called_at),
        total_ms: round(r.ended_at - r.called_at),
        error: r.error,
        info: r.info,
        sentences,
        extra_gap_ms: extraGaps,
      });
      bench.playback = playback;
      show();
    }

    // Cancellation: stop a long reply 800 ms after it starts, then speak a new one. Nothing from the first may play or end.
    timings.length = 0;
    const para = texts.items.find((i) => i.id === "paragraph")?.text ?? "";
    let firstEnded = false;
    let firstErrored = false;
    const calledFirst = performance.now();
    const startedFirst = await new Promise<number>((resolve) => {
      engine.speak(para, () => resolve(performance.now()), () => (firstEnded = true), () => (firstErrored = true));
    });
    await new Promise((r) => setTimeout(r, 800));
    const cancelAt = performance.now();
    const scheduledBefore = timings.length;
    engine.cancel();
    await new Promise((r) => setTimeout(r, 1500));
    const lateTimings = timings.length - scheduledBefore; // sentences of the cancelled reply scheduled after cancel()
    timings.length = 0;
    const next = await speak("Sorry, stopping there. Here is the short answer instead.");
    bench.cancellation = {
      first_on_start_ms: round(startedFirst - calledFirst),
      cancelled_after_start_ms: round(cancelAt - startedFirst),
      first_on_end_called: firstEnded,
      first_on_error_called: firstErrored,
      sentences_scheduled_after_cancel: lateTimings,
      next_first_sound_ms: timings[0] ? round(timings[0].start_at - next.called_at) : null,
      next_error: next.error,
      next_ended: next.ended_at > 0,
    };
    bench.after_playback_js_heap_bytes = heap();
  }
  bench.status = "done";
  show();
}

// Driven by Playwright (navigator.webdriver), audio may start at once; by hand, a click has to come first.
async function start() {
  if (!navigator.webdriver) {
    const button = document.getElementById("run") as HTMLButtonElement;
    button.hidden = false;
    bench.status = "waiting for the button";
    show();
    await new Promise((resolve) => button.addEventListener("click", resolve, { once: true }));
    button.hidden = true;
  }
  await main();
}

start().catch((e) => {
  bench.status = "failed";
  bench.error = String(e?.stack ?? e);
  show();
});
