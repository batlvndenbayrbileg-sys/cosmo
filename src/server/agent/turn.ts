import "server-only";
import type {
  ApiErrorCode,
  ConversationState,
  KpiKey,
  Lang,
  MeasurementSource,
  MeasurementValue,
  QuestionId,
  SummaryFindings,
  SummaryPayload,
  TurnEvent,
  TurnRow,
} from "@/lib/types";
import { computeBaselines, evaluateDay, evaluateIndicator } from "@/lib/health";
import { formatNumber } from "@/lib/health/format";
import { KPI_DEFS, QUESTIONS, asNumber, getQuestion, questionFilled } from "@/lib/kpi/registry";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { HttpError } from "@/server/http";
import { getDb } from "@/server/db/client";
import { confirmCheckIn, getCheckIn } from "@/server/db/repos/checkin";
import { getCrewPublic } from "@/server/db/repos/crew";
import { appendTurn, listTurns } from "@/server/db/repos/turn";
import { ALERT_SPOKEN_NOTICE, createAlertsForCheckIn } from "@/server/alerts";
import { loadHistory, loadMachineCtx, loadTodayValues, saveMachineCtx } from "@/server/checkin/service";
import { composeTemplateSummary } from "@/server/dashboard/template";
import { LlmUnavailable, type Agent, type AgentDecision, type Emotion } from "./agent";
import { ClaudeAgent, HISTORY_TURNS } from "./claudeAgent";
import type { InterpretedRecord } from "./interpret";
import {
  cursorQuestion,
  questionOfKey,
  transition,
  type Effect,
  type MachineCtx,
  type MachineEvent,
} from "./machine";
import { ScriptedAgent } from "./scriptedAgent";
import { HybridAgent } from "./hybridAgent";
import { buildResultsFacts, numeralsAreGrounded, type ResultsFacts } from "./resultsFacts";

/** without the model: today's headline, the first suggestion, and an invitation to ask about any part */
export function offlineResultsAnswer(facts: ResultsFacts, lang: Lang): string {
  const first = facts.plan[0];
  const parts = [facts.headline];
  if (first) parts.push(lang === "mn" ? `Өнөөдрийн эхний санал: ${first.title}.` : `Today's first suggestion: ${first.title}.`);
  parts.push(
    lang === "mn"
      ? "Хяналтын самбарын аль ч хэсгийг тайлбарлаж өгье, асуугаарай."
      : "Ask me about any part of the dashboard and I'll explain it.",
  );
  return parts.join(" ").replace(/\.\./g, ".");
}
import * as T from "./templates";
import { executeTool, type ToolContext, type ToolName, type ToolResult } from "./tools";

/**
 * One spoken (or typed) turn, end to end (docs/PLAN.md sections 4 and 5.1).
 *
 *   persist the astronaut's turn -> detect the reply language -> agent proposes what it heard
 *   -> every proposal goes through executeTool (the SAME validation path for scripted and live)
 *   -> events go through the state machine -> the last reply effect becomes words (templates, or the live model's
 *      text when it passes the sanity checks) -> on "yes": code computes the summary, the check-in is confirmed,
 *      alerts are created -> events are emitted in the order  transcript, measurement|clarification, state,
 *      assistant, summary, timing, done.
 *
 * Everything is persisted before the first event after `transcript` is emitted, so a client that disconnects midway
 * never leaves the database half way between two states.
 */

export interface TurnInput {
  kind: "typed" | "voice";
  text: string;
  /** a language code from the client or from speech-to-text; it only breaks ties and decides very short answers */
  languageHint?: string | null;
  /** speech-to-text time, reported back in the timing event */
  sttMs?: number;
}

export interface RunTurnArgs {
  crewId: string;
  checkInId: string;
  input: TurnInput;
  /** tests inject agents; production uses defaultAgent() and the scripted fallback */
  agent?: Agent;
  fallback?: Agent;
}

/** longest accepted utterance (also enforced by the route) */
export const MAX_UTTERANCE_CHARS = 2000;

/* ───────────── agents ───────────── */

let scriptedSingleton: ScriptedAgent | undefined;
let claudeSingleton: ClaudeAgent | undefined;

export function scriptedAgent(): Agent {
  scriptedSingleton ??= new ScriptedAgent();
  return scriptedSingleton;
}

let hybridSingleton: HybridAgent | undefined;

/**
 * Live mode with a key: the hybrid agent (instant rule-based path for clear answers, Claude for everything else and
 * for phrasing the summary). Otherwise the scripted one.
 */
export function defaultAgent(): Agent {
  const env = getEnv();
  if (env.demoMode === "live" && env.anthropicApiKey) {
    claudeSingleton ??= new ClaudeAgent();
    hybridSingleton ??= new HybridAgent(claudeSingleton);
    return hybridSingleton;
  }
  return scriptedAgent();
}

/* ───────────── sanity checks for model-written wording ───────────── */

const MAX_REPLY_CHARS = 280;
const MAX_REPLY_SENTENCES = 2;
const FORBIDDEN_REPLY = /diagnos|prescri|medicat|dosage|treatment/iu;
const NUMERAL_RE = /\d+(?:[.,]\d+)?/g;

function numeralsOf(text: string): string[] {
  return (text.match(NUMERAL_RE) ?? []).map((n) => n.replace(",", "."));
}

function sentenceCount(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

function addNumberForms(set: Set<string>, n: number): void {
  set.add(String(n));
  for (let d = 0; d <= 2; d++) set.add(formatNumber(n, d));
}

/** every numeral a reply may legitimately contain: the astronaut's own, the stored values, the question prompt */
function allowedNumerals(
  userText: string,
  recorded: Partial<Record<KpiKey, MeasurementValue>>,
  question: QuestionId | null,
): Set<string> {
  const allowed = new Set<string>(numeralsOf(userText));
  for (const [key, value] of Object.entries(recorded) as Array<[KpiKey, MeasurementValue]>) {
    const n = asNumber(value);
    if (n !== null && KPI_DEFS[key].type !== "text") addNumberForms(allowed, n);
  }
  if (question) {
    const q = getQuestion(question);
    for (const lang of ["en", "mn"] as const) for (const n of numeralsOf(q.prompts[lang])) allowed.add(n);
  }
  return allowed;
}

/**
 * Wording written by the live model is used only when it is short (at most 280 characters, two sentences), free of
 * emojis and of diagnosis / treatment words, and every digit sequence in it appears in the recorded data, in the
 * astronaut's own words or in the expected question's prompt. Otherwise the template text is used.
 */
export function isSaneReply(
  text: string,
  ctx: {
    userText: string;
    recorded: Partial<Record<KpiKey, MeasurementValue>>;
    question: QuestionId | null;
  },
): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_REPLY_CHARS) return false;
  if (sentenceCount(t) > MAX_REPLY_SENTENCES) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (FORBIDDEN_REPLY.test(t)) return false;
  const allowed = allowedNumerals(ctx.userText, ctx.recorded, ctx.question);
  return numeralsOf(t).every((n) => allowed.has(n));
}

/** model-phrased summary: every numeral must appear in the code-computed findings */
export function isSaneSummaryText(text: string, findings: SummaryFindings): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 900) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (/prescri|medicat|dosage|treatment/iu.test(t)) return false;
  const allowed = new Set(numeralsOf(JSON.stringify(findings)));
  return numeralsOf(t).every((n) => allowed.has(n));
}

/* ───────────── small helpers ───────────── */


function clarificationReason(res: Extract<ToolResult, { ok: false }>): string {
  if (res.code === "invalid_value") return res.reason === "range" ? "out_of_range" : "not_a_number";
  if (res.code === "source_mismatch" || res.code === "number_mismatch") return "not_verified";
  return "unclear";
}

function clarifyReasonText(reason: "range" | "type" | "unclear"): string {
  return reason === "range" ? "out_of_range" : reason === "type" ? "not_a_number" : "unclear";
}

const TEMPLATES_EXTRA = {
  proposeAgain: {
    en: "No problem. Just tell me when you're ready, and we'll log today's measurements.",
    mn: "Зүгээр. Бэлэн болмогцоо хэлээрэй, өнөөдрийн хэмжилтүүдээ хамт хийцгээе.",
  },
  updated: { en: "Updated.", mn: "Заслаа." },
  /** the astronaut restated a value that is already recorded: it can be changed at the read-back */
  restated: {
    en: "Noted, you can change that when we confirm.",
    mn: "Ойлголоо, баталгаажуулах үедээ засч болно.",
  },
} as const;

function join(...parts: string[]): string {
  return parts.filter((p) => p.trim().length > 0).join(" ");
}

type ReplyEffect = Extract<Effect, { type: "reply" }>;

/** how a question is named when Cosmo says what is still missing */
function questionName(questionId: QuestionId, lang: Lang): string {
  if (questionId === "blood_pressure") return lang === "mn" ? "цусны даралт" : "blood pressure";
  if (questionId === "symptoms") return lang === "mn" ? "шинж тэмдгийн асуулт" : "the symptom check";
  const label = KPI_DEFS[getQuestion(questionId).keys[0]].labels[lang];
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * At the read-back: the questions that were skipped (after failed clarifications or by request) and still hold no
 * value, so the astronaut knows what is missing and that it can be added now. Empty when nothing is missing.
 */
export function missingNotice(ctx: { skipped: readonly QuestionId[]; filled: readonly KpiKey[] }, lang: Lang): string {
  const filled = new Set<KpiKey>(ctx.filled);
  const names = QUESTIONS.filter((q) => ctx.skipped.includes(q.id) && !q.optional && !questionFilled(q, filled)).map((q) =>
    questionName(q.id, lang),
  );
  if (names.length === 0) return "";
  if (lang === "mn") return `${names.join(", ")} бүртгэгдээгүй байна. Одоо нэмж болно.`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `I don't have ${list} yet. You can add ${names.length === 1 ? "it" : "them"} now.`;
}

/**
 * The astronaut is told whenever an alert exists. createAlertsForCheckIn raises one for every overall red status, also
 * when no red-flag rule fired (low sleep, mood 2), but the template's notice is tied to red flags only. The notice goes
 * in front of the disclaimer sentence, and only when the wording does not already carry it.
 */
export function ensureAlertNotice(spoken: string, findings: SummaryFindings, lang: Lang): string {
  if (findings.overall !== "red") return spoken;
  const notice = ALERT_SPOKEN_NOTICE[lang];
  if (spoken.includes(notice)) return spoken;
  const disclaimer = findings.disclaimer[lang].trim();
  const at = disclaimer.length > 0 ? spoken.lastIndexOf(disclaimer) : -1;
  if (at > 0) return `${spoken.slice(0, at).trimEnd()} ${notice} ${spoken.slice(at)}`;
  return join(spoken, notice);
}

/** the statements of a model reply that come before its first question: the acknowledgement, nothing it asks */
export function leadingStatements(text: string): string {
  const sentences = text
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  const out: string[] = [];
  for (const s of sentences) {
    if (/[?？]/u.test(s)) break;
    out.push(s);
  }
  return out.join(" ").trim();
}

/** the words for a reply effect, from the stored values and this turn's acknowledgements (templates only) */
function renderTemplate(
  effect: ReplyEffect,
  lang: Lang,
  ctx: { smallTalkTurns: number; skipped: readonly QuestionId[]; filled: readonly KpiKey[] },
  userText: string,
  values: Partial<Record<KpiKey, MeasurementValue>>,
  acknowledged: InterpretedRecord[],
): string {
  const skipNotice = effect.skippedQuestion
    ? T.clarify(getQuestion(effect.skippedQuestion), lang, "unclear", 2)
    : "";
  switch (effect.kind) {
    case "smallTalk":
      return T.smallTalkReply(lang, Math.max(0, ctx.smallTalkTurns - 1), userText);
    case "smallTalkPropose":
      return join(T.smallTalkReply(lang, Math.max(0, ctx.smallTalkTurns - 1), userText), T.proposeMeasurements(lang));
    case "proposeAgain":
      return TEMPLATES_EXTRA.proposeAgain[lang];
    case "ask":
      return join(skipNotice, T.askQuestion(getQuestion(effect.question as QuestionId), lang, acknowledged));
    case "clarify":
      return T.clarify(getQuestion(effect.question as QuestionId), lang, effect.reason ?? "unclear", effect.attempt ?? 0);
    case "restated":
      return join(TEMPLATES_EXTRA.restated[lang], T.askQuestion(getQuestion(effect.question as QuestionId), lang));
    case "readBack":
      return join(missingNotice(ctx, lang), T.readBack(values, lang));
    case "correctionAck": {
      const keys = effect.keys ?? [];
      if (keys.length === 1 && values[keys[0]] !== undefined) {
        return T.correctionAck(keys[0], values[keys[0]] as MeasurementValue, lang);
      }
      return join(TEMPLATES_EXTRA.updated[lang], T.readBack(values, lang));
    }
    case "askWhatToChange":
      return T.askWhatToChange(lang);
    case "closing":
      return T.closing(lang);
  }
}

/**
 * Wording from the live model is only ever taken for these replies; read-backs, summaries, clarifications (their
 * range hints come from the registry) and notices stay in code. For "ask" the model supplies the acknowledgement only:
 * the question itself is always the registry prompt the state machine expects.
 */
const MODEL_WORDING_KINDS: ReadonlySet<ReplyEffect["kind"]> = new Set([
  "smallTalk",
  "smallTalkPropose",
  "proposeAgain",
  "ask",
]);

/* ───────────── the pipeline ───────────── */

export async function* runTurn(args: RunTurnArgs): AsyncGenerator<TurnEvent> {
  const started = performance.now();
  try {
    yield* runTurnInner(args, started);
  } catch (err) {
    const known = err instanceof HttpError;
    if (!known) console.error("[aegis] turn failed:", err);
    const code: ApiErrorCode = known ? err.code : "INTERNAL";
    yield {
      type: "error",
      code,
      message: known ? err.message : "Something went wrong. Please try again.",
      recoverable: true,
    };
    yield { type: "done" };
  }
}

async function* runTurnInner(args: RunTurnArgs, started: number): AsyncGenerator<TurnEvent> {
  const { crewId, checkInId, input } = args;
  const text = input.text.trim();
  if (text.length === 0) throw new HttpError(400, "BAD_INPUT", "Empty message");
  if (text.length > MAX_UTTERANCE_CHARS) throw new HttpError(400, "BAD_INPUT", "Message is too long");

  const checkIn = await getCheckIn(crewId, checkInId); // NotFoundError for another crew member's check-in
  const crew = await getCrewPublic(crewId);
  const ctx0 = await loadMachineCtx(checkIn);

  const history: TurnRow[] = await listTurns(crewId, checkInId, { limit: HISTORY_TURNS });
  // Team decision (2026-11-14): Cosmo keeps ONE language for the whole check-in - the check-in's language (the crew
  // member's preferred language or the one chosen at the start). A Mongolian check-in stays Mongolian from start to
  // finish even when the recogniser returns digits or Latin-looking text for an utterance.
  const lang: Lang = checkIn.language;

  const crewTurn = await appendTurn(crewId, checkInId, { speaker: "crew", text, language: lang, createdAt: now() });
  yield { type: "transcript", turnId: crewTurn.id, text, language: lang };

  const env = getEnv();
  const source: MeasurementSource = input.kind === "voice" ? "voice" : env.demoMode === "scripted" ? "simulated" : "typed";

  const today = await loadTodayValues(crewId, checkInId);
  const expected = ctx0.state === "KPI_CAPTURE" ? cursorQuestion(ctx0) : null;
  const toolContext = (dryRun: boolean, state: ConversationState, filled: ReadonlySet<KpiKey>): ToolContext => ({
    crewId,
    checkInId,
    state,
    lang,
    utterance: text,
    source,
    filled,
    dryRun,
  });

  const out: TurnEvent[] = [];

  /* ── 1. the agent proposes what it heard ── */
  const primary = args.agent ?? defaultAgent();
  const agentArgs = {
    crew,
    ctx: ctx0,
    text,
    lang,
    expected,
    recorded: today.values,
    history,
    validate: (name: string, toolInput: unknown) =>
      executeTool(toolContext(true, ctx0.state, new Set(ctx0.filled)), name, toolInput),
  };
  const decideStarted = performance.now();
  let used: Agent = primary;
  let decision: AgentDecision;
  try {
    decision = await primary.decide(agentArgs);
  } catch (err) {
    if (!(err instanceof LlmUnavailable)) throw err;
    out.push({ type: "error", code: "LLM_FAILED", message: "The assistant is unavailable; using the offline helper.", recoverable: true });
    used = args.fallback ?? scriptedAgent();
    decision = await used.decide(agentArgs);
  }
  let llmMs = decision.llmMs ?? Math.round(performance.now() - decideStarted);

  /* ── 2. proposals -> executeTool -> events ── */
  const history14 = await loadHistory(crewId, checkIn.localDate);
  const baselines = computeBaselines(history14);
  const filledNow = new Set<KpiKey>(ctx0.filled);
  const acknowledged: InterpretedRecord[] = [];
  const failures: Array<{ key: KpiKey; reason: "range" | "type" | "unclear"; text: string }> = [];
  /** values proposed for keys that already hold one: a change of mind for the read-back, never a failed answer */
  const alreadyRecorded: KpiKey[] = [];
  const correctedNow = new Set<KpiKey>();

  /** one record after the other, in order: each write sees the keys the earlier ones filled */
  const apply = async (
    records: InterpretedRecord[],
    name: Extract<ToolName, "record_measurement" | "correct_measurement">,
  ): Promise<KpiKey[]> => {
    const accepted: KpiKey[] = [];
    const seen = new Set<KpiKey>();
    for (const rec of records) {
      if (seen.has(rec.key)) continue;
      seen.add(rec.key);
      const toolInput =
        name === "record_measurement"
          ? { key: rec.key, value: rec.value, unit: rec.unit, source_text: rec.sourceText, confidence: rec.confidence }
          : { key: rec.key, value: rec.value, source_text: rec.sourceText, confidence: rec.confidence };
      const res = await executeTool(toolContext(false, ctx0.state, filledNow), name, toolInput);
      if (res.ok && res.effect?.type === "measurement") {
        const e = res.effect;
        accepted.push(e.key);
        filledNow.add(e.key);
        acknowledged.push({ key: e.key, value: e.value, unit: e.unit, sourceText: e.sourceText, confidence: e.confidence });
        const ev = evaluateIndicator(e.key, e.value, baselines[e.key]);
        out.push({
          type: "measurement",
          key: e.key,
          value: e.value,
          unit: e.unit,
          sourceText: e.sourceText,
          confidence: e.confidence,
          status: ev.status,
          reason: ev.reason,
          change: e.change,
        });
      } else if (!res.ok && res.code === "already_recorded") {
        alreadyRecorded.push(rec.key);
      } else if (!res.ok) {
        const reason = res.code === "invalid_value" ? (res.reason ?? "unclear") : "unclear";
        failures.push({ key: rec.key, reason, text: clarificationReason(res) });
      }
    }
    return accepted;
  };

  let ctx: MachineCtx = ctx0;
  const effects: Effect[] = [];
  const send = (event: MachineEvent): void => {
    const result = transition(ctx, event);
    ctx = result.ctx;
    effects.push(...result.effects);
  };

  switch (ctx0.state) {
    case "GREETING":
    case "SMALL_TALK": {
      const accepted = await apply(decision.records, "record_measurement");
      if (accepted.length > 0) send({ type: "MEASUREMENT_ACCEPTED", keys: accepted });
      send({ type: "USER_TURN", start: decision.startAnswer ?? "unclear" });
      break;
    }
    case "KPI_CAPTURE": {
      const accepted = await apply(decision.records, "record_measurement");
      if (accepted.length > 0) {
        send({ type: "MEASUREMENT_ACCEPTED", keys: accepted });
      } else if (expected !== null) {
        const restated = [...alreadyRecorded, ...(decision.restated ?? [])];
        const modelAsked = (decision.clarifications?.length ?? 0) > 0 || (decision.rejected?.length ?? 0) > 0;
        if (decision.skip) {
          send({ type: "SKIP", question: expected });
        } else if (restated.length > 0 && failures.length === 0 && !modelAsked) {
          // "actually I slept 8 hours" while mood is open: noted for the read-back, the open question is asked
          // again and nothing is counted against it
          send({ type: "ALREADY_RECORDED" });
        } else {
          const q = getQuestion(expected);
          const own = failures.find((f) => q.keys.includes(f.key));
          const asked = decision.rejected?.find((r) => q.keys.includes(r.key)) ?? decision.clarifications?.find((c) => q.keys.includes(c.key));
          send({ type: "MEASUREMENT_REJECTED", question: expected, reason: own?.reason ?? asked?.reason ?? failures[0]?.reason ?? "unclear" });
          // the model's own clarification requests are shown too
          for (const c of decision.clarifications ?? []) {
            if (!failures.some((f) => f.key === c.key)) failures.push({ key: c.key, reason: c.reason, text: clarifyReasonText(c.reason) });
          }
        }
      }
      break;
    }
    case "CONFIRM": {
      const attempted = decision.correction ?? [];
      const corrected = attempted.length > 0 ? await apply(attempted, "correct_measurement") : [];
      for (const key of corrected) correctedNow.add(key);
      for (const r of decision.rejected ?? []) {
        if (!failures.some((f) => f.key === r.key)) failures.push({ key: r.key, reason: r.reason, text: clarifyReasonText(r.reason) });
      }
      // a correction that could not be used (out of range, not a number, not in the astronaut's words)
      const unusable = failures.filter((f) => !correctedNow.has(f.key));
      if (corrected.length > 0) send({ type: "CORRECTION_ACCEPTED", keys: corrected });
      if (unusable.length > 0) {
        // never confirm over an unusable correction, and say why it was not taken instead of asking "what to change"
        send({ type: "CORRECTION_REJECTED", question: questionOfKey(unusable[0].key), reason: unusable[0].reason });
      } else if (corrected.length === 0) {
        send({ type: "CONFIRMATION", confirmed: attempted.length > 0 ? false : (decision.yesNo ?? null) });
      }
      break;
    }
    case "SUMMARY":
      // a crash between "yes" and the summary: finish the job
      effects.push({ type: "computeSummary" });
      break;
    case "DONE":
      send({ type: "USER_TURN", start: "unclear" });
      break;
  }

  // the astronaut sees why an answer was not used
  const shown = new Set<string>();
  for (const f of failures) {
    if (shown.has(f.key) || correctedNow.has(f.key)) continue;
    // before the read-back a key that holds a value needs no clarification; at the read-back every key does
    if (ctx0.state !== "CONFIRM" && filledNow.has(f.key)) continue;
    shown.add(f.key);
    out.push({ type: "clarification", key: f.key, reason: f.text });
  }

  /* ── 3. words ── */
  const summaryRequested = effects.some((e) => e.type === "computeSummary");
  const replyEffect = [...effects].reverse().find((e): e is ReplyEffect => e.type === "reply");
  const valuesNow = (await loadTodayValues(crewId, checkInId)).values;
  let finalState: ConversationState = ctx.state;
  let assistantText = "";
  let emotion: Emotion = decision.emotion;
  let summaryPayload: SummaryPayload | null = null;

  if (summaryRequested) {
    const evaluation = evaluateDay(valuesNow, history14);
    const findings = evaluation.summary;
    let spoken = T.summarySpeech(findings, lang);
    if (used.phraseSummary && used === primary) {
      const phraseStarted = performance.now();
      try {
        const phrased = await used.phraseSummary({ findings, lang, crew });
        if (phrased && isSaneSummaryText(phrased, findings)) {
          const disclaimer = findings.disclaimer[lang];
          spoken = phrased.includes(disclaimer) ? phrased.trim() : join(phrased.trim(), disclaimer);
        }
      } catch {
        // the template wording stands
      }
      llmMs += Math.round(performance.now() - phraseStarted);
    }
    // an overall red status always raises an alert: the astronaut is told, whoever phrased the summary
    spoken = ensureAlertNotice(spoken, findings, lang);
    // the summary turn, the confirmation, the alerts and the DONE state are written together or not at all: a failure
    // part-way (a dropped Postgres connection, say) must not leave a confirmed red check-in without its alert, because a
    // confirmed check-in is DONE and the SUMMARY step would never run again
    const db = await getDb();
    const { cosmoTurn, payload } = await db.transaction(async () => {
      const turn = await appendTurn(crewId, checkInId, { speaker: "cosmo", text: spoken, language: lang, createdAt: now() });
      const composed: SummaryPayload = {
        ...composeTemplateSummary(findings, lang, turn.id),
        spoken: { language: lang, text: spoken },
      };
      await confirmCheckIn(crewId, checkInId, { confirmedAt: now(), summaryJson: JSON.stringify(composed) });
      await createAlertsForCheckIn(crewId, checkInId, findings);
      send({ type: "SUMMARY_SPOKEN" });
      await saveMachineCtx(crewId, checkInId, ctx);
      return { cosmoTurn: turn, payload: composed };
    });
    summaryPayload = payload;
    // the state event tells the client to move to the dashboard; the stored state is DONE
    finalState = "SUMMARY";
    assistantText = spoken;
    emotion =
      findings.redFlags.length > 0 || findings.overall === "red" ? "concerned" : findings.overall === "green" ? "happy" : "neutral";
    out.push({ type: "state", state: finalState, expectedQuestion: null });
    out.push({ type: "assistant", turnId: cosmoTurn.id, text: assistantText, language: lang, emotion });
    out.push({ type: "summary", summary: summaryPayload });
  } else {
    const effect: ReplyEffect = replyEffect ?? { type: "reply", kind: "closing" };
    let template = renderTemplate(effect, lang, ctx, text, valuesNow, acknowledged);
    // a read-back correction was taken and another one was not: say both
    if (ctx0.state === "CONFIRM" && effect.kind === "clarify" && correctedNow.size > 0) {
      template = join(TEMPLATES_EXTRA.updated[lang], template);
    }
    assistantText = template;
    // after the check-in the astronaut can keep talking to Cosmo about today's results (dashboard Q&A)
    const afterCheckIn = ctx0.state === "DONE";
    if (afterCheckIn) {
      const facts = buildResultsFacts(valuesNow, history14, lang);
      let answer: string | null = null;
      if (used.answerAboutResults && used === primary) {
        const askedAt = performance.now();
        try {
          answer = await used.answerAboutResults({ facts, question: text, lang, history });
        } catch {
          answer = null;
        }
        llmMs += Math.round(performance.now() - askedAt);
      }
      assistantText =
        answer && answer.length <= 600 && numeralsAreGrounded(answer, facts, text) ? answer : offlineResultsAnswer(facts, lang);
    }
    // the model's wording replaces the template only where the machine leaves room for it: never when a question was
    // just skipped (the template carries the "add it at the confirmation" notice), never at the read-back
    const modelMayWord =
      !afterCheckIn &&
      decision.replyText !== undefined &&
      MODEL_WORDING_KINDS.has(effect.kind) &&
      effect.skippedQuestion === undefined &&
      ctx0.state !== "CONFIRM";
    if (modelMayWord && decision.replyText) {
      const reply = decision.replyText.trim();
      const sane = { userText: text, recorded: valuesNow, question: effect.question ?? expected };
      if (effect.kind === "ask" && effect.question) {
        // the model acknowledges; the question is always the one the machine expects (a model that asks about
        // something else, or about a value that is already stored, would make the next answer be read wrongly)
        const lead = leadingStatements(reply);
        if (lead.length > 0 && lead.length <= 140 && isSaneReply(lead, sane)) {
          assistantText = join(lead, getQuestion(effect.question).prompts[lang]);
        }
      } else if (effect.kind === "smallTalkPropose") {
        // it must actually propose the measurements, because the next answer is read as the answer to that proposal
        if (/[?？]/u.test(reply) && isSaneReply(reply, sane)) assistantText = reply;
      } else if (isSaneReply(reply, sane)) {
        assistantText = reply;
      }
    }
    emotion =
      effect.kind === "clarify" && effect.reason === "range"
        ? "concerned"
        : effect.kind === "smallTalkPropose"
          ? "happy"
          : decision.emotion;
    const cosmoTurn = await appendTurn(crewId, checkInId, { speaker: "cosmo", text: assistantText, language: lang, createdAt: now() });
    await saveMachineCtx(crewId, checkInId, ctx);
    out.push({
      type: "state",
      state: ctx.state,
      expectedQuestion: ctx.state === "KPI_CAPTURE" ? cursorQuestion(ctx) : null,
    });
    out.push({ type: "assistant", turnId: cosmoTurn.id, text: assistantText, language: lang, emotion });
  }

  out.push({
    type: "timing",
    sttMs: Math.max(0, Math.round(input.sttMs ?? 0)),
    llmMs,
    totalMs: Math.round(performance.now() - started),
  });
  out.push({ type: "done" });
  for (const event of out) yield event;
}
