import "server-only";
import type {
  ApiErrorCode,
  ConversationState,
  CrewPublic,
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
import { ALERT_SPOKEN_NOTICE, createAlertsForCheckIn, raiseCrisisAlert } from "@/server/alerts";
import { loadHistory, loadMachineCtx, loadTodayValues, saveMachineCtx } from "@/server/checkin/service";
import { syncSensorFeed } from "@/server/checkin/sensors";
import { composeTemplateSummary } from "@/server/dashboard/template";
import { sosTurn } from "@/server/sos";
import { painTurn } from "@/server/pain";
import { LlmUnavailable, type Agent, type AgentDecision, type Emotion } from "./agent";
import { ClaudeAgent, HISTORY_TURNS } from "./claudeAgent";
import { interpretAnswer, interpretCorrection, interpretStart, interpretYesNo, type InterpretedRecord } from "./interpret";
import {
  companionLeaveLine,
  companionReply,
  crisisReply,
  dashboardLine,
  isSaneCompanionReply,
  namesConditionOrDrug,
  planCompanion,
  resumeLead,
  type CompanionPlan,
} from "./companion";
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
import { createLocalAgent } from "./localLlm";
import { localLlmConfig } from "./localLlmConfig";
import { TieredAgent, logTier, type Tier } from "./tieredAgent";
import { answerAskedQuestion, detectAskedQuestion, isHealthTopic, questionFacts, questionTopicOf, type AskedKind } from "./questions";
import { answerReferenceQuestion, withReferenceCaveat } from "./questions";
import { readBackReferenceReply } from "./readBackQuestion";
import { dangerNotice, rangeReply, rulesRangeKeys } from "./valueChecks";

/** the rules found these keys out of range: their failures say so (replacing an "unclear" from the model) */
function markOutOfRange(failures: Array<{ key: KpiKey; reason: "range" | "type" | "unclear"; text: string }>, keys: KpiKey[]): void {
  for (const key of keys) {
    const at = failures.findIndex((f) => f.key === key);
    const entry = { key, reason: "range" as const, text: "out_of_range" };
    if (at >= 0) failures[at] = entry;
    else failures.unshift(entry);
  }
}
import type { Baseline } from "@/lib/health/baseline";
import { buildResultsFacts, numeralsAreGrounded, type ResultsFacts } from "./resultsFacts";
import { answerSignatureQuestion, insertBeforeDisclaimer, panelClockDay, signatureFollowUp } from "./signature";
import { showEvent } from "./show";
import { explainQuestionTurn, explainSummaryEvent } from "./explain";
import { assistantTurn } from "./assistantTurn";
import { assistantCrisis } from "./assistantMode";

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
import { reaskAfterFailedAnswer } from "./reask";
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
  /** assistant mode: the first words after the speaker was recognised; the reply greets them by name */
  greet?: boolean;
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
let tieredSingleton: HybridAgent | undefined;

/**
 * Live mode with a key: the hybrid agent (instant rule-based path for clear answers, Claude for everything else and
 * for phrasing the summary). Otherwise the scripted one.
 */
export function defaultAgent(): Agent {
  const env = getEnv();
  // optional local model (LOCAL_LLM_URL + LOCAL_LLM_MODEL, never set on Vercel): Claude -> local -> rules
  const local = env.demoMode === "live" ? localLlmConfig(env) : null;
  if (local) {
    if (!tieredSingleton) {
      const tiers: Tier[] = [];
      if (env.anthropicApiKey) {
        // a refusal from Claude ends at the templates; it is never handed to the local model (tieredAgent.ts)
        tiers.push({ tier: "claude", agent: new ClaudeAgent({ surfaceRefusals: true }) });
      }
      tiers.push({ tier: "local", agent: createLocalAgent(local) });
      tieredSingleton = new HybridAgent(new TieredAgent(tiers), undefined, () => logTier("rules", "turn"));
    }
    return tieredSingleton;
  }
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
  // an answer to a general question plus the question asked again gets the asked-answer room (3 sentences)
  const general = isGeneralQuestion(ctx.userText, t);
  if (t.length === 0 || t.length > (general ? MAX_ASKED_ANSWER_CHARS : MAX_REPLY_CHARS)) return false;
  if (sentenceCount(t) > (general ? MAX_ASKED_ANSWER_SENTENCES : MAX_REPLY_SENTENCES)) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (FORBIDDEN_REPLY.test(t)) return false;
  if (general) return true;
  const allowed = allowedNumerals(ctx.userText, ctx.recorded, ctx.question);
  return numeralsOf(t).every((n) => allowed.has(n));
}

/**
 * A question that is not about health, the body or a measurement, answered without health words: its numbers are
 * general knowledge (orbit speed, distances, time), not health data, so they need not come from the check-in.
 */
export function isGeneralQuestion(userText: string, answer: string): boolean {
  const asked = detectAskedQuestion(userText, "en") ?? detectAskedQuestion(userText, "mn");
  return asked !== null && asked !== "greeting" && !isHealthTopic(userText) && !isHealthTopic(answer);
}

const MAX_ASKED_ANSWER_CHARS = 360;
const MAX_ASKED_ANSWER_SENTENCES = 3;

/**
 * A model's answer to a question asked back (before the re-asked question): short, no emojis, no diagnosis or
 * treatment words, and every number from the question facts (demo range, the personal baseline), the astronaut's own
 * words or the question prompt.
 */
export function isSaneAskedAnswer(text: string, facts: string, userText: string, prompt: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_ASKED_ANSWER_CHARS) return false;
  if (sentenceCount(t) > MAX_ASKED_ANSWER_SENTENCES) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (FORBIDDEN_REPLY.test(t)) return false;
  // a general question ("how fast is the station?") may be answered with general-knowledge numbers; anything about
  // health or a measurement keeps every number tied to the data
  if (isGeneralQuestion(userText, t)) return true;
  const allowed = new Set([...numeralsOf(facts), ...numeralsOf(userText), ...numeralsOf(prompt)]);
  return numeralsOf(t).every((n) => allowed.has(n));
}

/**
 * Cosmo's reply to a question asked back while a value is expected: the model's answer when it passes the checks,
 * otherwise the registry's answer for that kind of question, then the open question again. Null when there is
 * nothing to answer (the model wrote only a re-ask and the words are not a question): the caller then treats the turn
 * as an unclear answer.
 */
export function askedQuestionReply(
  asked: { kind: AskedKind; answer?: string },
  detected: AskedKind | null,
  expected: QuestionId,
  lang: Lang,
  baselines: Partial<Record<KpiKey, Baseline>>,
  userText: string,
): string | null {
  const prompt = getQuestion(expected).prompts[lang];
  // "how many hours should I sleep?" while water is open is about sleep: answered for sleep, then water asked again
  const about = asked.kind === "repeat" || asked.kind === "greeting" ? expected : (questionTopicOf(userText) ?? expected);
  if (asked.answer && asked.kind !== "repeat") {
    const lead = leadingStatements(asked.answer);
    const facts = join(questionFacts(about, lang, baselines), about === expected ? "" : questionFacts(expected, lang, baselines));
    if (lead.length > 0 && isSaneAskedAnswer(lead, facts, userText, prompt)) {
      return join(withReferenceCaveat(lead, userText, lang), prompt);
    }
  }
  if (asked.kind === "other" && !detected) return null;
  return join(answerAskedQuestion(asked.kind, about, lang, baselines), prompt);
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
  /** the open proposal, asked again after a question was answered */
  proposeShort: {
    en: "Shall we log today's measurements now?",
    mn: "Одоо өнөөдрийн хэмжилтүүдээ тэмдэглэх үү?",
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
  if (lang === "mn") {
    // the notice opens Cosmo's sentence: capitalise its first letter ("Шинж тэмдгийн асуулт, ...")
    const list = names.join(", ");
    return `${list.charAt(0).toLocaleUpperCase("mn")}${list.slice(1)} бүртгэгдээгүй байна. Одоо нэмж болно.`;
  }
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
  ctx: { smallTalkTurns: number; skipped: readonly QuestionId[]; filled: readonly KpiKey[]; sensor?: MachineCtx["sensor"] },
  userText: string,
  values: Partial<Record<KpiKey, MeasurementValue>>,
  acknowledged: InterpretedRecord[],
  sources?: Partial<Record<KpiKey, MeasurementSource>>,
): string {
  const skipNotice = effect.skippedQuestion
    ? T.clarify(getQuestion(effect.skippedQuestion), lang, "unclear", 2)
    : "";
  // the first question says what the sensors logged; the sensor follow-up always says which reading it is about
  const sensorLead = effect.intro
    ? T.sensorIntro(ctx.sensor ?? null, values, lang)
    : effect.question === "sensor_check"
      ? T.sensorCheckLead(ctx.sensor ?? null, values, lang)
      : "";
  switch (effect.kind) {
    case "smallTalk":
      return T.smallTalkReply(lang, Math.max(0, ctx.smallTalkTurns - 1), userText);
    case "smallTalkPropose":
      return join(T.smallTalkReply(lang, Math.max(0, ctx.smallTalkTurns - 1), userText), T.proposeMeasurements(lang));
    case "proposeAgain":
      return TEMPLATES_EXTRA.proposeAgain[lang];
    case "ask": {
      const q = getQuestion(effect.question as QuestionId);
      if (!sensorLead) return join(skipNotice, T.askQuestion(q, lang, acknowledged));
      // what was just heard is acknowledged first, then the sensors, then the question
      const asked = T.askQuestion(q, lang, acknowledged);
      const prompt = q.prompts[lang];
      return join(skipNotice, asked.slice(0, asked.length - prompt.length).trim(), sensorLead, prompt);
    }
    case "clarify":
      return reaskAfterFailedAnswer(getQuestion(effect.question as QuestionId), lang, effect.reason ?? "unclear", effect.attempt ?? 0);
    case "restated":
      return join(TEMPLATES_EXTRA.restated[lang], sensorLead, T.askQuestion(getQuestion(effect.question as QuestionId), lang));
    case "readBack":
      return join(missingNotice(ctx, lang), T.readBack(values, lang, sources));
    case "correctionAck": {
      const keys = effect.keys ?? [];
      if (keys.length === 1 && values[keys[0]] !== undefined) {
        return T.correctionAck(keys[0], values[keys[0]] as MeasurementValue, lang);
      }
      return join(TEMPLATES_EXTRA.updated[lang], T.readBack(values, lang, sources));
    }
    case "askWhatToChange":
      return T.askWhatToChange(lang);
    case "closing":
      return T.closing(lang);
    // friend mode replies are worded by companionTurn (they never reach the check-in path); these keep the switch whole
    case "companion":
      return companionReply(lang, 1, userText);
    case "companionLeave":
      return companionLeaveLine(lang, 0);
    case "crisis":
      return crisisReply(lang, effect.crisis ?? "self");
  }
}

/* ───────────── friend mode (companion.ts) ───────────── */

/**
 * Does the utterance answer what the check-in is waiting for with a value? Then a feeling or a "listen to me" in it
 * ("I feel down" to the mood question, "сонсооч, би 7 цаг унтсан") is recorded as usual instead of opening a companion
 * conversation, and while talking a plain answer to the open question ends the conversation and is recorded.
 * Rule-based reading only.
 */
function answersOpenQuestion(ctx: MachineCtx, expected: QuestionId | null, text: string, lang: Lang): boolean {
  // the day note takes any words, so while talking (friend mode) nothing said is "the note": it would end the talk
  // and store the conversation as the note (found in a live replay 2026-11-15)
  // the same holds for the sensor follow-up, which takes free words too
  if (ctx.companion && (expected === "day_note" || expected === "sensor_check")) return false;
  if (ctx.state === "KPI_CAPTURE" && expected !== null) return interpretAnswer(getQuestion(expected), text, lang).records.length > 0;
  if (ctx.companion) return false;
  if (ctx.state === "CONFIRM") return interpretCorrection(text, lang).result.records.length > 0;
  return false;
}

/** an utterance that begins by agreeing ("yes ...", "sure, ...", "тийм ...", "за ...") */
const LEADING_YES = /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|alright|all\s+right|of\s+course|let'?s|тийм|за(?![\p{L}])|болно|эхэлье|зөв)/iu;

/**
 * Does the utterance say yes to what is open: the proposal to start the measurements, or the read-back? Then a
 * feeling in the same sentence ("yes let's start, I'm a little stressed") does not swallow the yes.
 */
function agreesToOpenQuestion(ctx: MachineCtx, text: string, lang: Lang): boolean {
  if (ctx.companion || !LEADING_YES.test(text)) return false;
  if (ctx.state === "SMALL_TALK") return interpretStart(text, lang) === "yes";
  if (ctx.state === "CONFIRM") return interpretYesNo(text, lang) === true;
  return false;
}

/** where the check-in stands, said again after the companion conversation */
function resumeText(
  effect: ReplyEffect,
  ctx: MachineCtx,
  values: Partial<Record<KpiKey, MeasurementValue>>,
  lang: Lang,
  sources?: Partial<Record<KpiKey, MeasurementSource>>,
): string {
  switch (effect.resume) {
    case "propose":
      return T.proposeMeasurements(lang);
    case "question": {
      if (!effect.question) return resumeLead(lang);
      const lead = effect.question === "sensor_check" ? T.sensorCheckLead(ctx.sensor, values, lang) : "";
      return join(resumeLead(lang), lead, T.askQuestion(getQuestion(effect.question), lang));
    }
    case "readBack":
      return join(resumeLead(lang), missingNotice(ctx, lang), T.readBack(values, lang, sources));
    case "dashboard":
    case undefined:
      return dashboardLine(lang);
  }
}

/**
 * One friend-mode turn. Nothing is recorded and no clarification is made: the machine only sets the companion fields
 * (or, on leaving, resumes where the check-in was). The supportive reply is the model's wording when it passes
 * isSaneCompanionReply, otherwise a template; the crisis reply is ALWAYS the template, and a crisis turn raises a red
 * alert (idempotent). The reply, the alert and the context are written together.
 */
async function companionTurn(p: {
  crewId: string;
  checkInId: string;
  crew: CrewPublic;
  ctx0: MachineCtx;
  plan: CompanionPlan;
  text: string;
  lang: Lang;
  history: TurnRow[];
  agent: Agent;
}): Promise<{ events: TurnEvent[]; llmMs: number }> {
  const { crewId, checkInId, ctx0, plan, text, lang } = p;
  const event: MachineEvent =
    plan.kind === "crisis"
      ? { type: "CRISIS", kind: plan.crisis }
      : plan.kind === "leave"
        ? { type: "COMPANION_LEAVE" }
        : plan.kind === "enter"
          ? { type: "COMPANION_ENTER" }
          : { type: "COMPANION_TURN" };
  const { ctx, effects } = transition(ctx0, event);
  const effect: ReplyEffect = effects.find((e): e is ReplyEffect => e.type === "reply") ?? { type: "reply", kind: "companion" };

  let llmMs = 0;
  let spoken: string;
  let emotion: Emotion;
  if (effect.kind === "crisis") {
    spoken = crisisReply(lang, effect.crisis ?? "self");
    emotion = "concerned";
  } else if (effect.kind === "companionLeave") {
    const today = await loadTodayValues(crewId, checkInId);
    spoken = join(companionLeaveLine(lang, ctx0.companionTurns), resumeText(effect, ctx, today.values, lang, today.sources));
    emotion = "happy";
  } else {
    spoken = companionReply(lang, ctx.companionTurns, text, ctx0.companionCrisis);
    emotion = "neutral";
    if (p.agent.companionReply) {
      const askedAt = performance.now();
      try {
        const worded = await p.agent.companionReply({
          crew: p.crew,
          ctx: ctx0,
          turn: ctx.companionTurns,
          text,
          lang,
          history: p.history,
        });
        // after a crisis the wording must keep pointing to the medical officer, or the AFTER_CRISIS template stands
        if (worded && isSaneCompanionReply(worded, lang, text, ctx0.companionCrisis)) spoken = worded.trim();
      } catch {
        // the template stands
      }
      llmMs = Math.round(performance.now() - askedAt);
    }
  }

  const db = await getDb();
  const cosmoTurn = await db.transaction(async () => {
    const turn = await appendTurn(crewId, checkInId, { speaker: "cosmo", text: spoken, language: lang, createdAt: now() });
    if (effect.kind === "crisis") await raiseCrisisAlert(crewId, checkInId, effect.crisis ?? "self");
    await saveMachineCtx(crewId, checkInId, ctx);
    return turn;
  });

  return {
    llmMs,
    events: [
      // while talking no question is open (question-specific screens such as the vision card stay hidden); leaving
      // sends the resumed question again
      {
        type: "state",
        state: ctx.state,
        expectedQuestion: ctx.state === "KPI_CAPTURE" && !ctx.companion ? cursorQuestion(ctx) : null,
        companion: ctx.companion,
      },
      { type: "assistant", turnId: cosmoTurn.id, text: spoken, language: lang, emotion },
    ],
  };
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
  // the day's (simulated) sensor feed fills what a wearable records, once per check-in, before anything is read
  const loadedCtx = await syncSensorFeed(checkIn, await loadMachineCtx(checkIn));
  /** where the check-in stands for this turn (friend mode switched off when a plain answer ends it, step 0) */
  let ctx0: MachineCtx = loadedCtx;

  const history: TurnRow[] = await listTurns(crewId, checkInId, { limit: HISTORY_TURNS });
  // Team decision (2026-11-14): Cosmo keeps ONE language for the whole check-in - the check-in's language (the crew
  // member's preferred language or the one chosen at the start). A Mongolian check-in stays Mongolian from start to
  // finish even when the recogniser returns digits or Latin-looking text for an utterance.
  const lang: Lang = checkIn.language;

  const crewTurn = await appendTurn(crewId, checkInId, { speaker: "crew", text, language: lang, createdAt: now() });
  yield { type: "transcript", turnId: crewTurn.id, text, language: lang };

  /* ── SOS: "tell Earth" raises one urgent alert for the ground console, in any state (src/server/sos.ts) ── */
  const sos = await sosTurn({ crewId, checkInId, text, lang, talking: ctx0.companion, ctx: ctx0 });
  if (sos) {
    yield* sos;
    yield { type: "timing", sttMs: Math.max(0, Math.round(input.sttMs ?? 0)), llmMs: 0, totalMs: Math.round(performance.now() - started) };
    yield { type: "done" };
    return;
  }

  /* ── assistant mode, "back to assistant" and "I'm Bat" (assistantTurn.ts): answered there, the check-up waits ── */
  // the first words (who is speaking), crisis words and a pending "shall I add it?" go there before anything else;
  // otherwise the pain check and the walkthrough come first, so "it hurts" and "how am I today?" work there too
  const runAssistant = () =>
    assistantTurn({
      crewId,
      checkIn,
      crew,
      ctx0,
      text,
      lang,
      history,
      source: input.kind === "voice" ? "voice" : getEnv().demoMode === "scripted" ? "simulated" : "typed",
      greet: input.greet === true,
      agent: args.agent ?? defaultAgent(),
    });
  const assistantFirst =
    input.greet === true || (ctx0.assistant && (assistantCrisis(text) !== null || ctx0.assistantOffer !== null));
  if (assistantFirst) {
    const first = await runAssistant();
    if (first) {
      yield* first.events;
      yield { type: "timing", sttMs: Math.max(0, Math.round(input.sttMs ?? 0)), llmMs: first.llmMs, totalMs: Math.round(performance.now() - started) };
      yield { type: "done" };
      return;
    }
  }

  /* ── "it hurts": the body map, the related data, the guide and a report to Earth (src/server/pain.ts) ── */
  // checked before the walkthrough: pain is a safety path and must never be answered with charts
  const pain = await painTurn({ crewId, checkInId, localDate: checkIn.localDate, text, lang, ctx: ctx0, history });
  if (pain) {
    yield* pain;
    yield { type: "timing", sttMs: Math.max(0, Math.round(input.sttMs ?? 0)), llmMs: 0, totalMs: Math.round(performance.now() - started) };
    yield { type: "done" };
    return;
  }

  /* ── Cosmo explains: "how am I today?", "was it like this before?", "why do I feel tired?" at any point (explain.ts) ── */
  const explained = await explainQuestionTurn({ crewId, checkInId, localDate: checkIn.localDate, text, lang, ctx: ctx0 });
  if (explained) {
    yield* explained;
    yield { type: "timing", sttMs: Math.max(0, Math.round(input.sttMs ?? 0)), llmMs: 0, totalMs: Math.round(performance.now() - started) };
    yield { type: "done" };
    return;
  }

  const assistant = assistantFirst ? null : await runAssistant();
  if (assistant) {
    yield* assistant.events;
    yield { type: "timing", sttMs: Math.max(0, Math.round(input.sttMs ?? 0)), llmMs: assistant.llmMs, totalMs: Math.round(performance.now() - started) };
    yield { type: "done" };
    return;
  }

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
    sensorFilled: new Set(ctx0.sensorFilled),
    dryRun,
  });

  const out: TurnEvent[] = [];

  /* ── 0. friend mode: a conversation on the side, at any point of the check-in (companion.ts) ── */
  const plan = planCompanion(ctx0, text, answersOpenQuestion(ctx0, expected, text, lang), agreesToOpenQuestion(ctx0, text, lang));
  if (plan?.kind === "answer") {
    // a plain answer while talking ("7 hours"): friend mode ends quietly and the answer is read as usual below
    ctx0 = transition(ctx0, { type: "COMPANION_LEAVE" }).ctx;
  } else if (plan) {
    const { events, llmMs: companionMs } = await companionTurn({
      crewId,
      checkInId,
      crew,
      ctx0,
      plan,
      text,
      lang,
      history,
      agent: args.agent ?? defaultAgent(),
    });
    out.push(...events);
    out.push({
      type: "timing",
      sttMs: Math.max(0, Math.round(input.sttMs ?? 0)),
      llmMs: companionMs,
      totalMs: Math.round(performance.now() - started),
    });
    out.push({ type: "done" });
    for (const event of out) yield event;
    return;
  }

  // the personal history (baselines) is needed both to answer a question asked back and to judge new values
  const history14 = await loadHistory(crewId, checkIn.localDate);
  const baselines = computeBaselines(history14);
  // "what is a normal heart rate?" / "is 85 a good pulse?": the general resting-adult range (vital_reference.json), the
  // value asked about or today's, and the person's own average, at any point of the check-in (null otherwise)
  const reference = answerReferenceQuestion(text, lang, { baselines, today: today.values });

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
    // the open question's facts, plus those of the question the words name ("how long should I sleep?" while water is open)
    questionFacts: expected
      ? join(
          questionFacts(expected, lang, baselines),
          (() => {
            const about = questionTopicOf(text);
            return about && about !== expected ? questionFacts(about, lang, baselines) : "";
          })(),
        )
      : undefined,
  };
  const decideStarted = performance.now();
  let used: Agent = primary;
  let decision: AgentDecision;
  try {
    decision = await primary.decide(agentArgs);
  } catch (err) {
    if (!(err instanceof LlmUnavailable)) throw err;
    // the reason only (timeout, HTTP status, refusal...), never the key: so a deployment's logs say why Claude was not used
    const cause = err.cause as { status?: unknown; name?: unknown; message?: unknown } | undefined;
    console.warn(
      `[aegis] Claude unavailable for this turn: ${err.reason}` +
        (cause ? ` (${String(cause.name ?? "")} ${String(cause.status ?? "")} ${String(cause.message ?? "").slice(0, 160)})` : ""),
    );
    out.push({ type: "error", code: "LLM_FAILED", message: "The assistant is unavailable; using the offline helper.", recoverable: true });
    used = args.fallback ?? scriptedAgent();
    decision = await used.decide(agentArgs);
  }
  let llmMs = decision.llmMs ?? Math.round(performance.now() - decideStarted);

  /* ── 2. proposals -> executeTool -> events ── */
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
  /** KPI_CAPTURE: the astronaut asked a question back; Cosmo answers it and asks the open question again */
  let askedReply: string | null = null;
  /**
   * A question about the blood panel, a blood draw or measuring in space, asked during the check-in (small talk or a
   * question): Signature Triage answers it from code-computed facts (signature.ts) instead of it being set aside. Null
   * for every other text, and after the check-in (that path below already answers it).
   */
  let midCheckInSignature: string | null = null;
  if (
    (ctx0.state === "GREETING" || ctx0.state === "SMALL_TALK" || ctx0.state === "KPI_CAPTURE") &&
    detectAskedQuestion(text, lang) !== null &&
    decision.records.length === 0
  ) {
    const sig = await answerSignatureQuestion({
      crewId,
      text,
      lang,
      ctx: { lang, today: panelClockDay(checkIn.localDate, env.missionStartDate), history: history14, todayValues: (await loadTodayValues(crewId, checkInId)).values },
      history,
      answer: used.answerAboutSignature && used === primary ? (a) => used.answerAboutSignature!(a) : undefined,
    });
    if (sig) {
      midCheckInSignature = sig.text;
      llmMs += sig.llmMs;
    }
  }
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
      if (midCheckInSignature) {
        // a blood-panel / in-space question was answered; the proposal, if one is open, is asked again
        askedReply = ctx0.proposed ? join(midCheckInSignature, TEMPLATES_EXTRA.proposeShort[lang]) : midCheckInSignature;
        break;
      }
      if (reference) {
        // a general-range question in small talk is answered (never set aside), then the proposal, if open, again
        askedReply = ctx0.proposed ? join(reference.text, TEMPLATES_EXTRA.proposeShort[lang]) : reference.text;
        break;
      }
      // after "shall we log today's measurements?" a question back ("how fast is the station?") is answered and the
      // proposal asked again; it is never taken for a yes
      const start = decision.startAnswer ?? "unclear";
      const askedBack = detectAskedQuestion(text, lang);
      const questionBack = ctx0.proposed && start !== "yes" && askedBack !== null && askedBack !== "greeting";
      send({ type: "USER_TURN", start: questionBack ? "no" : start });
      break;
    }
    case "KPI_CAPTURE": {
      const accepted = await apply(decision.records, "record_measurement");
      if (accepted.length > 0) {
        send({ type: "MEASUREMENT_ACCEPTED", keys: accepted });
      } else if (midCheckInSignature && expected !== null) {
        // "what does my blood panel mean?" mid check-in: Signature Triage answers, then the open question again
        askedReply = join(midCheckInSignature, getQuestion(expected).prompts[lang]);
      } else if (reference && expected !== null && failures.length === 0 && !decision.skip && !decision.asked?.answer) {
        // "what should my oxygen be?" / "is 85 a good pulse?" mid check-in: the general range, then the open question
        // again (a model-worded answer, when there is one, takes the asked-question path below)
        askedReply = join(reference.text, getQuestion(expected).prompts[lang]);
      } else if (expected !== null) {
        const restated = [...alreadyRecorded, ...(decision.restated ?? [])];
        const modelAsked = (decision.clarifications?.length ?? 0) > 0 || (decision.rejected?.length ?? 0) > 0;
        // a question back ("what should it be?", "why?", "say it again"): the agent's reading, or the words themselves
        const detected = detectAskedQuestion(text, lang);
        const asked =
          decision.asked ?? (detected && failures.length === 0 && !(decision.rejected?.length) ? { kind: detected } : undefined);
        const reply = !decision.skip && failures.length === 0 && asked ? askedQuestionReply(asked, detected, expected, lang, baselines, text) : null;
        if (decision.skip) {
          send({ type: "SKIP", question: expected });
        } else if (reply) {
          // answered and asked again: the machine stays on the same question and nothing counts as a failed attempt
          askedReply = reply;
        } else if (restated.length > 0 && failures.length === 0 && !modelAsked) {
          // "actually I slept 8 hours" while mood is open: noted for the read-back, the open question is asked
          // again and nothing is counted against it
          send({ type: "ALREADY_RECORDED" });
        } else {
          const q = getQuestion(expected);
          // an impossible value ("50" for temperature) is "out of range" whatever the model asked (valueChecks.ts)
          markOutOfRange(failures, rulesRangeKeys(expected, text, lang));
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
      // "is my blood pressure ok?" at the read-back: answered, then the read-back asked again (readBackQuestion.ts)
      const readBackAnswer = readBackReferenceReply(text, lang, reference?.text ?? null);
      if (readBackAnswer) {
        send({ type: "CONFIRMATION", confirmed: null });
        askedReply = readBackAnswer;
        break;
      }
      const attempted = decision.correction ?? [];
      const corrected = attempted.length > 0 ? await apply(attempted, "correct_measurement") : [];
      for (const key of corrected) correctedNow.add(key);
      for (const r of decision.rejected ?? []) {
        if (!failures.some((f) => f.key === r.key)) failures.push({ key: r.key, reason: r.reason, text: clarifyReasonText(r.reason) });
      }
      // a correction out of range is said to be out of range, also when the model only answered "no"
      markOutOfRange(failures, rulesRangeKeys(null, text, lang).filter((k) => !correctedNow.has(k)));
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
  const todayNow = await loadTodayValues(crewId, checkInId);
  const valuesNow = todayNow.values;
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
    // Signature Triage after the daily summary (build prompt T6): the triage offer when a panel arrived since the last
    // check-in, and draw advice for rules A1-A3, before the closing disclaimer. Only on the live path (an agent that
    // words signature answers): the scripted demo's summary and its pre-generated audio stay as they are.
    if (used.answerAboutSignature && used === primary) {
      spoken = insertBeforeDisclaimer(
        spoken,
        signatureFollowUp({
          crewId,
          lang,
          localDate: checkIn.localDate,
          missionStartDate: env.missionStartDate,
          history: history14,
          todayValues: valuesNow,
        }),
        findings.disclaimer[lang],
      );
    }
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
    out.push({ type: "state", state: finalState, expectedQuestion: null, companion: false });
    out.push({ type: "assistant", turnId: cosmoTurn.id, text: assistantText, language: lang, emotion });
    out.push({ type: "summary", summary: summaryPayload });
  } else {
    const effect: ReplyEffect = replyEffect ?? { type: "reply", kind: "closing" };
    let template =
      askedReply ??
      // "I heard 50 °C, which is too high for body temperature ..." instead of the general range message
      (effect.kind === "clarify" && effect.reason === "range" && effect.question && (effect.attempt ?? 0) < 2
        ? rangeReply(getQuestion(effect.question), text, lang, effect.attempt ?? 0)
        : null) ??
      renderTemplate(effect, lang, ctx, text, valuesNow, acknowledged, todayNow.sources);
    // a read-back correction was taken and another one was not: say both
    if (ctx0.state === "CONFIRM" && effect.kind === "clarify" && correctedNow.size > 0) {
      template = join(TEMPLATES_EXTRA.updated[lang], template);
    }
    assistantText = template;
    // after the check-in the astronaut can keep talking to Cosmo about today's results (dashboard Q&A)
    const afterCheckIn = ctx0.state === "DONE";
    // a question about the blood panel or a blood draw: Signature Triage answers it (signature.ts); any other question
    // takes the dashboard Q&A path below unchanged
    const signature = afterCheckIn
      ? await answerSignatureQuestion({
          crewId,
          text,
          lang,
          ctx: {
            lang,
            today: panelClockDay(checkIn.localDate, env.missionStartDate),
            history: history14,
            todayValues: valuesNow,
          },
          history,
          answer: used.answerAboutSignature && used === primary ? (a) => used.answerAboutSignature!(a) : undefined,
        })
      : null;
    if (signature) {
      assistantText = signature.text;
      llmMs += signature.llmMs;
    }
    if (afterCheckIn && !signature) {
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
      // the same backstop as every other model text: no diagnosis, condition, drug, supplement or treatment named
      assistantText =
        answer &&
        answer.length <= 600 &&
        !FORBIDDEN_REPLY.test(answer) &&
        !namesConditionOrDrug(answer) &&
        !/\p{Extended_Pictographic}/u.test(answer) &&
        numeralsAreGrounded(answer, facts, text)
          ? withReferenceCaveat(answer, text, lang)
          : (reference?.text ?? offlineResultsAnswer(facts, lang));
    }
    // the model's wording replaces the template only where the machine leaves room for it: never when a question was
    // just skipped (the template carries the "add it at the confirmation" notice), never at the read-back
    // a value past a general danger threshold: the code's wording says so, never a bland model acknowledgement
    const danger = dangerNotice(acknowledged, lang);
    // the code's own words stand for the sensor read-out (its numbers come from the feed) and after a low wellbeing
    // answer (the supportive sentence and the suggestion are fixed, never a model's improvisation)
    const codeWords = effect.intro === true || effect.question === "sensor_check" || T.wellbeingNote(acknowledged, lang) !== "";
    const modelMayWord =
      danger.length === 0 &&
      !codeWords &&
      !afterCheckIn &&
      askedReply === null &&
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
    // "is 85 a good pulse?" while the pulse is asked: the 85 is recorded, and the question is answered before the next
    if (reference && askedReply === null && acknowledged.length > 0 && effect.kind === "ask" && effect.question) {
      const prompt = getQuestion(effect.question).prompts[lang];
      if (assistantText.endsWith(prompt)) {
        assistantText = join(assistantText.slice(0, assistantText.length - prompt.length).trim(), reference.brief, prompt);
      }
    }
    if (danger && !assistantText.includes(danger)) assistantText = join(danger, assistantText);
    emotion =
      danger || (effect.kind === "clarify" && effect.reason === "range")
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
      companion: false,
    });
    out.push({ type: "assistant", turnId: cosmoTurn.id, text: assistantText, language: lang, emotion });
  }

  // the small panels Cosmo shows beside her (show.ts): chosen by code from the words and the stored values
  const show = showEvent({
    text,
    lang,
    state: ctx0.state,
    recorded: acknowledged.map((a) => a.key),
    values: valuesNow,
    history: history14,
    summary: summaryRequested,
    crewId,
  });
  if (show) out.push(show);
  // after the summary: Cosmo's step-by-step walkthrough, which replaces the dashboard intro (explain.ts)
  const walkthrough = summaryRequested
    ? await explainSummaryEvent({ crewId, checkInId, localDate: checkIn.localDate, lang, values: valuesNow, history: history14 })
    : null;
  if (walkthrough) out.push(walkthrough);

  out.push({
    type: "timing",
    sttMs: Math.max(0, Math.round(input.sttMs ?? 0)),
    llmMs,
    totalMs: Math.round(performance.now() - started),
  });
  out.push({ type: "done" });
  for (const event of out) yield event;
}
