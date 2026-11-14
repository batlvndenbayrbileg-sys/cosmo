import "server-only";
import { randomUUID } from "node:crypto";
import { KPI_KEYS, type KpiKey, type Lang } from "@/lib/types";
import { HttpError, NotFoundError } from "@/server/http";
import type { Db } from "./client";

/**
 * Helpers shared by the repos and the seed. Deliberately NOT under repos/: the isolation sweep test
 * asserts that every function exported from repos/*.ts takes `crewId` first, and these do not.
 */

/** Keys whose value is free text (stored in value_text). Ground never sees them. */
export const TEXT_KEYS: ReadonlySet<KpiKey> = new Set<KpiKey>(["symptom_note", "day_note"]);

export function isTextKey(key: string): boolean {
  return TEXT_KEYS.has(key as KpiKey);
}

export function isKpiKey(key: string): key is KpiKey {
  return (KPI_KEYS as readonly string[]).includes(key);
}

export function isLang(v: unknown): v is Lang {
  return v === "mn" || v === "en";
}

export function newId(): string {
  return randomUUID();
}

/** Normalises any ISO-8601 instant to `toISOString()` form so string comparison is time comparison. */
export function toIso(input: string | Date, what = "timestamp"): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "BAD_INPUT", `Invalid ${what}`);
  return d.toISOString();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDateISO(value: string, what = "date"): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, "BAD_INPUT", `Invalid ${what} (expected YYYY-MM-DD)`);
  }
  return value;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Server-local calendar date, YYYY-MM-DD. */
export function localDateISO(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar arithmetic on YYYY-MM-DD strings (timezone independent). */
export function shiftDate(dateISO: string, deltaDays: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Throws NotFoundError unless `checkInId` exists AND belongs to `crewId`. Returns its confirmed_at. */
export function assertCheckInOwned(
  db: Db,
  crewId: string,
  checkInId: string,
): { confirmedAt: string | null } {
  const row = db
    .prepare("SELECT confirmed_at FROM check_in WHERE id = ? AND crew_id = ?")
    .get(checkInId, crewId) as { confirmed_at: string | null } | undefined;
  if (!row) throw new NotFoundError("Check-in not found");
  return { confirmedAt: row.confirmed_at };
}

export function assertCrewExists(db: Db, crewId: string): void {
  const row = db.prepare("SELECT 1 AS x FROM crew_member WHERE id = ?").get(crewId);
  if (!row) throw new NotFoundError("Crew member not found");
}

/** One calendar day of a crew member's history (latest confirmed check-in of that day). */
export interface HistoryDayRow {
  date: string;
  values: Partial<Record<KpiKey, number | string>>;
}

interface HistoryOptions {
  /** exclusive upper bound, YYYY-MM-DD (usually today) */
  before: string;
  /** how many distinct confirmed calendar days to return: the latest `days` dates before `before` */
  days: number;
  /** when set, only check-ins with confirmed_at <= asOf are visible */
  asOf?: string;
  /** drop free-text keys entirely (ground reads) */
  omitText?: boolean;
}

/**
 * Shared history query. ALWAYS filtered by crew_id. Returns the latest `days` distinct confirmed
 * dates strictly before `before` (a count of confirmed days, not a calendar window, so gaps in the
 * history never shrink it), oldest first; a date with several confirmed check-ins contributes the
 * latest one (by confirmed_at).
 */
export function queryHistoryDays(db: Db, crewId: string, opts: HistoryOptions): HistoryDayRow[] {
  const before = assertDateISO(opts.before, "before");
  if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 366) {
    throw new HttpError(400, "BAD_INPUT", "days must be an integer between 1 and 366");
  }

  let visibility = "";
  const visibilityParams: string[] = [];
  if (opts.asOf !== undefined) {
    visibility = "AND confirmed_at <= ?";
    visibilityParams.push(toIso(opts.asOf, "asOf"));
  }
  const dates = db
    .prepare(
      `SELECT local_date FROM check_in
        WHERE crew_id = ? AND confirmed_at IS NOT NULL AND local_date < ? ${visibility}
        GROUP BY local_date ORDER BY local_date DESC LIMIT ?`,
    )
    .all(crewId, before, ...visibilityParams, opts.days) as Array<{ local_date: string }>;
  if (dates.length === 0) return [];
  // every date between the oldest selected one and `before` that has a visible check-in is selected
  const start = dates[dates.length - 1].local_date;

  const checkIns = db
    .prepare(
      `SELECT id, local_date FROM check_in
        WHERE crew_id = ? AND confirmed_at IS NOT NULL
          AND local_date >= ? AND local_date < ? ${visibility}
        ORDER BY local_date ASC, confirmed_at ASC, rowid ASC`,
    )
    .all(crewId, start, before, ...visibilityParams) as Array<{ id: string; local_date: string }>;

  // last row per date wins (rows are ordered by confirmed_at ascending within a date)
  const latestPerDate = new Map<string, string>();
  for (const c of checkIns) latestPerDate.set(c.local_date, c.id);

  const stmt = db.prepare(
    "SELECT key, value, value_text FROM measurement WHERE crew_id = ? AND check_in_id = ? ORDER BY created_at ASC, rowid ASC",
  );
  const out: HistoryDayRow[] = [];
  for (const [date, checkInId] of latestPerDate) {
    const values: HistoryDayRow["values"] = {};
    const rows = stmt.all(crewId, checkInId) as Array<{
      key: string;
      value: number | null;
      value_text: string | null;
    }>;
    for (const r of rows) {
      if (!isKpiKey(r.key)) continue;
      if (r.value_text !== null) {
        if (!opts.omitText) values[r.key] = r.value_text;
      } else if (r.value !== null) {
        values[r.key] = r.value;
      }
    }
    out.push({ date, values });
  }
  return out;
}
