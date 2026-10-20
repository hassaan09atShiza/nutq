// Text normalization for the tiny-tts voice: pure, no DOM, in the style of turn-policy.ts. Digits, symbols, times and common
// abbreviations become the words a reader would say, because the voice's pronunciation step (tiny-g2p.ts) only knows words.
// Written for Nutq, not ported: tiny-tts's Python frontend does the same job with code from keithito/tacotron and inflect,
// and its npm frontend does none of it (a "3" there goes to the neural G2P as a word).
//
// ponytail: English only and rule based. Not handled: dates written with slashes (04/15 is read as two numbers), Roman
// numerals, phone numbers (read as one large number), negative numbers other than a leading minus, and units other than
// the few in UNITS. Acronyms are left as they are; tiny-g2p.ts decides whether to spell them.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

function under1000(n: number): string {
  const words: string[] = [];
  if (n >= 100) {
    words.push(ONES[Math.floor(n / 100)], "hundred");
    n %= 100;
  }
  if (n >= 20) {
    words.push(TENS[Math.floor(n / 10)]);
    if (n % 10) words.push(ONES[n % 10]);
  } else if (n > 0 || words.length === 0) words.push(ONES[n]);
  return words.join(" ");
}

// A whole number in words, "one thousand two hundred forty nine". Larger than the scales go: read digit by digit.
export function numberWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n >= 1e15) return digitWords(String(n));
  if (n === 0) return "zero";
  const groups: string[] = [];
  for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
    const g = n % 1000;
    if (g) groups.unshift(scale ? `${under1000(g)} ${SCALES[scale]}` : under1000(g));
  }
  return groups.join(" ");
}

export function digitWords(digits: string): string {
  return [...digits].filter((c) => c >= "0" && c <= "9").map((c) => ONES[Number(c)]).join(" ");
}

// A year as people say it: 1999 "nineteen ninety nine", 2005 "two thousand five", 2025 "twenty twenty five", 1900 "nineteen hundred".
export function yearWords(y: number): string {
  if (y >= 2000 && y < 2010) return numberWords(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${numberWords(hi)} hundred`;
  return `${numberWords(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : numberWords(lo)}`;
}

const ORDINAL: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

export function ordinalWords(n: number): string {
  const words = numberWords(n).split(" ");
  const last = words.pop() ?? "";
  const ord = ORDINAL[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ord].join(" ");
}

// "1,249" or "2.5" or "44.1" in words. A four digit whole number from 1000 to 2099 without a comma is read as a year.
function numeral(raw: string, asYear = true): string {
  const [whole, frac] = raw.replace(/,/g, "").split(".");
  const n = Number(whole || "0");
  const head = asYear && frac === undefined && /^\d{4}$/.test(raw) && n >= 1000 && n < 2100 ? yearWords(n) : numberWords(n);
  return frac === undefined || frac === "" ? head : `${head} point ${digitWords(frac)}`;
}

const CURRENCY: Record<string, [string, string, string, string]> = {
  $: ["dollar", "dollars", "cent", "cents"],
  "£": ["pound", "pounds", "penny", "pence"],
  "€": ["euro", "euros", "cent", "cents"],
};

function money(symbol: string, amount: string, scale: string | undefined): string {
  const [one, many, centOne, centMany] = CURRENCY[symbol];
  if (scale) return `${numeral(amount, false)} ${scale} ${many}`;
  const [whole, frac] = amount.replace(/,/g, "").split(".");
  const units = Number(whole || "0");
  const cents = frac ? Math.round(Number(`0.${frac}`) * 100) : 0;
  const parts: string[] = [];
  if (units || !cents) parts.push(`${numberWords(units)} ${units === 1 ? one : many}`);
  if (cents) parts.push(`${numberWords(cents)} ${cents === 1 ? centOne : centMany}`);
  return parts.join(" and ");
}

// Spelled out after a number only ("2.5 kg"); the plural is dropped after exactly one.
const UNITS: Record<string, string> = {
  kg: "kilograms", g: "grams", mg: "milligrams", lb: "pounds", lbs: "pounds", km: "kilometers", cm: "centimeters", mm: "millimeters",
  mi: "miles", mph: "miles per hour", hz: "hertz", khz: "kilohertz", mhz: "megahertz", ghz: "gigahertz", kb: "kilobytes", mb: "megabytes",
  gb: "gigabytes", tb: "terabytes", ms: "milliseconds", sec: "seconds", min: "minutes", hrs: "hours", "°c": "degrees Celsius", "°f": "degrees Fahrenheit",
};

// Expanded only when followed by a full stop. "dr" before a name; "St." and "No." are left alone unless a number follows "No.".
const ABBREVIATIONS: Record<string, string> = {
  mr: "mister", mrs: "missus", ms: "miz", dr: "doctor", prof: "professor", jr: "junior", sr: "senior", vs: "versus",
  approx: "approximately", dept: "department", jan: "January", feb: "February", mar: "March", apr: "April", jun: "June", jul: "July",
  aug: "August", sep: "September", sept: "September", oct: "October", nov: "November", dec: "December",
};

const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

// The whole pipeline. The output keeps sentence punctuation (. , ? ! ' -) for the voice's pauses; ; and : become commas.
export function normalizeText(text: string): string {
  let s = ` ${text} `.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // "José" is "Jose": the dictionary has no accents
  s = s.replace(/[“”«»„"]/g, " ").replace(/[‘’`]/g, "'").replace(/[()[\]{}<>*_~^|\\]/g, " ");
  s = s.replace(/\s[\u2013\u2014-]\s|[\u2013\u2014]/g, ", ").replace(/\.{3,}/g, "…"); // en and em dashes, and a spaced hyphen
  s = s.replace(/\b(e)\.g\.(?=\s|,)/gi, "for example").replace(/\b(i)\.e\.(?=\s|,)/gi, "that is");
  s = s.replace(/\bno\.\s*(?=\d)/gi, "number ");
  s = s.replace(/\betc\.(?=\s*$|\s+[A-Z])/g, "et cetera.").replace(/\betc\b\.?/gi, "et cetera");
  s = s.replace(/\b([a-z]+)\.(?=\s)/gi, (m, w: string) => (ABBREVIATIONS[w.toLowerCase()] ?? m));
  // Times: 10:30, 9:05 pm, 10:00 am; then a bare "10 am".
  s = s.replace(/\b(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\b\.?)?/gi, (_m, h: string, mm: string, ap?: string) => {
    const hour = numberWords(Number(h));
    const min = Number(mm);
    const minutes = min === 0 ? (ap ? "" : " o'clock") : min < 10 ? ` oh ${ONES[min]}` : ` ${numberWords(min)}`;
    return `${hour}${minutes}${ap ? ` ${ap.toUpperCase()} M` : ""}`;
  });
  s = s.replace(/\b(\d{1,2})\s*([ap])\.?\s?m\b\.?/gi, (_m, h: string, ap: string) => `${numberWords(Number(h))} ${ap.toUpperCase()} M`);
  s = s.replace(new RegExp(String.raw`([$£€])\s?(${NUM})(?:\s+(thousand|million|billion|trillion)\b)?`, "gi"), (_m, sym: string, amt: string, scale?: string) => money(sym, amt, scale?.toLowerCase()));
  s = s.replace(new RegExp(String.raw`(${NUM})\s?%`, "g"), (_m, n: string) => `${numeral(n, false)} percent`);
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_m, n: string) => ordinalWords(Number(n)));
  // A day next to a month is an ordinal: "April 15" and "15 April" are "April fifteenth" and "fifteenth April".
  s = s.replace(new RegExp(String.raw`\b(${MONTHS})\s+(\d{1,2})\b(?![:.]\d)`, "g"), (_m, mo: string, d: string) => `${mo} ${ordinalWords(Number(d))}`);
  s = s.replace(new RegExp(String.raw`\b(\d{1,2})\s+(${MONTHS})\b`, "g"), (_m, d: string, mo: string) => `${ordinalWords(Number(d))} ${mo}`);
  s = s.replace(new RegExp(String.raw`(${NUM})\s?(°[cf]|[a-z]{1,3})\b`, "gi"), (m, n: string, unit: string) => {
    const name = UNITS[unit.toLowerCase()];
    if (!name) return m;
    const one = Number(n.replace(/,/g, "")) === 1;
    return `${numeral(n, false)} ${one && name.endsWith("s") && !name.includes(" ") ? name.slice(0, -1) : name}`;
  });
  s = s.replace(/(^|\s)-(?=\d)/g, "$1minus ");
  s = s.replace(new RegExp(NUM, "g"), (n) => numeral(n));
  s = s.replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/=/g, " equals ").replace(/@/g, " at ").replace(/#/g, " number ").replace(/%/g, " percent ");
  s = s.replace(/\//g, " ").replace(/[;:]/g, ",");
  return s.replace(/\s+/g, " ").replace(/\s+([,.!?…])/g, "$1").trim();
}
