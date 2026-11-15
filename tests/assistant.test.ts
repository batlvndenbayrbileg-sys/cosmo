import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lang, TurnEvent } from "@/lib/types";
import type { Agent, AgentDecision, AssistantReplyArgs } from "@/server/agent/agent";
import {
  checkupProgress,
  enterAssistant,
  isBackToAssistant,
  isSaneAssistantReply,
  isShowDashboard,
  isStartCheckup,
  isSwitchPerson,
  startCheckup,
  withNameGreeting,
} from "@/server/agent/assistantMode";
import { initialCtx, parseCtx, serializeCtx, transition, type MachineCtx, type MachineEvent } from "@/server/agent/machine";
import { ScriptedAgent } from "@/server/agent/scriptedAgent";
import { createOrResumeAssistant } from "@/server/checkin/service";
import { setClockForTests } from "@/server/clock";
import { setSensorFeedForTests } from "@/server/checkin/sensors";
import { getCrewPublic } from "@/server/db/repos/crew";
import { listAlerts } from "@/server/db/repos/alert";
import { listMeasurements } from "@/server/db/repos/measurement";
import { assistantText, ctxOf, eventsOf, playTurn } from "./helpers/agent";
import { TEST_TODAY, freshSeededDb } from "./helpers/db";

/**
 * Assistant mode (the "/" screen's default conversation): it never asks the check-up questions by itself, records only
 * a volunteered value the astronaut confirms, and switching to the daily check-up and back keeps the check-up's
 * progress. Pure parts first, then through the real turn pipeline (rule-based agent, in-memory database).
 */

beforeEach(async () => {
  setClockForTests(TEST_TODAY);
  await freshSeededDb();
});
afterEach(() => {
  setClockForTests(null);
  setSensorFeedForTests(null);
});

/** the check-up's questions, in both languages, as Cosmo asks them */
const KPI_PROMPT =
  /How many hours did you sleep|How would you rate your mood|blood pressure\?|heart rate\?|What is your blood glucose|How much water|Хэдэн цаг унтсан|сэтгэл санаагаа|даралт хэд|Цусны сахар хэд|Хэдэн мл ус/iu;

describe("assistant mode: commands", () => {
  it.each([
    "Start my daily check-up",
    "start my daily checkup",
    "let's do my check-up",
    "Continue my daily check-up",
    "can we start my check-up?",
    "Daily check-up",
    "Өдрийн үзлэг эхлүүлье",
    "өдрийн үзлэгээ үргэлжлүүлье",
    "үзлэгээ эхлүүлэх үү?",
    "Өдрийн үзлэг",
  ])("starts the check-up: %s", (text) => {
    expect(isStartCheckup(text)).toBe(true);
  });

  it.each(["what is the daily check-up?", "how long does my check-up take?", "өдрийн үзлэг гэж юу вэ?", "I slept 7 hours", "hello"])(
    "is not an order to start: %s",
    (text) => {
      expect(isStartCheckup(text)).toBe(false);
    },
  );

  it("back to the assistant, the dashboard and switching the person", () => {
    for (const t of ["Back to assistant", "go back to the assistant", "stop the check-up", "Туслах руу буцах", "буцах", "back"]) {
      expect(isBackToAssistant(t, false), t).toBe(true);
    }
    // while friend mode is on, a bare "back" means back to the check-up (companion.ts), not to the assistant
    expect(isBackToAssistant("буцъя", true)).toBe(false);
    expect(isBackToAssistant("back to assistant", true)).toBe(true);
    expect(isBackToAssistant("I went back to sleep", false)).toBe(false);
    expect(isShowDashboard("show my dashboard")).toBe(true);
    expect(isShowDashboard("самбараа харуул")).toBe(true);
    expect(isShowDashboard("what is on my dashboard?")).toBe(false);
    expect(isSwitchPerson("switch person")).toBe(true);
    expect(isSwitchPerson("хүн солих")).toBe(true);
    expect(isSwitchPerson("switch the light off")).toBe(false);
  });
});

describe("assistant mode: the switches (pure)", () => {
  const ctxIn = (state: MachineCtx["state"], over: Partial<MachineCtx> = {}): MachineCtx => ({ ...initialCtx(), state, ...over });

  it("the machine never asks a check-up question while the assistant is on", () => {
    const events: MachineEvent[] = [
      { type: "USER_TURN", start: "yes" },
      { type: "MEASUREMENT_ACCEPTED", keys: ["sleep_hours"] },
      { type: "CONFIRMATION", confirmed: true },
      { type: "COMPANION_ENTER" },
      { type: "SKIP", question: "sleep" },
    ];
    for (const state of ["GREETING", "SMALL_TALK", "KPI_CAPTURE", "CONFIRM"] as const) {
      const ctx = ctxIn(state, { assistant: true, proposed: true });
      for (const event of events) {
        const out = transition(ctx, event);
        expect(out.ctx).toBe(ctx);
        expect(out.effects.filter((e) => e.type === "reply" || e.type === "computeSummary")).toEqual([]);
      }
    }
  });

  it("starting resumes where the check-up stands, and entering keeps it", () => {
    expect(startCheckup(ctxIn("GREETING", { assistant: true }))).toMatchObject({ resume: "greeting", ctx: { assistant: false, state: "GREETING" } });
    expect(startCheckup(ctxIn("SMALL_TALK", { assistant: true }))).toMatchObject({ resume: "propose", ctx: { proposed: true } });
    const mid = ctxIn("KPI_CAPTURE", { assistant: true, filled: ["sleep_hours"], skipped: ["sensor_check"], clarifyCount: { mood: 1 } });
    expect(startCheckup(mid)).toMatchObject({ resume: "question", question: "mood", ctx: { state: "KPI_CAPTURE", clarifyCount: { mood: 1 } } });
    expect(startCheckup(ctxIn("CONFIRM", { assistant: true }))).toMatchObject({ resume: "readBack" });
    expect(startCheckup(ctxIn("DONE", { assistant: true }))).toMatchObject({ resume: "dashboard" });

    const running = ctxIn("KPI_CAPTURE", { filled: ["sleep_hours", "mood"], skipped: ["glucose"], companion: true, companionTurns: 2 });
    const paused = enterAssistant(running);
    expect(paused).toMatchObject({ assistant: true, state: "KPI_CAPTURE", filled: running.filled, skipped: running.skipped, companion: false });
    expect(checkupProgress(running)).toBe("in_progress");
    expect(checkupProgress(ctxIn("GREETING"))).toBe("not_started");
    expect(checkupProgress(ctxIn("DONE"))).toBe("done");
  });

  it("round-trips through state_json, and older contexts are the plain check-up", () => {
    const ctx = ctxIn("KPI_CAPTURE", {
      assistant: true,
      assistantTalkTurns: 2,
      assistantOffer: { kind: "record", utterance: "my pulse is 72", records: [{ key: "heart_rate", value: 72, unit: "bpm", sourceText: "72", confidence: 0.9 }] },
    });
    expect(parseCtx("KPI_CAPTURE", serializeCtx(ctx))).toEqual(ctx);
    expect(parseCtx("GREETING", JSON.stringify({ smallTalkTurns: 1 }))).toMatchObject({ assistant: false, assistantOffer: null, assistantTalkTurns: 0 });
    expect(parseCtx("GREETING", JSON.stringify({ assistant: "yes", assistantOffer: { kind: "record", records: [{ key: "bogus" }] } }))).toMatchObject({
      assistant: false,
      assistantOffer: null,
    });
  });

  it("greets by name once, and the model's wording passes only the gates", () => {
    const crew = { id: "saraa", name: "Saraa", role: "x", preferredLanguage: "mn" as const, mascotVariant: 1, avatarSeed: "s" };
    expect(withNameGreeting("Сайн байна уу! Юугаар туслах вэ?", crew, "mn")).toBe("Сайн уу, Сараа! Юугаар туслах вэ?");
    expect(withNameGreeting("Сайн уу, Сараа! Юу байна?", crew, "mn")).toBe("Сайн уу, Сараа! Юу байна?");
    expect(withNameGreeting("Hello! How can I help?", { ...crew, id: "mira", name: "Mira" }, "en")).toBe("Hi Mira! How can I help?");

    const facts = JSON.stringify({ latest_results: { indicators: [{ label: "Heart rate", today: "72 bpm" }] } });
    expect(isSaneAssistantReply("Your heart rate was 72 bpm, right in your usual range.", facts, "how was my pulse?", "en")).toBe(true);
    expect(isSaneAssistantReply("Your heart rate was 74 bpm.", facts, "how was my pulse?", "en")).toBe(false);
    expect(isSaneAssistantReply("This could be a sign of insomnia, try melatonin.", facts, "I sleep badly", "en")).toBe(false);
    expect(isSaneAssistantReply("I can't diagnose that.", facts, "what do I have?", "en")).toBe(false);
    expect(isSaneAssistantReply("Таны зүрхний цохилт 72 байсан.", facts, "пульс ямар байсан бэ?", "en")).toBe(false);
    // a general question may carry general-knowledge numbers
    expect(isSaneAssistantReply("The station circles Earth about every 90 minutes.", facts, "how fast does the station orbit?", "en")).toBe(true);
  });
});

/* ───────────── through the turn pipeline ───────────── */

async function openAssistant(crewId: string, language?: Lang): Promise<string> {
  return (await createOrResumeAssistant(crewId, { language })).checkInId;
}

function stateOf(events: TurnEvent[]) {
  return eventsOf(events, "state")[0];
}

describe.each<[Lang, string, string]>([
  ["en", "bat", "Hi Cosmo"],
  ["mn", "saraa", "Сайн байна уу"],
])("assistant mode through the pipeline (%s)", (lang, crewId, hello) => {
  it("opens with a name greeting, in the person's conversation, with the assistant on", async () => {
    const created = await createOrResumeAssistant(crewId, { language: lang });
    expect(created).toMatchObject({ assistant: true, resumed: false, language: lang, state: "GREETING" });
    expect(created.say?.text).toMatch(lang === "mn" ? /^Сайн уу, Сараа!/u : /^Hi Bat!/u);
    expect(created.greeting.text).not.toMatch(KPI_PROMPT);
    expect(await ctxOf(crewId, created.checkInId)).toMatchObject({ assistant: true, state: "GREETING" });
    // a quiet open stores the greeting but says nothing (the first reply greets by name)
    const again = await createOrResumeAssistant(crewId, { welcome: "quiet" });
    expect(again).toMatchObject({ checkInId: created.checkInId, resumed: true, say: null });
    const back = await createOrResumeAssistant(crewId, { welcome: "back" });
    expect(back.say?.text).toMatch(lang === "mn" ? /Сараа/u : /Bat/u);
  });

  it("never asks the check-up questions and records nothing on its own", async () => {
    const id = await openAssistant(crewId, lang);
    const lines =
      lang === "en"
        ? [hello, "how are you?", "what is a normal heart rate?", "how fast does the station go?", "tell me a fun fact", "I feel a bit stressed today", "thanks, I'm good now"]
        : [hello, "юу байна?", "хэвийн пульс хэд вэ?", "станц хэр хурдан явдаг вэ?", "би жаахан стресстэй байна", "за баярлалаа, зүгээр боллоо"];
    for (const line of lines) {
      const events = await playTurn(crewId, id, line);
      expect(eventsOf(events, "measurement"), line).toEqual([]);
      expect(eventsOf(events, "clarification"), line).toEqual([]);
      expect(stateOf(events), line).toMatchObject({ assistant: true, expectedQuestion: null });
      expect(assistantText(events), line).not.toMatch(KPI_PROMPT);
      expect(assistantText(events).length, line).toBeGreaterThan(5);
    }
    expect(await listMeasurements(crewId, id)).toEqual([]);
    expect(await ctxOf(crewId, id)).toMatchObject({ assistant: true, state: "GREETING", smallTalkTurns: 0 });
  });

  it("a volunteered value is offered, and stored only after a yes", async () => {
    const id = await openAssistant(crewId, lang);
    const offered = await playTurn(crewId, id, lang === "en" ? "my pulse is 72" : "пульс 72");
    expect(eventsOf(offered, "measurement")).toEqual([]);
    expect(assistantText(offered)).toMatch(lang === "en" ? /Shall I add it to today's check-up\?/u : /үзлэгт нэмэх үү\?/u);
    expect((await ctxOf(crewId, id)).assistantOffer).toMatchObject({ kind: "record", records: [{ key: "heart_rate", value: 72 }] });

    // "no": nothing stored, the offer is gone
    const declined = await playTurn(crewId, id, lang === "en" ? "no" : "үгүй");
    expect(eventsOf(declined, "measurement")).toEqual([]);
    expect(await listMeasurements(crewId, id)).toEqual([]);
    expect((await ctxOf(crewId, id)).assistantOffer).toBeNull();

    await playTurn(crewId, id, lang === "en" ? "my pulse is 72" : "пульс 72");
    const yes = await playTurn(crewId, id, lang === "en" ? "yes" : "тийм");
    expect(eventsOf(yes, "measurement")).toMatchObject([{ key: "heart_rate", value: 72, change: "recorded" }]);
    expect((await listMeasurements(crewId, id)).map((m) => [m.key, m.value])).toEqual([["heart_rate", 72]]);
    expect(stateOf(yes)).toMatchObject({ assistant: true, state: "GREETING" });
  });

  it("an unrelated reply lets the offer lapse instead of storing it", async () => {
    const id = await openAssistant(crewId, lang);
    await playTurn(crewId, id, lang === "en" ? "I slept 7 hours" : "би 7 цаг унтсан");
    await playTurn(crewId, id, lang === "en" ? "what is a normal heart rate?" : "хэвийн пульс хэд вэ?");
    expect(await listMeasurements(crewId, id)).toEqual([]);
    expect((await ctxOf(crewId, id)).assistantOffer).toBeNull();
  });

  it("start the check-up, answer, go back to the assistant, continue: the progress is kept", async () => {
    // no sensor feed here: the check-up's questions do not depend on the day's readings
    setSensorFeedForTests(false);
    const id = await openAssistant(crewId, lang);
    const say = lang === "en"
      ? { start: "Start my daily check-up", feel: "pretty good", yes: "yes let's start", mood: "4", back: "Back to assistant", ask: "what is a normal heart rate?", cont: "Continue my daily check-up", symptoms: "no" }
      : { start: "Өдрийн үзлэг эхлүүлье", feel: "сайн байна", yes: "тийм, эхэлье", mood: "дөрөв", back: "Туслах руу буцах", ask: "хэвийн пульс хэд вэ?", cont: "Өдрийн үзлэгээ үргэлжлүүлье", symptoms: "үгүй" };

    const started = await playTurn(crewId, id, say.start);
    expect(stateOf(started)).toMatchObject({ assistant: false, state: "GREETING" });
    expect(assistantText(started)).toMatch(lang === "en" ? /daily check-up/u : /Өдрийн үзлэг/u);

    await playTurn(crewId, id, say.feel); // small talk
    const proposedOrAsked = await playTurn(crewId, id, say.yes);
    const asked = stateOf(proposedOrAsked).state === "KPI_CAPTURE" ? proposedOrAsked : await playTurn(crewId, id, say.yes);
    // check-up turns do not touch the flag (absent = unchanged); the stored context says it is off
    expect(stateOf(asked)).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "mood" });
    expect(await ctxOf(crewId, id)).toMatchObject({ assistant: false });
    const felt = await playTurn(crewId, id, say.mood);
    expect(eventsOf(felt, "measurement")).toMatchObject([{ key: "mood", value: 4 }]);
    expect(stateOf(felt)).toMatchObject({ state: "KPI_CAPTURE", expectedQuestion: "symptoms" });

    const back = await playTurn(crewId, id, say.back);
    expect(stateOf(back)).toMatchObject({ assistant: true, state: "KPI_CAPTURE", expectedQuestion: null });
    expect(eventsOf(back, "action")).toEqual([{ type: "action", action: { kind: "assistant" } }]);
    const paused = await ctxOf(crewId, id);
    expect(paused).toMatchObject({ assistant: true, state: "KPI_CAPTURE", filled: ["mood"] });

    // a question in between is answered by the assistant, and the check-up does not move
    const answered = await playTurn(crewId, id, say.ask);
    expect(assistantText(answered)).not.toMatch(KPI_PROMPT);
    expect(await ctxOf(crewId, id)).toMatchObject({ state: "KPI_CAPTURE", clarifyCount: paused.clarifyCount, skipped: paused.skipped });

    const resumed = await playTurn(crewId, id, say.cont);
    expect(stateOf(resumed)).toMatchObject({ assistant: false, state: "KPI_CAPTURE", expectedQuestion: "symptoms" });
    expect(assistantText(resumed)).toMatch(lang === "en" ? /headache/iu : /Толгой/iu);
    const symptoms = await playTurn(crewId, id, say.symptoms);
    expect(eventsOf(symptoms, "measurement").map((m) => [m.key, m.value])).toContainEqual(["symptom_headache", 0]);
  });

  it("show my dashboard opens the latest confirmed check-in; a name of someone else asks to switch", async () => {
    const id = await openAssistant(crewId, lang);
    const dash = await playTurn(crewId, id, lang === "en" ? "show my dashboard" : "самбараа харуул");
    const action = eventsOf(dash, "action")[0]?.action;
    expect(action?.kind).toBe("dashboard");
    expect(action && action.kind === "dashboard" ? action.checkInId : "").not.toBe(id); // the seeded history, not today's open row

    const other = lang === "en" ? "I'm Mira" : "биш, би Бат";
    const sw = await playTurn(crewId, id, other);
    expect(eventsOf(sw, "action")).toEqual([{ type: "action", action: { kind: "identity", crewId: lang === "en" ? "mira" : "bat" } }]);
    // naming oneself is not a switch
    const self = await playTurn(crewId, id, lang === "en" ? "I'm Bat" : "би Сараа");
    expect(eventsOf(self, "action")).toEqual([]);
  });

  it("crisis words get the code reply and a red alert, in assistant mode too", async () => {
    const id = await openAssistant(crewId, lang);
    const before = (await listAlerts(crewId)).length;
    const events = await playTurn(crewId, id, lang === "en" ? "I want to hurt myself" : "би өөрийгөө гэмтээмээр байна");
    expect(assistantText(events)).toMatch(lang === "en" ? /medical officer/u : /эмнэлгийн офицер/u);
    expect((await listAlerts(crewId)).length).toBe(before + 1);
  });

  it("crisis words win over a pending offer: no 'okay, I won't note it', the crisis reply and a red alert", async () => {
    const id = await openAssistant(crewId, lang);
    await playTurn(crewId, id, lang === "en" ? "my pulse is 72" : "пульс 72");
    expect((await ctxOf(crewId, id)).assistantOffer).not.toBeNull();
    const before = (await listAlerts(crewId)).length;
    const events = await playTurn(crewId, id, lang === "en" ? "no, I want to die" : "үгүй, би үхмээр байна");
    expect(assistantText(events)).toMatch(lang === "en" ? /medical officer/u : /эмнэлгийн офицер/u);
    expect((await listAlerts(crewId)).length).toBe(before + 1);
    expect(await listMeasurements(crewId, id)).toEqual([]);
    expect((await ctxOf(crewId, id)).assistantOffer).toBeNull();
  });

  it("a clearly denied symptom raises no red alert; a stated one does", async () => {
    const id = await openAssistant(crewId, lang);
    const before = (await listAlerts(crewId)).length;
    const denied = await playTurn(crewId, id, lang === "en" ? "I don't have chest pain, just tired" : "цээж өвдөхгүй, зүгээр ядарсан");
    expect(assistantText(denied)).not.toMatch(lang === "en" ? /medical officer/u : /эмнэлгийн офицер/u);
    expect((await listAlerts(crewId)).length).toBe(before);
    const stated = await playTurn(crewId, id, lang === "en" ? "I have chest pain" : "цээж өвдөж байна");
    expect(assistantText(stated)).toMatch(lang === "en" ? /medical officer/u : /эмнэлгийн офицер/u);
    expect((await listAlerts(crewId)).length).toBe(before + 1);
  });

  it("greets by name in the first reply after the speaker was recognised", async () => {
    const id = (await createOrResumeAssistant(crewId, { language: lang, welcome: "quiet" })).checkInId;
    const crew = await getCrewPublic(crewId);
    const { collect } = await import("./helpers/agent");
    const { runTurn } = await import("@/server/agent/turn");
    const events = await collect(runTurn({ crewId, checkInId: id, input: { kind: "typed", text: hello, greet: true } }));
    expect(assistantText(events)).toMatch(lang === "mn" ? /^Сайн уу, Сараа!/u : new RegExp(`^Hi ${crew.name}!`, "u"));
  });
});

describe("assistant mode: during the check-up", () => {
  async function toFirstQuestion(crewId: string): Promise<string> {
    const id = await openAssistant(crewId, "en");
    await playTurn(crewId, id, "Start my daily check-up");
    await playTurn(crewId, id, "pretty good");
    const r = await playTurn(crewId, id, "yes let's start");
    if (stateOf(r).state !== "KPI_CAPTURE") await playTurn(crewId, id, "yes let's start");
    expect(await ctxOf(crewId, id)).toMatchObject({ assistant: false, state: "KPI_CAPTURE" });
    return id;
  }

  it("crisis words with 'back' are the check-up's crisis reply, not a quiet switch to the assistant", async () => {
    const id = await toFirstQuestion("alex");
    const before = (await listAlerts("alex")).length;
    const events = await playTurn("alex", id, "back to assistant, I want to hurt myself");
    expect(eventsOf(events, "action")).toEqual([]);
    expect(assistantText(events)).toMatch(/medical officer/u);
    expect((await listAlerts("alex")).length).toBe(before + 1);
    expect(await ctxOf("alex", id)).toMatchObject({ assistant: false });
  });

  it("a crewmate named in an answer does not switch the person", async () => {
    const id = await toFirstQuestion("alex");
    for (const line of ["no, Mira helped me with the filter", "it's Mira's turn on the bike"]) {
      const events = await playTurn("alex", id, line);
      expect(eventsOf(events, "action"), line).toEqual([]);
    }
    expect(await ctxOf("alex", id)).toMatchObject({ assistant: false, state: "KPI_CAPTURE" });
  });
});

describe("assistant mode: the live model's wording is gated", () => {
  class WordyAgent extends ScriptedAgent {
    replies: string[] = [];
    seen: AssistantReplyArgs[] = [];
    async decide(args: Parameters<Agent["decide"]>[0]): Promise<AgentDecision> {
      return super.decide(args);
    }
    async assistantReply(args: AssistantReplyArgs): Promise<string | null> {
      this.seen.push(args);
      return this.replies.shift() ?? null;
    }
  }

  it("takes a sane answer, refuses a made-up number or a drug name, and passes the facts in the directive", async () => {
    const id = await openAssistant("alex", "en");
    const agent = new WordyAgent();
    agent.replies = ["Space life is busy, but a short walk on the treadmill and steady water help a lot."];
    const ok = await playTurn("alex", id, "any tips for feeling more awake?", { agent });
    expect(assistantText(ok)).toBe("Space life is busy, but a short walk on the treadmill and steady water help a lot.");
    expect(agent.seen[0].directive).toMatch(/mode: ASSISTANT/u);
    expect(agent.seen[0].directive).toMatch(/latest_results/u);

    agent.replies = ["Your heart rate was 999 bpm yesterday."];
    const invented = await playTurn("alex", id, "how was my heart rate?", { agent });
    expect(assistantText(invented)).not.toMatch(/999/u);

    agent.replies = ["Try some melatonin before bed."];
    const drug = await playTurn("alex", id, "I can't sleep well, any advice?", { agent });
    expect(assistantText(drug)).not.toMatch(/melatonin/iu);
  });
});

describe("assistant mode: crew isolation", () => {
  it("each person's assistant row is their own; another person's id is never reachable", async () => {
    const bat = await openAssistant("bat", "mn");
    const saraa = await openAssistant("saraa", "mn");
    expect(bat).not.toBe(saraa);
    const events = await playTurn("saraa", bat, "сайн уу");
    expect(eventsOf(events, "error")[0]).toMatchObject({ code: "NOT_FOUND" });
    expect(eventsOf(events, "assistant")).toEqual([]);
    // reopening returns the same row for the same person
    expect(await openAssistant("bat")).toBe(bat);
  });
});
