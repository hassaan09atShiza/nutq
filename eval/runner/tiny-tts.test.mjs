// Tests the tiny-tts voice's pure parts (src/tts/tiny-text.ts, tiny-g2p.ts, and the splitting and trimming in
// tiny-engine.ts) in a headless Chrome page served by Vite, with a small made-up lexicon. The engine's fallback is tested
// with a missing model. When the fetched files are present (scripts/fetch-tiny-tts.mjs), the neural G2P is also checked
// against the outputs of tiny-tts's own npm implementation; without them that test skips itself.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { REPO, makeTempDir, startVite } from "./vite-server.mjs";

const HAVE_ASSETS = existsSync(join(REPO, "local-assets/tiny-tts/g2p_model.json"));

let context;
let vite;
let page;

before(async () => {
  vite = await startVite();
  context = await chromium.launchPersistentContext(makeTempDir("nutq-tinytts-"), {
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto(vite.url);
});

after(async () => {
  await context?.close();
  vite?.child.kill();
});

const run = (fn, arg) => page.evaluate(fn, arg);

test("numbers, years and ordinals in words", async () => {
  const r = await run(async () => {
    const t = await import("/src/tts/tiny-text.ts");
    return {
      n: [0, 7, 15, 40, 99, 100, 101, 1249, 1000000, 2000500].map(t.numberWords),
      y: [1999, 1900, 1905, 2000, 2005, 2010, 2025].map(t.yearWords),
      o: [1, 2, 3, 4, 5, 8, 9, 12, 20, 21, 42, 100].map(t.ordinalWords),
    };
  });
  assert.deepEqual(r.n, ["zero", "seven", "fifteen", "forty", "ninety nine", "one hundred", "one hundred one", "one thousand two hundred forty nine", "one million", "two million five hundred"]);
  assert.deepEqual(r.y, ["nineteen ninety nine", "nineteen hundred", "nineteen oh five", "two thousand", "two thousand five", "twenty ten", "twenty twenty five"]);
  assert.deepEqual(r.o, ["first", "second", "third", "fourth", "fifth", "eighth", "ninth", "twelfth", "twentieth", "twenty first", "forty second", "one hundredth"]);
});

test("normalization of the benchmark's kinds of text", async () => {
  const cases = [
    ["It costs $1,249.99, about 15% more than the 3 models we tested, and weighs 2.5 kg.", "It costs one thousand two hundred forty nine dollars and ninety nine cents, about fifteen percent more than the three models we tested, and weighs two point five kilograms."],
    ["The meeting moved from Monday, March 3rd, 2025 to 10:30 am on April 15.", "The meeting moved from Monday, March third, twenty twenty five to ten thirty A M on April fifteenth."],
    ["Dr. Smith from the U.S. office said the API runs on the CPU, e.g. on a laptop, at 44.1 kHz.", "doctor Smith from the U.S. office said the API runs on the CPU, for example on a laptop, at forty four point one kilohertz."],
    ["Call me at 9:05 pm or at 10:00.", "Call me at nine oh five P M or at ten o'clock."],
    ["$1 and $0.50 and $2.5 million; 1 kg.", "one dollar and fifty cents and two point five million dollars, one kilogram."],
    ["Bring pens, paper, etc. Then wait.", "Bring pens, paper, et cetera. Then wait."],
    ["It fell to -3 degrees (really) - twice.", "It fell to minus three degrees really, twice."],
    ["Meet on 15 April at #2.", "Meet on fifteenth April at number two."],
    ["José and Zoë \u2014 twice.", "Jose and Zoe, twice."],
  ];
  const got = await run(async (cases) => {
    const t = await import("/src/tts/tiny-text.ts");
    return cases.map(([raw]) => t.normalizeText(raw));
  }, cases);
  assert.deepEqual(got, cases.map(([, want]) => want));
});

test("pronunciation: dictionary, apostrophes and hyphens as in training, acronyms spelled, joined names split", async () => {
  const r = await run(async () => {
    const g = await import("/src/tts/tiny-g2p.ts");
    const lex = g.parseRep(["## a comment", "DON  D AA1 N", "T  T IY1", "HELLO  HH AH0 - L OW1", "ZERO  Z IY1 - R OW0", "CLAW  K L AO1", "US  AH1 S", "NASA  N AE1 - S AH0", "NORTH  N AO1 R TH", "WEST  W EH1 S T", ""].join("\n"));
    const phones = (text) => {
      const trace = [];
      const p = g.textToPhones(text, lex, null, trace);
      return { phones: p.phones.join(" "), tones: p.tones.join(" "), trace: trace.map((t) => `${t.word}:${t.from}`).join(" ") };
    };
    return {
      lexSize: lex.size,
      hello: phones("Hello, don't."),
      acronyms: phones("U.S. API US NASA"),
      joined: phones("ZeroClaw north-west"),
      script: phones("Hello نطق, \"hello\"."),
      ids: g.toModelIds({ phones: ["_", "hh", "ah", "_"], tones: [0, 0, 1, 0] }),
      symbols: [g.SYMBOLS.length, g.SYMBOLS.indexOf("_"), g.SYMBOLS.indexOf("UNK"), g.SYMBOLS.indexOf("ah")],
    };
  });
  assert.equal(r.lexSize, 9);
  assert.deepEqual(r.hello, { phones: "_ hh ah l ow , d aa n ' t iy . _", tones: "0 0 1 0 2 0 0 2 0 0 0 2 0 0", trace: "Hello:dictionary don:dictionary t:dictionary" });
  assert.equal(r.acronyms.phones, "_ y uw eh s ey p iy ay y uw eh s n ae s ah _");
  assert.equal(r.acronyms.trace, "U.S.:spelled API:spelled US:spelled NASA:dictionary");
  assert.equal(r.joined.phones, "_ z iy r ow k l ao n ao r th - w eh s t _");
  assert.equal(r.script.phones, "_ hh ah l ow , hh ah l ow . _"); // another script and quotes are dropped, not sent as UNK
  assert.deepEqual(r.ids, { x: [0, 0, 0, 49, 0, 23, 0, 0, 0], tone: [0, 7, 0, 7, 0, 8, 0, 7, 0], language: [0, 2, 0, 2, 0, 2, 0, 2, 0] });
  assert.deepEqual(r.symbols, [219, 0, 218, 23]);
});

test("utterances are cut into sentences, and long sentences at their commas", async () => {
  const r = await run(async () => {
    const e = await import("/src/tts/tiny-engine.ts");
    const long = "It costs one thousand two hundred forty nine dollars and ninety nine cents, about fifteen percent more than the three models we tested, and weighs two point five kilograms.";
    return {
      two: e.splitSentences("The capital of France is Paris. Would you like to know more about it?"),
      long: e.splitSentences(long),
      longText: long,
      trim: e.trimBounds(Float32Array.from([0, 0, 0, 0.5, 0.2, 0, 0, 0, 0, 0]), 100, 0.01, 0.02),
      silent: e.trimBounds(new Float32Array(10), 100),
    };
  });
  assert.deepEqual(r.two, [{ text: "The capital of France is Paris.", ends: true }, { text: "Would you like to know more about it?", ends: true }]);
  assert.deepEqual(r.long.map((p) => p.ends), [false, true]);
  assert.ok(r.long.every((p) => p.text.length <= 120), JSON.stringify(r.long));
  assert.equal(r.long.map((p) => p.text).join(" "), r.longText);
  assert.deepEqual(r.trim, [2, 7]);
  assert.deepEqual(r.silent, [0, 0]);
});

test("without its model files the engine speaks through the fallback", async () => {
  const r = await run(async () => {
    const { tinyEngine } = await import("/src/tts/tiny-engine.ts");
    const calls = [];
    const fallback = { name: "fake", speak: (text, onStart, onEnd) => (calls.push(text), onStart({}), onEnd()), cancel: () => calls.push("cancel") };
    const engine = tinyEngine({ base: "/no-such-folder/", wasmPaths: "/vendor/onnxruntime-web-1.22.0/", fallback, warmup: false });
    const ended = await new Promise((resolve) => engine.speak("Hello there.", () => {}, () => resolve(true), () => resolve(false)));
    const loaded = await engine.ready.then(() => "loaded", (e) => `failed: ${e.message}`);
    engine.speak("Second.", () => {}, () => {}, () => {});
    engine.cancel();
    engine.worker.terminate();
    return { ended, loaded, calls };
  });
  assert.equal(r.ended, true);
  assert.match(r.loaded, /^failed: missing .*no-such-folder/);
  assert.deepEqual(r.calls, ["Hello there.", "Second.", "cancel"]);
});

test("the neural G2P gives tiny-tts's own outputs for words the dictionary lacks", { skip: !HAVE_ASSETS && "local-assets/tiny-tts not fetched" }, async () => {
  const got = await run(async () => {
    const g = await import("/src/tts/tiny-g2p.ts");
    const model = g.parseG2pModel(await (await fetch("/local-assets/tiny-tts/g2p_model.json")).json());
    return Object.fromEntries(["ayesha", "nutq", "zeroclaw", "kilohertz", "hassaan"].map((w) => [w, g.predict(model, w).join(" ")]));
  });
  // From npm tiny-tts 5.0.1's g2p_predict.js (whose weights are g2p_en 2.1.0's), run once on these words.
  assert.deepEqual(got, {
    ayesha: "AY1 SH AH0",
    nutq: "N AH1 T K",
    zeroclaw: "Z ER0 OW1 K AO0 L",
    kilohertz: "K IH1 L AH0 HH ER0 T S",
    hassaan: "HH AE1 S AH0 N",
  });
});
