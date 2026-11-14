import "server-only";
import type { AlertRow, Bilingual } from "@/lib/types";
import { HttpError, NotFoundError } from "@/server/http";
import { getDb } from "../client";
import { ALERT_COLUMNS, mapAlert, type AlertDbRow } from "../rows";
import { assertCheckInOwned, newId, toIso } from "../shared";

export interface InsertAlertInput {
  checkInId: string;
  level: AlertRow["level"];
  rule: AlertRow["rule"];
  /** wording is "alert", never "diagnosis" */
  text: Bilingual;
  createdAt?: string | Date;
  id?: string;
  /**
   * With a deterministic `id`: when an alert with that id already exists it is returned unchanged instead of a
   * duplicate-key error. The insert itself is conditional (INSERT OR IGNORE), so concurrent callers get one row.
   */
  ifAbsent?: boolean;
}

export async function insertAlert(crewId: string, input: InsertAlertInput): Promise<AlertRow> {
  if (input.level !== "yellow" && input.level !== "red") {
    throw new HttpError(400, "BAD_INPUT", "Invalid alert level");
  }
  if (input.ifAbsent && input.id === undefined) {
    throw new HttpError(400, "BAD_INPUT", "ifAbsent needs an alert id");
  }
  const db = await getDb();
  await assertCheckInOwned(db, crewId, input.checkInId);
  const id = input.id ?? newId();
  await db.run(
    `INSERT${input.ifAbsent ? " OR IGNORE" : ""} INTO alert (id, crew_id, check_in_id, created_at, level, rule, text_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    crewId,
    input.checkInId,
    toIso(input.createdAt ?? new Date(), "createdAt"),
    input.level,
    input.rule,
    JSON.stringify(input.text),
  );
  return readAlert(crewId, id);
}

async function readAlert(crewId: string, alertId: string): Promise<AlertRow> {
  const db = await getDb();
  const row = await db.get<AlertDbRow>(
    `SELECT ${ALERT_COLUMNS} FROM alert WHERE id = ? AND crew_id = ?`,
    alertId,
    crewId,
  );
  if (!row) throw new NotFoundError("Alert not found");
  return mapAlert(row);
}

/** Newest first. */
export async function listAlerts(crewId: string): Promise<AlertRow[]> {
  const db = await getDb();
  const rows = await db.all<AlertDbRow>(
    `SELECT ${ALERT_COLUMNS} FROM alert WHERE crew_id = ? ORDER BY created_at DESC, rowid DESC`,
    crewId,
  );
  return rows.map(mapAlert);
}

/** Acknowledges the crew member's own alert. Idempotent: the first acknowledgement time is kept. */
export async function ackAlert(crewId: string, alertId: string, ackedAt?: string | Date): Promise<AlertRow> {
  const db = await getDb();
  const res = await db.run(
    "UPDATE alert SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ? AND crew_id = ?",
    toIso(ackedAt ?? new Date(), "ackedAt"),
    alertId,
    crewId,
  );
  if (res.changes === 0) throw new NotFoundError("Alert not found");
  return readAlert(crewId, alertId);
}
