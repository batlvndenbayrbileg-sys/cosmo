/**
 * Conversation state machine (docs/PLAN.md section 4.1, question set from docs/DASHBOARD_PLAN.md).
 *
 *   GREETING -> SMALL_TALK -> KPI_CAPTURE -> CONFIRM -> SUMMARY -> DONE
 *
 * `transition(ctx, event)` is a PURE reducer: no I/O, no clock, no randomness. It returns the next context and a list
 * of effects (data). The turn pipeline (turn.ts) validates and persists measurements, turns what happened into
 * events, runs the reducer and renders the last `reply` effect into words with templates.ts.
 *
 * Rules implemented here:
 *  - the cursor is the registry's nextQuestion(filled, skipped): a question whose keys are all filled is never asked,
 *    so values volunteered early (rule-based or by the LLM) are accepted in any state before CONFIRM;
 *  - clarifyCount is kept per question: after MAX_CLARIFICATIONS (2) failed clarifications the question is skipped and
 *    Cosmo says it can be added at the confirmation;
 *  - optional questions (symptom_note inside "symptoms", day_note) never block: a failed day_note answer is a skip;
 *  - small talk lasts two astronaut turns, then Cosmo proposes the measurements; a "no" is acknowledged and the offer
 *    is repeated;
 *  - CONFIRM: a correction updates that key and asks again, "no" without a usable correction asks what to change,
 *    "yes" moves to SUMMARY;
 *  - DONE: further turns get a closing reply and every write event is refused;
 *  - friend mode (COMPANION_* / CRISIS, any state but SUMMARY): a conversation on the side that only sets the
 *    companion fields; COMPANION_LEAVE resumes exactly where the check-in was.
 * The context is persisted in check_in.state_json (the `state` column holds ctx.state).
 */

import type { ConversationState, KpiKey, QuestionId } from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { QUESTIONS, getQuestion, nextQuestion } from "@/lib/kpi/registry";
import type { ClarifyReason } from "./templates";

/** failed clarifications per question before it is skipped */
export const MAX_CLARIFICATIONS = 2;

/** astronaut turns of small talk (the reply to the greeting included) before Cosmo proposes the measurements */
export const SMALL_TALK_TURNS = 2;

export type StartAnswer = "yes" | "no" | "unclear";

export interface MachineCtx {
  state: ConversationState;
  /** astronaut turns spent in small talk so far */
  smallTalkTurns: number;
  /** Cosmo has proposed "shall we log today's measurements?" */
  proposed: boolean;
  /** failed clarifications per question */
  clarifyCount: Partial<Record<QuestionId, number>>;
  /** questions the cursor passes over (the person can still add the values at the confirmation) */
  skipped: QuestionId[];
  /** keys that hold a value (reconciled from the database at the start of every turn) */
  filled: KpiKey[];
  /**
   * Friend mode (companion.ts): the astronaut asked to talk or shared how they feel. While it is on, turns are a
   * conversation: nothing is recorded, nothing counts as a failed answer, and `state`, the cursor and clarifyCount stay
   * exactly as they were, so leaving resumes the same question (or read-back, or dashboard).
   */
  companion: boolean;
  /** turns spent in the current companion conversation (varies the offline replies) */
  companionTurns: number;
  /** crisis words were heard in this check-in and a red alert was raised (kept for the rest of the check-in) */
  companionCrisis: boolean;
}

/** what was heard in a crisis turn: self-harm / harming others, or a possible medical emergency */
export type CrisisKind = "self" | "medical";

/** where the check-in picks up again when the astronaut leaves the companion conversation */
export type ResumePoint = "propose" | "question" | "readBack" | "dashboard";

export type MachineEvent =
  /** the astronaut spoke in GREETING / SMALL_TALK / DONE; `start` is the rule-based reading of the answer */
  | { type: "USER_TURN"; start: StartAnswer }
  /** one or more values were validated and stored */
  | { type: "MEASUREMENT_ACCEPTED"; keys: KpiKey[] }
  /** nothing usable for the question being asked (validator said no, or no number was found) */
  | { type: "MEASUREMENT_REJECTED"; question: QuestionId; reason: ClarifyReason }
  /** the model asked for a clarification (request_clarification) */
  | { type: "CLARIFICATION"; question: QuestionId; reason: ClarifyReason }
  /** the astronaut asked to skip, or answered an optional question with "nothing" */
  | { type: "SKIP"; question: QuestionId }
  /**
   * during capture: the astronaut only restated values that are already recorded ("actually I slept 8 hours").
   * This is NOT a failed answer: nothing is counted against the question being asked, it is simply asked again.
   */
  | { type: "ALREADY_RECORDED" }
  /** at the confirmation: these keys were changed (or added) */
  | { type: "CORRECTION_ACCEPTED"; keys: KpiKey[] }
  /** at the confirmation: a correction could not be used (out of range, not a number, not in the astronaut's words) */
  | { type: "CORRECTION_REJECTED"; question: QuestionId; reason: ClarifyReason }
  /** at the confirmation: yes / no / neither (null) */
  | { type: "CONFIRMATION"; confirmed: boolean | null }
  /** the summary has been produced and handed to the voice */
  | { type: "SUMMARY_SPOKEN" }
  /** friend mode: the astronaut asked to talk, or shared a feeling (companion.ts) */
  | { type: "COMPANION_ENTER" }
  /** friend mode: one more turn of the conversation */
  | { type: "COMPANION_TURN" }
  /** friend mode: the astronaut is ready to go on; the check-in resumes where it was */
  | { type: "COMPANION_LEAVE" }
  /** crisis words: the crisis template is said, an alert is raised, and friend mode stays on */
  | { type: "CRISIS"; kind: CrisisKind };

export type ReplyKind =
  | "smallTalk"
  | "smallTalkPropose"
  | "proposeAgain"
  | "ask"
  | "clarify"
  | "restated"
  | "readBack"
  | "correctionAck"
  | "askWhatToChange"
  | "closing"
  | "companion"
  | "companionLeave"
  | "crisis";

export type Effect =
  | {
      type: "reply";
      kind: ReplyKind;
      /** ask / clarify: the question concerned */
      question?: QuestionId;
      /** clarify: clarifications already made for the question (0 for the first) */
      attempt?: number;
      reason?: ClarifyReason;
      /** ask: keys acknowledged in this reply; correctionAck: the corrected keys */
      keys?: KpiKey[];
      /** set when a question was skipped after failed clarifications: Cosmo says it can be added later */
      skippedQuestion?: QuestionId;
      /** companionLeave: what Cosmo repeats so the check-in goes on (with `question` for "question") */
      resume?: ResumePoint;
      /** crisis: what was heard */
      crisis?: CrisisKind;
    }
  | { type: "computeSummary" }
  | { type: "refused"; reason: "done" | "illegal_state" };

export interface TransitionResult {
  ctx: MachineCtx;
  effects: Effect[];
}

/* ───────────── construction and persistence ───────────── */

export function initialCtx(): MachineCtx {
  return {
    state: "GREETING",
    smallTalkTurns: 0,
    proposed: false,
    clarifyCount: {},
    skipped: [],
    filled: [],
    companion: false,
    companionTurns: 0,
    companionCrisis: false,
  };
}

const QUESTION_IDS = new Set<string>(QUESTIONS.map((q) => q.id));
const KEY_SET = new Set<string>(KPI_KEYS);

/** everything except `state` (that lives in its own column) */
export function serializeCtx(ctx: MachineCtx): string {
  const { state: _state, ...rest } = ctx;
  void _state;
  return JSON.stringify(rest);
}

/** tolerant parse: unknown or malformed fields fall back to the initial values */
export function parseCtx(state: ConversationState, json: string | null | undefined): MachineCtx {
  const ctx = initialCtx();
  ctx.state = state;
  if (!json) return ctx;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return ctx;
  }
  if (typeof raw !== "object" || raw === null) return ctx;
  const o = raw as Record<string, unknown>;
  if (typeof o.smallTalkTurns === "number" && Number.isFinite(o.smallTalkTurns) && o.smallTalkTurns >= 0) {
    ctx.smallTalkTurns = Math.trunc(o.smallTalkTurns);
  }
  if (typeof o.proposed === "boolean") ctx.proposed = o.proposed;
  if (typeof o.clarifyCount === "object" && o.clarifyCount !== null && !Array.isArray(o.clarifyCount)) {
    for (const [id, n] of Object.entries(o.clarifyCount as Record<string, unknown>)) {
      if (QUESTION_IDS.has(id) && typeof n === "number" && Number.isFinite(n) && n >= 0) {
        ctx.clarifyCount[id as QuestionId] = Math.trunc(n);
      }
    }
  }
  if (Array.isArray(o.skipped)) {
    ctx.skipped = o.skipped.filter((id): id is QuestionId => typeof id === "string" && QUESTION_IDS.has(id));
  }
  if (Array.isArray(o.filled)) {
    ctx.filled = o.filled.filter((k): k is KpiKey => typeof k === "string" && KEY_SET.has(k));
  }
  // friend mode (absent in contexts written before it existed: off)
  if (typeof o.companion === "boolean") ctx.companion = o.companion;
  if (typeof o.companionTurns === "number" && Number.isFinite(o.companionTurns) && o.companionTurns >= 0) {
    ctx.companionTurns = Math.trunc(o.companionTurns);
  }
  if (typeof o.companionCrisis === "boolean") ctx.companionCrisis = o.companionCrisis;
  return ctx;
}

/* ───────────── cursor ───────────── */

/** the question to ask next: the first not fully filled, not skipped one (null when none remain) */
export function cursorQuestion(ctx: Pick<MachineCtx, "filled" | "skipped">): QuestionId | null {
  return nextQuestion(new Set(ctx.filled), new Set(ctx.skipped))?.id ?? null;
}

/** the question a key belongs to */
export function questionOfKey(key: KpiKey): QuestionId {
  for (const q of QUESTIONS) if (q.keys.includes(key)) return q.id;
  throw new Error(`Key without a question: ${key}`);
}

/** the question the astronaut is currently being asked, null outside KPI_CAPTURE */
export function expectedQuestion(ctx: MachineCtx): QuestionId | null {
  return ctx.state === "KPI_CAPTURE" ? cursorQuestion(ctx) : null;
}

/** keys still without a value, in question order (optional free-text keys included) */
export function missingKeys(ctx: Pick<MachineCtx, "filled">): KpiKey[] {
  const filled = new Set(ctx.filled);
  const out: KpiKey[] = [];
  for (const q of QUESTIONS) for (const k of q.keys) if (!filled.has(k)) out.push(k);
  return out;
}

/* ───────────── reducer ───────────── */

function union(a: readonly KpiKey[], b: readonly KpiKey[]): KpiKey[] {
  const set = new Set<KpiKey>(a);
  for (const k of b) set.add(k);
  return [...set];
}

function reply(effect: Omit<Extract<Effect, { type: "reply" }>, "type">): Effect {
  return { type: "reply", ...effect };
}

/** the next step after something was filled or skipped: ask the cursor question, or move on to the read-back */
function advance(ctx: MachineCtx, extra: { keys?: KpiKey[]; skippedQuestion?: QuestionId }): TransitionResult {
  const next = cursorQuestion(ctx);
  if (next === null) {
    return {
      ctx: { ...ctx, state: "CONFIRM" },
      effects: [reply({ kind: "readBack", skippedQuestion: extra.skippedQuestion })],
    };
  }
  return {
    ctx: { ...ctx, state: "KPI_CAPTURE" },
    effects: [reply({ kind: "ask", question: next, keys: extra.keys, skippedQuestion: extra.skippedQuestion })],
  };
}

function isWrite(event: MachineEvent): boolean {
  return (
    event.type === "MEASUREMENT_ACCEPTED" ||
    event.type === "MEASUREMENT_REJECTED" ||
    event.type === "CLARIFICATION" ||
    event.type === "SKIP" ||
    event.type === "ALREADY_RECORDED" ||
    event.type === "CORRECTION_ACCEPTED" ||
    event.type === "CORRECTION_REJECTED"
  );
}

function skipQuestion(ctx: MachineCtx, question: QuestionId, skippedQuestion?: QuestionId): TransitionResult {
  const skipped = ctx.skipped.includes(question) ? ctx.skipped : [...ctx.skipped, question];
  return advance({ ...ctx, skipped }, { skippedQuestion });
}

function failedAnswer(ctx: MachineCtx, question: QuestionId, reason: ClarifyReason): TransitionResult {
  // an optional question never blocks: a failed answer is simply a skip
  if (getQuestion(question).optional) return skipQuestion(ctx, question);
  const made = ctx.clarifyCount[question] ?? 0;
  if (made < MAX_CLARIFICATIONS) {
    return {
      ctx: { ...ctx, clarifyCount: { ...ctx.clarifyCount, [question]: made + 1 } },
      effects: [reply({ kind: "clarify", question, attempt: made, reason })],
    };
  }
  return skipQuestion(ctx, question, question);
}

/**
 * The pure reducer. Never mutates its input. Events that make no sense in a state return the context unchanged with
 * no effects (or a `refused` effect for writes in DONE / SUMMARY).
 */
export function transition(ctx: MachineCtx, event: MachineEvent): TransitionResult {
  const companion = fromCompanion(ctx, event);
  if (companion) return companion;
  switch (ctx.state) {
    case "GREETING":
    case "SMALL_TALK":
      return fromSmallTalk(ctx, event);
    case "KPI_CAPTURE":
      return fromCapture(ctx, event);
    case "CONFIRM":
      return fromConfirm(ctx, event);
    case "SUMMARY":
      if (event.type === "SUMMARY_SPOKEN") return { ctx: { ...ctx, state: "DONE" }, effects: [] };
      return isWrite(event) ? { ctx, effects: [{ type: "refused", reason: "illegal_state" }] } : { ctx, effects: [] };
    case "DONE":
      if (event.type === "USER_TURN") return { ctx, effects: [reply({ kind: "closing" })] };
      return isWrite(event) ? { ctx, effects: [{ type: "refused", reason: "done" }] } : { ctx, effects: [] };
  }
}

/**
 * Friend mode, in every state but SUMMARY (that one only finishes the summary). Entering, talking and a crisis touch
 * nothing but the companion fields; leaving switches friend mode off and repeats where the check-in stands. Null for
 * every other event.
 */
function fromCompanion(ctx: MachineCtx, event: MachineEvent): TransitionResult | null {
  if (
    event.type !== "COMPANION_ENTER" &&
    event.type !== "COMPANION_TURN" &&
    event.type !== "COMPANION_LEAVE" &&
    event.type !== "CRISIS"
  ) {
    return null;
  }
  if (ctx.state === "SUMMARY") return { ctx, effects: [] };
  switch (event.type) {
    case "COMPANION_ENTER":
      return { ctx: { ...ctx, companion: true, companionTurns: 1 }, effects: [reply({ kind: "companion" })] };
    case "COMPANION_TURN":
      return {
        ctx: { ...ctx, companion: true, companionTurns: ctx.companion ? ctx.companionTurns + 1 : 1 },
        effects: [reply({ kind: "companion" })],
      };
    case "CRISIS":
      return {
        ctx: { ...ctx, companion: true, companionTurns: ctx.companionTurns + 1, companionCrisis: true },
        effects: [reply({ kind: "crisis", crisis: event.kind })],
      };
    case "COMPANION_LEAVE": {
      if (!ctx.companion) return { ctx, effects: [] };
      const base: MachineCtx = { ...ctx, companion: false, companionTurns: 0 };
      switch (ctx.state) {
        case "GREETING":
        case "SMALL_TALK":
          // the next step of the check-in is the measurements: propose them (the next answer is read as the reply)
          return {
            ctx: { ...base, state: "SMALL_TALK", proposed: true },
            effects: [reply({ kind: "companionLeave", resume: "propose" })],
          };
        case "KPI_CAPTURE": {
          const next = cursorQuestion(base);
          if (next === null) {
            return { ctx: { ...base, state: "CONFIRM" }, effects: [reply({ kind: "companionLeave", resume: "readBack" })] };
          }
          return { ctx: base, effects: [reply({ kind: "companionLeave", resume: "question", question: next })] };
        }
        case "CONFIRM":
          return { ctx: base, effects: [reply({ kind: "companionLeave", resume: "readBack" })] };
        case "DONE":
          return { ctx: base, effects: [reply({ kind: "companionLeave", resume: "dashboard" })] };
      }
    }
  }
}

function fromSmallTalk(ctx: MachineCtx, event: MachineEvent): TransitionResult {
  switch (event.type) {
    case "MEASUREMENT_ACCEPTED":
      // volunteered early: accepted, no reply of its own (the USER_TURN of the same turn decides what is said)
      return { ctx: { ...ctx, filled: union(ctx.filled, event.keys) }, effects: [] };

    case "USER_TURN": {
      // the very first answer to the greeting always counts as small talk, whatever it says
      if (ctx.state === "GREETING") {
        return {
          ctx: { ...ctx, state: "SMALL_TALK", smallTalkTurns: ctx.smallTalkTurns + 1 },
          effects: [reply({ kind: "smallTalk" })],
        };
      }
      const turns = ctx.smallTalkTurns + 1;
      if (ctx.proposed) {
        if (event.start === "no") {
          return { ctx: { ...ctx, smallTalkTurns: turns }, effects: [reply({ kind: "proposeAgain" })] };
        }
        // yes, or anything that is not an explicit refusal, moves on
        return advance({ ...ctx, smallTalkTurns: turns }, {});
      }
      if (event.start === "yes") return advance({ ...ctx, smallTalkTurns: turns }, {});
      if (turns >= SMALL_TALK_TURNS) {
        return {
          ctx: { ...ctx, smallTalkTurns: turns, proposed: true },
          effects: [reply({ kind: "smallTalkPropose" })],
        };
      }
      return { ctx: { ...ctx, smallTalkTurns: turns }, effects: [reply({ kind: "smallTalk" })] };
    }

    default:
      return isWrite(event) ? { ctx, effects: [{ type: "refused", reason: "illegal_state" }] } : { ctx, effects: [] };
  }
}

function fromCapture(ctx: MachineCtx, event: MachineEvent): TransitionResult {
  switch (event.type) {
    case "MEASUREMENT_ACCEPTED": {
      const filled = union(ctx.filled, event.keys);
      const clarifyCount = { ...ctx.clarifyCount };
      for (const key of event.keys) delete clarifyCount[questionOfKey(key)];
      return advance({ ...ctx, filled, clarifyCount }, { keys: event.keys });
    }
    case "MEASUREMENT_REJECTED":
    case "CLARIFICATION":
      return failedAnswer(ctx, event.question, event.reason);
    case "SKIP":
      return skipQuestion(ctx, event.question);
    case "ALREADY_RECORDED": {
      // the same question is asked again; no clarification is used up
      const next = cursorQuestion(ctx);
      if (next === null) return advance(ctx, {});
      return { ctx, effects: [reply({ kind: "restated", question: next })] };
    }
    default:
      return isWrite(event) ? { ctx, effects: [{ type: "refused", reason: "illegal_state" }] } : { ctx, effects: [] };
  }
}

function fromConfirm(ctx: MachineCtx, event: MachineEvent): TransitionResult {
  switch (event.type) {
    case "CORRECTION_ACCEPTED": {
      const filled = union(ctx.filled, event.keys);
      const touched = new Set(event.keys.map(questionOfKey));
      const skipped = ctx.skipped.filter((q) => !touched.has(q));
      return {
        ctx: { ...ctx, filled, skipped },
        effects: [reply({ kind: "correctionAck", keys: event.keys })],
      };
    }
    case "CORRECTION_REJECTED":
      // the value stays as it was; the person is told why and the read-back stays open (never a skip: there is no
      // "add it later" after the read-back)
      return { ctx, effects: [reply({ kind: "clarify", question: event.question, attempt: 0, reason: event.reason })] };
    case "CONFIRMATION":
      if (event.confirmed === true) return { ctx: { ...ctx, state: "SUMMARY" }, effects: [{ type: "computeSummary" }] };
      if (event.confirmed === false) return { ctx, effects: [reply({ kind: "askWhatToChange" })] };
      return { ctx, effects: [reply({ kind: "readBack" })] };
    case "MEASUREMENT_ACCEPTED":
    case "MEASUREMENT_REJECTED":
    case "CLARIFICATION":
    case "SKIP":
      // new measurements are no longer taken after the read-back: changes arrive as corrections
      return { ctx, effects: [{ type: "refused", reason: "illegal_state" }] };
    default:
      return { ctx, effects: [] };
  }
}
