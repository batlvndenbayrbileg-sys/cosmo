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
      return `Record every value the astronaut just said (any key in missing_keys) with record_measurement. Acknowledge in a few words. ${ask} If the answer is unclear or has no number, call request_clarification for that key and ask again briefly. Do not call correct_measurement.`;
    }
    case "CONFIRM":
      return "The system has read the recorded values back and asked whether everything is correct. If the astronaut confirms, call finish_confirmation with confirmed true. If they say a value is wrong and give the new value, call correct_measurement. If they say no without a value, call finish_confirmation with confirmed false and ask what to change. Do not read the values back yourself.";
    case "SUMMARY":
      return "Phrase the summary from compose_summary. Use only the numbers it contains.";
    case "DONE":
      return "The check-in is complete. Reply with one short, kind closing sentence. Do not call any tool that writes.";
  }
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
    `instruction: ${instructionFor(input)}`,
  ].join("\n");
}
