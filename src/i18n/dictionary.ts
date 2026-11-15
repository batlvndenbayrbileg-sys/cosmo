import type { Lang } from "@/lib/types";
import type { AreaDicts, Dict } from "./types";
import { shellStrings } from "./strings/shell";
import { checkinStrings } from "./strings/checkin";
import { crewStrings } from "./strings/crew";
import { dashboardStrings } from "./strings/dashboard";
import { earthStrings } from "./strings/earth";
import { emergencyStrings } from "./strings/emergency";
import { sosStrings } from "./strings/sos";
import { painStrings } from "./strings/pain";
import { signatureStrings } from "./strings/signature";
import { labsStrings } from "./strings/labs";
import { listenStrings } from "./strings/listen";
import { showArea } from "./strings/show";
import { explainStrings } from "./strings/explain";

const showCheckin = showArea("checkin.");
const showDashboard = showArea("dashboard.");

export type { Dict, AreaDicts };

/** One entry per UI area; every key inside an area starts with "<area>.". */
export const areaDictionaries = {
  shell: shellStrings,
  // the listening pill's keys ("checkin.listen.*") and the panels Cosmo shows on screen ("checkin.show.*") live in the
  // check-in area
  checkin: {
    // Cosmo's step-by-step walkthrough ("checkin.explain.*") too
    en: { ...checkinStrings.en, ...listenStrings.en, ...showCheckin.en, ...explainStrings.en },
    mn: { ...checkinStrings.mn, ...listenStrings.mn, ...showCheckin.mn, ...explainStrings.mn },
  },
  crew: crewStrings,
  // Signature Triage keys ("dashboard.signature.*") and the Labs tab keys ("dashboard.labs.*") live in the dashboard area
  // (no extra area)
  dashboard: {
    en: { ...dashboardStrings.en, ...signatureStrings.en, ...labsStrings.en, ...showDashboard.en },
    mn: { ...dashboardStrings.mn, ...signatureStrings.mn, ...labsStrings.mn, ...showDashboard.mn },
  },
  earth: earthStrings,
  // SOS to Earth keys ("emergency.sos.*") and the pain check ("emergency.pain.*") live in the emergency area
  emergency: {
    en: { ...emergencyStrings.en, ...sosStrings.en, ...painStrings.en },
    mn: { ...emergencyStrings.mn, ...sosStrings.mn, ...painStrings.mn },
  },
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
