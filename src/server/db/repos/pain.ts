import "server-only";
import {
  isPainLocation,
  parseOnset,
  parsePainItems,
  parseRedFlags,
  parseSeverity,
  type PainItem,
  type PainLocation,
  type PainOnset,
  type PainRedFlag,
  type PainReport,
  type PainSeverity,
} from "@/lib/pain";
import { now } from "@/server/clock";
import { NotFoundError } from "@/server/http";
import { getDb } from "../client";
import { newId, toIso } from "../shared";

/**
 * Pain reports of ONE crew member (every function takes crewId first and never touches another member's row). The
 * ground console's cross-crew read lives in ground.ts (groundListPainReports). Only structured fields are stored.
 */

export interface PainDbRow {
  id: string;
  crew_id: string;
  check_in_id: string;
  created_at: string;
  updated_at: string;
  location: string | null;
  severity: number | null;
  severity_word: string | null;
  onset_kind: string | null;
  onset_amount: number | null;
  items_json: string;
  red_flags_json: string;
  urgent: number;
  guide_id: string | null;
  sos_alert_id: string | null;
  sent_at: string | null;
  awaiting: string | null;
  asked_turn_id: string | null;
}

export const PAIN_COLUMNS =
  "id, crew_id, check_in_id, created_at, updated_at, location, severity, severity_word, onset_kind, onset_amount, items_json, red_flags_json, urgent, guide_id, sos_alert_id, sent_at, awaiting, asked_turn_id";

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function mapPain(r: PainDbRow): PainReport {
  return {
    id: r.id,
    crewId: r.crew_id,
    checkInId: r.check_in_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    location: isPainLocation(r.location) ? r.location : null,
    severity: parseSeverity({ value: r.severity === null ? null : Number(r.severity), word: r.severity_word }),
    onset: parseOnset({ kind: r.onset_kind, amount: r.onset_amount === null ? null : Number(r.onset_amount) }),
    items: parsePainItems(json(r.items_json)),
    redFlags: parseRedFlags(json(r.red_flags_json)),
    urgent: Number(r.urgent) === 1,
    guideId: r.guide_id,
    sosAlertId: r.sos_alert_id,
    sentAt: r.sent_at,
    awaiting: r.awaiting === "location" || r.awaiting === "details" ? r.awaiting : null,
    askedTurnId: r.asked_turn_id,
  };
}

export interface PainReportInput {
  location: PainLocation | null;
  severity: PainSeverity | null;
  onset: PainOnset | null;
  items: readonly PainItem[];
  redFlags: readonly PainRedFlag[];
  urgent: boolean;
  guideId: string | null;
  sosAlertId: string | null;
  /** put it on the Earth console now (sent_at = now) */
  send: boolean;
  awaiting: "location" | "details" | null;
}

function columns(input: PainReportInput) {
  return [
    input.location,
    input.severity?.value ?? null,
    input.severity?.word ?? null,
    input.onset?.kind ?? null,
    input.onset?.amount ?? null,
    JSON.stringify(input.items),
    JSON.stringify(input.redFlags),
    input.urgent ? 1 : 0,
    input.guideId,
    input.sosAlertId,
  ] as const;
}

async function readOwn(crewId: string, id: string): Promise<PainReport> {
  const db = await getDb();
  const row = await db.get<PainDbRow>(`SELECT ${PAIN_COLUMNS} FROM pain_report WHERE id = ? AND crew_id = ?`, id, crewId);
  if (!row) throw new NotFoundError("Pain report not found");
  return mapPain(row);
}

/** a new report in the crew member's own check-in (404 for another member's check-in) */
export async function createPainReport(crewId: string, checkInId: string, input: PainReportInput, at?: Date): Promise<PainReport> {
  const db = await getDb();
  const atIso = toIso(at ?? now(), "at");
  const id = newId();
  await db.transaction(async (tx) => {
    const own = await tx.get<{ id: string }>("SELECT id FROM check_in WHERE id = ? AND crew_id = ?", checkInId, crewId);
    if (!own) throw new NotFoundError("Check-in not found");
    await tx.run(
      `INSERT INTO pain_report (id, crew_id, check_in_id, created_at, updated_at, location, severity, severity_word, onset_kind,
         onset_amount, items_json, red_flags_json, urgent, guide_id, sos_alert_id, sent_at, awaiting)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      crewId,
      checkInId,
      atIso,
      atIso,
      ...columns(input),
      input.send ? atIso : null,
      input.awaiting,
    );
  });
  return readOwn(crewId, id);
}

/** replaces the report's fields; sent_at is kept once set (and set now when `send` and not yet sent) */
export async function updatePainReport(crewId: string, id: string, input: PainReportInput, at?: Date): Promise<PainReport> {
  const db = await getDb();
  const atIso = toIso(at ?? now(), "at");
  const res = await db.run(
    `UPDATE pain_report SET updated_at = ?, location = ?, severity = ?, severity_word = ?, onset_kind = ?, onset_amount = ?,
       items_json = ?, red_flags_json = ?, urgent = ?, guide_id = ?, sos_alert_id = ?,
       sent_at = COALESCE(sent_at, ?), awaiting = ?, asked_turn_id = NULL
     WHERE id = ? AND crew_id = ?`,
    atIso,
    ...columns(input),
    input.send ? atIso : null,
    input.awaiting,
    id,
    crewId,
  );
  if (res.changes === 0) throw new NotFoundError("Pain report not found");
  return readOwn(crewId, id);
}

/** the turn in which Cosmo asked (only the very next answer is read as the reply) */
export async function setPainAskedTurn(crewId: string, id: string, turnId: string | null): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE pain_report SET asked_turn_id = ? WHERE id = ? AND crew_id = ?", turnId, id, crewId);
}

/** the report of this check-in that waits for an answer to the question asked in `turnId`, or null */
export async function pendingPainReport(crewId: string, checkInId: string, turnId: string): Promise<PainReport | null> {
  const db = await getDb();
  const row = await db.get<PainDbRow>(
    `SELECT ${PAIN_COLUMNS} FROM pain_report
      WHERE crew_id = ? AND check_in_id = ? AND awaiting IS NOT NULL AND asked_turn_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    crewId,
    checkInId,
    turnId,
  );
  return row ? mapPain(row) : null;
}

/** Cosmo's question went unanswered (the person said something else): nothing is awaited any more */
export async function clearPainAwaiting(crewId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE pain_report SET awaiting = NULL, asked_turn_id = NULL WHERE id = ? AND crew_id = ?", id, crewId);
}

export async function getPainReport(crewId: string, id: string): Promise<PainReport> {
  return readOwn(crewId, id);
}

/** Newest first. */
export async function listPainReports(crewId: string): Promise<PainReport[]> {
  const db = await getDb();
  const rows = await db.all<PainDbRow>(
    `SELECT ${PAIN_COLUMNS} FROM pain_report WHERE crew_id = ? ORDER BY created_at DESC, rowid DESC`,
    crewId,
  );
  return rows.map(mapPain);
}
