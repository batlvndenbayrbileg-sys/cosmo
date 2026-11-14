import type { Lang } from "@/lib/types";
import { findCrisisWords, findSeriousWords } from "@/lib/health/flags";
import type { CrisisKind, MachineCtx } from "./machine";

/**
 * Friend mode (team feedback 2026-11-15: "if the person says 'can I talk with you?', be like a psychologist or a
 * friend, answer and talk with them, be their friend").
 *
 * At ANY point of the check-in (small talk, in the middle of the measurements, at the read-back, or on the dashboard
 * after it) the astronaut may ask to talk or say how they feel. Cosmo then listens: warm, short replies, one gentle
 * question, practical self-care ideas for life on a station. Nothing is recorded and nothing counts as a failed answer;
 * the check-in waits exactly where it was and resumes when the astronaut says they are ready.
 *
 * This module is pure (no I/O): recognising a request to talk, a feeling, a wish to go on and crisis words; the offline
 * replies in both languages; and the sanity check for wording written by the live model. turn.ts runs it.
 *
 * Safety (non-negotiable, with and without the model): never a diagnosis, a drug or a dose. Crisis words (self-harm,
 * suicide, wanting to die, harming others - and, while talking, a medical emergency) always get the code-written crisis
 * reply, never model wording, and the turn raises a red alert for the crew medical officer and ground.
 */

/* ───────────── recognising what was said ───────────── */

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** an explicit request to talk ("can I talk to you?", "чамтай ярилцаж болох уу") */
const REQUEST_EN: RegExp[] = [
  /\b(?:can|could|may)\s+i\s+(?:please\s+)?(?:just\s+)?(?:talk|speak|chat)\s+(?:to|with)\s+you\b/u,
  /\bi\s+(?:really\s+|just\s+)?(?:need|want|would\s+like|'d\s+like|wanna)\s+to\s+(?:talk|speak|chat)\b/u,
  /\bcan\s+we\s+(?:just\s+)?(?:talk|chat)\s*(?:for\s+a\s+(?:bit|minute|moment|while)|a\s+(?:bit|little))?\s*[?.!]*$/u,
  /\b(?:i\s+need|i'?d\s+like|i\s+want)\s+(?:some\s+)?(?:emotional\s+|mental\s+|moral\s+)?support\b/u,
  /\bi\s+need\s+(?:someone|somebody|a\s+friend)\s*(?:to\s+(?:talk|listen)\s+(?:to|with))?/u,
  /\b(?:please\s+)?(?:just\s+)?(?:talk|listen)\s+to\s+me\b/u,
  /\b(?:be|can\s+you\s+be)\s+my\s+friend\b/u,
  /\b(?:something|a\s+lot)\s+on\s+my\s+mind\b/u,
  /\bfeel\s+like\s+talking\b/u,
];

const REQUEST_MN: RegExp[] = [
  /(?:чамтай|тантай|надтай|космотой|cosmo-той|cosmo-тай)\s+(?:жаахан\s+|бага\s+зэрэг\s+|хэсэг\s+)?(?:ярилц|ярь|ярих|яриач|ярихгүй\s+юу)/u,
  /ярилцмаар|ярьмаар|ярилцах\s+хүн|ярих\s+хүн|ярилцаач/u,
  /сэтгэл\s+санааны\s+(?:дэмжлэг|тусламж)|дэмжлэг\s+хэрэгтэй|дэмжээч/u,
  /(?:намайг\s+)?сонсооч|сонсох\s+хүн/u,
  /найз\s+(?:хэрэгтэй|болооч|минь\s+болооч|болж\s+өгөөч)/u,
  /хуваалцмаар|сэтгэлээ\s+уудл|ярих\s+(?:юм|зүйл)\s+байна/u,
];

const INTENSIFIERS =
  "(?:so|really|very|a\\s+bit|a\\s+little|kind\\s+of|kinda|quite|pretty|super|too|extremely|bit|little|terribly|incredibly|more|also|just|totally)";

/** "I feel lonely / stressed / anxious / homesick / sad"; a negation in front ("not", "don't") does not count */
const FEELING_EN = new RegExp(
  `(?<!\\bnot\\s)(?<!n't\\s)\\b(?:i\\s*'?m|i\\s+am|i\\s+feel|i'?m\\s+feeling|i\\s+am\\s+feeling|i'?ve\\s+been(?:\\s+feeling)?|i\\s+have\\s+been(?:\\s+feeling)?|feeling|i\\s+get|i'?m\\s+getting)\\s+(?:${INTENSIFIERS}\\s+)*(?:lonely|isolated|stressed(?:\\s+out)?|anxious|nervous|worried|scared|afraid|frightened|homesick|sad|depressed|overwhelmed|upset|miserable|hopeless|blue|frustrated|burn(?:ed|t)\\s+out|heartbroken)\\b`,
  "u",
);

/**
 * "down" is a feeling after "feel" ("I'm feeling down", "I feel a bit down") or with a word of degree ("I'm so down"),
 * never the bare slang "I'm down" (= "I'm in").
 */
const FEELING_DOWN_EN = new RegExp(
  `(?<!\\bnot\\s)(?<!n't\\s)\\b(?:(?:i\\s+feel|i'?m\\s+feeling|i\\s+am\\s+feeling|i'?ve\\s+been\\s+feeling|i\\s+have\\s+been\\s+feeling|feeling)\\s+(?:${INTENSIFIERS}\\s+)*|(?:i\\s*'?m|i\\s+am|i'?ve\\s+been)\\s+(?:${INTENSIFIERS}\\s+)+)down\\b(?!\\s+(?:for|to|with)\\b)`,
  "u",
);

const FEELING_EN_EXTRA: RegExp[] = [
  FEELING_DOWN_EN,
  /\bi\s+miss\s+(?:my\s+)?(?:family|home|wife|husband|partner|kids|children|son|daughter|mom|mum|mother|dad|father|parents|friends|earth|everyone)\b/u,
  /\bi'?m\s+not\s+(?:ok(?:ay)?|doing\s+(?:well|great|ok(?:ay)?|good))\b/u,
  /\b(?:i'?m|i\s+am)\s+struggling\b/u,
  /\bi\s+feel\s+(?:so\s+|very\s+|really\s+|completely\s+)?alone\b/u,
  /\bhaving\s+a\s+(?:hard|tough|rough|difficult)\s+(?:time|day|week)\b/u,
];

/**
 * Mongolian feelings. A negation does not count (feelingMn checks every match): the word ending in "-гүй"
 * ("стрессдсэнгүй", "санаа зовсонгүй", "ганцаардсангүй") or a following "биш" / "бус" ("стресстэй биш").
 */
const FEELING_MN: RegExp[] = [
  /стресс(?:тэй|дэж|дсэн|дээд|д\s+орс|д\s+ор)/u,
  /ганцаард(?:аж|сан|маар|ах\s+юм|ах\s+шиг)|ганцаараа\s+(?:байгаа\s+юм\s+шиг|үлдсэн\s+юм\s+шиг)/u,
  /уйтгар(?:тай|лаж|ласан|ална)/u,
  /санаа\s+зов(?:ж|оод|сон|ниж)|санаа\s+зовнил/u,
  /сэтгэл\s+(?:гутар|гонсго|тавгүй|хямр|унаа|унасан|муу|санаа\s+муу|хөдлөөд|шаналж)/u,
  /сэтгэлээр\s+унаа|сэтгэлээр\s+унасан/u,
  /гуниг(?:тай|лаж|ласан)(?!\s+(?:биш|бус))/u,
  /түгш(?:иж|сэн|үүртэй)(?!\s+(?:биш|бус))/u,
  /айж\s+байна|айгаад\s+байна/u,
  /(?:гэрээ|гэр\s+бүлээ|ээжийгээ|аавыгаа|хүүхдүүдээ|хүүхдээ|эхнэрээ|нөхрөө|найзуудаа|дэлхийгээ|гэрийнхнээ)\s+(?:их\s+)?(?:санаж|үгүйлж|санагдаж)/u,
  // "it is hard" as a feeling ("надад хэцүү байна"), not "hard to say / to measure" ("хэлэхэд хэцүү байна")
  /(?<!(?:хад|хэд|ход|хөд)\s+)(?:хэцүү\s+байна|хэцүү\s+байгаа|амаргүй\s+байна)|дарамттай\s+байна|дарамт\s+их/u,
];

/** a match of a Mongolian feeling that is negated: its word ends in "-гүй", or the next word is "биш" / "бус" */
function negatedAt(t: string, end: number): boolean {
  const m = /^(\p{L}*)[\s,]*(\p{L}*)/u.exec(t.slice(end));
  const tail = m?.[1] ?? "";
  const next = m?.[2] ?? "";
  return /гүй$/u.test(tail) || /^(?:биш|бус)$/u.test(next);
}

function feelingMn(t: string): boolean {
  for (const re of FEELING_MN) {
    for (const m of t.matchAll(new RegExp(re.source, "gu"))) {
      if (!negatedAt(t, (m.index ?? 0) + m[0].length)) return true;
    }
  }
  return false;
}

/**
 * What the check-in asks about: "can we talk about my blood pressure", "I'm worried about my sleep, how many hours
 * should I get?" are about the check-in, not a request to talk as friends. The families of interpret.ts.
 */
const TOPIC_WORDS =
  /\b(?:results?|dashboard|scores?|readings?|status|blood|pressure|pulse|heart\s+rate|glucose|sugar|temperature|fever|water|hydrat\w*|drink\w*|exercise|workout|vision|eyes?|eyesight|blurr\w*|workload|summary|measurements?|sleep\w*|slept|mood|symptoms?|headaches?|dizz\w*|nause\w*|red|green|amber)\b|үр\s+дүн|самбар|даралт|пульс|зүрхний\s+цохилт|сахар|температур|халуун|(?<![\p{L}])ус(?:ны|аа|ыг|ан)?(?![\p{L}])|дасгал|хараа|(?<![\p{L}])нүд|ачаалал|хэмжилт|унт|нойр|сэтгэл\s+санааны\s+(?:оноо|үнэлгээ|асуулт)|толгой|шинж\s+тэмдэг|эргэ(?:ж|лт)|дотор\s+муухайр/u;

/** a request phrased as talking ABOUT a check-in topic ("can I talk to you about my sleep?") */
const ABOUT_RE = /\babout\b|(?<![\p{L}])(?:талаар|тухай)(?![\p{L}])/u;

/** a question ("what should it be?", "хэд байх ёстой вэ?") */
const QUESTION_RE = /[?？]|\b(?:what|why|how|should|is\s+it|is\s+that)\b|(?<![\p{L}])(?:вэ|бэ|уу|үү|юу|хэд|хэдэн)(?![\p{L}])/u;

export type CompanionEntry = "request" | "feeling";

/** Is this a request to talk, or a feeling shared? Null for everything else (answers, numbers, "I'm fine", "тийм"). */
export function detectCompanionRequest(text: string): CompanionEntry | null {
  const t = normalise(text);
  if (t.length === 0) return null;
  const aboutTopic = TOPIC_WORDS.test(t);
  // "I can't sleep, can I talk to you?" is a request; "can I talk to you about my sleep?" is about the check-in
  if (!(aboutTopic && ABOUT_RE.test(t)) && [...REQUEST_EN, ...REQUEST_MN].some((re) => re.test(t))) return "request";
  // "I'm worried about my blood pressure, what should it be?" is a question about the check-in (questions.ts)
  if (aboutTopic && QUESTION_RE.test(t)) return null;
  if (FEELING_EN.test(t) || FEELING_EN_EXTRA.some((re) => re.test(t)) || feelingMn(t)) return "feeling";
  return null;
}

/** what "back to ..." may resume ("back to it", never "back home" or "back to it all") */
const RESUME_TARGET = "(?:the\\s+|my\\s+)?(?:check[\\s-]?in|questions?|measurements?|dashboard|results?|it(?!\\s+all))";

const EXIT_EN: RegExp[] = [
  new RegExp(
    `\\b(?:let'?s|lets|we\\s+can|can\\s+we|shall\\s+we|i\\s+want\\s+to|i'?d\\s+like\\s+to)\\s+(?:now\\s+)?(?:continue|go\\s+on|carry\\s+on|move\\s+on|resume|keep\\s+going|finish|get\\s+on|(?:get|go)\\s+back\\s+to\\s+${RESUME_TARGET})\\b`,
    "u",
  ),
  new RegExp(`\\b(?:back|return)\\s+to\\s+${RESUME_TARGET}\\b`, "u"),
  // a bare "continue", "go on", "next question", "ok, next"
  /^(?:ok(?:ay)?|alright|all\s+right|sure|yes|yeah|well|so|right)?[\s,.!]*(?:please\s+)?(?:continue|go\s+on|carry\s+on|move\s+on|keep\s+going|next(?:\s+(?:question|one|please))?|let'?s\s+go)[\s,.!]*(?:please)?[\s,.!]*$/u,
  // "I'm fine", "ok", "I'm good thanks"
  /^(?:(?:i'?m|i\s+am)\s+(?:fine|ok(?:ay)?|good|alright|all\s+right)|ok(?:ay)?|alright)(?:\s+now)?[\s,.!]*(?:thanks?|thank\s+you)?[\s,.!]*$/u,
  /\b(?:continue|resume|finish)\s+(?:the\s+|my\s+)?(?:check[\s-]?in|questions?|measurements?)\b/u,
  /\b(?:i'?m|i\s+am|i\s+feel)\s+(?:a\s+(?:bit|little|lot)\s+|much\s+|way\s+)?(?:good|ok(?:ay)?|fine|better|ready|alright|all\s+right)\s+now\b/u,
  /\b(?:i'?m|i\s+am)\s+ready(?!\s+to\s+(?:talk|tell|share|open|chat|speak))\b/u,
  /\bi\s+feel\s+(?:a\s+(?:bit|little|lot)\s+|much\s+)?better\b/u,
  /\b(?:that|this|you|it)\s+(?:really\s+)?helped\b/u,
  /^(?:ok(?:ay)?|alright|sure|yes|yeah|well)?[\s,.!]*(?:thanks?|thank\s+you)(?:\s+(?:so\s+much|a\s+lot))?[\s,.!]*(?:cosmo)?[\s,.!]*(?:(?:i'?m|i\s+am|that'?s|it'?s|i\s+feel)\s+(?:good|ok(?:ay)?|fine|better|alright|all\s+right|enough|better\s+now|good\s+now))?[\s.!]*$/u,
];

const EXIT_MN: RegExp[] = [
  /үргэлжлүүл(?:ье|ъе|үүлье|я|ъя|ж\s+болно|эх\s+үү|чих|ээрэй|ээч|нэ(?![\p{L}]))/u,
  /(?:шалгалт|асуулт|хэмжилт|самбар)(?:аа|ээ|руугаа|руу|ынхаа)?\s+(?:руу\s+)?(?:үргэлжлүүл|буц)/u,
  /дараагийн\s+асуулт|(?<![\p{L}])дараагийнх(?![\p{L}])/u,
  // "let's go back" to the check-in, never "гэртээ буцъя" (let's go home)
  /(?<!(?:гэр|гэртээ|гэрлүүгээ|гэр\s+лүүгээ|дэлхий|дэлхийрүү|дэлхий\s+рүү|дэлхий\s+рүүгээ)\s+)(?:буцъя|буцая)/u,
  // "better now" / "it helped" - never the negative past "дээрдсэнгүй" (not better), "тус болсонгүй" (did not help)
  /(?:одоо\s+)?(?:зүгээр|гайгүй|дажгүй|сайн)\s+боллоо|дээрдлээ|дээрдсэн(?!гүй)|тус\s+боллоо|тус\s+болсон(?!гүй)|бэлэн\s+боллоо/u,
  // "бэлэн байна" (I'm ready), but not "ready to talk" ("ярихад бэлэн байна")
  /(?<!(?:ярихад|ярилцахад|хэлэхэд|хуваалцахад)\s+)бэлэн\s+байна/u,
  /^(?:за|зүгээр|тийм|за\s+тэгье)?[\s,.!]*(?:болсон|боллоо|баярлалаа|их\s+баярлалаа|маш\s+их\s+баярлалаа)[\s,.!]*(?:болсон|боллоо|баярлалаа|cosmo|космо)?[\s.!]*$/u,
  // a bare "зүгээр ээ" (I'm fine), "за" (ok)
  /^(?:зүгээр(?:\s+(?:ээ|дээ|байна))?|за|за\s+тэгье|ок|гайгүй(?:\s+ээ)?)[\s,.!]*(?:баярлалаа)?[\s.!]*$/u,
];

/** a negation in the clause ("I don't think I'm ready to go back to the check-in") */
const NEGATION_EN = /\b(?:not|no|never|don'?t|doesn'?t|didn'?t|can'?t|cannot|won'?t|isn'?t|aren'?t|wasn'?t)\b/u;

/** the clause of `t` around [start, end): from the last , . ; ! ? or "but" before it to the next one after it */
function clauseAround(t: string, start: number, end: number): string {
  const before = t.slice(0, start);
  const cut = Math.max(before.search(/[,.;!?](?!.*[,.;!?])/u), before.lastIndexOf(" but "));
  const after = t.slice(end).search(/[,.;!?]|\sbut\s/u);
  return t.slice(cut < 0 ? 0 : cut + 1, after < 0 ? t.length : end + after);
}

/** "let's continue", "thanks, I'm good", "за одоо үргэлжлүүлье", "болсон, баярлалаа" */
export function detectCompanionExit(text: string): boolean {
  const t = normalise(text);
  if (t.length === 0) return false;
  for (const re of EXIT_EN) {
    const m = re.exec(t);
    if (m && !NEGATION_EN.test(clauseAround(t, m.index, m.index + m[0].length))) return true;
  }
  return EXIT_MN.some((re) => re.test(t));
}

/** crisis words in this utterance; medical-emergency words count only inside (or on entering) a companion conversation */
export function detectCrisis(text: string, talking: boolean): CrisisKind | null {
  if (findCrisisWords(text).length > 0) return "self";
  if (talking && findSeriousWords(text).length > 0) return "medical";
  return null;
}

export type CompanionPlan =
  | { kind: "crisis"; crisis: CrisisKind }
  | { kind: "enter"; entry: CompanionEntry }
  | { kind: "stay" }
  | { kind: "leave" }
  /** while talking, a plain answer to the open question: friend mode ends and the answer is recorded as usual */
  | { kind: "answer" };

/**
 * A plain answer while talking ("7 hours", "98", "I slept about 7 hours"), not a story that happens to hold a number
 * ("I have 3 kids back home"): short, or naming the check-in topic, and neither a request to talk nor a feeling.
 */
function isPlainAnswer(text: string): boolean {
  const t = normalise(text);
  if (detectCompanionRequest(t) !== null) return false;
  const words = t.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return words <= 4 || TOPIC_WORDS.test(t);
}

/**
 * What this turn is for friend mode, or null for an ordinary check-in turn.
 *  - crisis words always win (self-harm / harming others in any state; a medical emergency while talking);
 *  - while talking: "let's continue" leaves; a plain answer to the open question during the measurements
 *    (`answersOpen`) leaves and is recorded ("answer"); anything else is one more turn of the conversation;
 *  - otherwise a request to talk enters unless the words answer the open question ("сонсооч, би 7 цаг унтсан" is a
 *    sleep answer); a feeling enters unless the words carry a digit, answer the open question ("I feel down" to the
 *    mood question is mood 2) or say yes to what was asked (`agrees`: "yes let's start, I'm a bit nervous").
 * SUMMARY is never interrupted (it only finishes the summary).
 */
export function planCompanion(
  ctx: Pick<MachineCtx, "state" | "companion"> & Partial<Pick<MachineCtx, "companionCrisis">>,
  text: string,
  answersOpen: boolean,
  agrees = false,
): CompanionPlan | null {
  if (ctx.state === "SUMMARY") return null;
  const entry = ctx.companion ? null : detectCompanionRequest(text);
  const crisis = detectCrisis(text, ctx.companion || entry !== null);
  if (crisis) return { kind: "crisis", crisis };
  if (ctx.companion) {
    if (detectCompanionExit(text)) return { kind: "leave" };
    if (ctx.state === "KPI_CAPTURE" && answersOpen && !ctx.companionCrisis && isPlainAnswer(text)) return { kind: "answer" };
    return { kind: "stay" };
  }
  // an explicit request to talk wins over a reading that only found a vague word ("их стресстэй" read as workload 4);
  // it yields only to a concrete value in the same words ("сонсооч, би 7 цаг унтсан", "listen, I slept seven hours")
  if (entry === "request" && !(answersOpen && carriesNumber(text))) return { kind: "enter", entry };
  if (entry === "feeling" && !/\d/u.test(text) && !answersOpen && !agrees) return { kind: "enter", entry };
  return null;
}

const NUMBER_WORD_RE =
  /(?<![\p{L}])(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|тэг|нэг|хоёр|гурав|гурван|дөрөв|дөрвөн|тав|таван|зургаа|зургаан|долоо|долоон|найм|найман|ес|есөн|арав|арван|хорь|хорин|гуч|гучин|дөч|дөчин|тавь|тавин|жар|жаран|дал|далан|ная|наян|ер|ерэн|зуу|зуун|хагас)(?![\p{L}])/iu;

/** the words carry a number (digits or a number word), i.e. a concrete answer rather than a vague one */
function carriesNumber(text: string): boolean {
  return /\d/u.test(text) || NUMBER_WORD_RE.test(text);
}

/* ───────────── offline replies (no model) ───────────── */

export type CompanionTopic = "lonely" | "stressed" | "anxious" | "homesick" | "sad" | "general";

const TOPIC_PATTERNS: ReadonlyArray<readonly [CompanionTopic, RegExp]> = [
  ["homesick", /homesick|\bmiss\s+(?:my\s+)?(?:family|home|wife|husband|partner|kids|children|son|daughter|mom|mum|mother|dad|father|parents|friends|earth|everyone)|гэрээ\s+(?:их\s+)?(?:санаж|үгүйлж)|гэр\s+бүлээ|ээжийгээ|аавыгаа|хүүхд|эхнэрээ|нөхрөө|дэлхийгээ|гэрийнхнээ/u],
  ["lonely", /lonely|\balone\b|isolated|ганцаард|ганцаараа/u],
  ["stressed", /stress|overwhelm|burn(?:ed|t)\s+out|стресс|дарамт|ачаалал/u],
  ["anxious", /anxious|nervous|worried|scared|afraid|frightened|санаа\s+зов|түгш|айж|айгаад/u],
  ["sad", /\bsad\b|\bdown\b|depressed|miserable|hopeless|\bblue\b|upset|empty|гуниг|уйтгар|сэтгэл\s+(?:гутар|гонсго|тавгүй|хямр|унаа|муу)|сэтгэлээр\s+унаа/u],
];

export function companionTopic(text: string): CompanionTopic {
  const t = normalise(text);
  for (const [topic, re] of TOPIC_PATTERNS) if (re.test(t)) return topic;
  return "general";
}

const WELCOME: Record<Lang, Record<CompanionTopic, string>> = {
  en: {
    general: "Of course, I'm right here and I'm listening. What's on your mind?",
    lonely: "Feeling lonely up there is really hard, and I'm glad you told me. What has been making you feel most alone?",
    stressed: "That sounds like a lot to carry, and it makes sense to feel stressed. What's weighing on you most right now?",
    anxious: "Worry can feel heavy, especially so far from home, and I'm here with you. What's on your mind?",
    homesick: "Missing home is so natural on a long mission. Who or what are you missing most today?",
    sad: "I'm sorry you're feeling down, and thank you for telling me. Would you like to tell me what's been happening?",
  },
  mn: {
    general: "Мэдээж, би энд байна, таныг сонсож байна. Сэтгэлд тань юу байна?",
    lonely: "Тэнд ганцаардах үнэхээр хэцүү, надад хэлсэнд баярлалаа. Юу таныг хамгийн их ганцаардуулж байна вэ?",
    stressed: "Их зүйл үүрч яваа юм шиг сонсогдож байна, стресстэй байх нь ойлгомжтой. Одоо юу хамгийн их санааг тань зовоож байна вэ?",
    anxious: "Гэрээсээ хол байхад санаа зовнил хүнд санагддаг, би тантай хамт байна. Юу бодогдоод байна?",
    homesick: "Урт нислэгт гэрээ санах нь туйлын жам ёсны зүйл. Өнөөдөр хэнийг эсвэл юуг хамгийн их санаж байна?",
    sad: "Сэтгэл тань унасанд харамсаж байна, хэлсэнд баярлалаа. Юу болоод байгааг надад ярих уу?",
  },
};

/** reflective listening + one practical idea for life on a station + one gentle question; the last one says how to go on */
const FOLLOW_UP: Record<Lang, readonly string[]> = {
  en: [
    "Thank you for sharing that with me; it sounds really hard. If it helps, try a slow breath in for a count of four and out for a count of six, a few times. What feels heaviest right now?",
    "I hear you, and what you feel makes sense. Talking with a crewmate you trust, even for a few minutes, can make it lighter. Is there someone on board you feel close to?",
    "That matters, and you don't have to carry it alone. A call or a message to your family when the schedule allows can help a lot. How do you usually recharge on a hard day?",
    "I'm still here with you. A steady sleep routine, with screens off and the same lights-out time, often makes the next day feel lighter. What would help you most tonight?",
    "Thank you for trusting me with this. Whenever you're ready, just say \"let's continue\" and we'll pick up right where we left off. Is there anything else you'd like to tell me?",
  ],
  mn: [
    "Хуваалцсанд баярлалаа, үнэхээр хэцүү байгаа нь мэдрэгдэж байна. Дөрөв тоолон аажуухан амьсгаа аваад, зургаа тоолон гаргаж хэд давтаад үзээрэй. Одоо юу хамгийн хүнд санагдаж байна?",
    "Таныг ойлгож байна, ингэж мэдрэх нь зүйн хэрэг. Итгэдэг багийн гишүүнтэйгээ хэдхэн минут ч гэсэн ярилцах нь сэтгэлийг тань хөнгөлж магадгүй. Станц дээр танд дотно санагддаг хүн байна уу?",
    "Энэ чухал, та үүнийг ганцаараа үүрэх шаардлагагүй. Хуваарь зөвшөөрвөл гэр бүлдээ залгах эсвэл захидал бичих нь их тус болдог. Хэцүү өдөр та ихэвчлэн юугаар сэргэдэг вэ?",
    "Би одоо ч тантай хамт байна. Нэг цагтаа унтаж, унтахын өмнө дэлгэцээ унтраадаг тогтмол дэглэм маргаашийг хөнгөн болгодог. Өнөө орой танд юу хамгийн их тус болох вэ?",
    "Надад итгэж хуваалцсанд баярлалаа. Бэлэн болмогцоо «үргэлжлүүлье» гэж хэлээрэй, бид орхисон газраасаа үргэлжлүүлнэ. Өөр хэлэх зүйл байна уу?",
  ],
};

/** after a crisis turn: every supportive reply keeps pointing to the medical officer */
const AFTER_CRISIS: Record<Lang, readonly string[]> = {
  en: [
    "I'm here with you, and I'm listening. Please reach out to your crew medical officer or the flight surgeon now if you haven't yet. What would help you feel a little safer right now?",
    "Thank you for staying with me. The medical officer and ground know, and talking to them now is the most important step. Is a crewmate near you right now?",
  ],
  mn: [
    "Би тантай хамт байна, таныг сонсож байна. Багийн эмнэлгийн офицер эсвэл нислэгийн эмчтэйгээ одоо холбогдоорой. Яг одоо танд юу арай аюулгүй мэдрэмж төрүүлэх вэ?",
    "Надтай хамт байгаад баярлалаа. Эмнэлгийн офицер болон газрын хяналт мэдэж байгаа, тэдэнтэй одоо ярих нь хамгийн чухал алхам. Таны дэргэд багийн гишүүн байна уу?",
  ],
};

function pick<T>(items: readonly T[], index: number): T {
  const i = ((Math.trunc(index) % items.length) + items.length) % items.length;
  return items[i];
}

/**
 * The offline companion reply. `turn` is the turn of the conversation (1 for the first): the first one welcomes the
 * astronaut in the words of their feeling, the next ones vary (never the same line twice in a row).
 */
export function companionReply(lang: Lang, turn: number, userText: string, crisisRaised = false): string {
  if (crisisRaised) return pick(AFTER_CRISIS[lang], turn);
  if (turn <= 1) return WELCOME[lang][companionTopic(userText)];
  return pick(FOLLOW_UP[lang], turn - 2);
}

/** the crisis reply: ALWAYS this code text, never model wording */
export function crisisReply(lang: Lang, kind: CrisisKind): string {
  if (lang === "mn") {
    const lead =
      kind === "medical"
        ? "Энэ яаралтай анхаарал шаардана."
        : "Надад хэлсэнд үнэхээр баярлалаа, би үүнийг ноцтой хүлээж авч байна.";
    return `${lead} Багийн эмнэлгийн офицер эсвэл нислэгийн эмчтэйгээ яг одоо холбогдоорой, Дэлхий дээр байгаа бол яаралтай тусламжийн дугаар руу залгаарай. Би эмнэлгийн офицер болон газрын хяналтад мэдэгдлээ, тантай хамт энд байна.`;
  }
  const lead = kind === "medical" ? "This needs attention right away." : "I'm really glad you told me, and I'm taking this seriously.";
  return `${lead} Please contact your crew medical officer or the flight surgeon right now, and if you're on Earth, call your local emergency number. I've alerted the medical officer and ground, and I'm staying right here with you.`;
}

const LEAVE: Record<Lang, readonly string[]> = {
  en: [
    "Thank you for talking with me; I'm here any time you need me.",
    "I'm really glad we talked, and you can come back to me whenever you like.",
    "Thanks for opening up, and go gently on yourself today.",
  ],
  mn: [
    "Надтай ярилцсанд баярлалаа, хэрэгтэй үед би үргэлж энд байна.",
    "Ярилцсандаа үнэхээр баяртай байна, хүссэн үедээ надад хандаарай.",
    "Сэтгэлээ нээсэнд баярлалаа, өнөөдөр өөртөө зөөлөн хандаарай.",
  ],
};

/** the short kind line when the astronaut is ready to go on (the caller appends where the check-in stands) */
export function companionLeaveLine(lang: Lang, turn: number): string {
  return pick(LEAVE[lang], turn);
}

/** before the re-asked question or the read-back */
export function resumeLead(lang: Lang): string {
  return lang === "mn" ? "Орхисон газраасаа үргэлжлүүлье." : "Let's pick up where we left off.";
}

/** after the check-in: a short line on the dashboard */
export function dashboardLine(lang: Lang): string {
  return lang === "mn"
    ? "Хяналтын самбар тань энд байна, аль ч хэсгийг нь асуувал тайлбарлаж өгье."
    : "Your dashboard is right here, and I can explain any part of it whenever you like.";
}

/* ───────────── wording from the live model ───────────── */

const MAX_COMPANION_CHARS = 420;
const MAX_COMPANION_SENTENCES = 3;

/**
 * Diagnosis, condition, drug, supplement and remedy words (both languages), for any model text Cosmo speaks about the
 * person's health: the companion replies and the dashboard answers. "эмч" (doctor) is allowed, "эм" (a drug) is not.
 */
const MEDICAL_NAMES =
  /diagnos|disorder|syndrome|depression\b|ptsd|bipolar|schizo|insomnia|panic\s+attacks?|prescri|medicat|medicine|dosage|treatment|therap(?:y|ies)\b|pills?\b|tablets?\b|capsules?\b|\bdrugs?\b|antidepress|anxiolytic|sedative|tranquili[sz]|sleeping\s+aid|sleep\s+aid|supplement|vitamin|magnesium|melatonin|valerian|chamomile|lavender\s+oil|herbal|cbd\b|ambien|zolpidem|xanax|alprazolam|valium|diazepam|ativan|lorazepam|benzo|ssri|sertraline|zoloft|prozac|fluoxetine|antihistamine|benadryl|diphenhydramine|nyquil|unisom|doxylamine|modafinil|ibuprofen|advil|paracetamol|acetaminophen|tylenol|aspirin|онош|эмгэг|(?<![\p{L}])эм(?:ийг|ийн|ээ|үүд|үүдийг|ээр)?(?![\p{L}])|эмчилгээ|эмчлэ|тайвшруулагч|унтуулагч|нойрны\s+эм|витамин|нэмэлт\s+тэжээл|(?<![\p{L}])магни|мелатонин|ургамлын\s+(?:цай|гаралтай)|нойргүйдэл|сэтгэл\s+гутрал|сандралын\s+дайралт|(?<![\p{L}])(?:үрэл|шахмал)(?![\p{L}])/iu;

/** a doctor's name for a condition, a drug, a supplement or a remedy in model text (it is then not spoken) */
export function namesConditionOrDrug(text: string): boolean {
  return MEDICAL_NAMES.test(text);
}

/** plus doses (the companion replies never carry a quantity) */
const FORBIDDEN_COMPANION_DOSE = /\bdoses?\b|\bmg\b|(?<![\p{L}])тун(?:г|гаар)?(?![\p{L}])/iu;

/** after a crisis, model wording must keep pointing to the medical officer (otherwise the template is used) */
const POINTS_TO_MEDICAL_OFFICER = /medical\s+officer|flight\s+surgeon|эмнэлгийн\s+офицер|нислэгийн\s+эмч/iu;

function sentenceCount(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

/**
 * Model wording for a companion turn is used only when it is short (at most 420 characters, three sentences), has no
 * emojis, no diagnosis / condition / drug / supplement / dose words, no digits the astronaut did not say, and is in the
 * check-in's language; after a crisis (`crisisRaised`) it must also point to the medical officer or flight surgeon.
 * Otherwise the template is used.
 */
export function isSaneCompanionReply(text: string, lang: Lang, userText: string, crisisRaised = false): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_COMPANION_CHARS) return false;
  if (sentenceCount(t) > MAX_COMPANION_SENTENCES) return false;
  if (/\p{Extended_Pictographic}/u.test(t)) return false;
  if (namesConditionOrDrug(t) || FORBIDDEN_COMPANION_DOSE.test(t)) return false;
  if (crisisRaised && !POINTS_TO_MEDICAL_OFFICER.test(t)) return false;
  const said = new Set(userText.match(/\d+/gu) ?? []);
  if ((t.match(/\d+/gu) ?? []).some((n) => !said.has(n))) return false;
  const cyrillic = (t.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (t.match(/\p{Script=Latin}/gu) ?? []).length;
  if (lang === "en") return cyrillic === 0;
  // Mongolian: mostly Cyrillic (a name such as "Cosmo" in Latin letters is fine)
  return cyrillic > 0 && latin <= Math.max(8, cyrillic / 5);
}
