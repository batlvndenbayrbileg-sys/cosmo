import { describe, expect, it } from "vitest";
import { QUESTIONS, SENSOR_KEYS, SPOKEN_QUESTIONS, getQuestion, validateValue } from "@/lib/kpi/registry";
import { KPI_KEYS, type KpiKey, type Lang, type MeasurementValue, type QuestionId } from "@/lib/types";
import {
  interpretAnswer,
  interpretCorrection,
  interpretOpportunistic,
  interpretStart,
  interpretYesNo,
} from "@/server/agent/interpret";
import { DEMO_SCRIPTS, type DemoLine } from "@/server/agent/scripts";

/**
 * The scripted demo after the check-in redesign (docs/research/checkin-nasa.md): the sensors have logged sleep and the
 * morning vitals (Bat's resting pulse is up on the demo day), so Bat answers the sensor follow-up and the six spoken
 * questions only, then changes energy at the read-back. (The pipeline replay is in scripted-flow.test.ts.)
 */

const LANGS: Lang[] = ["en", "mn"];

function questionLines(lines: DemoLine[]): Array<DemoLine & { expect: QuestionId }> {
  const ids = new Set<string>(QUESTIONS.map((q) => q.id));
  return lines.filter((l): l is DemoLine & { expect: QuestionId } => ids.has(l.expect));
}

describe.each(LANGS)("demo script (%s)", (lang) => {
  const script = DEMO_SCRIPTS[lang];

  it("belongs to its language and is short (about a minute of lines)", () => {
    expect(script.language).toBe(lang);
    expect(script.lines.length).toBeGreaterThanOrEqual(10);
    expect(script.lines.length).toBeLessThanOrEqual(14);
    for (const line of script.lines) expect(line.say.trim().length).toBeGreaterThan(0);
  });

  it("follows the conversation: small talk, start, the sensor follow-up and the six spoken questions, correction, yes", () => {
    const expects = script.lines.map((l) => l.expect);
    const firstQuestion = expects.findIndex((e) => QUESTIONS.some((q) => q.id === e));
    expect(expects.slice(0, firstQuestion).filter((e) => e === "smalltalk").length).toBeGreaterThanOrEqual(1);
    expect(expects[firstQuestion - 1]).toBe("start");
    expect(questionLines(script.lines).map((l) => l.expect)).toEqual(SPOKEN_QUESTIONS.map((q) => q.id));
    // no measurement is asked one by one: the sensors gave them
    for (const id of ["sleep", "blood_pressure", "heart_rate", "temperature", "glucose", "water", "exercise"]) {
      expect(expects).not.toContain(id);
    }
    expect(expects.slice(-2)).toEqual(["confirm", "confirm2"]);
  });

  it("ends with the sensor readings of the demo day and Bat's own answers, every value valid", () => {
    for (const key of SENSOR_KEYS) expect(typeof script.values[key], key).toBe("number");
    expect(script.values).toMatchObject({ heart_rate: 82, mood: 4, sleep_quality: 2, energy: 2, stress: 2, connection: 4, vision_check: 0 });
    for (const [key, value] of Object.entries(script.values) as Array<[KpiKey, MeasurementValue]>) {
      expect(validateValue(key, value).ok, key).toBe(true);
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

  it("every question line is interpreted into the expected value (energy 3 before the correction)", () => {
    for (const line of questionLines(script.lines)) {
      const question = getQuestion(line.expect);
      const result = interpretAnswer(question, line.say, lang);
      expect(result.unclear, line.say).toBe(false);
      expect(result.rejectedKeys, line.say).toEqual([]);
      for (const rec of result.records) {
        expect(line.say.includes(rec.sourceText), `${line.say} / ${rec.sourceText}`).toBe(true);
      }
      if (line.expect === "energy") {
        expect(result.records.map((r) => [r.key, r.value]), line.say).toEqual([["energy", 3]]);
      } else {
        for (const rec of result.records) expect(rec.value, `${line.say} -> ${rec.key}`).toBe(script.values[rec.key]);
      }
    }
  });

  it("plays through to the expected final values (the sensor readings come from the feed)", () => {
    const stored = new Map<KpiKey, MeasurementValue>();
    for (const key of SENSOR_KEYS) stored.set(key, script.values[key] as MeasurementValue);
    for (const line of script.lines) {
      if (line.expect === "smalltalk" || line.expect === "start") continue;
      if (line.expect === "confirm" || line.expect === "correction") {
        const c = interpretCorrection(line.say, lang);
        expect(c.question?.id, line.say).toBe("energy");
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
  });

  it("the phrasing is varied: bare numbers, number words and plain words all appear", () => {
    const lines = questionLines(script.lines).filter((l) => l.expect !== "sensor_check" && l.expect !== "symptoms");
    const digits = lines.filter((l) => /\d/u.test(l.say));
    const numberWords = lines.filter((l) => /(?<![\p{L}])(?:two|three|four|хоёр|гурав|дөрөв)(?![\p{L}])/iu.test(l.say));
    const wordsOnly = questionLines(script.lines).filter((l) => l.expect === "sleep_quality");
    expect(digits.length + numberWords.length).toBeGreaterThanOrEqual(3);
    expect(wordsOnly.every((l) => !/\d/u.test(l.say))).toBe(true);
  });
});

describe("demo scripts index", () => {
  it("has one script per language", () => {
    expect(Object.keys(DEMO_SCRIPTS).sort()).toEqual(["en", "mn"]);
  });

  it("both languages tell the same story", () => {
    const { sensor_note: enNote, ...en } = DEMO_SCRIPTS.en.values;
    const { sensor_note: mnNote, ...mn } = DEMO_SCRIPTS.mn.values;
    expect(en).toEqual(mn);
    expect(typeof enNote).toBe("string");
    expect(typeof mnNote).toBe("string");
    expect(DEMO_SCRIPTS.en.lines.map((l) => l.expect)).toEqual(DEMO_SCRIPTS.mn.lines.map((l) => l.expect));
  });

  it("the Mongolian script is Cyrillic and the English one is Latin", () => {
    for (const line of DEMO_SCRIPTS.mn.lines) {
      if (/\p{L}/u.test(line.say)) expect(line.say).toMatch(/[Ѐ-ӿ]/u);
    }
    for (const line of DEMO_SCRIPTS.en.lines) expect(line.say).not.toMatch(/[Ѐ-ӿ]/u);
  });
});
