import { describe, expect, it } from "vitest";
import { QUESTIONS, getQuestion, validateValue } from "@/lib/kpi/registry";
import { KPI_KEYS, type KpiKey, type Lang, type MeasurementValue, type QuestionId } from "@/lib/types";
import {
  interpretAnswer,
  interpretCorrection,
  interpretOpportunistic,
  interpretStart,
  interpretYesNo,
} from "@/server/agent/interpret";
import { DEMO_SCRIPTS, type DemoLine } from "@/server/agent/scripts";

const LANGS: Lang[] = ["en", "mn"];

function questionLines(lines: DemoLine[]): Array<DemoLine & { expect: QuestionId }> {
  const ids = new Set<string>(QUESTIONS.map((q) => q.id));
  return lines.filter((l): l is DemoLine & { expect: QuestionId } => ids.has(l.expect));
}

describe.each(LANGS)("demo script (%s)", (lang) => {
  const script = DEMO_SCRIPTS[lang];

  it("belongs to its language and has about 90 seconds of lines", () => {
    expect(script.language).toBe(lang);
    expect(script.lines.length).toBeGreaterThanOrEqual(15);
    expect(script.lines.length).toBeLessThanOrEqual(22);
    for (const line of script.lines) expect(line.say.trim().length).toBeGreaterThan(0);
  });

  it("follows the conversation: small talk, start, all 12 questions in order, correction, final yes", () => {
    const expects = script.lines.map((l) => l.expect);
    const firstQuestion = expects.findIndex((e) => QUESTIONS.some((q) => q.id === e));
    expect(expects.slice(0, firstQuestion).filter((e) => e === "smalltalk").length).toBeGreaterThanOrEqual(1);
    expect(expects[firstQuestion - 1]).toBe("start");
    expect(questionLines(script.lines).map((l) => l.expect)).toEqual(QUESTIONS.map((q) => q.id));
    expect(expects.slice(-2)).toEqual(["confirm", "confirm2"]);
  });

  it("uses only Bat's demo values (DASHBOARD_PLAN section 6), with sleep corrected to 6", () => {
    expect(script.values).toEqual({
      sleep_hours: 6,
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
    });
    for (const [key, value] of Object.entries(script.values) as Array<[KpiKey, MeasurementValue]>) {
      expect(validateValue(key, value).ok).toBe(true);
    }
  });

  it("every small-talk line is just small talk (not a start, not a number)", () => {
    for (const line of script.lines.filter((l) => l.expect === "smalltalk")) {
      expect(interpretStart(line.say, lang)).toBe("unclear");
      expect(interpretOpportunistic(line.say, lang)).toEqual([]);
    }
  });

  it("the start line is understood as yes", () => {
    const start = script.lines.find((l) => l.expect === "start");
    expect(start).toBeDefined();
    expect(interpretStart(start?.say ?? "", lang)).toBe("yes");
  });

  it("every question line is interpreted into exactly the expected final values", () => {
    for (const line of questionLines(script.lines)) {
      const question = getQuestion(line.expect);
      const result = interpretAnswer(question, line.say, lang);
      expect(result.unclear, line.say).toBe(false);
      expect(result.rejectedKeys, line.say).toEqual([]);
      for (const rec of result.records) {
        expect(question.keys).toContain(rec.key);
        expect(line.say.includes(rec.sourceText), `${line.say} / ${rec.sourceText}`).toBe(true);
      }
      if (line.expect === "day_note") {
        expect(result.records, line.say).toEqual([]); // "nothing to add"
      } else if (line.expect === "sleep") {
        expect(result.records.map((r) => [r.key, r.value]), line.say).toEqual([["sleep_hours", 5.5]]);
      } else {
        for (const rec of result.records) expect(rec.value, `${line.say} -> ${rec.key}`).toBe(script.values[rec.key]);
      }
    }
  });

  it("plays through to the expected final values", () => {
    const stored = new Map<KpiKey, MeasurementValue>();
    for (const line of script.lines) {
      if (line.expect === "smalltalk" || line.expect === "start") continue;
      if (line.expect === "confirm" || line.expect === "correction") {
        const c = interpretCorrection(line.say, lang);
        expect(c.question?.id, line.say).toBe("sleep");
        expect(interpretYesNo(line.say, lang), line.say).toBe(false);
        for (const rec of c.result.records) stored.set(rec.key, rec.value);
        continue;
      }
      if (line.expect === "confirm2") {
        expect(interpretYesNo(line.say, lang), line.say).toBe(true);
        continue;
      }
      const result = interpretAnswer(getQuestion(line.expect), line.say, lang);
      for (const rec of result.records) stored.set(rec.key, rec.value);
    }
    const final: Partial<Record<KpiKey, MeasurementValue>> = {};
    for (const key of KPI_KEYS) {
      const v = stored.get(key);
      if (v !== undefined) final[key] = v;
    }
    expect(final).toEqual(script.values);
    expect(stored.get("sleep_hours")).toBe(6);
  });

  it("the correction at the confirm step changes only sleep, from 5.5 to 6", () => {
    const sleepLine = script.lines.find((l) => l.expect === "sleep");
    const confirm = script.lines.find((l) => l.expect === "confirm");
    const first = interpretAnswer(getQuestion("sleep"), sleepLine?.say ?? "", lang);
    expect(first.records[0].value).toBe(5.5);
    const corrected = interpretCorrection(confirm?.say ?? "", lang);
    expect(corrected.question?.id).toBe("sleep");
    expect(corrected.result.records.map((r) => [r.key, r.value])).toEqual([["sleep_hours", 6]]);
  });

  it("the phrasing is varied: units, bare numbers and spoken number words all appear", () => {
    const lines = questionLines(script.lines);
    const withUnit = lines.filter((l) => /\d\s*\p{L}/u.test(l.say));
    const bare = lines.filter((l) => /^\d+(?:[.,]\d+)?\.?$/u.test(l.say.trim()));
    const asWords = lines.filter(
      (l) => !/\d/.test(l.say) && !["vision", "symptoms", "day_note"].includes(l.expect),
    );
    expect(withUnit.length).toBeGreaterThanOrEqual(2);
    expect(bare.length).toBeGreaterThanOrEqual(1);
    expect(asWords.length).toBeGreaterThanOrEqual(1);
  });
});

describe("demo scripts index", () => {
  it("has one script per language", () => {
    expect(Object.keys(DEMO_SCRIPTS).sort()).toEqual(["en", "mn"]);
  });

  it("both languages tell the same story", () => {
    expect(DEMO_SCRIPTS.en.values).toEqual(DEMO_SCRIPTS.mn.values);
    expect(DEMO_SCRIPTS.en.lines.map((l) => l.expect)).toEqual(DEMO_SCRIPTS.mn.lines.map((l) => l.expect));
  });

  it("the Mongolian script is Cyrillic and the English one is Latin", () => {
    for (const line of DEMO_SCRIPTS.mn.lines) {
      // a bare number such as "98." has no letters; every other line is written in Cyrillic
      if (/\p{L}/u.test(line.say)) expect(line.say).toMatch(/[Ѐ-ӿ]/u);
    }
    for (const line of DEMO_SCRIPTS.en.lines) expect(line.say).not.toMatch(/[Ѐ-ӿ]/u);
  });
});

describe("demo script (mn): the water answer is natural spoken Mongolian", () => {
  it("says 1800 ml in words with the thousand (мянга) and still reads back as 1800", () => {
    const line = DEMO_SCRIPTS.mn.lines.find((l) => l.expect === "water");
    expect(line?.say).toContain("мянга");
    const result = interpretAnswer(getQuestion("water"), line?.say ?? "", "mn");
    expect(result.records.map((r) => [r.key, r.value])).toEqual([["water_ml", 1800]]);
    expect(result.records[0].confidence).toBe(0.9);
  });
});
