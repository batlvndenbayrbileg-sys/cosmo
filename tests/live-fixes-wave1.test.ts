import { describe, expect, it } from "vitest";
import { getQuestion } from "@/lib/kpi/registry";
import { interpretAnswer } from "@/server/agent/interpret";
import { questionTopicOf } from "@/server/agent/questions";
import { missingNotice } from "@/server/agent/turn";

/** Found in the live Mongolian replay after wave 1 (2026-11-15). */
describe("live fixes after wave 1", () => {
  it("'120 дээр 80' at another question is blood pressure, never a pulse of 120", () => {
    for (const [q, text] of [
      ["heart_rate", "120 дээр 80"],
      ["heart_rate", "120 over 80"],
      ["temperature", "120/80"],
      ["glucose", "130 дээр 85 байсан"],
    ] as const) {
      const r = interpretAnswer(getQuestion(q), text, "mn");
      expect(r.records.map((x) => x.key).sort()).toEqual(["bp_diastolic", "bp_systolic"]);
    }
    // a plain pulse and a mood like "4/5" are untouched
    expect(interpretAnswer(getQuestion("heart_rate"), "85", "mn").records.map((x) => [x.key, x.value])).toEqual([["heart_rate", 85]]);
    expect(interpretAnswer(getQuestion("mood"), "4/5", "en").records.map((x) => x.key)).toEqual(["mood"]);
  });

  it("'пульс' names the heart-rate question", () => {
    expect(questionTopicOf("пульс 85 хэвийн үү?")).toBe("heart_rate");
    expect(questionTopicOf("what's a normal heartbeat?")).toBe("heart_rate");
  });

  it("the Mongolian missing-values notice starts with a capital letter", () => {
    expect(missingNotice({ skipped: ["symptoms", "blood_pressure"], filled: [] }, "mn")).toMatch(/^Шинж тэмдгийн/u);
  });
});
