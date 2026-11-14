/**
 * KPI and question registry — docs/DASHBOARD_PLAN.md section 1 and 1.1.
 * One table drives validation, display text, the status model, the radar axes and the hazard links.
 * Every threshold here is a "demo parameter", never a clinical limit.
 * Pure TypeScript: no I/O, no Next or React imports.
 */

import type {
  Bilingual,
  KpiDef,
  KpiKey,
  Lang,
  MeasurementValue,
  QuestionDef,
  QuestionId,
} from "../types";
import { KPI_KEYS } from "../types";
import { formatNumber } from "../health/format";

/* ───────────── per-key definitions (section 1.1) ───────────── */

const VISION_CATEGORIES: Record<number, Bilingual> = {
  0: { en: "Clear", mn: "Тод" },
  1: { en: "Slightly blurred", mn: "Бага зэрэг бүдэг" },
  2: { en: "Clearly blurred", mn: "Бүдэг" },
};

export const KPI_DEFS: Record<KpiKey, KpiDef> = {
  sleep_hours: {
    key: "sleep_hours",
    question: "sleep",
    slot: "morning",
    type: "number",
    unit: "h",
    min: 0,
    max: 14,
    labels: { en: "Sleep", mn: "Унтсан цаг" },
    hazards: ["isolation_confinement"],
    axis: "sleep",
    thresholds: { low: { yellow: 7, red: 5 } },
    sdFloor: 0.3,
  },
  mood: {
    key: "mood",
    question: "mood",
    slot: "morning",
    type: "scale",
    unit: null,
    min: 1,
    max: 5,
    labels: { en: "Mood", mn: "Сэтгэл санаа" },
    hazards: ["isolation_confinement"],
    axis: "behavioral",
    thresholds: { low: { yellow: 3, red: 2 } },
    sdFloor: 0.4,
  },
  symptom_headache: {
    key: "symptom_headache",
    question: "symptoms",
    slot: "morning",
    type: "boolean",
    unit: null,
    min: 0,
    max: 1,
    labels: { en: "Headache", mn: "Толгой өвдөлт" },
    hazards: ["gravity"],
    axis: "neuro_ocular",
    thresholds: { high: { yellow: 0, red: 1 } },
    maxLevel: "yellow",
  },
  symptom_dizziness: {
    key: "symptom_dizziness",
    question: "symptoms",
    slot: "morning",
    type: "boolean",
    unit: null,
    min: 0,
    max: 1,
    labels: { en: "Dizziness", mn: "Толгой эргэлт" },
    hazards: ["gravity"],
    axis: "neuro_ocular",
    thresholds: { high: { yellow: 0, red: 1 } },
    maxLevel: "yellow",
  },
  symptom_nausea: {
    key: "symptom_nausea",
    question: "symptoms",
    slot: "morning",
    type: "boolean",
    unit: null,
    min: 0,
    max: 1,
    labels: { en: "Nausea", mn: "Дотор муухайрах" },
    hazards: ["hostile_closed_environment"],
    axis: "metabolic",
    thresholds: { high: { yellow: 0, red: 1 } },
    maxLevel: "yellow",
  },
  symptom_note: {
    key: "symptom_note",
    question: "symptoms",
    slot: "morning",
    type: "text",
    unit: null,
    labels: { en: "Symptom note", mn: "Шинж тэмдгийн тэмдэглэл" },
    hazards: [],
    axis: null,
  },
  bp_systolic: {
    key: "bp_systolic",
    question: "blood_pressure",
    slot: "morning",
    type: "integer",
    unit: "mmHg",
    min: 70,
    max: 220,
    labels: { en: "Systolic blood pressure", mn: "Цусны дээд даралт" },
    hazards: ["gravity"],
    axis: "cardio",
    thresholds: { low: { yellow: 100, red: 90 }, high: { yellow: 129, red: 139 } },
    sdFloor: 3,
  },
  bp_diastolic: {
    key: "bp_diastolic",
    question: "blood_pressure",
    slot: "morning",
    type: "integer",
    unit: "mmHg",
    min: 40,
    max: 140,
    labels: { en: "Diastolic blood pressure", mn: "Цусны доод даралт" },
    hazards: ["gravity"],
    axis: "cardio",
    thresholds: { low: { yellow: 60, red: 55 }, high: { yellow: 84, red: 89 } },
    sdFloor: 2,
  },
  heart_rate: {
    key: "heart_rate",
    question: "heart_rate",
    slot: "morning",
    type: "integer",
    unit: "bpm",
    min: 30,
    max: 200,
    labels: { en: "Heart rate", mn: "Пульс" },
    hazards: ["gravity"],
    axis: "cardio",
    thresholds: { low: { yellow: 50, red: 40 }, high: { yellow: 90, red: 110 } },
    sdFloor: 2,
  },
  temperature_c: {
    key: "temperature_c",
    question: "temperature",
    slot: "morning",
    type: "number",
    unit: "°C",
    min: 34,
    max: 42,
    labels: { en: "Body temperature", mn: "Биеийн температур" },
    hazards: ["hostile_closed_environment"],
    axis: "metabolic",
    thresholds: { low: { yellow: 36.0, red: 35.5 }, high: { yellow: 37.5, red: 38.0 } },
    sdFloor: 0.15,
  },
  glucose_mgdl: {
    key: "glucose_mgdl",
    question: "glucose",
    slot: "midday",
    type: "integer",
    unit: "mg/dL",
    min: 40,
    max: 400,
    labels: { en: "Blood glucose", mn: "Цусны сахар" },
    hazards: ["hostile_closed_environment"],
    axis: "metabolic",
    thresholds: { low: { yellow: 70, red: 60 }, high: { yellow: 140, red: 180 } },
    sdFloor: 5,
  },
  water_ml: {
    key: "water_ml",
    question: "water",
    slot: "midday",
    type: "integer",
    unit: "ml",
    min: 0,
    max: 6000,
    labels: { en: "Water intake", mn: "Уусан ус" },
    hazards: ["gravity"],
    axis: "metabolic",
    thresholds: { low: { yellow: 2000, red: 1000 } },
    maxLevel: "yellow",
    sdFloor: 150,
  },
  exercise_min: {
    key: "exercise_min",
    question: "exercise",
    slot: "afternoon",
    type: "integer",
    unit: "min",
    min: 0,
    max: 240,
    labels: { en: "Exercise", mn: "Дасгал" },
    hazards: ["gravity"],
    axis: "musculoskeletal",
    thresholds: { low: { yellow: 45, red: 15 } },
    maxLevel: "yellow",
    sdFloor: 5,
  },
  vision_check: {
    key: "vision_check",
    question: "vision",
    slot: "afternoon",
    type: "category",
    unit: null,
    min: 0,
    max: 2,
    labels: { en: "Vision check", mn: "Хараа шалгалт" },
    hazards: ["gravity"],
    axis: "neuro_ocular",
    thresholds: { high: { yellow: 0, red: 1 } },
    sdFloor: 0.3,
    categories: VISION_CATEGORIES,
  },
  workload: {
    key: "workload",
    question: "workload",
    slot: "evening",
    type: "scale",
    unit: null,
    min: 1,
    max: 5,
    labels: { en: "Workload", mn: "Ажлын ачаалал" },
    hazards: ["isolation_confinement"],
    axis: "behavioral",
    thresholds: { high: { yellow: 3, red: 6 } },
    maxLevel: "yellow",
    sdFloor: 0.4,
  },
  day_note: {
    key: "day_note",
    question: "day_note",
    slot: "evening",
    type: "text",
    unit: null,
    labels: { en: "Day note", mn: "Өдрийн тэмдэглэл" },
    hazards: [],
    axis: null,
  },
};

/* ───────────── question list (section 1) ───────────── */

export const QUESTIONS: QuestionDef[] = [
  {
    id: "sleep",
    order: 1,
    slot: "morning",
    keys: ["sleep_hours"],
    optional: false,
    prompts: { en: "How many hours did you sleep?", mn: "Хэдэн цаг унтсан бэ?" },
  },
  {
    id: "mood",
    order: 2,
    slot: "morning",
    keys: ["mood"],
    optional: false,
    prompts: {
      en: "How is your mood, from 1 to 5?",
      mn: "Сэтгэл санаа ямар байна, 1-ээс 5 хүртэл?",
    },
  },
  {
    id: "symptoms",
    order: 3,
    slot: "morning",
    keys: ["symptom_headache", "symptom_dizziness", "symptom_nausea", "symptom_note"],
    optional: false,
    prompts: {
      en: "Any headache, dizziness or nausea?",
      mn: "Толгой өвдөх, толгой эргэх, дотор муухайрах зүйл байна уу?",
    },
  },
  {
    id: "blood_pressure",
    order: 4,
    slot: "morning",
    keys: ["bp_systolic", "bp_diastolic"],
    optional: false,
    prompts: { en: "What is your blood pressure?", mn: "Цусны даралт хэд байна?" },
  },
  {
    id: "heart_rate",
    order: 5,
    slot: "morning",
    keys: ["heart_rate"],
    optional: false,
    prompts: { en: "What is your pulse?", mn: "Пульс хэд байна?" },
  },
  {
    id: "temperature",
    order: 6,
    slot: "morning",
    keys: ["temperature_c"],
    optional: false,
    prompts: { en: "What is your body temperature?", mn: "Биеийн температур хэд байна?" },
  },
  {
    id: "glucose",
    order: 7,
    slot: "midday",
    keys: ["glucose_mgdl"],
    optional: false,
    prompts: {
      en: "What is your blood glucose, in mg/dL?",
      mn: "Цусны сахар хэд байна (mg/dL)?",
    },
  },
  {
    id: "water",
    order: 8,
    slot: "midday",
    keys: ["water_ml"],
    optional: false,
    prompts: {
      en: "How much water have you had today, in millilitres?",
      mn: "Өнөөдөр хэдэн мл ус уусан бэ?",
    },
  },
  {
    id: "exercise",
    order: 9,
    slot: "afternoon",
    keys: ["exercise_min"],
    optional: false,
    prompts: {
      en: "How many minutes did you exercise?",
      mn: "Хэдэн минут дасгал хийсэн бэ?",
    },
  },
  {
    id: "vision",
    order: 10,
    slot: "afternoon",
    keys: ["vision_check"],
    optional: false,
    prompts: {
      en: "Quick vision check: cover one eye, then the other, and read a line of text. Is it sharp, slightly blurred or clearly blurred?",
      mn: "Хараа шалгая: нэг нүдээ, дараа нь нөгөөгөө таглаад нэг мөр бичвэр уншаарай. Тод уу, бага зэрэг бүдэг үү, эсвэл бүдэг үү?",
    },
  },
  {
    id: "workload",
    order: 11,
    slot: "evening",
    keys: ["workload"],
    optional: false,
    prompts: {
      en: "How heavy was today's workload, from 1 to 5?",
      mn: "Өнөөдрийн ажлын ачаалал хэр байсан, 1-ээс 5?",
    },
  },
  {
    id: "day_note",
    order: 12,
    slot: "evening",
    keys: ["day_note"],
    optional: true,
    prompts: {
      en: "Anything else you want to note about today?",
      mn: "Өнөөдрийн талаар нэмж тэмдэглэх зүйл байна уу?",
    },
  },
];

/* ───────────── key groups ───────────── */

/** the two free-text keys */
export const TEXT_KEYS: KpiKey[] = KPI_KEYS.filter((k) => KPI_DEFS[k].type === "text");

/** keys that may stay empty without blocking a question or a slot */
export const OPTIONAL_KEYS: ReadonlySet<KpiKey> = new Set<KpiKey>(["symptom_note", "day_note"]);

/** every key except the two text keys (14) */
export const NUMERIC_KEYS: KpiKey[] = KPI_KEYS.filter((k) => KPI_DEFS[k].type !== "text");

/** the 14 non-text keys used by the "overall green needs >= 10 values" rule */
export const CHECKIN_TARGET_KEYS: KpiKey[] = [...NUMERIC_KEYS];

export function getKpi(key: KpiKey): KpiDef {
  return KPI_DEFS[key];
}

export function getQuestion(id: QuestionId): QuestionDef {
  const q = QUESTIONS.find((x) => x.id === id);
  if (!q) throw new Error(`Unknown question id: ${id}`);
  return q;
}

export function isTextKey(key: KpiKey): boolean {
  return KPI_DEFS[key].type === "text";
}

/* ───────────── value helpers ───────────── */

const NUMERIC_STRING = /^[+-]?\d+(?:[.,]\d+)?$/;

/** a thousands-grouped whole number such as "2,000", "1.500" or "12,345,678" */
const GROUPED_INTEGER = /^\d{1,3}(?:[,.]\d{3})+$/;

/** finite number, or a numeric string such as "36,6"; anything else -> null */
export function asNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!NUMERIC_STRING.test(s)) return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const YES_WORDS = new Set(["yes", "y", "true", "тийм"]);
const NO_WORDS = new Set(["no", "n", "false", "үгүй"]);

export type ValidationResult =
  | { ok: true; value: MeasurementValue }
  | { ok: false; reason: "type" | "range"; message: Bilingual };

function fail(reason: "type" | "range", en: string, mn: string): ValidationResult {
  return { ok: false, reason, message: { en, mn } };
}

function unitText(def: KpiDef, lang: Lang): string {
  if (!def.unit) return "";
  return lang === "mn" ? (MN_UNITS[def.unit] ?? def.unit) : def.unit;
}

const MN_UNITS: Record<string, string> = { h: "цаг", min: "мин", ml: "мл", bpm: "удаа/мин" };

export const MAX_TEXT_LENGTH = 500;

/**
 * Validates and normalises one raw answer for one key.
 * Numbers, numeric strings, booleans and the words yes/no/тийм/үгүй (boolean keys only) are accepted;
 * hard ranges, integer-ness and category codes are enforced; text keys take non-empty strings up to 500 chars.
 */
export function validateValue(key: KpiKey, raw: unknown): ValidationResult {
  const def = KPI_DEFS[key];

  if (def.type === "text") {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return fail("type", "Please give a short text.", "Богино бичвэр өгнө үү.");
    }
    const text = raw.trim();
    if (text.length > MAX_TEXT_LENGTH) {
      return fail(
        "range",
        `The text is too long (max ${MAX_TEXT_LENGTH} characters).`,
        `Бичвэр хэт урт байна (дээд тал нь ${MAX_TEXT_LENGTH} тэмдэгт).`,
      );
    }
    return { ok: true, value: text };
  }

  if (def.type === "boolean") {
    let n: number | null = null;
    if (typeof raw === "boolean") {
      n = raw ? 1 : 0;
    } else if (typeof raw === "string") {
      const word = raw.trim().toLowerCase();
      if (YES_WORDS.has(word)) n = 1;
      else if (NO_WORDS.has(word)) n = 0;
      else n = asNumber(word);
    } else {
      n = asNumber(raw);
    }
    if (n === null) return fail("type", "Please answer yes or no.", "Тийм эсвэл үгүй гэж хариулна уу.");
    if (n !== 0 && n !== 1) return fail("range", "Please answer yes or no.", "Тийм эсвэл үгүй гэж хариулна уу.");
    return { ok: true, value: n };
  }

  // numeric families: number | integer | scale | category
  let n: number | null = null;
  if (typeof raw === "string" && def.type === "category" && def.categories) {
    const word = raw.trim().toLowerCase();
    for (const [code, label] of Object.entries(def.categories)) {
      if (label.en.toLowerCase() === word || label.mn.toLowerCase() === word) {
        n = Number(code);
        break;
      }
    }
  }
  if (n === null && typeof raw === "string" && def.type !== "number") {
    // whole-number keys: "2,000" / "2.000" mean two thousand, not two (a decimal separator is never meant here)
    const s = raw.trim();
    if (GROUPED_INTEGER.test(s)) n = Number(s.replace(/[,.]/g, ""));
  }
  if (n === null) n = asNumber(raw); // booleans and everything else non-numeric -> null
  if (n === null) {
    return fail("type", `Please give a number for ${def.labels.en.toLowerCase()}.`, `${def.labels.mn}-д тоо хэлнэ үү.`);
  }
  if (def.type !== "number" && !Number.isInteger(n)) {
    return fail("type", "Please give a whole number.", "Бүхэл тоо хэлнэ үү.");
  }
  const min = def.min;
  const max = def.max;
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    const u = def.unit ? ` ${def.unit}` : "";
    const uMn = unitText(def, "mn");
    const uMnText = uMn ? ` ${uMn}` : "";
    return fail(
      "range",
      `${def.labels.en} must be between ${formatNumber(min ?? 0, 2)} and ${formatNumber(max ?? 0, 2)}${u}.`,
      `${def.labels.mn} ${formatNumber(min ?? 0, 2)}-${formatNumber(max ?? 0, 2)}${uMnText} хооронд байх ёстой.`,
    );
  }
  return { ok: true, value: n };
}

/** display text for a stored value, e.g. "124 mmHg", "Yes", "Slightly blurred", "4/5" */
export function formatValue(key: KpiKey, value: MeasurementValue, lang: Lang): string {
  const def = KPI_DEFS[key];
  if (def.type === "text") return String(value);
  const n = asNumber(value);
  if (n === null) return String(value);
  if (def.type === "boolean") {
    if (lang === "mn") return n === 1 ? "Тийм" : "Үгүй";
    return n === 1 ? "Yes" : "No";
  }
  if (def.type === "category") {
    const label = def.categories?.[n];
    if (label) return label[lang];
  }
  if (def.type === "scale") return `${formatNumber(n, 1)}/${def.max ?? 5}`;
  const u = unitText(def, lang);
  return `${formatNumber(n, def.type === "integer" ? 0 : 2)}${u ? ` ${u}` : ""}`;
}

/** the "normal" band as shown on the cards, always labelled as a demo parameter; null for text keys */
export function rangeText(key: KpiKey): Bilingual | null {
  const def = KPI_DEFS[key];
  const th = def.thresholds;
  if (def.type === "text" || !th) return null;
  const lo = th.low?.yellow;
  const hi = th.high?.yellow;
  if (lo === undefined && hi === undefined) return null;

  const body = (lang: Lang): string => {
    const prefix = lang === "mn" ? "Хэвийн" : "Normal";
    const u = unitText(def, lang);
    const us = u ? ` ${u}` : "";
    if (def.type === "boolean" || def.type === "category") {
      // only a "high" bound exists: values up to it are normal, e.g. "No" / "Clear"
      const code = hi ?? 0;
      return `${prefix}: ${formatValue(key, code, lang)}`;
    }
    if (lo !== undefined && hi !== undefined) {
      return `${prefix} ${formatNumber(lo, 2)}-${formatNumber(hi, 2)}${us}`;
    }
    if (lo !== undefined) {
      if (def.type === "scale" && def.max !== undefined) return `${prefix} ${formatNumber(lo, 2)}-${def.max}`;
      return `${prefix} ≥ ${formatNumber(lo, 2)}${us}`;
    }
    const upper = hi as number;
    if (def.type === "scale" && def.min !== undefined) return `${prefix} ${def.min}-${formatNumber(upper, 2)}`;
    return `${prefix} ≤ ${formatNumber(upper, 2)}${us}`;
  };

  return {
    en: `${body("en")} · demo parameter`,
    mn: `${body("mn")} · демо параметр`,
  };
}

/* ───────────── question flow ───────────── */

/**
 * A question is filled when all of its required keys are filled (optional keys never block).
 * A question made only of optional keys counts as filled once any of its keys is filled.
 */
export function questionFilled(question: QuestionDef, filled: ReadonlySet<KpiKey>): boolean {
  const required = question.keys.filter((k) => !OPTIONAL_KEYS.has(k));
  if (required.length === 0) return question.keys.some((k) => filled.has(k));
  return required.every((k) => filled.has(k));
}

/**
 * First question, in order, that is not fully filled and not skipped.
 * Optional questions (day_note) are still offered but can be skipped with a single answer, so they never block.
 */
export function nextQuestion(
  filled: ReadonlySet<KpiKey>,
  skipped: ReadonlySet<QuestionId>,
): QuestionDef | null {
  for (const q of QUESTIONS) {
    if (skipped.has(q.id)) continue;
    if (questionFilled(q, filled)) continue;
    return q;
  }
  return null;
}
