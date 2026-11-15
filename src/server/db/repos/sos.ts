import "server-only";
import {
  SOS_DEDUP_WINDOW_MS,
  SOS_PHOTO_MAX_BYTES,
  looksLikeJpeg,
  type SosAlert,
  type SosPhotoStatus,
  type SosReason,
} from "@/lib/sos";
import { now } from "@/server/clock";
import { HttpError, NotFoundError } from "@/server/http";
import { getDb } from "../client";
import { newId, toIso } from "../shared";

/**
 * SOS alerts of ONE crew member (every function takes crewId and never touches another member's row), plus the one
 * write the ground console makes: marking an alert seen. The cross-crew reads for the console live in ground.ts.
 */

export interface SosDbRow {
  id: string;
  crew_id: string;
  created_at: string;
  reason: string;
  phrase: string | null;
  photo_status: string;
  photo_bytes: number | null;
  photo_at: string | null;
  seen_at: string | null;
}

/** never photo_jpeg: the bytes are read only by the ground photo route (groundGetSosPhoto) */
export const SOS_COLUMNS = "id, crew_id, created_at, reason, phrase, photo_status, photo_bytes, photo_at, seen_at";

export function mapSos(r: SosDbRow): SosAlert {
  return {
    id: r.id,
    crewId: r.crew_id,
    createdAt: r.created_at,
    reason: r.reason as SosReason,
    phrase: r.phrase,
    photoStatus: r.photo_status as SosPhotoStatus,
    photoBytes: r.photo_bytes === null ? null : Number(r.photo_bytes),
    photoAt: r.photo_at,
    seenAt: r.seen_at,
  };
}

/** a stable 31-bit key per crew member for pg_advisory_xact_lock */
function lockKey(crewId: string): number {
  let h = 0x5051;
  for (let i = 0; i < crewId.length; i++) h = (Math.imul(h, 31) + crewId.charCodeAt(i)) | 0;
  return 727_000_000 + (Math.abs(h) % 1_000_000);
}

export interface RaiseSosInput {
  reason: SosReason;
  /** the trigger words heard ("tell earth"); null for the button */
  phrase?: string | null;
  /** the check-in it happened in, when there is one; a check-in of another crew member is ignored, not an error */
  checkInId?: string | null;
  at?: Date;
}

/**
 * Stores an urgent alert for the ground console. Idempotent per incident: when this crew member raised one less than
 * SOS_DEDUP_WINDOW_MS ago, that one is returned (`duplicate: true`) and nothing is inserted. The check and the insert
 * run in one transaction; on Postgres an advisory lock per crew member serialises concurrent presses.
 */
export async function raiseSosAlert(crewId: string, input: RaiseSosInput): Promise<{ alert: SosAlert; duplicate: boolean }> {
  if (input.reason !== "button" && input.reason !== "voice") throw new HttpError(400, "BAD_INPUT", "Invalid SOS reason");
  const db = await getDb();
  const at = input.at ?? now();
  const atIso = toIso(at, "at");
  const since = new Date(at.getTime() - SOS_DEDUP_WINDOW_MS).toISOString();
  const phrase = input.phrase?.trim().slice(0, 80) || null;

  return db.transaction(async (tx) => {
    if (db.dialect === "postgres") await tx.get("SELECT pg_advisory_xact_lock(?)", lockKey(crewId));
    const crew = await tx.get<{ id: string }>("SELECT id FROM crew_member WHERE id = ?", crewId);
    if (!crew) throw new NotFoundError("Crew member not found");

    const recent = await tx.get<SosDbRow>(
      `SELECT ${SOS_COLUMNS} FROM sos_alert WHERE crew_id = ? AND created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      crewId,
      since,
      atIso,
    );
    if (recent) return { alert: mapSos(recent), duplicate: true };

    let checkInId: string | null = null;
    if (input.checkInId) {
      const own = await tx.get<{ id: string }>(
        "SELECT id FROM check_in WHERE id = ? AND crew_id = ?",
        input.checkInId,
        crewId,
      );
      checkInId = own ? own.id : null;
    }
    const id = newId();
    await tx.run(
      `INSERT INTO sos_alert (id, crew_id, check_in_id, created_at, reason, phrase, photo_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      id,
      crewId,
      checkInId,
      atIso,
      input.reason,
      phrase,
    );
    const row = await tx.get<SosDbRow>(`SELECT ${SOS_COLUMNS} FROM sos_alert WHERE id = ?`, id);
    if (!row) throw new Error("SOS alert vanished after insert");
    return { alert: mapSos(row), duplicate: false };
  });
}

export async function getSosAlert(crewId: string, id: string): Promise<SosAlert> {
  const db = await getDb();
  const row = await db.get<SosDbRow>(`SELECT ${SOS_COLUMNS} FROM sos_alert WHERE id = ? AND crew_id = ?`, id, crewId);
  if (!row) throw new NotFoundError("SOS alert not found");
  return mapSos(row);
}

/** Newest first. */
export async function listSosAlerts(crewId: string): Promise<SosAlert[]> {
  const db = await getDb();
  const rows = await db.all<SosDbRow>(
    `SELECT ${SOS_COLUMNS} FROM sos_alert WHERE crew_id = ? ORDER BY created_at DESC, rowid DESC`,
    crewId,
  );
  return rows.map(mapSos);
}

/**
 * Attaches the face still to the crew member's own alert. JPEG only, 1 byte .. SOS_PHOTO_MAX_BYTES. Only while the
 * photo is still awaited: the first photo is kept (attaching again returns the alert unchanged), and a photo the crew
 * member deleted (deleteSosPhoto) or a camera they refused stays that way. Another member's alert is a 404.
 */
export async function attachSosPhoto(crewId: string, id: string, jpeg: Uint8Array, at?: Date): Promise<SosAlert> {
  if (jpeg.byteLength === 0) throw new HttpError(400, "BAD_INPUT", "Empty photo");
  if (jpeg.byteLength > SOS_PHOTO_MAX_BYTES) throw new HttpError(413, "BAD_INPUT", "Photo is too large");
  if (!looksLikeJpeg(jpeg)) throw new HttpError(400, "BAD_INPUT", "Photo must be a JPEG");
  const db = await getDb();
  await db.run(
    `UPDATE sos_alert SET photo_status = 'attached', photo_jpeg = ?, photo_bytes = ?, photo_at = ?
      WHERE id = ? AND crew_id = ? AND photo_status = 'pending'`,
    Buffer.from(jpeg).toString("base64"),
    jpeg.byteLength,
    toIso(at ?? now(), "at"),
    id,
    crewId,
  );
  return getSosAlert(crewId, id);
}

/** the camera was refused or is missing: the alert stays, and says why it has no photo (only while still pending) */
export async function markSosPhotoMissing(
  crewId: string,
  id: string,
  status: Extract<SosPhotoStatus, "denied" | "unavailable">,
): Promise<SosAlert> {
  if (status !== "denied" && status !== "unavailable") throw new HttpError(400, "BAD_INPUT", "Invalid photo status");
  const db = await getDb();
  await db.run(
    "UPDATE sos_alert SET photo_status = ? WHERE id = ? AND crew_id = ? AND photo_status = 'pending'",
    status,
    id,
    crewId,
  );
  return getSosAlert(crewId, id);
}

/**
 * The crew member deletes the face still of their own alert: the bytes, the size and the time are erased and the alert
 * says "no photo" ('denied': the schema's statuses are fixed, and the Earth console words it as "declined or removed by
 * the crew member"). The alert itself stays. A photo still awaited is refused for good the same way. Idempotent;
 * another member's alert (or an unknown id) is a 404.
 */
export async function deleteSosPhoto(crewId: string, id: string): Promise<SosAlert> {
  const db = await getDb();
  await db.run(
    `UPDATE sos_alert SET photo_status = 'denied', photo_jpeg = NULL, photo_bytes = NULL, photo_at = NULL
      WHERE id = ? AND crew_id = ? AND (photo_status IN ('attached', 'pending') OR photo_jpeg IS NOT NULL)`,
    id,
    crewId,
  );
  return getSosAlert(crewId, id);
}

/** Ground console: "seen". Idempotent, the first time is kept. Unknown id: 404. */
export async function groundMarkSosSeen(id: string, at?: Date): Promise<SosAlert> {
  const db = await getDb();
  const res = await db.run(
    "UPDATE sos_alert SET seen_at = COALESCE(seen_at, ?) WHERE id = ?",
    toIso(at ?? now(), "at"),
    id,
  );
  if (res.changes === 0) throw new NotFoundError("SOS alert not found");
  const row = await db.get<SosDbRow>(`SELECT ${SOS_COLUMNS} FROM sos_alert WHERE id = ?`, id);
  if (!row) throw new NotFoundError("SOS alert not found");
  return mapSos(row);
}
