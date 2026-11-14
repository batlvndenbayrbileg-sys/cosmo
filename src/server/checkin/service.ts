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
import { parseCtx, serializeCtx, type MachineCtx } from "@/server/agent/machine";
import { now } from "@/server/clock";
import {
  createCheckIn,
  getCheckIn,
  getOpenCheckInForDate,
  listHistoryDays,
  setCheckInState,
  type CheckInRecord,
} from "@/server/db/repos/checkin";
import { getCrewPublic } from "@/server/db/repos/crew";
import { listMeasurements } from "@/server/db/repos/measurement";
import { appendTurn, listTurns } from "@/server/db/repos/turn";
import { localDateISO } from "@/server/db/shared";

/** days of confirmed history behind the baselines */
export const BASELINE_DAYS = 14;

/**
 * Starts today's check-in, or resumes today's unconfirmed one. The greeting comes from the templates (no LLM latency)
 * in `languageHint` when it is a supported language, otherwise in the crew member's preferred language, and is stored
 * as the first Cosmo turn. A resumed check-in returns its original greeting.
 * (The check-in screen sends no hint, so a crew member's check-in is in their own language; see CheckInExperience.)
 */
export function createOrResumeCheckIn(crewId: string, languageHint?: string | null): CheckInCreated {
  const crew = getCrewPublic(crewId); // NotFoundError for an unknown crew member
  const at = now();
  const open = getOpenCheckInForDate(crewId, localDateISO(at));

  if (open) {
    const turns = listTurns(crewId, open.id);
    const first = turns.find((t) => t.speaker === "cosmo");
    const greetingTurn =
      first ??
      appendTurn(crewId, open.id, {
        speaker: "cosmo",
        text: greeting(crew, open.language),
        language: open.language,
        createdAt: at,
      });
    return {
      checkInId: open.id,
      state: open.state,
      language: open.language,
      greeting: { turnId: greetingTurn.id, text: greetingTurn.text },
      resumed: true,
    };
  }

  const language: Lang = normalizeLanguageCode(languageHint) ?? crew.preferredLanguage;
  const created = createCheckIn(crewId, { language, startedAt: at });
  const turn = appendTurn(crewId, created.id, {
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
}

/** the confirmed days before the check-in's own date (today excluded), oldest first */
export function loadHistory(crewId: string, localDate: string): HistoryDay[] {
  return listHistoryDays(crewId, { before: localDate, days: BASELINE_DAYS });
}

export interface TodayValues {
  values: Partial<Record<KpiKey, MeasurementValue>>;
  sources: Partial<Record<KpiKey, MeasurementSource>>;
}

/** the values stored so far for this check-in (crew-scoped: another member's check-in id throws NotFoundError) */
export function loadTodayValues(crewId: string, checkInId: string): TodayValues {
  const values: TodayValues["values"] = {};
  const sources: TodayValues["sources"] = {};
  for (const row of listMeasurements(crewId, checkInId)) {
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
export function loadMachineCtx(checkIn: CheckInRecord): MachineCtx {
  const state = checkIn.confirmedAt !== null ? "DONE" : checkIn.state;
  const ctx = parseCtx(state, checkIn.stateJson);
  const { values } = loadTodayValues(checkIn.crewId, checkIn.id);
  ctx.filled = Object.keys(values) as KpiKey[];
  return ctx;
}

export function saveMachineCtx(crewId: string, checkInId: string, ctx: MachineCtx): void {
  setCheckInState(crewId, checkInId, ctx.state, serializeCtx(ctx));
}

/** reload / resume payload: the stored values with their status, and the conversation so far */
export function getSnapshot(crewId: string, checkInId: string): CheckInSnapshot {
  const checkIn = getCheckIn(crewId, checkInId);
  const history = loadHistory(crewId, checkIn.localDate);
  const baselines = computeBaselines(history);
  const measurements = listMeasurements(crewId, checkInId).map((row) => {
    const ev = evaluateIndicator(row.key, row.value, baselines[row.key]);
    return { ...row, status: ev.status, reason: ev.reason };
  });
  const turns: TurnRow[] = listTurns(crewId, checkInId);
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
