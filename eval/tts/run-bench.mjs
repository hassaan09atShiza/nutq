// Drives the tiny-tts benchmark page (eval/tts/bench.html) in Chrome and writes what it measured, plus what the page cannot see:
// the bytes each asset took over the wire, and the memory of the browser's processes (Linux /proc, sampled every 250 ms).
//
//   node eval/tts/run-bench.mjs [--threads 1] [--model split] [--opt all] [--arena 1] [--pattern 1] [--runs 3] [--no-play] [--label name]
//                               [--out eval/tts/results] [--samples <dir>] [--url http://127.0.0.1:5173/]
//
// Needs `npm install`, `node scripts/fetch-tiny-tts.mjs`, and Chrome in CHROME_BIN. Without --url it starts its own dev
// server. Two page loads in one fresh profile: a cold one (empty cache: download, compile, session) that runs everything,
// then a warm reload (files from the HTTP cache) that only times loading and one synthesis. The WAV of each text's last
// run is written to --samples (default: a samples folder next to the JSON); they are the browser's own output.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { REPO, makeTempDir, startVite } from "../runner/vite-server.mjs";

const { values: args } = parseArgs({
  options: {
    threads: { type: "string", default: "1" },
    model: { type: "string", default: "split" },
    opt: { type: "string", default: "all" },
    arena: { type: "string", default: "1" },
    pattern: { type: "string", default: "1" },
    runs: { type: "string", default: "3" },
    "no-play": { type: "boolean", default: false },
    label: { type: "string" },
    out: { type: "string", default: join(REPO, "eval/tts/results") },
    samples: { type: "string" },
    url: { type: "string" },
  },
});
const label = args.label ?? `${new Date().toISOString().slice(0, 10)}-${args.model.replace(/\.onnx$/, "")}-${args.opt}-t${args.threads}`;

// --- Browser process memory, from /proc: the Chrome process started with this run's profile and all its descendants
// (renderers are children of the zygote, not of the browser, and do not carry the profile on their command line). ---
const profile = makeTempDir("nutq-tts-bench-");
function chromeProcesses() {
  const procs = new Map();
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      procs.set(Number(pid), { ppid, cmd: readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0") });
    } catch {
      // the process ended while being read
    }
  }
  const root = [...procs].find(([, p]) => p.cmd.includes(`--user-data-dir=${profile}`) && !p.cmd.join(" ").includes("--type="));
  if (!root) return [];
  const tree = new Set([root[0]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, p] of procs) if (!tree.has(pid) && tree.has(p.ppid)) (tree.add(pid), (grew = true));
  }
  const out = [];
  for (const pid of tree) {
    let rollup;
    try {
      rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    } catch {
      continue;
    }
    // Chrome rewrites its children's command lines into one space-separated string, so search rather than split.
    const cmd = procs.get(pid).cmd.join(" ");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+) kB`, "m").exec(rollup)?.[1] ?? 0);
    const type = /--type=(\S+)/.exec(cmd)?.[1] ?? (pid === root[0] ? "browser" : "other");
    const sub = /--utility-sub-type=(\S+)/.exec(cmd)?.[1];
    out.push({ pid, type: sub ? `${type}:${sub}` : type, pss_kb: kb("Pss"), rss_kb: kb("Rss") });
  }
  return out;
}
const mib = (kb) => Math.round((kb / 1024) * 10) / 10;
function snapshot() {
  const ps = chromeProcesses();
  const renderers = ps.filter((p) => p.type === "renderer");
  return {
    total_pss_mib: mib(ps.reduce((n, p) => n + p.pss_kb, 0)),
    renderer_pss_mib: mib(renderers.reduce((n, p) => n + p.pss_kb, 0)),
    renderer_rss_mib: mib(renderers.reduce((n, p) => n + p.rss_kb, 0)),
    processes: ps.map((p) => ({ type: p.type, pss_mib: mib(p.pss_kb), rss_mib: mib(p.rss_kb) })),
  };
}
const peak = { total_pss_mib: 0, renderer_pss_mib: 0, renderer_rss_mib: 0 };
const sampler = setInterval(() => {
  const s = snapshot();
  for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], s[k]);
}, 250);

// --- Run ---
const vite = args.url ? null : await startVite();
const base = args.url ?? vite.url;
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required"],
});
const page = context.pages()[0] ?? (await context.newPage());
const requests = [];
context.on("requestfinished", async (req) => {
  const url = req.url();
  if (!/local-assets|onnxruntime-web|tiny-worker|ort/.test(url)) return;
  const res = await req.response();
  const sizes = await req.sizes().catch(() => null);
  requests.push({ url: url.replace(base, "/"), status: res?.status(), from_cache: res ? (await res.headerValue("x-from-cache")) ?? null : null, encoding: res ? await res.headerValue("content-encoding") : null, body_bytes: sizes?.responseBodySize ?? null, header_bytes: sizes?.responseHeadersSize ?? null });
});

async function run(query, phaseSnapshots) {
  const url = new URL("eval/tts/bench.html", base);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  await page.goto(url.toString());
  let last = "";
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const b = await page.evaluate(() => window.__bench);
    if (b && b.status !== last) {
      last = b.status;
      phaseSnapshots[last] = snapshot();
    }
    if (b && (b.status === "done" || b.status === "failed")) return b;
    if (Date.now() > deadline) throw new Error(`timed out in phase ${last}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// The dev server optimizes dependencies on the first request that needs them and then reloads the page, which would cut a
// measured run short. One throwaway load in another profile gets that done first; the measured profile stays cold.
{
  const warmup = await chromium.launchPersistentContext(makeTempDir("nutq-tts-bench-warmup-"), { executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome", headless: true });
  const p = warmup.pages()[0] ?? (await warmup.newPage());
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await p.goto(new URL(`eval/tts/bench.html?runs=0&play=0&model=${args.model}`, base).toString());
      await p.waitForFunction(() => ["done", "failed"].includes(window.__bench?.status), null, { timeout: 120000 });
      break;
    } catch {
      // reloaded by the dev server: load again
    }
  }
  await warmup.close();
}

const query = { threads: args.threads, model: args.model, opt: args.opt, arena: args.arena, pattern: args.pattern, runs: args.runs, play: args["no-play"] ? "0" : "1" };
const coldMemory = {};
const t0 = Date.now();
const cold = await run(query, coldMemory);
const coldRequests = requests.splice(0);
const coldPeak = { ...peak };
const warmMemory = {};
const warm = await run({ ...query, runs: "1", play: "0" }, warmMemory);
const warmRequests = requests.splice(0);
clearInterval(sampler);
await context.close();
vite?.child.kill();

// --- Sizes on disk and what a compressing server would send (gzip -9, brotli 11), computed here, not measured on a server. ---
const modelFiles = (cold.load?.model_files ?? [args.model]).map((f) => `local-assets/tiny-tts/${f}`);
const assets = [...modelFiles, "local-assets/tiny-tts/cmudict.rep", "local-assets/tiny-tts/g2p_model.json", "public/vendor/onnxruntime-web-1.22.0/ort-wasm-simd-threaded.jsep.wasm", "public/vendor/onnxruntime-web-1.22.0/ort-wasm-simd-threaded.jsep.mjs"].map((p) => {
  const buf = readFileSync(join(REPO, p));
  return { path: p, bytes: buf.length, gzip9_bytes: gzipSync(buf, { level: 9 }).length, brotli11_bytes: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
});

const samplesDir = args.samples ?? join(args.out, `${label}-samples`);
mkdirSync(samplesDir, { recursive: true });
for (const item of cold.items ?? []) {
  writeFileSync(join(samplesDir, `${item.id}.wav`), Buffer.from(item.wav_base64, "base64"));
  delete item.wav_base64;
}
for (const item of warm.items ?? []) delete item.wav_base64;

const result = {
  label,
  date: new Date().toISOString(),
  wall_s: Math.round((Date.now() - t0) / 1000),
  chrome: (await import("node:child_process")).execFileSync(process.env.CHROME_BIN || "/usr/bin/google-chrome", ["--version"]).toString().trim(),
  host: { cpus: (await import("node:os")).cpus().map((c) => c.model)[0], cpu_count: (await import("node:os")).cpus().length, total_mem_mib: Math.round((await import("node:os")).totalmem() / 2 ** 20) },
  query,
  cold,
  warm: { load: warm.load, first_synthesis: warm.first_synthesis, status: warm.status, error: warm.error },
  requests: { cold: coldRequests, warm: warmRequests },
  assets,
  memory: { note: "PSS and RSS of the Chrome processes of this run's profile, from /proc; the dev server is not included", cold_by_phase: coldMemory, cold_peak: coldPeak, warm_by_phase: warmMemory },
  samples_dir: samplesDir,
};
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, `${label}.json`), JSON.stringify(result, null, 1));
console.log(`wrote ${join(args.out, `${label}.json`)} and ${samplesDir}/`);
console.log(JSON.stringify({ status: cold.status, error: cold.error, load: cold.load, warm_load: warm.load, first: cold.first_synthesis }, null, 1));
process.exit(cold.status === "done" ? 0 : 1);
