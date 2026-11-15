import type { KpiKey, Lang, MeasurementValue, QuestionDef, QuestionId } from "@/lib/types";
import { KPI_DEFS, asNumber, formatValue, getQuestion, validateValue } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import { GLUCOSE_MGDL, VITAL_SIGNS } from "@/lib/health/vitalReference";
import { extractNumbers } from "@/lib/numbers/extract";
import { interpretAnswer, interpretCorrection } from "./interpret";

/**
 * Impossible and alarming values (team feedback 2026-11-15):
 *  1. "50" for body temperature or 300 for the pulse made Cosmo say "Sorry, I didn't catch that": the rules saw the
 *     number was out of range, but a live-model turn asked for clarification with reason "unclear". The rules' reading
 *     now decides the reason (rulesRangeKeys), and the re-ask says what was heard and why it is not accepted
 *     (rangeReply): "I heard 50 °C, which is too high for body temperature: it must be between 34 and 42 °C."
 *  2. A value that is possible but past the general danger threshold of the vital-sign reference (temperature 42 °C,
 *     pulse 140) is never acknowledged blandly: dangerNotice says it is above / below the urgent threshold and asks to
 *     measure again and tell the crew medical officer. The summary's red status raises the alert as before.
 *
 * Pure apart from the registry and the reference data. Every number comes from the astronaut's words, the registry's
 * hard ranges or the reference workbook.
 */

/* ───────────── 1. out of range ───────────── */

/**
 * The keys the rules found out of range in these words: for the open question during the check-in, or for the
 * correction at the read-back (question null). Empty when the rules read a usable value or nothing out of range.
 */
export function rulesRangeKeys(question: QuestionId | null, text: string, lang: Lang): KpiKey[] {
  const result = question ? interpretAnswer(getQuestion(question), text, lang) : interpretCorrection(text, lang).result;
  return result.reason === "out_of_range" ? result.rejectedKeys : [];
}

/** the first number in the words that this key cannot take (out of its hard range) */
function heardOutOfRange(key: KpiKey, text: string): number | null {
  for (const n of extractNumbers(text)) {
    const v = validateValue(key, n.value);
    if (!v.ok && v.reason === "range") return n.value;
  }
  return null;
}

/** units as words (the voice reads "h", "°C", "удаа/мин" badly), as in templates.ts */
const EN_UNIT_WORDS: Readonly<Record<string, string>> = {
  h: "hours",
  min: "minutes",
  ml: "millilitres",
  bpm: "beats per minute",
  "°C": "degrees",
  "mg/dL": "milligrams per decilitre",
  mmHg: "mmHg",
};
const MN_UNIT_WORDS: Readonly<Record<string, string>> = {
  h: "цаг",
  min: "минут",
  ml: "миллилитр",
  bpm: "удаа/мин",
  "°C": "хэм",
  "mg/dL": "mg/dL",
  mmHg: "mmHg",
};

function unitWord(key: KpiKey, lang: Lang): string {
  const u = KPI_DEFS[key].unit;
  return u ? ((lang === "mn" ? MN_UNIT_WORDS : EN_UNIT_WORDS)[u] ?? u) : "";
}

function spoken(key: KpiKey, n: number, lang: Lang): string {
  if (lang === "mn" && KPI_DEFS[key].unit === "bpm") return `минутад ${formatNumber(n, 1)} удаа`;
  return `${formatNumber(n, 2)} ${unitWord(key, lang)}`.trim();
}

function rangeText(key: KpiKey, lang: Lang): string {
  const def = KPI_DEFS[key];
  const lo = formatNumber(def.min ?? 0, 2);
  const hi = formatNumber(def.max ?? 0, 2);
  const u = unitWord(key, lang);
  return lang === "mn" ? `${lo}-${hi}${u ? ` ${u}` : ""}` : `between ${lo} and ${hi}${u ? ` ${u}` : ""}`;
}

/** questions answered by reading an instrument: "measure again"; the rest: "say it again" */
const MEASURED: ReadonlySet<QuestionId> = new Set<QuestionId>(["blood_pressure", "heart_rate", "temperature", "glucose"]);

/**
 * The re-ask after a value out of range, naming what was heard: null when no out-of-range number can be found in the
 * words (the registry's general range message is used then).
 */
export function rangeReply(question: QuestionDef, text: string, lang: Lang, attempt: number): string | null {
  type Heard = { shown: string; label: string; high: boolean; range: string };
  let heard: Heard | null = null;
  if (question.id === "blood_pressure") {
    const nums = extractNumbers(text).map((n) => n.value);
    if (nums.length >= 2) {
      const [sys, dia] = nums;
      const sysBad = !validateValue("bp_systolic", sys).ok;
      const diaBad = !validateValue("bp_diastolic", dia).ok;
      if (sysBad || diaBad) {
        const key: KpiKey = sysBad ? "bp_systolic" : "bp_diastolic";
        const value = sysBad ? sys : dia;
        heard = {
          shown: lang === "mn" ? `${formatNumber(sys, 0)} дээр ${formatNumber(dia, 0)}` : `${formatNumber(sys, 0)} over ${formatNumber(dia, 0)}`,
          label: KPI_DEFS[key].labels[lang],
          high: value > (KPI_DEFS[key].max ?? Infinity),
          range: rangeText(key, lang),
        };
      }
    }
  } else if (question.keys.length >= 1) {
    const key = question.keys[0];
    const def = KPI_DEFS[key];
    if (def.type !== "text" && def.type !== "boolean" && def.type !== "category") {
      const value = heardOutOfRange(key, text);
      if (value !== null) {
        heard = { shown: spoken(key, value, lang), label: def.labels[lang], high: value > (def.max ?? Infinity), range: rangeText(key, lang) };
      }
    }
  }
  if (!heard) return null;
  const again = attempt >= 1;
  const measured = MEASURED.has(question.id);
  if (lang === "mn") {
    return [
      `${again ? "Дахиад " : ""}${heard.label}: ${heard.shown} гэж сонслоо, энэ нь хэт ${heard.high ? "өндөр" : "бага"} утга байна (${heard.range} хооронд байх ёстой).`,
      measured ? "Дахин хэмжээд хэлнэ үү?" : "Дахин хэлнэ үү?",
    ].join(" ");
  }
  const label = heard.label.charAt(0).toLowerCase() + heard.label.slice(1);
  return [
    `${again ? "Still not possible: I" : "I"} heard ${heard.shown}, which is too ${heard.high ? "high" : "low"} for ${label}: it must be ${heard.range}.`,
    measured ? "Could you measure again?" : "Could you say it again?",
  ].join(" ");
}

/* ───────────── 2. past a general danger threshold ───────────── */

interface Danger {
  key: KpiKey;
  value: number;
  threshold: number;
  above: boolean;
}

function dangerOf(key: KpiKey, value: number): Danger | null {
  const check = (below: number | null, above: number | null, aboveInclusive = false): Danger | null => {
    if (below !== null && value < below) return { key, value, threshold: below, above: false };
    if (above !== null && (aboveInclusive ? value >= above : value > above)) return { key, value, threshold: above, above: true };
    return null;
  };
  switch (key) {
    case "heart_rate":
      return check(VITAL_SIGNS.heart_rate.dangerBelow, VITAL_SIGNS.heart_rate.dangerAbove);
    case "temperature_c":
      return check(VITAL_SIGNS.temperature.dangerBelow, VITAL_SIGNS.temperature.dangerAbove);
    case "glucose_mgdl":
      return check(GLUCOSE_MGDL.dangerBelow, GLUCOSE_MGDL.dangerAbove);
    // "180 or higher, or below 90" / "120 or higher"
    case "bp_systolic":
      return check(VITAL_SIGNS.bp_systolic.dangerBelow, VITAL_SIGNS.bp_systolic.dangerAbove, true);
    case "bp_diastolic":
      return check(VITAL_SIGNS.bp_diastolic.dangerBelow, VITAL_SIGNS.bp_diastolic.dangerAbove, true);
    default:
      return null;
  }
}

/** the values among these records that are past a danger threshold of the general vital-sign reference */
export function dangerValues(records: ReadonlyArray<{ key: KpiKey; value: MeasurementValue }>): Danger[] {
  const out: Danger[] = [];
  const seen = new Set<KpiKey>();
  for (const r of records) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const n = asNumber(r.value);
    if (n === null) continue;
    const d = dangerOf(r.key, n);
    if (d) out.push(d);
  }
  return out;
}

/**
 * "Body temperature 42 °C is above the urgent level of 39.5 °C in the general reference for resting adults. Please
 * measure again, and if it is the same, tell the crew medical officer now." Empty when nothing is past a threshold.
 */
export function dangerNotice(records: ReadonlyArray<{ key: KpiKey; value: MeasurementValue }>, lang: Lang): string {
  const found = dangerValues(records);
  if (found.length === 0) return "";
  const parts = found.map((d) => {
    const label = KPI_DEFS[d.key].labels[lang];
    const v = spoken(d.key, d.value, lang);
    const th = spoken(d.key, d.threshold, lang);
    if (lang === "mn") return `${label} ${v} нь яаралтай босгоос (${th}) ${d.above ? "дээш" : "доош"} байна`;
    return `${label.charAt(0).toLowerCase()}${label.slice(1)} ${v} is ${d.above ? "above" : "below"} the urgent level of ${th}`;
  });
  if (lang === "mn") {
    return `Насанд хүрэгчийн ерөнхий лавлагаагаар ${parts.join("; ")}. Дахин хэмжээд, хэвээр байвал багийн эмнэлгийн офицерт одоо мэдэгдээрэй.`;
  }
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} in the general reference for resting adults. Please measure again, and if it is the same, tell the crew medical officer now.`;
}
