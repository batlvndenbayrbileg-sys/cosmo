import { describe, expect, it } from "vitest";
import type { KpiKey, RedFlag, Status } from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { computeBaselines } from "@/lib/health/baseline";
import { computeDayArc } from "@/lib/health/dayArc";
import {
  AXIS_KEYS,
  HAZARD_KEYS,
  computeAxes,
  computeHazards,
  computeOverall,
  computeReadiness,
} from "@/lib/health/scores";
import { evaluateIndicators, type IndicatorEval } from "@/lib/health/status";
import { constantHistory, historyFromSeries, normalToday, type DayValues } from "./helpers/health";

const FLAG: RedFlag = {
  rule: "VITAL_RED",
  keys: ["heart_rate"],
  text: { en: "Alert", mn: "Анхааруулга" },
};

function evalsOf(today: DayValues, history = constantHistory({})) {
  return evaluateIndicators(today, computeBaselines(history));
}

describe("axes", () => {
  it("returns exactly 6 axes in the documented order", () => {
    const axes = computeAxes(normalToday(), []);
    expect(axes).toHaveLength(6);
    expect(axes.map((a) => a.axis)).toEqual([
      "sleep", "cardio", "metabolic", "neuro_ocular", "behavioral", "musculoskeletal",
    ]);
    expect(axes.map((a) => a.axis)).toEqual(AXIS_KEYS);
  });

  it("scores a normal day 100 on every axis", () => {
    for (const a of computeAxes(normalToday(), [])) {
      expect(a.score).toBe(100);
      expect(a.status).toBe("green");
    }
  });

  it("averages indicator sub-scores (green 100, yellow 60, red 20) and takes the worst status", () => {
    // cardio: systolic 118 green, diastolic 90 red, heart rate 66 green -> (100 + 20 + 100) / 3
    const cardio = computeAxes(normalToday({ bp_diastolic: 90 }), []).find((a) => a.axis === "cardio")!;
    expect(cardio.score).toBeCloseTo(73.3, 1);
    expect(cardio.status).toBe("red");
    // sleep has a single indicator
    expect(computeAxes(normalToday({ sleep_hours: 6 }), []).find((a) => a.axis === "sleep")!.score).toBe(60);
    expect(computeAxes(normalToday({ sleep_hours: 4 }), []).find((a) => a.axis === "sleep")!.score).toBe(20);
  });

  it("has a null score and no_data for an axis without data, and ignores no_data inside an axis", () => {
    const axes = computeAxes({ sleep_hours: 7.5 }, []);
    expect(axes.find((a) => a.axis === "sleep")).toMatchObject({ score: 100, status: "green" });
    expect(axes.find((a) => a.axis === "cardio")).toMatchObject({ score: null, baseline: null, status: "no_data" });
    // metabolic with only glucose present is 100, not dragged down by the missing keys
    expect(computeAxes({ glucose_mgdl: 95 }, []).find((a) => a.axis === "metabolic")!.score).toBe(100);
  });

  it("computes each axis baseline as the mean of that axis' daily scores over history days with data", () => {
    // 7 days of 7.5 h (green, 100) and 7 days of 6.5 h (yellow, 60) -> sleep baseline 80
    const history = historyFromSeries({ sleep_hours: [7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5] });
    const axes = computeAxes(normalToday({ sleep_hours: 7.5 }), history);
    const sleep = axes.find((a) => a.axis === "sleep")!;
    expect(sleep.score).toBe(100);
    expect(sleep.baseline).toBe(80);
    // an axis with no history data has no baseline
    expect(axes.find((a) => a.axis === "cardio")!.baseline).toBeNull();
  });

  it("averages the daily axis score over several indicators and skips days without data", () => {
    // metabolic per day: glucose green (100) + water yellow (60) -> 80; one history day has no metabolic data
    const history = historyFromSeries({ glucose_mgdl: [95], water_ml: [1800] }, 4);
    history.push({ date: "2026-11-13", values: { sleep_hours: 7 } });
    const metabolic = computeAxes(normalToday(), history).find((a) => a.axis === "metabolic")!;
    expect(metabolic.baseline).toBe(80);
  });

  it("scores history days with the fixed ranges only, and counts at most the last 14 days", () => {
    // 20 days: oldest 6 are red (4 h), last 14 are green (7.5 h) -> baseline 100
    const history = historyFromSeries({ sleep_hours: [...Array(6).fill(4), ...Array(14).fill(7.5)] }, 20);
    expect(computeAxes({ sleep_hours: 7.5 }, history).find((a) => a.axis === "sleep")!.baseline).toBe(100);
  });

  it("uses the personal baseline for today's axis status", () => {
    // heart rate 60 is fixed-green but |z| = 3 against a steady 66 -> yellow, so the cardio axis drops
    const history = constantHistory({ heart_rate: 66 });
    const cardio = computeAxes(normalToday({ heart_rate: 60, bp_systolic: 118, bp_diastolic: 76 }), history).find(
      (a) => a.axis === "cardio",
    )!;
    expect(cardio.status).toBe("yellow");
    expect(cardio.score).toBeCloseTo(86.7, 1);
  });
});

describe("hazards", () => {
  it("returns exactly 5 hazards in the documented order", () => {
    const hazards = computeHazards(evalsOf(normalToday()));
    expect(hazards).toHaveLength(5);
    expect(hazards.map((h) => h.hazard)).toEqual(HAZARD_KEYS);
    expect(hazards.map((h) => h.hazard)).toEqual([
      "radiation", "isolation_confinement", "distance_from_earth", "gravity", "hostile_closed_environment",
    ]);
  });

  it("marks radiation and distance_from_earth as not_monitored whatever the data", () => {
    for (const today of [normalToday(), {}, normalToday({ heart_rate: 150 })]) {
      const byKey = Object.fromEntries(computeHazards(evalsOf(today)).map((h) => [h.hazard, h]));
      expect(byKey.radiation).toEqual({ hazard: "radiation", status: "not_monitored", keys: [] });
      expect(byKey.distance_from_earth).toEqual({ hazard: "distance_from_earth", status: "not_monitored", keys: [] });
    }
  });

  it("links the registry keys and is green on a normal day", () => {
    const byKey = Object.fromEntries(computeHazards(evalsOf(normalToday())).map((h) => [h.hazard, h]));
    expect(byKey.isolation_confinement.keys).toEqual(["sleep_hours", "mood", "workload"]);
    expect(byKey.hostile_closed_environment.keys).toEqual([
      "symptom_nausea", "temperature_c", "glucose_mgdl",
    ]);
    expect(byKey.gravity.keys).toContain("heart_rate");
    for (const h of ["isolation_confinement", "gravity", "hostile_closed_environment"]) {
      expect(byKey[h].status).toBe("green");
    }
  });

  it("takes the worst status among linked indicators (red beats yellow beats green)", () => {
    // gravity: headache yellow, heart rate red -> red
    const gravity = computeHazards(evalsOf(normalToday({ symptom_headache: 1, heart_rate: 130 }))).find(
      (h) => h.hazard === "gravity",
    )!;
    expect(gravity.status).toBe("red");
    // isolation: sleep yellow only -> yellow
    const isolation = computeHazards(evalsOf(normalToday({ sleep_hours: 6 }))).find(
      (h) => h.hazard === "isolation_confinement",
    )!;
    expect(isolation.status).toBe("yellow");
  });

  it("is no_data when linked indicators exist but none has data, and ignores missing ones otherwise", () => {
    const empty = computeHazards(evalsOf({}));
    expect(empty.find((h) => h.hazard === "gravity")!.status).toBe("no_data");
    expect(empty.find((h) => h.hazard === "radiation")!.status).toBe("not_monitored");
    // only temperature present: hostile environment is green, not no_data
    const partial = computeHazards(evalsOf({ temperature_c: 36.6 }));
    expect(partial.find((h) => h.hazard === "hostile_closed_environment")!.status).toBe("green");
    expect(partial.find((h) => h.hazard === "gravity")!.status).toBe("no_data");
  });
});

describe("readiness", () => {
  it("is 100 on a normal day and the rounded mean of the axes otherwise", () => {
    expect(computeReadiness(computeAxes(normalToday(), []), [])).toBe(100);
    // sleep 60, metabolic (water yellow) 90, musculoskeletal 100 ... -> (60 + 100 + 90 + 100 + 100 + 100) / 6 = 91.7 -> 92
    const axes = computeAxes(normalToday({ sleep_hours: 6, water_ml: 1800 }), []);
    expect(computeReadiness(axes, [])).toBe(92);
  });

  it("is capped at 60 with any red flag, and not raised when already lower", () => {
    const axes = computeAxes(normalToday(), []);
    expect(computeReadiness(axes, [FLAG])).toBe(60);
    const low = computeAxes(
      normalToday({
        sleep_hours: 4, heart_rate: 130, bp_systolic: 150, bp_diastolic: 95, mood: 1,
        glucose_mgdl: 200, temperature_c: 39, vision_check: 2, exercise_min: 0,
      }),
      [],
    );
    expect(computeReadiness(low, [])).toBeLessThan(60);
    expect(computeReadiness(low, [FLAG])).toBeLessThan(60);
  });

  it("is 0 with fewer than 3 axes that have data", () => {
    expect(computeReadiness(computeAxes({}, []), [])).toBe(0);
    expect(computeReadiness(computeAxes({ sleep_hours: 7.5 }, []), [])).toBe(0);
    expect(computeReadiness(computeAxes({ sleep_hours: 7.5, heart_rate: 66 }, []), [])).toBe(0);
  });

  it("works from exactly 3 axes with data", () => {
    const axes = computeAxes({ sleep_hours: 7.5, heart_rate: 66, mood: 4 }, []);
    expect(axes.filter((a) => a.score !== null)).toHaveLength(3);
    expect(computeReadiness(axes, [])).toBe(100);
  });
});

describe("overall status", () => {
  function overall(today: DayValues, flags: RedFlag[] = []): Status {
    return computeOverall(evalsOf(today), flags);
  }

  it("is red with any red indicator or any red flag", () => {
    expect(overall(normalToday({ heart_rate: 130 }))).toBe("red");
    expect(overall(normalToday(), [FLAG])).toBe("red");
    expect(overall({}, [FLAG])).toBe("red");
  });

  it("is yellow with a yellow indicator and no red", () => {
    expect(overall(normalToday({ sleep_hours: 6 }))).toBe("yellow");
    expect(overall(normalToday({ water_ml: 500 }))).toBe("yellow");
  });

  it("is green with all 14 values, and with exactly 10 of 14", () => {
    expect(overall(normalToday())).toBe("green");
    const ten: DayValues = normalToday();
    const drop: KpiKey[] = ["mood", "workload", "exercise_min", "vision_check"];
    for (const k of drop) delete ten[k];
    expect(KPI_KEYS.filter((k) => ten[k] !== undefined)).toHaveLength(10);
    expect(overall(ten)).toBe("green");
  });

  it("is no_data with 9 of 14 values, and notes do not count as values", () => {
    const nine: DayValues = normalToday();
    for (const k of ["mood", "workload", "exercise_min", "vision_check", "symptom_nausea"] as KpiKey[]) delete nine[k];
    expect(overall(nine)).toBe("no_data");
    expect(overall({ ...nine, symptom_note: "ok", day_note: "ok" })).toBe("no_data");
    expect(overall({})).toBe("no_data");
  });

  it("is never green on empty data", () => {
    const evals = Object.fromEntries(KPI_KEYS.map((k) => [k, { status: "no_data", reason: "missing", z: null, delta: null }])) as Record<KpiKey, IndicatorEval>;
    expect(computeOverall(evals, [])).toBe("no_data");
  });
});

describe("day arc", () => {
  it("returns exactly 4 slots in order, all pending on an empty day", () => {
    const arc = computeDayArc({});
    expect(arc.map((s) => s.slot)).toEqual(["morning", "midday", "afternoon", "evening"]);
    for (const s of arc) {
      expect(s.state).toBe("pending");
      expect(s.logged).toEqual([]);
      expect(s.missing.length).toBeGreaterThan(0);
    }
  });

  it("marks slots done when all non-optional keys are present (notes optional)", () => {
    const arc = computeDayArc(normalToday());
    expect(arc.map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
    expect(arc[0].missing).toEqual([]);
    expect(arc[0].logged).toContain("bp_systolic");
    expect(arc[0].logged).not.toContain("symptom_note");
  });

  it("lists optional notes as logged when present", () => {
    const arc = computeDayArc(normalToday({ symptom_note: "slight pressure", day_note: "busy" }));
    expect(arc[0].logged).toContain("symptom_note");
    expect(arc[3].logged).toEqual(["workload", "day_note"]);
  });

  it("marks a slot partial when only some keys are present, and lists what is missing", () => {
    const arc = computeDayArc({ sleep_hours: 7, mood: 4, glucose_mgdl: 95 });
    expect(arc[0].state).toBe("partial");
    expect(arc[0].logged).toEqual(["sleep_hours", "mood"]);
    expect(arc[0].missing).toEqual([
      "symptom_headache", "symptom_dizziness", "symptom_nausea", "bp_systolic", "bp_diastolic", "heart_rate", "temperature_c",
    ]);
    expect(arc[1].state).toBe("partial");
    expect(arc[1].missing).toEqual(["water_ml"]);
    expect(arc[2].state).toBe("pending");
    expect(arc[3].state).toBe("pending");
  });

  it("treats a recorded 0 as logged, and a blank note as missing", () => {
    const arc = computeDayArc({ exercise_min: 0, vision_check: 0, day_note: "   " });
    expect(arc[2].state).toBe("done");
    expect(arc[3].logged).toEqual([]);
    expect(arc[3].state).toBe("pending");
  });
});
