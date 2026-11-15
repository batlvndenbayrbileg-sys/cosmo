/**
 * Remembers which crew member was chosen on the start screen, for this browser tab only
 * (sessionStorage). The signed session cookie is the real identity; this copy only carries
 * display data (name, role, avatar variant) that no API route returns for "me".
 * It holds no health data. Every storage access is wrapped: private windows and blocked storage
 * must never break the screen.
 */
import type { CrewPublic } from "@/lib/types";

export const SELECTED_CREW_KEY = "cosmo.crew";

/** Validates the stored JSON; anything malformed (or from an older shape) is treated as absent. */
export function parseStoredCrew(raw: string | null): CrewPublic | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (
    typeof c.id !== "string" ||
    typeof c.name !== "string" ||
    typeof c.role !== "string" ||
    (c.preferredLanguage !== "mn" && c.preferredLanguage !== "en") ||
    typeof c.mascotVariant !== "number" ||
    !Number.isFinite(c.mascotVariant) ||
    typeof c.avatarSeed !== "string"
  ) {
    return null;
  }
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    preferredLanguage: c.preferredLanguage,
    mascotVariant: c.mascotVariant,
    avatarSeed: c.avatarSeed,
  };
}

export function saveSelectedCrew(crew: CrewPublic): void {
  try {
    window.sessionStorage.setItem(SELECTED_CREW_KEY, JSON.stringify(crew));
  } catch {
    // storage unavailable: the check-in still works, only the header name is missing
  }
}

export function clearSelectedCrew(): void {
  try {
    window.sessionStorage.removeItem(SELECTED_CREW_KEY);
  } catch {
    // nothing to clear
  }
}

/** Raw stored string, for useSyncExternalStore (primitives keep the snapshot referentially stable). */
export function readSelectedCrewRaw(): string | null {
  try {
    return window.sessionStorage.getItem(SELECTED_CREW_KEY);
  } catch {
    return null;
  }
}
