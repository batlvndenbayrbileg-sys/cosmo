/**
 * The simulated sensor feed for one crew member's day (docs/research/checkin-nasa.md).
 *
 * On the station these values come from devices, not from questions: the Bio-Monitor shirt and headband (heart rate,
 * blood pressure, skin temperature, breathing, SpO2, activity), a wrist actigraph (sleep timing and duration), the
 * exercise devices (minutes of exercise), the drink dispenser log (water) and, on recent commercial missions, a
 * continuous glucose patch. AEGIS has no hardware, so this module SIMULATES that feed: deterministic (the same crew
 * member and date always give the same readings) and plausible (centred on the person's own recent records, with a
 * small day-to-day wobble). Every value it produces is labelled "simulated" wherever it is shown.
 *
 * Pure TypeScript: no I/O, no clock, no randomness beyond the seeded generator.
 */

import type { Bilingual, KpiKey } from "../types";
import { KPI_DEFS, SENSOR_KEYS } from "../kpi/registry";
import { computeBaseline, recentHistory, type HistoryDay } from "../health/baseline";
import { evaluateIndicator } from "../health/status";

export type SensorDevice = "actigraph" | "biomonitor" | "cgm" | "dispenser" | "exercise";

export interface SensorReading {
  key: KpiKey;
  value: number;
  device: SensorDevice;
}

/** which device a sensor key comes from */
export const SENSOR_DEVICE: Readonly<Partial<Record<KpiKey, SensorDevice>>> = {
  sleep_hours: "actigraph",
  heart_rate: "biomonitor",
  bp_systolic: "biomonitor",
  bp_diastolic: "biomonitor",
  temperature_c: "biomonitor",
  glucose_mgdl: "cgm",
  water_ml: "dispenser",
  exercise_min: "exercise",
};

export const DEVICE_LABELS: Readonly<Record<SensorDevice, Bilingual>> = {
  actigraph: { en: "sleep watch (actigraphy)", mn: "нойрны бугуйн цаг (актиграф)" },
  biomonitor: { en: "Bio-Monitor shirt", mn: "Bio-Monitor цамц" },
  cgm: { en: "glucose patch", mn: "сахарын наалт мэдрэгч" },
  dispenser: { en: "drink dispenser log", mn: "ус түгээгчийн бүртгэл" },
  exercise: { en: "exercise device log", mn: "дасгалын төхөөрөмжийн бүртгэл" },
};

/** a typical crew member's day when there is no personal history yet (demo values, not clinical targets) */
const TYPICAL: Readonly<Partial<Record<KpiKey, { mean: number; sd: number }>>> = {
  sleep_hours: { mean: 7, sd: 0.5 },
  heart_rate: { mean: 64, sd: 4 },
  bp_systolic: { mean: 118, sd: 5 },
  bp_diastolic: { mean: 76, sd: 4 },
  temperature_c: { mean: 36.6, sd: 0.15 },
  glucose_mgdl: { mean: 95, sd: 7 },
  water_ml: { mean: 2300, sd: 200 },
  exercise_min: { mean: 90, sd: 15 },
};

/** body readings worth a follow-up question when unusual; sleep, water and exercise are only mentioned */
export const FOLLOW_UP_KEYS: ReadonlySet<KpiKey> = new Set<KpiKey>([
  "heart_rate",
  "bp_systolic",
  "bp_diastolic",
  "temperature_c",
  "glucose_mgdl",
]);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a standard-normal draw, clipped to +-1.2 so the simulated wobble never invents an outlier */
function wobble(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-1.2, Math.min(1.2, z));
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function roundFor(key: KpiKey, v: number): number {
  const def = KPI_DEFS[key];
  if (def.type === "number") return Math.round(v * 10) / 10;
  if (key === "water_ml") return Math.round(v / 50) * 50;
  return Math.round(v);
}

/**
 * The seed of the offline scripted demo (DEMO_MODE=scripted): the same readings whatever the date, so the replayed
 * demo conversation always meets the same questions. Live check-ins seed the feed with their own date.
 */
export const DEMO_SENSOR_DAY = "demo-day";

/**
 * The scripted demo's story on DEMO_SENSOR_DAY: Bat's resting heart rate is up after a treadmill run, so the demo
 * shows Cosmo reading an unusual sensor value back and asking about it. Added on top of the simulated reading.
 */
const DEMO_STORY: Readonly<Record<string, Partial<Record<KpiKey, number>>>> = {
  bat: { heart_rate: 14 },
};

/**
 * The day's readings for every sensor key. Each value sits between the person's 14-day mean and the mean of their
 * last three days (so a recent trend carries into today), plus a small seeded wobble of at most about 0.7 sd, clamped
 * to the registry's hard range. Without enough history the typical crew values are used. `seedKey` is the check-in's
 * date (or DEMO_SENSOR_DAY for the scripted demo).
 */
export function simulateSensorDay(crewId: string, seedKey: string, history: HistoryDay[]): SensorReading[] {
  const localDate = seedKey;
  const story = seedKey === DEMO_SENSOR_DAY ? (DEMO_STORY[crewId] ?? {}) : {};
  const recent = recentHistory(history);
  const last3 = recent.slice(-3);
  const out: SensorReading[] = [];
  for (const key of SENSOR_KEYS) {
    const typical = TYPICAL[key];
    const device = SENSOR_DEVICE[key];
    if (!typical || !device) continue;
    const baseline = computeBaseline(recent, key);
    const lastMean = mean(last3.map((d) => d.values[key]).filter((v): v is number => typeof v === "number"));
    const centre =
      baseline.mean !== null ? (lastMean !== null ? (baseline.mean + lastMean) / 2 : baseline.mean) : typical.mean;
    const sd = Math.max(baseline.sd ?? typical.sd, KPI_DEFS[key].sdFloor ?? 0);
    const rng = mulberry32(hash(`${crewId}|${localDate}|${key}`));
    let v = centre + wobble(rng) * 0.6 * sd + (story[key] ?? 0);
    const def = KPI_DEFS[key];
    if (def.min !== undefined) v = Math.max(def.min, v);
    if (def.max !== undefined) v = Math.min(def.max, v);
    out.push({ key, value: roundFor(key, v), device });
  }
  // a diastolic value never reaches the systolic one
  const sys = out.find((r) => r.key === "bp_systolic");
  const dia = out.find((r) => r.key === "bp_diastolic");
  if (sys && dia && dia.value >= sys.value - 20) dia.value = Math.max(KPI_DEFS.bp_diastolic.min ?? 40, sys.value - 30);
  return out;
}

export interface UnusualReading {
  key: KpiKey;
  value: number;
  usual: number | null;
  direction: "high" | "low";
}

/** the order unusual readings are told in: body readings first, then sleep, then the lifestyle logs */
const TELL_ORDER: readonly KpiKey[] = [
  "heart_rate",
  "bp_systolic",
  "bp_diastolic",
  "temperature_c",
  "glucose_mgdl",
  "sleep_hours",
  "water_ml",
  "exercise_min",
];

/**
 * The readings that are outside the demo range or the person's own usual band (the same status rules as the
 * dashboard: src/lib/health/status.ts), body readings first. Systolic and diastolic count once.
 */
export function unusualReadings(readings: ReadonlyArray<{ key: KpiKey; value: number }>, history: HistoryDay[]): UnusualReading[] {
  const out: UnusualReading[] = [];
  for (const key of TELL_ORDER) {
    const r = readings.find((x) => x.key === key);
    if (!r) continue;
    if (key === "bp_diastolic" && out.some((u) => u.key === "bp_systolic")) continue;
    const baseline = computeBaseline(history, key);
    const ev = evaluateIndicator(key, r.value, baseline);
    if (ev.status !== "yellow" && ev.status !== "red") continue;
    const th = KPI_DEFS[key].thresholds;
    let direction: "high" | "low";
    if (th?.high && r.value > th.high.yellow) direction = "high";
    else if (th?.low && r.value < th.low.yellow) direction = "low";
    else direction = (ev.delta ?? 0) >= 0 ? "high" : "low";
    out.push({ key, value: r.value, usual: baseline.mean, direction });
  }
  return out;
}
