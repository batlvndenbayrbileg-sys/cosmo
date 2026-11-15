import "server-only";
import type {
  AssistantAction,
  CrewPublic,
  KpiKey,
  Lang,
  MeasurementSource,
  MeasurementValue,
  TurnEvent,
  TurnRow,
} from "@/lib/types";
import { computeBaselines, evaluateIndicator, type HistoryDay } from "@/lib/health";
import { getQuestion } from "@/lib/kpi/registry";
import { detectIdentityClaim } from "@/lib/identity";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { getDb } from "@/server/db/client";
import { latestConfirmedCheckIn, type CheckInRecord } from "@/server/db/repos/checkin";
import { appendTurn } from "@/server/db/repos/turn";
import { raiseCrisisAlert } from "@/server/alerts";
import { loadHistory, loadTodayValues, saveMachineCtx } from "@/server/checkin/service";
import type { Agent, Emotion } from "./agent";
import {
  LINES,
  assistantCrisis,
  asksAboutOwnData,
  backToAssistantLine,
  buildAssistantDirective,
  checkupProgress,
  checkupStartLine,
  enterAssistant,
  intro,
  isBackToAssistant,
  isHello,
  isSaneAssistantReply,
  isShowDashboard,
  isStartCheckup,
  isSwitchPerson,
  offerLine,
  startCheckup,
  withNameGreeting,
} from "./assistantMode";
import {
  companionLeaveLine,
  companionReply,
  crisisReply,
  detectCompanionExit,
  detectCompanionRequest,
  detectCrisis,
  isSaneCompanionReply,
} from "./companion";
import { interpretOpportunistic, interpretYesNo } from "./interpret";
import { cursorQuestion, type AssistantOffer, type MachineCtx } from "./machine";
import { answerReferenceQuestion, detectAskedQuestion, withReferenceCaveat } from "./questions";
import { buildResultsFacts, type ResultsFacts } from "./resultsFacts";
import { showEvent, showTopics } from "./show";
import { answerSignatureQuestion, panelClockDay } from "./signature";
import * as T from "./templates";
import { executeTool } from "./tools";

/**
 * One turn of assistant mode (assistantMode.ts), run by turn.ts right after the SOS check and before everything else.
 *
 * Returns null when the turn is not the assistant's: assistant mode is off (the daily check-up is running) and the words
 * neither ask to go back to the assistant nor name another person. Otherwise it answers, persists Cosmo's line and the
 * context, and returns the events after `transcript` (the caller adds timing and done):
 *   state (with `assistant`), measurement (a confirmed value only), action (dashboard / identity), assistant, show.
 *
 * Nothing about the check-up moves here except the two switches, and nothing is recorded unless the astronaut
 * volunteered a value and then said yes to "shall I add it?" (the value goes through the same executeTool validation
 * as every check-up answer). Numbers in model wording must come from the code-computed facts (isSaneAssistantReply).
 */

export interface AssistantTurnArgs {
  crewId: string;
  checkIn: CheckInRecord;
  crew: CrewPublic;
  ctx0: MachineCtx;
  text: string;
  lang: Lang;
  /** earlier turns of this row, oldest first, without the current utterance */
  history: TurnRow[];
  source: MeasurementSource;
  /** the first words after the speaker was recognised: Cosmo greets them by name in the same line */
  greet: boolean;
  agent: Agent;
}

interface LatestData {
  checkInId: string | null;
  date: string | null;
  values: Partial<Record<KpiKey, MeasurementValue>>;
  history: HistoryDay[];
}

/** the newest confirmed check-in (today's row when it is confirmed), with the history before it */
async function latestData(crewId: string, checkIn: CheckInRecord): Promise<LatestData> {
  const confirmed = checkIn.confirmedAt !== null ? checkIn : await latestConfirmedCheckIn(crewId);
  if (!confirmed) return { checkInId: null, date: null, values: {}, history: await loadHistory(crewId, checkIn.localDate) };
  const values = (await loadTodayValues(crewId, confirmed.id)).values;
  return { checkInId: confirmed.id, date: confirmed.localDate, values, history: await loadHistory(crewId, confirmed.localDate) };
}

function join(...parts: string[]): string {
  return parts.filter((p) => p.trim().length > 0).join(" ");
}

/** without the model: the headline of the latest results, the first suggestion, and an offer to explain */
function offlineResults(facts: ResultsFacts, today: boolean, lang: Lang): string {
  const lead = today ? "" : lang === "mn" ? "Сүүлийн үзлэгийн дүнгээр:" : "From your last check-up:";
  const first = facts.plan[0];
  return join(
    lead,
    facts.headline,
    first ? (lang === "mn" ? `Эхний санал: ${first.title}.` : `First suggestion: ${first.title}.`) : "",
    lang === "mn" ? "Аль ч үзүүлэлтийг асуувал тайлбарлаж өгье." : "Ask me about any value and I'll explain it.",
  ).replace(/\.\./gu, ".");
}

function stateEvent(ctx: MachineCtx): Extract<TurnEvent, { type: "state" }> {
  return {
    type: "state",
    state: ctx.state,
    expectedQuestion: !ctx.assistant && !ctx.companion && ctx.state === "KPI_CAPTURE" ? cursorQuestion(ctx) : null,
    companion: ctx.companion,
    assistant: ctx.assistant,
  };
}

/** the line that resumes the check-up where it stands (start / continue) */
async function resumeCheckupLine(
  crewId: string,
  checkInId: string,
  resume: ReturnType<typeof startCheckup>,
  lang: Lang,
): Promise<string> {
  const lead = checkupStartLine(resume.resume, lang);
  switch (resume.resume) {
    case "greeting":
    case "dashboard":
      return lead;
    case "propose":
      return join(lead, T.proposeMeasurements(lang));
    case "question":
      return resume.question ? join(lead, T.askQuestion(getQuestion(resume.question), lang)) : lead;
    case "readBack":
      return join(lead, T.readBack((await loadTodayValues(crewId, checkInId)).values, lang));
  }
}

export async function assistantTurn(p: AssistantTurnArgs): Promise<{ events: TurnEvent[]; llmMs: number } | null> {
  const { crewId, checkIn, crew, ctx0, text, lang } = p;

  // crisis words always win over a command or a name: during the check-up its own crisis path answers them (friend mode
  // in turn.ts), in assistant mode the crisis reply below
  const crisisWords = detectCrisis(text, false) !== null;

  /* ── who is speaking: "би Бат", "I'm Mira", "биш, Сараа" (a strict claim of someone else, in either mode) ── */
  const claim = crisisWords ? null : detectIdentityClaim(text, { strict: true });
  const claimed = claim?.crewId && claim.crewId !== crewId ? claim.crewId : null;

  if (!ctx0.assistant && (crisisWords || (!claimed && !isBackToAssistant(text, ctx0.companion)))) return null;

  let ctx: MachineCtx = ctx0;
  let reply = "";
  let emotion: Emotion = "neutral";
  let action: AssistantAction | null = null;
  let crisis: ReturnType<typeof detectCrisis> = null;
  let llmMs = 0;
  const extra: TurnEvent[] = [];
  let recordedKeys: KpiKey[] = [];
  let latest: LatestData | null = null;
  const loadLatest = async () => (latest ??= await latestData(crewId, checkIn));

  if (claimed) {
    // the screen signs the other person in and opens their own conversation, which greets them by name
    action = { kind: "identity", crewId: claimed };
    reply = lang === "mn" ? "Ойлголоо." : "Got it.";
    emotion = "happy";
  } else if (!ctx0.assistant) {
    // during the check-up: "back to assistant" keeps the check-up exactly where it is
    ctx = enterAssistant(ctx0);
    reply = backToAssistantLine(checkupProgress(ctx0), lang);
    emotion = "happy";
    action = { kind: "assistant" };
  } else {
    const answered = await answerInAssistantMode(p, loadLatest);
    ctx = answered.ctx;
    reply = answered.reply;
    emotion = answered.emotion;
    action = answered.action;
    crisis = answered.crisis;
    llmMs = answered.llmMs;
    extra.push(...answered.events);
    recordedKeys = answered.recorded;
  }

  if (p.greet && action?.kind !== "identity") reply = withNameGreeting(reply, crew, lang);

  const db = await getDb();
  const cosmoTurn = await db.transaction(async () => {
    const turn = await appendTurn(crewId, checkIn.id, { speaker: "cosmo", text: reply, language: lang, createdAt: now() });
    if (crisis) await raiseCrisisAlert(crewId, checkIn.id, crisis);
    await saveMachineCtx(crewId, checkIn.id, ctx);
    return turn;
  });

  // the order every turn keeps: measurement, state, action, assistant, show (tests/scripted-flow.test.ts)
  const events: TurnEvent[] = [...extra, stateEvent(ctx)];
  if (action) events.push({ type: "action", action });
  events.push({ type: "assistant", turnId: cosmoTurn.id, text: reply, language: lang, emotion });

  // the small panels beside Cosmo (show.ts): a value just added, or a topic asked about, from the latest data
  if (ctx.assistant && action === null) {
    const data = await loadLatest();
    const values = recordedKeys.length > 0 ? (await loadTodayValues(crewId, checkIn.id)).values : data.values;
    const show = showEvent({ text, lang, state: "SMALL_TALK", recorded: recordedKeys, values, history: data.history, summary: false, crewId });
    if (show) events.push(show);
  }
  return { events, llmMs };
}

interface Answered {
  ctx: MachineCtx;
  reply: string;
  emotion: Emotion;
  action: AssistantAction | null;
  crisis: ReturnType<typeof detectCrisis>;
  llmMs: number;
  events: TurnEvent[];
  recorded: KpiKey[];
}

async function answerInAssistantMode(p: AssistantTurnArgs, loadLatest: () => Promise<LatestData>): Promise<Answered> {
  const { crewId, checkIn, crew, ctx0, text, lang } = p;
  const out: Answered = { ctx: ctx0, reply: "", emotion: "neutral", action: null, crisis: null, llmMs: 0, events: [], recorded: [] };
  const say = (reply: string, emotion: Emotion = "neutral", ctx: MachineCtx = out.ctx): Answered => {
    out.reply = reply;
    out.emotion = emotion;
    out.ctx = ctx;
    return out;
  };
  /** the check-up starts or continues where it stands; a confirmed one opens the dashboard */
  const beginCheckup = async (): Promise<Answered> => {
    const resume = startCheckup(ctx0);
    if (resume.resume === "dashboard") out.action = { kind: "dashboard", checkInId: checkIn.id };
    return say(await resumeCheckupLine(crewId, checkIn.id, resume, lang), "happy", resume.ctx);
  };
  const base: MachineCtx = { ...ctx0, assistantOffer: null };

  /* ── crisis words first: the code-written reply and a red alert (as in friend mode), whatever else was said or
        offered ("no, I want to die" to "shall I add it?" is not a "no"); a clear denial of a symptom is not one ── */
  const crisis = assistantCrisis(text);
  if (crisis) {
    out.crisis = crisis;
    return say(crisisReply(lang, crisis), "concerned", { ...base, companionCrisis: true, assistantTalkTurns: base.assistantTalkTurns + 1 });
  }

  /* ── the commands ── */
  if (isSwitchPerson(text)) {
    out.action = { kind: "identity", crewId: null };
    return say(LINES.switchPerson[lang], "happy", base);
  }
  if (isStartCheckup(text)) return beginCheckup();
  if (isShowDashboard(text)) {
    const data = await loadLatest();
    if (data.checkInId) {
      out.action = { kind: "dashboard", checkInId: data.checkInId };
      return say(LINES.dashboard[lang], "happy", base);
    }
    return say(LINES.noResults[lang], "neutral", { ...base, assistantOffer: { kind: "checkup" } });
  }
  if (isBackToAssistant(text, false)) {
    out.action = { kind: "assistant" };
    return say(LINES.alreadyHere[lang], "happy", base);
  }

  /* ── the answer to "shall I add it?" / "shall we start your check-up?" ── */
  const offer = ctx0.assistantOffer;
  if (offer) {
    const yes = interpretYesNo(text, lang);
    if (yes === true && offer.kind === "checkup") return beginCheckup();
    if (yes === true && offer.kind === "record") return recordOffer(p, offer, out, say, base);
    if (yes === false) return say(offer.kind === "checkup" ? LINES.notNow[lang] : LINES.declined[lang], "neutral", base);
    // neither: the offer lapses and the words are answered as they are
  }

  const data = await loadLatest();
  const todayIsLatest = data.checkInId === checkIn.id;

  /* ── the blood panel / a blood draw / measuring in space (Signature Triage) ── */
  const sig = await answerSignatureQuestion({
    crewId,
    text,
    lang,
    ctx: { lang, today: panelClockDay(checkIn.localDate, getEnv().missionStartDate), history: data.history, todayValues: data.values },
    history: p.history,
    answer: p.agent.answerAboutSignature ? (a) => p.agent.answerAboutSignature!(a) : undefined,
  });
  if (sig) {
    out.llmMs += sig.llmMs;
    return say(sig.text, "neutral", base);
  }

  /* ── "what is a normal heart rate?", "is 85 a good pulse?": the general range and the person's own average ── */
  const baselines = computeBaselines(data.history);
  // "today you told me ..." only ever quotes today's own values, never an earlier day's
  const todayValues = todayIsLatest ? data.values : (await loadTodayValues(crewId, checkIn.id)).values;
  const reference = answerReferenceQuestion(text, lang, { baselines, today: todayValues });
  if (reference) return say(reference.text, "neutral", base);

  /* ── a value volunteered ("my pulse is 72"): offered, never recorded without a yes ── */
  const heard = interpretOpportunistic(text, lang);
  if (heard.length > 0 && detectAskedQuestion(text, lang) === null) {
    if (ctx0.state === "DONE" || ctx0.state === "SUMMARY") return say(LINES.confirmedDay[lang], "neutral", base);
    const tool = ctx0.state === "CONFIRM" ? "correct_measurement" : "record_measurement";
    const usable: typeof heard = [];
    for (const r of heard) {
      const input =
        tool === "record_measurement"
          ? { key: r.key, value: r.value, unit: r.unit, source_text: r.sourceText, confidence: r.confidence }
          : { key: r.key, value: r.value, source_text: r.sourceText, confidence: r.confidence };
      const res = await executeTool(
        { crewId, checkInId: checkIn.id, state: ctx0.state, lang, utterance: text, source: p.source, filled: new Set(ctx0.filled), dryRun: true },
        tool,
        input,
      );
      if (res.ok || (!res.ok && res.code === "already_recorded")) usable.push(r);
    }
    if (usable.length === 0) return say(LINES.unusable[lang], "concerned", base);
    const records = usable.map((r) => ({ key: r.key, value: r.value, unit: r.unit, sourceText: r.sourceText, confidence: r.confidence }));
    return say(offerLine(records, lang), "neutral", { ...base, assistantOffer: { kind: "record", utterance: text, records } });
  }

  /* ── friend talk inside the assistant: a request to talk or a feeling, and "thanks, I'm good" after it ── */
  if (ctx0.assistantTalkTurns > 0 && detectCompanionExit(text)) {
    return say(join(companionLeaveLine(lang, ctx0.assistantTalkTurns), LINES.talkMore[lang]), "happy", { ...base, assistantTalkTurns: 0 });
  }
  // while talking, anything but a question is one more turn of the talk; a question is answered below (the talk ends)
  if (detectCompanionRequest(text) !== null || (ctx0.assistantTalkTurns > 0 && detectAskedQuestion(text, lang) === null)) {
    const turn = ctx0.assistantTalkTurns + 1;
    let reply = companionReply(lang, turn, text, ctx0.companionCrisis);
    if (p.agent.companionReply) {
      const asked = performance.now();
      try {
        const worded = await p.agent.companionReply({ crew, ctx: { ...ctx0, companionTurns: turn }, turn, text, lang, history: p.history });
        if (worded && isSaneCompanionReply(worded, lang, text, ctx0.companionCrisis)) reply = worded.trim();
      } catch {
        // the template stands
      }
      out.llmMs += Math.round(performance.now() - asked);
    }
    return say(reply, "neutral", { ...base, assistantTalkTurns: turn });
  }

  /* ── the urine lab panels are shown on screen (show.ts); the words say what they are ── */
  if (showTopics(text).includes("labs")) return say(LINES.labs[lang], "neutral", { ...base, assistantTalkTurns: 0 });

  /* ── a plain hello ── */
  if (isHello(text)) return say(intro(lang), "happy", { ...base, assistantTalkTurns: 0 });

  /* ── anything else: the live model from the facts, else the code-written answer ── */
  const facts = buildResultsFacts(data.values, data.history, lang);
  const hasResults = data.checkInId !== null && facts.indicators.length > 0;
  const modelFacts = {
    latest_results: hasResults ? { date: data.date, is_today: todayIsLatest, ...facts } : null,
    general_reference: facts.generalReference,
  };
  const factsJson = JSON.stringify(modelFacts);
  const plain = { ...base, assistantTalkTurns: 0 };
  if (p.agent.assistantReply) {
    const directive = buildAssistantDirective({ lang, crewName: crew.name, progress: checkupProgress(ctx0), facts: modelFacts });
    const asked = performance.now();
    let worded: string | null = null;
    try {
      worded = await p.agent.assistantReply({ directive, text, lang, history: p.history });
    } catch {
      worded = null;
    }
    out.llmMs += Math.round(performance.now() - asked);
    if (worded && isSaneAssistantReply(worded, factsJson, text, lang)) return say(withReferenceCaveat(worded.trim(), text, lang), "neutral", plain);
  }
  if (asksAboutOwnData(text) || showTopics(text).length > 0) {
    return say(hasResults ? offlineResults(facts, todayIsLatest, lang) : LINES.noData[lang], "neutral", plain);
  }
  if (detectAskedQuestion(text, lang) !== null) return say(LINES.offlineGeneral[lang], "neutral", plain);
  return say(LINES.fallback[lang], "neutral", plain);
}

/** the astronaut said yes to "shall I add it?": the values go through executeTool exactly like a check-up answer */
async function recordOffer(
  p: AssistantTurnArgs,
  offer: Extract<AssistantOffer, { kind: "record" }>,
  out: Answered,
  say: (reply: string, emotion?: Emotion, ctx?: MachineCtx) => Answered,
  base: MachineCtx,
): Promise<Answered> {
  const { crewId, checkIn, ctx0, lang } = p;
  if (ctx0.state === "DONE" || ctx0.state === "SUMMARY") return say(LINES.confirmedDay[lang], "neutral", base);
  const tool = ctx0.state === "CONFIRM" ? "correct_measurement" : "record_measurement";
  const filled = new Set<KpiKey>(ctx0.filled);
  const history = await loadHistory(crewId, checkIn.localDate);
  const baselines = computeBaselines(history);
  let already = false;
  for (const r of offer.records) {
    const input =
      tool === "record_measurement"
        ? { key: r.key, value: r.value, unit: r.unit, source_text: r.sourceText, confidence: r.confidence }
        : { key: r.key, value: r.value, source_text: r.sourceText, confidence: r.confidence };
    const res = await executeTool(
      { crewId, checkInId: checkIn.id, state: ctx0.state, lang, utterance: offer.utterance, source: p.source, filled },
      tool,
      input,
    );
    if (res.ok && res.effect?.type === "measurement") {
      const e = res.effect;
      filled.add(e.key);
      out.recorded.push(e.key);
      const ev = evaluateIndicator(e.key, e.value, baselines[e.key]);
      out.events.push({
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
      already = true;
    }
  }
  const reply = out.recorded.length > 0 ? LINES.recorded[lang] : already ? LINES.alreadyRecorded[lang] : LINES.unusable[lang];
  return say(reply, out.recorded.length > 0 ? "happy" : "neutral", { ...base, filled: [...filled] });
}
