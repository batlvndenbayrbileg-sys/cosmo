import type { KpiKey, Lang, QuestionDef } from "@/lib/types";
import { getQuestion } from "@/lib/kpi/registry";
import type { Agent, AgentArgs, AgentDecision } from "./agent";
import {
  interpretAnswer,
  interpretCorrection,
  interpretOpportunistic,
  interpretStart,
  interpretYesNo,
  type InterpretedRecord,
  type InterpretResult,
} from "./interpret";
import type { MachineCtx, StartAnswer } from "./machine";
import type { ClarifyReason } from "./templates";
import { detectAskedQuestion } from "./questions";

/**
 * The deterministic agent: the rule-based interpreter of interpret.ts, no network, no model. It powers
 * DEMO_MODE=scripted, every run without an API key, and the per-turn fallback of the live agent.
 */

/** "let's start", "ready", "measure" ... an unmistakable request to begin, used before Cosmo has proposed anything */
const EXPLICIT_START_RE =
  /(?<![\p{L}])(?:let'?s\s+(?:do|go|start|begin|log|get)|lets\s+(?:do|go|start|begin|log)|start|begin|ready|go\s+ahead|measure[\p{L}]*)(?![\p{L}])|хэмж[\p{L}]*|эхэл[\p{L}]*|хийцгээе|хийе(?![\p{L}])/iu;

/**
 * The reading of a small-talk answer. Before the proposal only an explicit request to begin counts (a plain "yeah, I'm
 * fine" answers the greeting); after it, interpretStart decides.
 */
export function startAnswerFor(ctx: Pick<MachineCtx, "proposed">, text: string, lang: Lang): StartAnswer {
  if (!ctx.proposed) return EXPLICIT_START_RE.test(text) ? "yes" : "unclear";
  return interpretStart(text, lang);
}

const SKIP_REQUEST_RE =
  /^[\s.,!?'"-]*(?:skip(?:\s+(?:it|this|that|please))?|pass|next(?:\s+question)?|move\s+on|let'?s\s+move\s+on|алгас[\p{L}]*|дараа[\p{L}]*)[\s.,!?'"-]*$/iu;

/** true when the astronaut asks to skip, or answers an optional question with "nothing" */
export function detectSkip(question: QuestionDef, text: string, lang: Lang, result?: InterpretResult): boolean {
  const res = result ?? interpretAnswer(question, text, lang);
  if (res.records.length > 0) return false;
  if (question.optional && !res.unclear) return true;
  return SKIP_REQUEST_RE.test(text.trim());
}

export function clarifyReasonOf(result: InterpretResult): ClarifyReason {
  if (result.reason === "out_of_range") return "range";
  if (result.reason === "type") return "type";
  return "unclear";
}

export class ScriptedAgent implements Agent {
  readonly name = "scripted" as const;

  async decide(args: AgentArgs): Promise<AgentDecision> {
    const { ctx, text, lang, expected } = args;
    const base: AgentDecision = { records: [], emotion: "neutral" };

    switch (ctx.state) {
      case "GREETING":
      case "SMALL_TALK":
        return {
          ...base,
          records: this.volunteered(args, new Set()),
          startAnswer: startAnswerFor(ctx, text, lang),
        };

      case "KPI_CAPTURE": {
        if (expected === null) return base;
        const question = getQuestion(expected);
        const result = interpretAnswer(question, text, lang);
        const own = result.records;
        const taken = new Set(own.map((r) => r.key));
        const records = [...own, ...this.volunteered(args, taken, question)];
        const decision: AgentDecision = { ...base, records };
        if (own.length === 0) {
          const restated = this.restated(args);
          if (detectSkip(question, text, lang, result)) decision.skip = true;
          else if (restated.length > 0 && result.rejectedKeys.length === 0) {
            // "actually I slept 8 hours" while mood is being asked: a change of mind about a recorded value, not a
            // failed answer to the open question
            decision.restated = restated;
          } else {
            // a question back ("what should it be?", "why?", "say it again") is answered, not treated as a failed answer
            const asked = result.rejectedKeys.length === 0 ? detectAskedQuestion(text, lang) : null;
            if (asked) {
              decision.asked = { kind: asked };
            } else {
              const reason = clarifyReasonOf(result);
              const keys = result.rejectedKeys.length > 0 ? result.rejectedKeys : [question.keys[0]];
              decision.clarifications = keys.map((key) => ({ key, reason }));
            }
          }
        }
        return decision;
      }

      case "CONFIRM": {
        const { result } = interpretCorrection(text, lang);
        const decision: AgentDecision = { ...base, yesNo: interpretYesNo(text, lang) };
        if (!result.unclear && result.records.length > 0) decision.correction = result.records;
        else if (result.rejectedKeys.length > 0) {
          decision.rejected = result.rejectedKeys.map((key) => ({ key, reason: clarifyReasonOf(result) }));
        }
        return decision;
      }

      default:
        return base;
    }
  }

  /** keys the astronaut spoke again although they already hold a value */
  private restated(args: AgentArgs): KpiKey[] {
    const filled = new Set<string>(args.ctx.filled);
    return [...new Set(interpretOpportunistic(args.text, args.lang).filter((r) => filled.has(r.key)).map((r) => r.key))];
  }

  /** values volunteered for questions that are still open (never for a key that already has a value) */
  private volunteered(args: AgentArgs, taken: Set<string>, answering?: QuestionDef): InterpretedRecord[] {
    const filled = new Set<string>(args.ctx.filled);
    return interpretOpportunistic(args.text, args.lang).filter(
      (r) => !filled.has(r.key) && !taken.has(r.key) && !(answering?.keys as string[] | undefined)?.includes(r.key),
    );
  }
}
