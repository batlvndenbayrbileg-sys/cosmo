/**
 * Rule-based interpretation of what the astronaut said (workbook R-06: the no-LLM path, also the offline fallback).
 *
 * Pure TypeScript: no I/O, no DB, no Next, no LLM. Every number comes from the speaker's own words
 * (digits, English number words, Mongolian number words via src/lib/numbers) and every value is validated with the
 * registry's validateValue, so nothing outside the hard ranges is ever returned as a record.
 *
 * Conventions:
 *  - sourceText is always a substring of the utterance (the server cross-checks it against the transcript).
 *  - confidence: 0.9 one clear number, 0.7 several candidates (or an inferred unit), 0.6 when the value comes from
 *    words only and no number could be verified. Free text is recorded verbatim at 0.9.
 *  - English and Mongolian vocabularies are always both active (speech-to-text often mixes them); the `lang`
 *    argument is accepted for the shared signature and is not needed by the rules.
 *  - Mongolian vocabulary is written from memory and needs a native-speaker review.
 */

import type { KpiKey, Lang, MeasurementValue, QuestionDef, QuestionId } from "@/lib/types";
import { KPI_DEFS, MAX_TEXT_LENGTH, getQuestion, validateValue } from "@/lib/kpi/registry";
import { extractNumbers } from "@/lib/numbers/extract";

/* ───────────── public types ───────────── */

export type InterpretedRecord = {
  key: KpiKey;
  value: MeasurementValue;
  unit: string | null;
  sourceText: string;
  confidence: number;
};

export type InterpretReason = "no_value" | "out_of_range" | "type" | "ambiguous";

export type InterpretResult = {
  records: InterpretedRecord[];
  unclear: boolean;
  reason: InterpretReason | null;
  rejectedKeys: KpiKey[];
};

/* ───────────── result helpers ───────────── */

const CONF_ONE = 0.9;
const CONF_SEVERAL = 0.7;
const CONF_WORDS = 0.6;

function unclearResult(reason: InterpretReason, rejectedKeys: KpiKey[] = []): InterpretResult {
  return { records: [], unclear: true, reason, rejectedKeys };
}

/** answered, but there is nothing to record (an optional question answered with "nothing") */
function nothingToRecord(): InterpretResult {
  return { records: [], unclear: false, reason: null, rejectedKeys: [] };
}

function okResult(records: InterpretedRecord[]): InterpretResult {
  return { records, unclear: false, reason: null, rejectedKeys: [] };
}

function makeRecord(key: KpiKey, value: MeasurementValue, sourceText: string, confidence: number): InterpretedRecord {
  return { key, value, unit: KPI_DEFS[key].unit, sourceText, confidence };
}

type Checked = { ok: true; value: MeasurementValue } | { ok: false; reason: "out_of_range" | "type" };

function check(key: KpiKey, raw: unknown): Checked {
  const v = validateValue(key, raw);
  if (v.ok) return { ok: true, value: v.value };
  return { ok: false, reason: v.reason === "range" ? "out_of_range" : "type" };
}

/* ───────────── regex helpers ───────────── */

const APOS = "['’ʼ]";
const NB = "(?<![\\p{L}\\p{N}_])";
const NA = "(?![\\p{L}\\p{N}_])";

function ap(src: string): string {
  return src.replace(/'/g, APOS);
}

/** whole-word pattern (works for Cyrillic, where \b does not) */
function wr(src: string): RegExp {
  return new RegExp(`${NB}(?:${ap(src)})${NA}`, "giu");
}

/** word-prefix pattern: matches the stem plus the rest of the word (Mongolian suffixes, English inflections) */
function sr(src: string): RegExp {
  return new RegExp(`${NB}(?:${ap(src)})[\\p{L}]*`, "giu");
}

/** raw pattern with apostrophe tolerance */
function rx(src: string, flags = "giu"): RegExp {
  return new RegExp(ap(src), flags.includes("g") ? flags : `${flags}g`);
}

function has(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  const found = re.test(text);
  re.lastIndex = 0;
  return found;
}

function matchesOf(re: RegExp, text: string): RegExpMatchArray[] {
  re.lastIndex = 0;
  const out = [...text.matchAll(re)];
  re.lastIndex = 0;
  return out;
}

interface Hit<T> {
  start: number;
  end: number;
  value: T;
  text: string;
}

/** all pattern hits, non-overlapping: the earlier start wins, then the longer match */
function resolveHits<T>(text: string, patterns: ReadonlyArray<readonly [RegExp, T]>): Array<Hit<T>> {
  const all: Array<Hit<T>> = [];
  for (const [re, value] of patterns) {
    for (const m of matchesOf(re, text)) {
      if (m[0].length === 0) continue;
      const start = m.index ?? 0;
      all.push({ start, end: start + m[0].length, value, text: m[0] });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Array<Hit<T>> = [];
  let lastEnd = -1;
  for (const h of all) {
    if (h.start < lastEnd) continue;
    kept.push(h);
    lastEnd = h.end;
  }
  return kept;
}

/** polarity of the first non-overlapping hit: true / false / null when nothing matched */
function firstPolarity(text: string, patterns: ReadonlyArray<readonly [RegExp, boolean]>): boolean | null {
  const hits = resolveHits(text, patterns);
  return hits.length > 0 ? hits[0].value : null;
}

/* ───────────── skip / "I don't know" ───────────── */

const SKIP_RE = new RegExp(
  [
    `${NB}(?:skip|pass|no idea|no clue|next question|let${ap("'")}s move on|not sure|dunno)${NA}`,
    ap(`${NB}(?:don't|do not|cannot|can't|can not) (?:know|say|remember|recall)${NA}`),
    `${NB}(?:мэдэхгүй|санахгүй|мартсан|алгас[\\p{L}]*)${NA}`,
    `${NB}дараа${NA}`,
  ].join("|"),
  "iu",
);

function isSkip(text: string): boolean {
  return SKIP_RE.test(text);
}

/* ───────────── units and quantities ───────────── */

type UnitKind = "hour" | "minute" | "litre" | "ml" | "bpm" | "mgdl" | "mmol" | "celsius" | "fahrenheit";

const UNIT_TABLE: ReadonlyArray<readonly [UnitKind, RegExp]> = [
  ["hour", /^(?:h|hr|hrs|hour|hours|цаг|цагийн|цагт|цагаар|цагийг)$/u],
  ["minute", /^(?:min|mins|minute|minutes|мин|минут|минутын|минутаар|минутыг)$/u],
  ["litre", /^(?:l|lt|litre|litres|liter|liters|л|литр|литрийн|литрээр|литрыг)$/u],
  ["ml", /^(?:ml|mls|millilitre|millilitres|milliliter|milliliters|мл|миллилитр|миллилитрийн)$/u],
  ["bpm", /^(?:bpm|beats|beat|удаа|удаагийн)$/u],
  ["mmol", /^(?:mmol|mmol\/l|ммоль)$/u],
  ["mgdl", /^(?:mg|mg\/dl|mgdl|мг|мг\/дл)$/u],
  ["celsius", /^(?:°c|°|c|celsius|degrees|degree|градус|цельс|цельсийн|цельсий)$/u],
  ["fahrenheit", /^(?:°f|f|fahrenheit|фаренгейт)$/u],
];

function unitAfter(text: string, from: number): { kind: UnitKind; end: number } | null {
  const m = /^[\s-]*([\p{L}°][\p{L}°/]*)/u.exec(text.slice(from));
  if (!m) return null;
  const token = m[1].toLowerCase();
  for (const [kind, re] of UNIT_TABLE) {
    if (re.test(token)) return { kind, end: from + m[0].length };
  }
  return null;
}

interface Qty {
  value: number;
  start: number;
  end: number;
  /** end of the unit word, or of the number when there is no unit */
  unitEnd: number;
  unit: UnitKind | null;
  kind: "digits" | "words" | "phrase";
  /** built from two spoken parts ("6:30", "six thirty"): the reading is a guess, so confidence is capped */
  weak?: boolean;
}

/**
 * Mongolian "нэг" is also the quantifier "a / that much" ("нэг их сайн биш" = "not that good"), not the number 1, when it
 * is followed by "их / л / ч / мэдэх / юм". Such an occurrence is never a number candidate.
 */
const NEG_QUANTIFIER_RE = /^\s*(?:их|л|ч|мэдэх|юм)(?![\p{L}])/u;

function isLoneNeg(text: string, n: { start: number; end: number; value: number; kind: string }): boolean {
  return n.kind === "words" && n.value === 1 && text.slice(n.start, n.end).toLowerCase() === "нэг";
}

const THOUSAND_RE = /(?<![\p{L}])мянга[н]?(?![\p{L}])/giu;

/**
 * Mongolian thousands ("нэг мянга найман зуун" = 1800, "1 мянга 800", "мянга хоёр зуун" = 1200, "хоёр мянга" = 2000).
 * src/lib/numbers parses 0..999 only, so the number before "мянга" and the remainder after it are merged here.
 */
function mergeThousands(text: string, qs: Qty[]): Qty[] {
  const marks = matchesOf(THOUSAND_RE, text);
  if (marks.length === 0) return qs;
  let out = qs.slice();
  for (const m of marks) {
    const mStart = m.index ?? 0;
    const mEnd = mStart + m[0].length;
    const mulIdx = out.findLastIndex(
      (q) => q.end <= mStart && /^[\s-]*$/u.test(text.slice(q.end, mStart)) && Number.isInteger(q.value) && q.value >= 1 && q.value <= 99,
    );
    const remIdx = out.findIndex(
      (q) => q.start >= mEnd && /^[\s-]*$/u.test(text.slice(mEnd, q.start)) && Number.isInteger(q.value) && q.value >= 0 && q.value < 1000,
    );
    const mul = mulIdx >= 0 ? out[mulIdx] : null;
    const rem = remIdx >= 0 ? out[remIdx] : null;
    const u = rem ? null : unitAfter(text, mEnd);
    const merged: Qty = {
      value: (mul ? mul.value : 1) * 1000 + (rem ? rem.value : 0),
      start: mul ? mul.start : mStart,
      end: rem ? rem.end : mEnd,
      unitEnd: rem ? rem.unitEnd : (u?.end ?? mEnd),
      unit: rem ? rem.unit : (u?.kind ?? null),
      kind: "words",
    };
    out = out.filter((q) => q !== mul && q !== rem);
    out.push(merged);
    out.sort((a, b) => a.start - b.start);
  }
  return out;
}

function numberQtys(text: string): Qty[] {
  const base = extractNumbers(text)
    .filter((n) => !(isLoneNeg(text, n) && NEG_QUANTIFIER_RE.test(text.slice(n.end))))
    .map((n): Qty => {
      const u = unitAfter(text, n.end);
      return {
        value: n.value,
        start: n.start,
        end: n.end,
        unitEnd: u?.end ?? n.end,
        unit: u?.kind ?? null,
        kind: n.kind,
      };
    });
  return mergeThousands(text, base);
}

/** phrases that carry their own quantity: "an hour", "half an hour", "цаг хагас", "a litre" ... */
const SPECIAL_PHRASES: ReadonlyArray<readonly [RegExp, number, UnitKind]> = [
  [rx(`${NB}(?:an?\\s+|one\\s+)?hour\\s+and\\s+(?:a\\s+)?half${NA}`), 1.5, "hour"],
  [rx(`${NB}half\\s+an?\\s+hour${NA}`), 0.5, "hour"],
  [rx(`${NB}(?:a\\s+)?quarter\\s+(?:of\\s+)?an?\\s+hour${NA}`), 0.25, "hour"],
  [rx(`${NB}an?\\s+hour${NA}`), 1, "hour"],
  [rx(`${NB}(?:нэг\\s+)?цаг\\s+хагас${NA}`), 1.5, "hour"],
  [rx(`${NB}half\\s+an?\\s+(?:litre|liter)${NA}`), 0.5, "litre"],
  [rx(`${NB}an?\\s+(?:litre|liter)\\s+and\\s+(?:a\\s+)?half${NA}`), 1.5, "litre"],
  [rx(`${NB}an?\\s+(?:litre|liter)${NA}`), 1, "litre"],
];

/** numbers (with their units) plus the special phrases above, in text order */
function quantitiesOf(text: string): Qty[] {
  const specials = resolveHits(
    text,
    SPECIAL_PHRASES.map(([re, value, unit]) => [re, { value, unit }] as const),
  ).map(
    (h): Qty => ({
      value: h.value.value,
      start: h.start,
      end: h.end,
      unitEnd: h.end,
      unit: h.value.unit,
      kind: "phrase",
    }),
  );
  const all = numberQtys(text);
  // "7 цаг хагас" is 7.5 hours (merged later): the special "цаг хагас" only stands when no number owns its "цаг"
  const standing = specials.filter((s) => !all.some((n) => n.unit === "hour" && n.start < s.start && n.unitEnd > s.start));
  const numbers = all.filter((n) => !standing.some((s) => n.start < s.end && n.end > s.start));
  return [...numbers, ...standing].sort((a, b) => a.start - b.start);
}

const GAP_RE = /^[\s,]*(?:and|ба|болон)?[\s,]*$/iu;
const AND_HALF_RE = /^[\s,]*and\s+(?:a\s+)?half(?![\p{L}])/iu;

/** "6 hours 30 minutes", "2 hours and a half", "1 litre 500 ml", "2 цаг хагас" */
function mergeCompound(text: string, qs: Qty[]): Qty[] {
  const out: Qty[] = [];
  for (let i = 0; i < qs.length; i++) {
    const a = qs[i];
    const b = qs[i + 1];
    if (a.unit === "hour" || a.unit === "litre") {
      if (b && GAP_RE.test(text.slice(a.unitEnd, b.start))) {
        if (a.unit === "hour" && b.unit === "minute") {
          out.push({ ...a, value: a.value + b.value / 60, end: b.end, unitEnd: b.unitEnd });
          i++;
          continue;
        }
        if (a.unit === "litre" && b.unit === "ml") {
          out.push({ ...a, value: a.value + b.value / 1000, end: b.end, unitEnd: b.unitEnd });
          i++;
          continue;
        }
        if (b.unit === null && b.value === 0.5 && b.kind === "words" && /^\s*$/u.test(text.slice(a.unitEnd, b.start))) {
          out.push({ ...a, value: a.value + 0.5, end: b.end, unitEnd: b.end });
          i++;
          continue;
        }
        // "7h30", "6 hours 45": digits straight after an hour unit are the minutes
        if (
          a.unit === "hour" &&
          b.unit === null &&
          b.kind === "digits" &&
          Number.isInteger(b.value) &&
          b.value >= 1 &&
          b.value <= 59 &&
          /^\s*$/u.test(text.slice(a.unitEnd, b.start))
        ) {
          out.push({ ...a, value: a.value + b.value / 60, end: b.end, unitEnd: b.end });
          i++;
          continue;
        }
      }
      const tail = AND_HALF_RE.exec(text.slice(a.unitEnd, b ? b.start : undefined));
      if (tail) {
        out.push({ ...a, value: a.value + 0.5, end: a.unitEnd + tail[0].length, unitEnd: a.unitEnd + tail[0].length });
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** true when some keyword match ends at most `within` characters before `pos` (the number follows its keyword) */
function keywordBefore(text: string, kw: RegExp, pos: number, within = 32): boolean {
  return matchesOf(kw, text).some((m) => {
    const end = (m.index ?? 0) + m[0].length;
    return end <= pos && pos - end <= within;
  });
}

/* ───────────── candidate resolution for single-value questions ───────────── */

interface Cand {
  value: number;
  src: string;
  preferred?: boolean;
  /** inferred unit or merged digits: confidence is capped at "several candidates" */
  weak?: boolean;
  /** a bare "нэг" that could be the quantifier: loses against a matched word */
  soft?: boolean;
}

function resolveSingle(key: KpiKey, cands: Cand[]): InterpretResult {
  if (cands.length === 0) return unclearResult("no_value");
  const accepted: Array<{ cand: Cand; value: MeasurementValue }> = [];
  let sawRange = false;
  for (const cand of cands) {
    const v = check(key, cand.value);
    if (v.ok) accepted.push({ cand, value: v.value });
    else if (v.reason === "out_of_range") sawRange = true;
  }
  if (accepted.length === 0) return unclearResult(sawRange ? "out_of_range" : "type", [key]);
  const pick = accepted.find((a) => a.cand.preferred) ?? accepted[0];
  const base = cands.length === 1 ? CONF_ONE : CONF_SEVERAL;
  const confidence = pick.cand.weak ? Math.min(base, CONF_SEVERAL) : base;
  return okResult([makeRecord(key, pick.value, pick.cand.src, confidence)]);
}

/** candidate numbers for a plain numeric question: units that belong elsewhere are dropped */
function plainCands(text: string, allowed: ReadonlyArray<UnitKind | null>, kw: RegExp, ownUnits: UnitKind[]): Cand[] {
  return numberQtys(text)
    .filter((q) => allowed.includes(q.unit))
    .map((q) => ({
      value: q.value,
      src: text.slice(q.start, q.unitEnd),
      preferred: ownUnits.includes(q.unit as UnitKind) || keywordBefore(text, kw, q.start),
    }));
}

/* ───────────── keyword families (shared by corrections and opportunistic extraction) ───────────── */

const KW: Record<QuestionId, RegExp> = {
  sleep: sr("sleep|slept|asleep|унт|нойр"),
  mood: sr("mood|сэтгэл"),
  symptoms: sr("headache|head\\s?ache|dizz|nause|symptom|толгой|дотор\\s+муухай|шинж\\s+тэмдэг|бөөлж"),
  blood_pressure: new RegExp(`${NB}(?:blood\\s+pressure|pressure|systolic|diastolic|bp|даралт[\\p{L}]*|цусны\\s+даралт)${NA}`, "giu"),
  heart_rate: sr("pulse|heart\\s?rate|heartbeat|heart|bpm|пульс|зүрх"),
  temperature: sr("temperature|temp|температур"),
  glucose: sr("glucose|blood\\s+sugar|sugar|сахар"),
  water: new RegExp(`${NB}(?:water|hydration|ус|усны|усан)${NA}`, "giu"),
  exercise: sr("exercis|workout|worked\\s+out|training|trained|gym|дасгал|спорт"),
  vision: sr("vision|eyesight|eyes?|blurr|хараа|нүд"),
  workload: sr("workload|work\\s?load|ачаалал"),
  day_note: sr("note|тэмдэглэл"),
};

/* ───────────── scale questions (mood, workload) ───────────── */

/** numbers that echo the scale ("3 out of 5", "from 1 to 5", "1-ээс 5 хүртэл") are not the answer */
function scaleCands(text: string, kw: RegExp): Cand[] {
  const out: Cand[] = [];
  for (const q of numberQtys(text)) {
    const before = text.slice(0, q.start);
    const after = text.slice(q.end);
    if (/(?:out of|from|of|to|\/)\s*$/iu.test(before)) continue;
    if (/^\s*(?:-\s*)?(?:аас|ээс|оос|өөс|хүртэл)/iu.test(after)) continue;
    if (q.unit !== null) continue;
    out.push({
      value: q.value,
      src: text.slice(q.start, q.end),
      preferred: keywordBefore(text, kw, q.start),
      soft: isLoneNeg(text, q),
    });
  }
  return out;
}

const MOOD_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [wr("(?:very|really|extremely|super|so|absolutely)\\s+(?:good|great|well|happy|positive)"), 5],
  [wr("great|excellent|fantastic|wonderful|amazing|awesome|superb|fabulous|perfect"), 5],
  [wr("not\\s+(?:too\\s+|that\\s+|so\\s+)?bad|pretty\\s+good|quite\\s+good|fairly\\s+good|good|happy|positive|cheerful|upbeat"), 4],
  [wr("fine|ok(?:ay)?|alright|all\\s+right|so[\\s-]so|average|neutral|normal|meh|decent|steady"), 3],
  [wr("low|down|sad|bad|poor|unhappy|gloomy|stressed|anxious|worried|irritable|not\\s+(?:so\\s+|very\\s+|that\\s+|too\\s+|really\\s+)?(?:good|great|well)|(?:a\\s+bit|a\\s+little|slightly)\\s+(?:low|down|sad)"), 2],
  [wr("terrible|awful|horrible|miserable|depressed|worst|(?:very|really|extremely|so)\\s+(?:bad|low|sad|down|poor|unhappy)"), 1],
  // Mongolian
  [wr("маш\\s+сайн|маш\\s+сайхан|их\\s+сайн|гайхалтай|аз\\s+жаргалтай|жаргалтай"), 5],
  [wr("муугүй|сайн|сайхан|хөгжилтэй|баяртай|эерэг"), 4],
  // "not so bad": the negation turns the word around ("нэг их" = "that much")
  [wr("(?:нэг\\s+)?(?:их|тийм\\s+ч)\\s+муу\\s+(?:биш|бус)|муу\\s+(?:биш|бус)"), 4],
  [wr("боломжийн|дунд(?:\\s+зэрэг)?|дундаж|гайгүй|хэвийн|зүгээр|ердийн"), 3],
  [wr("муу|тааламжгүй|гунигтай|түгшүүртэй|сайн\\s+биш|сайн\\s+бус|сайнгүй|(?:нэг\\s+)?(?:их|тийм\\s+ч)\\s+сайн\\s+(?:биш|бус)"), 2],
  [wr("маш\\s+муу|их\\s+муу|аймшигтай|хэтэрхий\\s+муу"), 1],
];

const WORKLOAD_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [wr("very\\s+(?:light|low|easy|quiet|relaxed)|almost\\s+nothing|barely\\s+any|minimal"), 1],
  [wr("light|low|easy|small|quiet|relaxed|manageable|calm"), 2],
  [wr("moderate|medium|normal|average|ok(?:ay)?|fine|reasonable|so[\\s-]so|usual|regular|typical"), 3],
  [wr("heavy|high|busy|hard|demanding|a\\s+lot|lots|long|intense|packed|full"), 4],
  [wr("very\\s+(?:heavy|high|busy|hard|demanding|intense)|extremely\\s+(?:heavy|busy|high|hard)|overloaded|overwhelming|exhausting|crushing|too\\s+much|brutal|maximum"), 5],
  // Mongolian
  [wr("(?:огт\\s+ачаалал\\s+байгаагүй|ачаалал\\s+огт\\s+байгаагүй|ачаалалгүй)"), 1],
  // negated heavy words are light ("нэг их ачаалал байгаагүй" = "there was not much workload")
  [wr("(?:нэг\\s+)?их\\s+ачаалал\\s+байгаагүй|ачаалал\\s+(?:их\\s+)?(?:биш|бус|байгаагүй)|(?:их|хүнд|завгүй|ачаалалтай)\\s+(?:биш|бус|байгаагүй)"), 2],
  [wr("маш\\s+(?:бага|хөнгөн|амар)"), 1],
  [wr("бага|хөнгөн|амар|тайван"), 2],
  [wr("дунд(?:\\s+зэрэг)?|боломжийн|хэвийн|ердийн|гайгүй"), 3],
  [wr("их|хүнд|завгүй|ачаалалтай"), 4],
  [wr("маш\\s+(?:их|хүнд|завгүй|ачаалалтай)|хэт\\s+их|хэтэрхий|дийлэхгүй|дарамттай"), 5],
];

function interpretScale(
  key: "mood" | "workload",
  text: string,
  words: ReadonlyArray<readonly [RegExp, number]>,
  kw: RegExp,
): InterpretResult {
  const cands = scaleCands(text, kw);
  const hits = resolveHits(text, words);
  // a lone "нэг" may be the quantifier, so a matched mood / workload word outranks it
  const onlySoft = cands.length > 0 && cands.every((c) => c.soft) && hits.length > 0;
  const byNumber = onlySoft ? unclearResult("no_value") : resolveSingle(key, cands);
  if (!byNumber.unclear) return byNumber;

  if (hits.length > 0) {
    const values = hits.map((h) => h.value);
    if (Math.max(...values) - Math.min(...values) >= 2) return unclearResult("ambiguous");
    const v = check(key, hits[0].value);
    if (v.ok) return okResult([makeRecord(key, v.value, hits[0].text, CONF_WORDS)]);
  }
  if (byNumber.reason === "out_of_range" || byNumber.reason === "type") return byNumber;
  return unclearResult("no_value");
}

/* ───────────── sleep ───────────── */

/**
 * Clock times are not durations. A number is a clock time when it follows "at / by / from / until ..." ("I slept at 11"),
 * is followed by "o'clock / am / pm" or the Mongolian "цагт / цагаас / хүртэл" ("11 цагт унтсан"), or when "around /
 * about" appears in a bedtime sentence ("went to bed around 11").
 */
const CLOCK_PREP_RE = /(?<![\p{L}])(?:at|by|from|since|until|till|after|before|past|between)\s*$/iu;
const CLOCK_WEAK_PREP_RE = /(?<![\p{L}])(?:around|about|approximately|roughly|near)\s*$/iu;
const BEDTIME_CONTEXT_RE =
  /(?<![\p{L}])(?:bed|bedtime|fell|fall|went|go|going|woke|wake|woken|waking|got\s+up|get\s+up|turned\s+in|lights)(?![\p{L}])/iu;
const CLOCK_AFTER_RE = /^\s*(?:o['’ʼ]?clock|(?:a\.?m\.?|p\.?m\.?)(?![\p{L}])|цагт(?![\p{L}])|цагаас(?![\p{L}])|-?\s*(?:аас|ээс|оос|өөс)(?![\p{L}]))/iu;
const UNTIL_AFTER_RE = /^\s*(?:хүртэл|хүртэлх)(?![\p{L}])/iu;

function clockTagged(text: string, q: Qty): boolean {
  if (CLOCK_AFTER_RE.test(text.slice(q.end))) return true;
  if (UNTIL_AFTER_RE.test(text.slice(q.unitEnd))) return true;
  if (q.unit !== null) return false;
  const before = text.slice(0, q.start);
  if (CLOCK_PREP_RE.test(before)) return true;
  return CLOCK_WEAK_PREP_RE.test(before) && BEDTIME_CONTEXT_RE.test(text);
}

/** "6:30", "six thirty", "6 30" without a unit: hours and minutes (a guess, so the quantity is weak) */
function mergeClockPairs(text: string, qs: Qty[]): Qty[] {
  const out: Qty[] = [];
  for (let i = 0; i < qs.length; i++) {
    const a = qs[i];
    const b = qs[i + 1];
    if (b && a.unit === null && b.unit === null && Number.isInteger(a.value) && Number.isInteger(b.value)) {
      const gap = text.slice(a.end, b.start);
      const colon = /^\s*:\s*$/u.test(gap) && a.value >= 0 && a.value <= 24 && b.value >= 0 && b.value <= 59;
      const spoken = /^\s+$/u.test(gap) && a.value >= 1 && a.value <= 12 && b.value >= 10 && b.value <= 59;
      if (colon || spoken) {
        out.push({ value: round(a.value + b.value / 60, 2), start: a.start, end: b.end, unitEnd: b.end, unit: null, kind: "phrase", weak: true });
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

const RANGE_GAP_RE = /^\s*(?:-|–|—|to|or|and|till|until|through|буюу|эсвэл|болон|ба|хүртэл)\s*$/iu;

/** "6 to 7 hours", "between 6 and 7 hours", "11 to 6": two different values, so there is no single answer */
function hasRange(text: string, qs: Qty[]): boolean {
  for (let i = 0; i + 1 < qs.length; i++) {
    const a = qs[i];
    const b = qs[i + 1];
    if (a.value === b.value) continue;
    const unitOk = (u: UnitKind | null): boolean => u === null || u === "hour";
    if (unitOk(a.unit) && unitOk(b.unit) && RANGE_GAP_RE.test(text.slice(a.unitEnd, b.start))) return true;
  }
  return false;
}

/**
 * Total absence of sleep. "didn't sleep well / much" is NOT this: that needs the number of hours, so it stays unclear
 * and Cosmo asks again instead of recording a false 0.
 */
const NEG_SLEEP_VERB_RE = new RegExp(
  ap(
    `${NB}(?:didn't|did not|couldn't|could not|haven't|have not|hadn't|had not|can't|cannot|never)\\s+(?:even\\s+)?(?:get\\s+(?:any\\s+)?)?(?:sleep|slept|sleeping)${NA}`,
  ),
  "iu",
);
const NO_SLEEP_TAIL_RE = /^[\s,]*(?:at\s+all|a\s+wink|a\s+minute|a\s+second|one\s+(?:minute|second|bit)|a\s+bit|whatsoever|any\b)/iu;
const NO_SLEEP_PHRASE_RE = new RegExp(
  [
    `${NB}(?:no|zero)\\s+sleep(?!\\s+(?:problems?|issues?|trouble|apnea|schedule))${NA}`,
    `${NB}not\\s+a\\s+(?:wink|minute|second)(?:\\s+of\\s+sleep)?${NA}`,
    `${NB}(?:slept|sleep)\\s+(?:zero|none|nothing)${NA}`,
    `${NB}without\\s+(?:any\\s+)?sleep${NA}`,
    `${NB}(?:огт|огтхон)\\s+(?:\\p{L}+\\s+)?(?:унтаагүй|унтсангүй)${NA}`,
    `${NB}нэг\\s+ч\\s+(?:минут|цаг|секунд|хором|удаа)\\s+(?:\\p{L}+\\s+)?(?:унтаагүй|унтсангүй)${NA}`,
    `${NB}нойр\\s+(?:огт\\s+)?хүрээгүй${NA}`,
    `${NB}нойргүй${NA}`,
  ].join("|"),
  "iu",
);
const TIME_FILLER_RE = /^(?:last|night|yesterday|today|tonight|this|morning|week|i|so|far|again|either|too|өчигдөр|өнөө|өнөөдөр|орой|шөнө|өглөө|сая|би|л|ч|дөнгөж|тэгээд)$/iu;
const MN_NEG_VERB_RE = /^(?:унтаагүй|унтсангүй)$/iu;

function totalNoSleep(text: string): string | null {
  const phrase = NO_SLEEP_PHRASE_RE.exec(text);
  if (phrase) return phrase[0];
  const verb = NEG_SLEEP_VERB_RE.exec(text);
  if (verb) {
    const tail = text.slice((verb.index ?? 0) + verb[0].length);
    const tailWords = (tail.toLowerCase().match(/[\p{L}']+/gu) ?? []).filter((w) => !TIME_FILLER_RE.test(w));
    if (NO_SLEEP_TAIL_RE.test(tail) || tailWords.length === 0) return verb[0];
    return null;
  }
  // bare Mongolian negated verb ("өчигдөр унтаагүй"): total only when nothing qualifies it ("сайн унтаагүй" does not count)
  const tokens = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const at = tokens.findIndex((w) => MN_NEG_VERB_RE.test(w));
  if (at >= 0 && tokens.every((w, i) => i === at || TIME_FILLER_RE.test(w))) return text.trim();
  return null;
}

function interpretSleep(text: string): InterpretResult {
  const all = mergeClockPairs(text, mergeCompound(text, quantitiesOf(text)));
  if (hasRange(text, all)) return unclearResult("ambiguous");

  const tagged = all.filter((q) => clockTagged(text, q));
  const qs = all.filter((q) => !tagged.includes(q));
  const timed = qs.filter((q) => q.unit === "hour" || q.unit === "minute");
  let cands: Cand[];
  if (timed.length > 0) {
    cands = timed.map((q) => ({
      value: round(q.unit === "hour" ? q.value : q.value / 60, 2),
      src: text.slice(q.start, q.unitEnd),
    }));
  } else {
    // a lone "нэг" without a unit is the quantifier ("нэг их унтаагүй"), not 1 hour
    const bare = qs.filter((q) => q.unit === null && !isLoneNeg(text, q));
    // only clock times were spoken ("I slept at 11", "11 to 6"): there is no duration to record
    if (bare.length === 0 && tagged.length > 0) return unclearResult("ambiguous");
    cands = bare.map((q) => ({
      value: q.value,
      src: text.slice(q.start, q.end),
      preferred: keywordBefore(text, KW.sleep, q.start),
      weak: q.weak || tagged.length > 0,
    }));
  }
  const result = resolveSingle("sleep_hours", cands);
  if (!result.unclear || result.reason !== "no_value") return result;
  if (isSkip(text)) return result;
  const none = totalNoSleep(text);
  if (none) return okResult([makeRecord("sleep_hours", 0, none, CONF_WORDS)]);
  return result;
}


/* ───────────── symptoms ───────────── */

type SymptomKey = "symptom_headache" | "symptom_dizziness" | "symptom_nausea";
const SYMPTOM_KEYS: SymptomKey[] = ["symptom_headache", "symptom_dizziness", "symptom_nausea"];

/** "толгой" plus up to three intervening words: "толгой маш их өвдөж", "толгой нь бага зэрэг эргэж", "толгой маань өвдөж" */
const MN_HEAD = "толгой(?:н)?(?:\\s+[\\p{L}]+){0,3}?";

const SYMPTOM_PATTERNS: ReadonlyArray<{ key: SymptomKey; re: RegExp }> = [
  {
    key: "symptom_headache",
    re: new RegExp(
      `${NB}(?:headaches?|head\\s?ache|migraines?|head\\s+(?:hurts?|is\\s+(?:hurting|pounding))|${MN_HEAD}\\s+өвд[\\p{L}]*)`,
      "giu",
    ),
  },
  {
    key: "symptom_dizziness",
    re: new RegExp(
      `${NB}(?:dizz(?:y|iness)|light-?headed(?:ness)?|vertigo|head\\s+(?:is\\s+)?spinning|${MN_HEAD}\\s+эрг[\\p{L}]*)`,
      "giu",
    ),
  },
  {
    key: "symptom_nausea",
    re: new RegExp(
      `${NB}(?:nausea|nauseous|nauseated|queasy|sick\\s+to\\s+my\\s+stomach|feel(?:ing)?\\s+sick|want\\s+to\\s+(?:vomit|throw\\s+up)|vomit(?:ing)?|throwing\\s+up|дотор(?:\\s+[\\p{L}]+){0,2}?\\s+муухай[\\p{L}]*|бөөлж[\\p{L}]*|дотор\\s+эвгүй)`,
      "giu",
    ),
  },
];

interface Mention {
  key: SymptomKey;
  start: number;
  end: number;
  cyrillic: boolean;
}

function findMentions(text: string): Mention[] {
  const raw: Mention[] = [];
  for (const { key, re } of SYMPTOM_PATTERNS) {
    for (const m of matchesOf(re, text)) {
      const start = m.index ?? 0;
      raw.push({ key, start, end: start + m[0].length, cyrillic: /\p{Script=Cyrillic}/u.test(m[0]) });
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const out: Mention[] = [];
  for (const m of raw) {
    if (out.length > 0 && m.start < out[out.length - 1].end) continue;
    out.push(m);
  }
  return out;
}

const BREAK_RE = new RegExp(
  `[.;!?]|${NB}(?:but|however|though|although|except|гэвч|харин|гэхдээ|гэсэн)${NA}`,
  "giu",
);

const NEG_PRE_RE = new RegExp(
  ap(
    `${NB}(?:no|not|none|nothing|without|never|neither|nor|nope|don't|dont|do not|doesn't|didn't|haven't|hasn't|isn't|wasn't|aren't|free of)${NA}`,
  ),
  "iu",
);

/**
 * A connector that continues a negated list: "no headache OR dizziness", "no headache nor nausea", "neither ... nor",
 * "and no ...". A bare comma, "and", or a quantity word ("a bit", "some", "mild") does NOT continue it: "no headache,
 * a bit nauseous" has nausea.
 */
const OR_CONNECTOR_RE = new RegExp(
  `^[\\s,;&]*(?:or|nor|neither)${NA}[\\s,]*(?:(?:any|some|a|an|the|of|bit|little|slight|mild|more|other)${NA}[\\s,]*)*$`,
  "iu",
);
const BARE_COMMA_RE = /^[\s,;]*$/u;

const POST_NEG_RE = new RegExp(
  `^\\s*[?,:–-]?\\s*(?:no|nope|none|not really|nothing)${NA}\\s*(?:[,.;!?]|$)`,
  "iu",
);
const POST_POS_RE = new RegExp(`^\\s*[?,:–-]?\\s*(?:yes|yeah|yep|yup)${NA}`, "iu");

const CYR_NEG_RE = /\p{L}*гүй(?![\p{L}])|(?<![\p{L}])(?:үгүй|биш|бус|алга|бүү)(?![\p{L}])/iu;
const CYR_CONJ_ONLY_RE = /^[\s,;]*(?:ба|болон|эсвэл|мөн)?[\s,;]*$/iu;

/** polarity of each mention: true = the symptom is present */
function symptomPolarities(text: string, mentions: Mention[]): boolean[] {
  const breaks = matchesOf(BREAK_RE, text).map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const lastBreakEnd = (pos: number): number => {
    let end = 0;
    for (const b of breaks) if (b.end <= pos) end = b.end;
    return end;
  };
  const nextBreakStart = (pos: number): number => {
    for (const b of breaks) if (b.start >= pos) return b.start;
    return text.length;
  };

  const pol: boolean[] = new Array<boolean>(mentions.length).fill(true);

  // Latin mentions read left to right: the negation comes before the symptom ("no headache or nausea")
  let consumedUntil = 0;
  // how each Latin mention joins the previous one: a negated list continues only through "or / nor / neither"
  // (a comma list continues only when an "or" closes it: "no headache, dizziness or nausea")
  const joins: Array<"own" | "or" | "comma" | "other" | "none"> = new Array(mentions.length).fill("none");
  const sameClauseAt: boolean[] = new Array<boolean>(mentions.length).fill(false);
  for (let i = 0; i < mentions.length; i++) {
    const m = mentions[i];
    if (m.cyrillic) continue;
    const prev = i > 0 ? mentions[i - 1] : null;
    const breakEnd = lastBreakEnd(m.start);
    const segStart = Math.max(breakEnd, prev ? prev.end : 0, consumedUntil);
    const pre = text.slice(segStart, m.start);
    const sameClause = prev !== null && prev.end >= breakEnd && !prev.cyrillic;
    sameClauseAt[i] = sameClause;
    if (NEG_PRE_RE.test(pre)) {
      pol[i] = false;
      joins[i] = "own";
    } else if (sameClause && OR_CONNECTOR_RE.test(pre)) {
      pol[i] = pol[i - 1];
      joins[i] = "or";
    } else if (sameClause && BARE_COMMA_RE.test(pre)) {
      // decided below, once the whole list is known
      pol[i] = true;
      joins[i] = "comma";
    } else {
      pol[i] = true;
      joins[i] = "other";
    }

    const postNeg = POST_NEG_RE.exec(text.slice(m.end));
    const postPos = POST_POS_RE.test(text.slice(m.end));
    if (postPos) {
      pol[i] = true;
    } else if (postNeg && pol[i]) {
      pol[i] = false;
      consumedUntil = m.end + postNeg[0].length;
    }
  }
  for (let i = 1; i < mentions.length; i++) {
    if (joins[i] !== "comma" || pol[i - 1]) continue;
    for (let j = i + 1; j < mentions.length && sameClauseAt[j]; j++) {
      if (joins[j] === "or") {
        // the whole comma list closed by "or" is one negated list
        for (let k = i; k <= j; k++) pol[k] = false;
        break;
      }
      if (joins[j] !== "comma") break;
    }
  }

  // Cyrillic mentions read right to left: the negation comes after the symptom ("толгой өвдөхгүй")
  for (let i = mentions.length - 1; i >= 0; i--) {
    const m = mentions[i];
    if (!m.cyrillic) continue;
    const next = i + 1 < mentions.length ? mentions[i + 1] : null;
    const segEnd = Math.min(next ? next.start : text.length, nextBreakStart(m.end));
    const own = text.slice(m.start, m.end) + text.slice(m.end, segEnd);
    const post = text.slice(m.end, segEnd);
    if (CYR_NEG_RE.test(own)) pol[i] = false;
    else if (next && next.start <= segEnd && next.cyrillic && CYR_CONJ_ONLY_RE.test(post)) pol[i] = pol[i + 1];
    else pol[i] = true;
  }
  return pol;
}

const LEAD_MARKER_RE = new RegExp(
  `^\\s*(yes|yeah|yep|yup|no|nope|nah|тийм|үгүй)(?:\\s*[,.!:–-]+\\s*|\\s+(?=(?:i|i${APOS}m|im|it|my|there|just|a|some|actually|well|but|only|still)${NA}))`,
  "iu",
);

const NONE_RE = new RegExp(
  [
    `^\\W*(?:no|none|nope|nah|nothing|negative|neither|not really|not at all)${NA}`,
    `${NB}no\\s+(?:symptoms?|problems?|issues?|complaints?|pain)${NA}`,
    `${NB}nothing\\s+(?:at all|special|to report|really)${NA}`,
    `${NB}all\\s+(?:good|fine|clear|ok|okay)${NA}`,
    ap(`${NB}i'?m\\s+(?:fine|good|ok|okay|great)${NA}`),
    `${NB}feel(?:ing)?\\s+(?:fine|good|great|ok|okay|normal|well)${NA}`,
    `${NB}(?:normal|none of (?:them|these|the above))${NA}`,
    `${NB}(?:үгүй|байхгүй|алга|зүгээр|хэвийн)${NA}`,
    `юу\\s+ч\\s+(?:үгүй|байхгүй|алга)`,
    `шинж\\s+тэмдэг\\s+байхгүй`,
    `сайн\\s+байна`,
  ].join("|"),
  "iu",
);

const PROBLEM_RE = new RegExp(
  [
    `${NB}(?:pain|hurts?|hurting|aching|aches?|sore|cramps?|cough(?:ing)?|fever|rash|swollen|swelling|numb(?:ness)?|tingling|faint(?:ed|ing)?|breath[\\p{L}]*|bleeding|tired|fatigue[\\p{L}]*|weak(?:ness)?|palpitations?|chest|unconscious|blurred|blurry)${NA}`,
    `${NB}(?:өвд[\\p{L}]*|өвч[\\p{L}]*|хөндүүр[\\p{L}]*|ханиа[\\p{L}]*|халуур[\\p{L}]*|цээж[\\p{L}]*|амьсгал[\\p{L}]*|ухаан[\\p{L}]*|ядар[\\p{L}]*|сул[\\p{L}]*|хаван[\\p{L}]*|таталт[\\p{L}]*)`,
  ].join("|"),
  "iu",
);

const NOTE_STOP = new Set(
  [
    // English
    "i", "i'm", "im", "i've", "ive", "i'd", "have", "has", "had", "a", "an", "the", "my", "me", "some", "bit", "little",
    "slight", "slightly", "mild", "mildly", "really", "very", "quite", "just", "also", "still", "again", "and", "or", "nor",
    "but", "with", "of", "yes", "yeah", "yep", "no", "not", "none", "nothing", "never", "without", "don't", "dont", "do",
    "does", "did", "didn't", "am", "is", "are", "was", "were", "be", "been", "feel", "feeling", "felt", "getting", "got",
    "get", "there", "it", "its", "it's", "that", "this", "any", "anything", "other", "else", "only", "kind", "sort", "like",
    "today", "now", "at", "moment", "right", "think", "maybe", "so", "too", "pretty", "fairly", "somewhat", "can", "could",
    "mostly", "sometimes", "tiny", "minor", "light", "small", "on", "in", "to", "for", "when", "which",
    // Mongolian
    "би", "надад", "байна", "байгаа", "бий", "байх", "нь", "л", "ч", "жаахан", "бага", "зэрэг", "зэргийн", "багахан",
    "тийм", "үгүй", "байхгүй", "ба", "болон", "эсвэл", "мөн", "гэхдээ", "харин", "гэвч", "одоо", "өнөөдөр", "зүйл", "юу",
    "ямар", "нэг", "нэлээд", "маш", "их", "арай", "бас", "дахиад", "ердөө", "зөвхөн", "байсан", "шиг", "юм", "бол",
  ],
);

function contentWords(fragment: string): number {
  const tokens = fragment.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
  return tokens.filter((t) => !NOTE_STOP.has(t.replace(/’/g, "'"))).length;
}

/** a clause that opens with a negation ("no chest pain", "I don't have ...") */
const NEG_LEAD_RE = new RegExp(
  ap(
    `^\\W*(?:(?:i|there\\s+is|there's|there\\s+was)\\s+)?(?:have\\s+)?(?:no|not|none|nothing|without|never|don't|dont|do not|didn't|haven't|have not|hasn't)(?![\\p{L}])`,
  ),
  "iu",
);

interface Clause {
  start: number;
  end: number;
}

/** the clauses of the text with their positions (separators: , ; . ! ? and "but / гэхдээ / харин / гэвч"), trimmed */
function clausesOf(text: string): Clause[] {
  const sep = /[,;.!?]+|(?<![\p{L}])(?:but|гэхдээ|харин|гэвч)(?![\p{L}])/giu;
  const out: Clause[] = [];
  const push = (from: number, to: number): void => {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length > 0) out.push({ start: from + lead, end: from + lead + trimmed.length });
  };
  let last = 0;
  for (const m of text.matchAll(sep)) {
    const at = m.index ?? 0;
    push(last, at);
    last = at + m[0].length;
  }
  push(last, text.length);
  return out;
}

/**
 * The clauses of the utterance that say something beyond the three symptom words, as the symptom note.
 * Negated clauses ("no chest pain") are dropped, so a denial can never raise the serious-word alert.
 * sourceText is always verbatim: when the kept clauses follow each other in the utterance the note IS that contiguous
 * slice (original separators included); when a denied clause sits between them the value joins the kept clauses and the
 * source is the first kept clause, so the server's substring check against the transcript still holds.
 */
function symptomNote(text: string, mentions: Mention[], anyPositive: boolean): { value: string; source: string } | null {
  const clauses = clausesOf(text);
  const kept: number[] = [];
  let words = 0;
  clauses.forEach((c, idx) => {
    let rest = text.slice(c.start, c.end);
    for (const m of mentions) {
      if (m.start >= c.start && m.end <= c.end) rest = rest.replace(text.slice(m.start, m.end), " ");
    }
    // the symptom words themselves were handled above; a denial in what is left ("no chest pain") is not a note
    if (NEG_LEAD_RE.test(rest) || (/\p{Script=Cyrillic}/u.test(rest) && CYR_NEG_RE.test(rest))) return;
    const n = contentWords(rest);
    if (n > 0) {
      kept.push(idx);
      words += n;
    }
  });
  if (kept.length === 0) return null;
  const keptText = kept.map((idx) => text.slice(clauses[idx].start, clauses[idx].end));
  const hasProblemWord = keptText.some((c) => has(PROBLEM_RE, c));
  if (!(words >= 2 && (anyPositive || hasProblemWord)) && !(hasProblemWord && words >= 1)) return null;

  const cap = (s: string): string => (s.length > MAX_TEXT_LENGTH ? s.slice(0, MAX_TEXT_LENGTH).replace(/\s+\S*$/u, "") : s);
  const consecutive = kept.every((idx, i) => i === 0 || idx === kept[i - 1] + 1);
  if (consecutive) {
    const slice = cap(text.slice(clauses[kept[0]].start, clauses[kept[kept.length - 1]].end));
    return { value: slice, source: slice };
  }
  return { value: cap(keptText.join(", ")), source: cap(keptText[0]) };
}

function interpretSymptoms(text: string): InterpretResult {
  const lead = LEAD_MARKER_RE.exec(text);
  const body = lead ? text.slice(lead[0].length) : text;
  const leadWord = lead ? lead[1].toLowerCase() : null;
  const leadNo = leadWord === "no" || leadWord === "nope" || leadWord === "nah" || leadWord === "үгүй";
  const leadYes = leadWord !== null && !leadNo;

  const mentions = findMentions(body);
  const src = text.length > 200 ? text.slice(0, 200) : text;

  const all = (value: 0, note: { value: string; source: string } | null): InterpretResult => {
    const records = SYMPTOM_KEYS.map((k) => makeRecord(k, value, src, CONF_WORDS));
    if (note) records.push(makeRecord("symptom_note", note.value, note.source, CONF_ONE));
    return okResult(records);
  };

  if (mentions.length === 0) {
    if (isSkip(body) && !has(PROBLEM_RE, body)) return unclearResult("no_value");
    // something else is wrong ("chest pain"): keep it as the note, the three symptoms stay at 0
    const note = symptomNote(body, [], false);
    if (note) return all(0, note);
    const deniedProblem = has(PROBLEM_RE, body) && (NEG_LEAD_RE.test(body) || CYR_NEG_RE.test(body));
    if (leadNo || deniedProblem || has(NONE_RE, body)) return all(0, null);
    if (leadYes || /^\W*(?:yes|yeah|yep|тийм)/iu.test(body)) return unclearResult("ambiguous");
    return unclearResult("no_value");
  }

  const polarity = symptomPolarities(body, mentions);
  const present = new Set<SymptomKey>();
  mentions.forEach((m, i) => {
    if (polarity[i]) present.add(m.key);
  });

  const records = SYMPTOM_KEYS.map((k) => makeRecord(k, present.has(k) ? 1 : 0, src, CONF_WORDS));
  const note = symptomNote(body, mentions, present.size > 0);
  if (note) records.push(makeRecord("symptom_note", note.value, note.source, CONF_ONE));
  return okResult(records);
}

/* ───────────── blood pressure ───────────── */

function interpretBloodPressure(text: string): InterpretResult {
  const nums = numberQtys(text).filter((q) => q.unit === null);
  if (nums.length === 0) return unclearResult("no_value");
  if (nums.length === 1) return unclearResult("ambiguous");
  const [a, b] = nums;
  if (a.value <= b.value) return unclearResult("ambiguous");

  const sys = check("bp_systolic", a.value);
  const dia = check("bp_diastolic", b.value);
  if (!sys.ok || !dia.ok) {
    const rejected: KpiKey[] = [];
    const reasons: string[] = [];
    if (!sys.ok) {
      rejected.push("bp_systolic");
      reasons.push(sys.reason);
    }
    if (!dia.ok) {
      rejected.push("bp_diastolic");
      reasons.push(dia.reason);
    }
    return unclearResult(reasons.includes("out_of_range") ? "out_of_range" : "type", rejected);
  }
  const confidence = nums.length === 2 ? CONF_ONE : CONF_SEVERAL;
  const src = text.slice(a.start, b.end);
  return okResult([
    makeRecord("bp_systolic", sys.value, src, confidence),
    makeRecord("bp_diastolic", dia.value, src, confidence),
  ]);
}

/* ───────────── heart rate, temperature, glucose ───────────── */

function interpretHeartRate(text: string): InterpretResult {
  return resolveSingle("heart_rate", plainCands(text, [null, "bpm"], KW.heart_rate, ["bpm"]));
}

function interpretTemperature(text: string): InterpretResult {
  const fahrenheit = /fahrenheit|°\s*f(?![\p{L}])|degrees?\s+f(?![\p{L}])|\d\s*f(?![\p{L}])|фаренгейт/iu.test(text);
  const raw = numberQtys(text).filter((q) => q.unit === null || q.unit === "celsius" || q.unit === "fahrenheit");
  const cands: Cand[] = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i];
    const next = raw[i + 1];
    // "36 6" / "thirty six six" -> 36.6 (speech-to-text drops the decimal word)
    if (
      next &&
      Number.isInteger(q.value) &&
      q.value >= 34 &&
      q.value <= 42 &&
      Number.isInteger(next.value) &&
      next.value >= 0 &&
      next.value <= 9 &&
      next.unit === null &&
      /^\s+$/u.test(text.slice(q.unitEnd, next.start))
    ) {
      cands.push({
        value: round(q.value + next.value / 10, 1),
        src: text.slice(q.start, next.end),
        preferred: true,
        weak: true,
      });
      i++;
      continue;
    }
    let value = q.value;
    if (fahrenheit || q.unit === "fahrenheit") value = round(((value - 32) * 5) / 9, 1);
    cands.push({
      value,
      src: text.slice(q.start, q.unitEnd),
      preferred: (value >= 34 && value <= 42) || q.unit === "celsius" || keywordBefore(text, KW.temperature, q.start),
    });
  }
  return resolveSingle("temperature_c", cands);
}

function interpretGlucose(text: string): InterpretResult {
  const mmol = /mmol|ммоль/iu.test(text);
  const cands = numberQtys(text)
    .filter((q) => q.unit === null || q.unit === "mgdl" || q.unit === "mmol")
    .map(
      (q): Cand => ({
        value: mmol || q.unit === "mmol" ? Math.round(q.value * 18.016) : q.value,
        src: text.slice(q.start, q.unitEnd),
        preferred: q.unit === "mgdl" || q.unit === "mmol" || keywordBefore(text, KW.glucose, q.start),
      }),
    );
  return resolveSingle("glucose_mgdl", cands);
}

/* ───────────── water ───────────── */

const CONTAINER_RE = /^\s*(?:glass(?:es)?|cups?|bottles?|mugs?|аяга[\p{L}]*|лонх[\p{L}]*|шил[\p{L}]*)(?![\p{L}])/iu;

function interpretWater(text: string): InterpretResult {
  const qs = mergeCompound(text, quantitiesOf(text));
  const volumes = qs.filter((q) => q.unit === "litre" || q.unit === "ml");
  if (volumes.length > 0) {
    const cands = volumes.map(
      (q): Cand => ({
        value: Math.round(q.unit === "litre" ? q.value * 1000 : q.value),
        src: text.slice(q.start, q.unitEnd),
      }),
    );
    return resolveSingle("water_ml", cands);
  }

  const bare = qs.filter((q) => q.unit === null);
  const cands: Cand[] = [];
  let ambiguous = false;
  for (const q of bare) {
    const src = text.slice(q.start, q.end);
    // "8 glasses": the size of a glass is unknown, so ask for millilitres or litres instead of guessing
    if (CONTAINER_RE.test(text.slice(q.end))) {
      ambiguous = true;
      continue;
    }
    const preferred = keywordBefore(text, KW.water, q.start);
    if (q.value >= 100) cands.push({ value: Math.round(q.value), src, preferred });
    else if (q.value <= 10) cands.push({ value: Math.round(q.value * 1000), src, preferred, weak: true });
    else ambiguous = true;
  }
  if (cands.length === 0) return ambiguous ? unclearResult("ambiguous") : unclearResult("no_value");
  return resolveSingle("water_ml", cands);
}

/* ───────────── exercise ───────────── */

const NO_EXERCISE_RE = new RegExp(
  [
    ap(`^\\W*(?:no|none|nope|nothing|nah)${NA}`),
    ap(`${NB}(?:didn't|did not|haven't|have not|never|not at all|skipped)${NA}`),
    `${NB}(?:үгүй|хийгээгүй|хийсэнгүй|байхгүй|огт)${NA}`,
  ].join("|"),
  "iu",
);

/** "didn't exercise much / that much / нэг их хийгээгүй": some exercise was done, the minutes are unknown */
const EXERCISE_HEDGE_RE = new RegExp(
  `${NB}(?:much|well|enough|a\\s+lot|many|really|very|that|too|хангалттай|нэг\\s+их|их|сайн|ихэнх)${NA}`,
  "iu",
);

function interpretExercise(text: string): InterpretResult {
  const qs = mergeCompound(text, quantitiesOf(text));
  const timed = qs.filter((q) => q.unit === "hour" || q.unit === "minute");
  let cands: Cand[];
  if (timed.length > 0) {
    cands = timed.map((q) => ({
      value: Math.round(q.unit === "hour" ? q.value * 60 : q.value),
      src: text.slice(q.start, q.unitEnd),
    }));
  } else {
    // a lone "нэг" without a unit is the quantifier ("нэг их хийгээгүй"), not 1 minute
    cands = qs
      .filter((q) => q.unit === null && !isLoneNeg(text, q))
      .map((q) => ({ value: q.value, src: text.slice(q.start, q.end), preferred: keywordBefore(text, KW.exercise, q.start) }));
  }
  const result = resolveSingle("exercise_min", cands);
  if (!result.unclear || result.reason !== "no_value") return result;
  if (isSkip(text)) return result;
  const none = NO_EXERCISE_RE.exec(text);
  // hedged verb negation ("didn't exercise much"): ask for the minutes instead of recording a false 0
  const plainNo = none !== null && /^\W*(?:no|none|nope|nothing|nah|үгүй|байхгүй|огт)\W*$/iu.test(none[0]);
  if (none && !plainNo && has(EXERCISE_HEDGE_RE, text)) return result;
  if (none) return okResult([makeRecord("exercise_min", 0, none[0].trim() || text.trim(), CONF_WORDS)]);
  return result;
}

/* ───────────── vision ───────────── */

const VISION_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  // "not blurred" and friends are clear
  [wr("not\\s+(?:at\\s+all\\s+)?(?:blurred|blurry|fuzzy)|no\\s+blur(?:ring)?|without\\s+blur"), 0],
  [wr("not\\s+(?:quite|entirely|completely|perfectly|very|that|so|really)\\s+(?:clear|sharp)"), 1],
  [wr("not\\s+(?:clear|sharp)|unclear|clearly\\s+blurr[\\p{L}]*|blurred|blurry|blurs?|fuzzy|double(?:\\s+vision)?|cannot\\s+read|can't\\s+read|can't\\s+see|hard\\s+to\\s+read"), 2],
  [wr("(?:slightly|a\\s+bit|a\\s+little(?:\\s+bit)?|little|somewhat|mildly|mild|a\\s+touch|a\\s+tad|bit|minor|faintly)(?:\\s+(?:blurred|blurry|fuzzy|unclear|off|soft))?"), 1],
  [wr("clear|sharp|fine|normal|good|perfect|ok(?:ay)?|crisp|focused|no\\s+(?:problems?|issues?)"), 0],
  // Mongolian
  [wr("бүдэг\\s+биш|бүдэггүй|бүдгэрээгүй|бүдгэрсэнгүй"), 0],
  [wr("бага\\s+зэрэг(?:\\s+бүдэг[\\p{L}]*)?|жаахан(?:\\s+бүдэг[\\p{L}]*)?|багахан(?:\\s+бүдэг[\\p{L}]*)?|бүдэгхэн"), 1],
  [wr("тод\\s+(?:биш|бус)|тодгүй|тодорхойгүй|харагдахгүй(?:\\s+байна)?|уншиж\\s+чадахгүй"), 2],
  [wr("бүдэг[\\p{L}]*|бүдгэр[\\p{L}]*"), 2],
  [wr("тод|тодорхой|хэвийн|зүгээр|ойлгомжтой|эрүүл"), 0],
];

function interpretVision(text: string): InterpretResult {
  const hits = resolveHits(text, VISION_WORDS);
  if (hits.length === 0) return unclearResult("no_value");
  const values = new Set(hits.map((h) => h.value));
  if (values.size > 1) return unclearResult("ambiguous");
  const v = check("vision_check", hits[0].value);
  if (!v.ok) return unclearResult(v.reason, ["vision_check"]);
  return okResult([makeRecord("vision_check", v.value, hits[0].text, CONF_WORDS)]);
}

/* ───────────── day note ───────────── */

const NOTHING_ALTERNATIVES = [
  "no|nope|nah|nothing|none|not really|nothing else|nothing special|nothing more|nothing much|nothing really|nothing at all",
  "nothing to (?:add|note|report|say)|nothing today|no thanks|no thank you|that'?s all|that'?s it|all good|all fine",
  "i'?m good|i'?m fine|not today|no comment|no no|skip|pass|i don'?t know|no idea",
  "үгүй|юу ч үгүй|юу ч байхгүй|байхгүй|алга|юмгүй|нэмэх зүйл байхгүй|нэмэх юм алга|нэмэх зүйлгүй|зүйл алга|тэмдэглэх зүйл байхгүй|юу ч алга|мэдэхгүй|алгас|алгасъя|дараа",
];
const NOTHING_RE = new RegExp(`^(?:(?:no|nope|nah|үгүй)\\s+)*(?:${ap(NOTHING_ALTERNATIVES.join("|"))})$`, "iu");

function isNothing(text: string): boolean {
  const flat = text
    .replace(/[\s.,!?;:"…—–-]+/gu, " ")
    .trim();
  return flat.length === 0 || NOTHING_RE.test(flat);
}

function interpretDayNote(text: string): InterpretResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return unclearResult("no_value");
  if (isNothing(trimmed)) return nothingToRecord();
  const lead = LEAD_MARKER_RE.exec(trimmed);
  const body = (lead ? trimmed.slice(lead[0].length) : trimmed).trim();
  if (body.length === 0 || isNothing(body)) return nothingToRecord();
  let note = body;
  if (note.length > MAX_TEXT_LENGTH) note = note.slice(0, MAX_TEXT_LENGTH).replace(/\s+\S*$/u, "");
  const v = check("day_note", note);
  if (!v.ok) return unclearResult(v.reason, ["day_note"]);
  return okResult([makeRecord("day_note", v.value, note, CONF_ONE)]);
}

/* ───────────── dispatch ───────────── */

/**
 * Interprets the answer to ONE question. Records are validated; out-of-range or wrongly typed numbers are returned in
 * rejectedKeys with reason "out_of_range" / "type". `unclear` is true exactly when there is nothing to record, except
 * for the optional day_note question answered with "nothing" (unclear false, no records).
 */
/**
 * The words of an answer that can belong to `question`: when the astronaut names ANOTHER measurement ("өө миний даралт
 * 120 дээр 80 байна" while blood sugar is asked), that keyword and the numbers after it (up to the next keyword) belong
 * to that measurement and are removed, so they are never read as the answer to the open question. The other value is
 * still picked up by interpretOpportunistic. Symptoms and the day note keep the whole text.
 * (Team feedback 2026-11-15: answers in any order; before this, "даралт 120 дээр 80" also stored blood sugar = 120.)
 */
function ownPart(question: QuestionDef, text: string): string {
  if (question.id === "symptoms" || question.id === "day_note") return text;
  const others = OPPORTUNISTIC.filter((o) => o.id !== question.id).map(({ id }) => [KW[id], id] as const);
  const hits = resolveHits(text, [...others, [KW[question.id], question.id] as const]);
  if (!hits.some((h) => h.value !== question.id)) return text;
  let out = "";
  let cursor = 0;
  hits.forEach((hit, i) => {
    if (hit.value === question.id) return;
    const next = i + 1 < hits.length ? hits[i + 1].start : text.length;
    out += text.slice(cursor, hit.start);
    cursor = Math.max(cursor, Math.min(next, hit.end + 60));
  });
  out += text.slice(cursor);
  return out.trim();
}

export function interpretAnswer(question: QuestionDef, text: string, lang: Lang): InterpretResult {
  void lang; // both vocabularies are always active
  const t = ownPart(question, text.trim());
  if (t.length === 0) return unclearResult("no_value");
  switch (question.id) {
    case "sleep":
      return interpretSleep(t);
    case "mood":
      return interpretScale("mood", t, MOOD_WORDS, KW.mood);
    case "symptoms":
      return interpretSymptoms(t);
    case "blood_pressure":
      return interpretBloodPressure(t);
    case "heart_rate":
      return interpretHeartRate(t);
    case "temperature":
      return interpretTemperature(t);
    case "glucose":
      return interpretGlucose(t);
    case "water":
      return interpretWater(t);
    case "exercise":
      return interpretExercise(t);
    case "vision":
      return interpretVision(t);
    case "workload":
      return interpretScale("workload", t, WORKLOAD_WORDS, KW.workload);
    case "day_note":
      return interpretDayNote(t);
  }
}

/* ───────────── corrections ───────────── */

const CORRECTION_ORDER: QuestionId[] = [
  "sleep",
  "blood_pressure",
  "heart_rate",
  "temperature",
  "glucose",
  "water",
  "exercise",
  "vision",
  "workload",
  "symptoms",
  "mood",
];

/** the question a unit points at when no keyword is spoken ("No, 6 hours") */
const UNIT_TARGET: Partial<Record<UnitKind, QuestionId>> = {
  hour: "sleep",
  minute: "exercise",
  litre: "water",
  ml: "water",
  bpm: "heart_rate",
  mgdl: "glucose",
  mmol: "glucose",
  celsius: "temperature",
  fahrenheit: "temperature",
};

const CORRECTION_LEAD_RE = new RegExp(
  `^\\s*(?:(?:no|nope|nah|wrong|incorrect|not quite|not right|that${APOS}s wrong|that is wrong|actually|sorry|wait|hold on|well|үгүй|буруу|биш)${NA}[\\s,.!:–-]*)+`,
  "iu",
);

function correctionTarget(text: string): QuestionId | null {
  let best: { id: QuestionId; at: number } | null = null;
  for (const id of CORRECTION_ORDER) {
    const m = matchesOf(KW[id], text)[0];
    if (!m) continue;
    const at = m.index ?? 0;
    // mood is the weakest cue: it only wins when no measurement keyword is present
    if (id === "mood") {
      if (!best) best = { id, at };
      continue;
    }
    if (!best || best.id === "mood" || at < best.at) best = { id, at };
  }
  if (best) return best.id;
  const unit = numberQtys(text).find((q) => q.unit !== null && UNIT_TARGET[q.unit] !== undefined);
  if (unit && unit.unit) return UNIT_TARGET[unit.unit] ?? null;
  return null;
}

/**
 * A correction at the confirm step ("No, I slept 7 hours"): finds the targeted question by keyword (or by unit) and
 * interprets the rest of the utterance as its answer. question is null when no target can be found.
 */
export function interpretCorrection(text: string, lang: Lang): { question: QuestionDef | null; result: InterpretResult } {
  const t = text.trim();
  const id = correctionTarget(t);
  if (!id) return { question: null, result: unclearResult("no_value") };
  const question = getQuestion(id);
  // a leading "no / wrong" only says "this is not right"; for symptoms it may be part of the answer, so keep it there
  const body = id === "symptoms" ? t : t.replace(CORRECTION_LEAD_RE, "").trim() || t;
  return { question, result: interpretAnswer(question, body, lang) };
}

/* ───────────── yes / no ───────────── */

const YESNO_PATTERNS: ReadonlyArray<readonly [RegExp, boolean]> = [
  // phrases that look negative but confirm
  [wr("no\\s+(?:changes?|problems?|mistakes?|errors?|issues?)|nothing\\s+to\\s+(?:change|correct|fix)|nothing\\s+wrong|not\\s+(?:wrong|incorrect)|буруу\\s+биш|буруу\\s+бус"), true],
  // phrases that look positive but reject
  [wr("not\\s+(?:quite|really|exactly|entirely|correct|right|true)(?:\\s+(?:right|correct))?|that's\\s+(?:not|wrong)|something's\\s+(?:wrong|off)|зөв\\s+биш|зөв\\s+бус|зөв\\s+байхгүй"), false],
  [wr("(?:want|like|need|going)\\s+to\\s+(?:change|correct|fix)|let\\s+me\\s+(?:correct|fix|change)|to\\s+change"), false],
  [wr("yes|yeah|yep|yup|ya|sure|ok(?:ay)?|correct|exactly|absolutely|confirmed?|alright|all\\s+right|affirmative|that(?:'s| is)\\s+(?:right|correct)|all\\s+good|looks\\s+good|everything(?:'s| is)?\\s+(?:correct|right|good)|perfect"), true],
  [rx(`${NB}right${NA}(?!\\s+(?:now|away|here|there|side|after))`), true],
  [wr("no|nope|nah|wrong|incorrect|mistake|change"), false],
  // Mongolian
  [wr("тийм(?:\\s+ээ)?|зөв(?:\\s+байна)?|за|болно|болсон|бүгд\\s+зөв|тэгье|оо?к"), true],
  [wr("үгүй|буруу|биш|бус|болохгүй|алдаатай|засах|өөрчил[\\p{L}]*"), false],
];

const BUT_RE = new RegExp(
  `${NB}(?:but|however|though|except(?:\\s+for)?|apart\\s+from|other\\s+than|besides|only|гэхдээ|харин|гэвч|зөвхөн)${NA}`,
  "iu",
);

/** words that say something has to change, wherever they appear after the connector */
const CHANGE_WORD_RE = new RegExp(
  `${NB}(?:change|changed|wrong|incorrect|mistake|mistaken|fix|different|actually|засах|буруу|өөрчил[\\p{L}]*|алдаа[\\p{L}]*)${NA}`,
  "iu",
);

/** a yes followed by "but / except ..." that names a value or a measurement takes the yes back */
function carriesCorrection(tail: string): boolean {
  if (firstPolarity(tail, YESNO_PATTERNS) === false) return true;
  if (CHANGE_WORD_RE.test(tail)) return true;
  if (extractNumbers(tail).length > 0) return true;
  return (Object.values(KW) as RegExp[]).some((re) => has(re, tail));
}

/**
 * true = yes, false = no, null = neither. A mixed "No, I slept 7 hours" is a no, and so is a yes that is taken back
 * after "but / except / apart from / гэхдээ / харин" when what follows names a number, a measurement or a change
 * ("Yes, but the pulse was 70", "yes except the sleep"). A yes with harmless extra words ("yes, but I am tired") stays
 * a yes. Callers should still run interpretCorrection on every yes that carries extra content.
 */
export function interpretYesNo(text: string, lang: Lang): boolean | null {
  void lang;
  const first = firstPolarity(text, YESNO_PATTERNS);
  if (first === true) {
    const at = text.search(BUT_RE);
    if (at > 0 && carriesCorrection(text.slice(at))) return false;
  }
  return first;
}

/* ───────────── start of the measurements ───────────── */

const START_LATER_RE = new RegExp(
  `${NB}(?:later|not\\s+now|not\\s+yet|not\\s+today|not\\s+right\\s+now|another\\s+time|maybe\\s+later|дараа|одоохондоо)${NA}`,
  "iu",
);

const START_PATTERNS: ReadonlyArray<readonly [RegExp, boolean]> = [
  [wr("no\\s+(?:problem|worries|worry)|why\\s+not|of\\s+course|sounds\\s+good|let's\\s+(?:do\\s+it|go|start|begin|log|get\\s+started|do\\s+this)|go\\s+ahead|get\\s+started"), true],
  [wr("give\\s+me\\s+a\\s+(?:minute|moment|second)|hold\\s+on|in\\s+a\\s+(?:bit|minute|moment)"), false],
  [wr("yes|yeah|yep|yup|ya|sure|alright|all\\s+right|ready|please|absolutely|start|begin"), true],
  // "okay" agrees, but "I'm okay" / "feeling ok" is small talk about how the person is
  [rx(`${NB}(?<!i'm\\s)(?<!i\\sam\\s)(?<!feeling\\s)(?<!feel\\s)(?<!am\\s)ok(?:ay)?${NA}`), true],
  [wr("no|nope|nah|wait|stop"), false],
  // Mongolian ("fine" / "зүгээр" are small-talk answers, not agreement, so they are not listed)
  [wr("тийм(?:\\s+ээ)?|за|болно|болъё|хийе|хийцгээе|эхэлье|эхэлцгээе|эхэл|тэгье|бэлэн|мэдээж"), true],
  [wr("үгүй|болохгүй|хүлээ|хүсэхгүй|боломжгүй|биш"), false],
];

/** answer to "Shall we log today's measurements together?" */
export function interpretStart(text: string, lang: Lang): "yes" | "no" | "unclear" {
  void lang;
  if (START_LATER_RE.test(text)) return "no";
  const v = firstPolarity(text, START_PATTERNS);
  if (v === null) return "unclear";
  return v ? "yes" : "no";
}

/* ───────────── opportunistic extraction ───────────── */

const OPPORTUNISTIC: ReadonlyArray<{ id: QuestionId; pre: boolean }> = [
  { id: "sleep", pre: true },
  { id: "blood_pressure", pre: false },
  { id: "heart_rate", pre: false },
  { id: "temperature", pre: false },
  { id: "glucose", pre: false },
  { id: "water", pre: true },
  { id: "exercise", pre: true },
  { id: "mood", pre: false },
  { id: "workload", pre: false },
];

const UNIT_LETTERS_RE = /(?:hours?|hrs?|minutes?|mins?|litres?|liters?|ml|цаг|минут|мин|литр|мл|л)(?![\p{L}])/iu;

/** durations and volumes are only taken from small talk when a unit is spoken ("I slept 6 hours", never "slept at 11") */
const UNIT_KEYS: Partial<Record<QuestionId, KpiKey>> = {
  sleep: "sleep_hours",
  exercise: "exercise_min",
  water: "water_ml",
};

/** two different quantities for one of these keys in one stretch of speech ("8 hours yesterday but only 5 today") */
function hasConflictingQuantities(id: QuestionId, segment: string, countBare: boolean): boolean {
  const relevant = (u: UnitKind): boolean => (id === "water" ? u === "litre" || u === "ml" : u === "hour" || u === "minute");
  const values = mergeCompound(segment, quantitiesOf(segment))
    .filter((q) => (q.unit === null ? countBare && !clockTagged(segment, q) && !isLoneNeg(segment, q) : relevant(q.unit)))
    .map((q) => {
      if (id === "sleep") return q.unit === "minute" ? q.value / 60 : q.value;
      if (id === "exercise") return q.unit === "hour" ? q.value * 60 : q.value;
      return q.unit === "litre" ? q.value * 1000 : q.value;
    });
  return new Set(values.map((v) => round(v, 2))).size > 1;
}

/**
 * Values volunteered during small talk or for another question ("I slept 6 hours and my pulse is 70").
 * Only a keyword with a clear number next to it counts (confidence 0.9); words-only guesses are never taken.
 * Sleep, exercise and water additionally need a spoken unit, and a key spoken with two different values is dropped:
 * "I went to sleep at 11", "sleep quality 3" and "I did exercise 2 times" give nothing.
 */
export function interpretOpportunistic(text: string, lang: Lang): InterpretedRecord[] {
  const t = text.trim();
  if (t.length === 0) return [];

  const hits = resolveHits(
    t,
    OPPORTUNISTIC.map(({ id }) => [KW[id], id] as const),
  );
  const found = new Map<KpiKey, InterpretedRecord>();
  const conflicted = new Set<KpiKey>();
  const accept = (id: QuestionId, segment: string, needUnit: boolean): boolean => {
    const unitKey = UNIT_KEYS[id];
    // after the keyword every bare number belongs to it; before it the slice may hold the previous keyword's number
    if (unitKey && hasConflictingQuantities(id, segment, !needUnit)) {
      conflicted.add(unitKey);
      return true;
    }
    const res = interpretAnswer(getQuestion(id), segment, lang);
    if (res.unclear || res.records.length === 0) return false;
    if (!res.records.every((r) => r.confidence >= CONF_ONE)) return false;
    if ((needUnit || unitKey !== undefined) && !res.records.some((r) => UNIT_LETTERS_RE.test(r.sourceText))) return false;
    for (const r of res.records) {
      const prev = found.get(r.key);
      if (!prev) found.set(r.key, r);
      else if (prev.value !== r.value) conflicted.add(r.key);
    }
    return true;
  };

  hits.forEach((hit, i) => {
    const next = i + 1 < hits.length ? hits[i + 1].start : t.length;
    // a number between this keyword and the next one belongs to this keyword
    const post = t.slice(hit.end, Math.min(next, hit.end + 60));
    if (accept(hit.value, post, false)) return;
    // "6 hours of sleep", "40 minutes of exercise": the number comes first and carries a unit
    const spec = OPPORTUNISTIC.find((o) => o.id === hit.value);
    if (spec?.pre) {
      const prevEnd = i > 0 ? hits[i - 1].end : 0;
      const pre = t.slice(Math.max(prevEnd, hit.start - 40), hit.end);
      accept(hit.value, pre, true);
    }
  });
  return [...found.values()].filter((r) => !conflicted.has(r.key));
}
