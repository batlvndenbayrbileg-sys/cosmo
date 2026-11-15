import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lang, SummaryFindings, TurnEvent } from "@/lib/types";
import type { Agent, AgentDecision, CompanionReplyArgs } from "@/server/agent/agent";
import { ScriptedAgent } from "@/server/agent/scriptedAgent";
import { DEMO_SCRIPTS } from "@/server/agent/scripts";
import { setClockForTests } from "@/server/clock";
import { setSensorFeedForTests } from "@/server/checkin/sensors";
import { listAlerts } from "@/server/db/repos/alert";
import { listMeasurements } from "@/server/db/repos/measurement";
import { SPOKEN_ANSWERS, assistantText, ctxOf, eventsOf, playTurn, startCheckIn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * Friend mode through the real turn pipeline (rule-based agent, in-memory database): the companion conversation starts
 * at any point of the check-in, records nothing, never counts as a failed answer, and leaving resumes exactly where the
 * check-in was. Crisis words get the code template and a red alert.
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

const GLUCOSE_PROMPT: Record<Lang, RegExp> = { en: /What is your blood glucose/i, mn: /Цусны сахар хэд байна/u };

async function atGlucose(lang: Lang): Promise<string> {
  const id = await startCheckIn("bat", lang);
  for (const line of TO_GLUCOSE[lang]) await playTurn("bat", id, line);
  return id;
}

async function measurementCount(id: string): Promise<number> {
  return (await listMeasurements("bat", id)).length;
}

function nothingRecorded(events: TurnEvent[]): void {
  expect(eventsOf(events, "measurement")).toEqual([]);
  expect(eventsOf(events, "clarification")).toEqual([]);
}

const ROBOTIC = /sorry,? I didn't catch|still didn't catch|уучлаарай, сайн сонссонгүй|дахин сайн сонссонгүй/iu;

describe.each<[Lang, string, string, string, string]>([
  ["en", "Can I talk to you?", "I feel really lonely up here", "I don't even know what to say", "let's continue"],
  ["mn", "чамтай ярилцаж болох уу", "би их ганцаардаж байна", "юу хэлэхээ ч мэдэхгүй нь", "за одоо үргэлжлүүлье"],
])("friend mode in the middle of the measurements (%s)", (lang, ask, share, more, leave) => {
  it("talks, records nothing, counts nothing, then resumes the same question", async () => {
    const id = await atGlucose(lang);
    const before = await ctxOf("bat", id);
    const stored = await measurementCount(id);
    expect(before).toMatchObject({ state: "KPI_CAPTURE", companion: false });

    const entered = await playTurn("bat", id, ask);
    nothingRecorded(entered);
    expect(assistantText(entered)).not.toMatch(ROBOTIC);
    expect(assistantText(entered)).not.toMatch(GLUCOSE_PROMPT[lang]);
    // while talking no question is open (the client hides question screens and offers a way back)
    expect(eventsOf(entered, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: null, companion: true });
    expect(await ctxOf("bat", id)).toMatchObject({ companion: true, companionTurns: 1, clarifyCount: before.clarifyCount });

    const shared = await playTurn("bat", id, share);
    nothingRecorded(shared);
    const supportive = assistantText(shared);
    expect(supportive.length).toBeGreaterThan(20);
    expect(supportive).not.toMatch(ROBOTIC);
    expect(supportive).not.toBe(assistantText(entered));

    const talk = await playTurn("bat", id, more);
    nothingRecorded(talk);
    expect(await measurementCount(id)).toBe(stored);

    const after = await ctxOf("bat", id);
    expect(after).toMatchObject({ state: "KPI_CAPTURE", companion: true, companionTurns: 3, clarifyCount: before.clarifyCount, skipped: before.skipped });

    const left = await playTurn("bat", id, leave);
    nothingRecorded(left);
    expect(assistantText(left)).toMatch(GLUCOSE_PROMPT[lang]);
    expect(eventsOf(left, "assistant")[0].emotion).toBe("happy");
    expect(eventsOf(left, "state")[0]).toMatchObject({ expectedQuestion: "glucose", companion: false });
    expect(await ctxOf("bat", id)).toMatchObject({ state: "KPI_CAPTURE", companion: false, clarifyCount: before.clarifyCount });

    // and the check-in goes on as before
    const next = await playTurn("bat", id, "98");
    expect(eventsOf(next, "measurement").map((e) => [e.key, e.value])).toEqual([["glucose_mgdl", 98]]);
  });

  it("a plain answer to the open question while talking ends the conversation and is recorded", async () => {
    const id = await atGlucose(lang);
    await playTurn("bat", id, ask);
    expect((await ctxOf("bat", id)).companion).toBe(true);

    const answered = await playTurn("bat", id, "98");
    expect(eventsOf(answered, "measurement").map((e) => [e.key, e.value])).toEqual([["glucose_mgdl", 98]]);
    expect(await ctxOf("bat", id)).toMatchObject({ state: "KPI_CAPTURE", companion: false, companionTurns: 0 });
    expect(eventsOf(answered, "state")[0]).toMatchObject({ companion: false });
    expect(eventsOf(answered, "state")[0].expectedQuestion).not.toBe("glucose");
  });
});

describe("friend mode at other points of the check-in", () => {
  it("in small talk: leaving proposes the measurements, and 'yes' starts them", async () => {
    const id = await startCheckIn("bat", "en");
    const entered = await playTurn("bat", id, "I'm feeling really stressed");
    expect(assistantText(entered)).toMatch(/stress/i);
    expect(await ctxOf("bat", id)).toMatchObject({ state: "GREETING", companion: true });

    const left = await playTurn("bat", id, "thanks, I'm good");
    expect(assistantText(left)).toMatch(/Shall we log today's measurements together\?/);
    expect(await ctxOf("bat", id)).toMatchObject({ state: "SMALL_TALK", proposed: true, companion: false });

    const start = await playTurn("bat", id, "yes");
    expect(eventsOf(start, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "mood" });
  });

  it("at the read-back: leaving reads the values back again", async () => {
    const lang: Lang = "en";
    setSensorFeedForTests(true); // the demo script meets the sensor feed
    const id = await startCheckIn("bat", lang);
    for (const line of DEMO_SCRIPTS[lang].lines) {
      if ((await ctxOf("bat", id)).state === "CONFIRM") break;
      await playTurn("bat", id, line.say);
    }
    expect((await ctxOf("bat", id)).state).toBe("CONFIRM");

    const entered = await playTurn("bat", id, "I need to talk");
    nothingRecorded(entered);
    expect(await ctxOf("bat", id)).toMatchObject({ state: "CONFIRM", companion: true });
    // a "yes" while talking does not confirm the check-in
    await playTurn("bat", id, "yes");
    expect(await ctxOf("bat", id)).toMatchObject({ state: "CONFIRM", companion: true });

    const left = await playTurn("bat", id, "back to the check-in");
    expect(assistantText(left)).toMatch(/Here is what you told me: .*Your sensor readings are saved too\. Is everything correct\?/);
    expect(await ctxOf("bat", id)).toMatchObject({ state: "CONFIRM", companion: false });
  });

  it.each<Lang>(["en", "mn"])("after the check-in, on the dashboard (%s)", async (lang) => {
    setSensorFeedForTests(true); // the demo script meets the sensor feed
    const id = await startCheckIn("bat", lang);
    for (const line of DEMO_SCRIPTS[lang].lines) await playTurn("bat", id, line.say);
    expect((await ctxOf("bat", id)).state).toBe("DONE");
    const stored = await measurementCount(id);

    const entered = await playTurn("bat", id, lang === "en" ? "I feel homesick" : "гэрээ их санаж байна");
    nothingRecorded(entered);
    expect(assistantText(entered)).toMatch(lang === "en" ? /home/i : /гэрээ санах/u);
    expect(eventsOf(entered, "state")[0]).toMatchObject({ state: "DONE", expectedQuestion: null });
    expect(await ctxOf("bat", id)).toMatchObject({ state: "DONE", companion: true });

    const left = await playTurn("bat", id, lang === "en" ? "thank you" : "болсон, баярлалаа");
    expect(assistantText(left)).toMatch(lang === "en" ? /dashboard/i : /самбар/u);
    expect(await ctxOf("bat", id)).toMatchObject({ state: "DONE", companion: false });
    expect(await measurementCount(id)).toBe(stored);
  });

  it("an ordinary feeling that answers the mood question is recorded, not a conversation", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of ["Hi Cosmo", "let's start"]) await playTurn("bat", id, line);
    expect(eventsOf(await playTurn("bat", id, "I feel down"), "measurement").map((e) => [e.key, e.value])).toEqual([["mood", 2]]);
    expect((await ctxOf("bat", id)).companion).toBe(false);
  });
});

describe("crisis words", () => {
  it.each<[Lang, string, RegExp]>([
    ["en", "I want to die", /crew medical officer or the flight surgeon right now/],
    ["mn", "үхмээр байна", /эмнэлгийн офицер эсвэл нислэгийн эмчтэйгээ яг одоо холбогдоорой/u],
  ])("get the crisis template and one red alert, mid-check-in (%s)", async (lang, words, template) => {
    const id = await atGlucose(lang);
    const stored = await measurementCount(id);

    const events = await playTurn("bat", id, words);
    nothingRecorded(events);
    expect(assistantText(events)).toMatch(template);
    expect(eventsOf(events, "assistant")[0].emotion).toBe("concerned");

    const alerts = (await listAlerts("bat")).filter((a) => a.checkInId === id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "red", id: `al-${id}-companion-self` });
    // the ground console never sees the crew member's own words
    expect(JSON.stringify(alerts[0].text)).not.toContain(words);
    expect(await ctxOf("bat", id)).toMatchObject({ state: "KPI_CAPTURE", companion: true, companionCrisis: true });

    // said again: still one alert (idempotent), still the template
    expect(assistantText(await playTurn("bat", id, words))).toMatch(template);
    expect((await listAlerts("bat")).filter((a) => a.checkInId === id)).toHaveLength(1);
    expect(await measurementCount(id)).toBe(stored);

    // the next supportive turn keeps pointing to the medical officer; leaving still resumes the question
    expect(assistantText(await playTurn("bat", id, lang === "en" ? "I don't know" : "мэдэхгүй"))).toMatch(lang === "en" ? /medical officer/ : /эмнэлгийн офицер/iu);
    expect(assistantText(await playTurn("bat", id, lang === "en" ? "let's continue" : "үргэлжлүүлье"))).toMatch(GLUCOSE_PROMPT[lang]);
  });

  it("work after the check-in too, and a medical emergency while talking raises its own alert", async () => {
    setSensorFeedForTests(true); // the demo script meets the sensor feed
    const id = await startCheckIn("bat", "en");
    for (const line of DEMO_SCRIPTS.en.lines) await playTurn("bat", id, line.say);
    const before = (await listAlerts("bat")).filter((a) => a.checkInId === id).length;

    expect(assistantText(await playTurn("bat", id, "can I talk to you?"))).not.toMatch(ROBOTIC);
    const medical = await playTurn("bat", id, "I have chest pain and I can't breathe");
    expect(assistantText(medical)).toMatch(/^This needs attention right away\./);
    const self = await playTurn("bat", id, "I don't want to live anymore");
    expect(assistantText(self)).toMatch(/taking this seriously/);

    const mine = (await listAlerts("bat")).filter((a) => a.checkInId === id);
    expect(mine).toHaveLength(before + 2);
    expect(mine.map((a) => a.id)).toEqual(expect.arrayContaining([`al-${id}-companion-medical`, `al-${id}-companion-self`]));
    expect((await ctxOf("bat", id)).state).toBe("DONE");
  });
});

/** the rule-based agent plus a fixed companion wording, standing in for the live model */
class WordingAgent implements Agent {
  readonly name = "claude" as const;
  readonly calls: CompanionReplyArgs[] = [];
  private readonly rules = new ScriptedAgent();
  constructor(
    private readonly wording: string,
    private readonly resultsAnswer: string | null = null,
  ) {}
  decide(args: Parameters<Agent["decide"]>[0]): Promise<AgentDecision> {
    return this.rules.decide(args);
  }
  async companionReply(args: CompanionReplyArgs): Promise<string | null> {
    this.calls.push(args);
    return this.wording;
  }
  async answerAboutResults(): Promise<string | null> {
    return this.resultsAnswer;
  }
}

describe("check-in answers are not swallowed by friend mode", () => {
  it("a yes with a feeling in it starts the measurements", async () => {
    const id = await startCheckIn("bat", "en");
    await playTurn("bat", id, "Hi Cosmo");
    const start = await playTurn("bat", id, "yes let's start, I'm a little stressed today");
    expect(eventsOf(start, "state")[0]).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "mood" });
    expect((await ctxOf("bat", id)).companion).toBe(false);
  });

  it("'listen, I slept 7 hours' records the sleep", async () => {
    const id = await startCheckIn("bat", "mn");
    for (const line of ["Сайн уу", "эхэлье", ...SPOKEN_ANSWERS.mn]) await playTurn("bat", id, line);
    const events = await playTurn("bat", id, "сонсооч, би 7 цаг унтсан");
    expect(eventsOf(events, "measurement").map((e) => [e.key, e.value])).toEqual([["sleep_hours", 7]]);
    expect((await ctxOf("bat", id)).companion).toBe(false);
  });

  it("an accident in the symptom answer is not a self-harm crisis and raises no alert", async () => {
    const id = await startCheckIn("bat", "en");
    for (const line of ["Hi Cosmo", "let's start", "4"]) await playTurn("bat", id, line);
    expect((await ctxOf("bat", id)).state).toBe("KPI_CAPTURE");
    const events = await playTurn("bat", id, "I hurt myself on the treadmill");
    expect(assistantText(events)).not.toMatch(/taking this seriously/);
    expect((await listAlerts("bat")).filter((a) => a.checkInId === id)).toEqual([]);
    expect((await ctxOf("bat", id)).companionCrisis).toBe(false);
  });

  it("a crisis alert does not stand in for the summary's symptom-word alert", async () => {
    const { createAlertsForCheckIn, raiseCrisisAlert } = await import("@/server/alerts");
    const id = await startCheckIn("bat", "en");
    await raiseCrisisAlert("bat", id, "self");
    const findings = {
      overall: "red",
      redFlags: [{ rule: "SERIOUS_SYMPTOM_WORD", keys: ["symptom_note"], text: { en: "Alert: your note mentions something.", mn: "Анхааруулга." } }],
    } as unknown as SummaryFindings;
    const created = await createAlertsForCheckIn("bat", id, findings);
    expect(created.map((a) => a.text.en)).toEqual(["Alert: your note mentions something."]);
    const mine = (await listAlerts("bat")).filter((a) => a.checkInId === id);
    expect(mine).toHaveLength(2);
    // and it stays idempotent
    expect(await createAlertsForCheckIn("bat", id, findings)).toHaveLength(1);
    expect((await listAlerts("bat")).filter((a) => a.checkInId === id)).toHaveLength(2);
  });
});

describe("dashboard answers from the model", () => {
  it.each(["Maybe ask the medical officer about Ambien for tonight.", "A magnesium supplement could help your sleep.", "That could be insomnia."])(
    "never name a drug, a supplement or a condition: %s",
    async (wording) => {
      setSensorFeedForTests(true); // the demo script meets the sensor feed
      const id = await startCheckIn("bat", "en");
      for (const line of DEMO_SCRIPTS.en.lines) await playTurn("bat", id, line.say);
      expect((await ctxOf("bat", id)).state).toBe("DONE");
      const text = assistantText(await playTurn("bat", id, "should I take a sleeping pill?", { agent: new WordingAgent("", wording) }));
      expect(text).not.toBe(wording);
      expect(text).toMatch(/dashboard/i);
    },
  );
});

describe("model wording in friend mode", () => {
  it("is used when it passes the checks, with the companion turn and the paused state", async () => {
    const id = await atGlucose("en");
    const agent = new WordingAgent("That sounds like a heavy day, and I'm glad you said it. What has been on your mind the most?");
    const events = await playTurn("bat", id, "I need to talk", { agent });
    expect(assistantText(events)).toBe("That sounds like a heavy day, and I'm glad you said it. What has been on your mind the most?");
    expect(agent.calls[0]).toMatchObject({ turn: 1, lang: "en", text: "I need to talk" });
    expect(agent.calls[0].ctx.state).toBe("KPI_CAPTURE");
  });

  it.each([
    "You might have depression, so ask for medication.",
    "Try a sleeping pill tonight.",
    "Үнэхээр хэцүү байна.",
    "a ".repeat(300),
  ])("falls back to the template when it does not: %s", async (wording) => {
    const id = await atGlucose("en");
    const text = assistantText(await playTurn("bat", id, "I feel lonely", { agent: new WordingAgent(wording) }));
    expect(text).not.toBe(wording);
    expect(text).toMatch(/lonely/i);
  });

  it("never words a crisis turn", async () => {
    const id = await atGlucose("en");
    const agent = new WordingAgent("I'm here for you, let's just keep chatting.");
    const text = assistantText(await playTurn("bat", id, "I want to kill myself", { agent }));
    expect(text).toMatch(/crew medical officer or the flight surgeon right now/);
    expect(agent.calls).toHaveLength(0);
  });

  it("after a crisis, wording that does not point to the medical officer is replaced by the after-crisis template", async () => {
    const id = await atGlucose("en");
    await playTurn("bat", id, "I want to die");
    const agent = new WordingAgent("I'm here for you, let's just keep chatting.");
    const text = assistantText(await playTurn("bat", id, "I don't know", { agent }));
    expect(agent.calls).toHaveLength(1);
    expect(text).not.toBe("I'm here for you, let's just keep chatting.");
    expect(text).toMatch(/medical officer|flight surgeon/);

    const pointing = new WordingAgent("I'm right here with you. Please reach your medical officer now; is anyone near you?");
    expect(assistantText(await playTurn("bat", id, "I don't know", { agent: pointing }))).toBe(
      "I'm right here with you. Please reach your medical officer now; is anyone near you?",
    );
  });

  it("a model that throws leaves the template in place", async () => {
    const id = await atGlucose("mn");
    const agent = new WordingAgent("");
    agent.companionReply = async () => {
      throw new Error("network down");
    };
    const events = await playTurn("bat", id, "ярилцмаар байна", { agent });
    expect(assistantText(events)).toMatch(/Мэдээж/u);
    expect(eventsOf(events, "error")).toEqual([]);
  });
});
