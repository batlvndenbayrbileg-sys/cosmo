/**
 * The website's side of the `lilcosmo://` link that hands a crew member to the desktop pet (docs/lil-cosmo.md).
 * The desktop app accepts exactly this shape (electron/pet-core.cjs, kept in step by tests/pet.core.test.ts).
 */

/** crew ids are plain slugs ("bat", "mira_2") */
export const PET_CREW_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function isPetCrewId(id: unknown): id is string {
  return typeof id === "string" && PET_CREW_ID.test(id);
}

/** `lilcosmo://crew/<id>`, or null for an id the desktop app would refuse anyway */
export function petLink(crewId: string): string | null {
  return isPetCrewId(crewId) ? `lilcosmo://crew/${crewId}` : null;
}

/** the `?crew=` of the pet page: one plain id, or null (she sleeps until the website sends someone) */
export function petCrewParam(raw: string | string[] | undefined): string | null {
  return isPetCrewId(raw) ? raw : null;
}
