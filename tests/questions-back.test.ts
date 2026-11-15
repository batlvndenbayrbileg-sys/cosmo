import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectAskedQuestion, isHealthTopic, questionTopicOf } from "@/server/agent/questions";
import { isGeneralQuestion, isSaneAskedAnswer, isSaneReply } from "@/server/agent/turn";
import { setClockForTests } from "@/server/clock";
import { assistantText, ctxOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/** Found in a live replay (2026-11-15): Cosmo set questions aside instead of answering them. */
describe("questions back: detection", () => {
  it("'юу гэсэн үг вэ' (what does it mean) is a question, not a request to repeat", () => {
    expect(detectAskedQuestion("Миний цусны шинжилгээ юу гэсэн үг вэ?", "mn")).toBe("other");
    expect(detectAskedQuestion("Юу гэсэн бэ?", "mn")).toBe("repeat");
  });

  it("'...х ёстой' (should ...) asks what is normal", () => {
    expect(detectAskedQuestion("Хэдэн цаг унтах ёстой вэ?", "mn")).toBe("normal");
    expect(detectAskedQuestion("Хэдэн литр ус уух ёстой вэ?", "mn")).toBe("normal");
  });

  it("the topic a question names, whatever question is open", () => {
    expect(questionTopicOf("How many hours should I sleep?")).toBe("sleep");
    expect(questionTopicOf("Хэдэн цаг унтах ёстой вэ?")).toBe("sleep");
    expect(questionTopicOf("What should my blood pressure be?")).toBe("blood_pressure");
    expect(questionTopicOf("How fast is the station moving?")).toBeNull();
  });

  it("health topics, in both languages", () => {
    expect(isHealthTopic("What should my blood sugar be?")).toBe(true);
    expect(isHealthTopic("Цусны даралт хэд байх ёстой вэ?")).toBe(true);
    expect(isHealthTopic("How fast is the station moving?")).toBe(false);
    expect(isHealthTopic("Сарнаас дэлхий хүртэл хэр хол вэ?")).toBe(false);
    // "тун сайн" (very good) is not a health word
    expect(isHealthTopic("Тун сайн байна")).toBe(false);
  });
});

describe("questions back: numbers in the answer", () => {
  it("a general question may be answered with general-knowledge numbers", () => {
    const answer = "The station moves at about 28,000 km/h and circles Earth every 90 minutes.";
    expect(isGeneralQuestion("How fast is the station moving?", answer)).toBe(true);
    expect(isSaneAskedAnswer(answer, "", "How fast is the station moving?", "How many minutes did you exercise?")).toBe(true);
    expect(isSaneReply(`${answer} Shall we start?`, { userText: "How fast is the station moving?", recorded: {}, question: null })).toBe(true);
  });

  it("a health question keeps every number tied to the data", () => {
    const invented = "Normal blood sugar is 70 to 100.";
    expect(isGeneralQuestion("What should my blood sugar be?", invented)).toBe(false);
    expect(isSaneAskedAnswer(invented, "", "What should my blood sugar be?", "What is your blood sugar?")).toBe(false);
  });

  it("a general question whose answer drifts into health keeps the strict rule", () => {
    expect(isGeneralQuestion("How far is the Moon?", "Far enough that your heart rate rises to 120.")).toBe(false);
  });
});

describe("questions back: live flow (rules only)", () => {
  beforeEach(async () => {
    setClockForTests(TEST_TODAY);
    await freshSeededDb();
  });
  afterEach(() => setClockForTests(null));

  it("after the proposal, a question is answered and the proposal stands; it is not taken for a yes", async () => {
    const id = await startCheckIn("bat", "mn");
    await playTurn("bat", id, "Сайн байна, гайгүй");
    await playTurn("bat", id, "Өнөөдөр ажил их байна");
    expect((await ctxOf("bat", id)).proposed).toBe(true);
    await playTurn("bat", id, "Сансрын станц хэр хурдан нисч байна вэ?");
    expect((await ctxOf("bat", id)).state).toBe("SMALL_TALK");
    await playTurn("bat", id, "эхэлье");
    expect((await ctxOf("bat", id)).state).toBe("KPI_CAPTURE");
  });

  it("'how many hours should I sleep?' while another question is open is answered for sleep", async () => {
    const id = await startCheckIn("alex", "en");
    for (const line of ["fine", "let's start"]) await playTurn("alex", id, line);
    const before = await ctxOf("alex", id);
    expect(before.state).toBe("KPI_CAPTURE");
    // Alex's sensors show a higher blood pressure: the follow-up comes first; "nothing special" moves on to the mood
    await playTurn("alex", id, "no, nothing special");
    const ev = await playTurn("alex", id, "How many hours should I sleep?");
    expect(assistantText(ev)).toMatch(/sleep of ≥ 7 h counts as normal/i);
    expect(assistantText(ev)).toMatch(/how are you feeling today, from 1 to 5\?$/i);
  });

  it("'what does my blood panel mean?' mid check-in is answered by Signature Triage, then the open question again", async () => {
    const id = await startCheckIn("alex", "en");
    for (const line of ["fine", "let's start"]) await playTurn("alex", id, line);
    const ev = await playTurn("alex", id, "What does my blood panel mean?");
    const text = assistantText(ev);
    expect(text).toMatch(/Decision support, not a diagnosis\./);
    // the open question is the sensor follow-up (Alex's blood pressure reads higher than usual)
    expect(text).toMatch(/Did you exercise, or are you feeling stressed or unwell\?$/);
    expect((await ctxOf("alex", id)).state).toBe("KPI_CAPTURE");
  });

  it("the same in Mongolian", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of ["гайгүй", "эхэлье"]) await playTurn("bat", id, line);
    const text = assistantText(await playTurn("bat", id, "Миний цусны шинжилгээ юу гэсэн үг вэ?"));
    expect(text).toMatch(/онош биш\./u);
    expect(text).not.toMatch(/^Дахиад асууя/u);
  });
});
