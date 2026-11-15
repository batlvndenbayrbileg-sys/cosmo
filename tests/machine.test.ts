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

  it("an explicit request to start before the proposal goes straight to the first question, with the sensor intro", () => {
    const r = transition(ctxIn("SMALL_TALK", { smallTalkTurns: 1 }), { type: "USER_TURN", start: "yes" });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
    // the sensor follow-up is first while it is not skipped (an unusual reading); the intro flag says the sensors first
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "sensor_check", intro: true });
  });

  it("after the proposal a yes moves to KPI_CAPTURE and asks the first question", () => {
    const r = transition(ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true, skipped: ["sensor_check"] }), { type: "USER_TURN", start: "yes" });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "mood", intro: true });
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

  it("the cursor skips questions that were volunteered: mood filled -> the first question is symptoms", () => {
    let ctx = ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true, skipped: ["sensor_check"] });
    ctx = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: ["sleep_hours", "mood"] }).ctx;
    const r = transition(ctx, { type: "USER_TURN", start: "yes" });
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "symptoms" });
  });

  it("everything volunteered: the start goes straight to the read-back", () => {
    const ctx = ctxIn("SMALL_TALK", { smallTalkTurns: 2, proposed: true, filled: [...NUMERIC_KEYS], skipped: ["sensor_check"] });
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
  // a check-in whose sensor feed showed nothing unusual: the follow-up question is skipped, the mood comes first
  const capture = (over: Partial<MachineCtx> = {}) =>
    ctxIn("KPI_CAPTURE", { smallTalkTurns: 2, proposed: true, skipped: ["sensor_check"], ...over });

  it("an accepted value recomputes the cursor and asks the next question, acknowledging the keys", () => {
    const r = transition(capture({ filled: [] }), { type: "MEASUREMENT_ACCEPTED", keys: ["mood"] });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
    expect(r.ctx.filled).toEqual(["mood"]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "symptoms", keys: ["mood"] });
  });

  it("walks every asked and sensor question in order when answered one by one, then reads back", () => {
    const order: QuestionId[] = [
      "mood", "symptoms", "sleep_quality", "energy", "stress", "connection",
      "sleep", "blood_pressure", "heart_rate", "temperature", "glucose", "water", "exercise",
    ];
    let ctx = capture();
    const asked: string[] = [];
    let last: Effect[] = [];
    for (const id of order) {
      const keys = QUESTIONS.find((q) => q.id === id)!.keys.filter((k) => k !== "symptom_note");
      const r = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys });
      ctx = r.ctx;
      last = r.effects;
      const reply = replyOf(r.effects);
      if (reply.question) asked.push(reply.question);
    }
    expect(asked).toEqual(order.slice(1));
    // vision, workload and the day note are only taken when volunteered: never asked
    expect(replyOf(last).kind).toBe("readBack");
    expect(ctx.state).toBe("CONFIRM");
  });

  it("with the sensor values filled, only the six spoken questions remain", () => {
    const sensorKeys: KpiKey[] = QUESTIONS.filter((q) => q.capture === "sensor").flatMap((q) => q.keys);
    let ctx = capture({ filled: sensorKeys });
    const asked: string[] = [cursorQuestion(ctx) as string];
    for (let i = 0; i < 10 && ctx.state === "KPI_CAPTURE"; i++) {
      const q = QUESTIONS.find((x) => x.id === cursorQuestion(ctx))!;
      const r = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: q.keys.filter((k) => k !== "symptom_note") });
      ctx = r.ctx;
      const reply = replyOf(r.effects);
      if (reply.question) asked.push(reply.question);
    }
    expect(asked).toEqual(["mood", "symptoms", "sleep_quality", "energy", "stress", "connection"]);
    expect(ctx.state).toBe("CONFIRM");
  });

  it("the question after an already filled one is skipped (BP filled: heart rate comes after blood pressure's predecessor)", () => {
    const ctx = capture({
      filled: [
        "mood", "symptom_headache", "symptom_dizziness", "symptom_nausea", "sleep_quality", "energy", "stress", "connection",
        "sleep_hours", "bp_systolic", "bp_diastolic",
      ],
    });
    expect(cursorQuestion(ctx)).toBe("heart_rate");
    expect(expectedQuestion(ctx)).toBe("heart_rate");
  });

  it("when no question remains the machine moves to CONFIRM with a read-back", () => {
    const ctx = capture({ filled: filledExcept("heart_rate") });
    const r = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: ["heart_rate"] });
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects).kind).toBe("readBack");
  });

  it("a rejected answer is clarified on the same cursor: clarifyCount goes 0 -> 1 -> 2", () => {
    let ctx = capture();
    const first = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "mood", reason: "range" });
    expect(replyOf(first.effects)).toMatchObject({ kind: "clarify", question: "mood", attempt: 0, reason: "range" });
    expect(first.ctx.clarifyCount.mood).toBe(1);
    expect(first.ctx.state).toBe("KPI_CAPTURE");
    ctx = first.ctx;
    const second = transition(ctx, { type: "CLARIFICATION", question: "mood", reason: "type" });
    expect(replyOf(second.effects)).toMatchObject({ kind: "clarify", attempt: 1 });
    expect(second.ctx.clarifyCount.mood).toBe(MAX_CLARIFICATIONS);
    expect(cursorQuestion(second.ctx)).toBe("mood");
  });

  it("after 2 failed clarifications the question is skipped, Cosmo says it can be added at the confirmation, and the cursor advances", () => {
    const ctx = capture({ clarifyCount: { mood: 2 } });
    const r = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "mood", reason: "unclear" });
    expect(r.ctx.skipped).toEqual(["sensor_check", "mood"]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "symptoms", skippedQuestion: "mood" });
    expect(r.ctx.state).toBe("KPI_CAPTURE");
  });

  it("clarifyCount is per question: a failure on symptoms does not use up the mood's budget", () => {
    let ctx = capture({ filled: ["mood"] });
    ctx = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "symptoms", reason: "unclear" }).ctx;
    ctx = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "symptoms", reason: "unclear" }).ctx;
    expect(ctx.clarifyCount).toEqual({ symptoms: 2 });
    const r = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "symptoms", reason: "unclear" });
    expect(r.ctx.skipped).toEqual(["sensor_check", "symptoms"]);
  });

  it("skipping the last open question goes to the read-back and still carries the skip notice", () => {
    const ctx = capture({ filled: filledExcept("exercise"), clarifyCount: { exercise: 2 } });
    const r = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "exercise", reason: "unclear" });
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects)).toMatchObject({ kind: "readBack", skippedQuestion: "exercise" });
  });

  it("an accepted answer resets the clarification counter of its question", () => {
    const ctx = capture({ clarifyCount: { mood: 1 } });
    const r = transition(ctx, { type: "MEASUREMENT_ACCEPTED", keys: ["mood"] });
    expect(r.ctx.clarifyCount.mood).toBeUndefined();
  });

  it("the optional sensor follow-up never blocks: a failed answer is skipped at once, with no clarification", () => {
    const ctx = capture({ filled: filledExcept(), skipped: [] });
    expect(cursorQuestion(ctx)).toBe("sensor_check");
    const r = transition(ctx, { type: "MEASUREMENT_REJECTED", question: "sensor_check", reason: "type" });
    expect(r.ctx.skipped).toEqual(["sensor_check"]);
    expect(r.ctx.clarifyCount.sensor_check).toBeUndefined();
    expect(r.ctx.state).toBe("CONFIRM");
    expect(replyOf(r.effects)).toMatchObject({ kind: "readBack" });
    expect(replyOf(r.effects).skippedQuestion).toBeUndefined();
  });

  it("symptom_note is optional: the symptoms question is filled by the three symptom keys alone", () => {
    const ctx = capture({ filled: ["mood", "symptom_headache", "symptom_dizziness", "symptom_nausea"] });
    expect(cursorQuestion(ctx)).toBe("sleep_quality");
  });

  it("an explicit SKIP advances without a notice", () => {
    const r = transition(capture(), { type: "SKIP", question: "mood" });
    expect(r.ctx.skipped).toEqual(["sensor_check", "mood"]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "ask", question: "symptoms" });
    expect(replyOf(r.effects).skippedQuestion).toBeUndefined();
  });

  it("restating an already recorded value is not a failed answer: the same question is asked again, nothing is counted", () => {
    const ctx = capture({ filled: ["mood"], clarifyCount: { symptoms: 1 } });
    const r = transition(ctx, { type: "ALREADY_RECORDED" });
    expect(r.ctx).toEqual(ctx);
    expect(r.ctx.clarifyCount).toEqual({ symptoms: 1 });
    expect(r.ctx.skipped).toEqual(["sensor_check"]);
    expect(replyOf(r.effects)).toMatchObject({ kind: "restated", question: "symptoms" });
    // however often it happens, the question is never skipped because of it
    let next = r.ctx;
    for (let i = 0; i < 5; i++) next = transition(next, { type: "ALREADY_RECORDED" }).ctx;
    expect(next.skipped).toEqual(["sensor_check"]);
    expect(cursorQuestion(next)).toBe("symptoms");
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
      sensor: { keys: ["heart_rate", "sleep_hours"], flagged: [{ key: "heart_rate", value: 82, usual: 66, direction: "high" }], ask: true },
      sensorFilled: ["heart_rate"],
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
    expect(missingKeys({ filled: ["sensor_note"] })[0]).toBe("mood");
    expect(expectedQuestion(ctxIn("CONFIRM"))).toBeNull();
    expect(expectedQuestion(ctxIn("KPI_CAPTURE"))).toBe("sensor_check");
    expect(expectedQuestion(ctxIn("KPI_CAPTURE", { skipped: ["sensor_check"] }))).toBe("mood");
  });
});
