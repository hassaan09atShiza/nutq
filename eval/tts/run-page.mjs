// The real Nutq page with a TTS engine, in Chrome, against a stub gateway that streams a fixed reply: the voice inside the app,
// with real Moonshine (a WAV file is the microphone) but without ZeroClaw or Anthropic. What it measures:
//   - from the reply's first chunk to the first sound, and the silences between pieces and utterances (the first_wait comparison);
//   - an interruption: the mic is tapped while the reply plays, and nothing of that reply may play afterwards;
//   - the browser's memory with Moonshine and the voice loaded (Linux /proc, the processes of this run's profile).
//
//   node eval/tts/run-page.mjs --say question.wav [--tts tiny|browser] [--first-wait 700] [--interrupt-ms 1500] [--label name]
//                              [--out eval/tts/results]
//
// The stream is a simulation: chunks of 9 characters every 26 ms after 650 ms, the pace of a real ZeroClaw 0.8.5 reply
// measured on 2026-10-19 (deploy/README.md: 1,903 characters, first chunk 668 ms, done 6.2 s after sending).

import http from "node:http";
import crypto from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { REPO, makeTempDir, startVite } from "../runner/vite-server.mjs";
import { frame, readFrames } from "../runner/page-harness.mjs";

const { values: args } = parseArgs({
  options: {
    say: { type: "string" },
    tts: { type: "string", default: "tiny" },
    "first-wait": { type: "string" },
    "interrupt-ms": { type: "string" },
    reply: { type: "string" },
    label: { type: "string" },
    out: { type: "string", default: join(REPO, "eval/tts/results") },
  },
});
if (!args.say) {
  console.error("run-page: --say question.wav is required (48 kHz mono works; it is played as the microphone)");
  process.exit(2);
}
const REPLY =
  args.reply ??
  "Paris is the capital of France. It sits on the Seine, in the north of the country, and has been the capital for most of the last thousand years. Would you like to hear about its history?";
const label = args.label ?? `${new Date().toISOString().slice(0, 10)}-page-${args.tts}-wait${args["first-wait"] ?? "default"}${args["interrupt-ms"] ? "-interrupt" : ""}`;

// --- Memory: the same /proc walk as run-bench.mjs. ---
const profile = makeTempDir("nutq-tts-page-");
function memory() {
  const procs = new Map();
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      procs.set(Number(pid), { ppid: Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]), cmd: readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ") });
    } catch {
      // ended while read
    }
  }
  const root = [...procs].find(([, p]) => p.cmd.includes(`--user-data-dir=${profile}`) && !p.cmd.includes("--type="));
  if (!root) return null;
  const tree = new Set([root[0]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, p] of procs) if (!tree.has(pid) && tree.has(p.ppid)) (tree.add(pid), (grew = true));
  }
  let total = 0;
  let renderer = 0;
  for (const pid of tree) {
    try {
      const kb = Number(/^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))?.[1] ?? 0);
      total += kb;
      if (/--type=renderer/.test(procs.get(pid).cmd)) renderer += kb;
    } catch {
      // ended while read
    }
  }
  return { total_pss_mib: Math.round(total / 102.4) / 10, renderer_pss_mib: Math.round(renderer / 102.4) / 10 };
}
const peak = { total_pss_mib: 0, renderer_pss_mib: 0 };
const sampler = setInterval(() => {
  const m = memory();
  if (m) for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], m[k]);
}, 250);

// --- Stub gateway: session_start on connect; each message frame gets the reply, streamed. ---
const server = http.createServer((_, res) => res.end("stub")).listen(0, "127.0.0.1");
const sent = [];
server.on("upgrade", (req, sock) => {
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.write(frame({ type: "session_start", session_id: "stub", resumed: false }));
  const state = { buf: Buffer.alloc(0) };
  sock.on("error", () => {});
  sock.on("data", (d) => {
    for (const msg of readFrames(state, d)) {
      if (msg.type !== "message") continue;
      sent.push(msg.content);
      let i = 0;
      const next = () => {
        if (sock.destroyed) return;
        if (i >= REPLY.length) return sock.write(frame({ type: "done", full_response: REPLY }));
        sock.write(frame({ type: "chunk", content: REPLY.slice(i, i + 9) }));
        i += 9;
        setTimeout(next, 26);
      };
      setTimeout(next, 650);
    }
  });
});
await new Promise((r) => server.once("listening", r));

const vite = await startVite();
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${args.say}%noloop`,
  ],
});
const page = context.pages()[0] ?? (await context.newPage());
const events = () => page.evaluate(() => [...document.getElementById("log").textContent.matchAll(/EVENT (\{.*\})/g)].map((m) => JSON.parse(m[1])));
const waitEvent = (name, ms) =>
  page.waitForFunction((n) => [...document.getElementById("log").textContent.matchAll(/EVENT (\{.*\})/g)].some((m) => JSON.parse(m[1]).event === n), name, { timeout: ms }).then(
    () => true,
    () => false,
  );

const result = { label, date: new Date().toISOString(), simulation: "the reply stream is simulated (see the file header); the page, Moonshine and the voice are real", tts: args.tts, first_wait: args["first-wait"] ?? null, reply_chars: REPLY.length };
try {
  const url = new URL(vite.url);
  url.searchParams.set("eval", "1");
  if (args.tts === "tiny") url.searchParams.set("tts", "tiny");
  if (args["first-wait"] !== undefined) url.searchParams.set("first_wait", args["first-wait"]);
  const t0 = Date.now();
  await page.goto(url.toString());
  await page.fill("#ws-url", `ws://127.0.0.1:${server.address().port}/ws/chat`);
  await page.fill("#agent-alias", "stub");
  await page.fill("#auth-token", "stub-token");
  await page.click("#connect-btn");
  await page.waitForFunction(() => !document.getElementById("mic-btn").disabled, null, { timeout: 180000 });
  result.moonshine_ready_ms = Date.now() - t0;
  if (args.tts === "tiny") result.tts_ready = (await waitEvent("tts_engine_ready", 60000)) ? (await events()).find((e) => e.event === "tts_engine_ready") : null;
  await page.waitForTimeout(1500); // let the warm-up synthesis finish before measuring memory
  result.memory_loaded = memory();
  await page.click("#mic-btn");
  const ended = (await waitEvent("done_received", 60000)) && (await waitEvent("tts_start", 30000));
  if (args["interrupt-ms"]) {
    await page.waitForTimeout(Number(args["interrupt-ms"]));
    result.interrupted_at_ms = Date.now();
    await page.click("#mic-btn");
    await page.waitForTimeout(3000);
  } else if (ended) {
    // tts_end comes after every utterance; the reply is over when every queued sentence has started and the last event is tts_end.
    await page
      .waitForFunction(
        () => {
          const evs = [...document.getElementById("log").textContent.matchAll(/EVENT (\{.*\})/g)].map((m) => JSON.parse(m[1]));
          const requested = evs.filter((e) => e.event === "tts_requested").length;
          const started = evs.filter((e) => e.event === "tts_sentence_start").reduce((n, e) => n + e.units, 0);
          const tts = evs.filter((e) => e.event.startsWith("tts_") && e.event !== "tts_chunk");
          return requested > 0 && started === requested && tts.at(-1)?.event === "tts_end";
        },
        null,
        { timeout: 90000 },
      )
      .catch(() => {});
  }
  await page.waitForTimeout(500);
  result.memory_after_reply = memory();
  const evs = await events();
  const at = (name) => evs.find((e) => e.event === name)?.timestamp_ms ?? null;
  const chunks = evs.filter((e) => e.event === "tts_chunk");
  result.sent = sent;
  result.transcript = evs.find((e) => e.event === "transcript_final")?.text ?? null;
  result.first_chunk_to_first_sound_ms = at("tts_start") && at("first_chunk_received") ? at("tts_start") - at("first_chunk_received") : null;
  result.first_sentence_to_first_sound_ms = at("tts_start") && at("tts_requested") ? at("tts_start") - at("tts_requested") : null;
  result.tts_start = evs.find((e) => e.event === "tts_start") ?? null;
  result.utterances = evs.filter((e) => e.event === "tts_sentence_start").map((e) => ({ index: e.index, units: e.units, chars: e.chars, waited_ms: e.waited_ms }));
  // Pieces in play order: the silence before each one, and how much of it is beyond the pause the engine meant to leave.
  result.pieces = chunks.map((c, k) => {
    const prev = chunks[k - 1];
    const silence = prev ? c.start_at - (prev.start_at + prev.audio_s * 1000) : null;
    return { utterance: c.utterance, index: c.index, chars: c.chars, wait_ms: Math.round(c.wait_ms), run_ms: Math.round(c.run_ms), audio_s: Math.round(c.audio_s * 100) / 100, silence_before_ms: silence === null ? null : Math.round(silence), extra_silence_ms: silence === null ? null : Math.max(0, Math.round(silence - (c.index === 0 ? 0 : c.gap_s * 1000))) };
  });
  result.ended = evs.some((e) => e.event === "tts_end");
  result.cancelled = evs.filter((e) => e.event === "tts_cancelled").map((e) => e.reason);
  if (result.interrupted_at_ms) {
    // performance.now() of the interruption is not known here; a piece logged (scheduled) after it shows up as a tts_chunk with a later timestamp.
    result.pieces_scheduled_after_interrupt = chunks.filter((c) => c.timestamp_ms > result.interrupted_at_ms).length;
  }
  result.errors = evs.filter((e) => ["tts_error", "js_error"].includes(e.event));
  result.memory_peak = { ...peak };
} catch (e) {
  result.error = String(e?.stack ?? e);
} finally {
  clearInterval(sampler);
  await context.close();
  vite.child.kill();
  server.close();
}
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, `${label}.json`), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
process.exit(result.error ? 1 : 0);
