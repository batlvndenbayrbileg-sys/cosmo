import "server-only";
import type { CrewPublic } from "@/lib/types";
import { NotFoundError } from "@/server/http";
import { getDb } from "../client";
import { CREW_COLUMNS, mapCrew, type CrewDbRow } from "../rows";

/**
 * Roster fields only (id, name, role, language, mascot, avatar seed): no health data, so this is
 * the one repo function without a crewId parameter. Insertion order.
 */
export function listCrewPublic(): CrewPublic[] {
  const rows = getDb()
    .prepare(`SELECT ${CREW_COLUMNS} FROM crew_member ORDER BY rowid ASC`)
    .all() as CrewDbRow[];
  return rows.map(mapCrew);
}

export function getCrewPublic(crewId: string): CrewPublic {
  const row = getDb()
    .prepare(`SELECT ${CREW_COLUMNS} FROM crew_member WHERE id = ?`)
    .get(crewId) as CrewDbRow | undefined;
  if (!row) throw new NotFoundError("Crew member not found");
  return mapCrew(row);
}
