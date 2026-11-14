import "server-only";
import type { KpiKey, MeasurementRow, MeasurementSource, MeasurementValue } from "@/lib/types";
import { HttpError } from "@/server/http";
import { getDb } from "../client";
import {
  MEASUREMENT_COLUMNS,
  mapMeasurement,
  type MeasurementDbRow,
} from "../rows";
import { assertCheckInOwned, isKpiKey, isTextKey, toIso } from "../shared";

const SOURCES: readonly MeasurementSource[] = ["typed", "voice", "simulated"];

export interface UpsertMeasurementInput {
  key: KpiKey;
  /** numbers (booleans as 0/1) for numeric keys, a string for symptom_note / day_note */
  value: MeasurementValue;
  unit: string | null;
  sourceText: string | null;
  confidence: number | null;
  source: MeasurementSource;
  /** defaults to now; the seed passes a fixed instant */
  createdAt?: string | Date;
}

/**
 * Inserts or corrects a measurement (UNIQUE(check_in_id, key): a correction updates the row).
 * Refuses other crew members' check-ins (NotFoundError) and confirmed check-ins (409 WRONG_STATE:
 * confirmed values are what ground sees, they do not change afterwards).
 */
export function upsertMeasurement(
  crewId: string,
  checkInId: string,
  input: UpsertMeasurementInput,
): MeasurementRow {
  const db = getDb();
  const { confirmedAt } = assertCheckInOwned(db, crewId, checkInId);
  if (confirmedAt !== null) {
    throw new HttpError(409, "WRONG_STATE", "Check-in is already confirmed");
  }
  if (!isKpiKey(input.key)) throw new HttpError(400, "BAD_INPUT", `Unknown key: ${String(input.key)}`);
  if (!SOURCES.includes(input.source)) throw new HttpError(400, "BAD_INPUT", "Invalid source");
  if (input.confidence !== null && !Number.isFinite(input.confidence)) {
    throw new HttpError(400, "BAD_INPUT", "Invalid confidence");
  }

  let value: number | null = null;
  let valueText: string | null = null;
  if (isTextKey(input.key)) {
    if (typeof input.value !== "string") {
      throw new HttpError(400, "BAD_INPUT", `${input.key} expects text`);
    }
    valueText = input.value;
  } else {
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
      throw new HttpError(400, "BAD_INPUT", `${input.key} expects a finite number`);
    }
    value = input.value;
  }

  const createdAt = toIso(input.createdAt ?? new Date(), "createdAt");
  db.prepare(
    `INSERT INTO measurement
       (id, check_in_id, crew_id, key, value, value_text, unit, source_text, confidence, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (check_in_id, key) DO UPDATE SET
       value = excluded.value, value_text = excluded.value_text, unit = excluded.unit,
       source_text = excluded.source_text, confidence = excluded.confidence,
       source = excluded.source, created_at = excluded.created_at`,
  ).run(
    `${checkInId}:${input.key}`,
    checkInId,
    crewId,
    input.key,
    value,
    valueText,
    input.unit,
    input.sourceText,
    input.confidence,
    input.source,
    createdAt,
  );

  const row = db
    .prepare(
      `SELECT ${MEASUREMENT_COLUMNS} FROM measurement WHERE crew_id = ? AND check_in_id = ? AND key = ?`,
    )
    .get(crewId, checkInId, input.key) as MeasurementDbRow;
  return mapMeasurement(row);
}

/** Oldest first. Throws NotFoundError when the check-in is not this crew member's. */
export function listMeasurements(crewId: string, checkInId: string): MeasurementRow[] {
  const db = getDb();
  assertCheckInOwned(db, crewId, checkInId);
  const rows = db
    .prepare(
      `SELECT ${MEASUREMENT_COLUMNS} FROM measurement
        WHERE crew_id = ? AND check_in_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(crewId, checkInId) as MeasurementDbRow[];
  return rows.map((r) => mapMeasurement(r));
}
