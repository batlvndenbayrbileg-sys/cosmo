/**
 * Signature Triage honesty guard: in-space measurability (docs/SIGNATURE_SPEC.md section 8.1, decision D-SPACE; build
 * prompt T14). Pure; safe for server and client.
 *
 * Every number Cosmo scores comes from ground laboratories. When asked whether this can be measured in space, Cosmo
 * answers with statements S1-S3 only (copied verbatim from the spec table; the Mongolian is not re-translated), and no
 * assistant text may claim in-flight measurement (`assertNoOrbitClaim`).
 */

import type { Lang } from "../types";

export type SpaceStatementId = "S1" | "S2" | "S3";

/** spec section 8.1, the fixed statements, verbatim */
export const SPACE_STATEMENTS: Readonly<Record<SpaceStatementId, Readonly<Record<Lang, string>>>> = {
  S1: {
    en: "Everything I score comes from blood panels analysed in laboratories on Earth. I do not measure anything in orbit myself.",
    mn: "Миний оноо өгдөг бүх тоо дэлхий дээрх лабораторид шинжилсэн цусны хариунаас гардаг. Би өөрөө тойрог замд юу ч хэмждэггүй.",
  },
  S2: {
    en: "A fingerstick white-cell counter and a small flow cytometer have each been tried on the International Space Station, as technology demonstrations, not as routine crew monitoring.",
    mn: "Хурууны үзүүрийн цусаар цагаан эс тоолох төхөөрөмж болон жижиг урсгалын цитометрийг Олон улсын сансрын станц дээр туршсан. Энэ нь технологийн туршилт байсан, багийн байнгын хяналт биш.",
  },
  S3: {
    en: "I know of no demonstrated in-flight test for IL-6, MCP-1, IL-10 or IL-27. So today I score a panel when one exists, and the daily check-in is the part that needs no laboratory.",
    mn: "IL-6, MCP-1, IL-10, IL-27-г нислэгийн үеэр хэмжсэн туршилтыг би мэдэхгүй. Тиймээс одоогоор шинжилгээний хариу байгаа үед л оноо өгнө. Өдөр тутмын асуулга бол лаборатори шаарддаггүй хэсэг.",
  },
};

export const SPACE_STATEMENT_IDS: readonly SpaceStatementId[] = ["S1", "S2", "S3"];

/** the three statements in the session language, in order (what `get_space_measurability` returns) */
export function spaceStatements(lang: Lang): string[] {
  return SPACE_STATEMENT_IDS.map((id) => SPACE_STATEMENTS[id][lang]);
}

/** build prompt T14: the fallback when a text fails `assertNoOrbitClaim` */
export function orbitClaimFallback(lang: Lang): string {
  return `${SPACE_STATEMENTS.S1[lang]} ${SPACE_STATEMENTS.S3[lang]}`;
}

/* ───────────── the guard ───────────── */

/** build prompt T14, verbatim: a measuring verb followed within 40 characters by "in/on orbit / space / the ISS / flight" */
export const ORBIT_CLAIM = /\b(measure[sd]?|measuring|track(s|ed|ing)?|monitor(s|ed|ing)?)\b[^.]{0,40}\b(in|on) (orbit|space|the ISS|flight)\b/i;

/** build prompt T14: a negation in the same sentence makes it a statement of what is not done */
const NEGATION = /\b(not|no|never|cannot)\b|n't/i;

/**
 * The Mongolian counterpart (added here; the build prompt gives the English pattern only): "in orbit / in space / on the
 * space station / during flight" followed within 40 characters by the verb stem хэмж- ("measure"); a sentence with a
 * negating ending (-гүй) or "биш" is a statement of what is not done.
 */
const ORBIT_CLAIM_MN = /(тойрог замд|сансарт|сансрын станц дээр|нислэгийн үеэр)[^.]{0,40}хэмж/iu;
const NEGATION_MN = /(гүй|биш)(?=[\s.,;:!?)]|$)/u;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/u).filter((s) => s.trim().length > 0);
}

/**
 * false when the text claims in-flight measurement: a sentence matches the claim pattern (English, or the Mongolian
 * counterpart) and has no negation. A sentence ending in "?" is a question, not a claim. Run next to
 * `assertNumbersGrounded`; on failure the caller sends S1 + S3.
 */
export function assertNoOrbitClaim(text: string): boolean {
  for (const s of sentences(text)) {
    // a question ("Can this be measured in space?") asks, it does not claim
    if (s.trim().endsWith("?")) continue;
    if (ORBIT_CLAIM.test(s) && !NEGATION.test(s)) return false;
    if (ORBIT_CLAIM_MN.test(s) && !NEGATION_MN.test(s)) return false;
  }
  return true;
}

/** the facts of the `get_space_measurability` tool: the statements only, and no number may be spoken */
export interface SpaceFacts {
  kind: "space";
  lang: Lang;
  statements: string[];
  allowedNumbers: string[];
}

export function buildSpaceFacts(lang: Lang): SpaceFacts {
  return { kind: "space", lang, statements: spaceStatements(lang), allowedNumbers: [] };
}

/**
 * "the LLM may shorten but not add" (spec section 8.1): model wording is accepted only when every sentence of it is one
 * of the statement sentences of its language (whitespace-normalised), so it can leave sentences out but never add one.
 */
export function onlyStatementSentences(text: string, lang: Lang): boolean {
  const norm = (s: string) => s.replace(/\s+/gu, " ").trim();
  const allowed = new Set(spaceStatements(lang).flatMap(sentences).map(norm));
  const got = sentences(text).map(norm);
  return got.length > 0 && got.every((s) => allowed.has(s));
}
