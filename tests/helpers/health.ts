/**
 * Deterministic fixtures for the health-logic tests. No randomness, no clock.
 * "Bat" follows docs/DASHBOARD_PLAN.md section 6: sleep about 7.2 h, HR about 66, BP about 120/78, water about 2300 ml.
 */

import type { KpiKey, MeasurementValue } from "@/lib/types";
import type { HistoryDay } from "@/lib/health/baseline";

export type DayValues = Partial<Record<KpiKey, MeasurementValue>>;

/** ISO dates for the 14 days before 2026-11-14 (oldest first): 2026-10-31 ... 2026-11-13 */
export function historyDates(days = 14): string[] {
  const out: string[] = [];
  const end = Date.UTC(2026, 10, 13);
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** builds history days from per-key series; every series is cycled to the requested length */
export function historyFromSeries(series: Partial<Record<KpiKey, number[]>>, days = 14): HistoryDay[] {
  return historyDates(days).map((date, i) => {
    const values: DayValues = {};
    for (const [key, arr] of Object.entries(series) as Array<[KpiKey, number[]]>) {
      values[key] = arr[i % arr.length];
    }
    return { date, values };
  });
}

/** history where every day carries exactly the same values (sd = 0) */
export function constantHistory(values: DayValues, days = 14): HistoryDay[] {
  return historyDates(days).map((date) => ({ date, values: { ...values } }));
}

/** a complete, unremarkable day: all 14 non-text keys present and green */
export function normalToday(overrides: DayValues = {}): DayValues {
  return {
    sleep_hours: 7.5,
    mood: 4,
    symptom_headache: 0,
    symptom_dizziness: 0,
    symptom_nausea: 0,
    bp_systolic: 118,
    bp_diastolic: 76,
    heart_rate: 66,
    temperature_c: 36.6,
    glucose_mgdl: 95,
    water_ml: 2400,
    exercise_min: 50,
    vision_check: 0,
    workload: 2,
    ...overrides,
  };
}

/** the exact series behind Bat's usual numbers (14 days) */
export const BAT_SERIES: Partial<Record<KpiKey, number[]>> = {
  sleep_hours: [7.0, 7.4, 7.2, 6.9, 7.5, 7.3, 7.1, 7.6, 7.0, 7.2, 7.4, 6.8, 7.3, 7.2], // mean about 7.21
  mood: [4, 4, 5, 4, 3, 4, 4, 5, 4, 4, 4, 3, 4, 4],
  symptom_headache: [0],
  symptom_dizziness: [0],
  symptom_nausea: [0],
  bp_systolic: [117, 123, 120, 125, 116, 121, 122, 118, 120, 124, 118, 121, 119, 121],
  bp_diastolic: [76, 80, 78, 82, 75, 79, 81, 77, 78, 80, 76, 79, 78, 77],
  heart_rate: [64, 66, 68, 65, 67, 66, 66, 65, 67, 68, 64, 66, 66, 67],
  temperature_c: [36.5, 36.6, 36.7, 36.6, 36.5, 36.7, 36.6, 36.6, 36.5, 36.7, 36.6, 36.6, 36.7, 36.5],
  glucose_mgdl: [92, 96, 98, 94, 95, 97, 93, 96, 99, 94, 95, 96, 93, 97],
  water_ml: [2300, 2450, 2200, 2350, 2250, 2400, 2300, 2150, 2350, 2300, 2450, 2200, 2300, 2300], // mean about 2307
  exercise_min: [45, 50, 40, 45, 50, 45, 40, 50, 45, 45, 40, 50, 45, 45],
  vision_check: [0],
  workload: [3, 2, 3, 3, 2, 3, 3, 2, 3, 3, 2, 3, 3, 3],
};

export function batHistory(): HistoryDay[] {
  return historyFromSeries(BAT_SERIES, 14);
}

/** the scripted demo check-in: Bat today (docs/DASHBOARD_PLAN.md section 6) */
export function batDemoToday(): DayValues {
  return {
    sleep_hours: 5.5,
    mood: 4,
    symptom_headache: 0,
    symptom_dizziness: 0,
    symptom_nausea: 0,
    bp_systolic: 124,
    bp_diastolic: 82,
    heart_rate: 68,
    temperature_c: 36.7,
    glucose_mgdl: 98,
    water_ml: 1800,
    exercise_min: 40,
    vision_check: 0,
    workload: 3,
  };
}

/** a plain stable history for a "normal" person: a little variation around normalToday() */
export function steadyHistory(): HistoryDay[] {
  return historyFromSeries({
    sleep_hours: [7.4, 7.6, 7.5, 7.3, 7.7, 7.5, 7.4],
    mood: [4, 4, 5, 4, 4, 3, 4],
    symptom_headache: [0],
    symptom_dizziness: [0],
    symptom_nausea: [0],
    bp_systolic: [116, 120, 118, 119, 117, 121, 118],
    bp_diastolic: [75, 77, 76, 78, 74, 76, 77],
    heart_rate: [64, 67, 66, 65, 68, 66, 65],
    temperature_c: [36.5, 36.6, 36.7, 36.6, 36.6, 36.5, 36.7],
    glucose_mgdl: [93, 97, 95, 96, 94, 98, 95],
    water_ml: [2350, 2450, 2400, 2300, 2500, 2400, 2350],
    exercise_min: [50, 55, 45, 50, 55, 50, 45],
    vision_check: [0],
    workload: [2, 3, 2, 2, 3, 2, 3],
  });
}

/** every string in a value, for wording assertions */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}
