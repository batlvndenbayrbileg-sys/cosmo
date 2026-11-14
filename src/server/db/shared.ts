import "server-only";
import { randomUUID } from "node:crypto";
import { KPI_KEYS, type KpiKey, type Lang } from "@/lib/types";
import { HttpError, NotFoundError } from "@/server/http";
import type { Db, Queryable } from "./client";

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
export async function assertCheckInOwned(
  db: Queryable,
  crewId: string,
  checkInId: string,
): Promise<{ confirmedAt: string | null }> {
  const row = await db.get<{ confirmed_at: string | null }>(
    "SELECT confirmed_at FROM check_in WHERE id = ? AND crew_id = ?",
    checkInId,
    crewId,
  );
  if (!row) throw new NotFoundError("Check-in not found");
  return { confirmedAt: row.confirmed_at };
}

/**
 * assertCheckInOwned for a check-then-write sequence: call it inside db.transaction. On Postgres the check-in row is
 * also locked (FOR UPDATE) until the transaction ends, so a confirmation from another connection or instance either
 * commits before the check (which then sees it) or waits until the write is done. SQLite needs no lock: a transaction
 * there already keeps every other query out until it ends.
 */
export async function lockCheckInOwned(
  db: Db,
  crewId: string,
  checkInId: string,
): Promise<{ confirmedAt: string | null }> {
  if (db.dialect !== "postgres") return assertCheckInOwned(db, crewId, checkInId);
  const row = await db.get<{ confirmed_at: string | null }>(
    "SELECT confirmed_at FROM check_in WHERE id = ? AND crew_id = ? FOR UPDATE",
    checkInId,
    crewId,
  );
  if (!row) throw new NotFoundError("Check-in not found");
  return { confirmedAt: row.confirmed_at };
}

/**
 * Namespaces for lockKeyForTransaction (the first key of Postgres's two-key advisory lock, a lock space of its own:
 * the schema lock in client.ts uses the one-key form and can never collide with these).
 */
export const LOCK_SCOPE = {
  /** one "find today's open check-in, else create it" at a time per crew member */
  checkInStart: 1,
} as const;

/**
 * Serialises a read-then-write sequence per (scope, key) until the current transaction ends: call it inside
 * db.transaction. Postgres: a transaction-level advisory lock, which holds across pooled connections and serverless
 * instances. SQLite: nothing to do, a transaction there already keeps every other query out until it ends.
 */
export async function lockKeyForTransaction(
  db: Db,
  scope: (typeof LOCK_SCOPE)[keyof typeof LOCK_SCOPE],
  key: string,
): Promise<void> {
  if (db.dialect !== "postgres") return;
  await db.get("SELECT pg_advisory_xact_lock(?, hashtext(?))", scope, key);
}

export async function assertCrewExists(db: Queryable, crewId: string): Promise<void> {
  const row = await db.get("SELECT 1 AS x FROM crew_member WHERE id = ?", crewId);
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
 * latest one (by confirmed_at). Three round trips whatever `days` is: the measurements of every
 * selected check-in come back in one query and are grouped here.
 */
export async function queryHistoryDays(
  db: Queryable,
  crewId: string,
  opts: HistoryOptions,
): Promise<HistoryDayRow[]> {
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
  const dates = await db.all<{ local_date: string }>(
    `SELECT local_date FROM check_in
      WHERE crew_id = ? AND confirmed_at IS NOT NULL AND local_date < ? ${visibility}
      GROUP BY local_date ORDER BY local_date DESC LIMIT ?`,
    crewId,
    before,
    ...visibilityParams,
    opts.days,
  );
  if (dates.length === 0) return [];
  // every date between the oldest selected one and `before` that has a visible check-in is selected
  const start = dates[dates.length - 1].local_date;

  const checkIns = await db.all<{ id: string; local_date: string }>(
    `SELECT id, local_date FROM check_in
      WHERE crew_id = ? AND confirmed_at IS NOT NULL
        AND local_date >= ? AND local_date < ? ${visibility}
      ORDER BY local_date ASC, confirmed_at ASC, rowid ASC`,
    crewId,
    start,
    before,
    ...visibilityParams,
  );

  // last row per date wins (rows are ordered by confirmed_at ascending within a date)
  const latestPerDate = new Map<string, string>();
  for (const c of checkIns) latestPerDate.set(c.local_date, c.id);
  if (latestPerDate.size === 0) return [];

  const ids = [...latestPerDate.values()];
  const rows = await db.all<{
    check_in_id: string;
    key: string;
    value: number | null;
    value_text: string | null;
  }>(
    `SELECT check_in_id, key, value, value_text FROM measurement
      WHERE crew_id = ? AND check_in_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY check_in_id ASC, created_at ASC, rowid ASC`,
    crewId,
    ...ids,
  );
  // per check-in, rows stay in created_at, rowid order
  const byCheckIn = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCheckIn.get(r.check_in_id);
    if (list) list.push(r);
    else byCheckIn.set(r.check_in_id, [r]);
  }

  const out: HistoryDayRow[] = [];
  for (const [date, checkInId] of latestPerDate) {
    const values: HistoryDayRow["values"] = {};
    for (const r of byCheckIn.get(checkInId) ?? []) {
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
