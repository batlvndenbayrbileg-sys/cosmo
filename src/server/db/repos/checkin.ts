import "server-only";
import type { ConversationState, KpiKey, Lang, MeasurementValue } from "@/lib/types";
import { HttpError, NotFoundError } from "@/server/http";
import { getDb } from "../client";
import { CHECK_IN_COLUMNS, mapCheckIn, type CheckInDbRow, type CheckInRecord } from "../rows";
import {
  assertCrewExists,
  assertDateISO,
  isLang,
  localDateISO,
  newId,
  queryHistoryDays,
  toIso,
} from "../shared";

export type { CheckInRecord } from "../rows";

const STATES: readonly ConversationState[] = [
  "GREETING",
  "SMALL_TALK",
  "KPI_CAPTURE",
  "CONFIRM",
  "SUMMARY",
  "DONE",
];

/** Same structure as HistoryDay in src/lib/health/baseline.ts (kept local on purpose). */
export interface HistoryDayRecord {
  date: string;
  values: Partial<Record<KpiKey, MeasurementValue>>;
}

export function createCheckIn(
  crewId: string,
  input: { language: Lang; startedAt?: string | Date; id?: string },
): CheckInRecord {
  if (!isLang(input.language)) throw new HttpError(400, "BAD_INPUT", "Invalid language");
  const db = getDb();
  assertCrewExists(db, crewId);
  const startedAt = toIso(input.startedAt ?? new Date(), "startedAt");
  const id = input.id ?? newId();
  db.prepare(
    `INSERT INTO check_in (id, crew_id, started_at, local_date, language, state, state_json)
     VALUES (?, ?, ?, ?, ?, 'GREETING', '{}')`,
  ).run(id, crewId, startedAt, localDateISO(new Date(startedAt)), input.language);
  return getCheckIn(crewId, id);
}

/** Throws NotFoundError when the id does not exist OR belongs to another crew member. */
export function getCheckIn(crewId: string, id: string): CheckInRecord {
  const row = getDb()
    .prepare(`SELECT ${CHECK_IN_COLUMNS} FROM check_in WHERE id = ? AND crew_id = ?`)
    .get(id, crewId) as CheckInDbRow | undefined;
  if (!row) throw new NotFoundError("Check-in not found");
  return mapCheckIn(row);
}

/**
 * The newest unconfirmed check-in that started on the given server-local date (YYYY-MM-DD), or
 * null. Used to resume an interrupted check-in.
 */
export function getOpenCheckInForDate(crewId: string, dateISO: string): CheckInRecord | null {
  assertDateISO(dateISO);
  const row = getDb()
    .prepare(
      `SELECT ${CHECK_IN_COLUMNS} FROM check_in
        WHERE crew_id = ? AND local_date = ? AND confirmed_at IS NULL
        ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(crewId, dateISO) as CheckInDbRow | undefined;
  return row ? mapCheckIn(row) : null;
}

/** Persists the state machine position. `stateJson` is left untouched when omitted. */
export function setCheckInState(
  crewId: string,
  id: string,
  state: ConversationState,
  stateJson?: string,
): CheckInRecord {
  if (!STATES.includes(state)) throw new HttpError(400, "BAD_INPUT", "Invalid state");
  const db = getDb();
  const res =
    stateJson === undefined
      ? db.prepare("UPDATE check_in SET state = ? WHERE id = ? AND crew_id = ?").run(state, id, crewId)
      : db
          .prepare("UPDATE check_in SET state = ?, state_json = ? WHERE id = ? AND crew_id = ?")
          .run(state, stateJson, id, crewId);
  if (res.changes === 0) throw new NotFoundError("Check-in not found");
  return getCheckIn(crewId, id);
}

/**
 * Marks the check-in confirmed (once). `confirmed_at` is the clock the Earth link delay is measured
 * against, so a second confirmation is refused (409 WRONG_STATE) instead of moving it.
 */
export function confirmCheckIn(
  crewId: string,
  id: string,
  input: { confirmedAt: string | Date; summaryJson: string | null },
): CheckInRecord {
  const existing = getCheckIn(crewId, id);
  if (existing.confirmedAt !== null) {
    throw new HttpError(409, "WRONG_STATE", "Check-in is already confirmed");
  }
  const res = getDb()
    .prepare(
      "UPDATE check_in SET confirmed_at = ?, summary_json = ? WHERE id = ? AND crew_id = ? AND confirmed_at IS NULL",
    )
    .run(toIso(input.confirmedAt, "confirmedAt"), input.summaryJson, id, crewId);
  if (res.changes === 0) throw new HttpError(409, "WRONG_STATE", "Check-in is already confirmed");
  return getCheckIn(crewId, id);
}

/** Most recently confirmed check-in, or null when the crew member has none. */
export function latestConfirmedCheckIn(crewId: string): CheckInRecord | null {
  const row = getDb()
    .prepare(
      `SELECT ${CHECK_IN_COLUMNS} FROM check_in
        WHERE crew_id = ? AND confirmed_at IS NOT NULL
        ORDER BY confirmed_at DESC, rowid DESC LIMIT 1`,
    )
    .get(crewId) as CheckInDbRow | undefined;
  return row ? mapCheckIn(row) : null;
}

/**
 * History for baselines and sparklines: the latest `days` server-local calendar dates strictly
 * before `before` that have a confirmed check-in (one entry per date, the latest check-in of that
 * date), ordered oldest first. This counts confirmed days rather than calendar days, so a gap in
 * the history (for example a database seeded a few weeks ago) does not shrink the baseline window.
 * `before` is exclusive, so passing today's date excludes today.
 */
export function listHistoryDays(
  crewId: string,
  opts: { before: string; days: number },
): HistoryDayRecord[] {
  return queryHistoryDays(getDb(), crewId, { before: opts.before, days: opts.days });
}
