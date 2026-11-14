import { describe, expect, it } from "vitest";
import { evaluateDay, formatNumber } from "@/lib/health";
import { DISCLAIMER } from "@/lib/health/summary";
import {
  batDemoToday,
  batHistory,
  collectStrings,
  normalToday,
  steadyHistory,
} from "./helpers/health";

describe("formatNumber", () => {
  it("rounds, drops trailing zeros and never shows -0", () => {
    expect(formatNumber(1.7000000000000002, 1)).toBe("1.7");
    expect(formatNumber(6, 1)).toBe("6");
    expect(formatNumber(7.25, 1)).toBe("7.3");
    expect(formatNumber(2307.142857, 0)).toBe("2307");
    expect(formatNumber(36.6, 2)).toBe("36.6");
    expect(formatNumber(-0.01, 1)).toBe("0");
    expect(formatNumber(0, 1)).toBe("0");
  });

  it("returns a dash for non-finite numbers", () => {
    expect(formatNumber(NaN)).toBe("-");
    expect(formatNumber(Infinity)).toBe("-");
  });
});

describe("summary findings", () => {
  const demo = evaluateDay(batDemoToday(), batHistory()).summary;

  it("has at most 2 findings, at most 2 recommendations, the disclaimer and both languages", () => {
    const s = evaluateDay(
      normalToday({ sleep_hours: 4, water_ml: 400, exercise_min: 0, mood: 2, heart_rate: 120, workload: 5 }),
      steadyHistory(),
    ).summary;
    expect(s.findings.length).toBeLessThanOrEqual(2);
    expect(s.findings).toHaveLength(2);
    expect(s.recommendations.length).toBeLessThanOrEqual(2);
    expect(s.recommendations).toHaveLength(2);
    expect(s.disclaimer).toEqual({
      en: "Decision support, not a diagnosis.",
      mn: "Шийдвэр гаргахад туслах мэдээлэл, онош биш.",
    });
    expect(s.disclaimer).toEqual(DISCLAIMER);
  });

  it("writes non-empty English and Mongolian for the headline and every finding", () => {
    for (const bilingual of [demo.headline, ...demo.findings.map((f) => f.text)]) {
      expect(bilingual.en.length).toBeGreaterThan(10);
      expect(bilingual.mn.length).toBeGreaterThan(10);
      // Mongolian text is Cyrillic
      expect(bilingual.mn).toMatch(/[Ѐ-ӿ]/);
    }
  });

  it("puts red before yellow, whatever the |z|", () => {
    // heart rate red; sleep and water yellow with large |z|
    const s = evaluateDay(batDemoToday(), batHistory()).summary;
    expect(s.findings.map((f) => f.key)).toEqual(["sleep_hours", "water_ml"]);
    const withRed = evaluateDay({ ...batDemoToday(), heart_rate: 118 }, batHistory()).summary;
    expect(withRed.findings[0]).toMatchObject({ key: "heart_rate", status: "red" });
    expect(withRed.findings).toHaveLength(2);
    expect(withRed.findings[1].status).toBe("yellow");
  });

  it("orders yellow findings by |z| descending", () => {
    const s = evaluateDay(batDemoToday(), batHistory()).summary;
    const [a, b] = s.findings;
    expect(Math.abs(a.z!)).toBeGreaterThan(Math.abs(b.z!));
  });

  it("states the numbers: value, baseline gap and the person's usual", () => {
    const [sleep, water] = demo.findings;
    expect(sleep.text.en).toBe("Sleep was 5.5 h, about 1.7 h below your usual 7.2 h.");
    expect(sleep.text.mn).toContain("5.5 цаг");
    expect(sleep.text.mn).toContain("7.2 цаг");
    expect(sleep.text.mn).toContain("1.7");
    expect(sleep).toMatchObject({ key: "sleep_hours", status: "yellow", reason: "fixed_range", direction: "low", unit: "h", value: 5.5 });
    expect(sleep.baselineMean).toBeCloseTo(7.207, 2);
    expect(water.text.en).toBe("Water intake was 1800 ml, about 507 ml below your usual 2307 ml.");
    expect(water.direction).toBe("low");
  });

  it("uses the demo parameter when there is no baseline", () => {
    const s = evaluateDay(normalToday({ sleep_hours: 5.5 }), []).summary;
    expect(s.findings[0].text.en).toBe("Sleep was 5.5 h, below the demo range (from 7 h).");
    expect(s.findings[0].baselineMean).toBeNull();
    const hi = evaluateDay(normalToday({ heart_rate: 100 }), []).summary;
    expect(hi.findings[0].text.en).toBe("Heart rate was 100 bpm, above the demo range (up to 90 bpm).");
    expect(hi.findings[0].direction).toBe("high");
  });

  it("words symptoms and vision findings without numbers", () => {
    const s = evaluateDay(normalToday({ symptom_dizziness: 1, vision_check: 1 }), []).summary;
    const texts = s.findings.map((f) => f.text.en);
    expect(texts).toContain("Dizziness reported today.");
    expect(texts).toContain("Vision check: slightly blurred.");
  });

  it("reports a baseline finding with reason 'baseline'", () => {
    const history = batHistory();
    const s = evaluateDay(normalToday({ ...batDemoToday(), sleep_hours: 9.4, water_ml: 2300, exercise_min: 45, bp_systolic: 120, bp_diastolic: 78, heart_rate: 66 }), history).summary;
    expect(s.findings[0]).toMatchObject({ key: "sleep_hours", status: "yellow", reason: "baseline", direction: "high" });
    expect(s.findings[0].text.en).toMatch(/above your usual 7\.2 h/);
  });

  it("never mentions findings for a normal day, and says so calmly", () => {
    const s = evaluateDay(normalToday(), steadyHistory()).summary;
    expect(s.findings).toEqual([]);
    expect(s.overall).toBe("green");
    expect(s.headline.en).toContain("steady");
    expect(s.headline.en).toContain(String(s.readiness));
  });

  it("recommends the first two tasks", () => {
    const day = evaluateDay(batDemoToday(), batHistory());
    expect(day.summary.recommendations).toEqual(day.tasks.slice(0, 2));
    expect(day.summary.recommendations.map((t) => t.id)).toEqual(["sleep_wind_down", "hydration_plan"]);
  });

  it("carries overall, readiness and red flags through", () => {
    const day = evaluateDay(normalToday({ heart_rate: 130 }), steadyHistory());
    expect(day.summary.overall).toBe("red");
    expect(day.summary.readiness).toBe(day.readiness);
    expect(day.summary.redFlags).toEqual(day.redFlags);
    expect(day.summary.redFlags).toHaveLength(1);
    expect(day.summary.headline.en).toMatch(/^Alert/);
    expect(day.summary.recommendations[0].id).toBe("contact_medical_officer");
  });

  it("says the overall picture is missing when there is no data", () => {
    const s = evaluateDay({}, []).summary;
    expect(s.overall).toBe("no_data");
    expect(s.readiness).toBe(0);
    expect(s.headline.en).toMatch(/Not enough data/);
    expect(s.findings).toEqual([]);
    expect(s.headline.en).not.toMatch(/steady|normal|fine/i);
  });

  it("does not print a placeholder readiness when fewer than 3 axes have data", () => {
    for (const today of [{ sleep_hours: 4 }, { sleep_hours: 6.5 }]) {
      const day = evaluateDay(today, []);
      expect(day.readiness).toBe(0);
      expect(["red", "yellow"]).toContain(day.overall);
      expect(day.summary.headline.en).not.toMatch(/readiness/i);
      expect(day.summary.headline.en).not.toMatch(/out of 100/);
      expect(day.summary.headline.mn).not.toMatch(/Бэлэн байдал/);
      expect(day.summary.headline.en.length).toBeGreaterThan(10);
    }
    expect(evaluateDay({ sleep_hours: 4 }, []).summary.headline.en).toMatch(/^Alert/);
    // with enough axes the number is still shown
    const full = evaluateDay(normalToday({ heart_rate: 130 }), steadyHistory());
    expect(full.summary.headline.en).toMatch(/Readiness is \d+ out of 100/);
  });

  it("mentions several symptoms in the headline", () => {
    const s = evaluateDay(normalToday({ symptom_headache: 1, symptom_nausea: 1 }), []).summary;
    expect(s.headline.en).toMatch(/Several symptoms/);
    expect(s.headline.mn).toMatch(/шинж тэмдэг/);
    const one = evaluateDay(normalToday({ symptom_headache: 1 }), []).summary;
    expect(one.headline.en).not.toMatch(/Several symptoms/);
  });

  it("never claims a diagnosis outside the disclaimer", () => {
    const s = evaluateDay(normalToday({ heart_rate: 130, symptom_headache: 1, vision_check: 2 }), steadyHistory()).summary;
    const { disclaimer, ...rest } = s;
    expect(disclaimer.en).toContain("not a diagnosis");
    for (const text of collectStrings(rest)) expect(text).not.toMatch(/diagnos/i);
  });
});
