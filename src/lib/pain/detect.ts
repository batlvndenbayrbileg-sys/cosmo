import { extractNumbers } from "../numbers/extract";
import type {
  OnsetKind,
  PainLocation,
  PainOnset,
  PainReading,
  PainRedFlag,
  PainSeverity,
  SeverityWord,
} from "./types";

/**
 * Does this utterance say that something hurts? Both languages are read whatever the check-in's language (speech
 * recognition mixes them). Rule-based and deliberately literal:
 *
 *  - pain words: hurt, pain, ache (headache, stomachache ...), sore, cramp, throbbing; өвд- (but not өвдөг, the knee),
 *    шанал-, хатгу-, базла-, хорсо-, чилээ-, хөндүүр;
 *  - refused: negations that govern the pain word ("my legs don't hurt", "no pain", "толгой өвдөхгүй", "өвдөлт
 *    байхгүй", "the pain is gone"), conditionals ("if my head hurts", "өвдвөл"), and general questions that are not
 *    about the speaker ("is chest pain common in space?", "толгой өвдөх нь хэвийн үү?"); "why does my head hurt?" is
 *    a pain statement;
 *  - each clause (split at punctuation and "but") is judged on its own, so "no chest pain, but my head hurts" is a
 *    headache and "I can't breathe and my chest hurts" is chest pain.
 *
 * The location is read in the clause the pain was found in (chest first, then the earliest place named); severity
 * (0-10 with "out of 10" / "10-аас", or words), since when, and the red-flag words (breathing trouble, fainting,
 * confusion) are read in the whole utterance. Pure, no I/O.
 */

const MAX_PHRASE = 60;

/* ───────────── clauses ───────────── */

interface Clause {
  text: string;
  /** the clause ended with a question mark */
  question: boolean;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clausesOf(text: string): Clause[] {
  const t = normalise(text);
  const out: Clause[] = [];
  const re = /([^.,!?;:…\n]+)([.,!?;:…\n]*)/g;
  for (const m of t.matchAll(re)) {
    // "... but ..." / "... гэхдээ ..." / "... харин ..." start a new clause
    const parts = m[1].split(/\s(?:but|гэхдээ|харин|however)\s/u);
    parts.forEach((p, i) => {
      const c = p.trim();
      if (c.length > 0) out.push({ text: c, question: i === parts.length - 1 && m[2].includes("?") });
    });
  }
  return out;
}

/* ───────────── English ───────────── */

const EN_PAIN =
  /\b(?:hurts?|hurting|pains?|painful|aches?|aching|ached|sore|soreness|cramps?|cramping|throbbing|stabbing|killing\s+me|(?:head|stomach|tummy|belly|back|tooth|ear)aches?)\b/g;

/**
 * the words that end a negation's reach: "I can't breathe and my chest hurts". Not "or": "no chest pain or headache"
 * denies both.
 */
const EN_SCOPE_CUT = /\b(?:and|but|so(?!\s+(?:much|bad|badly|hard|strong|severe|terrible|terribly|awful|many))|because|since|why|that|while|then|though|although|when)\b/g;
const EN_NEGATION =
  /\b(?:no|not|never|without|nothing|none|nor|neither|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|won'?t|wouldn'?t|can'?t|cannot|haven'?t|hasn'?t|hardly)\b/;
/** after the pain word: "the pain is gone", "pain-free", "doesn't hurt anymore" */
const EN_NEGATED_AFTER = /^\s*(?:-?\s*free\b|(?:is|has|have|are|was)?\s*(?:gone|went\s+away|stopped|over\b|better\s+now)|any\s?more\b|no\s+more\b)/;
/** not a pain: hurt feelings, "it's a pain to ...", "a pain in the neck", "no pain, no gain" */
const EN_EXCLUDED =
  /\bfeelings?\b|\bsore\s+loser\b|\b(?:it'?s|is|was|such|what)\s+a\s+(?:real\s+|bit\s+of\s+a\s+)?pain\b(?!\s+in\s+my\b)|\bpain\s+in\s+the\s+(?:neck|butt|ass)\b|\bno\s+pain,?\s+no\s+gain\b/;
/** "killing me" is a pain only with a body part named ("my back is killing me", never "the noise is killing me") */
const EN_IDIOM_ONLY_WITH_PLACE = /^killing/;
const EN_FIRST_PERSON = /\b(?:my|i|i'm|i've|i'd|me|mine)\b/;
const EN_QUESTION_START = /^(?:(?:hey|cosmo|so|and|but|um|uh|ok|okay|please)\s+)*(?:what|how|does|do|did|is|are|was|can|could|should|would|will|which|who|whom|where|when|why|may|might)\b/;
const EN_HYPOTHETICAL_START = /^(?:(?:hey|cosmo|so|and|but|um|uh|ok|okay|please)\s+)*(?:if|whenever|in\s+case|suppose|imagine)\b/;

function enPainAt(clause: string): { index: number; end: number; word: string } | null {
  if (EN_EXCLUDED.test(clause)) return null;
  for (const m of clause.matchAll(EN_PAIN)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    let before = clause.slice(0, index);
    // the negation must govern this pain word: only the words since the last conjunction, at most five of them
    const cuts = [...before.matchAll(EN_SCOPE_CUT)];
    if (cuts.length > 0) {
      const last = cuts[cuts.length - 1];
      before = before.slice((last.index ?? 0) + last[0].length);
    }
    const near = before.trim().split(" ").slice(-5).join(" ");
    if (EN_NEGATION.test(near)) continue;
    if (EN_NEGATED_AFTER.test(clause.slice(end))) continue;
    if (EN_IDIOM_ONLY_WITH_PLACE.test(m[0]) && enLocation(clause) === null) continue;
    return { index, end, word: m[0] };
  }
  return null;
}

/** a general question or a hypothetical, not a statement about the speaker's pain */
function enNotAStatement(c: Clause): boolean {
  if (EN_HYPOTHETICAL_START.test(c.text)) return true;
  const asks = c.question || EN_QUESTION_START.test(c.text);
  return asks && !EN_FIRST_PERSON.test(c.text);
}

const EN_LOCATIONS: ReadonlyArray<[PainLocation, RegExp]> = [
  ["chest", /\bchest\b|\bheart\b(?!\s*(?:rate|beat))|\bheartburn\b|\bribcage\b|\bsternum\b|\bbreastbone\b/],
  ["whole_body", /\b(?:whole|entire)\s+body\b|\ball\s+over\b|\beverything\s+hurts\b|\beverywhere\b|\bbody\s+(?:aches?|hurts?|is\s+(?:sore|aching))\b|\bmy\s+body\b|\bbody\s+pain\b/],
  ["eye", /\beyes?\b|\beyeballs?\b/],
  ["ear", /\bears?\b|\bearaches?\b/],
  ["tooth", /\btooth(?:aches?)?\b|\bteeth\b|\bjaw\b|\bgums?\b|\bmolars?\b/],
  ["head", /\bhead(?:aches?)?\b|\bforehead\b|\btemples?\b|\bskull\b/],
  ["throat", /\bthroat\b|\bneck\b|\bswallow\w*/],
  ["abdomen", /\bstomach(?:aches?)?\b|\bbelly(?:aches?)?\b|\babdom\w*|\btumm(?:y|ies)\b|\bgut\b|\bbowels?\b|\bpelvi\w*|\bgroin\b/],
  ["side", /\b(?:my|left|right|the)\s+side\b|\bside\s+(?:pain|hurts?|aches?)\b|\bflanks?\b|\bribs?\b|\bkidneys?\b|\bliver\b/],
  ["back", /\b(?:my|lower|upper|the)\s+back\b|\bback\s*(?:pain|aches?|hurts?)\b|\bbackaches?\b|\bspine\b/],
  ["joint", /\bjoints?\b/],
  ["arm", /\barms?\b|\bshoulders?\b|\belbows?\b|\bwrists?\b|\bhands?\b|\bfingers?\b|\bforearms?\b/],
  ["leg", /\blegs?\b|\bknees?\b|\bankles?\b|\bfoot\b|\bfeet\b|\bthighs?\b|\bcalf\b|\bcalves\b|\bshins?\b|\bhips?\b|\btoes?\b/],
];

/* ───────────── Mongolian ───────────── */

/** a pain word; "өвдөг" / "өвдгөө" is the knee (a place, see MN_LOCATIONS), not pain */
function mnPainWord(w: string): boolean {
  if (/^өвд/.test(w)) return !/^өвд(?:өг|г)/.test(w);
  return /^(?:шанал|хатгу|хатгаж|хатгаад|базла|базал|хорсо|хорсч|янгина|чилээ|чилж|хөндүүр)/.test(w);
}

/** within the next three words: "өвдөлт байхгүй", "өвдөлт алга", "өвдөөд байгаа юм алга" (nothing hurts) */
const MN_NEGATED_NEXT = /^(?:байхгүй|үгүй|биш|байгаагүй|байсангүй|больсон|арилсан|намдсан|гүй|алга)$/;
/** "толгой өвдөж байвал" (if my head hurts): the conditional on the helper verb right after the pain word */
const MN_CONDITIONAL_NEXT = /^(?:бай|болвол|болбол|бол)\p{L}*[вб][аэоө]л$/u;
const MN_CONDITIONAL = /(?:[вб][аэоө]л)$/;
const MN_QUESTION_PARTICLE = /^(?:вэ|бэ|уу|үү|юу|юү)$/;
const MN_FIRST_PERSON = /^(?:миний|минь|би|надад|намайг|өөрийн|маань)$/;

function mnPainAt(words: readonly string[], from = 0): number {
  for (let i = from; i < words.length; i++) {
    const w = words[i];
    if (!mnPainWord(w)) continue;
    if (/гүй$/.test(w)) continue; // өвдөхгүй, өвдөөгүй, өвдөлтгүй
    if (MN_CONDITIONAL.test(w)) continue; // өвдвөл
    if (words.slice(i + 1, i + 4).some((x) => MN_NEGATED_NEXT.test(x))) continue; // өвдөлт байхгүй, өвдөлт алга
    if (MN_CONDITIONAL_NEXT.test(words[i + 1] ?? "")) continue; // өвдөж байвал
    if (words[i + 1] === "бол" || words[i + 2] === "бол") continue; // өвдөх юм бол
    return i;
  }
  return -1;
}

function mnNotAStatement(c: Clause, words: readonly string[]): boolean {
  const asks = c.question || words.some((w) => MN_QUESTION_PARTICLE.test(w));
  if (!asks) return false;
  if (words.includes("яагаад")) return false;
  return !words.some((w) => MN_FIRST_PERSON.test(w));
}

const MN_LOCATIONS: ReadonlyArray<[PainLocation, RegExp]> = [
  ["chest", /^(?:цээж|зүрх)/],
  ["head", /^толгой/],
  ["eye", /^нүд/],
  ["ear", /^чих(?!эр)/],
  ["tooth", /^(?:шүд|эрүү|буйл)/],
  ["throat", /^(?:хоолой|хүзүү|залги)/],
  ["abdomen", /^(?:гэдэс|гэдс|хэвлий|ходоод|аюулхай)/],
  ["side", /^(?:хажуу|элэг|элг|бөөр|хавирга|сүв)/],
  ["back", /^(?:нуруу|бүсэлхий|ууц)/],
  ["joint", /^(?:үе|үеэ|үенүүд|үенүүдээ|үений|мөч|мөчөө)$/],
  ["arm", /^(?:гар|гараа|гарын|гарт|гарыг|гарууд|гараараа|мөр|мөрөө|мөрний|мөрөн|тохой|бугуй|хуруу|сарвуу|бугалга)/],
  ["leg", /^(?:хөл(?!өг|с|д[өо])|өвдөг|өвдг|шагай|гуя|шилбэ|тавхай|өсгий)/],
];

function mnLocation(words: readonly string[]): PainLocation | null {
  // "бүх бие", "бүх биеэр", "хаа сайгүй", "бие минь өвдөж" (when nothing else is named)
  const whole =
    words.some((w, i) => w === "бүх" && /^бие/.test(words[i + 1] ?? "")) ||
    words.some((w, i) => w === "хаа" && /^сайгүй/.test(words[i + 1] ?? ""));
  let found: { location: PainLocation; at: number } | null = null;
  for (let i = 0; i < words.length && !found; i++) {
    const w = words[i];
    for (const [location, re] of MN_LOCATIONS) {
      if (!re.test(w)) continue;
      // "зүрхний цохилт" is the heart rate, not the chest
      if (location === "chest" && /^зүрх/.test(w) && /^цохил/.test(words[i + 1] ?? "")) continue;
      // "гар" is also the verb stem "go out": only as a word of its own or with a case ending (see the pattern)
      if (location === "arm" && /^гар/.test(w) && !/^(?:гар|гараа|гарын|гарт|гарыг|гарууд|гараараа)$/.test(w)) continue;
      found = { location, at: i };
      break;
    }
  }
  const chest = words.some((w, i) => /^(?:цээж|зүрх)/.test(w) && !/^цохил/.test(words[i + 1] ?? ""));
  if (chest) return "chest";
  if (whole) return "whole_body";
  if (found) return found.location;
  if (words.some((w) => /^бие(?:э|ээ|ийн|ээр|минь|маань)?$/.test(w))) return "whole_body";
  return null;
}

function enLocation(clause: string): PainLocation | null {
  let best: { location: PainLocation; at: number } | null = null;
  for (const [location, re] of EN_LOCATIONS) {
    const m = re.exec(clause);
    if (!m) continue;
    if (location === "chest") return "chest";
    const at = m.index ?? 0;
    if (!best || at < best.at) best = { location, at };
  }
  return best?.location ?? null;
}

/** the clause cut at the scope words (and, but, so, ...), each piece with where it starts */
function enSpans(clause: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let from = 0;
  for (const m of clause.matchAll(EN_SCOPE_CUT)) {
    const at = m.index ?? 0;
    out.push({ text: clause.slice(from, at), start: from });
    from = at + m[0].length;
  }
  out.push({ text: clause.slice(from), start: from });
  return out;
}

/** the piece of the clause the pain word is in ("my head hurts" in "my head hurts and my chest is fine") */
function enOwnSpan(clause: string, at: number): string {
  const spans = enSpans(clause);
  let own = spans[0];
  for (const s of spans) if (s.start <= at) own = s;
  return own.text;
}

/**
 * Where the pain is: named next to the pain word ("my head hurts and my chest is fine" is the head), else in another
 * piece of the clause that is not denied ("my chest feels tight and it hurts" is the chest; "it hurts and I have no
 * chest pain" is not).
 */
function enPainLocation(clause: string, at: number): PainLocation | null {
  const ownText = enOwnSpan(clause, at);
  const own = enLocation(ownText);
  // the chest anywhere it is not denied: "my chest and my head hurt" is chest pain
  let best: PainLocation | null = null;
  for (const s of enSpans(clause)) {
    if (s.text !== ownText && (EN_NEGATION.test(s.text) || EN_SPAN_FINE.test(s.text))) continue;
    const loc = enLocation(s.text);
    if (loc === "chest") return "chest";
    if (loc && !best) best = loc;
  }
  return own ?? best;
}

/** a piece that says the place is fine: "my head hurts and my chest is fine" */
const EN_SPAN_FINE = /\b(?:is|are|feels?|seems?)\s+(?:fine|ok|okay|good|normal|alright|all\s+right)\b/;

/**
 * Where the pain is: the place named with the pain word at `at`, but the chest named with any pain word of the clause
 * that is not denied wins ("толгой өвдөөд цээж базлаад байна" is chest pain; "толгой өвдөөд цээж өвдөхгүй" is not).
 */
function mnPainLocation(words: readonly string[], at: number): PainLocation | null {
  for (let k = mnPainAt(words, at + 1); k >= 0; k = mnPainAt(words, k + 1)) {
    if (mnPlaceOf(words, k) === "chest") return "chest";
  }
  return mnPlaceOf(words, at);
}

/** the words that belong to the pain word at `at`: since the previous pain word, else those after it */
function mnPlaceOf(words: readonly string[], at: number): PainLocation | null {
  let start = 0;
  for (let j = at - 1; j >= 0; j--) {
    if (mnPainWord(words[j])) {
      start = j + 1;
      break;
    }
  }
  const own = mnLocation(words.slice(start, at + 1));
  if (own) return own;
  let end = words.length;
  for (let j = at + 1; j < words.length; j++) {
    if (mnPainWord(words[j])) {
      end = j;
      break;
    }
  }
  return mnLocation(words.slice(at + 1, end));
}

/**
 * The clause without its denied parts, for the first-aid guide's trigger words: "my head hurts and I don't have chest
 * pain" keeps "my head hurts", "толгой өвдөөд цээж өвдөхгүй байна" keeps "толгой өвдөөд байна" (the guides match words,
 * not meaning, so a denied "chest pain" would open the chest pain guide for a headache).
 */
function enStatedPart(clause: string, at: number): string {
  const ownText = enOwnSpan(clause, at);
  return enSpans(clause)
    .filter((s) => s.text === ownText || !(EN_NEGATION.test(s.text) || EN_SPAN_FINE.test(s.text)))
    .map((s) => s.text.trim())
    .join(" and ");
}

function mnStatedPart(words: readonly string[]): string {
  const kept: string[] = [];
  let group: string[] = [];
  for (let i = 0; i < words.length; i++) {
    group.push(words[i]);
    if (!mnPainWord(words[i])) continue;
    if (mnPainAt(words, i) === i) kept.push(...group);
    else while (MN_NEGATED_NEXT.test(words[i + 1] ?? "")) i++; // "өвдөлт байхгүй": the denial goes with it
    group = [];
  }
  kept.push(...group);
  return kept.join(" ");
}

function wordsOf(clause: string): string[] {
  return clause.split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length > 0);
}

/** the place named in these words, without any pain word ("my stomach", "гэдэс", after Cosmo asked where) */
export function readPainLocation(text: string): PainLocation | null {
  for (const c of clausesOf(text)) {
    const loc = enLocation(c.text) ?? mnLocation(wordsOf(c.text));
    if (loc) return loc;
  }
  return null;
}

/* ───────────── severity ───────────── */

const EN_SEVERITY: ReadonlyArray<[SeverityWord, RegExp]> = [
  ["mild", /\bnot\s+(?:too|that|very|so)\s+bad\b|\bnot\s+(?:too\s+)?(?:strong|severe)\b/],
  // "so much" only about the pain ("it hurts so much", never "I have so much work"); "killing me" is no rating
  ["severe", /\b(?:severe(?:ly)?|terrible|terribly|awful|unbearable|excruciating|worst|really\s+bad|very\s+bad|so\s+bad|extreme(?:ly)?|intense|(?:hurts?|hurting|aches?|aching)\s+so\s+much|so\s+much\s+pain|really\s+(?:hurts|strong)|very\s+strong)\b/],
  ["moderate", /\b(?:moderate(?:ly)?|medium|quite\s+(?:bad|a\s+bit)|pretty\s+bad|a\s+lot|fairly|bad)\b/],
  ["mild", /\b(?:a\s+(?:little|bit)|slight(?:ly)?|mild(?:ly)?|minor|a\s+tiny\s+bit)\b/],
];

const MN_SEVERITY: ReadonlyArray<[SeverityWord, RegExp]> = [
  ["severe", /(?<![\p{L}])(?:маш\s+их|маш\s+хүчтэй|хүчтэй|аймар|аймаар|тэвчихийн\s+аргагүй|тэсэхийн\s+аргагүй|тэвчихэд\s+хэцүү|ширүүн|үхэх\s+нь)(?![\p{L}])/u],
  ["moderate", /(?<![\p{L}])(?:дунд\s+зэрэг|нэлээн|нилээн|нэлээд|нилээд|их)(?![\p{L}])/u],
  ["mild", /(?<![\p{L}])(?:бага\s+зэрэг|жаахан|жоохон|жаал|бага|сул|гайгүй)(?![\p{L}])/u],
];

/** words right after a number that make it a time, not a severity */
const TIME_AFTER =
  /^\s*-?\s*(?:hours?|hrs?|h\b|minutes?|mins?|days?|weeks?|months?|years?|am\b|pm\b|o'?clock|a\.m|p\.m|цаг|минут|өдөр|өдр|хоног|долоо|сар|жил|настай)/u;
const TIME_BEFORE = /(?:\bsince|\bat|\bfor|\bafter|\bbefore|\babout\s+the|өглөө|орой)\s*$/u;
/** the scale itself: "out of 10", "/10", "10-аас", "аравнаас" */
const DENOMINATOR_BEFORE = /(?:\bout\s+of|\bof|\/)\s*$/;
const DENOMINATOR_AFTER = /^\s*-?\s*(?:аас|оос|ээс|өөс|наас|ноос)/u;
/**
 * The scale tied to this very number: "7 out of 10", "8/10", "10-аас 6", "6 оноо", "pain level 7", "rate it a 7".
 * Never a scale word elsewhere in the sentence ("my stress level is 9 and my head hurts" says nothing about the pain).
 */
const SCALE_AFTER = /^\s*(?:\/\s*(?:10|ten)\b|(?:out\s+of|of)\s+(?:10|ten)\b|оноо)/u;
const SCALE_BEFORE =
  /(?:(?:10|арав)\s*-?\s*(?:аас|наас)\s*|\b(?:pain|ache|hurts?)\s+(?:(?:level|score|rating)\s+)?(?:is\s+|at\s+|of\s+)?(?:a\s+|about\s+|around\s+)?|\brate\s+it\s+(?:a\s+|at\s+)?|(?:өвдөлт\p{L}*)\s+)$/u;

function severityValue(t: string, bare: boolean): number | null {
  for (const n of extractNumbers(t)) {
    if (!Number.isInteger(n.value) || n.value < 0 || n.value > 10) continue;
    const before = t.slice(0, n.start);
    const after = t.slice(n.end);
    if (TIME_AFTER.test(after) || TIME_BEFORE.test(before)) continue;
    if (DENOMINATOR_BEFORE.test(before) || DENOMINATOR_AFTER.test(after)) continue;
    if (!bare && !SCALE_AFTER.test(after) && !SCALE_BEFORE.test(before)) continue;
    return n.value;
  }
  return null;
}

function severityWord(t: string): SeverityWord | null {
  for (const [w, re] of EN_SEVERITY) if (re.test(t)) return w;
  for (const [w, re] of MN_SEVERITY) if (re.test(t)) return w;
  return null;
}

/**
 * How strong the pain is. `bare`: a plain number 0-10 counts (Cosmo just asked "how strong, from 0 to 10?");
 * otherwise a number counts only with the scale tied to it ("7 out of 10", "10-аас 7", "pain level 7"). Words count
 * either way; `wordsIn` limits them to the words about the pain (detectPain: "I feel awful, my head hurts" rates
 * nothing, "my head hurts so much" is severe).
 */
export function readPainSeverity(text: string, opts: { bare?: boolean; wordsIn?: string } = {}): PainSeverity | null {
  const t = normalise(text);
  const value = severityValue(t, opts.bare === true);
  const word = severityWord(opts.wordsIn === undefined ? t : normalise(opts.wordsIn));
  if (value === null && word === null) return null;
  return { value, word };
}

/* ───────────── since when ───────────── */

const EN_COUNT = String.raw`(\d+(?:[.,]\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|a\s+few|few|a\s+couple(?:\s+of)?|couple(?:\s+of)?|several)`;
const EN_COUNT_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

function enCount(raw: string): number | null {
  const r = raw.replace(/\s+/g, " ").trim();
  if (/^\d/.test(r)) return Number(r.replace(",", "."));
  return EN_COUNT_WORDS[r] ?? null;
}

/** a span of time only counts as "since when" with since / ago / for / past / last around it */
const EN_SPAN = (unit: string) =>
  new RegExp(String.raw`\b(?:for|since|past|last|over)\s+(?:the\s+)?(?:last\s+|past\s+)?(?:about\s+|around\s+|almost\s+|nearly\s+)?${EN_COUNT}\s+${unit}\b|\b${EN_COUNT}\s+${unit}\s+(?:ago|now|already)\b`);

const EN_ONSET: ReadonlyArray<[OnsetKind, RegExp]> = [
  ["just_now", /\b(?:just\s+now|a\s+moment\s+ago|just\s+(?:started|began|happened)|all\s+of\s+a\s+sudden|suddenly|out\s+of\s+nowhere)\b/],
  ["this_morning", /\b(?:this\s+morning|since\s+(?:the\s+)?morning|since\s+i\s+woke(?:\s+up)?|when\s+i\s+woke(?:\s+up)?|since\s+waking(?:\s+up)?)\b/],
  ["last_night", /\b(?:last\s+night|overnight|during\s+the\s+night|since\s+(?:the\s+)?night|in\s+the\s+night)\b/],
  ["yesterday", /\byesterday\b/],
  ["today", /\b(?:today|this\s+afternoon|this\s+evening|since\s+(?:lunch|breakfast|dinner|the\s+afternoon))\b/],
];

const EN_SPANS: ReadonlyArray<[OnsetKind, RegExp]> = [
  ["weeks", EN_SPAN(String.raw`weeks?`)],
  ["days", EN_SPAN(String.raw`days?`)],
  ["hours", EN_SPAN(String.raw`(?:hours?|hrs?)`)],
  ["minutes", EN_SPAN(String.raw`(?:minutes?|mins?)`)],
];

const MN_ONSET: ReadonlyArray<[OnsetKind, RegExp]> = [
  ["just_now", /(?<![\p{L}])(?:саяхан|дөнгөж|гэнэт|гэнэтхэн)(?![\p{L}])/u],
  ["this_morning", /(?<![\p{L}])(?:өглөө\p{L}*|сэрсн\p{L}*|сэрэхэд|босохоос|боссоноос)(?![\p{L}])/u],
  ["last_night", /(?<![\p{L}])(?:шөнө\p{L}*|өнгөрсөн\s+шөнө)(?![\p{L}])/u],
  ["yesterday", /(?<![\p{L}])өчигд(?:ө|р)\p{L}*(?![\p{L}])/u],
  ["today", /(?<![\p{L}])(?:өнөөдөр\p{L}*|үдээс|үдийн\s+хоолноос|оройноос|өдөр\s+дундаас)(?![\p{L}])/u],
];

/** "2 цагийн өмнө", "хоёр цаг болж байна", "3 хоногийн турш", "хэдэн цаг" */
const MN_SPAN_CONTEXT = /(?:өмнө|өмнөөс|турш|болж|болох|болоод|гаруй|хойш|орчим|үргэлжил)/u;
const MN_SPANS: ReadonlyArray<[OnsetKind, RegExp]> = [
  ["weeks", /(?<![\p{L}])долоо\s+хоног\p{L}*/u],
  ["days", /(?<![\p{L}])(?:хоног|өдөр|өдр)\p{L}*/u],
  ["hours", /(?<![\p{L}])цаг(?!аас)\p{L}*/u],
  ["minutes", /(?<![\p{L}])минут\p{L}*/u],
];

function amountBefore(t: string, at: number): number | null {
  const nums = extractNumbers(t.slice(0, at)).filter((n) => t.slice(n.end, at).trim().length <= 1);
  const last = nums[nums.length - 1];
  return last ? last.value : null;
}

/** since when the pain is there, or null when the words do not say */
export function readPainOnset(text: string): PainOnset | null {
  const t = normalise(text);
  if (/\bhalf\s+an\s+hour\b/.test(t)) return { kind: "minutes", amount: 30 };
  for (const [kind, re] of EN_SPANS) {
    const m = re.exec(t);
    if (m) return { kind, amount: enCount(m[1] ?? m[2] ?? "") };
  }
  for (const [kind, re] of EN_ONSET) if (re.test(t)) return { kind, amount: null };

  if (MN_SPAN_CONTEXT.test(t) || /хэд(?:эн)?\s+(?:цаг|хоног|өдөр|минут)/u.test(t)) {
    for (const [kind, re] of MN_SPANS) {
      const m = re.exec(t);
      if (!m) continue;
      const at = m.index ?? 0;
      const before = t.slice(0, at);
      // "долоо хоног" is a week: its "долоо" is not seven days
      if (kind === "days" && /долоо\s+$/u.test(before)) continue;
      return { kind, amount: /хэд(?:эн)?\s*$/u.test(before) ? null : amountBefore(t, at) };
    }
  }
  for (const [kind, re] of MN_ONSET) if (re.test(t)) return { kind, amount: null };
  return null;
}

/* ───────────── red-flag words ───────────── */

const RED_FLAG_WORDS: ReadonlyArray<[Exclude<PainRedFlag, "chest" | "severe" | "danger_vital">, RegExp]> = [
  [
    "breathing",
    /\b(?:can'?t|cannot|can\s+not|hard\s+to|struggling\s+to|trouble|difficulty|problems?)\s+(?:breathe|breathing|catch\s+my\s+breath)\b|\bshort(?:ness)?\s+of\s+breath\b|\bbreathless\b|\bout\s+of\s+breath\b|амьсгал\s*(?:давч|давс|бооцо|боогд|хүрэхгүй|авч\s+чадахгүй)|амьсгаад|амьсгалахад\s+хэцүү|амьсгалж\s+чадахгүй/u,
  ],
  [
    "fainting",
    /\b(?:faint(?:ed|ing)?|passed\s+out|pass\s+out|blacked\s+out|black\s+out|losing\s+consciousness|lost\s+consciousness)\b|ухаан\s*(?:алд|бал)|муужир/u,
  ],
  [
    "confusion",
    /\b(?:confused|confusion|disoriented|can'?t\s+think\s+straight|slurr\w*|can'?t\s+speak|can'?t\s+remember\s+where)\b|будил|төөрөлд|хэл\s+ээдэр|ярьж\s+чадахгүй/u,
  ],
];

/** "no trouble breathing", "I'm not confused": a negation right before the words */
const FLAG_NEGATED_BEFORE = /\b(?:no|not|never|without|n't)\s+(?:\w+\s+){0,1}$/;

function redFlagWords(text: string): PainRedFlag[] {
  const t = normalise(text);
  const out: PainRedFlag[] = [];
  for (const [flag, re] of RED_FLAG_WORDS) {
    const m = re.exec(t);
    if (!m) continue;
    const before = t.slice(0, m.index ?? 0);
    const after = t.slice((m.index ?? 0) + m[0].length);
    if (FLAG_NEGATED_BEFORE.test(before)) continue;
    // Mongolian: "амьсгал давчдахгүй", "ухаан алдаагүй"
    if (/^\p{L}*гүй/u.test(after) || /^\s*(?:байхгүй|үгүй)/u.test(after)) continue;
    out.push(flag);
  }
  return out;
}

/** severe enough to count as a red flag: 8 or more out of 10, or said to be severe */
export function isSeverePain(severity: PainSeverity | null): boolean {
  if (!severity) return false;
  if (severity.value !== null) return severity.value >= 8;
  return severity.word === "severe";
}

/** the red flags of a reading: chest, severe, and the breathing / fainting / confusion words of the whole utterance */
export function painRedFlags(location: PainLocation | null, severity: PainSeverity | null, text: string): PainRedFlag[] {
  const out: PainRedFlag[] = [];
  if (location === "chest") out.push("chest");
  if (isSeverePain(severity)) out.push("severe");
  for (const f of redFlagWords(text)) if (!out.includes(f)) out.push(f);
  return out;
}

/* ───────────── the reading ───────────── */

/** the clause right after the pain says it is over ("but it's gone now", "it's better now") */
const EN_RESOLVED =
  /^(?:(?:and|so|but)\s+)?(?:now\s+)?(?:it'?s|it\s+is|it\s+has|it|that'?s|the\s+pain\s+(?:is|has)|the\s+pain)\s+(?:all\s+)?(?:now\s+)?(?:gone|over|passed|stopped|went\s+away|better\s+now|fine\s+now|ok(?:ay)?\s+now)\b/;
/** "одоо зүгээр", "одоо гайгүй", "арилсан", "намдсан" as the whole next clause */
const MN_RESOLVED =
  /^(?:одоо\s+)?(?:(?:өвдөлт\p{L}*|бүр)\s+)?(?:одоо\s+)?(?:зүгээр|гайгүй|дажгүй|дээрдсэн|арилсан|арилчихсан|намдсан|намдчихсан|өнгөрсөн)(?:\s+(?:болсон|байна|ээ|дээ))?$/u;

/**
 * The pain stated in these words, or null when nothing is said to hurt (or only denied, asked about in general, or
 * imagined). See the file comment for the rules.
 */
export function detectPain(text: string): PainReading | null {
  const clauses = clausesOf(text);
  for (let ci = 0; ci < clauses.length; ci++) {
    const c = clauses[ci];
    const en = enNotAStatement(c) ? null : enPainAt(c.text);
    const words = wordsOf(c.text);
    const mnAt = en ? -1 : mnNotAStatement(c, words) ? -1 : mnPainAt(words);
    if (!en && mnAt < 0) continue;
    // "I had a headache yesterday, but it's gone now", "толгой өвдөж байсан, одоо зүгээр": over already
    const next = clauses[ci + 1]?.text ?? "";
    if (EN_RESOLVED.test(next) || MN_RESOLVED.test(next)) continue;
    const location = en ? enPainLocation(c.text, en.index) : mnPainLocation(words, mnAt);
    // severity words about this pain only; a 0-10 with its scale anywhere in the utterance
    const scope = en ? enOwnSpan(c.text, en.index) : words.slice(Math.max(0, mnAt - 3), mnAt + 3).join(" ");
    const severity = readPainSeverity(text, { wordsIn: scope });
    const onset = readPainOnset(text);
    let phrase: string;
    if (en) {
      // the location words and the pain word, as heard ("chest hurts", "pain in my chest")
      phrase = c.text.slice(Math.max(0, en.index - 24), en.end + 14).trim();
    } else {
      phrase = words.slice(Math.max(0, mnAt - 2), mnAt + 1).join(" ");
    }
    return {
      location,
      severity,
      onset,
      redFlags: painRedFlags(location, severity, text),
      clause: en ? enStatedPart(c.text, en.index) : mnStatedPart(words),
      phrase: phrase.slice(0, MAX_PHRASE),
    };
  }
  return null;
}
