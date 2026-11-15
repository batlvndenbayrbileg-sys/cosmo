import { describe, expect, it } from "vitest";
import { buildKpiStats, evaluateDay } from "@/lib/health";
import { KPI_KEYS, type KpiKey, type MeasurementSource } from "@/lib/types";
import { computeBaseline } from "@/lib/health/baseline";
import { CALM_WELLBEING, batDemoToday, batHistory, normalToday, steadyHistory } from "./helpers/health";
import { computeDayArc } from "@/lib/health";

describe("worked example: Bat's scripted demo check-in (docs/DASHBOARD_PLAN.md section 6)", () => {
  const history = batHistory();
  const today = batDemoToday();
  const day = evaluateDay(today, history);

  it("builds a history that matches Bat's usual numbers", () => {
    expect(history).toHaveLength(14);
    expect(computeBaseline(history, "sleep_hours").mean!).toBeCloseTo(7.2, 1);
    expect(Math.abs(computeBaseline(history, "water_ml").mean! - 2300)).toBeLessThan(15);
    expect(computeBaseline(history, "heart_rate").mean!).toBeCloseTo(66, 0);
    expect(computeBaseline(history, "bp_systolic").mean!).toBeCloseTo(120, 0);
    expect(computeBaseline(history, "bp_diastolic").mean!).toBeCloseTo(78, 0);
  });

  it("is overall yellow, with no red flag", () => {
    expect(day.overall).toBe("yellow");
    expect(day.redFlags).toEqual([]);
    expect(day.summary.overall).toBe("yellow");
  });

  it("flags sleep and water as the two findings, in that order", () => {
    expect(day.summary.findings.map((f) => f.key)).toEqual(["sleep_hours", "water_ml"]);
    expect(day.indicators.sleep_hours).toMatchObject({ status: "yellow", reason: "fixed_range" });
    expect(day.indicators.water_ml).toMatchObject({ status: "yellow", reason: "fixed_range" });
  });

  it("keeps the vitals green against Bat's own baseline", () => {
    for (const key of ["bp_systolic", "bp_diastolic", "heart_rate", "temperature_c", "glucose_mgdl", "mood", "workload"] as KpiKey[]) {
      expect(day.indicators[key].status, key).toBe("green");
      expect(Math.abs(day.indicators[key].z!), key).toBeLessThan(2);
    }
    for (const key of ["symptom_headache", "symptom_dizziness", "symptom_nausea", "vision_check"] as KpiKey[]) {
      expect(day.indicators[key].status, key).toBe("green");
    }
  });

  it("also marks exercise 40 min yellow (below the 45 min demo parameter) without making it a finding", () => {
    expect(day.indicators.exercise_min.status).toBe("yellow");
    expect(day.summary.findings.some((f) => f.key === "exercise_min")).toBe(false);
  });

  it("includes the sleep wind-down and hydration tasks, and recommends exactly those two", () => {
    const ids = day.tasks.map((t) => t.id);
    expect(ids).toContain("sleep_wind_down");
    expect(ids).toContain("hydration_plan");
    expect(day.tasks.length).toBeGreaterThanOrEqual(3);
    expect(day.tasks.length).toBeLessThanOrEqual(4);
    expect(day.summary.recommendations.map((t) => t.id)).toEqual(["sleep_wind_down", "hydration_plan"]);
  });

  it("computes the axes, readiness and hazards", () => {
    expect(day.axes).toHaveLength(6);
    const byAxis = Object.fromEntries(day.axes.map((a) => [a.axis, a]));
    expect(byAxis.sleep).toMatchObject({ score: 60, status: "yellow" });
    expect(byAxis.cardio).toMatchObject({ score: 100, status: "green" });
    expect(byAxis.metabolic).toMatchObject({ score: 90, status: "yellow" });
    expect(byAxis.neuro_ocular).toMatchObject({ score: 100, status: "green" });
    expect(byAxis.behavioral).toMatchObject({ score: 100, status: "green" });
    expect(byAxis.musculoskeletal).toMatchObject({ score: 60, status: "yellow" });
    expect(day.readiness).toBe(85); // (60 + 100 + 90 + 100 + 100 + 60) / 6
    for (const a of day.axes) expect(a.baseline).not.toBeNull();

    expect(day.hazards).toHaveLength(5);
    const hz = Object.fromEntries(day.hazards.map((h) => [h.hazard, h.status]));
    expect(hz).toEqual({
      radiation: "not_monitored",
      isolation_confinement: "yellow",
      distance_from_earth: "not_monitored",
      gravity: "yellow",
      hostile_closed_environment: "green",
    });
  });

  it("logs every part of the day once the wellbeing check is answered too", () => {
    // the worked example predates the wellbeing check: its morning and evening parts wait for those answers
    expect(day.dayArc.map((s) => s.state)).toEqual(["partial", "done", "done", "partial"]);
    expect(computeDayArc({ ...today, ...CALM_WELLBEING }).map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("is deterministic", () => {
    expect(evaluateDay(today, history)).toEqual(day);
  });

  it("builds 21 KPI stats in KPI_KEYS order for the dashboard cards", () => {
    const source: Partial<Record<KpiKey, MeasurementSource>> = { sleep_hours: "voice", heart_rate: "typed" };
    const stats = buildKpiStats(today, history, source);
    expect(stats.map((s) => s.key)).toEqual([...KPI_KEYS]);

    const sleep = stats.find((s) => s.key === "sleep_hours")!;
    expect(sleep).toMatchObject({ value: 5.5, unit: "h", status: "yellow", reason: "fixed_range", source: "voice" });
    expect(sleep.baselineMean).toBeCloseTo(7.207, 2);
    expect(sleep.baselineSd).toBeGreaterThan(0);
    expect(sleep.delta).toBeCloseTo(-1.707, 2);
    expect(sleep.z).toBeCloseTo(-5.69, 1);
    expect(sleep.history).toHaveLength(14);
    expect(sleep.history[0].date < sleep.history[13].date).toBe(true);
    expect(sleep.rangeText?.en).toBe("Normal ≥ 7 h · demo parameter");

    // no source given -> null; text keys have no history, no range
    expect(stats.find((s) => s.key === "water_ml")!.source).toBeNull();
    const note = stats.find((s) => s.key === "day_note")!;
    expect(note).toMatchObject({ value: null, status: "no_data", history: [], rangeText: null, baselineMean: null });
  });

  it("limits sparkline history to 14 points and reports missing values as null / no_data", () => {
    const long = steadyHistory();
    const extra = [{ date: "2026-10-01", values: { heart_rate: 99 } }, ...long];
    const stats = buildKpiStats({}, extra, {});
    const hr = stats.find((s) => s.key === "heart_rate")!;
    expect(hr.history).toHaveLength(14);
    expect(hr.history.some((p) => p.date === "2026-10-01")).toBe(false);
    for (const s of stats) {
      expect(s.value).toBeNull();
      expect(s.status).toBe("no_data");
      expect(s.reason).toBe("missing");
      expect(s.source).toBeNull();
    }
  });

  it("evaluates a complete, normal day against a steady history as green", () => {
    const normal = evaluateDay(normalToday(), steadyHistory());
    expect(normal.overall).toBe("green");
    expect(normal.readiness).toBe(100);
    expect(normal.summary.findings).toEqual([]);
  });
});
