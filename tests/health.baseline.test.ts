import { describe, expect, it } from "vitest";
import { computeBaseline, computeBaselines, recentHistory, zScore } from "@/lib/health/baseline";
import { evaluateIndicator } from "@/lib/health/status";
import { constantHistory, historyFromSeries } from "./helpers/health";

describe("baseline: computeBaseline", () => {
  it("returns null mean and sd with fewer than 5 values, but reports n", () => {
    const four = historyFromSeries({ sleep_hours: [7, 7.5, 6.5, 7] }, 4);
    expect(computeBaseline(four, "sleep_hours")).toEqual({ mean: null, sd: null, n: 4 });
    expect(computeBaseline([], "sleep_hours")).toEqual({ mean: null, sd: null, n: 0 });
  });

  it("starts at exactly 5 values", () => {
    const five = historyFromSeries({ sleep_hours: [7, 7, 7, 7, 7] }, 5);
    const b = computeBaseline(five, "sleep_hours");
    expect(b.n).toBe(5);
    expect(b.mean).toBe(7);
    expect(b.sd).toBe(0);
  });

  it("computes the mean and the sample standard deviation (n - 1) of a fixed series", () => {
    // classic series: mean 5, population sd 2, sample sd sqrt(32 / 7)
    const h = historyFromSeries({ heart_rate: [2, 4, 4, 4, 5, 5, 7, 9] }, 8);
    const b = computeBaseline(h, "heart_rate");
    expect(b.n).toBe(8);
    expect(b.mean).toBeCloseTo(5, 10);
    expect(b.sd).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(b.sd).not.toBeCloseTo(2, 3); // not the population sd
  });

  it("only counts days that have the key, and ignores non-numeric values", () => {
    const h = historyFromSeries({ heart_rate: [60, 62, 64, 66, 68, 70] }, 6);
    h[1].values.heart_rate = undefined;
    h[2].values.heart_rate = "n/a";
    const b = computeBaseline(h, "heart_rate");
    expect(b.n).toBe(4);
    expect(b.mean).toBeNull();
  });

  it("uses only the last 14 days, whatever the input order", () => {
    // 20 days, values 1..20 oldest first; the last 14 are 7..20 (mean 13.5)
    const h = historyFromSeries({ sleep_hours: Array.from({ length: 20 }, (_, i) => i + 1) }, 20);
    const shuffled = [...h].reverse();
    for (const input of [h, shuffled]) {
      const b = computeBaseline(input, "sleep_hours");
      expect(b.n).toBe(14);
      expect(b.mean).toBeCloseTo(13.5, 10);
    }
    expect(recentHistory(shuffled)).toHaveLength(14);
    expect(recentHistory(shuffled)[0].date < recentHistory(shuffled)[13].date).toBe(true);
  });

  it("does not mutate its input", () => {
    const h = historyFromSeries({ sleep_hours: [7, 8, 9, 7, 8, 9] }, 6);
    const snapshot = JSON.stringify(h);
    computeBaseline([...h].reverse(), "sleep_hours");
    expect(JSON.stringify(h)).toBe(snapshot);
  });

  it("computes baselines for the 18 non-text keys only", () => {
    const b = computeBaselines(constantHistory({ heart_rate: 66, symptom_note: "x" }));
    expect(Object.keys(b)).toHaveLength(18);
    expect(b.sensor_note).toBeUndefined();
    expect(b.symptom_note).toBeUndefined();
    expect(b.day_note).toBeUndefined();
    expect(b.heart_rate).toEqual({ mean: 66, sd: 0, n: 14 });
  });
});

describe("baseline: zScore", () => {
  it("is (value - mean) / max(sd, floor)", () => {
    expect(zScore(10, { mean: 8, sd: 1, n: 10 }, 0)).toBeCloseTo(2, 10);
    expect(zScore(10, { mean: 8, sd: 1, n: 10 }, 4)).toBeCloseTo(0.5, 10); // floor wins
    expect(zScore(6, { mean: 8, sd: 1, n: 10 }, 0)).toBeCloseTo(-2, 10);
  });

  it("is null without a baseline, and never divides by zero", () => {
    expect(zScore(5, { mean: null, sd: null, n: 3 }, 1)).toBeNull();
    expect(zScore(5, null, 1)).toBeNull();
    expect(zScore(5, undefined, 1)).toBeNull();
    expect(zScore(5, { mean: 5, sd: 0, n: 10 }, 0)).toBeNull();
  });
});

describe("baseline: effect on the status", () => {
  it("turns a fixed-green value into yellow / baseline when |z| > 2", () => {
    const b = computeBaseline(constantHistory({ sleep_hours: 7.5 }), "sleep_hours"); // sd 0 -> floor 0.3
    const high = evaluateIndicator("sleep_hours", 8.5, b); // fixed green, z = 3.33
    expect(high.status).toBe("yellow");
    expect(high.reason).toBe("baseline");
    expect(high.z).toBeCloseTo(1 / 0.3, 6);
    expect(high.delta).toBeCloseTo(1, 10);

    // the same rule works downwards for a key whose fixed range is wide
    const hr = computeBaseline(constantHistory({ heart_rate: 66 }), "heart_rate"); // floor 2
    const low = evaluateIndicator("heart_rate", 60, hr); // fixed green (>= 50), z = -3
    expect(low.status).toBe("yellow");
    expect(low.reason).toBe("baseline");
    expect(low.z).toBeCloseTo(-3, 10);
  });

  it("stays green inside |z| <= 2", () => {
    const b = computeBaseline(constantHistory({ sleep_hours: 7.5 }), "sleep_hours");
    const ev = evaluateIndicator("sleep_hours", 8.05, b); // z about 1.83
    expect(ev.status).toBe("green");
    expect(ev.z).toBeCloseTo(0.55 / 0.3, 6);
  });

  it("never produces red from the baseline alone", () => {
    const b = computeBaseline(constantHistory({ heart_rate: 60 }), "heart_rate");
    const ev = evaluateIndicator("heart_rate", 88, b); // fixed green (<= 90), z = 14
    expect(ev.status).toBe("yellow");
    expect(ev.reason).toBe("baseline");
    expect(Math.abs(ev.z!)).toBeGreaterThan(10);
  });

  it("keeps a fixed-range result: red stays red / fixed_range and keeps its z", () => {
    const b = computeBaseline(constantHistory({ heart_rate: 66 }), "heart_rate");
    const ev = evaluateIndicator("heart_rate", 120, b);
    expect(ev.status).toBe("red");
    expect(ev.reason).toBe("fixed_range");
    expect(ev.z).not.toBeNull();
    expect(ev.delta).toBeCloseTo(54, 10);
  });

  it("uses sdFloor so a near-constant history does not flag trivia", () => {
    // temperature history is almost constant (sd about 0.005); 36.7 is 0.1 above the mean
    const h = historyFromSeries({ temperature_c: [36.6, 36.61, 36.6, 36.6, 36.61, 36.6, 36.6] }, 7);
    const b = computeBaseline(h, "temperature_c");
    expect(b.sd!).toBeLessThan(0.01);
    const ev = evaluateIndicator("temperature_c", 36.7, b); // z = 0.1 / 0.15 = 0.67 with the floor
    expect(ev.status).toBe("green");
    expect(Math.abs(ev.z!)).toBeLessThan(1);
    // without a floor the same data would be a huge z
    expect(Math.abs(zScore(36.7, b, 0)!)).toBeGreaterThan(10);
  });

  it("produces no baseline effect with fewer than 5 days of history", () => {
    const h = historyFromSeries({ sleep_hours: [7.5, 7.5, 7.5, 7.5] }, 4);
    const ev = evaluateIndicator("sleep_hours", 9, computeBaseline(h, "sleep_hours"));
    expect(ev).toEqual({ status: "green", reason: "fixed_range", z: null, delta: null });
  });

  it("does not use the baseline for yes/no symptoms", () => {
    const h = historyFromSeries({ symptom_headache: [1, 1, 1, 1, 1, 0, 1, 1] }, 8);
    const ev = evaluateIndicator("symptom_headache", 0, computeBaseline(h, "symptom_headache"));
    expect(ev).toEqual({ status: "green", reason: "fixed_range", z: null, delta: null });
  });

  it("reports delta for numeric keys", () => {
    const b = computeBaseline(historyFromSeries({ water_ml: [2300, 2300, 2300, 2300, 2300, 2300] }, 6), "water_ml");
    expect(evaluateIndicator("water_ml", 1800, b).delta).toBeCloseTo(-500, 10);
  });
});
