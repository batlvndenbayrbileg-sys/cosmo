/**
 * Crew roles arrive from the API as English text ("Flight engineer"). Known roles are translated
 * through the i18n dictionary; an unknown role is shown as it is.
 */
const KNOWN_ROLES = ["flight_engineer", "mission_specialist", "commander", "medical_officer"] as const;

export type KnownRole = (typeof KNOWN_ROLES)[number];

/** "Flight engineer" -> "flight_engineer" */
export function roleSlug(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** i18n key for a known role, or null when the role has no translation. */
export function roleKey(role: string): string | null {
  const slug = roleSlug(role);
  return (KNOWN_ROLES as readonly string[]).includes(slug) ? `crew.role.${slug}` : null;
}
