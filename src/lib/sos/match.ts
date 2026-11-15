/**
 * Does this utterance ask Cosmo to alert Earth? ("tell Earth", "call ground control", "send an SOS", "mayday";
 * "дэлхий рүү хэл", "дэлхийд мэдэгдээрэй", "газар руу дохио өг", "газрын удирдлагатай холбогд"). Both languages are
 * checked whatever the check-in's language (speech recognition mixes them).
 *
 * An SOS is never sent without the crew member's own words, so the matcher is deliberately literal and refuses:
 *  - negations: "don't tell Earth", "битгий дэлхийд хэл", "дэлхийд хэлэх хэрэггүй", "мэдэгдэхгүй";
 *  - questions about it and past events: "did you tell Earth?", "how do I call Earth?", "дэлхийд мэдэгдсэн үү?",
 *    "дэлхий рүү мэдэгдэл илгээлээ" (also what Cosmo itself says after sending), conditionals ("хэлбэл");
 *  - a friendly message to pass on: "tell Earth I'm fine", "дэлхийд сайн байна гэж хэлээрэй".
 * Returns the trigger words as heard (never the rest of the utterance), or null.
 */

export interface SosMatch {
  /** the trigger words only, e.g. "tell earth" / "дэлхий рүү мэдэгд" */
  phrase: string;
  lang: "en" | "mn";
}

const MAX_PHRASE = 60;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\bs\s*\.\s*o\s*\.\s*s\b\.?/g, "sos")
    .replace(/[.,!?;:"«»()[\]{}…–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ───────────── English ───────────── */

const EN_TARGET = String.raw`(?:the\s+)?(?:earth|ground(?:\s+control)?|mission\s+control|houston|capcom)`;
const EN_VERB = String.raw`(?:tell|call|notify|contact|alert|message|signal|radio|inform|warn|ping)`;
const EN_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b${EN_VERB}\s+(?:to\s+)?${EN_TARGET}\b`),
  new RegExp(String.raw`\blet\s+${EN_TARGET}\s+know\b`),
  new RegExp(String.raw`\bget\s+${EN_TARGET}\s+on\s+the\s+(?:line|radio)\b`),
  new RegExp(
    String.raw`\bsend\s+(?:an?\s+|the\s+)?(?:sos|mayday|(?:urgent\s+|emergency\s+)?alert|emergency\s+signal|distress\s+(?:signal|call)|signal|message)\s+(?:to\s+)?${EN_TARGET}\b`,
  ),
  new RegExp(String.raw`\b(?:send|sound|raise|trigger|give)\s+(?:an?\s+|the\s+)?(?:sos|mayday|distress\s+signal|emergency\s+signal)\b`),
];
/** "SOS!", "mayday mayday", "Cosmo, SOS": the whole utterance is the call */
const EN_SHORT = /^(?:(?:please|cosmo|hey|ok|okay)\s+)*(?:sos|mayday)(?:\s+(?:sos|mayday|please|now|cosmo))*$/;

const EN_NEGATED = /\b(?:don'?t|do\s+not|dont|never|not|no\s+need\s+to|shouldn'?t|won'?t|wouldn'?t|without|stop)\b/;
const EN_ASKING =
  /\b(?:did\s+you|have\s+you|has\s+(?:it|anyone|someone)|was\s+it|how\s+(?:do|can|would|should)\s+(?:i|we|you)|how\s+to|should\s+(?:i|we)|what\s+(?:does|happens|if)|why\s+(?:did|would))\b/;
/** "an urgent alert to Earth", "your message to ground", "I've sent a signal to Earth": a noun or a past event */
const EN_NOUN_BEFORE = /\b(?:a|an|the|urgent|emergency|my|your|this|that|sent|got|received)$/;
const EN_FRIENDLY =
  /^(?:(?:that|about)\s+)?(?:(?:i'?m|i\s+am|we'?re|we\s+are|all\s+is|everything\s+is|everything'?s)\s+(?:fine|ok|okay|good|well|great|safe|alright|all\s+right)\b|(?:hello|hi|hey|good\s+(?:morning|night|evening)|thanks|thank\s+you|happy\s+birthday)\b)/;

function lastWords(s: string, n: number): string {
  return s.trim().split(" ").slice(-n).join(" ");
}

function matchEnglish(t: string): SosMatch | null {
  if (EN_SHORT.test(t)) return { phrase: t.slice(0, MAX_PHRASE), lang: "en" };
  for (const re of EN_PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    const before = lastWords(t.slice(0, m.index), 5);
    if (EN_NEGATED.test(before) || EN_ASKING.test(before) || EN_NOUN_BEFORE.test(before)) continue;
    if (EN_FRIENDLY.test(t.slice(m.index + m[0].length).trim())) continue;
    return { phrase: m[0].trim().slice(0, MAX_PHRASE), lang: "en" };
  }
  return null;
}

/* ───────────── Mongolian ───────────── */

/** how many words starting at i name Earth / ground control in a "to / with" form (0 when none) */
function mnTargetAt(w: readonly string[], i: number): number {
  const a = w[i] ?? "";
  const b = w[i + 1] ?? "";
  if (/^(?:дэлхий|газар)$/.test(a) && /^[рл][үу][үу]$/.test(b)) return 2;
  if (/^(?:дэлхий|газар)[рл][үу][үу]$/.test(a)) return 1;
  if (/^(?:дэлхийд|дэлхийтэй|газарт|газартай|хьюстон\S*)$/.test(a)) return 1;
  if (/^(?:газрын|нислэгийн|удирдлагын|дэлхийн)$/.test(a) && /^(?:удирдлага|төв)/.test(b)) return 2;
  return 0;
}

/** tell / notify / report / signal / contact / call / send */
function isMnVerb(word: string): boolean {
  return /^(?:хэл(?!элц|бэр|хээ|ний|ээр$)|мэдэгд|мэдээл(?!эл)|дохио|холбогд|дууд|илгээ|дамжуул)/.test(word);
}

/** -гүй (negative), past (-сан/-сэн/-лаа/-лээ/-жээ), conditional (-бал/-вал): not a request */
function mnNotARequest(word: string): boolean {
  return /гүй$/.test(word) || /(?:с[аэоө]н|л[аэоө]{2}|[жч][эе]э|[бв][аэ]л)$/.test(word) || /^хэрэггүй/.test(word);
}

const MN_FRIENDLY = /^(?:сайн|зүгээр|мэнд|баярлалаа|хайртай|амар|сайхан)/;

function mnGuardsPass(w: readonly string[], start: number, verbAt: number): boolean {
  const from = Math.max(0, start - 3);
  for (let k = from; k <= Math.min(w.length - 1, verbAt + 2); k++) {
    if (w[k] === "битгий" || w[k] === "бүү" || /^хэрэггүй/.test(w[k])) return false;
  }
  if (mnNotARequest(w[verbAt])) return false;
  const next = w[verbAt + 1];
  if (next !== undefined && mnNotARequest(next)) return false;
  // "... сайн байна гэж хэлээрэй": a message to pass on, not an alert (unless it is "зүгээр биш")
  const quote = w.lastIndexOf("гэж", verbAt);
  if (quote !== -1) {
    const said = w.slice(Math.max(0, quote - 3), quote);
    if (said.some((x) => MN_FRIENDLY.test(x)) && !said.includes("биш")) return false;
  }
  return true;
}

function matchMongolian(t: string): SosMatch | null {
  const w = t.split(" ");
  for (let i = 0; i < w.length; i++) {
    const len = mnTargetAt(w, i);
    if (len > 0) {
      // target then verb, up to three words apart ("дэлхий рүү яаралтай мэдэгд")
      for (let j = i + len; j <= Math.min(w.length - 1, i + len + 3); j++) {
        if (!isMnVerb(w[j])) continue;
        if (mnGuardsPass(w, i, j)) return { phrase: w.slice(i, j + 1).join(" ").slice(0, MAX_PHRASE), lang: "mn" };
        break;
      }
      // verb then target ("мэдэгдээрэй дэлхийд")
      for (let j = Math.max(0, i - 2); j < i; j++) {
        if (isMnVerb(w[j]) && mnGuardsPass(w, j, j)) {
          return { phrase: w.slice(j, i + len).join(" ").slice(0, MAX_PHRASE), lang: "mn" };
        }
      }
    }
    // "яаралтай дохио өг" (give an emergency signal)
    if (w[i] === "яаралтай" && /^дохио/.test(w[i + 1] ?? "")) {
      const verbAt = i + 2;
      if (/^(?:өг|илгээ|дамжуул)/.test(w[verbAt] ?? "") && mnGuardsPass(w, i, verbAt)) {
        return { phrase: w.slice(i, verbAt + 1).join(" "), lang: "mn" };
      }
    }
  }
  return null;
}

export function matchSosRequest(text: string): SosMatch | null {
  const t = normalise(text);
  if (t.length === 0) return null;
  return matchEnglish(t) ?? matchMongolian(t);
}
