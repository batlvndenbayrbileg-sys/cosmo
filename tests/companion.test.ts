import { describe, expect, it } from "vitest";
import { findCrisisWords } from "@/lib/health/flags";
import {
  companionReply,
  companionTopic,
  crisisReply,
  detectCompanionExit,
  detectCompanionRequest,
  detectCrisis,
  isSaneCompanionReply,
  namesConditionOrDrug,
  planCompanion,
} from "@/server/agent/companion";
import { buildCompanionDirective, buildDirective } from "@/server/agent/directive";
import { initialCtx, parseCtx, serializeCtx, transition, type MachineCtx } from "@/server/agent/machine";
import { SYSTEM_PROMPT } from "@/server/agent/prompt";

/**
 * Friend mode (team feedback 2026-11-15): recognising a request to talk, a feeling, a wish to go on and crisis words
 * (both languages), the machine flag, the offline replies and the checks on model wording. Pure functions only; the
 * pipeline is exercised in companion-flow.test.ts.
 */

describe("detectCompanionRequest", () => {
  it.each([
    "Can I talk to you?",
    "could I just talk with you for a bit",
    "I need to talk",
    "I really need to talk to someone",
    "I need some emotional support",
    "Can we just talk?",
    "please just listen to me",
    "чамтай ярилцаж болох уу",
    "Тантай жаахан ярилцаж болох уу?",
    "ярилцмаар байна",
    "надад сэтгэл санааны дэмжлэг хэрэгтэй",
    "намайг сонсооч",
  ])("a request to talk: %s", (text) => {
    expect(detectCompanionRequest(text)).toBe("request");
  });

  it.each([
    "I feel lonely",
    "I'm so stressed out",
    "I am really anxious today",
    "I'm a bit homesick",
    "feeling down",
    "I miss my family",
    "I feel so alone up here",
    "би их стресстэй байна",
    "ганцаардаж байна",
    "уйтгартай байна",
    "санаа зовж байна",
    "гэр бүлээ их санаж байна",
    "сэтгэл гутарч байна",
  ])("a feeling: %s", (text) => {
    expect(detectCompanionRequest(text)).toBe("feeling");
  });

  it.each([
    "тийм",
    "үгүй",
    "68",
    "I'm fine",
    "I'm good, thanks",
    "yes",
    "no headache, no dizziness, no nausea",
    "124 over 82",
    "6 цаг хагас",
    "I'm not stressed",
    "not feeling lonely at all",
    "I don't feel lonely",
    "сайн байна",
    "зүгээр",
    "Can we talk about my results?",
    "I'm worried about my blood pressure, what should it be?",
    "Цусны сахар хэд байх ёстой вэ?",
    "What should my blood sugar be?",
    "let's start",
    "",
    // negated Mongolian feelings ("not stressed", "did not worry", "did not feel lonely")
    "стресстэй биш ээ",
    "стресстэй биш",
    "санаа зовсонгүй",
    "ганцаардсангүй",
    "өөрдөө стрессдсэнгүй",
    // "hard to say / to measure", not a feeling
    "хэлэхэд хэцүү байна",
    "дасгал хийхэд хэцүү байна",
    "хэмжихэд хэцүү байна",
    // a question about a check-in topic (sleep, mood, symptoms, the dashboard colours)
    "I'm worried about my sleep, how many hours should I get?",
    "Нойрондоо санаа зовж байна, хэдэн цаг унтах ёстой вэ?",
    "I'm worried about my sleep, why is it red?",
    "I'm nervous about my headache, is that normal?",
    "I want to talk about my sleep",
    "can I talk to you about my mood score?",
    // slang: "I'm down" = "I'm in"
    "yeah I'm down",
  ])("not a companion request: %s", (text) => {
    expect(detectCompanionRequest(text)).toBeNull();
  });

  it.each([
    "I can't sleep, can I talk to you?",
    "надад хэцүү байна",
    "I'm a bit down today",
    "I feel down",
    "стресстэй байна",
  ])("still a request or a feeling: %s", (text) => {
    expect(detectCompanionRequest(text)).not.toBeNull();
  });
});

describe("detectCompanionExit", () => {
  it.each([
    "за одоо үргэлжлүүлье",
    "үргэлжлүүлье",
    "болсон, баярлалаа",
    "баярлалаа",
    "одоо зүгээр боллоо",
    "шалгалтаа үргэлжлүүлье",
    "let's continue",
    "OK, let's get back to the check-in",
    "back to the check-in",
    "thanks, I'm good",
    "thank you so much",
    "I feel better now",
    "I'm ready",
    "that really helped",
    // bare ways of going on
    "continue",
    "go on",
    "next",
    "ok",
    "ok, next question",
    "I'm fine",
    "let's get back to it",
    "үргэлжлүүлээрэй",
    "үргэлжлүүлнэ",
    "дараагийн асуулт",
    "зүгээр ээ",
    "бэлэн байна",
  ])("leaves: %s", (text) => {
    expect(detectCompanionExit(text)).toBe(true);
  });

  it.each([
    "I feel lonely",
    "I'm not ok",
    "I'm ready to talk",
    "thanks, I'm not good",
    "ганцаардаж байна",
    "тийм",
    "68",
    "I miss my family",
    "",
    // homesick or distressed, not a wish to go on
    "I want to go back home",
    "I want to go home, back to it all",
    "I don't think I'm ready to go back to the check-in",
    "it didn't help, I want to go back home",
    "огт дээрдсэнгүй",
    "тус болсонгүй",
    "би ярихад бэлэн байна",
    "гэртээ буцъя",
  ])("stays: %s", (text) => {
    expect(detectCompanionExit(text)).toBe(false);
  });
});

describe("crisis words", () => {
  it.each([
    "I want to die",
    "sometimes I think about suicide",
    "I want to kill myself",
    "I don't want to live anymore",
    "I might hurt myself",
    "I'm going to hurt someone",
    "үхмээр байна",
    "амиа хорломоор байна",
    "амьдрахыг хүсэхгүй байна",
    "өөрийгөө гэмтээмээр байна",
    // -ing forms and common phrasings
    "I keep thinking about killing myself",
    "I've been cutting myself",
    "I'm thinking about ending my life",
    "taking my own life",
    "I wanna die",
    "I don't want to be here anymore",
    "I'd rather be dead",
    "I feel like hurting someone",
    "I feel like hurting myself",
    "sometimes I just want to end it all",
    // Mongolian (Cyrillic)
    "амьдрах хүсэлгүй байна",
    "үхсэн нь дээр",
    "амьд байхыг хүсэхгүй байна",
    "алчихмаар байна",
    // Mongolian typed in Latin letters
    "uhmeer baina",
    "ukhmeer bna",
    "amia horlomoor bna",
    "uuriiguu alchmaar baina",
    "amidrah huselgui",
    "uhsen n deer",
  ])("self-harm / harm to others: %s", (text) => {
    expect(findCrisisWords(text).length).toBeGreaterThan(0);
    expect(detectCrisis(text, false)).toBe("self");
  });

  it.each([
    "this workout is killing me",
    "I'm dying to go home",
    "I could die for a coffee",
    "I'm tired",
    "68",
    "тийм",
    "ядарч байна",
    // accidents and everyday phrases
    "I hurt myself on the treadmill",
    "I cut myself shaving",
    "I cut myself on a panel this morning",
    "I injured myself during exercise",
    "I could have hurt myself",
    "I keep hurting myself on the exercise bike",
    "no wait, I take it all back",
    "let me take it all in",
    "I want to go back home",
    "I don't want to be here for the whole meeting",
  ])("not a crisis: %s", (text) => {
    expect(findCrisisWords(text)).toEqual([]);
    expect(detectCrisis(text, true)).toBeNull();
  });

  it("medical-emergency words count while talking, not in an ordinary answer (the symptom note keeps its own flag)", () => {
    expect(detectCrisis("I have chest pain", true)).toBe("medical");
    expect(detectCrisis("цээж өвдөөд байна", true)).toBe("medical");
    expect(detectCrisis("I have chest pain", false)).toBeNull();
  });
});

describe("planCompanion", () => {
  const capture: Pick<MachineCtx, "state" | "companion"> = { state: "KPI_CAPTURE", companion: false };
  const talking: Pick<MachineCtx, "state" | "companion"> = { state: "KPI_CAPTURE", companion: true };

  it("enters on a request, on a feeling without a value, never on an ordinary answer", () => {
    expect(planCompanion(capture, "can I talk to you?", false)).toEqual({ kind: "enter", entry: "request" });
    expect(planCompanion(capture, "I feel lonely", false)).toEqual({ kind: "enter", entry: "feeling" });
    expect(planCompanion(capture, "68", true)).toBeNull();
    expect(planCompanion(capture, "I'm fine", false)).toBeNull();
  });

  it("a feeling that answers the open question (mood) or carries a number is a value, not a conversation", () => {
    expect(planCompanion(capture, "I feel down", true)).toBeNull();
    expect(planCompanion(capture, "I'm stressed, I slept 5 hours", false)).toBeNull();
    // an explicit request opens the conversation...
    expect(planCompanion(capture, "I need to talk", false)?.kind).toBe("enter");
    // ...unless the same words answer the open question ("listen, I slept 7 hours" is a sleep answer)
    expect(planCompanion(capture, "сонсооч, би 7 цаг унтсан", true)).toBeNull();
    expect(planCompanion(capture, "listen to me, I slept 7 hours", true)).toBeNull();
  });

  it("a yes with a feeling in it is a yes (proposal, read-back), and an accident is a symptom, not a crisis", () => {
    const smallTalk: Pick<MachineCtx, "state" | "companion"> = { state: "SMALL_TALK", companion: false };
    const confirm: Pick<MachineCtx, "state" | "companion"> = { state: "CONFIRM", companion: false };
    expect(planCompanion(smallTalk, "yes let's start, I'm a little stressed today", false, true)).toBeNull();
    expect(planCompanion(smallTalk, "тийм эхэлье, жаахан стресстэй байна", false, true)).toBeNull();
    expect(planCompanion(confirm, "yes, that's right, I'm just a bit nervous", false, true)).toBeNull();
    expect(planCompanion(confirm, "тийм зөв, гэхдээ жаахан санаа зовж байна", false, true)).toBeNull();
    expect(planCompanion(smallTalk, "yeah I'm down", false)).toBeNull();
    // without the yes the feeling still opens the conversation
    expect(planCompanion(smallTalk, "I'm a little stressed today", false)?.kind).toBe("enter");

    expect(planCompanion(capture, "I hurt myself on the treadmill", true)).toBeNull();
    expect(planCompanion(capture, "I cut myself shaving", true)).toBeNull();
    expect(planCompanion(confirm, "no wait, I take it all back", false)).toBeNull();
    expect(planCompanion(capture, "хэлэхэд хэцүү байна", false)).toBeNull();
    expect(planCompanion(capture, "стресстэй биш ээ", false)).toBeNull();
  });

  it("while talking: leaving, a plain answer to the open question, or one more turn", () => {
    expect(planCompanion(talking, "let's continue", false)).toEqual({ kind: "leave" });
    expect(planCompanion(talking, "next question", false)).toEqual({ kind: "leave" });
    expect(planCompanion(talking, "I miss my family", false)).toEqual({ kind: "stay" });
    // a number that does not answer the open question is part of the conversation
    expect(planCompanion(talking, "98", false)).toEqual({ kind: "stay" });
    // a plain answer ends the conversation and is recorded
    expect(planCompanion(talking, "7 hours", true)).toEqual({ kind: "answer" });
    expect(planCompanion(talking, "I slept about 7 hours last night", true)).toEqual({ kind: "answer" });
    // ...but not a story that happens to hold a number, nor after a crisis, nor outside the measurements
    expect(planCompanion(talking, "I have 3 kids back home and I miss them", true)).toEqual({ kind: "stay" });
    expect(planCompanion({ ...talking, companionCrisis: true }, "7 hours", true)).toEqual({ kind: "stay" });
    expect(planCompanion({ state: "CONFIRM", companion: true }, "7 hours", true)).toEqual({ kind: "stay" });
  });

  it("crisis words win in every state, before anything else", () => {
    expect(planCompanion(capture, "I want to die", false)).toEqual({ kind: "crisis", crisis: "self" });
    expect(planCompanion(talking, "let's continue, I want to die", false)).toEqual({ kind: "crisis", crisis: "self" });
    expect(planCompanion({ state: "DONE", companion: false }, "үхмээр байна", false)).toEqual({ kind: "crisis", crisis: "self" });
    expect(planCompanion(talking, "I can't breathe", false)).toEqual({ kind: "crisis", crisis: "medical" });
    expect(planCompanion(capture, "I need to talk, I have chest pain", false)).toEqual({ kind: "crisis", crisis: "medical" });
  });

  it("never interrupts SUMMARY", () => {
    expect(planCompanion({ state: "SUMMARY", companion: false }, "can I talk to you?", false)).toBeNull();
    expect(planCompanion({ state: "SUMMARY", companion: true }, "I want to die", false)).toBeNull();
  });
});

describe("machine: the companion flag", () => {
  function ctxIn(state: MachineCtx["state"], over: Partial<MachineCtx> = {}): MachineCtx {
    return { ...initialCtx(), state, ...over };
  }

  it("is off in a fresh context and in contexts written before it existed", () => {
    expect(initialCtx()).toMatchObject({ companion: false, companionTurns: 0, companionCrisis: false });
    const old = parseCtx("KPI_CAPTURE", JSON.stringify({ smallTalkTurns: 2, proposed: true, clarifyCount: { sleep: 1 }, skipped: [], filled: ["mood"] }));
    expect(old).toMatchObject({ companion: false, companionTurns: 0, companionCrisis: false, clarifyCount: { sleep: 1 } });
    const odd = parseCtx("KPI_CAPTURE", JSON.stringify({ companion: "yes", companionTurns: -2, companionCrisis: 1 }));
    expect(odd).toMatchObject({ companion: false, companionTurns: 0, companionCrisis: false });
  });

  it("round-trips through state_json", () => {
    const ctx = ctxIn("CONFIRM", { companion: true, companionTurns: 3, companionCrisis: true, filled: ["sleep_hours"], clarifyCount: { mood: 1 } });
    expect(parseCtx("CONFIRM", serializeCtx(ctx))).toEqual(ctx);
  });

  it("entering and talking touch only the companion fields", () => {
    const ctx = ctxIn("KPI_CAPTURE", { filled: ["sleep_hours"], clarifyCount: { mood: 1 }, skipped: ["glucose"] });
    const entered = transition(ctx, { type: "COMPANION_ENTER" });
    expect(entered.ctx).toEqual({ ...ctx, companion: true, companionTurns: 1 });
    expect(entered.effects).toEqual([{ type: "reply", kind: "companion" }]);
    const more = transition(entered.ctx, { type: "COMPANION_TURN" });
    expect(more.ctx).toEqual({ ...ctx, companion: true, companionTurns: 2 });
  });

  it("leaving resumes the same question, the read-back, the dashboard, or proposes the measurements", () => {
    // the sensor follow-up was skipped (nothing unusual) and the mood is answered: the symptom question is open
    const capture = ctxIn("KPI_CAPTURE", {
      filled: ["mood"],
      skipped: ["sensor_check"],
      companion: true,
      companionTurns: 2,
      clarifyCount: { symptoms: 1 },
    });
    const left = transition(capture, { type: "COMPANION_LEAVE" });
    expect(left.ctx).toEqual({ ...capture, companion: false, companionTurns: 0 });
    expect(left.effects).toEqual([{ type: "reply", kind: "companionLeave", resume: "question", question: "symptoms" }]);

    expect(transition(ctxIn("CONFIRM", { companion: true }), { type: "COMPANION_LEAVE" }).effects[0]).toMatchObject({ resume: "readBack" });
    expect(transition(ctxIn("DONE", { companion: true }), { type: "COMPANION_LEAVE" }).effects[0]).toMatchObject({ resume: "dashboard" });
    const fromGreeting = transition(ctxIn("GREETING", { companion: true }), { type: "COMPANION_LEAVE" });
    expect(fromGreeting.ctx).toMatchObject({ state: "SMALL_TALK", proposed: true, companion: false });
    expect(fromGreeting.effects[0]).toMatchObject({ resume: "propose" });
  });

  it("a crisis keeps the check-in where it is and marks the check-in", () => {
    const ctx = ctxIn("KPI_CAPTURE", { filled: ["sleep_hours"] });
    const r = transition(ctx, { type: "CRISIS", kind: "self" });
    expect(r.ctx).toEqual({ ...ctx, companion: true, companionTurns: 1, companionCrisis: true });
    expect(r.effects).toEqual([{ type: "reply", kind: "crisis", crisis: "self" }]);
  });

  it("DONE accepts companion events (they are not writes) and SUMMARY ignores them", () => {
    expect(transition(ctxIn("DONE"), { type: "COMPANION_ENTER" }).effects[0]).toMatchObject({ kind: "companion" });
    expect(transition(ctxIn("SUMMARY"), { type: "COMPANION_ENTER" })).toEqual({ ctx: ctxIn("SUMMARY"), effects: [] });
  });
});

describe("offline replies", () => {
  it("welcome in the words of the feeling, then varied follow-ups, in both languages", () => {
    expect(companionTopic("I feel so lonely")).toBe("lonely");
    expect(companionTopic("гэрээ санаж байна")).toBe("homesick");
    expect(companionReply("en", 1, "I feel lonely")).toMatch(/lonely/i);
    expect(companionReply("mn", 1, "стресстэй байна")).toMatch(/стресс/u);
    const seen = new Set<string>();
    for (let turn = 2; turn <= 6; turn++) seen.add(companionReply("en", turn, "anything"));
    expect(seen.size).toBe(5);
    for (const lang of ["en", "mn"] as const) {
      for (let turn = 1; turn <= 7; turn++) {
        const reply = companionReply(lang, turn, "I feel lonely");
        expect(reply).not.toMatch(/sorry,? I didn't catch|сонссонгүй/iu);
        expect(isSaneCompanionReply(reply, lang, "")).toBe(true);
      }
    }
  });

  it("the crisis reply sends the person to the medical officer now, in both languages", () => {
    expect(crisisReply("en", "self")).toMatch(/crew medical officer or the flight surgeon right now/);
    expect(crisisReply("en", "self")).toMatch(/local emergency number/);
    expect(crisisReply("mn", "medical")).toMatch(/эмнэлгийн офицер/u);
    expect(crisisReply("mn", "self")).toMatch(/яаралтай тусламжийн дугаар/u);
  });
});

describe("isSaneCompanionReply", () => {
  it("takes a warm short reply in the check-in language", () => {
    expect(isSaneCompanionReply("That sounds really hard, and I'm glad you told me. Who do you miss most today?", "en", "")).toBe(true);
    expect(isSaneCompanionReply("Үнэхээр хэцүү сонсогдож байна. Хэнийг хамгийн их санаж байна?", "mn", "")).toBe(true);
  });

  it.each([
    ["You could take a sleeping pill tonight.", "en"],
    ["This sounds like depression; you might need medication.", "en"],
    ["Try melatonin before bed.", "en"],
    ["Унтахын өмнө эм уугаарай.", "mn"],
    ["Breathe in for 4 seconds and out for 8.", "en"],
    ["That is hard. I hear you. It makes sense. What helps?", "en"],
    ["I'm here for you 💙", "en"],
    ["I'm here with you. What's on your mind?", "mn"],
    ["Би энд байна.", "en"],
    ["", "en"],
    // supplements, remedies, condition names and drug brands
    ["Some chamomile tea or a magnesium supplement before bed might help you sleep.", "en"],
    ["It sounds like you may be dealing with insomnia or panic attacks.", "en"],
    ["Maybe ask the medical officer about Ambien or Xanax for tonight.", "en"],
    ["A vitamin before bed could help.", "en"],
    ["Унтахын өмнө тайвшруулагч уувал тус болж магадгүй.", "mn"],
    ["Витамин уугаарай.", "mn"],
    ["Нойргүйдэл байж магадгүй.", "mn"],
  ] as const)("refuses %s (%s)", (text, lang) => {
    expect(isSaneCompanionReply(text, lang, "")).toBe(false);
  });

  it("after a crisis, takes only wording that keeps pointing to the medical officer", () => {
    expect(isSaneCompanionReply("I'm here for you, let's just keep chatting.", "en", "", true)).toBe(false);
    expect(isSaneCompanionReply("I'm here with you. Please talk to your medical officer now.", "en", "", true)).toBe(true);
    expect(isSaneCompanionReply("Би тантай хамт байна. Нислэгийн эмчтэйгээ одоо ярилцаарай.", "mn", "", true)).toBe(true);
    expect(isSaneCompanionReply("Би тантай хамт байна.", "mn", "", true)).toBe(false);
    for (const lang of ["en", "mn"] as const) {
      for (let turn = 1; turn <= 3; turn++) expect(isSaneCompanionReply(companionReply(lang, turn, "", true), lang, "", true)).toBe(true);
    }
  });

  it("namesConditionOrDrug (also used for the dashboard answers) leaves units and ordinary words alone", () => {
    expect(namesConditionOrDrug("Your glucose is 98 mg/dL, in the demo range.")).toBe(false);
    expect(namesConditionOrDrug("A tranquil evening routine can help.")).toBe(false);
    expect(namesConditionOrDrug("Should you take melatonin? Ask the medical officer.")).toBe(true);
    expect(namesConditionOrDrug("Унтуулагч эм хэрэглэж болно.")).toBe(true);
  });
});

describe("companion directive", () => {
  it("carries the companion rules after the frozen system prompt, which does not change", () => {
    const d = buildCompanionDirective({ state: "KPI_CAPTURE", lang: "mn", crewName: "Bat", turn: 2, crisisRaised: false });
    expect(d).toMatch(/^DIRECTIVE \(written by the system/);
    expect(d).toContain("mode: COMPANION");
    expect(d).toContain("reply_language: Mongolian (Cyrillic)");
    expect(d).toMatch(/never mention a medication/i);
    expect(d).toMatch(/breathing/);
    expect(d).toMatch(/crew medical officer or the flight surgeon right now/);
    expect(SYSTEM_PROMPT).not.toMatch(/mode: COMPANION|friend mode/i);
    expect(buildCompanionDirective({ state: "DONE", lang: "en", crewName: "Bat", turn: 1, crisisRaised: true })).toMatch(/were alerted/);
    // the check-in directive is unchanged by the companion one
    expect(buildDirective({ state: "DONE", lang: "en", crewName: "Bat", ctx: initialCtx(), expected: null, recorded: {} })).not.toContain("COMPANION");
  });
});
