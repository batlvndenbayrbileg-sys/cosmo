import type { DashboardPayload, KpiKey } from "../types";
import { NOTE_KEYS } from "../health/flags";
import { BUILTIN_GUIDES } from "./guides";
import { matchEmergency } from "./match";
import { BUILTIN_CALL_FOR_HELP, type EmergencyScenario } from "./schema";

export type SuggestionReason = "dizziness" | "headache_vision" | "note_words" | "vital_red";

export interface GuideSuggestion {
  scenarioId: string;
  reason: SuggestionReason;
}

/**
 * "If it gets worse: <guide>" on the dashboard. Only what the dashboard already knows is used - no new clinical
 * thresholds:
 *  - dizziness answered "yes" today (symptom_dizziness = 1)            -> the fainting guide
 *  - the HEADACHE_PLUS_VISION red flag                                 -> "get help now" (it names no injury)
 *  - the SERIOUS_SYMPTOM_WORD red flag: the note text is matched like speech -> the matching guide, else "get help now"
 *  - the VITAL_RED red flag                                            -> "get help now"
 * At most `limit` suggestions, one per guide, in the order above. Guides missing from `scenarios` are skipped.
 */
export function suggestGuides(
  payload: Pick<DashboardPayload, "kpis" | "summary">,
  scenarios: ReadonlyArray<Pick<EmergencyScenario, "id" | "triggers">> = BUILTIN_GUIDES,
  limit = 2,
): GuideSuggestion[] {
  const value = (key: KpiKey) => payload.kpis.find((k) => k.key === key)?.value ?? null;
  const rules = new Set(payload.summary.redFlags.map((f) => f.rule));
  const out: GuideSuggestion[] = [];
  const known = new Set(scenarios.map((s) => s.id));
  const add = (scenarioId: string, reason: SuggestionReason) => {
    if (!known.has(scenarioId) || out.some((s) => s.scenarioId === scenarioId)) return;
    out.push({ scenarioId, reason });
  };

  if (Number(value("symptom_dizziness")) === 1) add("fainting", "dizziness");
  if (rules.has("HEADACHE_PLUS_VISION")) add(BUILTIN_CALL_FOR_HELP.id, "headache_vision");
  if (rules.has("SERIOUS_SYMPTOM_WORD")) {
    let matched = false;
    for (const key of NOTE_KEYS) {
      const text = value(key);
      if (typeof text !== "string") continue;
      const hit = matchEmergency(text, scenarios);
      if (hit) {
        add(hit.scenarioId, "note_words");
        matched = true;
      }
    }
    if (!matched) add(BUILTIN_CALL_FOR_HELP.id, "note_words");
  }
  if (rules.has("VITAL_RED")) add(BUILTIN_CALL_FOR_HELP.id, "vital_red");
  return out.slice(0, limit);
}
