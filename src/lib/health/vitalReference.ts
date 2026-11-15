/**
 * General resting-adult vital-sign reference (team request 2026-11-15: "it should know the general normal ranges, not
 * only compare with the person's own past, and answer when asked").
 *
 * Source: data/reference/vital_signs_reference.xlsx -> src/data/vital_reference.json (scripts/
 * vital_reference_xlsx_to_json.py). The workbook's caveats hold for every sentence here: resting adults only; the
 * danger threshold means "get urgent help", especially with symptoms; symptoms count more than the number; several
 * cutoffs are rules of thumb; general reference, not a diagnosis.
 *
 * This is separate from the registry's thresholds (src/lib/kpi/registry.ts): those drive the dashboard's demo-parameter
 * status colours; these are what Cosmo says when asked "what is a normal heart rate?". Pure, no I/O.
 */
import type { Lang } from "@/lib/types";
import { formatNumber } from "@/lib/health/format";
import data from "@/data/vital_reference.json";

export type VitalSignId = "heart_rate" | "bp_systolic" | "bp_diastolic" | "breathing_rate" | "spo2" | "temperature" | "glucose";

export interface VitalSignRow {
  id: VitalSignId;
  name: string;
  unit: string;
  normalText: string;
  dangerText: string;
  normalLow: number | null;
  normalHigh: number | null;
  dangerBelow: number | null;
  dangerAbove: number | null;
  note: string | null;
}

const ROWS = data.signs as VitalSignRow[];

function row(id: VitalSignId): VitalSignRow {
  const r = ROWS.find((s) => s.id === id);
  if (!r) throw new Error(`vital_reference.json has no row ${id}`);
  return r;
}

export const VITAL_SIGNS: Readonly<Record<VitalSignId, VitalSignRow>> = {
  heart_rate: row("heart_rate"),
  bp_systolic: row("bp_systolic"),
  bp_diastolic: row("bp_diastolic"),
  breathing_rate: row("breathing_rate"),
  spo2: row("spo2"),
  temperature: row("temperature"),
  glucose: row("glucose"),
};

/** the caveats of the workbook's Notes sheet, in its order */
export const REFERENCE_NOTES: readonly string[] = data.notes;

/**
 * The workbook gives glucose in mmol/L and names the mg/dL and °F equivalents in its notes column; the registry stores
 * mg/dL and °C. These are those note values (tests/vital-reference.test.ts checks them against the note text).
 */
export const GLUCOSE_MGDL = { normalLow: 70, normalHigh: 99, dangerBelow: 54, dangerAbove: 300 } as const;
export const TEMPERATURE_F = { normalLow: 97, normalHigh: 99, dangerBelow: 95, dangerAbove: 103 } as const;
/** SpO2 below this is already concerning (the danger text: "below 92 is already concerning") */
export const SPO2_CONCERNING_BELOW = 92;

/** what a question about the general reference can be about: the check-in's vitals plus breathing and oxygen */
export type ReferenceTopic = "heart_rate" | "blood_pressure" | "breathing_rate" | "spo2" | "temperature" | "glucose";

const f = (n: number | null): string => (n === null ? "" : formatNumber(n, 1));

/** "For a resting adult, a heart rate of 60-100 beats per minute is generally normal; ..." */
export function referenceSentence(topic: ReferenceTopic, lang: Lang): string {
  switch (topic) {
    case "heart_rate": {
      const r = VITAL_SIGNS.heart_rate;
      return lang === "mn"
        ? `Тайван байгаа насанд хүрэгчийн зүрхний цохилт ерөнхийдөө минутад ${f(r.normalLow)}-${f(r.normalHigh)} бол хэвийн; ${f(r.dangerBelow)}-өөс доош эсвэл ${f(r.dangerAbove)}-аас дээш бол яаралтай тусламж хэрэгтэй. Тамирчдын хувьд 40-өөд ч асуудалгүй байж болно.`
        : `For a resting adult, a heart rate of ${f(r.normalLow)}-${f(r.normalHigh)} beats per minute is generally normal; below ${f(r.dangerBelow)} or above ${f(r.dangerAbove)} needs urgent help. Athletes can rest in the 40s without a problem.`;
    }
    case "blood_pressure": {
      const s = VITAL_SIGNS.bp_systolic;
      const d = VITAL_SIGNS.bp_diastolic;
      return lang === "mn"
        ? `Ерөнхийдөө цусны даралт ${f(s.normalHigh)} дээр ${f(d.normalHigh)}-аас доош бол хэвийн; ${f(s.dangerAbove)} дээр ${f(d.dangerAbove)} буюу түүнээс дээш, эсвэл дээд даралт ${f(s.dangerBelow)}-ээс доош бол яаралтай тусламж хэрэгтэй.`
        : `In general, blood pressure below ${f(s.normalHigh)} over ${f(d.normalHigh)} is normal; ${f(s.dangerAbove)} over ${f(d.dangerAbove)} or higher, or an upper number below ${f(s.dangerBelow)}, needs urgent help.`;
    }
    case "breathing_rate": {
      const r = VITAL_SIGNS.breathing_rate;
      return lang === "mn"
        ? `Тайван үед насанд хүрэгч минутад ${f(r.normalLow)}-${f(r.normalHigh)} удаа амьсгалдаг; ${f(r.dangerBelow)}-аас доош эсвэл ${f(r.dangerAbove)}-аас дээш бол яаралтай тусламж хэрэгтэй.`
        : `A resting adult usually breathes ${f(r.normalLow)}-${f(r.normalHigh)} times a minute; below ${f(r.dangerBelow)} or above ${f(r.dangerAbove)} needs urgent help.`;
    }
    case "spo2": {
      const r = VITAL_SIGNS.spo2;
      return lang === "mn"
        ? `Цусны хүчилтөрөгчийн хангамж (SpO2) ихэвчлэн ${f(r.normalLow)}-${f(r.normalHigh)}% байдаг; ${SPO2_CONCERNING_BELOW}-оос доош бол анхаарал татна, ${f(r.dangerBelow)}-ээс доош бол яаралтай тусламж хэрэгтэй.`
        : `Blood oxygen (SpO2) is normally ${f(r.normalLow)}-${f(r.normalHigh)}%; below ${SPO2_CONCERNING_BELOW} is already concerning and below ${f(r.dangerBelow)} needs urgent help.`;
    }
    case "temperature": {
      const r = VITAL_SIGNS.temperature;
      return lang === "mn"
        ? `Биеийн хэвийн температур ойролцоогоор ${f(r.normalLow)}-${f(r.normalHigh)} хэм; ${f(r.dangerAbove)}-аас дээш эсвэл ${f(r.dangerBelow)}-аас доош бол яаралтай тусламж хэрэгтэй.`
        : `Normal body temperature is about ${f(r.normalLow)}-${f(r.normalHigh)} degrees Celsius (${TEMPERATURE_F.normalLow}-${TEMPERATURE_F.normalHigh} °F); above ${f(r.dangerAbove)} or below ${f(r.dangerBelow)} needs urgent help.`;
    }
    case "glucose": {
      const r = VITAL_SIGNS.glucose;
      const g = GLUCOSE_MGDL;
      return lang === "mn"
        ? `Өлөн үеийн цусны сахар ихэвчлэн ${g.normalLow}-${g.normalHigh} mg/dL (${f(r.normalLow)}-${f(r.normalHigh)} ммоль/л) байдаг; ${g.dangerBelow}-өөс доош эсвэл ${g.dangerAbove}-аас дээш бол яаралтай тусламж хэрэгтэй.`
        : `Fasting blood sugar is normally ${g.normalLow}-${g.normalHigh} mg/dL (${f(r.normalLow)}-${f(r.normalHigh)} mmol/L); below ${g.dangerBelow} or above ${g.dangerAbove} mg/dL needs urgent help.`;
    }
  }
}

/** the closing caveat of every general-reference answer (the workbook's "general reference, not a diagnosis") */
export const REFERENCE_CAVEAT: Readonly<Record<Lang, string>> = {
  en: "This is a general reference for resting adults, not a diagnosis; how you feel matters more than one number.",
  mn: "Энэ бол тайван байгаа насанд хүрэгчийн ерөнхий лавлагаа, онош биш; ганц тооноос илүү таны бие хэр байгаа нь чухал.",
};

export type ReferenceBand = "normal" | "outside" | "danger";

/**
 * Where a value sits against the general reference: normal, outside the normal range, or past a danger threshold.
 * Units are the registry's: bpm, mmHg, breaths/min, %, °C, mg/dL. Blood pressure takes the upper and the lower number.
 */
export function referenceBand(topic: ReferenceTopic, value: number, lower?: number): ReferenceBand {
  const band = (r: { normalLow: number | null; normalHigh: number | null; dangerBelow: number | null; dangerAbove: number | null }, n: number, highInclusive = false): ReferenceBand => {
    if (r.dangerBelow !== null && n < r.dangerBelow) return "danger";
    if (r.dangerAbove !== null && (highInclusive ? n >= r.dangerAbove : n > r.dangerAbove)) return "danger";
    if (r.normalLow !== null && n < r.normalLow) return "outside";
    if (r.normalHigh !== null && n > r.normalHigh) return "outside";
    return "normal";
  };
  switch (topic) {
    case "blood_pressure": {
      const s = VITAL_SIGNS.bp_systolic;
      const d = VITAL_SIGNS.bp_diastolic;
      // "below 120" / "below 80" is normal, so 120 itself is already outside; 180 / 120 "or higher" is danger
      const sys: ReferenceBand =
        (s.dangerAbove !== null && value >= s.dangerAbove) || (s.dangerBelow !== null && value < s.dangerBelow)
          ? "danger"
          : s.normalHigh !== null && value >= s.normalHigh
            ? "outside"
            : "normal";
      if (lower === undefined) return sys;
      const dia: ReferenceBand =
        d.dangerAbove !== null && lower >= d.dangerAbove ? "danger" : d.normalHigh !== null && lower >= d.normalHigh ? "outside" : "normal";
      return sys === "danger" || dia === "danger" ? "danger" : sys === "outside" || dia === "outside" ? "outside" : "normal";
    }
    case "glucose":
      return band(GLUCOSE_MGDL, value);
    case "spo2":
      return band(VITAL_SIGNS.spo2, value);
    default:
      return band(VITAL_SIGNS[topic], value);
  }
}
