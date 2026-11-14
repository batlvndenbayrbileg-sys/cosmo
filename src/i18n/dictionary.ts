import type { Lang } from "@/lib/types";
import type { AreaDicts, Dict } from "./types";
import { shellStrings } from "./strings/shell";
import { checkinStrings } from "./strings/checkin";
import { crewStrings } from "./strings/crew";
import { dashboardStrings } from "./strings/dashboard";
import { earthStrings } from "./strings/earth";

export type { Dict, AreaDicts };

/** One entry per UI area; every key inside an area starts with "<area>.". */
export const areaDictionaries = {
  shell: shellStrings,
  checkin: checkinStrings,
  crew: crewStrings,
  dashboard: dashboardStrings,
  earth: earthStrings,
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
