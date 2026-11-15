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
 * nothing matches. Only a CLEAR denial in the same clause skips a match ("I don't have chest pain", "no chest pain",
 * "цээж өвдөх юм алга"); anything less certain still opens the guidance: opening by mistake is safer than staying
 * closed.
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
        if (w.length >= 2 && affirmedIn(t, w)) return { scenarioId: s.id, matched: word };
      }
    }
  }
  for (const word of [...SERIOUS_WORDS_EN, ...SERIOUS_WORDS_MN]) {
    const w = normalise(word);
    if (w.length >= 2 && affirmedIn(t, w)) return { scenarioId: BUILTIN_CALL_FOR_HELP.id, matched: word };
  }
  return null;
}

/** clear denials before the words in the same clause (English) */
const EN_DENIAL_BEFORE = /(?:^|\s)(?:no|not|never|without|don't have|do not have|didn't have|haven't had|doesn't have|isn't|wasn't|no more)\s+(?:\S+\s+){0,3}$/u;
/** clear denials right after the words in the same clause (Mongolian: "... байхгүй", "... алга", "... үгүй", "...гүй") */
const MN_DENIAL_AFTER = /^\S*гүй|^\s*(?:\S+\s+){0,2}(?:байхгүй|алга|үгүй|биш)(?![\p{L}])/u;

/** the words occur at least once in a clause that does not clearly deny them */
function affirmedIn(t: string, w: string): boolean {
  for (const clause of t.split(/[.,;!?]|\bbut\b|харин|гэхдээ/u)) {
    let from = 0;
    for (;;) {
      const at = clause.indexOf(w, from);
      if (at < 0) break;
      const before = clause.slice(0, at);
      const after = clause.slice(at + w.length);
      if (!EN_DENIAL_BEFORE.test(before) && !MN_DENIAL_AFTER.test(after)) return true;
      from = at + w.length;
    }
  }
  return false;
}
