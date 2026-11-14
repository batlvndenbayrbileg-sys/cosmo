import "server-only";
import type { CrewPublic } from "@/lib/types";
import { NotFoundError } from "@/server/http";
import { getDb } from "../client";
import { CREW_COLUMNS, mapCrew, type CrewDbRow } from "../rows";

/**
 * Roster fields only (id, name, role, language, mascot, avatar seed): no health data, so this is
 * the one repo function without a crewId parameter. Insertion order.
 */
export async function listCrewPublic(): Promise<CrewPublic[]> {
  const db = await getDb();
  const rows = await db.all<CrewDbRow>(`SELECT ${CREW_COLUMNS} FROM crew_member ORDER BY rowid ASC`);
  return rows.map(mapCrew);
}

export async function getCrewPublic(crewId: string): Promise<CrewPublic> {
  const db = await getDb();
  const row = await db.get<CrewDbRow>(`SELECT ${CREW_COLUMNS} FROM crew_member WHERE id = ?`, crewId);
  if (!row) throw new NotFoundError("Crew member not found");
  return mapCrew(row);
}
