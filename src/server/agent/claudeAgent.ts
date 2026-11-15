import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { KpiKey, Lang, SummaryFindings, TurnRow } from "@/lib/types";
import { KPI_DEFS, getQuestion } from "@/lib/kpi/registry";
import { getEnv } from "@/server/env";
import {
  LlmUnavailable,
  type Agent,
  type AgentArgs,
  type AgentDecision,
  type AssistantReplyArgs,
  type CompanionReplyArgs,
} from "./agent";
import { buildCompanionDirective, buildDirective } from "./directive";
import { interpretYesNo, type InterpretedRecord } from "./interpret";
import { SYSTEM_PROMPT } from "./prompt";
import { detectSkip, startAnswerFor } from "./scriptedAgent";
import { detectAskedQuestion } from "./questions";
import type { ClarifyReason } from "./templates";
import { TOOL_DEFINITIONS, type ToolResult } from "./tools";
import type { ResultsFacts } from "./resultsFacts";
import { SIGNATURE_PROMPT_ADDITION, SPACE_PROMPT_ADDITION, SPACE_TOOL_NAME, type SignatureAnswerArgs } from "./signature";

/**
 * The live agent: Claude through the Messages API with tool use (docs/PLAN.md sections 4.2 to 4.4).
 *
 * Request rules for the current model family, all asserted in tests/claude-agent.test.ts:
 *  - model from getEnv().anthropicModel; streaming via client.messages.stream(...).finalMessage();
 *  - tool_choice is "auto" only (forced "any"/"tool" is an HTTP 400); every tool is strict; the tool list is constant;
 *  - output_config.effort "low"; no temperature, top_p, top_k; no assistant prefill; no thinking parameter;
 *  - stop_reason "refusal" or "max_tokens" is checked BEFORE any tool runs and throws LlmUnavailable;
 *  - the last 20 turns plus the running KPI JSON and a code-built directive follow the frozen system prompt;
 *  - one model call per spoken turn on the happy path (reply text and tool calls in one assistant message); a second
 *    call is made only when a tool call was rejected, or the model asked for data (get_baseline, compose_summary).
 *
 * The agent never writes: tool calls are VALIDATED with the pipeline's own validator (`args.validate`, a dry run of
 * executeTool) and returned as records; turn.ts applies them through the same executeTool path as the scripted agent.
 * Any API failure, timeout, refusal or missing key throws LlmUnavailable and the pipeline falls back for that turn.
 */

export const HISTORY_TURNS = 20;
export const MAX_OUTPUT_TOKENS = 700;
export const REQUEST_TIMEOUT_MS = 8000;

/** the slice of the SDK this agent needs: injectable so tests can pass a fake */
export interface LlmClient {
  messages: {
    stream(
      body: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ): { finalMessage(): Promise<Anthropic.Message> };
  };
}

export interface ClaudeAgentOptions {
  client?: LlmClient | null;
  /** overrides getEnv().anthropicModel (tests) */
  model?: string;
  timeoutMs?: number;
  /**
   * Where the per-turn directive goes. "system" appends a mid-conversation system message after the latest user
   * message (keeps the cached prefix); "user" puts it in the user turn, for a model that rejects system messages.
   */
  directiveRole?: "system" | "user";
  /**
   * The wording methods (companionReply, answerAboutResults, phraseSummary) normally return null on any failure. With
   * this set, a refusal is thrown as LlmUnavailable("refusal") instead, so a TieredAgent can tell it apart from "no
   * text" and stop at the templates rather than asking a weaker model to write what Claude refused to.
   */
  surfaceRefusals?: boolean;
}

export function isRefusal(err: unknown): err is LlmUnavailable {
  return err instanceof LlmUnavailable && err.reason === "refusal";
}

const INFORMATIONAL_TOOLS = new Set(["get_baseline", "compose_summary"]);

type ToolUse = { id: string; name: string; input: unknown };
type Called = { use: ToolUse; result: ToolResult };

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function toolUsesOf(message: Anthropic.Message): ToolUse[] {
  return message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

/** the last HISTORY_TURNS turns as alternating user/assistant messages, ending with the current utterance */
export function buildMessages(history: TurnRow[], utterance: string): Anthropic.MessageParam[] {
  const turns = history.filter((t) => t.speaker !== "system").slice(-HISTORY_TURNS);
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  const push = (role: "user" | "assistant", content: string) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${content}`;
    else out.push({ role, content });
  };
  for (const t of turns) push(t.speaker === "crew" ? "user" : "assistant", t.text);
  if (out.length > 0 && out[0].role === "assistant") out.unshift({ role: "user", content: "(the check-in begins)" });
  push("user", utterance);
  return out;
}

/** a few words of plain agreement ("sounds right", "that's correct"): no question, no number */
function isShortAffirmation(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || /[?\d]/u.test(t)) return false;
  const words = t.split(/\s+/u).filter((w) => /\p{L}/u.test(w));
  return words.length > 0 && words.length <= 4;
}

/**
 * The read-back answer. The confirmation is irreversible (confirmed check-in, stored summary, alerts), so a model's
 * "confirmed: true" is accepted only when the astronaut's own words agree:
 *  - a rule-based "no" always wins; a model "no" (or a rule "yes" the model doubts) re-opens the read-back;
 *  - "true" needs a rule-based "yes", or - when the rules read nothing - a short plain affirmation without a
 *    question mark or a digit; anything else ("what does my blood pressure usually look like?") is `null`, which
 *    repeats the read-back question.
 */
export function resolveConfirmation(text: string, lang: Lang, modelConfirmed: boolean | undefined): boolean | null {
  const rule = interpretYesNo(text, lang);
  if (rule === false) return false;
  if (modelConfirmed === undefined) return rule;
  if (modelConfirmed === false) return false;
  if (rule === true) return true;
  return isShortAffirmation(text) ? true : null;
}

function toClarifyReason(result: ToolResult): ClarifyReason {
  if (!result.ok && result.reason) return result.reason;
  return "unclear";
}

export class ClaudeAgent implements Agent {
  readonly name = "claude" as const;
  private readonly injected: LlmClient | null | undefined;
  private readonly modelOverride: string | undefined;
  private readonly timeoutMs: number;
  private readonly directiveRole: "system" | "user";
  private readonly surfaceRefusals: boolean;
  private lazyClient: LlmClient | null | undefined;

  constructor(options: ClaudeAgentOptions = {}) {
    this.injected = options.client;
    this.modelOverride = options.model;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.directiveRole = options.directiveRole ?? "system";
    this.surfaceRefusals = options.surfaceRefusals ?? false;
  }

  /** a wording call that failed: null (the template), or the refusal itself when surfaceRefusals is set */
  private noText(err: unknown): null {
    if (this.surfaceRefusals && isRefusal(err)) throw err;
    return null;
  }

  private client(): LlmClient {
    if (this.injected) return this.injected;
    if (this.lazyClient === undefined) {
      const apiKey = getEnv().anthropicApiKey;
      this.lazyClient = apiKey
        ? (new Anthropic({ apiKey, maxRetries: 1 }) as unknown as LlmClient)
        : null;
    }
    if (!this.lazyClient) throw new LlmUnavailable("no ANTHROPIC_API_KEY");
    return this.lazyClient;
  }

  private model(): string {
    return this.modelOverride ?? getEnv().anthropicModel;
  }

  /** one streamed request, bounded in time; refusal and truncation are errors BEFORE anything is read from it */
  private async call(messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
    const client = this.client();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LlmUnavailable(`timeout after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    let message: Anthropic.Message;
    try {
      const body: Anthropic.MessageStreamParams = {
        model: this.model(),
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [...TOOL_DEFINITIONS],
        tool_choice: { type: "auto" },
        output_config: { effort: "low" },
        messages,
      };
      const stream = client.messages.stream(body, { signal: controller.signal });
      message = await Promise.race([stream.finalMessage(), deadline]);
    } catch (err) {
      if (err instanceof LlmUnavailable) throw err;
      throw new LlmUnavailable("API call failed", { cause: err });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const reason = message.stop_reason;
    if (reason === "refusal") throw new LlmUnavailable("refusal");
    if (reason === "max_tokens") throw new LlmUnavailable("max_tokens");
    if (reason !== "end_turn" && reason !== "tool_use" && reason !== "stop_sequence") {
      throw new LlmUnavailable(`unexpected stop_reason ${String(reason)}`);
    }
    return message;
  }

  private withDirective(base: Anthropic.MessageParam[], directive: string): Anthropic.MessageParam[] {
    if (this.directiveRole === "system") return [...base, { role: "system", content: directive }];
    // fold it into the FIRST user-visible part of the current user turn: the latest user message gets the block
    const messages = base.map((m) => ({ ...m }));
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user" && typeof m.content === "string") {
        messages[i] = { role: "user", content: [{ type: "text", text: directive }, { type: "text", text: m.content }] };
        break;
      }
    }
    return messages;
  }

  async decide(args: AgentArgs): Promise<AgentDecision> {
    const started = Date.now();
    const directive = buildDirective({
      state: args.ctx.state,
      lang: args.lang,
      crewName: args.crew.name,
      ctx: args.ctx,
      expected: args.expected,
      recorded: args.recorded,
      questionFacts: args.questionFacts,
    });
    const base = buildMessages(args.history, args.text);

    const first = await this.call(this.withDirective(base, directive));
    const firstCalls = await this.validateAll(args, toolUsesOf(first));
    let finalText = textOf(first);
    let finalCalls = firstCalls;
    let carried: Called[] = [];

    const needsSecond = firstCalls.some((c) => !c.result.ok || INFORMATIONAL_TOOLS.has(c.use.name));
    if (needsSecond) {
      const withResults: Anthropic.MessageParam[] = [
        ...base,
        // the assistant message goes back exactly as received (thinking blocks included, if any)
        { role: "assistant", content: first.content as Anthropic.ContentBlockParam[] },
        {
          role: "user",
          content: firstCalls.map(
            (c): Anthropic.ToolResultBlockParam => ({
              type: "tool_result",
              tool_use_id: c.use.id,
              content: c.result.ok ? JSON.stringify(c.result.data) : c.result.error,
              ...(c.result.ok ? {} : { is_error: true }),
            }),
          ),
        },
      ];
      const second = await this.call(this.withDirective(withResults, directive));
      finalCalls = await this.validateAll(args, toolUsesOf(second));
      // the first reply was never spoken: only the second one counts. Calls that passed in the first message stay.
      carried = firstCalls;
      finalText = textOf(second);
    }

    return this.toDecision(args, carried, finalCalls, finalText, Date.now() - started);
  }

  /** one call after the other, in the order the model made them */
  private async validateAll(args: AgentArgs, uses: ToolUse[]): Promise<Called[]> {
    const out: Called[] = [];
    for (const use of uses) out.push({ use, result: await args.validate(use.name, use.input) });
    return out;
  }

  private toDecision(
    args: AgentArgs,
    carried: Called[],
    final: Called[],
    text: string,
    llmMs: number,
  ): AgentDecision {
    const records = new Map<KpiKey, InterpretedRecord>();
    const correction = new Map<KpiKey, InterpretedRecord>();
    const clarifications = new Map<KpiKey, ClarifyReason>();
    const rejected = new Map<KpiKey, ClarifyReason>();
    const restated = new Set<KpiKey>();
    let confirmed: boolean | undefined;

    for (const { use, result } of [...carried, ...final]) {
      if (!result.ok) {
        const key = (use.input as { key?: unknown } | null)?.key;
        if (typeof key === "string" && key in KPI_DEFS) {
          // a value that is already recorded and was said again is a change of mind, not a failed answer
          if (result.code === "already_recorded") restated.add(key as KpiKey);
          // a tool that was simply not allowed in this state says nothing about what the astronaut said
          else if (result.code !== "illegal_state") rejected.set(key as KpiKey, toClarifyReason(result));
        }
        continue;
      }
      const effect = result.effect;
      if (!effect) continue;
      if (effect.type === "measurement") {
        const rec: InterpretedRecord = {
          key: effect.key,
          value: effect.value,
          unit: effect.unit,
          sourceText: effect.sourceText,
          confidence: effect.confidence,
        };
        (effect.change === "corrected" ? correction : records).set(effect.key, rec);
        rejected.delete(effect.key);
      } else if (effect.type === "clarification") {
        clarifications.set(effect.key, "unclear");
      } else if (effect.type === "confirmation") {
        confirmed = effect.confirmed;
      }
    }

    const decision: AgentDecision = {
      records: [...records.values()],
      emotion: "neutral",
      llmMs,
      startAnswer: startAnswerFor(args.ctx, args.text, args.lang),
    };
    if (correction.size > 0) decision.correction = [...correction.values()];
    if (clarifications.size > 0) {
      decision.clarifications = [...clarifications].map(([key, reason]) => ({ key, reason }));
    }
    if (rejected.size > 0) decision.rejected = [...rejected].map(([key, reason]) => ({ key, reason }));

    if (restated.size > 0) decision.restated = [...restated];

    if (args.ctx.state === "CONFIRM") {
      decision.yesNo = resolveConfirmation(args.text, args.lang, confirmed);
    }
    if (args.ctx.state === "KPI_CAPTURE" && args.expected !== null) {
      const q = getQuestion(args.expected);
      const answered = [...records.keys()].some((k) => q.keys.includes(k));
      if (!answered && detectSkip(q, args.text, args.lang)) decision.skip = true;
      // a question back: the model answered it in its text (turn.ts checks the wording and re-asks the question).
      // A model that asked for clarification anyway is overruled when the words are clearly a question.
      const askedKind = detectAskedQuestion(args.text, args.lang);
      if (!answered && !decision.skip && records.size === 0 && rejected.size === 0 && (clarifications.size === 0 || askedKind)) {
        if (askedKind || (clarifications.size === 0 && text.length > 0)) {
          decision.asked = { kind: askedKind ?? "other", ...(text.length > 0 ? { answer: text } : {}) };
          delete decision.clarifications;
        }
      }
    }
    if (text.length > 0) decision.replyText = text;
    return decision;
  }

  async answerAboutResults(args: {
    facts: ResultsFacts;
    question: string;
    lang: Lang;
    history: TurnRow[];
  }): Promise<string | null> {
    const { facts, question, lang } = args;
    const prompt = [
      "DIRECTIVE (written by the system, not by the astronaut)",
      "state: DONE - the daily check-in is complete and the astronaut is looking at the dashboard.",
      `reply_language: ${lang === "mn" ? "Mongolian (Cyrillic)" : "English"} (if the question is clearly in the other language, answer in that one)`,
      "instruction: Answer the astronaut's question about today's results in a warm, calm voice, at most three short sentences.",
      "Use ONLY the facts below. Never add, change, compute or estimate a number; quote numbers exactly as written in the facts.",
      "Never diagnose, never name a disease, drug, dose or treatment. For anything medical beyond these facts, say the crew medical officer or flight surgeon can help.",
      "Thresholds are demo parameters, not clinical limits; say so if asked whether something is dangerous.",
      "If the question is not about the results, answer briefly and kindly and offer to explain any part of the dashboard. Do not call any tool.",
      `facts: ${JSON.stringify(facts)}`,
      `astronaut_question: ${JSON.stringify(question)}`,
    ].join("\n");
    try {
      const message = await this.call([{ role: "user", content: prompt }]);
      const out = textOf(message).trim();
      return out.length > 0 ? out : null;
    } catch (err) {
      return this.noText(err);
    }
  }

  /**
   * Signature Triage (signature.ts): one call with the frozen system prompt and tool list (cached prefix unchanged); the
   * code-run tool's result is the only source, the T6 system-prompt addition rides in this directive. Only the text is
   * returned; the pipeline checks it (acceptSignatureAnswer) and otherwise speaks the template.
   */
  async answerAboutSignature(args: SignatureAnswerArgs): Promise<string | null> {
    const { tool, facts, question, lang } = args;
    // T14: a space-measurability question is answered from the three statements only (no numbers, no disclaimer rule)
    const space = tool === SPACE_TOOL_NAME;
    const prompt = [
      "DIRECTIVE (written by the system, not by the astronaut)",
      space
        ? "state: DONE - the daily check-in is complete; the astronaut asks whether these blood markers can be measured in space."
        : "state: DONE - the daily check-in is complete; the astronaut asks about a blood panel or a blood draw (Signature Triage).",
      `reply_language: ${lang === "mn" ? "Mongolian (Cyrillic)" : "English"}`,
      space
        ? "instruction: Use only sentences of the tool result, copied exactly; you may leave sentences out, never add one. No numbers."
        : `instruction: ${SIGNATURE_PROMPT_ADDITION}`,
      `instruction: ${SPACE_PROMPT_ADDITION}`,
      "Speak calmly and kindly. The panels are Inspiration4 reference data (NASA OSDR); never present them as the astronaut's own blood. Quote numbers exactly as written in the tool result. Never diagnose, never name a disease, drug, dose or treatment. Do not call any tool.",
      `tool_called: ${tool}`,
      `tool_result: ${JSON.stringify(facts)}`,
      `astronaut_question: ${JSON.stringify(question)}`,
    ].join("\n");
    try {
      const message = await this.call([{ role: "user", content: prompt }]);
      const out = textOf(message).trim();
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  }

  /**
   * Friend mode: the conversation so far plus the companion directive (same frozen system prompt and tool list, so the
   * cached prefix is reused). Tool calls are ignored; only the text is returned, and the pipeline checks it.
   */
  async companionReply(args: CompanionReplyArgs): Promise<string | null> {
    const directive = buildCompanionDirective({
      state: args.ctx.state,
      lang: args.lang,
      crewName: args.crew.name,
      turn: args.turn,
      crisisRaised: args.ctx.companionCrisis,
    });
    try {
      const message = await this.call(this.withDirective(buildMessages(args.history, args.text), directive));
      const out = textOf(message).trim();
      return out.length > 0 ? out : null;
    } catch (err) {
      return this.noText(err);
    }
  }

  /** Assistant mode: the conversation so far plus the assistant directive (same cached prefix); text only, checked by the pipeline. */
  async assistantReply(args: AssistantReplyArgs): Promise<string | null> {
    try {
      const message = await this.call(this.withDirective(buildMessages(args.history, args.text), args.directive));
      const out = textOf(message).trim();
      return out.length > 0 ? out : null;
    } catch (err) {
      return this.noText(err);
    }
  }

  async phraseSummary(args:{ findings: SummaryFindings; lang: Lang; crew: { name: string } }): Promise<string | null> {
    const { findings, lang } = args;
    const facts = {
      overall: findings.overall,
      readiness: findings.readiness,
      headline: findings.headline[lang],
      findings: findings.findings.map((f) => f.text[lang]),
      suggestions: findings.recommendations.map((r) => r.title[lang]),
      alerts: findings.redFlags.map((r) => r.text[lang]),
    };
    const prompt = [
      "DIRECTIVE (written by the system, not by the astronaut)",
      "state: SUMMARY",
      `reply_language: ${lang === "mn" ? "Mongolian (Cyrillic)" : "English"}`,
      "instruction: Say the summary below to the astronaut in a warm, calm voice, at most four short sentences. Use only the numbers that appear in the facts; never add, change or compute any number. Do not diagnose. Do not call any tool.",
      `facts: ${JSON.stringify(facts)}`,
    ].join("\n");
    try {
      const message = await this.call([{ role: "user", content: prompt }]);
      const out = textOf(message);
      return out.length > 0 ? out : null;
    } catch (err) {
      return this.noText(err);
    }
  }
}

