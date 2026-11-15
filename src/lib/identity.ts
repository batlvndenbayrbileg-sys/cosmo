import type { Lang } from "./types";
import type { VoiceClass } from "./voice/pitch";
import { detectLanguage } from "./language";

/**
 * Who is speaking to the assistant (the "/" screen), decided by code from two cues and a correction:
 *
 *  1. the language of the first utterance (speech-to-text reports it; typed text is read by its script: Cyrillic = mn),
 *  2. the voice guess measured on the device (src/lib/voice/pitch.ts; only "female" / "male" / "unknown" is sent),
 *  3. a name said outright ("би Бат", "I'm Mira", "биш, Сараа"), which always wins.
 *
 * The four crew of this prototype (src/server/db/seed.ts) map onto language x voice: Mongolian lower voice -> Bat,
 * Mongolian higher voice -> Saraa, English lower voice -> Alex, English higher voice -> Mira. The voice cue is a
 * heuristic about pitch, not about the person (see pitch.ts); it is only used to choose between the two people who
 * speak the same language, never shown as a word on screen, and every guess can be corrected by voice or by tapping the
 * name. With no confident cue the previous person of that language is kept, otherwise Cosmo asks.
 */

export type IdentityReason = "claim" | "voice" | "previous" | "ask";

interface KnownCrew {
  id: string;
  lang: Lang;
  voice: Exclude<VoiceClass, "unknown">;
  /** the name in either script, as one regex source (whole word) */
  names: string;
  /** the name in Cyrillic, for the Mongolian screen */
  mn: string;
}

export const IDENTITY_CREW: readonly KnownCrew[] = [
  // "бат бөх" (sturdy) is not the name
  { id: "bat", lang: "mn", voice: "male", names: "бат(?:аа)?(?![\\p{L}])(?!\\s*бөх)|bat", mn: "Бат" },
  { id: "saraa", lang: "mn", voice: "female", names: "сараа?|sara+h?", mn: "Сараа" },
  { id: "alex", lang: "en", voice: "male", names: "алекс|alex(?:ander)?", mn: "Алекс" },
  { id: "mira", lang: "en", voice: "female", names: "мира|mira", mn: "Мира" },
];

/** the name as the screen shows it: Cyrillic on the Mongolian screen for the four known crew */
export function displayName(crew: { id: string; name: string }, lang: Lang): string {
  if (lang !== "mn") return crew.name;
  return IDENTITY_CREW.find((c) => c.id === crew.id)?.mn ?? crew.name;
}

const L = "\\p{L}";

/** the crew members who speak this language, in roster order */
export function crewForLanguage(lang: Lang): string[] {
  return IDENTITY_CREW.filter((c) => c.lang === lang).map((c) => c.id);
}

/** language x voice -> crew id (null for an unknown voice) */
export function crewForVoice(lang: Lang, voice: VoiceClass): string | null {
  if (voice === "unknown") return null;
  return IDENTITY_CREW.find((c) => c.lang === lang && c.voice === voice)?.id ?? null;
}

/** the language of typed text: Cyrillic letters -> mn, Latin -> en (a tie or no letters: the hint, else en) */
export function languageOfText(text: string, hint?: Lang | null): Lang {
  return detectLanguage(text, hint ?? null).lang;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ`]/gu, "'").replace(/\s+/gu, " ").trim();
}

/** words before a name that make it a claim ("I'm", "би", "биш,") */
const CUE_BEFORE =
  "(?:i'?m|i\\s+am|it'?s|it\\s+is|this\\s+is|that'?s|my\\s+name\\s+is|my\\s+name'?s|call\\s+me|no,?|nope,?|би|бол|миний\\s+нэр|нэр\\s+минь|намайг|биш(?:ээ)?,?|үгүй,?|үгүй\\s+ээ,?)";
/** words after a name that make it a claim ("Бат байна", "Сараа шүү", "Мира гэдэг") */
const CUE_AFTER = "(?:байна|байгаа|шүү|гэдэг|гэж\\s+дууда|here|speaking)";

function nameRe(names: string): RegExp {
  return new RegExp(`(?<![${L}])(?:${names})(?![${L}])`, "giu");
}

/** a mention of this name that is negated: "би Бат биш", "not Bat", "I'm not Mira" */
function negatedMention(t: string, start: number, end: number): boolean {
  const after = t.slice(end);
  const before = t.slice(0, start);
  if (/^\s*(?:биш|бус)(?![\p{L}])/u.test(after)) return true;
  return /(?:\bnot|n't|isn'?t)\s*$/u.test(before);
}

export interface IdentityClaim {
  /** the person the words name as the speaker, null when none */
  crewId: string | null;
  /** people the words say the speaker is NOT ("би Бат биш") */
  notCrew: string[];
}

/**
 * A name in the words. `strict` (in a running conversation) needs a cue: "би Бат", "I'm Mira", "this is Alex",
 * "биш, Сараа", "Сараа байна". Without `strict` (Cosmo just asked who is speaking) the bare name counts too ("Сараа").
 * A negated mention ("би Бат биш", "not Bat") never claims, it only rules that person out.
 */
export function detectIdentityClaim(text: string, opts: { strict: boolean }): IdentityClaim {
  const t = normalise(text);
  const notCrew: string[] = [];
  let best: { id: string; at: number } | null = null;
  for (const crew of IDENTITY_CREW) {
    for (const m of t.matchAll(nameRe(crew.names))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (negatedMention(t, start, end)) {
        if (!notCrew.includes(crew.id)) notCrew.push(crew.id);
        continue;
      }
      const before = t.slice(0, start);
      const after = t.slice(end);
      const cued =
        new RegExp(`(?:^|[\\s,.!?])${CUE_BEFORE}\\s*$`, "u").test(before) ||
        new RegExp(`^\\s*,?\\s*${CUE_AFTER}(?![${L}])`, "u").test(after);
      // the bare name only when it is (nearly) all that was said, in the loose mode
      const bare = !opts.strict && t.replace(m[0], "").replace(/[\p{P}\s]/gu, "").length <= 12;
      if (!cued && !bare) continue;
      // the last claimed name wins ("not Bat, I'm Saraa"; "би Бат биш, Сараа")
      if (!best || start > best.at) best = { id: crew.id, at: start };
    }
  }
  return { crewId: best && !notCrew.includes(best.id) ? best.id : null, notCrew };
}

export interface IdentifyInput {
  lang: Lang;
  voice: VoiceClass;
  /** what the words claim (detectIdentityClaim) */
  claim?: IdentityClaim | null;
  /** the person identified before on this device (kept when there is no confident new cue) */
  previous?: string | null;
}

export interface IdentifyResult {
  crewId: string | null;
  reason: IdentityReason;
  /** when Cosmo must ask: the people of that language (minus anyone the words ruled out) */
  candidates: string[];
}

/** claim > voice > previous person of the same language > ask */
export function identifyCrew(input: IdentifyInput): IdentifyResult {
  const ruledOut = new Set(input.claim?.notCrew ?? []);
  const candidates = crewForLanguage(input.lang).filter((id) => !ruledOut.has(id));
  if (input.claim?.crewId) return { crewId: input.claim.crewId, reason: "claim", candidates };
  const byVoice = crewForVoice(input.lang, input.voice);
  if (byVoice && !ruledOut.has(byVoice)) return { crewId: byVoice, reason: "voice", candidates };
  // "би Бат биш" with one Mongolian speaker left: that one
  if (ruledOut.size > 0 && candidates.length === 1) return { crewId: candidates[0], reason: "claim", candidates };
  const previous = input.previous ? IDENTITY_CREW.find((c) => c.id === input.previous) : undefined;
  if (previous && previous.lang === input.lang && !ruledOut.has(previous.id)) {
    return { crewId: previous.id, reason: "previous", candidates };
  }
  return { crewId: null, reason: "ask", candidates };
}

export function isVoiceClass(v: unknown): v is VoiceClass {
  return v === "female" || v === "male" || v === "unknown";
}
