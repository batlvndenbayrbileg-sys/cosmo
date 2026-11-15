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

export async function createCheckIn(
  crewId: string,
  input: { language: Lang; startedAt?: string | Date; id?: string },
): Promise<CheckInRecord> {
  if (!isLang(input.language)) throw new HttpError(400, "BAD_INPUT", "Invalid language");
  const db = await getDb();
  await assertCrewExists(db, crewId);
  const startedAt = toIso(input.startedAt ?? new Date(), "startedAt");
  const id = input.id ?? newId();
  await db.run(
    `INSERT INTO check_in (id, crew_id, started_at, local_date, language, state, state_json)
     VALUES (?, ?, ?, ?, ?, 'GREETING', '{}')`,
    id,
    crewId,
    startedAt,
    localDateISO(new Date(startedAt)),
    input.language,
  );
  return getCheckIn(crewId, id);
}

/** Throws NotFoundError when the id does not exist OR belongs to another crew member. */
export async function getCheckIn(crewId: string, id: string): Promise<CheckInRecord> {
  const db = await getDb();
  const row = await db.get<CheckInDbRow>(
    `SELECT ${CHECK_IN_COLUMNS} FROM check_in WHERE id = ? AND crew_id = ?`,
    id,
    crewId,
  );
  if (!row) throw new NotFoundError("Check-in not found");
  return mapCheckIn(row);
}

/**
 * The newest unconfirmed check-in that started on the given server-local date (YYYY-MM-DD), or
 * null. Used to resume an interrupted check-in.
 */
export async function getOpenCheckInForDate(crewId: string, dateISO: string): Promise<CheckInRecord | null> {
  assertDateISO(dateISO);
  const db = await getDb();
  const row = await db.get<CheckInDbRow>(
    `SELECT ${CHECK_IN_COLUMNS} FROM check_in
      WHERE crew_id = ? AND local_date = ? AND confirmed_at IS NULL
      ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    crewId,
    dateISO,
  );
  return row ? mapCheckIn(row) : null;
}

/**
 * The newest check-in of the given server-local date, confirmed or not, or null. The assistant screen continues on it,
 * so a check-up done this morning is "done" for the rest of the day instead of starting a second one.
 */
export async function getLatestCheckInForDate(crewId: string, dateISO: string): Promise<CheckInRecord | null> {
  assertDateISO(dateISO);
  const db = await getDb();
  const row = await db.get<CheckInDbRow>(
    `SELECT ${CHECK_IN_COLUMNS} FROM check_in
      WHERE crew_id = ? AND local_date = ?
      ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    crewId,
    dateISO,
  );
  return row ? mapCheckIn(row) : null;
}

/** Persists the state machine position. `stateJson` is left untouched when omitted. */
export async function setCheckInState(
  crewId: string,
  id: string,
  state: ConversationState,
  stateJson?: string,
): Promise<CheckInRecord> {
  if (!STATES.includes(state)) throw new HttpError(400, "BAD_INPUT", "Invalid state");
  const db = await getDb();
  const res =
    stateJson === undefined
      ? await db.run("UPDATE check_in SET state = ? WHERE id = ? AND crew_id = ?", state, id, crewId)
      : await db.run(
          "UPDATE check_in SET state = ?, state_json = ? WHERE id = ? AND crew_id = ?",
          state,
          stateJson,
          id,
          crewId,
        );
  if (res.changes === 0) throw new NotFoundError("Check-in not found");
  return getCheckIn(crewId, id);
}

/**
 * The conversation language of an open check-in (the crew member switched EN/MN on the check-in screen). From the next
 * turn on Cosmo replies, and speech recognition listens, in this language.
 */
export async function setCheckInLanguage(crewId: string, id: string, language: Lang): Promise<CheckInRecord> {
  if (!isLang(language)) throw new HttpError(400, "BAD_INPUT", "Invalid language");
  const db = await getDb();
  const res = await db.run("UPDATE check_in SET language = ? WHERE id = ? AND crew_id = ?", language, id, crewId);
  if (res.changes === 0) throw new NotFoundError("Check-in not found");
  return getCheckIn(crewId, id);
}

/**
 * Marks the check-in confirmed (once). `confirmed_at` is the clock the Earth link delay is measured
 * against, so a second confirmation is refused (409 WRONG_STATE) instead of moving it.
 */
export async function confirmCheckIn(
  crewId: string,
  id: string,
  input: { confirmedAt: string | Date; summaryJson: string | null },
): Promise<CheckInRecord> {
  const existing = await getCheckIn(crewId, id);
  if (existing.confirmedAt !== null) {
    throw new HttpError(409, "WRONG_STATE", "Check-in is already confirmed");
  }
  const db = await getDb();
  const res = await db.run(
    "UPDATE check_in SET confirmed_at = ?, summary_json = ? WHERE id = ? AND crew_id = ? AND confirmed_at IS NULL",
    toIso(input.confirmedAt, "confirmedAt"),
    input.summaryJson,
    id,
    crewId,
  );
  if (res.changes === 0) throw new HttpError(409, "WRONG_STATE", "Check-in is already confirmed");
  return getCheckIn(crewId, id);
}

/** Most recently confirmed check-in, or null when the crew member has none. */
export async function latestConfirmedCheckIn(crewId: string): Promise<CheckInRecord | null> {
  const db = await getDb();
  const row = await db.get<CheckInDbRow>(
    `SELECT ${CHECK_IN_COLUMNS} FROM check_in
      WHERE crew_id = ? AND confirmed_at IS NOT NULL
      ORDER BY confirmed_at DESC, rowid DESC LIMIT 1`,
    crewId,
  );
  return row ? mapCheckIn(row) : null;
}

/**
 * History for baselines and sparklines: the latest `days` server-local calendar dates strictly
 * before `before` that have a confirmed check-in (one entry per date, the latest check-in of that
 * date), ordered oldest first. This counts confirmed days rather than calendar days, so a gap in
 * the history (for example a database seeded a few weeks ago) does not shrink the baseline window.
 * `before` is exclusive, so passing today's date excludes today.
 */
export async function listHistoryDays(
  crewId: string,
  opts: { before: string; days: number },
): Promise<HistoryDayRecord[]> {
  return queryHistoryDays(await getDb(), crewId, { before: opts.before, days: opts.days });
}
