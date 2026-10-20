// Pronunciation for the tiny-tts voice: normalized text (tiny-text.ts) to the model's input ids. Pure, no DOM; the
// dictionary and the G2P weights are passed in, so a test can use a small lexicon.
//
// It follows tiny-tts's own frontend (github.com/tronghieuit/tiny-tts, Apache-2.0: tiny_tts/text/english.py and the
// npm package's index.js), because the model was trained on what that frontend produces: a CMUdict 0.6 lookup per
// word, split at apostrophes and hyphens the way a BERT tokenizer splits them ("don't" is "don", "'", "t"), the g2p_en
// neural model for words the dictionary lacks, ARPAbet stress as the tone, and a blank (0) between all ids. The
// symbol table and the English language and tone offsets are tiny-tts's, which are MeloTTS's (MIT). Nutq's own
// additions: acronyms are spelled letter by letter, joined names are split into their words, and the GRU below is
// written here from the g2p_en algorithm.
//
// ponytail: homographs ("read", "live") take the dictionary's first pronunciation; g2p_en picks by part of speech,
// which needs a tagger this does not have.

// The model's 219 input symbols, in order (tiny-tts tiny_tts/text/symbols.py, identical to MeloTTS melo/text/symbols.py).
export const SYMBOLS = ["_", '"', "(", ")", "*", "/", ":", "AA", "E", "EE", "En", "N", "OO", "Q", "V", "[", "\\", "]", "^", "a", "a:", "aa", "ae", "ah", "ai", "an", "ang", "ao", "aw", "ay", "b", "by", "c", "ch", "d", "dh", "dy", "e", "e:", "eh", "ei", "en", "eng", "er", "ey", "f", "g", "gy", "h", "hh", "hy", "i", "i0", "i:", "ia", "ian", "iang", "iao", "ie", "ih", "in", "ing", "iong", "ir", "iu", "iy", "j", "jh", "k", "ky", "l", "m", "my", "n", "ng", "ny", "o", "o:", "ong", "ou", "ow", "oy", "p", "py", "q", "r", "ry", "s", "sh", "t", "th", "ts", "ty", "u", "u:", "ua", "uai", "uan", "uang", "uh", "ui", "un", "uo", "uw", "v", "van", "ve", "vn", "w", "x", "y", "z", "zh", "zy", "~", "æ", "ç", "ð", "ø", "ŋ", "œ", "ɐ", "ɑ", "ɒ", "ɔ", "ɕ", "ə", "ɛ", "ɜ", "ɡ", "ɣ", "ɥ", "ɦ", "ɪ", "ɫ", "ɬ", "ɭ", "ɯ", "ɲ", "ɵ", "ɸ", "ɹ", "ɾ", "ʁ", "ʃ", "ʊ", "ʌ", "ʎ", "ʏ", "ʑ", "ʒ", "ʝ", "ʲ", "ˈ", "ˌ", "ː", "̃", "̩", "β", "θ", "ᄀ", "ᄁ", "ᄂ", "ᄃ", "ᄄ", "ᄅ", "ᄆ", "ᄇ", "ᄈ", "ᄉ", "ᄊ", "ᄋ", "ᄌ", "ᄍ", "ᄎ", "ᄏ", "ᄐ", "ᄑ", "ᄒ", "ᅡ", "ᅢ", "ᅣ", "ᅤ", "ᅥ", "ᅦ", "ᅧ", "ᅨ", "ᅩ", "ᅪ", "ᅫ", "ᅬ", "ᅭ", "ᅮ", "ᅯ", "ᅰ", "ᅱ", "ᅲ", "ᅳ", "ᅴ", "ᅵ", "ᆨ", "ᆫ", "ᆮ", "ᆯ", "ᆷ", "ᆸ", "ᆼ", "ㄸ", "!", "?", "…", ",", ".", "'", "-", "¿", "¡", "SP", "UNK"];
const SYMBOL_ID = new Map(SYMBOLS.map((s, i) => [s, i]));
const UNK = SYMBOL_ID.get("UNK") as number;
const EN_LANGUAGE = 2;
const EN_TONE_START = 7;

// Letter names, for acronyms spelled out (from CMUdict's single-letter entries, with "a" as the letter, not the article).
const LETTERS: Record<string, string[]> = {
  A: ["EY1"], B: ["B", "IY1"], C: ["S", "IY1"], D: ["D", "IY1"], E: ["IY1"], F: ["EH1", "F"], G: ["JH", "IY1"], H: ["EY1", "CH"],
  I: ["AY1"], J: ["JH", "EY1"], K: ["K", "EY1"], L: ["EH1", "L"], M: ["EH1", "M"], N: ["EH1", "N"], O: ["OW1"], P: ["P", "IY1"],
  Q: ["K", "Y", "UW1"], R: ["AA1", "R"], S: ["EH1", "S"], T: ["T", "IY1"], U: ["Y", "UW1"], V: ["V", "IY1"],
  W: ["D", "AH1", "B", "AH0", "L", "Y", "UW0"], X: ["EH1", "K", "S"], Y: ["W", "AY1"], Z: ["Z", "IY1"],
};
// All-capital words that are spelled even though the dictionary has them as words ("US" is "us" there, "AI" is "ai").
const SPELLED = new Set(["US", "AI", "IT", "PC", "TV", "UK", "EU", "UN", "ID", "OS"]);
const PUNCTUATION = new Set([",", ".", "!", "?", "…", "'", "-"]);

export type Lexicon = Map<string, string[]>;

// CMUdict in the ".rep" layout: "WORD  PH PH - PH PH", "##" comment lines, syllable marks dropped.
export function parseRep(text: string): Lexicon {
  const lex: Lexicon = new Map();
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.includes("  ")) continue;
    const [word, pron] = line.split("  ");
    if (!lex.has(word)) lex.set(word, pron.trim().split(/\s+/).filter((p) => p !== "-"));
  }
  return lex;
}

// --- The g2p_en neural model (Park and Kim, Apache-2.0): a GRU encoder and decoder over letters, greedy decoding. ---

export type G2pModel = {
  graphemes: string[];
  phonemes: string[];
  hidden: number;
  w: Record<string, Float32Array>; // row-major, shapes as in g2p_model.json
};

function fromBase64(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

// g2p_model.json: { name: { shape, data: base64 float32 little-endian }, graphemes, phonemes }.
export function parseG2pModel(json: Record<string, unknown>): G2pModel {
  const w: Record<string, Float32Array> = {};
  for (const name of ["enc_emb", "enc_w_ih", "enc_w_hh", "enc_b_ih", "enc_b_hh", "dec_emb", "dec_w_ih", "dec_w_hh", "dec_b_ih", "dec_b_hh", "fc_w", "fc_b"]) {
    w[name] = fromBase64((json[name] as { data: string }).data);
  }
  const hidden = (json.enc_w_hh as { shape: number[] }).shape[1];
  return { graphemes: json.graphemes as string[], phonemes: json.phonemes as string[], hidden, w };
}

// One GRU step, PyTorch gate order (r, z, n): h' = (1 - z) * n + z * h.
function gru(x: Float32Array, h: Float32Array, wih: Float32Array, whh: Float32Array, bih: Float32Array, bhh: Float32Array, H: number): Float32Array {
  const gi = new Float32Array(3 * H);
  const gh = new Float32Array(3 * H);
  const I = x.length;
  for (let r = 0; r < 3 * H; r++) {
    let a = bih[r];
    for (let c = 0, o = r * I; c < I; c++) a += wih[o + c] * x[c];
    gi[r] = a;
    let b = bhh[r];
    for (let c = 0, o = r * H; c < H; c++) b += whh[o + c] * h[c];
    gh[r] = b;
  }
  const out = new Float32Array(H);
  for (let i = 0; i < H; i++) {
    const r = 1 / (1 + Math.exp(-(gi[i] + gh[i])));
    const z = 1 / (1 + Math.exp(-(gi[H + i] + gh[H + i])));
    const n = Math.tanh(gi[2 * H + i] + r * gh[2 * H + i]);
    out[i] = (1 - z) * n + z * h[i];
  }
  return out;
}

const row = (m: Float32Array, i: number, n: number) => m.subarray(i * n, (i + 1) * n);

// ARPAbet for one lowercase word, as g2p_en's predict(): encode the letters and </s>, decode from <s> until </s> (at most 20).
export function predict(model: G2pModel, word: string): string[] {
  const { w, hidden: H } = model;
  const gi = (g: string) => (model.graphemes.indexOf(g) >= 0 ? model.graphemes.indexOf(g) : model.graphemes.indexOf("<unk>"));
  let h: Float32Array = new Float32Array(H);
  for (const g of [...word, "</s>"]) h = gru(row(w.enc_emb, gi(g), H), h, w.enc_w_ih, w.enc_w_hh, w.enc_b_ih, w.enc_b_hh, H);
  const out: string[] = [];
  let prev = model.phonemes.indexOf("<s>");
  const end = model.phonemes.indexOf("</s>");
  for (let step = 0; step < 20; step++) {
    h = gru(row(w.dec_emb, prev, H), h, w.dec_w_ih, w.dec_w_hh, w.dec_b_ih, w.dec_b_hh, H);
    let best = 0;
    let bestV = -Infinity;
    for (let p = 0; p < model.phonemes.length; p++) {
      let v = w.fc_b[p];
      for (let c = 0, o = p * H; c < H; c++) v += w.fc_w[o + c] * h[c];
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    if (best === end) break;
    out.push(model.phonemes[best]);
    prev = best;
  }
  return out;
}

// --- Words to phones ---

export type Phones = { phones: string[]; tones: number[] };

// "AH0" is "ah" with tone 1 (stress + 1); a consonant has tone 0. "v" becomes "V", as in tiny-tts's map_phoneme.
function pushArpabet(out: Phones, arpa: string[]) {
  for (const p of arpa) {
    const m = /^([A-Z]+)(\d)$/.exec(p);
    const ph = (m ? m[1] : p).toLowerCase();
    out.phones.push(ph === "v" ? "V" : SYMBOL_ID.has(ph) ? ph : "UNK");
    out.tones.push(m ? Number(m[2]) + 1 : 0);
  }
}

// Only the punctuation the model knows; anything else (another script, a stray symbol) is dropped rather than sent as UNK.
function pushPunct(out: Phones, ch: string) {
  if (!PUNCTUATION.has(ch)) return;
  out.phones.push(ch);
  out.tones.push(0);
}

// Where each word's pronunciation came from, for the benchmark: the dictionary, the neural G2P, or spelled letter by letter.
export type Trace = { word: string; from: "dictionary" | "neural" | "spelled" }[];

function wordPhones(out: Phones, word: string, lex: Lexicon, model: G2pModel | null, trace?: Trace) {
  const upper = word.toUpperCase();
  const known = lex.get(upper);
  if (/^[A-Z]{2,}$/.test(word) && (SPELLED.has(word) || !known)) {
    for (const letter of word) pushArpabet(out, LETTERS[letter]);
    trace?.push({ word, from: "spelled" });
  } else if (known) {
    pushArpabet(out, known);
    trace?.push({ word, from: "dictionary" });
  } else if (/^[a-z]+$/i.test(word) && model) {
    pushArpabet(out, predict(model, word.toLowerCase()));
    trace?.push({ word, from: "neural" });
  } else {
    for (const letter of upper) if (LETTERS[letter]) pushArpabet(out, LETTERS[letter]); // digits or symbols left over: letters only
    trace?.push({ word, from: "spelled" });
  }
}

// Normalized text to phones and tones, padded with "_" at both ends. Text that is not a word or one of . , ! ? … ' - is dropped.
export function textToPhones(text: string, lex: Lexicon, model: G2pModel | null, trace?: Trace): Phones {
  const out: Phones = { phones: ["_"], tones: [0] };
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const acronym = /^((?:[A-Za-z]\.){2,})([^A-Za-z]*)$/.exec(token); // "U.S." or "U.S.," : spelled
    if (acronym) {
      for (const letter of acronym[1].replace(/\./g, "").toUpperCase()) pushArpabet(out, LETTERS[letter]);
      trace?.push({ word: acronym[1], from: "spelled" });
      for (const ch of acronym[2].replace(/^\./, "")) pushPunct(out, ch);
      continue;
    }
    const m = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(token) as RegExpExecArray;
    for (const ch of m[1]) pushPunct(out, ch);
    // Apostrophes and hyphens inside a word split it, and are spoken as their own symbol (as the BERT tokenizer did in training).
    const parts = m[2].split(/(['-])/).filter(Boolean);
    for (const part of parts) {
      if (part === "'" || part === "-") pushPunct(out, part);
      // A joined name the dictionary lacks ("ZeroClaw") is read as its words ("Zero", "Claw").
      else if (!lex.has(part.toUpperCase()) && /[a-z][A-Z]/.test(part)) for (const w of part.split(/(?<=[a-z])(?=[A-Z])/)) wordPhones(out, w, lex, model, trace);
      else wordPhones(out, part, lex, model, trace);
    }
    for (const ch of m[3]) pushPunct(out, ch);
  }
  out.phones.push("_");
  out.tones.push(0);
  return out;
}

// The model's inputs: symbol, tone and language ids with a 0 between each and at both ends.
export function toModelIds(p: Phones): { x: number[]; tone: number[]; language: number[] } {
  const n = p.phones.length;
  const x = new Array<number>(2 * n + 1).fill(0);
  const tone = new Array<number>(2 * n + 1).fill(0);
  const language = new Array<number>(2 * n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    x[2 * i + 1] = SYMBOL_ID.get(p.phones[i]) ?? UNK;
    tone[2 * i + 1] = p.tones[i] + EN_TONE_START;
    language[2 * i + 1] = EN_LANGUAGE;
  }
  return { x, tone, language };
}
