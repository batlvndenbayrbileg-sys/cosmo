import "server-only";
import type { Bilingual, KpiKey, Lang, MeasurementValue, Status, TurnEvent } from "@/lib/types";
import { KPI_DEFS, asNumber, formatValue, getQuestion } from "@/lib/kpi/registry";
import { BASELINE_WINDOW_DAYS, buildKpiStats, evaluateDay, isReadinessAvailable, recentHistory, type HistoryDay } from "@/lib/health";
import { DISCLAIMER } from "@/lib/health/summary";
import { formatNumber } from "@/lib/health/format";
import { GLUCOSE_MGDL, VITAL_SIGNS, referenceBand, type ReferenceTopic } from "@/lib/health/vitalReference";
import { BUILTIN_GUIDES, suggestGuides } from "@/lib/emergency";
import {
  MAX_EXPLAIN_BEATS,
  explainTurnText,
  type ExplainEvent,
  type ExplainFlag,
  type ExplainIntent,
  type ExplainPanel,
  type ExplainRange,
  type StoryBeat,
  type Storyboard,
} from "@/lib/explain";
import type { KpiStat } from "@/lib/types";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { ALERT_SPOKEN_NOTICE } from "@/server/alerts";
import { loadHistory, loadTodayValues } from "@/server/checkin/service";
import { appendTurn } from "@/server/db/repos/turn";
import { matchEmergency } from "@/lib/emergency";
import { loadEmergencyLibrary } from "@/server/emergency/load";
import { companionTopic, detectCrisis, namesConditionOrDrug } from "./companion";
import { interpretAnswer, interpretStart } from "./interpret";
import { cursorQuestion, type MachineCtx } from "./machine";
import { showTopics, type ShowTopic } from "./show";
import { referenceCrewFor, signatureFollowUp } from "./signature";
import { dangerNotice, dangerValues } from "./valueChecks";

/**
 * "Cosmo explains": the storyboard of a step-by-step walkthrough (src/lib/explain.ts), built by code from the stored data
 * only (never the model):
 *
 *   1. "checking": an analysing card listing what was recorded today;
 *   2. one beat per notable value, most serious first (past a danger threshold of the general reference, outside the
 *      general normal range, far from the personal 14-day baseline, outside the demo range, a steady 14-day trend), each
 *      with the person's own past days, the shaded personal band, the general (or demo) normal range and today
 *      highlighted;
 *   3. the overview grid of every vital as chips;
 *   4. "recommended actions" from the existing rules (re-measure and tell the crew medical officer for urgent values, the
 *      day's lifestyle tasks), the Contact Mission Control button and the matching emergency guide.
 *
 * It runs after the daily summary (it replaces the dashboard intro) and for "how am I today?" / "өнөөдөр ямар байна?",
 * "was it like this before?" / "өмнө нь ийм байсан уу?" and "why do I feel tired?" / "яагаад ядраад байна?" at any point
 * of the check-in, which then picks up where it was. Every caption is code text and passes the same kind of gate as
 * model text (isSaneCaption): no emoji, no condition or drug name, no treatment word, every numeral from the data.
 */

/* ───────────── what the words ask ───────────── */

const TODAY_EN =
  /how\s+am\s+i(?:\s+doing)?(?:\s+today)?\s*[?？.!]*$|how\s+am\s+i\s+(?:doing\s+)?today|how\s+(?:do\s+i\s+look|did\s+i\s+do|are\s+my\s+(?:results|numbers|vitals|readings))(?:\s+today)?|how(?:'s|\s+is)\s+my\s+(?:health|day|body)\s+today|explain\s+(?:my\s+)?(?:results|today|my\s+day|everything)|walk\s+me\s+through|go\s+through\s+(?:my\s+)?(?:results|today)/iu;
/** "өнөөдөр ямар байна?", "би өнөөдөр ямар байна", "миний бие ямар байна?", "үр дүнгээ тайлбарлаад өг" */
const TODAY_MN =
  /(?:^|[\s,.!?])(?:(?:би|миний(?:\s+бие)?)\s+)?өнөөдөр\s+(?:(?:би|миний(?:\s+бие)?)\s+)?(?:ямар|яаж)\s+(?:байна|байгаа|байгаа\s+вэ|байна\s+вэ|байна\s+уу)|миний\s+бие\s+(?:өнөөдөр\s+)?ямар\s+байна|үр\s+дүн(?:г|гээ|гийг)?\s+(?:минь\s+)?тайлбарла|бүгдийг\s+тайлбарла/iu;
/** asking Cosmo how SHE is ("how are you today?", "та өнөөдөр ямар байна?") is not about the astronaut */
const ABOUT_COSMO = /\bhow\s+are\s+you\b|\byou\b.*\btoday\b|(?<![\p{L}])(?:та|чи|таны|чиний|танд|чамд)(?![\p{L}])/iu;

const BEFORE_EN =
  /(?:was|is)\s+(?:it|this|that)\s+(?:like\s+this|this\s+way|the\s+same|so)\s+before|(?:has|have|had)\s+(?:it|this|that|i)\s+(?:ever\s+|always\s+)?been\s+like\s+this\s+before|has\s+(?:it|this)\s+(?:always\s+)?been\s+(?:like\s+this|this\s+way)|(?:is|was)\s+(?:this|that)\s+(?:usual|normal|typical)\s+for\s+me|compared?\s+(?:to|with)\s+(?:before|my\s+usual|last\s+week|the\s+last\s+(?:two\s+)?weeks)|(?:did|have)\s+i\s+(?:have|had)\s+(?:this|that)\s+before/iu;
/** "өмнө нь ийм байсан уу?", "урьд нь ингэж байсан уу", "өмнөх өдрүүдтэй харьцуулбал", "ердийнхөөсөө өөр үү" */
const BEFORE_MN =
  /өмнө\s*нь\s+(?:ч\s+)?(?:ийм|ингэж|иймэрхүү|ийм\s+л)|урьд\s+нь\s+(?:ийм|ингэж)|өмнөх\s+өдрүүд(?:тэй|ээс|тэйгээ)|ердийнхөөсөө|ердийн\s+(?:үү|юм\s+уу)|өмнө\s+нь\s+байсан\s+уу/iu;
/**
 * "I've never felt like this before", "өмнө нь ийм байгаагүй": a statement of how the person feels, not a question about
 * their numbers (friend mode or the open question takes it, never a chart)
 */
const BEFORE_STATEMENT = /\bnever\b|\bfirst\s+time\b|байгаагүй|хэзээ\s*ч|анх\s+удаа/iu;

const WHY_EN =
  /why\s+(?:do|am|did|have)\s+i\s+(?:feel(?:ing)?|been\s+feeling|so|always|this|been)|why\s+(?:do|does)\s+(?:my\s+)?(?:head|body)\s+(?:hurt|ache|feel)|what(?:'s|\s+is|\s+could\s+be|\s+might\s+be|\s+may\s+be)\s+(?:behind|causing|making\s+me\s+feel)|behind\s+how\s+i\s+feel|why\s+i\s+feel|why\s+(?:am|do)\s+i\s+(?:tired|exhausted|dizzy|stressed|low|down|weak|sleepy)/iu;
/** "яагаад ядраад байна?", "яагаад ийм муу санагдаад байна", "юунаас болж ядарч байна", "яагаад толгой өвдөөд байна" */
const WHY_MN =
  /(?:яагаад|юунаас\s+болж|юунаас\s+болоод|ямар\s+шалтгаан(?:аар)?).{0,40}?(?:ядр|ядар|муу|өвд|эрг|сульд|стресс|санаа\s+зов|нойрмог|хүндр|санагд|мэдрэ|бие)/iu;

/** the question the words ask, or null when they ask none of these */
export function explainIntent(text: string): Exclude<ExplainIntent, "summary"> | null {
  const t = text.trim();
  if (t.length === 0 || t.length > 240) return null;
  // a feeling to share ("why am I so lonely?", "how am I today? I'm so stressed"): friend mode listens, not a chart
  if (companionTopic(t) !== "general") return null;
  if (WHY_EN.test(t) || WHY_MN.test(t)) return "why";
  if (BEFORE_EN.test(t) || BEFORE_MN.test(t)) return BEFORE_STATEMENT.test(t) ? null : "before";
  if ((TODAY_EN.test(t) || TODAY_MN.test(t)) && !ABOUT_COSMO.test(t)) {
    // "how is my sleep today?" names one value: the small panels answer it (show.ts), not a walkthrough
    const topics = showTopics(t).filter((x) => x !== "body");
    return topics.length === 0 ? "today" : null;
  }
  return null;
}

/* ───────────── numbers and words ───────────── */

const EN_UNIT: Readonly<Record<string, string>> = {
  h: "hours",
  min: "minutes",
  ml: "millilitres",
  bpm: "beats per minute",
  "°C": "degrees",
  "mg/dL": "milligrams per decilitre",
  mmHg: "mmHg",
};
const MN_UNIT: Readonly<Record<string, string>> = {
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
  return u ? ((lang === "mn" ? MN_UNIT : EN_UNIT)[u] ?? u) : "";
}

function digitsOf(key: KpiKey): number {
  return KPI_DEFS[key].type === "number" ? 1 : 0;
}

/** a number as Cosmo says it, with its unit in words ("6.5 hours", "минутад 72 удаа", "4 out of 5") */
function spoken(key: KpiKey, n: number, lang: Lang, digits = KPI_DEFS[key].type === "number" ? 2 : 0): string {
  const def = KPI_DEFS[key];
  const v = formatNumber(n, digits);
  if (def.type === "scale") return lang === "mn" ? `${def.max ?? 5}-аас ${v}` : `${v} out of ${def.max ?? 5}`;
  if (def.type === "category" || def.type === "boolean") return formatValue(key, n, lang).toLocaleLowerCase(lang);
  if (lang === "mn" && def.unit === "bpm") return `минутад ${v} удаа`;
  const u = unitWord(key, lang);
  return u ? `${v} ${u}` : v;
}

const BP_KEYS: readonly KpiKey[] = ["bp_systolic", "bp_diastolic"];

/** "124 over 80" / "124 дээр 80" */
function spokenBp(sys: number, dia: number, lang: Lang): string {
  return lang === "mn" ? `${formatNumber(sys, 0)} дээр ${formatNumber(dia, 0)} mmHg` : `${formatNumber(sys, 0)} over ${formatNumber(dia, 0)} mmHg`;
}

function lower(s: string, lang: Lang): string {
  return s.length > 0 ? s.charAt(0).toLocaleLowerCase(lang) + s.slice(1) : s;
}

function upper(s: string, lang: Lang): string {
  return s.length > 0 ? s.charAt(0).toLocaleUpperCase(lang) + s.slice(1) : s;
}

function itemLabel(key: KpiKey, lang: Lang): string {
  if (BP_KEYS.includes(key)) return lang === "mn" ? "цусны даралт" : "blood pressure";
  return lower(KPI_DEFS[key].labels[lang], lang);
}

function join(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(" ");
}

function list(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join("");
  const and = lang === "mn" ? " болон " : ", and ";
  return items.length === 2 && lang === "en"
    ? `${items[0]} and ${items[1]}`
    : `${items.slice(0, -1).join(", ")}${and}${items[items.length - 1]}`;
}

/* ───────────── what stands out ───────────── */

/** the general resting-adult reference for the keys that have one (bpm, mmHg, °C, mg/dL) */
const REFERENCE_OF: Partial<Record<KpiKey, ReferenceTopic>> = {
  heart_rate: "heart_rate",
  bp_systolic: "blood_pressure",
  bp_diastolic: "blood_pressure",
  temperature_c: "temperature",
  glucose_mgdl: "glucose",
};

function generalRange(key: KpiKey): ExplainRange | null {
  switch (key) {
    case "heart_rate":
      return { low: VITAL_SIGNS.heart_rate.normalLow, high: VITAL_SIGNS.heart_rate.normalHigh };
    case "bp_systolic":
      return { low: VITAL_SIGNS.bp_systolic.normalLow, high: VITAL_SIGNS.bp_systolic.normalHigh };
    case "bp_diastolic":
      return { low: VITAL_SIGNS.bp_diastolic.normalLow, high: VITAL_SIGNS.bp_diastolic.normalHigh };
    case "temperature_c":
      return { low: VITAL_SIGNS.temperature.normalLow, high: VITAL_SIGNS.temperature.normalHigh };
    case "glucose_mgdl":
      return { low: GLUCOSE_MGDL.normalLow, high: GLUCOSE_MGDL.normalHigh };
    default:
      return null;
  }
}

function demoRange(key: KpiKey): ExplainRange | null {
  const th = KPI_DEFS[key].thresholds;
  const low = th?.low?.yellow ?? null;
  const high = th?.high?.yellow ?? null;
  return low === null && high === null ? null : { low, high };
}

/** where today's value sits against the general reference for one key ("outside" also for the BP pair's halves) */
function generalBand(key: KpiKey, value: number): "normal" | "outside" | "danger" | null {
  const topic = REFERENCE_OF[key];
  if (!topic) return null;
  if (topic === "blood_pressure") {
    const r = generalRange(key);
    if (r?.high !== null && r?.high !== undefined && value >= r.high) return "outside";
    return "normal";
  }
  return referenceBand(topic, value);
}

interface Item {
  /** the chart's key (bp_systolic for the blood pressure pair) */
  key: KpiKey;
  keys: KpiKey[];
  flag: ExplainFlag;
  direction: "high" | "low" | null;
  severity: number;
  z: number;
  status: Status;
}

const SEVERITY: Record<ExplainFlag, number> = { danger: 5, outside: 3, personal: 2, range: 2, trend: 1, steady: 0 };

/** the chips and items in this order (the body from head to legs, then the yes/no answers) */
const ORDER: readonly KpiKey[] = [
  "sleep_hours",
  "mood",
  "heart_rate",
  "bp_systolic",
  "temperature_c",
  "glucose_mgdl",
  "water_ml",
  "exercise_min",
  "vision_check",
  "workload",
  "symptom_headache",
  "symptom_dizziness",
  "symptom_nausea",
];

function statOf(stats: Map<KpiKey, KpiStat>, key: KpiKey): KpiStat {
  const s = stats.get(key);
  if (!s) throw new Error(`no stat for ${key}`);
  return s;
}

/** a steady rise or fall: the last three days (today included) against the first half, by at least 1.5 spreads */
function trendOf(stat: KpiStat): { direction: "high" | "low"; from: number; to: number } | null {
  const def = KPI_DEFS[stat.key];
  if (def.type !== "number" && def.type !== "integer") return null;
  const today = stat.value === null ? null : asNumber(stat.value);
  if (today === null || stat.baselineMean === null || stat.history.length < 6) return null;
  const all = [...stat.history.map((h) => h.value), today];
  const half = Math.floor(all.length / 2);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const from = mean(all.slice(0, half));
  const to = mean(all.slice(-3));
  const spread = Math.max(stat.baselineSd ?? 0, def.sdFloor ?? 0);
  if (!(spread > 0)) return null;
  const diff = to - from;
  if (Math.abs(diff) < 1.5 * spread || (today - from) * diff <= 0) return null;
  return { direction: diff > 0 ? "high" : "low", from, to };
}

function itemFor(stats: Map<KpiKey, KpiStat>, key: KpiKey): Item | null {
  const keys = key === "bp_systolic" ? [...BP_KEYS] : [key];
  let best: Item | null = null;
  for (const k of keys) {
    const s = statOf(stats, k);
    const value = s.value === null ? null : asNumber(s.value);
    if (value === null) continue;
    const def = KPI_DEFS[k];
    let flag: ExplainFlag = "steady";
    let direction: "high" | "low" | null = null;
    if (dangerValues([{ key: k, value }]).length > 0) {
      flag = "danger";
      const r = generalRange(k);
      direction = r && r.low !== null && value < r.low ? "low" : "high";
    } else if (generalBand(k, value) === "outside") {
      flag = "outside";
      const r = generalRange(k);
      direction = r && r.low !== null && value < r.low ? "low" : "high";
    } else if (s.status === "yellow" || s.status === "red") {
      flag = s.reason === "baseline" ? "personal" : "range";
      if (s.reason === "baseline") direction = (s.delta ?? 0) >= 0 ? "high" : "low";
      else {
        const th = def.thresholds;
        direction = th?.low && value < th.low.yellow ? "low" : th?.high && value > th.high.yellow ? "high" : null;
      }
    } else {
      const trend = trendOf(s);
      if (trend) {
        flag = "trend";
        direction = trend.direction;
      }
    }
    // outside the general range but green by the person's own data and the demo range (124/82 for someone whose usual
    // is 125/81): worth a beat, but after what is unusual for them
    const severity = SEVERITY[flag] + (s.status === "red" ? 1 : 0) - (flag === "outside" && s.status === "green" ? 1.5 : 0);
    const candidate: Item = { key, keys, flag, direction, severity, z: Math.abs(s.z ?? 0), status: s.status };
    if (!best || candidate.severity > best.severity || (candidate.severity === best.severity && candidate.z > best.z)) best = candidate;
  }
  if (!best) return null;
  // the pair's chip status is the worse half
  if (keys.length === 2) {
    const worst = keys.map((k) => statOf(stats, k).status).sort((a, b) => rank(b) - rank(a))[0];
    best = { ...best, status: worst };
  }
  return best;
}

function rank(s: Status): number {
  return s === "red" ? 3 : s === "yellow" ? 2 : s === "green" ? 1 : 0;
}

/** the notable values today, most serious first */
function notableItems(stats: Map<KpiKey, KpiStat>): Item[] {
  return ORDER.map((k, order) => ({ item: itemFor(stats, k), order }))
    .filter((x): x is { item: Item; order: number } => x.item !== null && x.item.flag !== "steady")
    .sort((a, b) => b.item.severity - a.item.severity || b.item.z - a.item.z || a.order - b.order)
    .map((x) => x.item);
}

/* ───────────── panels ───────────── */

function personalBand(stat: KpiStat): ExplainRange | null {
  if (stat.baselineMean === null) return null;
  const sd = Math.max(stat.baselineSd ?? 0, KPI_DEFS[stat.key].sdFloor ?? 0);
  const def = KPI_DEFS[stat.key];
  const round = (n: number) => Number(formatNumber(n, def.type === "number" ? 2 : 1));
  return { low: round(stat.baselineMean - 2 * sd), high: round(stat.baselineMean + 2 * sd) };
}

function seriesOf(stat: KpiStat) {
  return { key: stat.key, points: stat.history.map((h) => ({ date: h.date, value: h.value })), today: stat.value === null ? null : asNumber(stat.value) };
}

function isDaysKey(key: KpiKey): boolean {
  const t = KPI_DEFS[key].type;
  return t === "boolean" || t === "category";
}

function panelFor(stats: Map<KpiKey, KpiStat>, item: Item): ExplainPanel {
  const stat = statOf(stats, item.key);
  if (isDaysKey(item.key)) {
    const today = stat.value === null ? null : asNumber(stat.value);
    const days = stat.history.map((h) => ({ date: h.date, value: h.value }));
    return { kind: "days", key: item.key, days, today, status: item.status, flag: item.flag, count: daysCount(days, today) };
  }
  const general = generalRange(item.key);
  const demo = demoRange(item.key);
  const normal = general ? { ...general, source: "general" as const } : demo ? { ...demo, source: "demo" as const } : null;
  return {
    kind: "chart",
    key: item.key,
    unit: KPI_DEFS[item.key].unit,
    series: item.keys.map((k) => seriesOf(statOf(stats, k))),
    personal: personalBand(stat),
    normal,
    status: item.status,
    flag: item.flag,
    direction: item.direction,
  };
}

/** past days with today's answer (or, on a "no" day, with any "yes") */
function daysCount(days: Array<{ value: number }>, today: number | null): number {
  if (today === null || today === 0) return days.filter((d) => d.value > 0).length;
  return days.filter((d) => d.value === today).length;
}

/* ───────────── captions ───────────── */

/** what one beat says, both languages, plus the numbers it was allowed to use */
interface Said {
  caption: Bilingual;
  facts: number[];
}

function rangeWords(r: ExplainRange, key: KpiKey, lang: Lang): string {
  const u = unitWord(key, lang);
  const us = u ? ` ${u}` : "";
  const f = (n: number) => formatNumber(n, 2);
  if (lang === "mn") {
    if (r.low !== null && r.high !== null) return `${f(r.low)}-${f(r.high)}${us}`;
    if (r.low !== null) return `доод хязгаар ${f(r.low)}${us}`;
    return `дээд хязгаар ${f(r.high as number)}${us}`;
  }
  if (r.low !== null && r.high !== null) return `${f(r.low)} to ${f(r.high)}${us}`;
  if (r.low !== null) return `at least ${f(r.low)}${us}`;
  return `${KPI_DEFS[key].type === "scale" ? "at most" : "below"} ${f(r.high as number)}${us}`;
}

function todayWords(stats: Map<KpiKey, KpiStat>, item: Item, lang: Lang): string | null {
  if (item.keys.length === 2) {
    const sys = statOf(stats, "bp_systolic").value;
    const dia = statOf(stats, "bp_diastolic").value;
    const s = sys === null ? null : asNumber(sys);
    const d = dia === null ? null : asNumber(dia);
    if (s !== null && d !== null) return spokenBp(s, d, lang);
  }
  const v = statOf(stats, item.key).value;
  const n = v === null ? null : asNumber(v);
  return n === null ? null : spoken(item.key, n, lang);
}

/** the key the words of the item are about: for the blood pressure pair, the half that stands out */
function flaggedKey(stats: Map<KpiKey, KpiStat>, item: Item): KpiKey {
  if (item.keys.length < 2) return item.key;
  const dia = statOf(stats, "bp_diastolic");
  const sys = statOf(stats, "bp_systolic");
  return rank(dia.status) > rank(sys.status) || (item.flag === "outside" && generalBand("bp_systolic", asNumber(sys.value) ?? 0) !== "outside")
    ? "bp_diastolic"
    : "bp_systolic";
}

/** the direction each tail is about: "shorter sleep" is never said of a long night */
const WHY_TAIL_DIRECTION: Partial<Record<KpiKey, "high" | "low">> = {
  sleep_hours: "low",
  water_ml: "low",
  workload: "high",
  exercise_min: "low",
};

function whyTail(key: KpiKey, direction: "high" | "low" | null, lang: Lang): string {
  const tail = WHY_TAIL[key];
  return tail && direction === WHY_TAIL_DIRECTION[key] ? tail[lang] : GENERIC_WHY_TAIL[lang];
}

const WHY_TAIL: Partial<Record<KpiKey, Bilingual>> = {
  sleep_hours: {
    en: "Shorter sleep than usual often goes with feeling tired.",
    mn: "Ердийнхөөсөө бага унтах нь ядрахтай ихэвчлэн холбоотой байдаг.",
  },
  water_ml: {
    en: "Drinking less water than planned can leave you tired or with a headache.",
    mn: "Төлөвлөснөөс бага ус уух нь ядрах, толгой өвдөхөд нөлөөлж болно.",
  },
  workload: {
    en: "A heavy workload can add to how tired or stressed you feel.",
    mn: "Ажлын их ачаалал ядрах, стресстэх мэдрэмжийг нэмж болно.",
  },
  exercise_min: {
    en: "Less movement than usual can change how your body feels.",
    mn: "Ердийнхөөсөө бага хөдлөх нь биеийн мэдрэмжид нөлөөлж болно.",
  },
};

const GENERIC_WHY_TAIL: Bilingual = {
  en: "That may be part of how you feel.",
  mn: "Энэ нь таны биеийн байдалд нөлөөлж магадгүй.",
};

const BAND_TAIL: Bilingual = {
  en: "The shaded band is your own usual range.",
  mn: "Сүүдэрлэсэн зурвас бол таны өөрийн ердийн хүрээ.",
};

/** "In the last 14 days your sleep ranged from 6 to 8 hours. It was this low or lower on 2 of those days." */
function comparison(stats: Map<KpiKey, KpiStat>, item: Item, lang: Lang, facts: number[]): string {
  const key = flaggedKey(stats, item);
  const stat = statOf(stats, key);
  const past = stat.history.map((h) => h.value);
  if (past.length === 0) return "";
  const min = Math.min(...past);
  const max = Math.max(...past);
  const d = past.length;
  facts.push(min, max, d);
  const today = stat.value === null ? null : asNumber(stat.value);
  const l = itemLabel(key, lang);
  const lo = spoken(key, min, lang);
  const hi = spoken(key, max, lang);
  const opening =
    lang === "mn"
      ? `Сүүлийн ${d} хоногт таны ${l} хамгийн багадаа ${lo}, хамгийн ихдээ ${hi} байсан.`
      : `In the last ${d} days your ${l} ranged from ${lo} to ${hi}.`;
  if (today === null) return opening;
  const direction = item.direction ?? (today > max ? "high" : today < min ? "low" : null);
  if (direction === null) {
    return join(opening, lang === "mn" ? "Өнөөдрийн утга тэр хүрээнд багтаж байна." : "Today's value sits within that range.");
  }
  const k = past.filter((v) => (direction === "high" ? v >= today : v <= today)).length;
  facts.push(k);
  if (lang === "mn") {
    const word = direction === "high" ? "өндөр" : "бага";
    return join(opening, k === 0 ? `Ийм ${word} өдөр өмнө нь байгаагүй.` : `Ийм ${word} буюу түүнээс ч ${word} өдөр ${k} байсан.`);
  }
  const word = direction === "high" ? "high" : "low";
  return join(
    opening,
    k === 0
      ? `It has not been this ${word} on any of those days.`
      : `It was this ${word} or ${direction === "high" ? "higher" : "lower"} on ${k} of those days.`,
  );
}

function itemCaption(stats: Map<KpiKey, KpiStat>, item: Item, intent: ExplainIntent, firstChart: boolean): Said {
  const facts: number[] = [];
  const caption = { en: "", mn: "" } as Bilingual;
  const key = flaggedKey(stats, item);
  const stat = statOf(stats, key);
  const today = stat.value === null ? null : asNumber(stat.value);
  for (const lang of ["en", "mn"] as const) {
    const l = itemLabel(item.key, lang);
    const labelOwn = itemLabel(key, lang);
    const v = todayWords(stats, item, lang) ?? "";
    const mean = stat.baselineMean;
    const sysMean = statOf(stats, "bp_systolic").baselineMean;
    const diaMean = statOf(stats, "bp_diastolic").baselineMean;
    // blood pressure's usual is said as the pair ("117 over 75"), like today's value
    const u =
      item.keys.length === 2 && sysMean !== null && diaMean !== null
        ? spokenBp(sysMean, diaMean, lang)
        : mean === null
          ? ""
          : spoken(key, mean, lang, digitsOf(key));
    if (item.keys.length === 2 && sysMean !== null && diaMean !== null) facts.push(sysMean, diaMean);
    const usual =
      mean === null ? "" : lang === "mn" ? `Таны ердийн хэмжээ ойролцоогоор ${u}.` : `Your usual is about ${u}.`;
    let base = "";
    if (isDaysKey(item.key)) {
      base = daysSentence(stats, item, lang, facts);
    } else if (item.flag === "danger") {
      const records = item.keys
        .map((k) => ({ key: k, value: statOf(stats, k).value }))
        .filter((r): r is { key: KpiKey; value: MeasurementValue } => r.value !== null);
      base = dangerNotice(records, lang);
      for (const d of dangerValues(records)) facts.push(d.value, d.threshold);
    } else if (item.flag === "outside") {
      const r = generalRange(key) as ExplainRange;
      const words = rangeWords(r, key, lang);
      base =
        lang === "mn"
          ? `Таны ${l} ${v} байна, энэ нь насанд хүрэгчийн ерөнхий хэвийн хэмжээнээс (${words}) ${item.direction === "low" ? "доогуур" : "дээгүүр"} байна.`
          : `Your ${l} is ${v}, ${item.direction === "low" ? "below" : "above"} the general normal range for resting adults (${words}).`;
      base = join(base, intent === "before" ? "" : usual);
    } else if (item.flag === "personal") {
      base =
        lang === "mn"
          ? `Таны ${l} ${v} байна. Ердийн хэмжээ тань ${u}, өнөөдөр түүнээс ${item.direction === "low" ? "бага" : "өндөр"} байна.`
          : `Your ${l} is ${v}, ${item.direction === "low" ? "lower" : "higher"} than your usual ${u}.`;
    } else if (item.flag === "range") {
      const r = demoRange(key) as ExplainRange;
      const words = rangeWords(r, key, lang);
      base =
        lang === "mn"
          ? `Таны ${l} ${v} байна, энэ нь демо мужаас (${words}) ${item.direction === "low" ? "доогуур" : "дээгүүр"} байна.`
          : `Your ${l} is ${v}, ${item.direction === "low" ? "below" : "above"} the demo range (${words}).`;
      base = join(base, intent === "before" ? "" : usual);
    } else if (item.flag === "trend") {
      const trend = trendOf(stat);
      if (trend) {
        facts.push(trend.from, trend.to, stat.history.length + 1);
        const a = spoken(key, trend.from, lang, digitsOf(key));
        const b = spoken(key, trend.to, lang, digitsOf(key));
        const d = stat.history.length + 1;
        base =
          lang === "mn"
            ? `Сүүлийн ${d} хоногт таны ${labelOwn} ${trend.direction === "high" ? "аажмаар өсөж" : "аажмаар буурч"} байна: ойролцоогоор ${a} байснаа ${b} болсон. Өнөөдөр ${v}.`
            : `Your ${labelOwn} has been ${trend.direction === "high" ? "rising" : "falling"} over the last ${d} days, from about ${a} to ${b}. Today it is ${v}.`;
      }
    } else if (v !== "") {
      base = lang === "mn" ? `Өнөөдөр таны ${l} ${v} байна.` : `Today your ${l} is ${v}.`;
    }
    let tail = "";
    if (intent === "before" && !isDaysKey(item.key)) tail = comparison(stats, item, lang, facts);
    else if (intent === "why") tail = whyTail(key, item.direction, lang);
    else if (firstChart && !isDaysKey(item.key) && personalBand(stat) !== null) tail = BAND_TAIL[lang];
    caption[lang] = upper(join(base, tail), lang);
  }
  if (today !== null) facts.push(today);
  if (stat.baselineMean !== null) facts.push(stat.baselineMean);
  return { caption, facts };
}

function daysSentence(stats: Map<KpiKey, KpiStat>, item: Item, lang: Lang, facts: number[]): string {
  const stat = statOf(stats, item.key);
  const today = stat.value === null ? null : asNumber(stat.value);
  const days = stat.history.map((h) => ({ value: h.value }));
  const d = days.length;
  const c = daysCount(days, today);
  facts.push(d, c);
  const def = KPI_DEFS[item.key];
  if (lang === "mn") {
    const first =
      def.type === "category"
        ? `Өнөөдрийн хараа шалгалт: ${formatValue(item.key, today ?? 0, "mn").toLocaleLowerCase("mn")}.`
        : `Өнөөдөр "${def.labels.mn}" гэж тэмдэглэсэн.`;
    if (d === 0) return first;
    return join(first, c === 0 ? `Сүүлийн ${d} хоногт ийм өдөр байгаагүй.` : `Сүүлийн ${d} хоногийн ${c} өдөр нь ийм байсан.`);
  }
  const named: Partial<Record<KpiKey, string>> = {
    symptom_headache: "a headache",
    symptom_dizziness: "dizziness",
    symptom_nausea: "nausea",
  };
  const first =
    def.type === "category"
      ? `Your vision check today: ${formatValue(item.key, today ?? 0, "en").toLowerCase()}.`
      : `You reported ${named[item.key] ?? def.labels.en.toLowerCase()} today.`;
  if (d === 0) return first;
  return join(first, c === 0 ? `It did not come up on any of the last ${d} days.` : `In the last ${d} days it came up on ${c} of them.`);
}

/* ───────────── the gate every caption passes ───────────── */

const NUMERAL_RE = /\d+(?:[.,]\d+)?/g;
const FORBIDDEN_CAPTION = /prescri|medicat|dosage|treatment/iu;
const MAX_CAPTION_CHARS = 520;

function numeralsOf(text: string): string[] {
  return (text.match(NUMERAL_RE) ?? []).map((n) => n.replace(",", "."));
}

/** every form a number may take in a caption: as stored, and rounded to 0, 1 or 2 decimals */
export function allowedNumerals(numbers: readonly number[], texts: readonly string[] = []): Set<string> {
  const out = new Set<string>();
  for (const n of numbers) {
    if (!Number.isFinite(n)) continue;
    out.add(String(n));
    for (let d = 0; d <= 2; d++) out.add(formatNumber(n, d));
  }
  for (const t of texts) for (const n of numeralsOf(t)) out.add(n);
  return out;
}

/** every number a panel carries (today, the past days, bands, ranges, counts) */
function panelNumbers(panel: ExplainPanel): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(panel);
  return out;
}

/**
 * The same kind of gate as the model's text (turn.ts isSaneSummaryText, companion.ts namesConditionOrDrug): short, no
 * emoji, no prescription / treatment word, no condition or drug name (the "not a diagnosis" disclaimer aside), every
 * numeral one the data allows.
 */
export function isSaneCaption(caption: string, allowed: ReadonlySet<string>, lang: Lang): boolean {
  const t = caption.trim();
  if (t.length === 0 || t.length > MAX_CAPTION_CHARS) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (FORBIDDEN_CAPTION.test(t)) return false;
  if (namesConditionOrDrug(t.split(DISCLAIMER[lang]).join(" "))) return false;
  return numeralsOf(t).every((n) => allowed.has(n));
}

/* ───────────── the storyboard ───────────── */

export interface StoryboardInput {
  intent: ExplainIntent;
  values: Partial<Record<KpiKey, MeasurementValue>>;
  /** confirmed past days, today excluded */
  history: HistoryDay[];
  /** true after the check-in (the summary, or a question on the dashboard): the actions beat is included */
  final: boolean;
  /** the values the words name ("was my sleep like this before?") */
  topics?: KpiKey[];
  /** the blood-panel triage offer after the summary (signature.ts signatureFollowUp), both languages; empty = none */
  signature?: { text: Bilingual; reference: ReturnType<typeof referenceCrewFor> } | null;
}

const TOPIC_KEY: Partial<Record<ShowTopic, KpiKey>> = {
  heart: "heart_rate",
  bp: "bp_systolic",
  glucose: "glucose_mgdl",
  temperature: "temperature_c",
  sleep: "sleep_hours",
  mood: "mood",
  symptoms: "symptom_headache",
  water: "water_ml",
  exercise: "exercise_min",
  vision: "vision_check",
  workload: "workload",
};

/** the values the words name, in the order they appear */
export function topicKeys(text: string): KpiKey[] {
  const out: KpiKey[] = [];
  for (const t of showTopics(text)) {
    const k = TOPIC_KEY[t];
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

function present(values: Partial<Record<KpiKey, MeasurementValue>>, key: KpiKey): boolean {
  const v = values[key];
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
}

/**
 * The walkthrough for this data, or null when there is nothing to explain (no value today and no past day; for
 * "how am I today?" and "why?", no value today). Pure: no I/O, no clock, no model.
 */
export function buildStoryboard(input: StoryboardInput): Storyboard | null {
  const { intent, values, history } = input;
  const recordedKeys = ORDER.flatMap((k) => (k === "bp_systolic" ? BP_KEYS : [k])).filter((k) => present(values, k));
  const window = recentHistory(history, BASELINE_WINDOW_DAYS);
  const historyDays = window.length;
  if (recordedKeys.length === 0 && (intent !== "before" || historyDays === 0)) return null;

  const stats = new Map(buildKpiStats(values, history, {}).map((s) => [s.key, s]));
  const day = evaluateDay(values, history);
  const beats: Array<StoryBeat & { facts: number[]; texts: string[] }> = [];
  const add = (id: string, said: Said, panel: ExplainPanel, texts: string[] = []) => beats.push({ id, caption: said.caption, panel, facts: said.facts, texts });

  /* 1. checking */
  if (intent !== "before") {
    const n = recordedKeys.length;
    const opening: Bilingual =
      intent === "summary"
        ? { en: "Your check-in is saved. Let me walk you through today, one thing at a time.", mn: "Таны бүртгэл хадгалагдлаа. Өнөөдрийг нэг нэгээр нь тайлбарлая." }
        : intent === "why"
          ? { en: "Let me look at what your numbers show.", mn: "Таны үзүүлэлтүүд юу харуулж байгааг харъя." }
          : { en: "Let me walk you through today, one thing at a time.", mn: "Өнөөдрийг нэг нэгээр нь тайлбарлая." };
    const compare: Bilingual =
      historyDays > 0
        ? { en: `I'm comparing the ${n} values from today with your last ${historyDays} days.`, mn: `Өнөөдрийн ${n} үзүүлэлтийг таны сүүлийн ${historyDays} хоногтой харьцуулж байна.` }
        : { en: `I'm comparing the ${n} values from today with general ranges.`, mn: `Өнөөдрийн ${n} үзүүлэлтийг ерөнхий хэвийн хэмжээтэй харьцуулж байна.` };
    add(
      "checking",
      { caption: { en: join(opening.en, compare.en), mn: join(opening.mn, compare.mn) }, facts: [n, historyDays] },
      { kind: "checking", recorded: recordedKeys.map((k) => ({ key: k, status: statOf(stats, k).status })), historyDays },
    );
  }

  /* 2. one beat per notable value (or per value named, for "was it like this before?") */
  const notable = notableItems(stats);
  let items: Item[];
  if (intent === "before") {
    const named = (input.topics ?? [])
      .map((k) => (k === "bp_diastolic" ? "bp_systolic" : k))
      .map((k) => notable.find((i) => i.key === k) ?? steadyItem(stats, k))
      .filter((i): i is Item => i !== null);
    items = (named.length > 0 ? named : notable).slice(0, 2);
    // nothing recorded today and no value named: nothing to compare (the turn runs as usual)
    if (recordedKeys.length === 0 && items.length === 0) return null;
  } else {
    items = notable.slice(0, 3);
  }

  if (intent === "before" && historyDays === 0) {
    add(
      "note-no-history",
      {
        caption: {
          en: "I don't have earlier days to compare with yet, so today is the first point on your chart.",
          mn: "Харьцуулах өмнөх өдрүүд хараахан алга, өнөөдөр таны графикийн эхний цэг болно.",
        },
        facts: [],
      },
      { kind: "note", tone: "info" },
    );
    items = [];
  }

  let firstChart = true;
  for (const item of items) {
    const panel = panelFor(stats, item);
    const said = itemCaption(stats, item, intent, firstChart);
    if (panel.kind === "chart") firstChart = false;
    add(`item-${item.key}`, said, panel);
  }

  if (items.length === 0 && historyDays > 0) {
    if (intent === "why") {
      add(
        "note-nothing",
        {
          caption: {
            en: "Today's numbers all look like your usual, so they don't point to a clear reason. If you keep feeling this way, tell the crew medical officer.",
            mn: "Өнөөдрийн бүх үзүүлэлт таны ердийн түвшинд байгаа тул тодорхой шалтгааныг заахгүй байна. Ийм байдал үргэлжилбэл багийн эмнэлгийн офицерт хэлээрэй.",
          },
          facts: [],
        },
        { kind: "note", tone: "calm" },
      );
    } else if (intent === "before") {
      add(
        "note-usual",
        {
          caption: {
            en: `Compared with your last ${historyDays} days, today looks like your usual.`,
            mn: `Сүүлийн ${historyDays} хоногтой тань харьцуулахад өнөөдөр ердийн түвшинд байна.`,
          },
          facts: [historyDays],
        },
        { kind: "note", tone: "calm" },
      );
    }
  }

  /* the blood-panel triage offer, after the summary */
  if (input.final && input.signature && input.signature.text.en.trim() && input.signature.text.mn.trim()) {
    add("signature", { caption: input.signature.text, facts: [] }, { kind: "signature", reference: input.signature.reference }, [
      input.signature.text.en,
      input.signature.text.mn,
    ]);
  }

  /* 3. the overview grid */
  const showGrid = intent !== "before" || items.length === 0;
  if (showGrid && recordedKeys.length > 0) {
    const chips = ORDER.map((k) => {
      if (k === "bp_systolic") {
        const sys = statOf(stats, "bp_systolic");
        const dia = statOf(stats, "bp_diastolic");
        const worst = rank(dia.status) > rank(sys.status) ? dia.status : sys.status;
        return { key: k, status: worst, value: sys.value === null ? null : asNumber(sys.value), second: dia.value === null ? null : asNumber(dia.value) };
      }
      const s = statOf(stats, k);
      return { key: k, status: s.status, value: s.value === null ? null : asNumber(s.value) };
    });
    const counted = chips.filter((c) => c.status !== "no_data");
    const g = counted.filter((c) => c.status === "green").length;
    const y = counted.filter((c) => c.status === "yellow").length;
    const r = counted.filter((c) => c.status === "red").length;
    const partsEn = [g ? `${g} in range` : "", y ? `${y} to keep an eye on` : "", r ? `${r} that need attention` : ""].filter(Boolean);
    const partsMn = [g ? `${g} хэвийн` : "", y ? `${y} анхаарах` : "", r ? `${r} яаралтай анхаарах` : ""].filter(Boolean);
    const readiness = input.final && isReadinessAvailable(day.axes) ? Math.round(day.readiness) : null;
    const facts = [g, y, r, ...(readiness === null ? [] : [readiness, 100])];
    const caption: Bilingual = {
      en: join(
        `Here is everything at a glance: ${list(partsEn, "en")}.`,
        y + r === 0 ? "Nothing stands out today." : "",
        readiness === null ? "" : `Your readiness is ${readiness} out of 100.`,
      ),
      mn: join(
        `Бүх үзүүлэлт нэг дор: ${list(partsMn, "mn")}.`,
        y + r === 0 ? "Өнөөдөр онцгой зүйл алга." : "",
        readiness === null ? "" : `Бэлэн байдал 100-аас ${readiness}.`,
      ),
    };
    add("grid", { caption, facts }, { kind: "grid", overall: day.overall, chips });
  }

  /* 4. recommended actions */
  const urgent = notable.some((i) => i.flag === "danger");
  if ((input.final && intent !== "before") || urgent || (intent === "why" && recordedKeys.length > 0)) {
    const actions: Array<{ id: string; title: Bilingual }> = [];
    const push = (id: string, title: Bilingual) => {
      if (!actions.some((a) => a.id === id) && actions.length < 3) actions.push({ id, title });
    };
    if (urgent) push("remeasure", { en: "Measure again to confirm", mn: "Дахин хэмжиж баталгаажуулаарай" });
    if (urgent || day.overall === "red") push("tell_cmo", { en: "Tell the crew medical officer", mn: "Багийн эмнэлгийн офицерт мэдэгдээрэй" });
    for (const task of day.tasks) push(task.id === "contact_medical_officer" ? "tell_cmo" : task.id, task.title);
    const scenario = suggestGuides({
      kpis: [...stats.values()],
      summary: { ...day.summary, spoken: { language: "en", text: "" }, audioTurnId: null },
    })[0];
    const guideDef = scenario ? BUILTIN_GUIDES.find((s) => s.id === scenario.scenarioId) : undefined;
    const guide = guideDef ? { scenarioId: guideDef.id, title: guideDef.title } : null;
    const alert = input.final && day.overall === "red";
    // said as the panel numbers them ("One: ... Two: ..."): the titles hold commas of their own
    const ORDINAL: Record<Lang, string[]> = { en: ["One", "Two", "Three"], mn: ["Нэгдүгээрт", "Хоёрдугаарт", "Гуравдугаарт"] };
    const steps = (lang: Lang) =>
      actions.map((a, i) => `${ORDINAL[lang][i]}: ${lower(a.title[lang].replace(/[.!]$/u, ""), lang)}.`).join(" ");
    const caption: Bilingual = {
      // with no step to suggest, no "here is what I suggest" in front of nothing
      en: join(
        actions.length > 0 ? "Here is what I suggest." : "",
        steps("en"),
        alert ? ALERT_SPOKEN_NOTICE.en : "",
        guide ? `If anything gets worse, the ${guide.title.en} guide is right here.` : "",
        "If you need help, press Contact Mission Control.",
        DISCLAIMER.en,
      ),
      mn: join(
        actions.length > 0 ? "Миний санал." : "",
        steps("mn"),
        alert ? ALERT_SPOKEN_NOTICE.mn : "",
        guide ? `Бие муудвал "${guide.title.mn}" заавар энд байна.` : "",
        "Тусламж хэрэгтэй бол \"Нислэгийн удирдлагатай холбогдох\" товчийг дарна уу.",
        DISCLAIMER.mn,
      ),
    };
    add("actions", { caption, facts: [] }, { kind: "actions", actions, alert, guide }, actions.flatMap((a) => [a.title.en, a.title.mn]));
  }

  /* the gate: a caption that fails it is dropped (it never should; tests/explain.test.ts holds every template to it) */
  const kept: StoryBeat[] = [];
  for (const b of beats) {
    const allowed = allowedNumerals([...b.facts, ...panelNumbers(b.panel)], b.texts);
    if (isSaneCaption(b.caption.en, allowed, "en") && isSaneCaption(b.caption.mn, allowed, "mn")) {
      kept.push({ id: b.id, caption: b.caption, panel: b.panel });
    } else {
      console.warn(`[cosmo] explain beat ${b.id} dropped by the caption gate`);
    }
  }
  if (kept.length === 0) return null;
  return { intent, beats: kept.slice(0, MAX_EXPLAIN_BEATS) };
}

/** a value the words named that does not stand out: still shown, with the "was it like this before?" comparison */
function steadyItem(stats: Map<KpiKey, KpiStat>, key: KpiKey): Item | null {
  const s = stats.get(key);
  if (!s || (s.value === null && s.history.length === 0)) return null;
  const keys = key === "bp_systolic" ? [...BP_KEYS] : [key];
  return { key, keys, flag: "steady", direction: null, severity: 0, z: 0, status: s.status };
}

/* ───────────── on the turn ───────────── */

/** the storyboard as one stored Cosmo turn (one caption per line) and its `explain` event */
/** the newest past day with any value, and the days before it (the walkthrough's "today" and its history) */
function lastRecordedDay(history: HistoryDay[]): { day: HistoryDay; rest: HistoryDay[] } | null {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (Object.values(sorted[i].values).some((v) => v !== null && v !== undefined && v !== "")) {
      return { day: sorted[i], rest: sorted.slice(0, i) };
    }
  }
  return null;
}

/**
 * A walkthrough built from a past day's values: the first caption says which day it is, and "today" in the captions
 * becomes "that day" (no number changes, so the caption gate's facts still hold).
 */
function asOfDay(board: Storyboard, date: string): Storyboard {
  const md = date.slice(5).replace("-", "/");
  const lead: Bilingual = {
    en: `Nothing is recorded yet today, so here is your last check-in, on ${md}.`,
    mn: `Өнөөдөр хараахан хэмжилт алга тул сүүлийн үзлэгээ (${md}) харцгаая.`,
  };
  const swap = (s: string, lang: Lang) =>
    lang === "en"
      ? s.replace(/\btoday's\b/gu, "that day's").replace(/\bToday\b/gu, "That day").replace(/\btoday\b/gu, "that day")
      : s.replace(/Өнөөдрийн/gu, "Тэр өдрийн").replace(/өнөөдрийн/gu, "тэр өдрийн").replace(/Өнөөдөр/gu, "Тэр өдөр").replace(/өнөөдөр/gu, "тэр өдөр");
  return {
    intent: board.intent,
    beats: board.beats.map((b, i) => ({
      ...b,
      caption: {
        en: i === 0 ? join(lead.en, swap(b.caption.en, "en")) : swap(b.caption.en, "en"),
        mn: i === 0 ? join(lead.mn, swap(b.caption.mn, "mn")) : swap(b.caption.mn, "mn"),
      },
    })),
  };
}

async function storeWalkthrough(
  crewId: string,
  checkInId: string,
  board: Storyboard,
  lang: Lang,
  resume: string | null,
): Promise<{ event: ExplainEvent; text: string }> {
  const beats = board.beats.map((b, i) => ({ id: b.id, part: i, caption: b.caption[lang].replace(/\s+/gu, " ").trim(), panel: b.panel }));
  const resumeText = resume && resume.trim() ? resume.replace(/\s+/gu, " ").trim() : null;
  const text = explainTurnText(beats, resumeText);
  const turn = await appendTurn(crewId, checkInId, { speaker: "cosmo", text, language: lang, createdAt: now() });
  return {
    text,
    event: {
      type: "explain",
      intent: board.intent,
      turnId: turn.id,
      language: lang,
      beats,
      resume: resumeText ? { part: beats.length, text: resumeText } : null,
    },
  };
}

function signatureFor(crewId: string, localDate: string, history: HistoryDay[], values: Partial<Record<KpiKey, MeasurementValue>>) {
  const env = getEnv();
  const text = (lang: Lang) =>
    signatureFollowUp({ crewId, lang, localDate, missionStartDate: env.missionStartDate, history, todayValues: values });
  const en = text("en");
  if (!en) return null;
  return { text: { en, mn: text("mn") }, reference: referenceCrewFor(crewId) };
}

/**
 * After the daily summary: the walkthrough that replaces the dashboard intro, stored as one Cosmo turn. Null when there
 * is nothing to explain; never throws (the summary is already committed, a failure here must not lose its events).
 */
export async function explainSummaryEvent(p: {
  crewId: string;
  checkInId: string;
  localDate: string;
  lang: Lang;
  values: Partial<Record<KpiKey, MeasurementValue>>;
  history: HistoryDay[];
}): Promise<ExplainEvent | null> {
  try {
    const board = buildStoryboard({
      intent: "summary",
      values: p.values,
      history: p.history,
      final: true,
      signature: signatureFor(p.crewId, p.localDate, p.history, p.values),
    });
    if (!board) return null;
    return (await storeWalkthrough(p.crewId, p.checkInId, board, p.lang, null)).event;
  } catch (err) {
    console.error("[cosmo] explain walkthrough failed:", err);
    return null;
  }
}

/** an utterance that begins with a plain yes or no ("yes, why does my head hurt?", "үгүй, яагаад ядраад байна?") */
const LEADING_YES_NO = /^\s*(?:yes|yeah|yep|no|nope|not\s+really|тийм|үгүй|байхгүй|байгаа|за(?![\p{L}]))(?![\p{L}])/iu;

/**
 * Do the words answer the open question with a value? A clear reading (a number, a named value) or a leading yes/no
 * counts; the symptoms question's free-text reading does not ("why do I feel so tired?" would otherwise be stored as
 * "no headache, no dizziness, no nausea" plus a note, found in the browser check).
 */
function answersOpen(question: Parameters<typeof getQuestion>[0], text: string, lang: Lang): boolean {
  const records = interpretAnswer(getQuestion(question), text, lang).records.filter(
    (r) => !String(r.key).endsWith("_note") && typeof r.value !== "string",
  );
  if (records.length === 0) return false;
  return LEADING_YES_NO.test(text) || records.some((r) => r.confidence >= 0.7);
}

const PROPOSE_SHORT: Bilingual = {
  en: "Shall we log today's measurements now?",
  mn: "Одоо өнөөдрийн хэмжилтүүдээ тэмдэглэх үү?",
};

/**
 * "How am I today?", "was it like this before?", "why do I feel tired?" at any point of the check-in: the walkthrough
 * answers, and the check-in picks up where it was (the open question, or the proposal, said again after the last beat;
 * the machine context is not touched). Null when the words ask none of these, carry a value to record, hold crisis or
 * emergency words, friend mode is on, the read-back is open, or there is nothing to explain: the turn then runs as usual.
 */
export async function explainQuestionTurn(p: {
  crewId: string;
  checkInId: string;
  localDate: string;
  text: string;
  lang: Lang;
  ctx: MachineCtx;
}): Promise<TurnEvent[] | null> {
  const intent = explainIntent(p.text);
  if (!intent) return null;
  const { ctx } = p;
  if (ctx.companion || !(ctx.state === "GREETING" || ctx.state === "SMALL_TALK" || ctx.state === "KPI_CAPTURE" || ctx.state === "DONE")) {
    return null;
  }
  // "why am I tired? I slept 5 hours" answers the open question: recorded as usual
  if (/\d/u.test(p.text)) return null;
  if (detectCrisis(p.text, true)) return null;
  // "why does my chest hurt?": the emergency guidance opens from these words (CheckInExperience matches every crew
  // line); a walkthrough on top of it would cover the guide and talk over it
  if (matchEmergency(p.text, loadEmergencyLibrary().scenarios)) return null;
  // "yes, why does my head hurt?" to the headache question, "yes let's start, how am I today?" to the proposal: the
  // words answer what is open and are recorded as usual
  const open = ctx.state === "KPI_CAPTURE" ? cursorQuestion(ctx) : null;
  if (open && answersOpen(open, p.text, p.lang)) return null;
  if ((ctx.state === "SMALL_TALK" || ctx.state === "GREETING") && ctx.proposed && interpretStart(p.text, p.lang) === "yes") return null;

  const values = (await loadTodayValues(p.crewId, p.checkInId)).values;
  const history = await loadHistory(p.crewId, p.localDate);
  const final = ctx.state === "DONE";
  // "how am I today?" before anything was recorded today (start of the day, the assistant): walk through the most
  // recent check-in day instead, and say so (seen live 2026-11-15: the question fell through to small talk)
  const nothingToday = Object.values(values).every((v) => v === null || v === undefined || v === "");
  const latest = nothingToday && intent !== "before" ? lastRecordedDay(history) : null;
  const board0 = buildStoryboard({
    intent,
    values: latest ? latest.day.values : values,
    history: latest ? latest.rest : history,
    final,
    topics: topicKeys(p.text),
    signature: final && intent === "today" ? signatureFor(p.crewId, p.localDate, history, values) : null,
  });
  const board = board0 && latest ? asOfDay(board0, latest.day.date) : board0;
  if (!board) return null;

  const expected = ctx.state === "KPI_CAPTURE" ? cursorQuestion(ctx) : null;
  const resume = expected
    ? getQuestion(expected).prompts[p.lang]
    : (ctx.state === "SMALL_TALK" || ctx.state === "GREETING") && ctx.proposed
      ? PROPOSE_SHORT[p.lang]
      : null;
  const { event, text } = await storeWalkthrough(p.crewId, p.checkInId, board, p.lang, resume);
  const concerned = board.beats.some((b) => b.panel.kind === "chart" && b.panel.flag === "danger") || board.beats.some((b) => b.panel.kind === "actions" && b.panel.alert);
  return [
    { type: "state", state: ctx.state, expectedQuestion: expected, companion: false },
    { type: "assistant", turnId: event.turnId, text, language: p.lang, emotion: concerned ? "concerned" : "neutral" },
    event,
  ];
}
