// Drives the real Nutq page (the compose nutq service) against the real gateway in Chrome: connect with the saved token,
// wait for the speech model, and optionally press Test voice and/or speak one turn from a WAV file played as the
// microphone. Prints a JSON summary built from the page's eval events (dev server, ?eval=1). The token is typed into the
// page and never printed. Run from the repository root after `npm install` (playwright-core is a devDependency).
//
//   node deploy/page-check.mjs --token-file deploy/.local/gateway-token [--test-voice] [--say question.wav] [--headed]
//
// Chrome comes from CHROME_BIN (default /usr/bin/google-chrome). On Linux, --enable-speech-dispatcher is passed so local
// voices are listed; headless Chrome may list none, which the summary reports as it is.

import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values: args } = parseArgs({
  options: {
    "nutq-url": { type: "string", default: "http://127.0.0.1:5173/" },
    "gateway-url": { type: "string", default: "ws://127.0.0.1:42617/ws/chat" },
    agent: { type: "string", default: "default" },
    "token-file": { type: "string" },
    "test-voice": { type: "boolean", default: false },
    say: { type: "string" },
    headed: { type: "boolean", default: false },
    "turn-timeout-ms": { type: "string", default: "90000" },
  },
});
if (!args["token-file"]) {
  console.error("page-check: --token-file is required");
  process.exit(2);
}
const token = readFileSync(args["token-file"], "utf8").trim();
const redact = (s) => String(s).replaceAll(token, "<token>").replace(/zc_[0-9a-f]{8,}/g, "zc_<redacted>");

const chromeArgs = ["--no-first-run", "--no-default-browser-check", "--enable-speech-dispatcher", "--autoplay-policy=no-user-gesture-required"];
chromeArgs.push("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream");
if (args.say) chromeArgs.push(`--use-file-for-fake-audio-capture=${args.say}%noloop`);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "nutq-page-check-")), {
  executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
  headless: !args.headed,
  args: chromeArgs,
});
const page = context.pages()[0] ?? (await context.newPage());
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(redact(m.text()).slice(0, 300)));

const summary = { ok: false, checks: {} };
const events = () =>
  page.evaluate(() => [...document.getElementById("log").textContent.matchAll(/EVENT (\{.*\})/g)].map((m) => JSON.parse(m[1])));
const text = (id) => page.evaluate((id) => document.getElementById(id)?.textContent?.trim() ?? null, id);
const waitEvent = (names, ms) =>
  page
    .waitForFunction(
      (names) => [...document.getElementById("log").textContent.matchAll(/EVENT (\{.*\})/g)].some((m) => names.includes(JSON.parse(m[1]).event)),
      names,
      { timeout: ms },
    )
    .then(() => true, () => false);
const pick = (evs, name) => evs.filter((e) => e.event === name);

try {
  const url = new URL(args["nutq-url"]);
  url.searchParams.set("eval", "1");
  await page.goto(url.toString());
  await page.fill("#ws-url", args["gateway-url"]);
  await page.fill("#agent-alias", args.agent);
  await page.fill("#auth-token", token);
  const t0 = Date.now();
  await page.click("#connect-btn");
  const connected = await page
    .waitForFunction(() => document.getElementById("conn-status").textContent.includes("connected"), null, { timeout: 15000 })
    .then(() => true, () => false);
  summary.checks.connected = { ok: connected, status: await text("conn-status"), ms: Date.now() - t0 };
  const ready = await page
    .waitForFunction(() => !document.getElementById("mic-btn").disabled, null, { timeout: 180000 })
    .then(() => true, () => false);
  summary.checks.model_ready = { ok: ready, ms: Date.now() - t0, mic_hint: await text("mic-hint") };

  let evs = await events();
  summary.voices = pick(evs, "voice_list").at(-1) ?? { note: "no voice_list event (the browser listed no voices)" };
  summary.voice_hint = await text("voice-hint");
  summary.session_start = pick(evs, "session_start").length;

  if (args["test-voice"]) {
    await page.click("#voice-test");
    const ended = await waitEvent(["tts_end", "tts_error", "tts_skipped"], 30000);
    evs = await events();
    const start = pick(evs, "tts_start").at(-1) ?? null;
    const end = evs.filter((e) => ["tts_end", "tts_error", "tts_skipped"].includes(e.event)).at(-1) ?? null;
    summary.checks.test_voice = { ok: ended && end?.event === "tts_end", tts_start: start, end };
  }

  if (args.say) {
    // Listening starts on the tap; the WAV plays once from the moment the mic opens, and the turn ends by itself after
    // the text-dependent wait (auto_silence), as for a person who stops talking.
    await page.click("#mic-btn");
    const sent = await waitEvent(["ws_message_sent", "send_skipped"], 60000);
    const ended = sent && (await waitEvent(["done_received", "turn_error_frame", "turn_aborted", "turn_timeout"], Number(args["turn-timeout-ms"])));
    if (ended) await waitEvent(["tts_end", "tts_error", "tts_skipped"], 60000);
    evs = await events();
    const final = pick(evs, "transcript_final").at(-1) ?? null;
    summary.checks.voice_turn = {
      ok: pick(evs, "done_received").length > 0 && pick(evs, "tts_end").length > 0,
      transcript_final: final,
      sent: pick(evs, "ws_message_sent").at(-1) ?? null,
      end: evs.filter((e) => ["done_received", "turn_error_frame", "turn_aborted", "turn_timeout"].includes(e.event)).at(-1) ?? null,
      reply: (await text("reply-box"))?.slice(0, 600) ?? null,
      tts: evs.filter((e) => e.event.startsWith("tts_")).map((e) => ({ event: e.event, voice: e.voice, reason: e.reason, message: e.message })),
    };
  }

  const checks = Object.values(summary.checks);
  summary.ok = checks.length > 0 && checks.every((c) => c.ok);
} catch (e) {
  summary.error = redact(e?.message ?? e);
} finally {
  summary.console_errors = consoleErrors.slice(0, 10);
  summary.log_tail = redact(await text("log").catch(() => ""))
    .split("\n")
    .filter((l) => !l.includes("EVENT {"))
    .slice(-15);
  await context.close();
}
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
