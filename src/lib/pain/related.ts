import type { Bilingual, KpiKey, Lang, MeasurementValue } from "../types";
import { KPI_DEFS, asNumber, formatValue, rangeText } from "../kpi/registry";
import { computeBaseline, recentHistory, type HistoryDay } from "../health/baseline";
import { fixedRangeStatus } from "../health/status";
import { formatNumber } from "../health/format";
import { GLUCOSE_MGDL, VITAL_SIGNS, referenceBand, type ReferenceBand } from "../health/vitalReference";
import type { TriageClass } from "../signature/types";
import { MAX_PAIN_ITEMS, type PainItem, type PainItemBand, type PainLocation } from "./types";

/**
 * Which of the person's own data may be related to where it hurts (pain.ts reasoning, deterministic). Each place has a
 * list of relevant data (head: blood pressure, sleep, water, vision, temperature, the headache symptom; chest: heart
 * rate, blood pressure, the Signature Triage panel; abdomen: water, glucose, the urine panel; ...), and only the items
 * that are actually unusual are listed:
 *
 *  - a vital past a general danger threshold, or outside the general normal range for resting adults (heart rate,
 *    blood pressure, temperature, glucose; src/data/vital_reference.json);
 *  - another value outside the app's demo range (registry thresholds, labelled as a demo parameter);
 *  - any numeric value outside the person's own usual range (mean ± 2 sd of the past days, at least 5 of them);
 *  - a symptom answered "yes" today;
 *  - the linked reference blood panel's triage class when it is not baseline, the linked urine panel's abnormal count.
 *
 * Today's value is used, else the last confirmed day that has one (the item says which day). Every number comes from
 * the data; nothing here names a condition. Pure, no I/O.
 */

export interface SignatureInput {
  cls: TriageClass;
  /** Flight Response Index as the facts give it ("64"), or null */
  fri: string | null;
  /** the reference crew member whose panel this is (C001..C004) */
  crew: string;
  /** "R+N": days after landing of the panel */
  daysSinceLanding: string;
}

export interface UrineInput {
  /** the reference crew member (C001..C004) */
  person: string;
  timepoint: string;
  abnormal: number;
  borderline: number;
}

export interface RelatedInput {
  location: PainLocation | null;
  /** today's stored values */
  today: Partial<Record<KpiKey, MeasurementValue>>;
  /** confirmed past days, oldest first, today excluded */
  history: readonly HistoryDay[];
  signature?: SignatureInput | null;
  urine?: UrineInput | null;
}

type Source = KpiKey | "bp" | "signature" | "urine";

/** the data that may matter for each place, most relevant first */
export const RELATED_SOURCES: Readonly<Record<PainLocation, readonly Source[]>> = {
  head: ["bp", "temperature_c", "sleep_hours", "water_ml", "vision_check", "symptom_headache", "symptom_dizziness", "symptom_nausea", "heart_rate"],
  eye: ["vision_check", "bp", "sleep_hours", "symptom_headache"],
  ear: ["temperature_c", "symptom_dizziness", "symptom_headache"],
  tooth: ["temperature_c", "symptom_headache"],
  throat: ["temperature_c", "water_ml", "symptom_nausea"],
  chest: ["heart_rate", "bp", "signature", "temperature_c", "symptom_dizziness", "symptom_nausea", "workload"],
  abdomen: ["water_ml", "glucose_mgdl", "urine", "temperature_c", "symptom_nausea"],
  side: ["urine", "water_ml", "temperature_c", "glucose_mgdl"],
  back: ["exercise_min", "workload", "sleep_hours", "urine", "water_ml"],
  arm: ["heart_rate", "bp", "exercise_min", "workload"],
  leg: ["exercise_min", "water_ml", "glucose_mgdl", "sleep_hours"],
  joint: ["exercise_min", "temperature_c", "signature", "workload"],
  whole_body: ["temperature_c", "heart_rate", "sleep_hours", "water_ml", "workload", "exercise_min", "signature", "symptom_nausea", "symptom_dizziness"],
};

/* ───────────── units and numbers ───────────── */

const MN_UNITS: Readonly<Record<string, string>> = { h: "цаг", min: "мин", ml: "мл", bpm: "удаа/мин" };
const EN_UNIT_WORDS: Readonly<Record<string, string>> = {
  h: "hours",
  min: "minutes",
  ml: "millilitres",
  bpm: "beats per minute",
  "°C": "degrees",
  "mg/dL": "milligrams per decilitre",
  mmHg: "",
};
const MN_UNIT_WORDS: Readonly<Record<string, string>> = { h: "цаг", min: "минут", ml: "миллилитр", bpm: "", "°C": "хэм", "mg/dL": "mg/dL", mmHg: "" };

function unit(key: KpiKey, lang: Lang): string {
  const u = KPI_DEFS[key].unit;
  if (!u) return "";
  return lang === "mn" ? (MN_UNITS[u] ?? u) : u;
}

function digits(key: KpiKey): number {
  const t = KPI_DEFS[key].type;
  return t === "integer" ? 0 : key === "temperature_c" ? 1 : 1;
}

function num(key: KpiKey, n: number): string {
  return formatNumber(n, digits(key));
}

function rangeStr(key: KpiKey, low: number | null, high: number | null, lang: Lang): string {
  const u = unit(key, lang);
  const us = u ? ` ${u}` : "";
  if (low !== null && high !== null) return `${num(key, low)}–${num(key, high)}${us}`;
  if (low !== null) return `≥ ${num(key, low)}${us}`;
  if (high !== null) return `≤ ${num(key, high)}${us}`;
  return "";
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** "sleep 4.5 hours", "пульс минутад 112 удаа" */
function spokenValue(key: KpiKey, n: number, lang: Lang): string {
  const label = KPI_DEFS[key].labels[lang];
  const def = KPI_DEFS[key];
  if (def.type === "boolean" || def.type === "category" || def.type === "scale") {
    return `${lowerFirst(label)} ${formatValue(key, n, lang)}`;
  }
  if (lang === "mn") {
    if (def.unit === "bpm") return `${lowerFirst(label)} минутад ${num(key, n)} удаа`;
    const w = def.unit ? (MN_UNIT_WORDS[def.unit] ?? def.unit) : "";
    return `${lowerFirst(label)} ${num(key, n)}${w ? ` ${w}` : ""}`;
  }
  const w = def.unit ? (EN_UNIT_WORDS[def.unit] ?? def.unit) : "";
  return `${lowerFirst(label)} ${num(key, n)}${w ? ` ${w}` : ""}`;
}

/* ───────────── one value against its ranges ───────────── */

interface Latest {
  value: number;
  /** null = today */
  date: string | null;
  /** the days before that value, for the baseline and the chart */
  before: HistoryDay[];
}

function latestValue(key: KpiKey, input: RelatedInput, todayOnly = false): Latest | null {
  const days = recentHistory([...input.history], 14);
  const today = asNumber(input.today[key]);
  if (today !== null) return { value: today, date: null, before: days };
  if (todayOnly) return null;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = asNumber(days[i].values[key]);
    if (v !== null) return { value: v, date: days[i].date, before: days.slice(0, i) };
  }
  return null;
}

function personalRange(key: KpiKey, before: readonly HistoryDay[]): { low: number; high: number; mean: number } | null {
  const b = computeBaseline([...before], key);
  if (b.mean === null || b.sd === null) return null;
  const sd = Math.max(b.sd, KPI_DEFS[key].sdFloor ?? 0);
  if (!(sd > 0)) return null;
  return { low: b.mean - 2 * sd, high: b.mean + 2 * sd, mean: b.mean };
}

function historySeries(key: KpiKey, before: readonly HistoryDay[]): number[] {
  return before.map((d) => asNumber(d.values[key])).filter((n): n is number => n !== null).slice(-14);
}

/** the general normal range of the reference workbook, for the keys that have one */
function generalRange(key: KpiKey): { low: number | null; high: number | null } | null {
  switch (key) {
    case "heart_rate":
      return { low: VITAL_SIGNS.heart_rate.normalLow, high: VITAL_SIGNS.heart_rate.normalHigh };
    case "temperature_c":
      return { low: VITAL_SIGNS.temperature.normalLow, high: VITAL_SIGNS.temperature.normalHigh };
    case "glucose_mgdl":
      return { low: GLUCOSE_MGDL.normalLow, high: GLUCOSE_MGDL.normalHigh };
    case "bp_systolic":
      return { low: null, high: VITAL_SIGNS.bp_systolic.normalHigh };
    case "bp_diastolic":
      return { low: null, high: VITAL_SIGNS.bp_diastolic.normalHigh };
    default:
      return null;
  }
}

function generalBand(key: KpiKey, n: number): ReferenceBand | null {
  switch (key) {
    case "heart_rate":
      return referenceBand("heart_rate", n);
    case "temperature_c":
      return referenceBand("temperature", n);
    case "glucose_mgdl":
      return referenceBand("glucose", n);
    default:
      return null;
  }
}

/** the demo range bounds of the registry (for the chart), null when the key has none */
function demoRange(key: KpiKey): { low: number | null; high: number | null } | null {
  const th = KPI_DEFS[key].thresholds;
  if (!th) return null;
  return { low: th.low?.yellow ?? null, high: th.high?.yellow ?? null };
}

const DATE_NOTE = (date: string | null): Bilingual =>
  date === null ? { en: "", mn: "" } : { en: ` From your last check-in (${date}).`, mn: ` Сүүлийн бүртгэлээс (${date}).` };

function joinNote(a: Bilingual, b: Bilingual): Bilingual {
  return { en: `${a.en}${b.en}`.trim(), mn: `${a.mn}${b.mn}`.trim() };
}

function personalNote(key: KpiKey, p: { low: number; high: number }, high: boolean): Bilingual {
  return {
    en: `${high ? "Above" : "Below"} your usual range of ${rangeStr(key, p.low, p.high, "en")}.`,
    mn: `Таны ердийн хэмжээнээс (${rangeStr(key, p.low, p.high, "mn")}) ${high ? "дээш" : "доош"}.`,
  };
}

/** one numeric indicator: an item when it is unusual, else null */
function vitalItem(key: KpiKey, input: RelatedInput): PainItem | null {
  const def = KPI_DEFS[key];
  if (def.type === "text" || def.type === "boolean") return null;
  const latest = latestValue(key, input);
  if (!latest) return null;
  const n = latest.value;
  const personal = def.type === "category" ? null : personalRange(key, latest.before);
  const personalOut = personal !== null && (n > personal.high || n < personal.low);
  const general = generalRange(key);
  const gBand = generalBand(key, n);
  let band: PainItemBand | null = null;
  let high = false;
  let note: Bilingual = { en: "", mn: "" };
  if (gBand === "danger" || gBand === "outside") {
    band = gBand === "danger" ? "danger" : "outside_general";
    high = general?.high !== null && general?.high !== undefined ? n > general.high : n > (personal?.high ?? n);
    const r = general ? rangeStr(key, general.low, general.high, "en") : "";
    const rm = general ? rangeStr(key, general.low, general.high, "mn") : "";
    note =
      band === "danger"
        ? {
            en: `Past the urgent level for resting adults (normal ${r}).`,
            mn: `Насанд хүрэгчийн яаралтай түвшнээс ${high ? "дээш" : "доош"} (хэвийн ${rm}).`,
          }
        : {
            en: `${high ? "Above" : "Below"} the general normal range of ${r}.`,
            mn: `Ерөнхий хэвийн хэмжээнээс (${rm}) ${high ? "дээш" : "доош"}.`,
          };
  } else if (!general && fixedRangeStatus(def, n) !== "green") {
    band = "outside_demo";
    const th = def.thresholds;
    high = th?.high !== undefined && n > th.high.yellow;
    const rt = rangeText(key);
    // a category ("slightly blurred") is outside the range, never "above" it
    note =
      def.type === "category"
        ? { en: `Outside the app's range${rt ? ` (${rt.en})` : ""}.`, mn: `Аппын хэмжээнээс гадуур${rt ? ` (${rt.mn})` : ""}.` }
        : {
            en: `${high ? "Above" : "Below"} the app's range${rt ? ` (${rt.en})` : ""}.`,
            mn: `Аппын хэмжээнээс ${high ? "дээш" : "доош"}${rt ? ` (${rt.mn})` : ""}.`,
          };
  } else if (personalOut && personal) {
    band = "outside_personal";
    high = n > personal.high;
    note = personalNote(key, personal, high);
  }
  if (!band) return null;
  if (band !== "outside_personal" && personalOut && personal) {
    note = joinNote(note, {
      en: " Also outside your usual range.",
      mn: " Таны ердийн хэмжээнээс ч гадуур.",
    });
  }
  note = joinNote(note, DATE_NOTE(latest.date));
  // a category's codes are no amount: no "higher than usual", no "Normal ≤ 0" range, no HIGH / LOW tag
  const category = def.type === "category";
  return {
    id: `vital-${key}`,
    kind: "vital",
    key,
    label: def.labels,
    valueText: { en: formatValue(key, n, "en"), mn: formatValue(key, n, "mn") },
    spoken: { en: spokenValue(key, n, "en"), mn: spokenValue(key, n, "mn") },
    value: n,
    direction: category ? null : high ? "high" : "low",
    band,
    date: latest.date,
    personal: personal ? { low: personal.low, high: personal.high } : null,
    normal: category ? null : (general ?? demoRange(key)),
    history: historySeries(key, latest.before),
    note,
  };
}

/** blood pressure: one item for both numbers, when either is unusual */
function bpItem(input: RelatedInput): PainItem | null {
  const sysL = latestValue("bp_systolic", input);
  const diaL = latestValue("bp_diastolic", input);
  if (!sysL || !diaL || sysL.date !== diaL.date) return null;
  const sys = sysL.value;
  const dia = diaL.value;
  const ref = referenceBand("blood_pressure", sys, dia);
  const ps = personalRange("bp_systolic", sysL.before);
  const pd = personalRange("bp_diastolic", diaL.before);
  const sysOut = ps !== null && (sys > ps.high || sys < ps.low);
  const diaOut = pd !== null && (dia > pd.high || dia < pd.low);
  const low = sys < (VITAL_SIGNS.bp_systolic.dangerBelow ?? 0);
  let band: PainItemBand | null = null;
  let high = true;
  let note: Bilingual = { en: "", mn: "" };
  const s = VITAL_SIGNS.bp_systolic;
  const d = VITAL_SIGNS.bp_diastolic;
  if (ref === "danger") {
    band = "danger";
    high = !low;
    note = low
      ? {
          en: `The upper number is below the urgent level of ${formatNumber(s.dangerBelow ?? 0, 0)} for resting adults.`,
          mn: `Дээд даралт насанд хүрэгчийн яаралтай түвшнээс (${formatNumber(s.dangerBelow ?? 0, 0)}) доош.`,
        }
      : {
          en: `At or past the urgent level of ${formatNumber(s.dangerAbove ?? 0, 0)}/${formatNumber(d.dangerAbove ?? 0, 0)} for resting adults.`,
          mn: `Насанд хүрэгчийн яаралтай түвшинд (${formatNumber(s.dangerAbove ?? 0, 0)}/${formatNumber(d.dangerAbove ?? 0, 0)}) хүрсэн.`,
        };
  } else if (ref === "outside") {
    band = "outside_general";
    note = {
      en: `Above the general normal range (below ${formatNumber(s.normalHigh ?? 0, 0)}/${formatNumber(d.normalHigh ?? 0, 0)}).`,
      mn: `Ерөнхий хэвийн хэмжээнээс (${formatNumber(s.normalHigh ?? 0, 0)}/${formatNumber(d.normalHigh ?? 0, 0)}-аас доош) дээш.`,
    };
  } else if (sysOut || diaOut) {
    band = "outside_personal";
    const p = sysOut ? ps! : pd!;
    const key: KpiKey = sysOut ? "bp_systolic" : "bp_diastolic";
    high = sysOut ? sys > ps!.high : dia > pd!.high;
    const which = sysOut ? { en: "upper", mn: "дээд" } : { en: "lower", mn: "доод" };
    note = {
      en: `The ${which.en} number is ${high ? "above" : "below"} your usual range of ${rangeStr(key, p.low, p.high, "en")} mmHg.`,
      mn: `${which.mn === "дээд" ? "Дээд" : "Доод"} даралт таны ердийн хэмжээнээс (${rangeStr(key, p.low, p.high, "mn")} mmHg) ${high ? "дээш" : "доош"}.`,
    };
  }
  if (!band) return null;
  if (band !== "outside_personal" && (sysOut || diaOut)) {
    note = joinNote(note, { en: " Also outside your usual range.", mn: " Таны ердийн хэмжээнээс ч гадуур." });
  }
  note = joinNote(note, DATE_NOTE(sysL.date));
  const shown = `${formatNumber(sys, 0)}/${formatNumber(dia, 0)}`;
  return {
    id: "bp",
    kind: "vital",
    key: "bp_systolic",
    label: { en: "Blood pressure", mn: "Цусны даралт" },
    valueText: { en: `${shown} mmHg`, mn: `${shown} mmHg` },
    spoken: {
      en: `blood pressure ${formatNumber(sys, 0)} over ${formatNumber(dia, 0)}`,
      mn: `цусны даралт ${formatNumber(sys, 0)} дээр ${formatNumber(dia, 0)}`,
    },
    value: sys,
    direction: high ? "high" : "low",
    band,
    date: sysL.date,
    personal: ps ? { low: ps.low, high: ps.high } : null,
    normal: { low: null, high: s.normalHigh },
    history: historySeries("bp_systolic", sysL.before),
    note,
  };
}

/** a yes/no symptom answered "yes" today */
function symptomItem(key: KpiKey, input: RelatedInput): PainItem | null {
  if (KPI_DEFS[key].type !== "boolean") return null;
  const latest = latestValue(key, input, true);
  if (!latest || latest.value !== 1) return null;
  const label = KPI_DEFS[key].labels;
  return {
    id: `symptom-${key}`,
    kind: "symptom",
    key,
    label,
    valueText: { en: formatValue(key, 1, "en"), mn: formatValue(key, 1, "mn") },
    spoken: { en: `${lowerFirst(label.en)} reported today`, mn: `өнөөдөр ${lowerFirst(label.mn)} тэмдэглэсэн` },
    value: null,
    direction: null,
    band: "reported",
    date: null,
    personal: null,
    normal: null,
    history: [],
    note: { en: "Reported in today's check-in.", mn: "Өнөөдрийн бүртгэлд тэмдэглэсэн." },
  };
}

const CLASS_LABEL: Readonly<Partial<Record<TriageClass, Bilingual>>> = {
  UNEXPECTED_ACTIVATION: { en: "Unexpected activation", mn: "Хүлээгдээгүй идэвхжил" },
  EXPECTED_FLIGHT_RESPONSE: { en: "Expected flight response", mn: "Нислэгийн хүлээгдэж буй хариу" },
};

function signatureItem(sig: SignatureInput | null | undefined): PainItem | null {
  if (!sig) return null;
  const cls = CLASS_LABEL[sig.cls];
  if (!cls) return null;
  const fri = sig.fri === null ? null : Number(sig.fri);
  const friText = sig.fri === null ? "" : ` · FRI ${sig.fri}`;
  return {
    id: "signature",
    kind: "signature",
    key: null,
    label: { en: "Blood panel (Signature Triage)", mn: "Цусны шинжилгээ (Signature Triage)" },
    valueText: { en: `${cls.en}${friText}`, mn: `${cls.mn}${friText}` },
    spoken: {
      en: `the linked blood panel, classed ${lowerFirst(cls.en)}`,
      mn: `холбогдсон цусны шинжилгээ: ${lowerFirst(cls.mn)}`,
    },
    value: fri !== null && Number.isFinite(fri) ? fri : null,
    direction: "high",
    band: "flagged",
    date: null,
    personal: null,
    normal: null,
    history: [],
    note: {
      en: `Reference panel ${sig.crew}, R+${sig.daysSinceLanding} (Inspiration4 data, not your own blood).`,
      mn: `${sig.crew} лавлах шинжилгээ, R+${sig.daysSinceLanding} (Inspiration4 өгөгдөл, таны өөрийн цус биш).`,
    },
  };
}

function urineItem(urine: UrineInput | null | undefined): PainItem | null {
  if (!urine || urine.abnormal <= 0) return null;
  return {
    id: "labs-urine",
    kind: "labs",
    key: null,
    label: { en: "Urine panel", mn: "Шээсний шинжилгээ" },
    valueText: {
      en: `${urine.abnormal} abnormal · ${urine.borderline} borderline`,
      mn: `${urine.abnormal} хэвийн бус · ${urine.borderline} хил хязгаарт`,
    },
    spoken: {
      en: `the linked urine panel, with ${urine.abnormal} ${urine.abnormal === 1 ? "value" : "values"} outside the personal range`,
      mn: `холбогдсон шээсний шинжилгээ, ${urine.abnormal} үзүүлэлт хувийн хэмжээнээс гадуур`,
    },
    value: urine.abnormal,
    direction: "high",
    band: "flagged",
    date: null,
    personal: null,
    normal: null,
    history: [],
    note: {
      en: `Reference panel ${urine.person}, ${urine.timepoint} (Inspiration4 data, not your own sample).`,
      mn: `${urine.person} лавлах шинжилгээ, ${urine.timepoint} (Inspiration4 өгөгдөл, таны өөрийн дээж биш).`,
    },
  };
}

const BAND_RANK: Readonly<Record<PainItemBand, number>> = {
  danger: 0,
  outside_general: 1,
  outside_demo: 2,
  outside_personal: 3,
  reported: 4,
  flagged: 5,
};

/** the unusual data items for this place, the most unusual first, at most MAX_PAIN_ITEMS; [] for an unknown place */
export function relatedItems(input: RelatedInput): PainItem[] {
  if (!input.location) return [];
  const out: PainItem[] = [];
  for (const source of RELATED_SOURCES[input.location]) {
    const item =
      source === "bp"
        ? bpItem(input)
        : source === "signature"
          ? signatureItem(input.signature)
          : source === "urine"
            ? urineItem(input.urine)
            : KPI_DEFS[source].type === "boolean"
              ? symptomItem(source, input)
              : vitalItem(source, input);
    if (item && !out.some((o) => o.id === item.id)) out.push(item);
  }
  // stable: the place's own order breaks ties
  return out
    .map((item, i) => ({ item, i }))
    .sort((a, b) => BAND_RANK[a.item.band] - BAND_RANK[b.item.band] || a.i - b.i)
    .map((x) => x.item)
    .slice(0, MAX_PAIN_ITEMS);
}
