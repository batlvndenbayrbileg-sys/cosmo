import type { AxisKey, KpiKey, Lang, MeasurementValue, Status } from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { formatValue, getKpi } from "@/lib/kpi/registry";
import { evaluateDay, type HistoryDay } from "@/lib/health";
import { formatNumber } from "@/lib/health/format";
import { NASA_HAZARDS } from "@/lib/nasa/hazards";
import { referenceSentence, type ReferenceTopic } from "@/lib/health/vitalReference";

/**
 * Today's results as plain, code-computed facts in one language. Used (a) as the ONLY source the model may draw on
 * when the astronaut asks about the results after the check-in, and (b) to build Cosmo's spoken dashboard tour.
 * Every number in here is computed by our TypeScript; the model only phrases.
 */

export const STATUS_WORD: Record<Status, Record<Lang, string>> = {
  green: { en: "normal", mn: "хэвийн" },
  yellow: { en: "watch", mn: "анхаарах" },
  red: { en: "alert", mn: "сэрэмжлүүлэг" },
  no_data: { en: "no data", mn: "өгөгдөлгүй" },
};

export const AXIS_NAME: Record<AxisKey, Record<Lang, string>> = {
  sleep: { en: "sleep", mn: "нойр" },
  cardio: { en: "heart and circulation", mn: "зүрх, судас" },
  metabolic: { en: "metabolism and hydration", mn: "бодисын солилцоо, ус" },
  neuro_ocular: { en: "head and vision", mn: "толгой, хараа" },
  behavioral: { en: "mood and workload", mn: "сэтгэл санаа, ачаалал" },
  musculoskeletal: { en: "bones and muscles", mn: "яс, булчин" },
};

export interface ResultsFacts {
  lang: Lang;
  overall: { status: Status; word: string };
  readiness: number;
  headline: string;
  indicators: Array<{ key: KpiKey; label: string; today: string; status: string; usual: string | null }>;
  findings: string[];
  plan: Array<{ title: string; because: string }>;
  alerts: string[];
  bodyAreas: Array<{ axis: AxisKey; name: string; score: number | null; status: string }>;
  hazards: Array<{ name: string; status: string }>;
  /**
   * General resting-adult ranges (src/lib/health/vitalReference.ts), so "what is a normal heart rate?" after the
   * check-in can be answered with them; their numbers are grounded like every other fact.
   */
  generalReference: string[];
  disclaimer: string;
}

const REFERENCE_TOPICS: ReferenceTopic[] = ["heart_rate", "blood_pressure", "temperature", "glucose", "spo2", "breathing_rate"];

export function buildResultsFacts(
  today: Partial<Record<KpiKey, MeasurementValue>>,
  history: HistoryDay[],
  lang: Lang,
): ResultsFacts {
  const day = evaluateDay(today, history);
  const indicators: ResultsFacts["indicators"] = [];
  for (const key of KPI_KEYS) {
    const value = today[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "symptom_note" || key === "day_note") continue; // free text is never echoed into model facts
    const ev = day.indicators[key];
    const def = getKpi(key);
    const usualMean = typeof value === "number" ? baselineMean(history, key) : null;
    indicators.push({
      key,
      label: def.labels[lang],
      today: formatValue(key, value, lang),
      status: STATUS_WORD[ev.status][lang],
      usual: usualMean === null ? null : `${formatNumber(usualMean, def.type === "number" ? 1 : 0)}${def.unit ? ` ${def.unit}` : ""}`,
    });
  }
  return {
    lang,
    overall: { status: day.overall, word: STATUS_WORD[day.overall][lang] },
    readiness: day.readiness,
    headline: day.summary.headline[lang],
    indicators,
    findings: day.summary.findings.map((f) => f.text[lang]),
    plan: day.tasks.map((t) => ({ title: t.title[lang], because: t.why[lang] })),
    alerts: day.redFlags.map((r) => r.text[lang]),
    bodyAreas: day.axes.map((a) => ({
      axis: a.axis,
      name: AXIS_NAME[a.axis][lang],
      score: a.score === null ? null : Math.round(a.score),
      status: STATUS_WORD[a.status][lang],
    })),
    hazards: day.hazards.map((h) => ({
      name: NASA_HAZARDS[h.hazard].name[lang],
      status: h.status === "not_monitored" ? (lang === "mn" ? "хэмжээгүй" : "not monitored here") : STATUS_WORD[h.status][lang],
    })),
    // the "not a diagnosis" caveat is added by code after the answer (turn.ts), never handed to the model to copy: the
    // reply gate refuses model text with "diagnos" in it
    generalReference: REFERENCE_TOPICS.map((t) => referenceSentence(t, lang)),
    disclaimer: day.summary.disclaimer[lang],
  };
}

function baselineMean(history: HistoryDay[], key: KpiKey): number | null {
  const nums = history.map((d) => d.values[key]).filter((v): v is number => typeof v === "number");
  if (nums.length < 5) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** every digit sequence in `text` appears in the facts or in the astronaut's own words */
export function numeralsAreGrounded(text: string, facts: ResultsFacts, userText: string): boolean {
  const source = `${JSON.stringify(facts)} ${userText}`;
  const allowed = new Set((source.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));
  const used = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
  return used.every((n) => allowed.has(n));
}
