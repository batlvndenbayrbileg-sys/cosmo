import type { Lang } from "@/lib/types";
import type { AreaDicts, Dict } from "./types";
import { shellStrings } from "./strings/shell";
import { checkinStrings } from "./strings/checkin";
import { crewStrings } from "./strings/crew";
import { dashboardStrings } from "./strings/dashboard";
import { earthStrings } from "./strings/earth";
import { emergencyStrings } from "./strings/emergency";
import { signatureStrings } from "./strings/signature";
import { labsStrings } from "./strings/labs";

export type { Dict, AreaDicts };

/** One entry per UI area; every key inside an area starts with "<area>.". */
export const areaDictionaries = {
  shell: shellStrings,
  checkin: checkinStrings,
  crew: crewStrings,
  // Signature Triage keys ("dashboard.signature.*") and the Labs tab keys ("dashboard.labs.*") live in the dashboard area
  // (no extra area)
  dashboard: {
    en: { ...dashboardStrings.en, ...signatureStrings.en, ...labsStrings.en },
    mn: { ...dashboardStrings.mn, ...signatureStrings.mn, ...labsStrings.mn },
  },
  earth: earthStrings,
  emergency: emergencyStrings,
} as const satisfies Record<string, AreaDicts>;

export type AreaName = keyof typeof areaDictionaries;

function merge(lang: Lang): Dict {
  const out: Dict = {};
  for (const area of Object.values(areaDictionaries)) Object.assign(out, area[lang]);
  return out;
}

export const dictionaries: Record<Lang, Dict> = {
  en: merge("en"),
  mn: merge("mn"),
};
