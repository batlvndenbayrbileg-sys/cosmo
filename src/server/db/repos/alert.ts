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
}

export function insertAlert(crewId: string, input: InsertAlertInput): AlertRow {
  if (input.level !== "yellow" && input.level !== "red") {
    throw new HttpError(400, "BAD_INPUT", "Invalid alert level");
  }
  const db = getDb();
  assertCheckInOwned(db, crewId, input.checkInId);
  const id = input.id ?? newId();
  db.prepare(
    `INSERT INTO alert (id, crew_id, check_in_id, created_at, level, rule, text_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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

function readAlert(crewId: string, alertId: string): AlertRow {
  const row = getDb()
    .prepare(`SELECT ${ALERT_COLUMNS} FROM alert WHERE id = ? AND crew_id = ?`)
    .get(alertId, crewId) as AlertDbRow | undefined;
  if (!row) throw new NotFoundError("Alert not found");
  return mapAlert(row);
}

/** Newest first. */
export function listAlerts(crewId: string): AlertRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ${ALERT_COLUMNS} FROM alert WHERE crew_id = ? ORDER BY created_at DESC, rowid DESC`,
    )
    .all(crewId) as AlertDbRow[];
  return rows.map(mapAlert);
}

/** Acknowledges the crew member's own alert. Idempotent: the first acknowledgement time is kept. */
export function ackAlert(crewId: string, alertId: string, ackedAt?: string | Date): AlertRow {
  const db = getDb();
  const res = db
    .prepare(
      "UPDATE alert SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ? AND crew_id = ?",
    )
    .run(toIso(ackedAt ?? new Date(), "ackedAt"), alertId, crewId);
  if (res.changes === 0) throw new NotFoundError("Alert not found");
  return readAlert(crewId, alertId);
}
