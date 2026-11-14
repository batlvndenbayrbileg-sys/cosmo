import "server-only";
import { getDb } from "@/server/db/client";
import { assertDateISO, toIso } from "@/server/db/shared";

/**
 * Was any measurement behind the shown history simulated (seeded demo data)?
 *
 * The history repos return values only, not their source, and repos are not part of this lane, so
 * this is the one direct read in src/server/dashboard. It is read-only, filtered by crew_id (and
 * joined on the composite key so a row can never be attributed to another crew), covers exactly the
 * confirmed check-ins that make up the history window (`fromDate` inclusive .. `beforeDate`
 * exclusive, only confirmed at or before `asOf` when given) and returns a single boolean, so it
 * cannot leak anything to the ground role.
 *
 * Candidate to move into repos/measurement.ts (as a crewId-first function) later.
 */
export function historyHasSimulated(
  crewId: string,
  window: { fromDate: string; beforeDate: string; asOf?: string },
): boolean {
  const from = assertDateISO(window.fromDate, "fromDate");
  const before = assertDateISO(window.beforeDate, "beforeDate");
  const visibility = window.asOf !== undefined ? "AND c.confirmed_at <= ?" : "";
  const params: string[] = [crewId, from, before];
  if (window.asOf !== undefined) params.push(toIso(window.asOf, "asOf"));
  const row = getDb()
    .prepare(
      `SELECT 1 AS hit
         FROM measurement m
         JOIN check_in c ON c.id = m.check_in_id AND c.crew_id = m.crew_id
        WHERE m.crew_id = ? AND m.source = 'simulated'
          AND c.confirmed_at IS NOT NULL AND c.local_date >= ? AND c.local_date < ? ${visibility}
        LIMIT 1`,
    )
    .get(...params);
  return row !== undefined;
}
