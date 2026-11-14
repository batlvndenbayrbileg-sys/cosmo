/**
 * Mongolian (Cyrillic) number-words parser and formatter.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  VOCABULARY TABLE — for native-speaker review (everything below is from  │
 * │  the author's memory, NOT verified; see the "unsure" column).            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 *  value | bare form (used when the word ends the phrase) | attributive "-н" form
 *  ------+------------------------------------------------+-----------------------
 *    0   | тэг   (also: нул)                              | —
 *    1   | нэг                                            | (нэгэн — NOT accepted)
 *    2   | хоёр                                           | хоёр  (same word)
 *    3   | гурав                                          | гурван
 *    4   | дөрөв                                          | дөрвөн
 *    5   | тав                                            | таван
 *    6   | зургаа                                         | зургаан
 *    7   | долоо                                          | долоон
 *    8   | найм                                           | найман
 *    9   | ес                                             | есөн
 *   10   | арав                                           | арван
 *   20   | хорь                                           | хорин
 *   30   | гуч                                            | гучин
 *   40   | дөч                                            | дөчин
 *   50   | тавь                                           | тавин
 *   60   | жар                                            | жаран
 *   70   | дал                                            | далан
 *   80   | ная                                            | наян
 *   90   | ер   (unsure: "ер" as a bare word)             | ерэн
 *  100   | зуу                                            | зуун
 *
 *  Other words:  цэг = decimal point · хагас = one half · аравны = "of ten" (tenths)
 *
 *  Grammar (see parseMnNumber): [<1-9> зуу|зуун] [tens | арав | арван] [<1-9>]
 *    "зуун хорин таван" = 125, "хоёр зуу" = 200, "арван нэг" = 11, "ерэн найм" = 98.
 *  Both forms of a word are accepted in ANY position (speech-to-text output is
 *  inconsistent); the formatter emits the canonical form: attributive before another
 *  number word, bare when the word ends the phrase.
 *
 *  Decimals:  "<int> цэг <digit>[<digit>…]"   гучин зургаа цэг тав = 36.5
 *             "<int> аравны <digit>"            гуч зургаа аравны тав = 36.5
 *             "<int> хагас" / "хагас"           долоо хагас = 7.5 · хагас = 0.5
 *
 *  Spellings the author is UNSURE about (reviewer please confirm / correct):
 *    нул (accepted as a second word for zero), ер (bare 90), нэгэн (not accepted),
 *    bare "арав" + unit ("арав нэг" accepted leniently as 11), the "<int> аравны <d>"
 *    tenths construction, "цэг" for the decimal point, "хагас" after a whole number.
 */

/** word → numeric meaning. Single source of truth for the parser. */
interface Word {
  kind: "zero" | "unit" | "ten" | "tens" | "hundred";
  value: number;
}

/** [bare form, attributive form, value, kind] — THE vocabulary table. */
const VOCAB: ReadonlyArray<readonly [string, string | null, number, Word["kind"]]> = [
  ["тэг", null, 0, "zero"],
  ["нул", null, 0, "zero"],
  ["нэг", null, 1, "unit"],
  ["хоёр", null, 2, "unit"],
  ["гурав", "гурван", 3, "unit"],
  ["дөрөв", "дөрвөн", 4, "unit"],
  ["тав", "таван", 5, "unit"],
  ["зургаа", "зургаан", 6, "unit"],
  ["долоо", "долоон", 7, "unit"],
  ["найм", "найман", 8, "unit"],
  ["ес", "есөн", 9, "unit"],
  ["арав", "арван", 10, "ten"],
  ["хорь", "хорин", 20, "tens"],
  ["гуч", "гучин", 30, "tens"],
  ["дөч", "дөчин", 40, "tens"],
  ["тавь", "тавин", 50, "tens"],
  ["жар", "жаран", 60, "tens"],
  ["дал", "далан", 70, "tens"],
  ["ная", "наян", 80, "tens"],
  ["ер", "ерэн", 90, "tens"],
  ["зуу", "зуун", 100, "hundred"],
];

/**
 * How the speech recogniser sometimes writes a short, spoken number word (measured 2026-11-15 on ElevenLabs Scribe v3
 * with the app's Mongolian voice: "Гурав." came back as "Гороо." or "горов."). Read as the number, never shown.
 */
const MISHEARD: ReadonlyArray<readonly [string, number, Word["kind"]]> = [
  ["гороо", 3, "unit"],
  ["горов", 3, "unit"],
  ["гурв", 3, "unit"],
];

const WORDS: ReadonlyMap<string, Word> = new Map([
  ...VOCAB.flatMap(([bare, attr, value, kind]) => {
    const entries: Array<[string, Word]> = [[bare, { kind, value }]];
    if (attr) entries.push([attr, { kind, value }]);
    return entries;
  }),
  ...MISHEARD.map(([word, value, kind]): [string, Word] => [word, { kind, value }]),
]);

const WORD_HALF = "хагас";
const WORD_POINT = "цэг";
const WORD_TENTHS = "аравны";

/** words → value, for the formatter (first entry of each value wins: bare form) */
const BARE_BY_VALUE = new Map<number, string>();
const ATTR_BY_VALUE = new Map<number, string>();
for (const [bare, attr, value, kind] of VOCAB) {
  if (kind === "zero" && BARE_BY_VALUE.has(value)) continue; // keep "тэг" over "нул"
  BARE_BY_VALUE.set(value, bare);
  ATTR_BY_VALUE.set(value, attr ?? bare);
}

const DIGITS_RE = /^\d+$/;
const DECIMAL_DIGITS_RE = /^\d+(?:[.,]\d+)?$/;

/** lower-case, strip punctuation (keeps letters, digits and the decimal separators between digits) */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, "$1\u0000$2") // protect decimal separators between digits
    .replace(/[^\p{L}\p{N}\u0000]+/gu, " ")
    .replace(/\u0000/g, ".")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** parse an integer (0..999) from tokens: a single digit string, "тэг", or number words */
function parseInteger(tokens: readonly string[]): number | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    const only = tokens[0];
    if (DIGITS_RE.test(only)) return Number(only);
    const w = WORDS.get(only);
    if (w?.kind === "zero") return 0;
  }
  let i = 0;
  let total = 0;

  // hundreds: [<1-9>] зуу|зуун
  const first = WORDS.get(tokens[0]);
  if (first?.kind === "hundred") {
    total += 100;
    i = 1;
  } else if (first?.kind === "unit" && tokens.length > 1) {
    const second = WORDS.get(tokens[1]);
    if (second?.kind === "hundred") {
      total += first.value * 100;
      i = 2;
    }
  }

  const rest = tokens.slice(i);
  if (rest.length === 0) return i > 0 ? total : null;
  if (rest.length > 2) return null;

  const a = WORDS.get(rest[0]);
  if (!a) return null;
  if (rest.length === 1) {
    if (a.kind === "unit" || a.kind === "ten" || a.kind === "tens") return total + a.value;
    return null;
  }
  const b = WORDS.get(rest[1]);
  if (b?.kind !== "unit") return null;
  if (a.kind === "ten" || a.kind === "tens") return total + a.value + b.value;
  return null;
}

/** a decimal-digit string made from digit words ("тав" → "5", "нэг тав" → "15") or a digit token */
function parseDigitString(tokens: readonly string[]): string | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && DIGITS_RE.test(tokens[0])) return tokens[0];
  let out = "";
  for (const t of tokens) {
    const w = WORDS.get(t);
    if (!w) return null;
    if (w.kind === "zero") out += "0";
    else if (w.kind === "unit") out += String(w.value);
    else return null;
  }
  return out;
}

function joinDecimal(int: number, fractionDigits: string): number {
  return Number(`${int}.${fractionDigits}`);
}

/**
 * Parse a whole phrase as a Mongolian number expression.
 * Returns null unless EVERY word belongs to the number expression.
 * Accepts: digits ("36", "36.5", "36,5"), integers 0..999 as words, and decimals via
 * "цэг", "аравны" and "хагас" (see the table at the top of this file).
 */
export function parseMnNumber(text: string): number | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  // plain digits, possibly with a decimal separator
  if (tokens.length === 1 && DECIMAL_DIGITS_RE.test(tokens[0])) return Number(tokens[0]);

  // fraction constructs: split on the marker word (must appear exactly once)
  const pointAt = tokens.indexOf(WORD_POINT);
  if (pointAt !== -1) {
    if (tokens.indexOf(WORD_POINT, pointAt + 1) !== -1) return null;
    const left = tokens.slice(0, pointAt);
    const int = left.length === 0 ? 0 : parseInteger(left);
    const digits = parseDigitString(tokens.slice(pointAt + 1));
    if (int === null || digits === null) return null;
    return joinDecimal(int, digits);
  }

  const tenthsAt = tokens.indexOf(WORD_TENTHS);
  if (tenthsAt !== -1) {
    if (tokens.indexOf(WORD_TENTHS, tenthsAt + 1) !== -1) return null;
    const left = tokens.slice(0, tenthsAt);
    const int = left.length === 0 ? 0 : parseInteger(left);
    const right = tokens.slice(tenthsAt + 1);
    if (int === null || right.length !== 1) return null;
    const digit = parseDigitString(right);
    if (digit === null || digit.length !== 1) return null;
    return joinDecimal(int, digit);
  }

  const halfAt = tokens.indexOf(WORD_HALF);
  if (halfAt !== -1) {
    if (halfAt !== tokens.length - 1) return null; // "хагас" only ends a phrase
    const left = tokens.slice(0, halfAt);
    const int = left.length === 0 ? 0 : parseInteger(left);
    return int === null ? null : int + 0.5;
  }

  return parseInteger(tokens);
}

function formatBelowHundred(n: number, endsPhrase: boolean): string {
  if (n < 10) return (endsPhrase ? BARE_BY_VALUE : ATTR_BY_VALUE).get(n) ?? "";
  if (n === 10) return (endsPhrase ? BARE_BY_VALUE : ATTR_BY_VALUE).get(10) ?? "";
  const tens = Math.floor(n / 10) * 10;
  const unit = n % 10;
  if (n < 20) return `${ATTR_BY_VALUE.get(10)} ${BARE_BY_VALUE.get(unit)}`; // арван нэг
  if (unit === 0) return (endsPhrase ? BARE_BY_VALUE : ATTR_BY_VALUE).get(tens) ?? "";
  return `${ATTR_BY_VALUE.get(tens)} ${BARE_BY_VALUE.get(unit)}`; // ерэн найм
}

function formatInteger(n: number): string {
  if (n === 0) return BARE_BY_VALUE.get(0) ?? "тэг";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    const hundredWord = rest === 0 ? BARE_BY_VALUE.get(100) : ATTR_BY_VALUE.get(100);
    if (hundreds > 1) parts.push(ATTR_BY_VALUE.get(hundreds) ?? "");
    parts.push(hundredWord ?? "");
  }
  if (rest > 0) parts.push(formatBelowHundred(rest, true));
  return parts.join(" ");
}

/**
 * Canonical Mongolian words for a non-negative number up to 999 with at most one decimal
 * ("цэг" form). Integers 0..200 round-trip: parseMnNumber(formatMnNumber(n)) === n.
 * @throws RangeError for negative, non-finite, > 999 or more-than-one-decimal values
 */
export function formatMnNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 999) {
    throw new RangeError(`formatMnNumber: ${n} is outside 0..999`);
  }
  const tenths = Math.round(n * 10);
  if (Math.abs(tenths - n * 10) > 1e-9) {
    throw new RangeError(`formatMnNumber: ${n} has more than one decimal`);
  }
  const int = Math.floor(tenths / 10);
  const digit = tenths % 10;
  if (digit === 0) return formatInteger(int);
  return `${formatInteger(int)} ${WORD_POINT} ${BARE_BY_VALUE.get(digit)}`;
}

/** @internal exported for extract.ts: is this lower-cased token part of the Mongolian number vocabulary? */
export function isMnNumberWord(token: string): boolean {
  return WORDS.has(token) || token === WORD_HALF || token === WORD_POINT || token === WORD_TENTHS;
}
