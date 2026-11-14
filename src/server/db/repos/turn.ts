import "server-only";
import type { Lang, TurnRow } from "@/lib/types";
import { HttpError } from "@/server/http";
import { getDb } from "../client";
import { assertCheckInOwned, isLang, newId, toIso } from "../shared";

interface TurnDbRow {
  id: string;
  speaker: string;
  text: string;
  language: string;
  created_at: string;
}

const SPEAKERS = ["crew", "cosmo", "system"] as const;

function mapTurn(r: TurnDbRow): TurnRow {
  return {
    id: r.id,
    speaker: r.speaker as TurnRow["speaker"],
    text: r.text,
    language: r.language as Lang,
    createdAt: r.created_at,
  };
}

/** Turns may be appended after confirmation (Cosmo speaks the summary after the check-in is confirmed). */
export function appendTurn(
  crewId: string,
  checkInId: string,
  input: {
    speaker: TurnRow["speaker"];
    text: string;
    language: Lang;
    createdAt?: string | Date;
    id?: string;
  },
): TurnRow {
  if (!SPEAKERS.includes(input.speaker)) throw new HttpError(400, "BAD_INPUT", "Invalid speaker");
  if (!isLang(input.language)) throw new HttpError(400, "BAD_INPUT", "Invalid language");
  const db = getDb();
  assertCheckInOwned(db, crewId, checkInId);
  const id = input.id ?? newId();
  const createdAt = toIso(input.createdAt ?? new Date(), "createdAt");
  db.prepare(
    `INSERT INTO turn (id, check_in_id, crew_id, speaker, text, language, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, checkInId, crewId, input.speaker, input.text, input.language, createdAt);
  return { id, speaker: input.speaker, text: input.text, language: input.language, createdAt };
}

/**
 * Chronological order. With `limit`, returns the MOST RECENT `limit` turns (still oldest first),
 * which is what the model context needs. Throws NotFoundError for another crew member's check-in.
 */
export function listTurns(crewId: string, checkInId: string, opts?: { limit?: number }): TurnRow[] {
  const db = getDb();
  assertCheckInOwned(db, crewId, checkInId);
  const limit = opts?.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new HttpError(400, "BAD_INPUT", "limit must be a positive integer");
  }
  const rows =
    limit === undefined
      ? (db
          .prepare(
            `SELECT id, speaker, text, language, created_at FROM turn
              WHERE crew_id = ? AND check_in_id = ? ORDER BY created_at ASC, rowid ASC`,
          )
          .all(crewId, checkInId) as TurnDbRow[])
      : (
          db
            .prepare(
              `SELECT id, speaker, text, language, created_at FROM turn
                WHERE crew_id = ? AND check_in_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
            )
            .all(crewId, checkInId, limit) as TurnDbRow[]
        ).reverse();
  return rows.map(mapTurn);
}
