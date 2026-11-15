import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lang, TurnEvent } from "@/lib/types";
import { setClockForTests } from "@/server/clock";
import { setSensorFeedForTests } from "@/server/checkin/sensors";
import { askedQuestionReply, isSaneAskedAnswer } from "@/server/agent/turn";
import { SPOKEN_ANSWERS, assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * "Jarvis" behaviour (team feedback 2026-11-15): while Cosmo waits for a value, a question back is answered and the open
 * question is asked again, instead of "Sorry, I didn't catch that". Driven through the real turn pipeline (rule-based
 * agent, in-memory database).
 */

beforeEach(async () => {
  // these walk to a measurement question, asked only without a sensor feed (a crew member without a wearable)
  setSensorFeedForTests(false);
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
});
afterEach(() => {
  setClockForTests(null);
  setSensorFeedForTests(null);
});

const TO_GLUCOSE: Record<Lang, string[]> = {
  en: ["Hi Cosmo", "let's start", ...SPOKEN_ANSWERS.en, "6.5 hours", "124 over 82", "68", "36.7"],
  mn: ["Сайн уу", "эхэлье", ...SPOKEN_ANSWERS.mn, "6 цаг хагас", "124 дээр 82", "68", "36.7"],
};

async function atGlucose(lang: Lang): Promise<string> {
  const id = await startCheckIn("bat", lang);
  for (const line of TO_GLUCOSE[lang]) await playTurn("bat", id, line);
  return id;
}

function clarifications(events: TurnEvent[]) {
  return eventsOf(events, "clarification");
}

describe.each<[Lang, string, RegExp]>([
  ["en", "What should my blood sugar be?", /blood glucose/i],
  ["mn", "Цусны сахар хэд байх ёстой вэ?", /Цусны сахар хэд байна/u],
])("question asked back (%s)", (lang, question, reask) => {
  it("answers with the demo range, asks the same question again, and counts no failed attempt", async () => {
    const id = await atGlucose(lang);
    expect((await ctxOf("bat", id)).state).toBe("KPI_CAPTURE");
    const before = await ctxOf("bat", id);

    const events = await playTurn("bat", id, question);
    const text = assistantText(events);
    expect(text).toContain("70");
    expect(text).toContain("140");
    expect(text).toMatch(reask);
    expect(text).not.toMatch(/sorry|didn't catch|уучлаарай|сонссонгүй/iu);
    expect(clarifications(events)).toEqual([]);
    expect(eventsOf(events, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "glucose" });

    const after = await ctxOf("bat", id);
    expect(after.clarifyCount).toEqual(before.clarifyCount);

    // and the value given next is recorded as usual
    const next = await playTurn("bat", id, "98");
    expect(eventsOf(next, "measurement").map((e) => [e.key, e.value])).toEqual([["glucose_mgdl", 98]]);
  });
});

describe("question asked back: other kinds", () => {
  it("'why do you ask' gets the reason, then the question", async () => {
    const id = await atGlucose("en");
    const text = assistantText(await playTurn("bat", id, "Why do you need that?"));
    expect(text).toMatch(/food and exercise/i);
    expect(text).toMatch(/What is your blood glucose/i);
  });

  it("'say it again' repeats the question", async () => {
    const id = await atGlucose("mn");
    const text = assistantText(await playTurn("bat", id, "дахиад хэлээч"));
    expect(text).toMatch(/Цусны сахар хэд байна/u);
  });

  it("a plain unclear answer (not a question) still gets the clarification", async () => {
    const id = await atGlucose("en");
    const events = await playTurn("bat", id, "hmm banana");
    expect(clarifications(events).length).toBeGreaterThan(0);
  });
});

describe("askedQuestionReply / isSaneAskedAnswer", () => {
  const baselines = { glucose_mgdl: { mean: 96, sd: 5, n: 14 } };

  it("takes a model answer whose numbers come from the facts, then re-asks", () => {
    const reply = askedQuestionReply(
      { kind: "normal", answer: "For this demo, 70 to 140 mg/dL counts as normal, and your average is 96. What is your blood glucose?" },
      "normal",
      "glucose",
      "en",
      baselines,
      "what should it be?",
    );
    expect(reply).toBe("For this demo, 70 to 140 mg/dL counts as normal, and your average is 96. What is your blood glucose, in mg/dL?");
  });

  it("refuses a model answer with an invented number and falls back to the registry answer", () => {
    const reply = askedQuestionReply(
      { kind: "normal", answer: "Healthy people are around 85 to 99. What is your blood glucose?" },
      "normal",
      "glucose",
      "en",
      baselines,
      "what should it be?",
    );
    expect(reply).not.toContain("85");
    expect(reply).toMatch(/70-140/);
  });

  it("returns null when the model only re-asked and the words were not a question", () => {
    expect(askedQuestionReply({ kind: "other", answer: "What is your blood glucose?" }, null, "glucose", "en", baselines, "hmm")).toBeNull();
  });

  it("rejects diagnosis words and long answers", () => {
    expect(isSaneAskedAnswer("You may need medication for that.", "70-140", "", "")).toBe(false);
    expect(isSaneAskedAnswer("a ".repeat(200), "", "", "")).toBe(false);
  });
});
