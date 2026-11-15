import "server-only";
import type { ConversationState, KpiKey, Lang, MeasurementValue, TurnEvent } from "@/lib/types";
import { buildKpiStats, evaluateDay, isReadinessAvailable, type HistoryDay } from "@/lib/health";
import { KPI_DEFS, asNumber } from "@/lib/kpi/registry";
import { BODY_KEYS, MAX_SHOW_PANELS, showVitalFromStat, type ShowPanel, type ShowVital } from "@/lib/show";
import { detectAskedQuestion } from "./questions";

/**
 * Which small panels Cosmo shows on screen this turn (src/lib/show.ts). Decided by code from the astronaut's words and
 * the stored data, never by the model:
 *
 *  - a value was recorded (or corrected) this turn: a small card for it (heart rate as the ECG card, water as a ring);
 *  - the astronaut asks about a value or tells Cosmo to show it ("how is my heart rate?", "миний даралт ямар байна?",
 *    "show my sleep", "сүүлийн 14 хоногийн нойр"): a card per value named, a 14-day trend card when the words ask for
 *    the history, the body figure for "my body" / "overall" / "бүх үзүүлэлт", a link card for Signature Triage (blood
 *    panel) and for the urine labs. After the check-in any mention of a value counts as asking.
 *
 * Every number comes from today's stored values, the confirmed 14-day history and its baseline (buildKpiStats, the
 * same numbers the dashboard cards use). Nothing is shown while the summary is being computed (the dashboard opens).
 */

export interface ShowInput {
  text: string;
  lang: Lang;
  /** where the check-in stood when the words arrived */
  state: ConversationState;
  /** keys recorded or corrected in this turn, in order */
  recorded: readonly KpiKey[];
  /** today's values after this turn */
  values: Partial<Record<KpiKey, MeasurementValue>>;
  /** confirmed past days, oldest first (today excluded) */
  history: HistoryDay[];
  /** this turn computes the daily summary (the dashboard is about to open) */
  summary: boolean;
}

/* ───────────── what the words are about ───────────── */

export type ShowTopic =
  | "signature"
  | "labs"
  | "heart"
  | "bp"
  | "glucose"
  | "temperature"
  | "sleep"
  | "mood"
  | "symptoms"
  | "water"
  | "exercise"
  | "vision"
  | "workload"
  | "oxygen"
  | "body";

/** EN + MN patterns, either language in either check-in (people mix them); Cyrillic needs lookarounds, not \b */
const TOPIC_PATTERNS: ReadonlyArray<{ topic: ShowTopic; re: RegExp }> = [
  {
    topic: "signature",
    re: /signature|blood\s+(?:panel|draw|test|work)|biomarker|inflammation|\bil-?6\b|\bcrp\b|цусны\s+шинжилгээ|цус\s+ав|үрэвсэл|биомаркер|сигнатур/iu,
  },
  { topic: "labs", re: /urine|\blabs?\b|lab\s+results?|шээс|лаборатор/iu },
  { topic: "bp", re: /blood\s+pressure|\bbp\b|systolic|diastolic|даралт/iu },
  { topic: "glucose", re: /glucose|blood\s+sugar|\bsugar\b|сахар|глюкоз/iu },
  { topic: "heart", re: /heart|pulse|\bbpm\b|зүрх|пульс|лугшилт/iu },
  { topic: "temperature", re: /temperature|\btemp\b|fever|температур|халуу|биеийн\s+хэм/iu },
  { topic: "sleep", re: /\bsleep|\bslept|\bnap\b|нойр|унт/iu },
  { topic: "mood", re: /\bmood|сэтгэл/iu },
  { topic: "symptoms", re: /headache|dizz|nause|symptom|толгой\s+өв|толгой\s+эрг|дотор\s+муу|шинж\s+тэмдэг/iu },
  { topic: "water", re: /\bwater\b|hydrat|\bdrink|\bfluids?\b|(?<![\p{L}])ус(?:ны|аа|ыг|анд)?(?![\p{L}])|шингэн|уусан/iu },
  { topic: "exercise", re: /exercis|workout|\btraining\b|\bactivity\b|\bgym\b|дасгал|хөдөлгөөн|спорт/iu },
  { topic: "vision", re: /vision|eyesight|\beyes?\b|\bsight\b|хараа|нүд/iu },
  { topic: "workload", re: /workload|\bstress|ачаалал|стресс/iu },
  { topic: "oxygen", re: /oxygen|\bsp\s*o2\b|saturation|\bbreath|\blungs?\b|хүчилтөрөгч|сатурац|амьсгал|уушг/iu },
  {
    topic: "body",
    re: /\bbody\b|\boverall\b|all\s+(?:of\s+)?my\s+(?:vitals|numbers|values|readings|results)|\bvitals\b|how\s+am\s+i\s+doing\b|my\s+health\b|(?<![\p{L}])бие(?:э|ээ|ийг)?(?![\p{L}])|биеийн\s+байдал|бие\s+махбод|ерөнхий|бүх\s+үзүүлэлт|үзүүлэлтүүд|эрүүл\s+мэнд/iu,
  },
];

const BODY_TEMPERATURE = /body\s+temp|биеийн\s+(?:температур|хэм)/iu;

/** the topics the words name, in the order they appear in the text */
export function showTopics(text: string): ShowTopic[] {
  const found: Array<{ topic: ShowTopic; at: number }> = [];
  for (const { topic, re } of TOPIC_PATTERNS) {
    const m = re.exec(text);
    if (m) found.push({ topic, at: m.index });
  }
  // "body temperature" / "биеийн температур" is about temperature only, not the body map
  const usable = BODY_TEMPERATURE.test(text) ? found.filter((f) => f.topic !== "body") : found;
  return usable.sort((a, b) => a.at - b.at).map((f) => f.topic);
}

const TREND_WORDS =
  /\btrends?\b|\bhistory\b|past\s+(?:two\s+|2\s+|few\s+)?(?:weeks?|days)|\b14\s+days\b|over\s+time|\bgraph\b|\bchart\b|\blately\b|this\s+week|хандлага|түүх|сүүлийн|график|долоо\s+хоног|14\s+хоног|өдрүүд/iu;

const SHOW_WORDS = /\bshow\b|\bdisplay\b|let\s+me\s+see|can\s+i\s+see|\bsee\s+my\b|pull\s+up|харуул|үзүүл|харъя|харж\s+болох/iu;

/** Mongolian question words the check-in reader does not treat as a question on their own ("ямар", "хэд", "хэр") */
const MN_ASK = /(?<![\p{L}])(?:ямар|хэд(?:эн|тэй)?|хэр|юу|вэ|бэ|уу|үү|юү)(?![\p{L}])/iu;

/** the words ask something, or tell Cosmo to show something */
export function asksToSee(text: string, lang: Lang): boolean {
  if (SHOW_WORDS.test(text) || /[?？]/u.test(text) || MN_ASK.test(text)) return true;
  const asked = detectAskedQuestion(text, lang);
  return asked !== null && asked !== "greeting";
}

/* ───────────── panels from the data ───────────── */

const SYMPTOM_KEYS: readonly KpiKey[] = ["symptom_headache", "symptom_dizziness", "symptom_nausea"];
const BP_KEYS: readonly KpiKey[] = ["bp_systolic", "bp_diastolic"];

const TOPIC_KEY: Partial<Record<ShowTopic, KpiKey>> = {
  heart: "heart_rate",
  glucose: "glucose_mgdl",
  temperature: "temperature_c",
  sleep: "sleep_hours",
  mood: "mood",
  water: "water_ml",
  exercise: "exercise_min",
  vision: "vision_check",
  workload: "workload",
};

/** something to show: a value today or at least one past day */
function hasData(v: ShowVital): boolean {
  return v.value !== null || v.history.length > 0;
}

/** the water target the dashboard's donut uses (a demo parameter) */
function waterTarget(): number {
  return KPI_DEFS.water_ml.thresholds?.low?.yellow ?? 2000;
}

interface Built {
  vitals: Map<KpiKey, ShowVital>;
  values: Partial<Record<KpiKey, MeasurementValue>>;
  history: HistoryDay[];
}

function vitalPanel(b: Built, keys: readonly KpiKey[], recorded: boolean): ShowPanel | null {
  const vitals = keys.map((k) => b.vitals.get(k)).filter((v): v is ShowVital => v !== undefined);
  if (!vitals.some(hasData)) return null;
  return { kind: "vital", id: `vital-${keys[0]}`, vitals, recorded };
}

function trendable(b: Built, key: KpiKey): ShowVital | null {
  const vital = b.vitals.get(key);
  if (!vital || vital.history.length < 2 || KPI_DEFS[key].type === "boolean" || KPI_DEFS[key].type === "text") return null;
  return vital;
}

function trendPanel(b: Built, key: KpiKey): ShowPanel | null {
  const vital = trendable(b, key);
  return vital ? { kind: "trend", id: `trend-${key}`, vital } : null;
}

/** blood pressure over the days: one card, systolic above diastolic */
function bpTrendPanel(b: Built): ShowPanel | null {
  const sys = trendable(b, "bp_systolic");
  if (!sys) return null;
  const dia = trendable(b, "bp_diastolic");
  return { kind: "trend", id: "trend-bp_systolic", vital: sys, ...(dia ? { second: dia } : {}) };
}

function ecgPanel(b: Built, recorded: boolean): ShowPanel | null {
  const vital = b.vitals.get("heart_rate");
  if (!vital || !hasData(vital)) return null;
  return { kind: "ecg", id: "ecg-heart_rate", vital, recorded };
}

function waterRing(b: Built, recorded: boolean): ShowPanel | null {
  const vital = b.vitals.get("water_ml");
  if (!vital || !hasData(vital)) return null;
  const value = vital.value === null ? null : asNumber(vital.value);
  return { kind: "ring", id: "ring-water", metric: "water", value, max: waterTarget(), unit: "ml", status: vital.status, recorded };
}

/** the panels for one value recorded in this turn */
function recordedPanels(b: Built, keys: readonly KpiKey[]): ShowPanel[] {
  const out: ShowPanel[] = [];
  const done = new Set<string>();
  for (const key of keys) {
    if (KPI_DEFS[key].type === "text") continue;
    const group = BP_KEYS.includes(key) ? "bp" : SYMPTOM_KEYS.includes(key) ? "symptoms" : key;
    if (done.has(group)) continue;
    done.add(group);
    const panel =
      group === "bp"
        ? vitalPanel(b, BP_KEYS, true)
        : group === "symptoms"
          ? vitalPanel(b, SYMPTOM_KEYS, true)
          : key === "heart_rate"
            ? ecgPanel(b, true)
            : key === "water_ml"
              ? waterRing(b, true)
              : vitalPanel(b, [key], true);
    if (panel) out.push(panel);
  }
  return out;
}

/** the panels for one topic the astronaut asked about */
function topicPanels(b: Built, topic: ShowTopic, trend: boolean, state: ConversationState): ShowPanel[] {
  const one = (p: ShowPanel | null): ShowPanel[] => (p ? [p] : []);
  switch (topic) {
    case "signature":
      return [{ kind: "signature", id: "signature" }];
    case "labs":
      return [{ kind: "labs", id: "labs" }];
    case "oxygen":
      // not part of this prototype's check-in: the ring says so instead of inventing a number
      return [{ kind: "ring", id: "ring-spo2", metric: "spo2", value: null, max: 100, unit: "%", status: "no_data", recorded: false }];
    case "bp":
      return one((trend ? bpTrendPanel(b) : null) ?? vitalPanel(b, BP_KEYS, false));
    case "symptoms":
      return one(vitalPanel(b, SYMPTOM_KEYS, false));
    case "body": {
      const vitals = BODY_KEYS.map((k) => b.vitals.get(k)).filter((v): v is ShowVital => v !== undefined);
      const out: ShowPanel[] = [];
      if (vitals.some((v) => v.value !== null)) out.push({ kind: "body", id: "body", vitals });
      if (state === "DONE" || state === "CONFIRM") {
        const day = evaluateDay(b.values, b.history);
        if (isReadinessAvailable(day.axes)) {
          out.push({
            kind: "ring",
            id: "ring-readiness",
            metric: "readiness",
            value: Math.round(day.readiness),
            max: 100,
            unit: null,
            status: day.overall,
            recorded: false,
          });
        }
      }
      return out;
    }
    default: {
      const key = TOPIC_KEY[topic];
      if (!key) return [];
      if (trend) {
        const p = trendPanel(b, key);
        if (p) return [p];
      }
      if (topic === "heart") return one(ecgPanel(b, false));
      if (topic === "water") return one(waterRing(b, false));
      return one(vitalPanel(b, [key], false));
    }
  }
}

/** the panels for this turn, at most MAX_SHOW_PANELS; empty when nothing is to be shown */
export function decideShow(input: ShowInput): ShowPanel[] {
  if (input.summary) return [];
  const text = input.text.trim();
  const topics = showTopics(text);
  const recorded = input.recorded.filter((k, i, all) => all.indexOf(k) === i);
  const asked = topics.length > 0 && (input.state === "DONE" || asksToSee(text, input.lang));
  if (recorded.length === 0 && !asked) return [];

  const stats = buildKpiStats(input.values, input.history, {});
  const b: Built = {
    vitals: new Map(stats.map((s) => [s.key, showVitalFromStat(s)])),
    values: input.values,
    history: input.history,
  };

  const out: ShowPanel[] = [];
  const push = (panels: ShowPanel[]) => {
    for (const p of panels) if (!out.some((o) => o.id === p.id)) out.push(p);
  };
  // a value given in this turn is shown first; a question in the same words ("72, is that normal?") adds nothing new
  if (recorded.length > 0) push(recordedPanels(b, recorded));
  if (asked) {
    const trend = TREND_WORDS.test(text);
    for (const topic of topics) push(topicPanels(b, topic, trend, input.state));
  }
  return out.slice(0, MAX_SHOW_PANELS);
}

/** the `show` event for this turn, or null when there is nothing to show */
export function showEvent(input: ShowInput): Extract<TurnEvent, { type: "show" }> | null {
  const panels = decideShow(input);
  return panels.length > 0 ? { type: "show", panels } : null;
}
