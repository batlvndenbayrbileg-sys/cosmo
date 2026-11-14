/**
 * Find numbers in free text spoken/typed in English, Mongolian or a mix of both.
 * Used by the server to cross-check an LLM-extracted value against the speaker's own words
 * (matchesAnyNumber) — all medical numbers come from the speaker, never from the model.
 *
 * Known limits (documented, tested where noted):
 *  - "1,500" (comma + exactly three digits after 1-3 digits, not starting with 0) is read as
 *    a thousands separator = 1500; "36,6" / "36.6" are decimals.
 *  - English "one"/"a" can be pronouns ("the one thing" yields 1); the cross-check is only
 *    ever MORE permissive because of this, never stricter.
 *  - Latin-transliterated Mongolian ("doloo tsag") is not recognised.
 */
import { parseMnNumber } from "./mn";

export interface ExtractedNumber {
  value: number;
  start: number;
  end: number;
  text: string;
  kind: "digits" | "words";
}

type TokenClass = "digits" | "cyrillic" | "latin";

interface Token {
  text: string;
  lower: string;
  start: number;
  end: number;
  cls: TokenClass;
}

const TOKEN_RE = /\d+(?:[.,]\d+)?|\p{L}+/gu;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const MAX_WINDOW = 8;

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const t = m[0];
    const cls: TokenClass = /^\d/.test(t) ? "digits" : CYRILLIC_RE.test(t) ? "cyrillic" : "latin";
    out.push({ text: t, lower: t.toLowerCase(), start: m.index, end: m.index + t.length, cls });
  }
  return out;
}

/** numeric value of a single digit token ("36,6" → 36.6, "2,500" → 2500) */
function digitTokenValue(t: string): number {
  if (/^[1-9]\d{0,2}(,\d{3})+$/.test(t)) return Number(t.replace(/,/g, ""));
  return Number(t.replace(",", "."));
}

/* ───────────── English number words ───────────── */

const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const EN_DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
};

/** 0..99 from words: unit | teen | tens | tens unit */
function enBelowHundred(w: readonly string[]): number | null {
  if (w.length === 1) {
    if (w[0] in EN_UNITS) return EN_UNITS[w[0]];
    if (w[0] in EN_TENS) return EN_TENS[w[0]];
    return null;
  }
  if (w.length === 2 && w[0] in EN_TENS && w[1] in EN_UNITS && EN_UNITS[w[1]] >= 1 && EN_UNITS[w[1]] <= 9) {
    return EN_TENS[w[0]] + EN_UNITS[w[1]];
  }
  return null;
}

/** 0..999 from words, incl. "a hundred and ten" and colloquial "one twenty" (=120, one/two only) */
function enBelowThousand(words: readonly string[]): number | null {
  const w = [...words];
  const hundredAt = w.indexOf("hundred");
  if (hundredAt !== -1) {
    const head = w.slice(0, hundredAt);
    let hundreds: number | null = null;
    if (head.length === 1 && head[0] === "a") hundreds = 1;
    else if (head.length === 1 && head[0] in EN_UNITS && EN_UNITS[head[0]] >= 1 && EN_UNITS[head[0]] <= 9) {
      hundreds = EN_UNITS[head[0]];
    }
    if (hundreds === null) return null;
    let tail = w.slice(hundredAt + 1);
    if (tail.length > 0 && tail[0] === "and") tail = tail.slice(1);
    if (tail.length === 0) return hundreds * 100;
    const rest = enBelowHundred(tail);
    return rest === null || rest === 0 ? null : hundreds * 100 + rest;
  }
  // colloquial "one twenty five" = 125, "two ten" = 210 — only after "one"/"two" and a tens/teen word
  if (w.length >= 2 && (w[0] === "one" || w[0] === "two")) {
    const rest = enBelowHundred(w.slice(1));
    if (rest !== null && rest >= 10) return EN_UNITS[w[0]] * 100 + rest;
  }
  return enBelowHundred(w);
}

/** integer from words, incl. "thousand" ("two thousand five hundred") */
function enInteger(words: readonly string[]): number | null {
  const thousandAt = words.indexOf("thousand");
  if (thousandAt === -1) return enBelowThousand(words);
  const head = words.slice(0, thousandAt);
  let thousands: number | null;
  if (head.length === 1 && head[0] === "a") thousands = 1;
  else thousands = enBelowThousand(head);
  if (thousands === null || thousands === 0) return null;
  let tail = words.slice(thousandAt + 1);
  if (tail.length > 0 && tail[0] === "and") tail = tail.slice(1);
  if (tail.length === 0) return thousands * 1000;
  const rest = enBelowThousand(tail);
  return rest === null ? null : thousands * 1000 + rest;
}

/** whole-phrase English number: "thirty six point five", "seven and a half", "98" */
function parseEnglishPhrase(tokens: readonly Token[]): number | null {
  const w = tokens.map((t) => t.lower);
  if (w.length === 0) return null;

  // "<int> and a half", "<int> and half", "a half"
  const last = w[w.length - 1];
  if (last === "half") {
    let head = w.slice(0, -1);
    if (head.length > 0 && head[head.length - 1] === "a") head = head.slice(0, -1);
    if (head.length === 0) return w.length === 2 && w[0] === "a" ? 0.5 : null; // bare "half" not accepted
    if (head[head.length - 1] !== "and") return null;
    head = head.slice(0, -1);
    const int = parseEnglishIntegerTokens(tokens.slice(0, head.length));
    return int === null ? null : int + 0.5;
  }

  const pointAt = w.indexOf("point");
  if (pointAt !== -1) {
    const int = pointAt === 0 ? 0 : parseEnglishIntegerTokens(tokens.slice(0, pointAt));
    const frac = w.slice(pointAt + 1);
    if (int === null || frac.length === 0) return null;
    let digits = "";
    for (const f of frac) {
      const d = EN_DIGIT_WORDS[f] ?? (/^\d$/.test(f) ? f : undefined);
      if (d === undefined) return null;
      digits += d;
    }
    return Number(`${int}.${digits}`);
  }

  return parseEnglishIntegerTokens(tokens);
}

function parseEnglishIntegerTokens(tokens: readonly Token[]): number | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && tokens[0].cls === "digits") {
    return /^\d+$/.test(tokens[0].text) ? Number(tokens[0].text) : null;
  }
  if (tokens.some((t) => t.cls !== "latin")) return null;
  return enInteger(tokens.map((t) => t.lower));
}

/* ───────────── extraction ───────────── */

/** gap between two tokens may only be whitespace / hyphen, so "ерэн, найм" is never merged */
function contiguous(tokens: readonly Token[], from: number, to: number, text: string): boolean {
  for (let i = from; i < to; i++) {
    if (!/^[\s-]+$/.test(text.slice(tokens[i].end, tokens[i + 1].start))) return false;
  }
  return true;
}

function tryWindow(window: readonly Token[]): number | null {
  const classes = new Set(window.map((t) => t.cls).filter((c) => c !== "digits"));
  if (classes.size > 1) return null; // no mixed-script windows
  if (classes.has("cyrillic")) return parseMnNumber(window.map((t) => t.text).join(" "));
  if (classes.has("latin")) return parseEnglishPhrase(window);
  return null; // digits only, more than one token: never merged ("120 80" stays two numbers)
}

/**
 * All numbers in `text`, ordered by position. Greedy longest match per start token:
 * "ерэн найм" is ONE number (98), "120/80" is two (120, 80), "долоон цаг" contains 7.
 */
export function extractNumbers(text: string): ExtractedNumber[] {
  const tokens = tokenize(text);
  const out: ExtractedNumber[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    const maxLen = Math.min(MAX_WINDOW, tokens.length - i);
    for (let len = maxLen; len >= 1; len--) {
      const window = tokens.slice(i, i + len);
      if (len > 1 && !contiguous(tokens, i, i + len - 1, text)) continue;
      let value: number | null;
      let kind: ExtractedNumber["kind"] = "words";
      if (len === 1 && window[0].cls === "digits") {
        value = digitTokenValue(window[0].text);
        kind = "digits";
      } else {
        value = tryWindow(window);
      }
      if (value === null || !Number.isFinite(value)) continue;
      const start = window[0].start;
      const end = window[window.length - 1].end;
      out.push({ value, start, end, text: text.slice(start, end), kind });
      i += len;
      matched = true;
      break;
    }
    if (!matched) i += 1;
  }
  return out;
}

/** true when some number found in `sourceText` equals `value` (within `tolerance`, default exact) */
export function matchesAnyNumber(value: number, sourceText: string, tolerance = 0): boolean {
  return extractNumbers(sourceText).some((n) => Math.abs(n.value - value) <= tolerance + 1e-9);
}
