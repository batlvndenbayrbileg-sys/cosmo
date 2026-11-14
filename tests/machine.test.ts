import { describe, expect, it } from "vitest";
import type { KpiKey, QuestionId } from "@/lib/types";
import { NUMERIC_KEYS, QUESTIONS } from "@/lib/kpi/registry";
import {
  MAX_CLARIFICATIONS,
  cursorQuestion,
  expectedQuestion,
  initialCtx,
  missingKeys,
  parseCtx,
  questionOfKey,
  serializeCtx,
  transition,
  type Effect,
  type MachineCtx,
  type MachineEvent,
} from "@/server/agent/machine";

function ctxIn(state: MachineCtx["state"], over: Partial<MachineCtx> = {}): MachineCtx {
  return { ...initialCtx(), state, ...over };
}

function replyOf(effects: Effect[]) {
  const r = effects.find((e): e is Extract<Effect, { type: "reply" }> => e.type === "reply");
  if (!r) throw new Error(`no reply effect in ${JSON.stringify(effects)}`);
  return r;
}

/** every key except the ones of the given questions */
function filledExcept(...ids: QuestionId[]): KpiKey[] {
  const skip = new Set(QUESTIONS.filter((q) => ids.includes(q.id)).flatMap((q) => q.keys));
  return NUMERIC_KEYS.filter((k) => !skip.has(k));
}

describe("GREETING and SMALL_TALK (PLAN 4.1)", () => {
  it("GREETING + USER_TURN -> SMALL_TALK with a warm reply, whatever was said", () => {
    const r = transition(initialCtx(), { type: "USER_TURN", start: "yes" });
    expect(r.ctx.state).toBe("SMALL_TALK");
    expect(r.ctx.smallTalkTurns).toBe(1);
    expect(r.ctx.proposed).toBe(false);
    expect(replyOf(r.effects).kind).toBe("smallTalk");
  });

  it("the second small-talk turn proposes the measurements and stays in SMALL_TALK", () => {
    const r = transition(ctxIn("SMALL_TALK", { smallTalkTurns: 1 }), { type: "USER_TURN", start: "unclear" });
    expect(r.ctx.state).toBe("SMALL_TALK");
    expect(r.ctx.proposed).toBe(true);
    expect(r.ctx.smallTalkTurns).toBe(2);
    expect(replyOf(r.effects).kind).toBe("smallTalkPropose");
  });

  it("an explicit request to start before the proposal goes straight to the first question", () => {
    const r = transition(ctxIn("SMALL_TALK", { smallTalkTurns: 1 }), { type: "USER_TURN", start: "yes" });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "sleep" });
  });

  it("after the proposal a yes moves to KPI_CAPTURE and asks the first question", () => {
    const r = transition(ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true }), { type: "USER_TURN", start: "yes" });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "sleep" });
  });

  it("after the proposal anything that is not an explicit refusal also moves on", () => {
    const r = transition(ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true }), { type: "USER_TURN", start: "unclear" });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
  });

  it("after the proposal a refusal is acknowledged, the offer is repeated and the state stays", () => {
    const r = transition(ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true }), { type: "USER_TURN", start: "no" });
    expect(r.ctx.state).toBe("SMALL_TALK");
    expect(r.ctx.proposed).toBe(true);
    expect(replyOf(r.effects).kind).toBe("proposeAgain");
    // and when the person agrees later, the measurements start
    const again = transition(r.ctx, { type: "USER_TURN", start: "yes" });
    expect(again.ctx.state).toBe("KPI_CAPTURE");
  });

  it("values volunteered before CONFIRM are accepted in GREETING and SMALL_TALK, with no reply of their own", () => {
    for (const state of ["GREETING", "SMALL_TALK"] as const) {
      const r = transition(ctxIn(state), { type: "MEASUREMENT_ACCEPTED", keys: ["sleep_hours", "heart_rate"] });
      expect(r.ctx.state).toBe(state);
      expect(r.ctx.filled).toEqual(["sleep_hours", "heart_rate"]);
      expect(r.effects).toEqual([]);
    }
  });

  it("the cursor skips questions that were volunteered: sleep and mood filled -> the first question is symptoms", () => {
    let ctx = ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true });
    ctx = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: ["sleep_hours", "mood"] }).ctx;
    const r = transition(ctx, { type: "USER_TURN", start: "yes" });
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "symptoms" });
  });

  it("everything volunteered: the start goes straight to the read-back", () => {
    const ctx = ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true, filled: [...NUMERIC_KEYS, "day_note"] });
    const r = transition(ctx, { type: "USER_TURN", start: "yes" });
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects).kind).toBe("readBack");
  });

  it("write events that make no sense in small talk are refused", () => {
    const r = transition(ctxIn("SMALL_TALK"), { type: "CORRECTION_ACCEPTED", keys: ["mood"] });
    expect(r.effects).toEqual([{ type: "refused", reason: "illegal_state" }]);
    expect(r.ctx.filled).toEqual([]);
  });
});

describe("KPI_CAPTURE (PLAN 4.1)", () => {
  const capture = (over: Partial<MachineCtx> = {}) => ctxIn("KPI_CAPTURE", { smallTalkTurns: 2, proposed: true, ...over });

  it("an accepted value recomputes the cursor and asks the next question, acknowledging the keys", () => {
    const r = transition(capture({ filled: [] }), { type: "MEASUREMENT_ACCEPTED", keys: ["sleep_hours"] });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
    expect(r.ctx.filled).toEqual(["sleep_hours"]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "mood", keys: ["sleep_hours"] });
  });

  it("walks every question in the canonical order when answered one by one", () => {
    let ctx = capture();
    const asked: string[] = [];
    for (const q of QUESTIONS) {
      const keys = q.keys.filter((k) => k !== "symptom_note");
      const r = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys });
      ctx = r.ctx;
      if (q.id === "day_note") continue;
      const reply = replyOf(r.effects);
      if (reply.question) asked.push(reply.question);
    }
    expect(asked).toEqual(QUESTIONS.slice(1, -1).map((q) => q.id).concat("day_note"));
  });

  it("the question after an already filled one is skipped (BP filled: heart rate comes after blood pressure's predecessor)", () => {
    const ctx = capture({ filled: ["sleep_hours", "mood", "symptom_headache", "symptom_dizziness", "symptom_nausea", "bp_systolic", "bp_diastolic"] });
    expect(cursorQuestion(ctx)).toBe("heart_rate");
    expect(expectedQuestion(ctx)).toBe("heart_rate");
  });

  it("when no question remains the machine moves to CONFIRM with a read-back", () => {
    const ctx = capture({ filled: filledExcept("heart_rate", "day_note") });
    const r = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: ["heart_rate"] });
    // only the optional day_note is left: it is still offered once
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "day_note" });
    const done = transition(r.ctx, { type: "SKIP", question: "day_note" });
    expect(done.ctx.state).toBe("CONFIRM");
    expect(replyOf(done.effects).kind).toBe("readBack");
  });

  it("a rejected answer is clarified on the same cursor: clarifyCount goes 0 -> 1 -> 2", () => {
    let ctx = capture();
    const first = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "sleep", reason: "range" });
    expect(replyOf(first.effects)).toMatchObject({ kind: "clarify", question: "sleep", attempt: 0, reason: "range" });
    expect(first.ctx.clarifyCount.sleep).toBe(1);
    expect(first.ctx.state).toBe("KPI_CAPTURE");
    ctx = first.ctx;
    const second = transition(ctx, { type: "CLARIFICATION", question: "sleep", reason: "type" });
    expect(replyOf(second.effects)).toMatchObject({ kind: "clarify", attempt: 1 });
    expect(second.ctx.clarifyCount.sleep).toBe(MAX_CLARIFICATIONS);
    expect(cursorQuestion(second.ctx)).toBe("sleep");
  });

  it("after 2 failed clarifications the question is skipped, Cosmo says it can be added at the confirmation, and the cursor advances", () => {
    const ctx = capture({ clarifyCount: { sleep: 2 } });
    const r = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "sleep", reason: "unclear" });
    expect(r.ctx.skipped).toEqual(["sleep"]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "mood", skippedQuestion: "sleep" });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
  });

  it("clarifyCount is per question: a failure on mood does not use up sleep's budget", () => {
    let ctx = capture({ filled: ["sleep_hours"] });
    ctx = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "mood", reason: "unclear" }).ctx;
    ctx = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "mood", reason: "unclear" }).ctx;
    expect(ctx.clarifyCount).toEqual({ mood: 2 });
    const r = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "mood", reason: "unclear" });
    expect(r.ctx.skipped).toEqual(["mood"]);
  });

  it("skipping the last open question goes to the read-back and still carries the skip notice", () => {
    const ctx = capture({ filled: filledExcept("workload", "day_note"), clarifyCount: { workload: 2 }, skipped: [] });
    const withNote = { ...ctx, skipped: ["day_note" as QuestionId] };
    const r = transition(withNote, { type: "MEASUREMENT_REJECTED", question: "workload", reason: "unclear" });
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects)).toMatchObject({ kind: "readBack", skippedQuestion: "workload" });
  });

  it("an accepted answer resets the clarification counter of its question", () => {
    const ctx = capture({ clarifyCount: { sleep: 1 } });
    const r = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: ["sleep_hours"] });
    expect(r.ctx.clarifyCount.sleep).toBeUndefined();
  });

  it("optional questions never block: a failed day_note answer is skipped at once, with no clarification", () => {
    const ctx = capture({ filled: filledExcept("day_note") });
    const r = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "day_note", reason: "type" });
    expect(r.ctx.skipped).toEqual(["day_note"]);
    expect(r.ctx.clarifyCount.day_note).toBeUndefined();
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects)).toMatchObject({ kind: "readBack" });
    expect(replyOf(r.effects).skippedQuestion).toBeUndefined();
  });

  it("symptom_note is optional: the symptoms question is filled by the three symptom keys alone", () => {
    const ctx = capture({ filled: ["sleep_hours", "mood", "symptom_headache", "symptom_dizziness", "symptom_nausea"] });
    expect(cursorQuestion(ctx)).toBe("blood_pressure");
  });

  it("an explicit SKIP advances without a notice", () => {
    const r = transition(capture(), { type: "SKIP", question: "sleep" });
    expect(r.ctx.skipped).toEqual(["sleep"]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "mood" });
    expect(replyOf(r.effects).skippedQuestion).toBeUndefined();
  });

  it("restating an already recorded value is not a failed answer: the same question is asked again, nothing is counted", () => {
    const ctx = capture({ filled: ["sleep_hours"], clarifyCount: { mood: 1 } });
    const r = transition(ctx, { type: "ALREADY_RECORDED" });
    expect(r.ctx).toEqual(ctx);
    expect(r.ctx.clarifyCount).toEqual({ mood: 1 });
    expect(r.ctx.skipped).toEqual([]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "restated", question: "mood" });
    // however often it happens, the question is never skipped because of it
    let next = r.ctx;
    for (let i = 0; i < 5; i++) next = transition(next, { type: "ALREADY_RECORDED" }).ctx;
    expect(next.skipped).toEqual([]);
    expect(cursorQuestion(next)).toBe("mood");
  });

  it("corrections are not taken during capture", () => {
    const r = transition(capture(), { type: "CORRECTION_ACCEPTED", keys: ["mood"] });
    expect(r.effects).toEqual([{ type: "refused", reason: "illegal_state" }]);
  });
});

describe("CONFIRM (PLAN 4.1)", () => {
  const confirm = (over: Partial<MachineCtx> = {}) => ctxIn("CONFIRM", { filled: [...NUMERIC_KEYS], ...over });

  it("a correction updates the key and asks again, staying in CONFIRM", () => {
    const r = transition(confirm(), { type: "CORRECTION_ACCEPTED", keys: ["sleep_hours"] });
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects)).toMatchObject({ kind: "correctionAck", keys: ["sleep_hours"] });
  });

  it("a correction can add a value that was skipped earlier and takes it off the skipped list", () => {
    const ctx = confirm({ filled: filledExcept("glucose"), skipped: ["glucose"] });
    const r = transition(ctx, { type: "CORRECTION_ACCEPTED", keys: ["glucose_mgdl"] });
    expect(r.ctx.filled).toContain("glucose_mgdl");
    expect(r.ctx.skipped).toEqual([]);
  });

  it("a correction that could not be used is explained (clarify), keeps the read-back open and never asks 'what to change'", () => {
    const ctx = confirm({ skipped: ["day_note"] });
    const r = transition(ctx, { type: "CORRECTION_REJECTED", question: "sleep", reason: "range" });
    expect(r.ctx).toEqual(ctx);
    expect(replyOf(r.effects)).toEqual({ type: "reply", kind: "clarify", question: "sleep", attempt: 0, reason: "range" });
    expect(r.effects.some((e) => e.type === "computeSummary")).toBe(false);
  });

  it("'no' without a usable correction asks what to change", () => {
    const r = transition(confirm(), { type: "CONFIRMATION", confirmed: false });
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects).kind).toBe("askWhatToChange");
  });

  it("an answer that is neither yes nor no repeats the read-back question", () => {
    const r = transition(confirm(), { type: "CONFIRMATION", confirmed: null });
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects).kind).toBe("readBack");
  });

  it("'yes' moves to SUMMARY and asks the pipeline to compute it", () => {
    const r = transition(confirm(), { type: "CONFIRMATION", confirmed: true });
    expect(r.ctx.state).toBe("SUMMARY");
    expect(r.effects).toEqual([{ type: "computeSummary" }]);
  });

  it("new measurements are refused at the read-back: changes arrive as corrections", () => {
    const r = transition(confirm(), { type: "MEASUREMENT_ACCEPTED", keys: ["mood"] });
    expect(r.effects).toEqual([{ type: "refused", reason: "illegal_state" }]);
  });
});

describe("SUMMARY and DONE (PLAN 4.1)", () => {
  it("SUMMARY_SPOKEN ends the check-in", () => {
    const r = transition(ctxIn("SUMMARY"), { type: "SUMMARY_SPOKEN" });
    expect(r.ctx.state).toBe("DONE");
    expect(r.effects).toEqual([]);
  });

  it("DONE answers further turns with a closing reply and stays DONE", () => {
    const ctx = ctxIn("DONE", { filled: [...NUMERIC_KEYS] });
    const r = transition(ctx, { type: "USER_TURN", start: "yes" });
    expect(r.ctx.state).toBe("DONE");
    expect(replyOf(r.effects).kind).toBe("closing");
  });

  it("DONE refuses every write event and leaves the context untouched", () => {
    const ctx = ctxIn("DONE", { filled: ["mood"] });
    const writes: MachineEvent[] = [
      { type: "MEASUREMENT_ACCEPTED", keys: ["sleep_hours"] },
      { type: "MEASUREMENT_REJECTED", question: "sleep", reason: "range" },
      { type: "CLARIFICATION", question: "sleep", reason: "type" },
      { type: "SKIP", question: "sleep" },
      { type: "ALREADY_RECORDED" },
      { type: "CORRECTION_ACCEPTED", keys: ["mood"] },
      { type: "CORRECTION_REJECTED", question: "sleep", reason: "range" },
    ];
    for (const event of writes) {
      const r = transition(ctx, event);
      expect(r.effects, event.type).toEqual([{ type: "refused", reason: "done" }]);
      expect(r.ctx).toEqual(ctx);
    }
  });

  it("a confirmation in DONE does nothing (the check-in cannot be confirmed twice)", () => {
    const r = transition(ctxIn("DONE"), { type: "CONFIRMATION", confirmed: true });
    expect(r.ctx.state).toBe("DONE");
    expect(r.effects).toEqual([]);
  });
});

describe("purity and persistence", () => {
  it("never mutates its input", () => {
    const ctx = ctxIn("KPI_CAPTURE", { filled: ["sleep_hours"], skipped: ["mood"], clarifyCount: { symptoms: 1 } });
    const frozen = structuredClone(ctx);
    const deepFreeze = (o: object): void => {
      Object.freeze(o);
      for (const v of Object.values(o)) if (typeof v === "object" && v !== null) deepFreeze(v);
    };
    deepFreeze(ctx);
    transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: ["heart_rate"] });
    transition(ctx, { type: "MEASUREMENT_REJECTED", question: "symptoms", reason: "unclear" });
    transition(ctx, { type: "SKIP", question: "symptoms" });
    expect(ctx).toEqual(frozen);
  });

  it("is deterministic", () => {
    const ctx = ctxIn("KPI_CAPTURE", { filled: ["sleep_hours"] });
    const event: MachineEvent = { type: "MEASUREMENT_REJECTED", question: "mood", reason: "range" };
    expect(transition(ctx, event)).toEqual(transition(ctx, event));
  });

  it("serializeCtx / parseCtx round-trip everything except the state column", () => {
    const ctx = ctxIn("KPI_CAPTURE", {
      smallTalkTurns: 2,
      proposed: true,
      filled: ["sleep_hours", "mood"],
      skipped: ["glucose"],
      clarifyCount: { water: 1 },
    });
    const json = serializeCtx(ctx);
    expect(JSON.parse(json)).not.toHaveProperty("state");
    expect(parseCtx("KPI_CAPTURE", json)).toEqual(ctx);
  });

  it("parseCtx tolerates empty, malformed and foreign values", () => {
    expect(parseCtx("GREETING", "{}")).toEqual(initialCtx());
    expect(parseCtx("GREETING", "not json")).toEqual(initialCtx());
    expect(parseCtx("GREETING", null)).toEqual(initialCtx());
    const odd = parseCtx(
      "CONFIRM",
      JSON.stringify({ smallTalkTurns: -3, proposed: "yes", skipped: ["sleep", "nonsense", 4], filled: ["mood", "bogus"], clarifyCount: { sleep: 2, bogus: 1, mood: "x" } }),
    );
    expect(odd.state).toBe("CONFIRM");
    expect(odd.smallTalkTurns).toBe(0);
    expect(odd.proposed).toBe(false);
    expect(odd.skipped).toEqual(["sleep"]);
    expect(odd.filled).toEqual(["mood"]);
    expect(odd.clarifyCount).toEqual({ sleep: 2 });
  });

  it("helpers: questionOfKey, missingKeys and expectedQuestion", () => {
    expect(questionOfKey("bp_diastolic")).toBe("blood_pressure");
    expect(questionOfKey("symptom_note")).toBe("symptoms");
    expect(missingKeys({ filled: ["sleep_hours"] })[0]).toBe("mood");
    expect(expectedQuestion(ctxIn("CONFIRM"))).toBeNull();
    expect(expectedQuestion(ctxIn("KPI_CAPTURE"))).toBe("sleep");
  });
});
