import type { ConversationState, KpiKey, Lang, MeasurementValue, QuestionId } from "@/lib/types";
import { KPI_DEFS, formatValue, getQuestion } from "@/lib/kpi/registry";
import { missingKeys, type MachineCtx } from "./machine";

/**
 * The per-turn instruction, built by code from the machine context and the stored values (docs/PLAN.md section 4.3).
 * It is the ONLY thing that changes between model requests besides the conversation itself, and it is appended after
 * the frozen system prompt. The model proposes wording; this text keeps it on the state machine's track.
 */

export interface DirectiveInput {
  state: ConversationState;
  lang: Lang;
  crewName: string;
  ctx: Pick<MachineCtx, "smallTalkTurns" | "proposed" | "filled">;
  expected: QuestionId | null;
  recorded: Partial<Record<KpiKey, MeasurementValue>>;
  /** KPI_CAPTURE: facts about the open question the reply may use when the astronaut asks about it (questions.ts) */
  questionFacts?: string;
}

const LANGUAGE_NAME: Record<Lang, string> = { en: "English", mn: "Mongolian (Cyrillic)" };

/** the running KPI JSON: what is stored, rendered with its unit, in key order */
export function recordedJson(recorded: Partial<Record<KpiKey, MeasurementValue>>): string {
  const out: Record<string, string> = {};
  for (const key of Object.keys(KPI_DEFS) as KpiKey[]) {
    const v = recorded[key];
    if (v === undefined) continue;
    out[key] = KPI_DEFS[key].type === "text" ? String(v) : formatValue(key, v, "en");
  }
  return JSON.stringify(out);
}

function instructionFor(input: DirectiveInput): string {
  const { state, ctx, expected, lang } = input;
  switch (state) {
    case "GREETING":
    case "SMALL_TALK": {
      const willPropose = state === "SMALL_TALK" && !ctx.proposed && ctx.smallTalkTurns + 1 >= 2;
      const tail = willPropose
        ? "After one warm sentence, propose logging today's measurements together (a short question)."
        : "Reply with one warm sentence only. Do not propose the measurements yet.";
      return `Small talk. ${tail} Record a value only if the astronaut volunteered one with its number.`;
    }
    case "KPI_CAPTURE": {
      const q = expected ? getQuestion(expected) : null;
      const ask = q
        ? `Then ask about "${q.id}" unless the astronaut just answered it: "${q.prompts[lang]}"`
        : "Then ask the next missing question.";
      return `Record every value the astronaut just said (any key in missing_keys) with record_measurement. Acknowledge in a few words. ${ask} If the astronaut asks YOU something instead of answering (what is normal, why you ask, how to measure it, or anything else), do NOT call request_clarification: answer the question in one or two short sentences, using only numbers from question_facts, then ask the expected question again. Never diagnose. Only if the answer is unclear or has no number and is not a question, call request_clarification for that key and ask again briefly. Do not call correct_measurement.`;
    }
    case "CONFIRM":
      return "The system has read the recorded values back and asked whether everything is correct. If the astronaut confirms, call finish_confirmation with confirmed true. If they say a value is wrong and give the new value, call correct_measurement. If they say no without a value, call finish_confirmation with confirmed false and ask what to change. Do not read the values back yourself.";
    case "SUMMARY":
      return "Phrase the summary from compose_summary. Use only the numbers it contains.";
    case "DONE":
      return "The check-in is complete. Reply with one short, kind closing sentence. Do not call any tool that writes.";
  }
}

export interface CompanionDirectiveInput {
  /** the state the check-in waits in (it is NOT changed by a companion turn) */
  state: ConversationState;
  lang: Lang;
  crewName: string;
  /** turn of the companion conversation, 1 for the first */
  turn: number;
  /** crisis words were heard earlier in this check-in and the medical officer and ground were alerted */
  crisisRaised: boolean;
}

/**
 * Friend mode (companion.ts): the per-turn instruction while the astronaut talks with Cosmo as a friend. Like the
 * check-in directive it follows the frozen system prompt (whose prefix stays byte-identical); every companion rule lives
 * here. The pipeline still checks the wording (companion.isSaneCompanionReply) and never uses model wording for a
 * crisis turn.
 */
export function buildCompanionDirective(input: CompanionDirectiveInput): string {
  const paused =
    input.state === "KPI_CAPTURE"
      ? "in the middle of the measurements"
      : input.state === "CONFIRM"
        ? "at the read-back of today's values"
        : input.state === "DONE" || input.state === "SUMMARY"
          ? "after the check-in, on the dashboard"
          : "before the measurements";
  const instruction = [
    "The astronaut asked to talk with you, or shared how they feel. Be a warm, attentive friend who listens, not a doctor and not a therapist.",
    "In this mode you may use up to three short sentences: reflect back in your own words what you heard, gently validate the feeling, and end with ONE gentle open question about them.",
    "When it fits, offer one practical self-care idea for life on a station: a slow breathing exercise, a steady sleep routine, calling or writing to family when the schedule allows, talking with a crewmate they trust, a short break at the window.",
    "Never diagnose, never name a condition, never mention a medication, a drug, a supplement or a dose, and never promise outcomes.",
    "Do not record anything and do not call any tool. Do not ask about the check-in questions; the check-in waits and resumes when the astronaut says they are ready (for example \"let's continue\"). Mention that only now and then, never push.",
    "If they mention wanting to harm themselves or someone else, wanting to die, or a medical emergency, say clearly that they should contact the crew medical officer or the flight surgeon right now.",
    "Write any count in words, never digits. No emojis, no lists.",
    ...(input.crisisRaised
      ? ["Earlier in this check-in they said something that needed urgent support and the medical officer and ground were alerted: stay calm and caring, and keep encouraging them to talk to the medical officer now."]
      : []),
  ].join(" ");
  return [
    "DIRECTIVE (written by the system, not by the astronaut)",
    "mode: COMPANION (friend mode)",
    `check_in_paused: ${input.state} - ${paused}`,
    `reply_language: ${LANGUAGE_NAME[input.lang]}`,
    `astronaut_name: ${input.crewName}`,
    `companion_turn: ${Math.max(1, Math.trunc(input.turn))}`,
    `instruction: ${instruction}`,
  ].join("\n");
}

export function buildDirective(input: DirectiveInput): string {
  const expectedText = input.expected ? input.expected : "none";
  const missing = missingKeys({ filled: input.ctx.filled });
  return [
    "DIRECTIVE (written by the system, not by the astronaut)",
    `state: ${input.state}`,
    `reply_language: ${LANGUAGE_NAME[input.lang]}`,
    `astronaut_name: ${input.crewName}`,
    `expected_question: ${expectedText}`,
    `missing_keys: ${JSON.stringify(missing)}`,
    `recorded: ${recordedJson(input.recorded)}`,
    ...(input.state === "KPI_CAPTURE" && input.questionFacts ? [`question_facts: ${input.questionFacts}`] : []),
    `instruction: ${instructionFor(input)}`,
  ].join("\n");
}
