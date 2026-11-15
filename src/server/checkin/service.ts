import "server-only";
import type {
  CheckInCreated,
  CheckInSnapshot,
  KpiKey,
  Lang,
  MeasurementSource,
  MeasurementValue,
  TurnRow,
} from "@/lib/types";
import { computeBaselines, evaluateIndicator, type HistoryDay } from "@/lib/health";
import { normalizeLanguageCode } from "@/lib/language";
import { greeting } from "@/server/agent/templates";
import { initialCtx, parseCtx, serializeCtx, type MachineCtx } from "@/server/agent/machine";
import { assistantGreeting, enterAssistant, welcomeBack } from "@/server/agent/assistantMode";
import { now } from "@/server/clock";
import {
  createCheckIn,
  getCheckIn,
  getLatestCheckInForDate,
  getOpenCheckInForDate,
  listHistoryDays,
  setCheckInLanguage,
  setCheckInState,
  type CheckInRecord,
} from "@/server/db/repos/checkin";
import { getCrewPublic } from "@/server/db/repos/crew";
import { listMeasurements } from "@/server/db/repos/measurement";
import { appendTurn, listTurns } from "@/server/db/repos/turn";
import { getDb } from "@/server/db/client";
import { LOCK_SCOPE, localDateISO, lockKeyForTransaction } from "@/server/db/shared";

/** days of confirmed history behind the baselines */
export const BASELINE_DAYS = 14;

/**
 * Starts today's check-in, or resumes today's unconfirmed one. The greeting comes from the templates (no LLM latency)
 * in `languageHint` when it is a supported language, otherwise in the crew member's preferred language, and is stored
 * as the first Cosmo turn. A resumed check-in returns its original greeting.
 * (The check-in screen sends no hint, so a crew member's check-in is in their own language; see CheckInExperience.)
 *
 * Idempotent under concurrency: "find today's open check-in, else create it" runs in one transaction, serialised per
 * crew member (an advisory lock on Postgres, which also holds across serverless instances), so two starts in flight at
 * once return the same check-in instead of creating two.
 */
export async function createOrResumeCheckIn(crewId: string, languageHint?: string | null): Promise<CheckInCreated> {
  const crew = await getCrewPublic(crewId); // NotFoundError for an unknown crew member
  const at = now();
  const db = await getDb();
  return db.transaction(async () => {
    await lockKeyForTransaction(db, LOCK_SCOPE.checkInStart, crewId);
    const open = await getOpenCheckInForDate(crewId, localDateISO(at));

    if (open) {
      const turns = await listTurns(crewId, open.id);
      const first = turns.find((t) => t.speaker === "cosmo");
      const greetingTurn =
        first ??
        (await appendTurn(crewId, open.id, {
          speaker: "cosmo",
          text: greeting(crew, open.language),
          language: open.language,
          createdAt: at,
        }));
      return {
        checkInId: open.id,
        state: open.state,
        language: open.language,
        greeting: { turnId: greetingTurn.id, text: greetingTurn.text },
        resumed: true,
      };
    }

    const language: Lang = normalizeLanguageCode(languageHint) ?? crew.preferredLanguage;
    const created = await createCheckIn(crewId, { language, startedAt: at });
    const turn = await appendTurn(crewId, created.id, {
      speaker: "cosmo",
      text: greeting(crew, language),
      language,
      createdAt: at,
    });
    return {
      checkInId: created.id,
      state: created.state,
      language,
      greeting: { turnId: turn.id, text: turn.text },
      resumed: false,
    };
  });
}

/**
 * The assistant screen ("/"): today's newest check-in row (confirmed or not), or a new one, with assistant mode on
 * (assistantMode.ts). The daily check-up on the same row waits where it stands and opens only when asked for.
 *  - `language`: the language heard in the first utterance (a resumed row follows it);
 *  - `welcome`: "quiet" = a new row's greeting is stored but not said (the reply to the first utterance greets by name
 *    instead), "back" = a resumed row gets a short "Hi Bat, I'm right here" that is said (a person was switched).
 * Serialised per crew member like createOrResumeCheckIn.
 */
export async function createOrResumeAssistant(
  crewId: string,
  opts: { language?: string | null; welcome?: "quiet" | "back" } = {},
): Promise<CheckInCreated> {
  const crew = await getCrewPublic(crewId); // NotFoundError for an unknown crew member
  const at = now();
  const db = await getDb();
  const hint = normalizeLanguageCode(opts.language);
  return db.transaction(async () => {
    await lockKeyForTransaction(db, LOCK_SCOPE.checkInStart, crewId);
    const existing = await getLatestCheckInForDate(crewId, localDateISO(at));

    if (existing) {
      const row = hint && existing.language !== hint ? await setCheckInLanguage(crewId, existing.id, hint) : existing;
      const ctx = await loadMachineCtx(row);
      if (!ctx.assistant) await saveMachineCtx(crewId, row.id, enterAssistant(ctx));
      const turns = await listTurns(crewId, row.id);
      const first = turns.find((t) => t.speaker === "cosmo");
      const greetingTurn =
        first ??
        (await appendTurn(crewId, row.id, { speaker: "cosmo", text: assistantGreeting(crew, row.language), language: row.language, createdAt: at }));
      let say: CheckInCreated["say"] = null;
      if (opts.welcome === "back") {
        const text = welcomeBack(crew, row.language);
        const turn = await appendTurn(crewId, row.id, { speaker: "cosmo", text, language: row.language, createdAt: at });
        say = { turnId: turn.id, text };
      }
      return {
        checkInId: row.id,
        state: row.confirmedAt !== null ? "DONE" : row.state,
        language: row.language,
        greeting: { turnId: greetingTurn.id, text: greetingTurn.text },
        resumed: true,
        assistant: true,
        say,
      };
    }

    const language: Lang = hint ?? crew.preferredLanguage;
    const created = await createCheckIn(crewId, { language, startedAt: at });
    await saveMachineCtx(crewId, created.id, enterAssistant(initialCtx()));
    const text = assistantGreeting(crew, language);
    const turn = await appendTurn(crewId, created.id, { speaker: "cosmo", text, language, createdAt: at });
    return {
      checkInId: created.id,
      state: created.state,
      language,
      greeting: { turnId: turn.id, text },
      resumed: false,
      assistant: true,
      say: opts.welcome === "quiet" ? null : { turnId: turn.id, text },
    };
  });
}

/** the confirmed days before the check-in's own date (today excluded), oldest first */
export async function loadHistory(crewId: string, localDate: string): Promise<HistoryDay[]> {
  return listHistoryDays(crewId, { before: localDate, days: BASELINE_DAYS });
}

export interface TodayValues {
  values: Partial<Record<KpiKey, MeasurementValue>>;
  sources: Partial<Record<KpiKey, MeasurementSource>>;
}

/** the values stored so far for this check-in (crew-scoped: another member's check-in id throws NotFoundError) */
export async function loadTodayValues(crewId: string, checkInId: string): Promise<TodayValues> {
  const values: TodayValues["values"] = {};
  const sources: TodayValues["sources"] = {};
  for (const row of await listMeasurements(crewId, checkInId)) {
    values[row.key] = row.value;
    sources[row.key] = row.source;
  }
  return { values, sources };
}

/**
 * The machine context of a check-in: state from its column, counters from state_json, and `filled` rebuilt from the
 * stored measurements (the database is the truth; a crash between two writes can never leave a stale list).
 * A confirmed check-in is always DONE.
 */
export async function loadMachineCtx(checkIn: CheckInRecord): Promise<MachineCtx> {
  const state = checkIn.confirmedAt !== null ? "DONE" : checkIn.state;
  const ctx = parseCtx(state, checkIn.stateJson);
  const { values } = await loadTodayValues(checkIn.crewId, checkIn.id);
  ctx.filled = Object.keys(values) as KpiKey[];
  return ctx;
}

export async function saveMachineCtx(crewId: string, checkInId: string, ctx: MachineCtx): Promise<void> {
  await setCheckInState(crewId, checkInId, ctx.state, serializeCtx(ctx));
}

/** reload / resume payload: the stored values with their status, and the conversation so far */
export async function getSnapshot(crewId: string, checkInId: string): Promise<CheckInSnapshot> {
  const checkIn = await getCheckIn(crewId, checkInId);
  const history = await loadHistory(crewId, checkIn.localDate);
  const baselines = computeBaselines(history);
  const measurements = (await listMeasurements(crewId, checkInId)).map((row) => {
    const ev = evaluateIndicator(row.key, row.value, baselines[row.key]);
    return { ...row, status: ev.status, reason: ev.reason };
  });
  const turns: TurnRow[] = await listTurns(crewId, checkInId);
  return {
    checkIn: {
      id: checkIn.id,
      state: checkIn.confirmedAt !== null ? "DONE" : checkIn.state,
      language: checkIn.language,
      confirmedAt: checkIn.confirmedAt,
    },
    measurements,
    turns,
  };
}
