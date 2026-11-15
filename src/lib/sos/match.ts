/**
 * Does this utterance ask Cosmo to alert Earth? ("tell Earth", "call ground control", "send an SOS", "mayday";
 * "дэлхий рүү хэл", "дэлхийд мэдэгдээрэй", "газар руу дохио өг", "газрын удирдлагатай холбогд"). Both languages are
 * checked whatever the check-in's language (speech recognition mixes them).
 *
 * An SOS is never sent without the crew member's own words, so the matcher is deliberately literal and refuses:
 *  - negations of the request itself: "don't tell Earth", "you don't need to call Earth", "битгий дэлхийд хэл",
 *    "дэлхийд хэлэх хэрэггүй", "мэдэгдэхгүй";
 *  - questions about it (Cosmo answers those instead): "did you tell Earth?", "how do I call Earth?", "is it possible
 *    to contact Earth?", "can astronauts call Earth?", "дэлхий рүү яаж холбогдох вэ?", "дэлхийд хэлэх үү?";
 *  - past or habitual events: "I've sent an urgent alert to Earth" / "дэлхий рүү мэдэгдэл илгээлээ" (also what Cosmo
 *    itself says after sending), "бид дэлхийтэй холбогддог", conditionals ("if I call Earth", "хэлбэл");
 *  - "Earth" as the world, not mission control: "дэлхийд хамгийн их ярьдаг хэл", "англи хэл дэлхийд ...";
 *  - a friendly message to pass on: "tell Earth I'm fine", "дэлхийд сайн байна гэж хэлээрэй".
 * Each clause (split at punctuation) is judged on its own, so "I'm not okay, call Earth" and "I don't feel well,
 * tell Earth" are requests: the "not" belongs to another clause. Returns the trigger words as heard (never the rest
 * of the utterance), or null.
 */

export interface SosMatch {
  /** the trigger words only, e.g. "tell earth" / "дэлхий рүү мэдэгд" */
  phrase: string;
  lang: "en" | "mn";
}

const MAX_PHRASE = 60;

/** lower case, one apostrophe, "S.O.S." as "sos", then the clauses between punctuation marks */
function clausesOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\bs\s*\.\s*o\s*\.\s*s\b\.?/g, "sos")
    .split(/[.,!?;:"«»()[\]{}…–—]+/)
    .map((c) => c.replace(/-/g, " ").replace(/\s+/g, " ").trim())
    .filter((c) => c.length > 0);
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
/** "SOS!", "mayday mayday", "Cosmo, SOS": the whole clause is the call */
const EN_SHORT = /^(?:(?:please|cosmo|hey|ok|okay)\s+)*(?:sos|mayday)(?:\s+(?:sos|mayday|please|now|cosmo))*$/;

/**
 * a negation that governs the request, right before it ("don't", "you don't need to", "no need to", "i'd rather
 * not"); "i'm not okay call earth" or "it won't stop bleeding call earth" are not negated requests
 */
const EN_NEGATED =
  /\b(?:don'?t|do\s+not|dont|never|not|no\s+need|shouldn'?t|won'?t|wouldn'?t|without|stop)(?:\s+(?:want|need|wanna|have|going|gonna|try|bother|you|to|me|us|just|ever|even|yet|please|cosmo|really))*$/;
/** a question about alerting Earth, not a request: "how long does it take to message Earth", "what if I call Earth" */
const EN_WH = /\b(?:how|why|when|where|which|whether|if)\b/;
const EN_WHAT = /^(?:(?:hey|cosmo|ok|okay|so|and|but|um|uh|please)\s+)*(?:what|who|whom|whose)\b|\b(?:what|who)(?:'s|\s+(?:does|do|did|is|are|was|were|happens|happened|would|will|should|can|could|if))\b/;
const EN_ASKING = /\b(?:did\s+you|have\s+you|has\s+(?:it|anyone|someone)|was\s+it|should\s+(?:i|we))\b/;
/** "is it possible to call Earth", "can astronauts call Earth", "do you call Earth" ... */
const EN_Q_START =
  /^(?:(?:hey|cosmo|ok|okay|so|and|but|um|uh|please)\s+)*(?:is|are|am|was|were|do|does|did|can|could|would|will|should|shall|has|have|had|may|might|must)\b/;
/** ... but "can you / could you / would you / will you call Earth" asks Cosmo to do it */
const EN_REQUEST_START = /^(?:(?:hey|cosmo|ok|okay|so|and|but|um|uh|please)\s+)*(?:can|could|would|will)\s+(?:you|u|ya)\b/;
/** "I wanted to call Houston", "I was going to tell Earth": a past intention */
const EN_PAST_INTENT = /\b(?:wanted|used|tried|forgot|remembered|managed|was\s+going|were\s+going|was\s+about|were\s+about)\s+to$/;
/** "an urgent alert to Earth", "your message to ground", "I've sent a signal to Earth": a noun or a past event */
const EN_NOUN_BEFORE = /\b(?:a|an|the|urgent|emergency|my|your|this|that|sent|got|received)$/;
const EN_FRIENDLY =
  /^(?:(?:that|about)\s+)?(?:(?:i'?m|i\s+am|we'?re|we\s+are|all\s+is|everything\s+is|everything'?s)\s+(?:fine|ok|okay|good|well|great|safe|alright|all\s+right)\b|(?:hello|hi|hey|good\s+(?:morning|night|evening)|thanks|thank\s+you|happy\s+birthday)\b)/;

function enRefused(clause: string, before: string, after: string): boolean {
  const b = before.trim();
  if (EN_NEGATED.test(b) || EN_PAST_INTENT.test(b) || EN_NOUN_BEFORE.test(b)) return true;
  if (EN_WH.test(b) || EN_WHAT.test(b) || EN_ASKING.test(b)) return true;
  if (EN_Q_START.test(clause) && !EN_REQUEST_START.test(clause)) return true;
  return EN_FRIENDLY.test(after.trim());
}

function matchEnglish(clause: string): SosMatch | null {
  if (EN_SHORT.test(clause)) return { phrase: clause.slice(0, MAX_PHRASE), lang: "en" };
  for (const re of EN_PATTERNS) {
    const m = re.exec(clause);
    if (!m) continue;
    if (enRefused(clause, clause.slice(0, m.index), clause.slice(m.index + m[0].length))) continue;
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

/**
 * not a request: -гүй (negative), past (-сан/-сэн, -лаа/-лээ, -жээ/-чээ), conditional (-бал/-вал), habitual
 * (-даг/-дэг: "бид дэлхийтэй холбогддог")
 */
function mnClosedForm(word: string): boolean {
  return (
    /гүй$/.test(word) ||
    /(?:с[аэоө]н|л[аэоө]{2}|[жч][эе]э|[бв][аэ]л|[дт][аэоө]г)$/.test(word) ||
    /^хэрэггүй/.test(word)
  );
}

/** a converb ("мэдэгдэж", "мэдэгдээд"): a request only with "өг-" after it ("мэдэгдэж өгөөрэй") */
const MN_CONVERB = /(?:ж|[аэоө]{2}д)$/;
/** words that may stand between the target and the verb ("дэлхий рүү яаралтай мэдэгд", "дэлхийд миний байдлыг хэл") */
const MN_BETWEEN =
  /^(?:яаралтай(?:гаар)?|одоо|шууд|яг|даруй|нэн|түргэн|хурдан|бушуу|бас|тэр|тэдэнд|sos|сос|тусламж|туслалцаа|хүсэлт|мэдээ|миний|манай|минь|энэ|үүнийг|тухай)$|(?:ыг|ийг)$/;
/** question words: Cosmo answers these, no SOS ("дэлхий рүү яаж холбогдох вэ") */
const MN_QWORD = /^(?:яаж|яагаад|хэрхэн|хэзээ|хаана|ямар|хэн|юу|юуг|яах|аль|хэд|хэдэн)$/;
const MN_FRIENDLY = /^(?:сайн|зүгээр|мэнд|баярлалаа|хайртай|амар|сайхан)/;

function mnNegator(word: string | undefined): boolean {
  return word === "битгий" || word === "бүү";
}

/** the request words run from `first` to the verb at `verbAt`: is it really a request? */
function mnIsRequest(w: readonly string[], first: number, verbAt: number): boolean {
  if (mnNegator(w[first - 1])) return false;
  for (let k = first; k < verbAt; k++) if (mnNegator(w[k])) return false;
  for (let k = 0; k <= verbAt; k++) if (MN_QWORD.test(w[k])) return false;

  const verb = w[verbAt];
  const n1 = w[verbAt + 1];
  const n2 = w[verbAt + 2];
  if (mnClosedForm(verb)) return false;
  if (n1 !== undefined && /^хэрэггүй/.test(n1)) return false;
  if (n2 !== undefined && /^хэрэггүй/.test(n2)) return false;
  if (MN_CONVERB.test(verb)) {
    if (n1 === undefined || !/^өг/.test(n1) || mnClosedForm(n1)) return false;
  } else if (n1 !== undefined && mnClosedForm(n1)) {
    return false;
  }
  // question particles; "хэлнэ үү" / "өгнө үү" (-на/-нэ + уу) is the polite request, "хэлэх үү" is a question
  const after = [n1, n2];
  for (let k = 0; k < after.length; k++) {
    const x = after[k];
    if (x === undefined) break;
    if (/^(?:вэ|бэ|юу|юү)$/.test(x)) return false;
    if (/^(?:уу|үү)$/.test(x) && !/н[аэоө]$/.test(k === 0 ? verb : (n1 ?? ""))) return false;
  }
  // "... сайн байна гэж хэлээрэй": a message to pass on, not an alert (unless it is "зүгээр биш")
  const quote = w.lastIndexOf("гэж", verbAt);
  if (quote !== -1) {
    const said = w.slice(Math.max(0, quote - 3), quote);
    if (said.some((x) => MN_FRIENDLY.test(x)) && !said.includes("биш")) return false;
  }
  return true;
}

/** longest message to pass on between the target and "гэж хэл" ("дэлхийд толгой өвдөж байна гэж хэлээрэй") */
const MN_MAX_QUOTE = 8;

function matchMongolianClause(w: readonly string[]): SosMatch | null {
  for (let i = 0; i < w.length; i++) {
    const len = mnTargetAt(w, i);
    if (len > 0) {
      // target then verb: right after it, after urgent words only, or after a message ending in "гэж"
      for (let j = i + len; j <= Math.min(w.length - 1, i + len + MN_MAX_QUOTE); j++) {
        if (!isMnVerb(w[j])) continue;
        const between = w.slice(i + len, j);
        const fits = between.every((x) => MN_BETWEEN.test(x)) || w[j - 1] === "гэж";
        if (!fits) continue;
        if (mnIsRequest(w, i, j)) return { phrase: w.slice(i, j + 1).join(" ").slice(0, MAX_PHRASE), lang: "mn" };
        break;
      }
      // verb right before the target ("мэдэгдээрэй дэлхийд"); not the nouns "хэл" (language) or "дохио" (signal)
      const j = i - 1;
      if (j >= 0 && isMnVerb(w[j]) && w[j] !== "хэл" && w[j] !== "дохио" && mnIsRequest(w, j, j)) {
        return { phrase: w.slice(j, i + len).join(" ").slice(0, MAX_PHRASE), lang: "mn" };
      }
    }
    // "яаралтай дохио өг" (give an emergency signal)
    if (w[i] === "яаралтай" && /^дохио/.test(w[i + 1] ?? "")) {
      const verbAt = i + 2;
      if (/^(?:өг|илгээ|дамжуул)/.test(w[verbAt] ?? "") && mnIsRequest(w, i, verbAt)) {
        return { phrase: w.slice(i, verbAt + 1).join(" "), lang: "mn" };
      }
    }
  }
  return null;
}

export function matchSosRequest(text: string): SosMatch | null {
  for (const clause of clausesOf(text)) {
    const hit = matchEnglish(clause) ?? matchMongolianClause(clause.split(" "));
    if (hit) return hit;
  }
  return null;
}
