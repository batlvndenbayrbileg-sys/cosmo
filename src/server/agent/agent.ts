import type {
  CrewPublic,
  KpiKey,
  Lang,
  MeasurementValue,
  QuestionId,
  SummaryFindings,
  TurnRow,
} from "@/lib/types";
import type { InterpretedRecord } from "./interpret";
import type { MachineCtx, StartAnswer } from "./machine";
import type { ClarifyReason } from "./templates";
import type { ToolResult } from "./tools";
import type { ResultsFacts } from "./resultsFacts";
import type { AskedKind } from "./questions";

/**
 * The seam between the conversation and whoever understands the astronaut's words.
 *
 * An Agent only READS the utterance and proposes what it heard; it never writes. The turn pipeline (turn.ts) applies
 * every proposed record through executeTool (tools.ts), so the rule-based and the live agent share one validation path.
 * The state machine (machine.ts), not the agent, decides what happens next.
 */

export type Emotion = "neutral" | "happy" | "concerned";

/** thrown by a live agent when the model cannot be used for this turn: the pipeline falls back to the scripted agent */
export class LlmUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`LLM unavailable: ${reason}`, options);
    this.name = "LlmUnavailable";
    this.reason = reason;
  }
}

export interface AgentArgs {
  crew: CrewPublic;
  /** the context at the START of the turn (filled keys reconciled from the database) */
  ctx: MachineCtx;
  /** the astronaut's utterance */
  text: string;
  /** the language Cosmo answers in */
  lang: Lang;
  /** the question the cursor points at (null outside KPI_CAPTURE) */
  expected: QuestionId | null;
  /** everything stored so far for this check-in */
  recorded: Partial<Record<KpiKey, MeasurementValue>>;
  /** earlier turns of this check-in, oldest first, WITHOUT the current utterance */
  history: TurnRow[];
  /** validate a tool call exactly as the pipeline will, without writing anything */
  validate: (name: string, input: unknown) => Promise<ToolResult>;
  /**
   * KPI_CAPTURE: what Cosmo may say if the astronaut asks about the open question instead of answering it (the
   * demo-parameter range, the personal 14-day baseline, why it is asked, how to measure it). See questions.ts.
   */
  questionFacts?: string;
}

export interface AgentDecision {
  /** values heard in this utterance, any state before the read-back */
  records: InterpretedRecord[];
  /** at the read-back: values to change (or add) */
  correction?: InterpretedRecord[];
  /** the model (or the rules) could not use the answer for these keys */
  clarifications?: Array<{ key: KpiKey; reason: ClarifyReason }>;
  /** proposals the validator already refused during the agent's own checks */
  rejected?: Array<{ key: KpiKey; reason: ClarifyReason }>;
  /**
   * keys the astronaut mentioned again although they already hold a value ("actually I slept 8 hours" while another
   * question is open). Not a failed answer: the pipeline notes it for the read-back and asks the open question again.
   */
  restated?: KpiKey[];
  /** the astronaut asked to skip the question, or answered an optional one with "nothing" */
  skip?: boolean;
  /**
   * KPI_CAPTURE: the astronaut asked a question back instead of answering ("what should it be?", "why?", "say it
   * again"). Cosmo answers (the model's `answer` when it passes the checks in turn.ts, else the template for `kind`) and
   * asks the open question again; it is never counted as a failed answer.
   */
  asked?: { kind: AskedKind; answer?: string };
  /** at the read-back: yes / no / not clear (null) */
  yesNo?: boolean | null;
  /** in small talk: did the astronaut agree to start the measurements */
  startAnswer?: StartAnswer;
  /** wording proposed by a live model; used only when it passes the sanity checks in turn.ts */
  replyText?: string;
  emotion: Emotion;
  /** time spent in the model, milliseconds (live agents only) */
  llmMs?: number;
}

export interface Agent {
  readonly name: "scripted" | "claude";
  decide(args: AgentArgs): Promise<AgentDecision>;
  /**
   * Optional: phrase the summary in the reply language from the code-computed findings. The pipeline accepts the
   * text only when every numeral in it appears in the findings; null means "use the template".
   */
  phraseSummary?(args: { findings: SummaryFindings; lang: Lang; crew: CrewPublic }): Promise<string | null>;
  /**
   * Optional: after the check-in (state DONE), answer the astronaut's question about today's results using ONLY the
   * code-computed facts. The pipeline accepts the text only when every numeral in it appears in the facts or in the
   * astronaut's words; null means "use the template".
   */
  answerAboutResults?(args: { facts: ResultsFacts; question: string; lang: Lang; history: TurnRow[] }): Promise<string | null>;
  /**
   * Optional: friend mode (companion.ts). Word a warm, short reply to what the astronaut shared. Never called for a
   * crisis turn (that reply is always the code template). The pipeline accepts the text only when it passes
   * companion.isSaneCompanionReply; null (or a throw) means "use the template".
   */
  companionReply?(args: CompanionReplyArgs): Promise<string | null>;
}

export interface CompanionReplyArgs {
  crew: CrewPublic;
  /** the context at the start of the turn: the state the check-in waits in, companionTurns, companionCrisis */
  ctx: MachineCtx;
  /** turn of the companion conversation, 1 for the first */
  turn: number;
  text: string;
  lang: Lang;
  /** earlier turns of this check-in, oldest first, WITHOUT the current utterance */
  history: TurnRow[];
}
