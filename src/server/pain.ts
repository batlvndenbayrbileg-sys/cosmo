import "server-only";
import type { KpiKey, Lang, MeasurementValue, TurnEvent, TurnRow } from "@/lib/types";
import { getQuestion } from "@/lib/kpi/registry";
import type { HistoryDay } from "@/lib/health/baseline";
import { decodePerson } from "@/lib/labs/urine";
import {
  RELATED_SOURCES,
  detectPain,
  detailsAsk,
  painGuide,
  painRedFlags,
  painScript,
  readPainLocation,
  readPainOnset,
  readPainSeverity,
  relatedItems,
  scriptText,
  type PainEventData,
  type PainLocation,
  type PainOnset,
  type PainRedFlag,
  type PainReport,
  type PainSeverity,
  type PainSosStatus,
  type SignatureInput,
  type UrineInput,
} from "@/lib/pain";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { loadHistory, loadTodayValues } from "@/server/checkin/service";
import { appendTurn } from "@/server/db/repos/turn";
import { raiseSosAlert } from "@/server/db/repos/sos";
import {
  clearPainAwaiting,
  createPainReport,
  pendingPainReport,
  setPainAskedTurn,
  updatePainReport,
  type PainReportInput,
} from "@/server/db/repos/pain";
import { getUrinePersonSlice } from "@/server/labs/urine";
import { detectCrisis } from "@/server/agent/companion";
import { interpretAnswer } from "@/server/agent/interpret";
import { cursorQuestion, type MachineCtx } from "@/server/agent/machine";
import { panelClockDay, referenceCrewFor, triageFactsFor } from "@/server/agent/signature";
import { dangerValues } from "@/server/agent/valueChecks";

/**
 * The pain check in a conversation turn (src/lib/pain). Called once from runTurn, right after the SOS check, so it works
 * in small talk, mid check-in (the open question is asked again and the check-in's state is not touched), in friend
 * mode and after the check-in:
 *
 *  1. the words say something hurts (detectPain), or they answer what Cosmo just asked about a pain (where; how strong
 *     and since when) - only the very next answer, tied to the turn she asked in;
 *  2. code looks through the person's own data for the place (relatedItems: today's values against the general and
 *     personal ranges, today's symptoms, the linked Signature Triage panel and urine panel) and lists only what is
 *     unusual;
 *  3. red flags (chest pain, 8+/10 or "severe", breathing trouble / fainting / confusion words, a value today past a
 *     danger threshold) make it urgent: the matching guide, "contact the crew medical officer now", and an urgent alert
 *     through the SOS flow (raiseSosAlert: the browser then takes the face photo, src/components/sos);
 *  4. otherwise a normal report goes to the Earth console (pain_report.sent_at).
 *
 * Cosmo's line is code text (src/lib/pain/speech.ts) and says "sent" only after the server stored it. Not used: while a
 * crisis is being said (the crisis reply wins), when the summary is being written, and when the words answer the open
 * check-in question with a value (the symptom question "I have a headache" is recorded as usual) unless it is urgent.
 */

export interface PainTurnInput {
  crewId: string;
  checkInId: string;
  localDate: string;
  text: string;
  lang: Lang;
  ctx: MachineCtx;
  /** the turns before this one (oldest first): the last Cosmo turn tells whether she asked about a pain */
  history: readonly TurnRow[];
}

function lastCosmoTurn(history: readonly TurnRow[]): TurnRow | null {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].speaker === "cosmo") return history[i];
  return null;
}

function union(a: readonly PainRedFlag[], b: readonly PainRedFlag[]): PainRedFlag[] {
  const out = [...a];
  for (const f of b) if (!out.includes(f)) out.push(f);
  return out;
}

/* ───────────── the person's data ───────────── */

function signatureFor(crewId: string, lang: Lang, localDate: string): SignatureInput | null {
  try {
    const facts = triageFactsFor(crewId, lang, { today: panelClockDay(localDate, getEnv().missionStartDate) });
    if (!facts) return null;
    return { cls: facts.class, fri: facts.fri, crew: facts.crew, daysSinceLanding: facts.daysSinceLanding };
  } catch (err) {
    // the lab files are missing in this deployment: the pain check goes on without the panel
    console.warn("[cosmo] pain: Signature Triage panel unavailable:", (err as Error).message);
    return null;
  }
}

function urineFor(crewId: string): UrineInput | null {
  const person = referenceCrewFor(crewId);
  if (!person) return null;
  const slice = getUrinePersonSlice(person);
  if (!slice) return null;
  const view = decodePerson(slice);
  const sampled = view.post.filter((p) => p.sampled && p.counts);
  const latest = sampled[sampled.length - 1];
  if (!latest?.counts) return null;
  return { person: view.person, timepoint: latest.timepoint, abnormal: latest.counts.abnormal, borderline: latest.counts.borderline };
}

interface DataContext {
  today: Partial<Record<KpiKey, MeasurementValue>>;
  history: HistoryDay[];
}

async function loadData(p: PainTurnInput): Promise<DataContext> {
  const [today, history] = await Promise.all([loadTodayValues(p.crewId, p.checkInId), loadHistory(p.crewId, p.localDate)]);
  return { today: today.values, history };
}

/* ───────────── one decision ───────────── */

interface Decision {
  location: PainLocation | null;
  severity: PainSeverity | null;
  onset: PainOnset | null;
  /** the words' own red flags (dangerous values are added from the data) */
  wordFlags: PainRedFlag[];
  clause: string;
  phrase: string;
  /** an earlier report this answer completes */
  pending: PainReport | null;
  /** the answer to "how strong / since when": no new data line, no new question */
  update: boolean;
}

/**
 * The pain turn, or null when the words are not about a pain (the turn goes on as usual). Events: `sos` (urgent only,
 * as stored), `pain`, Cosmo's `assistant` line; the caller adds timing and done.
 */
export async function painTurn(p: PainTurnInput): Promise<TurnEvent[] | null> {
  const { ctx } = p;
  if (ctx.state === "SUMMARY") return null;
  if (detectCrisis(p.text, ctx.companion)) return null;

  const asked = lastCosmoTurn(p.history);
  const pending = asked ? await pendingPainReport(p.crewId, p.checkInId, asked.id) : null;
  const reading = detectPain(p.text);
  let decision: Decision | null = null;

  if (pending?.awaiting === "location") {
    const location = reading?.location ?? readPainLocation(p.text);
    if (location || reading) {
      const severity = reading?.severity ?? readPainSeverity(p.text) ?? pending.severity;
      decision = {
        location,
        severity,
        onset: reading?.onset ?? readPainOnset(p.text) ?? pending.onset,
        wordFlags: union(pending.redFlags.filter((f) => f !== "danger_vital"), painRedFlags(location, severity, p.text)),
        clause: reading?.clause ?? p.text.toLowerCase(),
        phrase: reading?.phrase ?? p.text.trim().slice(0, 60),
        pending,
        update: false,
      };
    }
  } else if (pending?.awaiting === "details" && !(reading?.location && reading.location !== pending.location)) {
    const severity = readPainSeverity(p.text, { bare: true });
    const onset = readPainOnset(p.text);
    const flags = painRedFlags(null, severity, p.text);
    if (severity || onset || flags.length > 0) {
      const merged = severity ?? pending.severity;
      decision = {
        location: pending.location,
        severity: merged,
        onset: onset ?? pending.onset,
        wordFlags: union(pending.redFlags.filter((f) => f !== "danger_vital"), painRedFlags(pending.location, merged, p.text)),
        clause: "",
        // the answer as said ("9, it just started"): the words that made it urgent
        phrase: reading?.phrase ?? p.text.trim().slice(0, 60),
        pending,
        update: true,
      };
    }
  }

  if (!decision && reading) {
    // the words answer the open check-in question ("I have a headache" to the symptom question): recorded as usual,
    // unless the pain is urgent or goes with a first-aid guide ("I hit my head and it hurts": the browser leaves the
    // guide to this pain check, so swallowing it here would show neither)
    const expected = ctx.state === "KPI_CAPTURE" && !ctx.companion ? cursorQuestion(ctx) : null;
    const withGuide = painGuide({ location: reading.location, clause: reading.clause, redFlags: [], urgent: false }) !== null;
    if (
      expected &&
      // the sensor follow-up takes any words, so a pain said there is the pain check, never just a note
      expected !== "sensor_check" &&
      reading.redFlags.length === 0 &&
      !withGuide &&
      interpretAnswer(getQuestion(expected), p.text, p.lang).records.length > 0
    ) {
      if (pending) await clearPainAwaiting(p.crewId, pending.id);
      return null;
    }
    decision = {
      location: reading.location,
      severity: reading.severity,
      onset: reading.onset,
      wordFlags: reading.redFlags,
      clause: reading.clause,
      phrase: reading.phrase,
      pending: null,
      update: false,
    };
  }

  if (!decision) {
    // Cosmo asked, and the person said something else: the question is dropped and the turn goes on as usual
    if (pending) await clearPainAwaiting(p.crewId, pending.id);
    return null;
  }
  return respond(p, decision);
}

async function respond(p: PainTurnInput, d: Decision): Promise<TurnEvent[]> {
  const { crewId, checkInId, lang, ctx } = p;
  const data = await loadData(p);

  const sources = d.location ? RELATED_SOURCES[d.location] : [];
  const items = relatedItems({
    location: d.location,
    today: data.today,
    history: data.history,
    signature: sources.includes("signature") ? signatureFor(crewId, lang, p.localDate) : null,
    urine: sources.includes("urine") ? urineFor(crewId) : null,
  });
  const todayRecords = (Object.entries(data.today) as Array<[KpiKey, MeasurementValue]>).map(([key, value]) => ({ key, value }));
  const redFlags = dangerValues(todayRecords).length > 0 ? union(d.wordFlags, ["danger_vital"]) : d.wordFlags;
  const urgent = redFlags.length > 0;
  const guideId = painGuide({ location: d.location, clause: d.clause, redFlags, urgent });
  const awaiting: PainEventData["awaiting"] =
    d.location === null ? "location" : !urgent && !d.update && detailsAsk(d.severity, d.onset) !== null ? "details" : null;
  const send = d.location !== null || urgent;

  // urgent: an urgent alert to Earth through the SOS flow (once per incident; the browser takes the photo for it)
  let sosEvent: Extract<TurnEvent, { type: "sos" }> | null = null;
  let sos: PainSosStatus | null = null;
  let sosAlertId = d.pending?.sosAlertId ?? null;
  if (urgent) {
    try {
      const { alert, duplicate } = await raiseSosAlert(crewId, { reason: "voice", phrase: d.phrase, checkInId });
      sosEvent = { type: "sos", ok: true, alertId: alert.id, createdAt: alert.createdAt, duplicate, photoStatus: alert.photoStatus };
      sos = duplicate ? "duplicate" : "sent";
      sosAlertId = alert.id;
    } catch (err) {
      console.error("[cosmo] pain: the urgent alert could not be stored:", err);
      sosEvent = { type: "sos", ok: false, alertId: null, createdAt: null, duplicate: false, photoStatus: null };
      sos = "failed";
    }
  }

  const input: PainReportInput = {
    location: d.location,
    severity: d.severity,
    onset: d.onset,
    items,
    redFlags,
    urgent,
    guideId,
    sosAlertId,
    send,
    awaiting,
  };
  let report: PainReport | null = null;
  try {
    report = d.pending ? await updatePainReport(crewId, d.pending.id, input) : await createPainReport(crewId, checkInId, input);
  } catch (err) {
    console.error("[cosmo] pain: the report could not be stored:", err);
  }
  const reportSent = report?.sentAt != null;

  const expected = ctx.state === "KPI_CAPTURE" && !ctx.companion ? cursorQuestion(ctx) : null;
  const script = painScript({
    lang,
    location: d.location,
    severity: d.severity,
    onset: d.onset,
    items,
    guideId,
    urgent,
    reportSent,
    sos,
    awaiting,
    updated: d.update,
    resume: awaiting === null && expected ? getQuestion(expected).prompts[lang] : null,
  });
  const spoken = scriptText(script);
  const cosmoTurn = await appendTurn(crewId, checkInId, { speaker: "cosmo", text: spoken, language: lang, createdAt: now() });
  if (awaiting && report) {
    try {
      await setPainAskedTurn(crewId, report.id, cosmoTurn.id);
    } catch (err) {
      console.error("[cosmo] pain: remembering the question failed:", err);
    }
  }

  const pain: Extract<TurnEvent, { type: "pain" }> = {
    type: "pain",
    reportId: report?.id ?? null,
    location: d.location,
    severity: d.severity,
    onset: d.onset,
    items,
    guideId,
    urgent,
    redFlags,
    reportSent,
    sentAt: report?.sentAt ?? null,
    sos,
    awaiting,
    script,
  };
  return [
    ...(sosEvent ? [sosEvent] : []),
    pain,
    { type: "assistant", turnId: cosmoTurn.id, text: spoken, language: lang, emotion: "concerned" },
  ];
}
