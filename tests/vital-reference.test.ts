import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lang } from "@/lib/types";
import {
  GLUCOSE_MGDL,
  REFERENCE_NOTES,
  TEMPERATURE_F,
  VITAL_SIGNS,
  referenceBand,
  referenceSentence,
} from "@/lib/health/vitalReference";
import { answerReferenceQuestion, questionFacts, referenceQuestionTopic } from "@/server/agent/questions";
import { buildResultsFacts, numeralsAreGrounded } from "@/server/agent/resultsFacts";
import { setClockForTests } from "@/server/clock";
import { assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * General resting-adult reference ranges (team request 2026-11-15: "it should know the general normal ranges, not only
 * compare with the person's own past, and answer when asked"): data/reference/vital_signs_reference.xlsx ->
 * src/data/vital_reference.json -> src/lib/health/vitalReference.ts, answered at any point of the check-in.
 */

describe("vital_reference.json", () => {
  it("holds the workbook's rows", () => {
    expect(VITAL_SIGNS.heart_rate).toMatchObject({ normalLow: 60, normalHigh: 100, dangerBelow: 40, dangerAbove: 130 });
    expect(VITAL_SIGNS.bp_systolic).toMatchObject({ normalHigh: 120, dangerBelow: 90, dangerAbove: 180 });
    expect(VITAL_SIGNS.bp_diastolic).toMatchObject({ normalHigh: 80, dangerAbove: 120 });
    expect(VITAL_SIGNS.breathing_rate).toMatchObject({ normalLow: 12, normalHigh: 20, dangerBelow: 8, dangerAbove: 25 });
    expect(VITAL_SIGNS.spo2).toMatchObject({ normalLow: 95, normalHigh: 100, dangerBelow: 90 });
    expect(VITAL_SIGNS.temperature).toMatchObject({ normalLow: 36.1, normalHigh: 37.2, dangerBelow: 35, dangerAbove: 39.5 });
    expect(VITAL_SIGNS.glucose).toMatchObject({ unit: "mmol/L", normalLow: 3.9, normalHigh: 5.5, dangerBelow: 3, dangerAbove: 16.7 });
    expect(REFERENCE_NOTES.some((n) => /not a diagnosis/i.test(n))).toBe(true);
  });

  it("the mg/dL and °F constants are the ones the workbook's note column names", () => {
    const g = VITAL_SIGNS.glucose.note ?? "";
    expect(g).toContain(`${GLUCOSE_MGDL.normalLow}–${GLUCOSE_MGDL.normalHigh} mg/dL`);
    expect(g).toContain(`below ${GLUCOSE_MGDL.dangerBelow} mg/dL`);
    expect(g).toContain(`above ${GLUCOSE_MGDL.dangerAbove} mg/dL`);
    const t = VITAL_SIGNS.temperature.note ?? "";
    expect(t).toContain(`${TEMPERATURE_F.normalLow}–${TEMPERATURE_F.normalHigh} °F`);
    expect(t).toContain(`above ${TEMPERATURE_F.dangerAbove} °F`);
    expect(t).toContain(`below ${TEMPERATURE_F.dangerBelow} °F`);
  });
});

describe("referenceSentence / referenceBand", () => {
  it.each<[Parameters<typeof referenceSentence>[0], RegExp]>([
    ["heart_rate", /60-100 beats per minute.*below 40 or above 130/],
    ["blood_pressure", /below 120 over 80.*180 over 120/],
    ["breathing_rate", /12-20 times a minute.*below 8 or above 25/],
    ["spo2", /95-100%.*below 92.*below 90/],
    ["temperature", /36\.1-37\.2 degrees Celsius \(97-99 °F\).*above 39\.5 or below 35/],
    ["glucose", /70-99 mg\/dL \(3\.9-5\.5 mmol\/L\).*below 54 or above 300/],
  ])("%s", (topic, re) => {
    expect(referenceSentence(topic, "en")).toMatch(re);
    expect(referenceSentence(topic, "mn")).toMatch(/[А-Яа-яӨөҮү]/u);
  });

  it("bands", () => {
    expect(referenceBand("heart_rate", 72)).toBe("normal");
    expect(referenceBand("heart_rate", 105)).toBe("outside");
    expect(referenceBand("heart_rate", 135)).toBe("danger");
    expect(referenceBand("blood_pressure", 118, 76)).toBe("normal");
    expect(referenceBand("blood_pressure", 124, 82)).toBe("outside");
    expect(referenceBand("blood_pressure", 182, 100)).toBe("danger");
    expect(referenceBand("blood_pressure", 150, 121)).toBe("danger");
    expect(referenceBand("spo2", 91)).toBe("outside");
    expect(referenceBand("spo2", 88)).toBe("danger");
    expect(referenceBand("glucose", 95)).toBe("normal");
    expect(referenceBand("glucose", 50)).toBe("danger");
    expect(referenceBand("temperature", 36.7)).toBe("normal");
    expect(referenceBand("temperature", 40)).toBe("danger");
  });
});

describe("referenceQuestionTopic", () => {
  it.each<[string, Lang, string]>([
    ["What is a normal heart rate?", "en", "heart_rate"],
    ["зүрхний цохилт хэд байх ёстой вэ?", "mn", "heart_rate"],
    ["Пульс хэвийн нь хэд вэ?", "mn", "heart_rate"],
    ["Is 85 a good pulse?", "en", "heart_rate"],
    ["what should my blood pressure be?", "en", "blood_pressure"],
    ["Цусны даралт хэд байвал хэвийн бэ?", "mn", "blood_pressure"],
    ["What should my oxygen saturation be?", "en", "spo2"],
    ["Хүчилтөрөгч хэд байх ёстой вэ?", "mn", "spo2"],
    ["how many breaths a minute is normal?", "en", "breathing_rate"],
    ["Хэвийн температур хэд вэ?", "mn", "temperature"],
    ["Is my blood sugar ok?", "en", "glucose"],
  ])("%s -> %s", (text, lang, topic) => {
    expect(referenceQuestionTopic(text, lang)).toBe(topic);
  });

  it.each<[string, Lang]>([
    ["my blood pressure is normal today", "en"],
    ["Why do you need my pulse?", "en"],
    ["How do I measure my blood pressure?", "en"],
    ["What's the weather like on the station?", "en"],
    ["Пульс 68", "mn"],
  ])("%s -> not a reference question", (text, lang) => {
    expect(referenceQuestionTopic(text, lang)).toBeNull();
  });
});

describe("answerReferenceQuestion", () => {
  const baselines = { heart_rate: { mean: 64.2, sd: 3, n: 14 } };

  it("the general range, the person's own average and the caveat", () => {
    const a = answerReferenceQuestion("What is a normal heart rate?", "en", { baselines, today: {} });
    expect(a?.text).toMatch(/60-100 beats per minute/);
    expect(a?.text).toMatch(/Your own 14-day average is 64 bpm/);
    expect(a?.text).toMatch(/not a diagnosis/);
  });

  it("judges the number in the question, or today's value", () => {
    expect(answerReferenceQuestion("Is 85 a good pulse?", "en", { baselines, today: {} })?.text).toMatch(/85 bpm: which is within that general range/);
    expect(answerReferenceQuestion("is my pulse ok?", "en", { baselines, today: { heart_rate: 135 } })?.text).toMatch(
      /Today you told me 135 bpm, which is past the urgent threshold/,
    );
    // "2 hours" is not a pulse: today's value is judged instead
    expect(answerReferenceQuestion("is my pulse ok after 2 hours of exercise?", "en", { baselines, today: { heart_rate: 70 } })?.text).toMatch(
      /Today you told me 70 bpm/,
    );
  });

  it("in Mongolian", () => {
    const a = answerReferenceQuestion("зүрхний цохилт хэд байх ёстой вэ?", "mn", { baselines, today: {} });
    expect(a?.text).toMatch(/минутад 60-100 бол хэвийн/u);
    expect(a?.text).toMatch(/онош биш/u);
  });

  it("the model may quote the general numbers: they are in the facts", () => {
    expect(questionFacts("heart_rate", "en", {})).toMatch(/60-100/);
    const facts = buildResultsFacts({ heart_rate: 70 }, [], "en");
    expect(numeralsAreGrounded("A resting heart rate of 60-100 is normal; yours was 70.", facts, "what is normal?")).toBe(true);
  });
});

/* ───────────── through the turn pipeline (rule-based agent, in-memory database) ───────────── */

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
});
afterEach(() => setClockForTests(null));

const FLOW: Record<Lang, string[]> = {
  en: ["Hi Cosmo", "let's start", "6.5 hours", "4", "no headache, no dizziness, no nausea", "124 over 82", "68", "36.7", "98", "1500 ml", "40 minutes", "clear", "3", "nothing", "yes"],
  mn: ["Сайн уу", "эхэлье", "6 цаг хагас", "дөрөв", "толгой өвдөхгүй, эргэхгүй, дотор муухайрахгүй", "124 дээр 82", "68", "36.7", "98", "1500 мл", "40 минут", "тод", "3", "үгүй", "тийм"],
};

describe("asked at any point", () => {
  it("in small talk: answered, never set aside", async () => {
    const id = await startCheckIn("bat", "en");
    const text = assistantText(await playTurn("bat", id, "What is a normal heart rate?"));
    expect(text).toMatch(/60-100 beats per minute/);
    expect(text).not.toMatch(/after the check-in/i);
  });

  it("mid check-in, about a vital the check-in does not ask (oxygen): answered, then the open question again", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of FLOW.mn.slice(0, 2)) await playTurn("bat", id, line);
    const events = await playTurn("bat", id, "Хүчилтөрөгч хэд байх ёстой вэ?");
    const text = assistantText(events);
    expect(text).toMatch(/95-100%/);
    expect(text).toMatch(/Хэдэн цаг унтсан бэ\?$/u);
    expect(eventsOf(events, "clarification")).toEqual([]);
    expect((await ctxOf("bat", id)).state).toBe("KPI_CAPTURE");
  });

  it("mid check-in, about the open question: the general range and the demo band, then the question", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of FLOW.en.slice(0, 6)) await playTurn("bat", id, line);
    const text = assistantText(await playTurn("bat", id, "what's a normal pulse?"));
    expect(text).toMatch(/60-100 beats per minute/);
    expect(text).toMatch(/demo parameter band is 50-90 bpm/);
    expect(text).toMatch(/What is your pulse\?$/);
  });

  it("'is 85 a good pulse?' while the pulse is asked: recorded, and the question answered before the next one", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of FLOW.en.slice(0, 6)) await playTurn("bat", id, line);
    const events = await playTurn("bat", id, "is 85 a good pulse?");
    expect(eventsOf(events, "measurement").map((e) => [e.key, e.value])).toEqual([["heart_rate", 85]]);
    expect(assistantText(events)).toMatch(
      /^Got it, 85 beats per minute\. For a resting adult, a heart rate of 60-100 .* 85 bpm: which is within that general range\. What is your body temperature\?$/u,
    );
  });

  it.each<Lang>(["en", "mn"])("after the check-in (%s), offline: the general range and today's value", async (lang) => {
    const id = await startCheckIn("bat", lang);
    for (const line of FLOW[lang]) await playTurn("bat", id, line);
    expect((await ctxOf("bat", id)).state).toBe("DONE");
    const q = lang === "en" ? "Is my blood pressure ok?" : "Миний даралт хэвийн үү?";
    const text = assistantText(await playTurn("bat", id, q));
    expect(text).toMatch(lang === "en" ? /below 120 over 80/ : /120 дээр 80-аас доош/u);
    expect(text).toMatch(lang === "en" ? /Today you told me 124 over 82, which is outside that general range/ : /Өнөөдөр 124 дээр 82 гэж хэлсэн/u);
  });
});

describe("loose answers through the pipeline", () => {
  it("'3 glasses' at the water question is recorded as 750 ml and said out loud", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of FLOW.en.slice(0, 9)) await playTurn("bat", id, line);
    const events = await playTurn("bat", id, "3 glasses");
    expect(eventsOf(events, "measurement").map((e) => [e.key, e.value])).toEqual([["water_ml", 750]]);
    expect(assistantText(events)).toMatch(/^Got it, about 750 millilitres, counting a glass as 250 ml\. Tell me if that's not right\. How many minutes/u);
  });

  it("'литр' at the water question is one litre", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of FLOW.mn.slice(0, 9)) await playTurn("bat", id, line);
    const events = await playTurn("bat", id, "литр");
    expect(eventsOf(events, "measurement").map((e) => [e.key, e.value])).toEqual([["water_ml", 1000]]);
    expect(eventsOf(events, "clarification")).toEqual([]);
  });

  it("'6-7 цаг' at the sleep question is 6.5 hours, said out loud", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of FLOW.mn.slice(0, 2)) await playTurn("bat", id, line);
    const events = await playTurn("bat", id, "6-7 цаг");
    expect(eventsOf(events, "measurement").map((e) => [e.key, e.value])).toEqual([["sleep_hours", 6.5]]);
    expect(assistantText(events)).toMatch(/6-7 цаг гэснийг дунджаар 6\.5 цаг гэж авлаа\. Буруу бол хэлээрэй\./u);
  });
});
