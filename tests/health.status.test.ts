import { describe, expect, it } from "vitest";
import type { KpiKey, Status } from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { evaluateIndicator, evaluateIndicators, fixedRangeStatus, worstStatus } from "@/lib/health/status";

/**
 * Threshold boundaries for EVERY key that has thresholds.
 * Semantics: exactly at a yellow bound is green, just past it is yellow, past the red bound is red
 * (lifestyle keys with maxLevel "yellow" are clamped to yellow).
 */
const BOUNDARY_CASES: Array<[KpiKey, number, Status]> = [
  // sleep_hours: low {7, 5}
  ["sleep_hours", 8, "green"],
  ["sleep_hours", 7, "green"],
  ["sleep_hours", 6.9, "yellow"],
  ["sleep_hours", 5, "yellow"],
  ["sleep_hours", 4.9, "red"],
  ["sleep_hours", 0, "red"],
  // mood: low {3, 2}
  ["mood", 5, "green"],
  ["mood", 3, "green"],
  ["mood", 2, "yellow"],
  ["mood", 1, "red"],
  // symptoms: 0 green, 1 yellow, never red
  ["symptom_headache", 0, "green"],
  ["symptom_headache", 1, "yellow"],
  ["symptom_dizziness", 0, "green"],
  ["symptom_dizziness", 1, "yellow"],
  ["symptom_nausea", 0, "green"],
  ["symptom_nausea", 1, "yellow"],
  // bp_systolic: low {100, 90}, high {129, 139}
  ["bp_systolic", 100, "green"],
  ["bp_systolic", 99, "yellow"],
  ["bp_systolic", 90, "yellow"],
  ["bp_systolic", 89, "red"],
  ["bp_systolic", 129, "green"],
  ["bp_systolic", 130, "yellow"],
  ["bp_systolic", 139, "yellow"],
  ["bp_systolic", 140, "red"],
  // bp_diastolic: low {60, 55}, high {84, 89}
  ["bp_diastolic", 60, "green"],
  ["bp_diastolic", 59, "yellow"],
  ["bp_diastolic", 55, "yellow"],
  ["bp_diastolic", 54, "red"],
  ["bp_diastolic", 84, "green"],
  ["bp_diastolic", 85, "yellow"],
  ["bp_diastolic", 89, "yellow"],
  ["bp_diastolic", 90, "red"],
  // heart_rate: low {50, 40}, high {90, 110}
  ["heart_rate", 50, "green"],
  ["heart_rate", 49, "yellow"],
  ["heart_rate", 40, "yellow"],
  ["heart_rate", 39, "red"],
  ["heart_rate", 90, "green"],
  ["heart_rate", 91, "yellow"],
  ["heart_rate", 110, "yellow"],
  ["heart_rate", 111, "red"],
  // temperature_c: low {36.0, 35.5}, high {37.5, 38.0}
  ["temperature_c", 36.0, "green"],
  ["temperature_c", 35.9, "yellow"],
  ["temperature_c", 35.5, "yellow"],
  ["temperature_c", 35.4, "red"],
  ["temperature_c", 37.5, "green"],
  ["temperature_c", 37.6, "yellow"],
  ["temperature_c", 38.0, "yellow"],
  ["temperature_c", 38.1, "red"],
  // glucose_mgdl: low {70, 60}, high {140, 180}
  ["glucose_mgdl", 70, "green"],
  ["glucose_mgdl", 69, "yellow"],
  ["glucose_mgdl", 60, "yellow"],
  ["glucose_mgdl", 59, "red"],
  ["glucose_mgdl", 140, "green"],
  ["glucose_mgdl", 141, "yellow"],
  ["glucose_mgdl", 180, "yellow"],
  ["glucose_mgdl", 181, "red"],
  // water_ml: low {2000, 1000}, maxLevel yellow
  ["water_ml", 2000, "green"],
  ["water_ml", 1999, "yellow"],
  ["water_ml", 1000, "yellow"],
  ["water_ml", 999, "yellow"],
  ["water_ml", 500, "yellow"],
  ["water_ml", 0, "yellow"],
  // exercise_min: low {45, 15}, maxLevel yellow
  ["exercise_min", 45, "green"],
  ["exercise_min", 44, "yellow"],
  ["exercise_min", 15, "yellow"],
  ["exercise_min", 14, "yellow"],
  ["exercise_min", 0, "yellow"],
  // vision_check: high {0, 1}
  ["vision_check", 0, "green"],
  ["vision_check", 1, "yellow"],
  ["vision_check", 2, "red"],
  // workload: high {3, 6}, maxLevel yellow
  ["workload", 1, "green"],
  ["workload", 3, "green"],
  ["workload", 4, "yellow"],
  ["workload", 5, "yellow"],
  ["workload", 7, "yellow"],
];

describe("status: fixed-range thresholds", () => {
  it.each(BOUNDARY_CASES)("%s = %s -> %s", (key, value, expected) => {
    const ev = evaluateIndicator(key, value, null);
    expect(ev.status).toBe(expected);
    expect(ev.reason).toBe("fixed_range");
    expect(ev.z).toBeNull();
    expect(ev.delta).toBeNull();
  });

  it("covers every key that has thresholds", () => {
    const withThresholds = KPI_KEYS.filter((k) => KPI_DEFS[k].thresholds);
    const covered = new Set(BOUNDARY_CASES.map(([k]) => k));
    expect([...covered].sort()).toEqual([...withThresholds].sort());
  });

  it("tests both sides of every two-sided threshold", () => {
    const twoSided = KPI_KEYS.filter((k) => KPI_DEFS[k].thresholds?.low && KPI_DEFS[k].thresholds?.high);
    for (const key of twoSided) {
      const th = KPI_DEFS[key].thresholds!;
      const lows = BOUNDARY_CASES.filter(([k, v]) => k === key && v <= th.low!.yellow).length;
      const highs = BOUNDARY_CASES.filter(([k, v]) => k === key && v >= th.high!.yellow).length;
      expect(lows, `${key} low side`).toBeGreaterThanOrEqual(3);
      expect(highs, `${key} high side`).toBeGreaterThanOrEqual(3);
    }
  });

  it("clamps lifestyle keys to yellow: water 500 ml is yellow, not red", () => {
    expect(evaluateIndicator("water_ml", 500, null).status).toBe("yellow");
    expect(fixedRangeStatus(KPI_DEFS.water_ml, 500)).toBe("yellow");
    // the same number would be red without the clamp
    expect(fixedRangeStatus({ ...KPI_DEFS.water_ml, maxLevel: undefined }, 500)).toBe("red");
  });
});

describe("status: no data and text keys", () => {
  it("returns no_data / missing for null, undefined and non-numbers, never green", () => {
    for (const key of KPI_KEYS) {
      for (const empty of [null, undefined]) {
        const ev = evaluateIndicator(key, empty, null);
        expect(ev).toEqual({ status: "no_data", reason: "missing", z: null, delta: null });
      }
    }
    expect(evaluateIndicator("heart_rate", "abc", null).status).toBe("no_data");
    expect(evaluateIndicator("day_note", "   ", null).status).toBe("no_data");
    expect(evaluateIndicator("day_note", "", null).status).toBe("no_data");
  });

  it("evaluates a whole empty day as 16 no_data entries", () => {
    const evals = evaluateIndicators({}, {});
    expect(Object.keys(evals)).toHaveLength(16);
    for (const key of KPI_KEYS) expect(evals[key].status).toBe("no_data");
  });

  it("treats a present text value as green and a recorded 0 as a real value, not missing", () => {
    expect(evaluateIndicator("symptom_note", "slight pressure", null).status).toBe("green");
    expect(evaluateIndicator("day_note", "busy day", null).status).toBe("green");
    expect(evaluateIndicator("symptom_headache", 0, null).status).toBe("green");
  });

  it("accepts numeric strings for numeric keys", () => {
    expect(evaluateIndicator("heart_rate", "72", null).status).toBe("green");
    expect(evaluateIndicator("heart_rate", "120", null).status).toBe("red");
  });
});

describe("status: worstStatus", () => {
  it("ranks red > yellow > green > no_data", () => {
    expect(worstStatus(["green", "yellow", "red"])).toBe("red");
    expect(worstStatus(["green", "yellow"])).toBe("yellow");
    expect(worstStatus(["green", "no_data"])).toBe("green");
    expect(worstStatus(["no_data", "no_data"])).toBe("no_data");
    expect(worstStatus([])).toBe("no_data");
  });
});
