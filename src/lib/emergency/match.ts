import type { Lang } from "../types";
import { SERIOUS_WORDS_EN, SERIOUS_WORDS_MN } from "../health/flags";
import { BUILTIN_CALL_FOR_HELP, type EmergencyScenario } from "./schema";

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this utterance call for emergency guidance? The trigger words of each scenario (both languages - speech
 * recognition mixes them) are checked first, in list order (team-only scenarios, then the built-in guides, most
 * urgent first); then the app's serious-symptom words, which open the built-in "get help" card. Returns null when
 * nothing matches. Negations ("no chest pain") are left to the caller's judgement: guidance opening by mistake is
 * safer than staying closed.
 */
export function matchEmergency(
  text: string,
  scenarios: ReadonlyArray<Pick<EmergencyScenario, "id" | "triggers">>,
): { scenarioId: string; matched: string } | null {
  const t = normalise(text);
  if (t.length === 0) return null;
  for (const s of scenarios) {
    for (const lang of ["en", "mn"] as Lang[]) {
      for (const word of s.triggers[lang]) {
        const w = normalise(word);
        if (w.length >= 2 && t.includes(w)) return { scenarioId: s.id, matched: word };
      }
    }
  }
  for (const word of [...SERIOUS_WORDS_EN, ...SERIOUS_WORDS_MN]) {
    const w = normalise(word);
    if (w.length >= 2 && t.includes(w)) return { scenarioId: BUILTIN_CALL_FOR_HELP.id, matched: word };
  }
  return null;
}
