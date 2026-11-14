import { describe, expect, it } from "vitest";
import { answerAskedQuestion, detectAskedQuestion, questionFacts } from "@/server/agent/questions";

describe("detectAskedQuestion: Mongolian", () => {
  it.each([
    ["Хэд байх ёстой вэ?", "normal"],
    ["цусны сахар хэд байх ёстой юм", "normal"],
    ["хэвийн нь хэд вэ", "normal"],
    ["Яагаад үүнийг асуугаад байгаа юм бэ?", "why"],
    ["Яаж хэмжих вэ?", "how"],
    ["Дахиад хэлээч", "repeat"],
    ["юу гэсэн бэ", "repeat"],
    ["Сансарт өнөөдөр цаг агаар ямар вэ?", "other"],
  ] as const)("%s -> %s", (text, kind) => {
    expect(detectAskedQuestion(text, "mn")).toBe(kind);
  });

  it.each(["Үгүй, юу ч байхгүй", "Тав хагас цаг унтсан", "дөрөв", "Тод байна", "мэдэхгүй"])(
    "is not a question: %s",
    (text) => {
      expect(detectAskedQuestion(text, "mn")).toBeNull();
    },
  );
});

describe("detectAskedQuestion: English", () => {
  it.each([
    ["What should my blood sugar be?", "normal"],
    ["what's a normal pulse", "normal"],
    ["Why do you need that?", "why"],
    ["How do I measure it?", "how"],
    ["Sorry, can you repeat that?", "repeat"],
    ["What's the weather like on the station today?", "other"],
  ] as const)("%s -> %s", (text, kind) => {
    expect(detectAskedQuestion(text, "en")).toBe(kind);
  });

  it.each(["Sixty eight.", "I slept about six hours", "No headache, no dizziness", "clear"])(
    "is not a question: %s",
    (text) => {
      expect(detectAskedQuestion(text, "en")).toBeNull();
    },
  );
});

describe("answerAskedQuestion", () => {
  const baselines = { glucose_mgdl: { mean: 96.4, sd: 6, n: 14 }, bp_systolic: { mean: 118.2, sd: 4, n: 14 }, bp_diastolic: { mean: 76.6, sd: 3, n: 14 } };

  it("answers 'what should my blood sugar be' with the demo range and the personal average, in Mongolian", () => {
    const a = answerAskedQuestion("normal", "glucose", "mn", baselines);
    expect(a).toContain("70");
    expect(a).toContain("140");
    expect(a).toContain("96");
    expect(a).toMatch(/демо параметр/iu);
    expect(a).not.toMatch(/уучлаарай/iu);
  });

  it("answers the same in English, and says it is not a medical judgement", () => {
    const a = answerAskedQuestion("normal", "glucose", "en", baselines);
    expect(a).toMatch(/70-140/);
    expect(a).not.toMatch(/·/); // no card-only "· demo parameter" suffix inside the sentence
    expect(a).toContain("96");
    expect(a).toMatch(/not a medical judgement/i);
  });

  it("gives both blood pressure numbers", () => {
    const a = answerAskedQuestion("normal", "blood_pressure", "en", baselines);
    expect(a).toMatch(/100-129/);
    expect(a).toMatch(/60-84/);
    expect(a).toMatch(/118 .*over 77|118 mmHg over 77/);
  });

  it("works without a baseline (no history yet)", () => {
    const a = answerAskedQuestion("normal", "heart_rate", "mn", {});
    expect(a).toContain("50");
    expect(a).not.toMatch(/дундаж/u);
  });

  it("has a why and a how for every question, in both languages", () => {
    const ids = ["sleep", "mood", "symptoms", "blood_pressure", "heart_rate", "temperature", "glucose", "water", "exercise", "vision", "workload", "day_note"] as const;
    for (const id of ids) {
      for (const lang of ["mn", "en"] as const) {
        expect(answerAskedQuestion("why", id, lang, {}).length).toBeGreaterThan(20);
        expect(answerAskedQuestion("how", id, lang, {}).length).toBeGreaterThan(15);
        expect(questionFacts(id, lang, {}).length).toBeGreaterThan(20);
      }
    }
  });
});
