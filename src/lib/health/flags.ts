/**
 * Red flags (docs/DASHBOARD_PLAN.md section 2, step 4).
 * Rules: VITAL_RED, HEADACHE_PLUS_VISION, SERIOUS_SYMPTOM_WORD. Texts are calm, say "alert", never claim a diagnosis,
 * and tell the person that the crew medical officer and ground are informed.
 */

import type { KpiKey, MeasurementValue, RedFlag } from "../types";
import { KPI_DEFS, asNumber, formatValue } from "../kpi/registry";
import type { IndicatorEval } from "./status";

/** vitals whose own red status raises VITAL_RED */
export const VITAL_RED_KEYS: KpiKey[] = [
  "bp_systolic",
  "bp_diastolic",
  "heart_rate",
  "temperature_c",
  "glucose_mgdl",
];

/** the two free-text keys scanned for serious words */
export const NOTE_KEYS: KpiKey[] = ["symptom_note", "day_note"];

/** editable keyword lists (lower case). English words match whole words; Mongolian stems match as substrings. */
export const SERIOUS_WORDS_EN: string[] = [
  "chest pain",
  "can't breathe",
  "cant breathe",
  "cannot breathe",
  "can not breathe",
  "faint",
  "fainted",
  "fainting",
  "unconscious",
  "severe pain",
];

export const SERIOUS_WORDS_MN: string[] = [
  "цээж өвд",
  "амьсгал давс",
  "амьсгал давч",
  "ухаан алд",
  "ухаан балр",
  "ухаан балар",
  "хүчтэй өвд",
];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** the serious words found in a note (empty array when none) */
export function findSeriousWords(text: string): string[] {
  const t = normalise(text);
  if (t.length === 0) return [];
  const hits: string[] = [];
  for (const word of SERIOUS_WORDS_EN) {
    const re = new RegExp(`(?:^|[^a-z'])${escapeRegExp(word)}(?:$|[^a-z'])`, "u");
    if (re.test(t)) hits.push(word);
  }
  for (const stem of SERIOUS_WORDS_MN) {
    if (t.includes(stem)) hits.push(stem);
  }
  return hits;
}

function readout(key: KpiKey, value: MeasurementValue, lang: "en" | "mn"): string {
  return `${KPI_DEFS[key].labels[lang]} ${formatValue(key, value, lang)}`;
}

/**
 * Evaluates the three red-flag rules.
 * `indicatorEvals` are the per-key results of evaluateIndicator; the two value-based triggers
 * (vision_check = 2, mood = 1) read `today` directly.
 */
export function evaluateRedFlags(
  today: Partial<Record<KpiKey, MeasurementValue>>,
  indicatorEvals: Partial<Record<KpiKey, IndicatorEval>>,
): RedFlag[] {
  const flags: RedFlag[] = [];

  // VITAL_RED
  const vitalKeys: KpiKey[] = VITAL_RED_KEYS.filter((k) => indicatorEvals[k]?.status === "red");
  if (asNumber(today.vision_check) === 2) vitalKeys.push("vision_check");
  if (asNumber(today.mood) === 1) vitalKeys.push("mood");
  if (vitalKeys.length > 0) {
    const listEn = vitalKeys.map((k) => readout(k, today[k] as MeasurementValue, "en")).join(", ");
    const listMn = vitalKeys.map((k) => readout(k, today[k] as MeasurementValue, "mn")).join(", ");
    flags.push({
      rule: "VITAL_RED",
      keys: vitalKeys,
      text: {
        en: `Alert: in the alert range of the demo parameters: ${listEn}. Please tell your crew medical officer; ground is being informed too.`,
        mn: `Анхааруулга: демо параметрийн анхааруулах түвшинд байгаа заалт: ${listMn}. Багийн эмнэлгийн офицерт мэдэгдээрэй, газрын хяналтад мөн мэдэгдэнэ.`,
      },
    });
  }

  // HEADACHE_PLUS_VISION
  if (asNumber(today.symptom_headache) === 1 && (asNumber(today.vision_check) ?? 0) >= 1) {
    flags.push({
      rule: "HEADACHE_PLUS_VISION",
      keys: ["symptom_headache", "vision_check"],
      text: {
        en: "Alert: a headache together with a blurred vision check. Please tell your crew medical officer; ground is being informed too. The link between the two is suggested, not confirmed.",
        mn: "Анхааруулга: толгой өвдөлт хараа бүдгэрэлттэй хамт илэрлээ. Багийн эмнэлгийн офицерт мэдэгдээрэй, газрын хяналтад мөн мэдэгдэнэ. Хоёрын холбоо нь таамаглал бөгөөд батлагдаагүй.",
      },
    });
  }

  // SERIOUS_SYMPTOM_WORD
  const noteKeys = NOTE_KEYS.filter((k) => {
    const v = today[k];
    return typeof v === "string" && findSeriousWords(v).length > 0;
  });
  if (noteKeys.length > 0) {
    flags.push({
      rule: "SERIOUS_SYMPTOM_WORD",
      keys: noteKeys,
      text: {
        en: "Alert: your note mentions something that needs attention. Please tell your crew medical officer; ground is being informed too.",
        mn: "Анхааруулга: таны тэмдэглэлд анхаарах шаардлагатай зүйл дурдагдсан байна. Багийн эмнэлгийн офицерт мэдэгдээрэй, газрын хяналтад мөн мэдэгдэнэ.",
      },
    });
  }

  return flags;
}
