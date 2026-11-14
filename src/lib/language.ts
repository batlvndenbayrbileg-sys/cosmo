import type { Lang } from "./types";

/**
 * Language helpers. Detection is script-based: it counts Cyrillic vs Latin LETTERS.
 *
 * Known limits (by design, covered by tests):
 *  - Latin-transliterated Mongolian ("sain baina uu", "doloo tsag") is detected as English,
 *    because it is written in Latin script. The check-in UI therefore always passes the
 *    session language as a hint, and the hint only breaks ties.
 *  - Any Cyrillic text (e.g. Russian) counts as Mongolian; Phase 1 supports only mn and en.
 */

// A Map (not an object literal) so untrusted codes such as "constructor", "toString" or
// "__proto__" cannot resolve to Object.prototype members.
const LANG_CODES: ReadonlyMap<string, Lang> = new Map<string, Lang>([
  ["mn", "mn"],
  ["mon", "mn"],
  ["mong", "mn"],
  ["khk", "mn"],
  ["mongolian", "mn"],
  ["en", "en"],
  ["eng", "en"],
  ["english", "en"],
]);

/** "mn", "MON", "khk", "Mongolian", "en-US", "en_GB", "english" → Lang; anything else → null */
export function normalizeLanguageCode(code?: string | null): Lang | null {
  if (typeof code !== "string") return null;
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  if (base.length === 0) return null;
  return LANG_CODES.get(base) ?? null;
}

/** a dominant-script share below this is treated as a near tie (so the hint decides) */
export const TIE_SHARE = 0.55;

const CYRILLIC_LETTER = /\p{Script=Cyrillic}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;

function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/**
 * Detect the language of `text` by the dominant script among its letters.
 * confidence = share of letters in the dominant script (0 when there are no letters).
 * No letters (digits / punctuation only) or a near tie → `hint` (via normalizeLanguageCode), else "en".
 */
export function detectLanguage(
  text: string,
  hint?: string | null,
): { lang: Lang; confidence: number } {
  const cyrillic = count(text, CYRILLIC_LETTER);
  const latin = count(text, LATIN_LETTER);
  const total = cyrillic + latin;
  const hinted = normalizeLanguageCode(hint) ?? "en";

  if (total === 0) return { lang: hinted, confidence: 0 };

  const dominant: Lang = cyrillic > latin ? "mn" : "en";
  const share = Math.max(cyrillic, latin) / total;
  if (share < TIE_SHARE) return { lang: hinted, confidence: share };
  return { lang: dominant, confidence: share };
}
