import type { CrewPublic, KpiKey, Lang, SummaryFindings, TurnRow } from "@/lib/types";
import type { ResultsFacts } from "./resultsFacts";
import { getQuestion } from "@/lib/kpi/registry";
import type { Agent, AgentArgs, AgentDecision } from "./agent";
import { ScriptedAgent } from "./scriptedAgent";

/**
 * Live agent with an instant path, for a Siri-like feel without giving up the model where it matters.
 *
 * For every turn the deterministic rules (ScriptedAgent) read the utterance first (microseconds, no network). When
 * that reading is complete and unambiguous - the expected question fully answered, a clear "yes" at the read-back, a
 * clear correction, or a clear "yes, let's start" - the turn is decided without the model and Cosmo answers with the
 * code-built template. Everything else (small talk, unclear, partial or out-of-range answers, "no" at the read-back)
 * goes to the live model (Claude). The final summary is still phrased by the live model (it runs while the client shows
 * "Preparing your dashboard...").
 *
 * Both paths propose; the turn pipeline validates every value through the same executeTool path either way.
 */

/** minimum confidence of every rule-based record for the instant path (word-derived answers are 0.6, see interpret.ts) */
export const FAST_PATH_MIN_CONFIDENCE = 0.6;

export interface FastPathVerdict {
  fast: boolean;
  reason: string;
}

/** pure: may this rule-based decision be used without asking the model? */
export function fastPathVerdict(args: Pick<AgentArgs, "ctx" | "expected">, rules: AgentDecision): FastPathVerdict {
  const confident = (records: AgentDecision["records"]) =>
    records.length > 0 && records.every((r) => r.confidence >= FAST_PATH_MIN_CONFIDENCE);

  switch (args.ctx.state) {
    case "GREETING":
    case "SMALL_TALK":
      // warmth is the model's job; only an unmistakable "let's start" after the proposal skips it
      return args.ctx.proposed && rules.startAnswer === "yes" && rules.records.length === 0
        ? { fast: true, reason: "clear start" }
        : { fast: false, reason: "small talk" };

    case "KPI_CAPTURE": {
      if (args.expected === null) return { fast: false, reason: "no expected question" };
      // "what should it be / why / how / say it again": the registry answers instantly; anything else goes to the model
      if (rules.asked && rules.asked.kind !== "other") return { fast: true, reason: "question back with a known answer" };
      if (rules.clarifications?.length || rules.rejected?.length || rules.restated?.length) {
        return { fast: false, reason: "unclear or rejected" };
      }
      if (rules.skip) return { fast: true, reason: "skip / nothing to add" };
      const question = getQuestion(args.expected);
      const own = rules.records.filter((r) => (question.keys as KpiKey[]).includes(r.key));
      const required = question.keys.filter((k) => k !== "symptom_note" && k !== "day_note");
      const covered = required.every((k) => own.some((r) => r.key === k));
      return covered && confident(own)
        ? { fast: true, reason: "expected question fully answered" }
        : { fast: false, reason: "partial or low-confidence answer" };
    }

    case "CONFIRM": {
      if (rules.rejected?.length) return { fast: false, reason: "unusable correction" };
      if (rules.correction?.length) {
        return confident(rules.correction) ? { fast: true, reason: "clear correction" } : { fast: false, reason: "unsure correction" };
      }
      return rules.yesNo === true ? { fast: true, reason: "clear yes" } : { fast: false, reason: "no or unclear" };
    }

    default:
      return { fast: true, reason: "nothing to understand" };
  }
}

export class HybridAgent implements Agent {
  readonly name = "claude" as const;
  private readonly rules: Agent;

  constructor(
    private readonly live: Agent,
    rules?: Agent,
  ) {
    this.rules = rules ?? new ScriptedAgent();
  }

  async decide(args: AgentArgs): Promise<AgentDecision> {
    const fromRules = await this.rules.decide(args);
    const verdict = fastPathVerdict(args, fromRules);
    if (verdict.fast) return { ...fromRules, llmMs: 0 };
    // may throw LlmUnavailable: the pipeline then falls back to the scripted agent for this turn
    return this.live.decide(args);
  }

  async phraseSummary(args: { findings: SummaryFindings; lang: Lang; crew: CrewPublic }): Promise<string | null> {
    return this.live.phraseSummary ? this.live.phraseSummary(args) : null;
  }

  async answerAboutResults(args: { facts: ResultsFacts; question: string; lang: Lang; history: TurnRow[] }): Promise<string | null> {
    return this.live.answerAboutResults ? this.live.answerAboutResults(args) : null;
  }
}
