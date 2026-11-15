import { describe, expect, it } from "vitest";
import type { KpiKey, Lang, QuestionId } from "@/lib/types";
import { getQuestion } from "@/lib/kpi/registry";
import { interpretAnswer } from "@/server/agent/interpret";
import { askQuestion, clarify } from "@/server/agent/templates";
import { crossCheckNumber } from "@/server/agent/tools";
import { readContainers } from "@/lib/numbers/units";

/**
 * Loose answers (team feedback 2026-11-15: "it is very stiff ... when it asks in millilitres and I answer in litres it
 * says it did not understand"). Every row: the open question, what the astronaut said, the value the rules record, and
 * whether it was read with a stated assumption (confidence 0.7 and the acknowledgement names the reading) or literally
 * (0.9). Every recorded value also passes the number cross-check against its own source words (tools.ts), so the
 * pipeline accepts it.
 */

type Row = [QuestionId, Lang, string, Partial<Record<KpiKey, number>>, "literal" | "assumed"];

const ROWS: Row[] = [
  // water: litres, a bare "литр", "литр хагас", glasses, bottles, ranges
  ["water", "mn", "литр", { water_ml: 1000 }, "assumed"],
  ["water", "mn", "литр хагас", { water_ml: 1500 }, "literal"],
  ["water", "mn", "нэг литр хагас", { water_ml: 1500 }, "literal"],
  ["water", "mn", "1 литр", { water_ml: 1000 }, "literal"],
  ["water", "mn", "хоёр литр орчим", { water_ml: 2000 }, "literal"],
  ["water", "mn", "1,5 литр", { water_ml: 1500 }, "literal"],
  ["water", "mn", "1 литр 200", { water_ml: 1200 }, "literal"],
  ["water", "mn", "2 аяга", { water_ml: 500 }, "assumed"],
  ["water", "mn", "гурван аяга ус", { water_ml: 750 }, "assumed"],
  ["water", "mn", "2 стакан", { water_ml: 500 }, "assumed"],
  ["water", "mn", "нэг шил ус", { water_ml: 500 }, "assumed"],
  ["water", "mn", "2 лонх", { water_ml: 1000 }, "assumed"],
  ["water", "mn", "хоёр гурван аяга", { water_ml: 625 }, "assumed"],
  ["water", "mn", "1-2 литр", { water_ml: 1500 }, "assumed"],
  ["water", "en", "a litre", { water_ml: 1000 }, "literal"],
  ["water", "en", "3 glasses", { water_ml: 750 }, "assumed"],
  ["water", "en", "a bottle", { water_ml: 500 }, "assumed"],
  ["water", "en", "two bottles of water", { water_ml: 1000 }, "assumed"],
  ["water", "en", "a couple of glasses", { water_ml: 500 }, "assumed"],
  ["water", "en", "2-3 cups", { water_ml: 625 }, "assumed"],
  ["water", "en", "two glasses and a bottle", { water_ml: 1000 }, "assumed"],
  ["water", "en", "about 1.5 l", { water_ml: 1500 }, "literal"],
  ["water", "en", "2", { water_ml: 2000 }, "assumed"],
  // sleep: ranges are read as their middle
  ["sleep", "mn", "6-7 цаг", { sleep_hours: 6.5 }, "assumed"],
  ["sleep", "mn", "зургаа долоон цаг", { sleep_hours: 6.5 }, "assumed"],
  ["sleep", "mn", "5 эсвэл 6 цаг", { sleep_hours: 5.5 }, "assumed"],
  ["sleep", "mn", "7 цаг хагас", { sleep_hours: 7.5 }, "literal"],
  ["sleep", "en", "six or seven", { sleep_hours: 6.5 }, "assumed"],
  ["sleep", "en", "6 to 7 hours", { sleep_hours: 6.5 }, "assumed"],
  ["sleep", "en", "maybe seven and a half", { sleep_hours: 7.5 }, "literal"],
  // exercise: hours, ranges
  ["exercise", "mn", "1 цаг", { exercise_min: 60 }, "literal"],
  ["exercise", "mn", "цаг хагас", { exercise_min: 90 }, "literal"],
  ["exercise", "mn", "30-40 минут", { exercise_min: 35 }, "assumed"],
  ["exercise", "mn", "1-2 цаг", { exercise_min: 90 }, "assumed"],
  ["exercise", "en", "an hour and a half", { exercise_min: 90 }, "literal"],
  ["exercise", "en", "1.5 hours", { exercise_min: 90 }, "literal"],
  ["exercise", "en", "thirty or forty minutes", { exercise_min: 35 }, "assumed"],
  // temperature: Fahrenheit, spoken or bare
  ["temperature", "en", "98.6 F", { temperature_c: 37 }, "literal"],
  ["temperature", "en", "98.6", { temperature_c: 37 }, "assumed"],
  ["temperature", "en", "ninety nine", { temperature_c: 37.2 }, "assumed"],
  ["temperature", "mn", "36,6", { temperature_c: 36.6 }, "literal"],
  // blood pressure: "дээр" / "over" / slash
  ["blood_pressure", "mn", "120 дээр 80", { bp_systolic: 120, bp_diastolic: 80 }, "literal"],
  ["blood_pressure", "en", "120 over 80", { bp_systolic: 120, bp_diastolic: 80 }, "literal"],
  ["blood_pressure", "en", "one twenty over eighty", { bp_systolic: 120, bp_diastolic: 80 }, "literal"],
  // glucose: the registry stores mg/dL; mmol/L is converted
  ["glucose", "en", "95", { glucose_mgdl: 95 }, "literal"],
  ["glucose", "en", "5.5 mmol", { glucose_mgdl: 99 }, "literal"],
  ["glucose", "en", "5.5", { glucose_mgdl: 99 }, "assumed"],
  ["glucose", "mn", "5,4", { glucose_mgdl: 97 }, "assumed"],
  ["glucose", "mn", "таван ммоль", { glucose_mgdl: 90 }, "literal"],
  // heart rate: a range is its middle
  ["heart_rate", "en", "70-75", { heart_rate: 73 }, "assumed"],
  ["heart_rate", "mn", "жаран тав орчим", { heart_rate: 65 }, "literal"],
  // review fixes: an article-less "litre and a half" is 1.5 L (was 1 L from the bare "litre"); a count of times or an
  // age is never the value ("woke up 2 or 3 times" was recorded as 2.5 hours of sleep)
  ["water", "en", "litre and a half", { water_ml: 1500 }, "literal"],
  ["sleep", "en", "woke up 2 or 3 times, slept 7 hours", { sleep_hours: 7 }, "literal"],
  ["sleep", "mn", "2 жил болж байна, 7 цаг унтсан", { sleep_hours: 7 }, "literal"],
  ["exercise", "en", "3 times on the bike, 40 minutes", { exercise_min: 40 }, "literal"],
];

const valuesOf = (records: Array<{ key: KpiKey; value: unknown }>) =>
  Object.fromEntries(records.map((r) => [r.key, r.value])) as Partial<Record<KpiKey, number>>;

describe.each(ROWS)("%s (%s): %j", (id, lang, text, expected, how) => {
  const q = getQuestion(id);
  const r = interpretAnswer(q, text, lang);

  it(`records ${JSON.stringify(expected)}`, () => {
    expect(r.unclear).toBe(false);
    expect(valuesOf(r.records)).toEqual(expected);
  });

  it(how === "assumed" ? "with lower confidence, and says the assumption" : "literally, with full confidence", () => {
    const ack = askQuestion(q, lang, r.records);
    for (const rec of r.records) {
      expect(text.includes(rec.sourceText)).toBe(true);
      if (how === "assumed") expect(rec.confidence).toBeLessThanOrEqual(0.7);
      else expect(rec.confidence).toBe(0.9);
    }
    const check = lang === "mn" ? /Буруу бол хэлээрэй/u : /Tell me if that's not right/u;
    // a bare "литр" is one litre: a guess (lower confidence), but nothing to explain
    if (how === "assumed" && text !== "литр") expect(ack).toMatch(check);
    else expect(ack).not.toMatch(check);
  });

  it("passes the number cross-check against its own words", () => {
    for (const rec of r.records) {
      expect(crossCheckNumber(rec.key, rec.value as number, rec.sourceText), `${rec.key} ${rec.value} from "${rec.sourceText}"`).not.toBe("mismatch");
    }
  });
});

describe("the acknowledgement names the reading", () => {
  const ack = (id: QuestionId, lang: Lang, text: string) => askQuestion(getQuestion(id), lang, interpretAnswer(getQuestion(id), text, lang).records);

  it("glasses: the volume and the size of a glass", () => {
    expect(ack("water", "en", "3 glasses")).toMatch(/^Got it, about 750 millilitres, counting a glass as 250 ml\. Tell me if that's not right\./u);
    expect(ack("water", "mn", "гурван аяга ус")).toMatch(/^Ойлголоо, гурван аяга буюу ойролцоогоор 750 миллилитр гэж тооцлоо \(нэг аяга 250 мл\)\./u);
  });

  it("a range: the middle and the words", () => {
    expect(ack("sleep", "en", "six or seven")).toMatch(/^Got it, 6\.5 hours, the middle of six or seven\./u);
    expect(ack("sleep", "mn", "6-7 цаг")).toMatch(/^Ойлголоо, 6-7 цаг гэснийг дунджаар 6\.5 цаг гэж авлаа\./u);
  });

  it("mmol/L and Fahrenheit", () => {
    expect(ack("glucose", "en", "5.5")).toMatch(/99 milligrams per decilitre, reading 5\.5 as mmol per litre/u);
    expect(ack("temperature", "mn", "98.6")).toMatch(/^Ойлголоо, 98\.6 фаренгейт буюу 37 хэм гэж тооцлоо\./u);
    expect(ack("glucose", "mn", "5,4")).toMatch(/^Ойлголоо, 5\.4 ммоль\/л буюу 97 mg\/dL гэж тооцлоо\. Буруу бол хэлээрэй\./u);
  });

  it("a literal answer is acknowledged as before", () => {
    expect(ack("water", "en", "1500 ml")).toBe("Got it, 1500 millilitres. How much water have you had today, in millilitres?");
  });

  it("an explicit mmol/L reading is converted and named, without asking to check", () => {
    expect(ack("glucose", "en", "5.5 mmol")).toMatch(/^Got it, 99 milligrams per decilitre, from 5\.5 mmol per litre\. What is/u);
  });
});

describe("still asks again when nothing sensible can be read", () => {
  it.each<[QuestionId, Lang, string]>([
    ["water", "en", "50"],
    ["water", "en", "2 bags"],
    ["water", "mn", "2 уут"],
    ["sleep", "en", "11 to 6"],
    ["sleep", "en", "I slept at 11"],
    ["glucose", "en", "20"],
    ["temperature", "en", "50"],
    ["heart_rate", "en", "hmm banana"],
    // review fixes: an age is never a pulse; a wide span is the normal range quoted, not a reading
    ["heart_rate", "en", "what's a normal heart rate for a 30 year old?"],
    ["heart_rate", "mn", "30 настай хүний пульс хэд байх ёстой вэ?"],
    ["heart_rate", "en", "aged 45, what should it be?"],
    ["heart_rate", "en", "60 to 100"],
  ])("%s (%s): %j", (id, lang, text) => {
    expect(interpretAnswer(getQuestion(id), text, lang).records).toEqual([]);
  });

  it("the re-ask carries an example of an answer that works", () => {
    expect(clarify(getQuestion("water"), "en", "unclear", 0)).toMatch(/For example: 1500 ml, 2 litres or 6 glasses\./u);
    expect(clarify(getQuestion("water"), "mn", "unclear", 0)).toMatch(/Жишээ нь: 1500 мл, 2 литр эсвэл 6 аяга\./u);
  });
});

describe("readContainers", () => {
  it("never reads 'шилжих' (to shift) as a bottle", () => {
    expect(readContainers("шингэн толгой руу шилжсэн")).toEqual([]);
  });

  it("a bare plural has no count", () => {
    expect(readContainers("I drank some glasses")).toEqual([]);
  });
});
