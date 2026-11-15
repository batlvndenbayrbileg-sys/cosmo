import type { KpiKey, Lang, MeasurementValue, QuestionId } from "@/lib/types";
import type { Baseline } from "@/lib/health/baseline";
import { KPI_DEFS, asNumber, formatValue, getQuestion, rangeText } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import {
  REFERENCE_CAVEAT,
  referenceBand,
  referenceSentence,
  type ReferenceBand,
  type ReferenceTopic,
} from "@/lib/health/vitalReference";
import { extractNumbers } from "@/lib/numbers/extract";
import { MGDL_PER_MMOL, isNotAVitalValue } from "@/lib/numbers/units";
// (rangeText is the dashboard card's "Normal ... · demo parameter" text; bareRange below drops the card suffix)

/**
 * "Ask back" during the check-in (team feedback 2026-11-15: "it should answer anything I ask, like Jarvis"):
 * while Cosmo waits for a value, the astronaut may ask a question instead of answering ("what should my blood sugar
 * be?", "why do you ask?", "how do I measure it?", "say that again"). Cosmo answers briefly, then asks its question
 * again, instead of "Sorry, I didn't catch that".
 *
 * Pure: the caller decides that the utterance carried no value; this module only recognises a question and builds a
 * grounded answer from the registry (demo-parameter range), the personal 14-day baseline and fixed explanations.
 * The live model may word a better answer (claudeAgent answer_question); these templates are the offline answer and
 * the facts the model is allowed to use.
 */

export type AskedKind = "normal" | "why" | "how" | "repeat" | "greeting" | "other";

const QUESTION_MARK = /[?？]\s*$/u;

// Mongolian question particles and words. "юу ч" ("anything / nothing") is an answer, not a question.
const MN_QUESTION =
  /(?<![\p{L}])(?:вэ|бэ|уу|үү|юу(?!\s*ч(?![\p{L}])|\s*ч\s)|юуг|юунд|яагаад|яаж|хэрхэн|хэд\s+байх|хэр\s+байх|ямар\s+байх|хэдэн\s+байх|хэдтэй\s+байх|байх\s+ёстой|хэвийн\s+(?:нь|хэд|юу|уу)|асуух\s+зүйл|ойлгосонгүй|ойлгохгүй)(?![\p{L}])/iu;
const EN_QUESTION =
  /^(?:what|why|how|should|is|are|am|can|could|do|does|did|which|when|where|would|will|who|tell\s+me|explain)\b|\b(?:what|why|how)\b.*\b(?:should|normal|mean|means|for|measure|do)\b/iu;

const KIND_PATTERNS: Array<{ kind: AskedKind; mn: RegExp; en: RegExp }> = [
  {
    kind: "repeat",
    // "юу гэсэн" is "what did you say", but "юу гэсэн үг" is "what does it mean": a real question, not a repeat request
    mn: /(?:дахиад|дахин)\s+(?:хэл|асуу|давт)|давтаж|юу\s+гэсэн(?!\s+үг)|сонсогдсонгүй|сонссонгүй|ойлгосонгүй|ойлгохгүй\s+байна/iu,
    en: /\b(?:repeat|say\s+(?:it|that)\s+again|again\?|pardon|what\s+was\s+the\s+question|didn'?t\s+(?:hear|get)|come\s+again)\b/iu,
  },
  {
    kind: "normal",
    // "...х ёстой" is "should ...": "унтах ёстой", "уух ёстой", "байх ёстой"
    mn: /(?:[\p{L}]+х\s+ёстой|хэвийн|норм|хэд\s+байвал|хэд\s+байх|хэр\s+байх|ямар\s+байх|хэдэн\s+байх|хэдтэй\s+байх|зөв\s+хэмжээ|сайн\s+нь)/iu,
    en: /\b(?:should|normal|healthy|ideal|supposed\s+to|good\s+(?:range|number|value|level)|target|range|ok(?:ay)?\s+(?:range|value))\b/iu,
  },
  {
    kind: "why",
    mn: /(?:яагаад|юунд|ямар\s+учиртай|юу\s+хэрэгтэй|юунд\s+хэрэгтэй)/iu,
    en: /\b(?:why|what\s+for|what'?s\s+the\s+point|what\s+does\s+it\s+matter)\b/iu,
  },
  {
    kind: "how",
    mn: /(?:яаж|хэрхэн|хэмжих\s+вэ|хэмждэг|хаанаас\s+хар)/iu,
    en: /\b(?:how\s+(?:do|can|should|to|would)|measure|check\s+it|where\s+do\s+i\s+(?:find|see))\b/iu,
  },
];

/** a greeting on its own ("Сайн уу", "Сайн байна уу", "hi Cosmo"): greeted back, not taken for a question */
const GREETING_ONLY =
  /^(?:(?:сайн\s+(?:уу|байна\s+уу|байцгаана\s+уу)|сайн\s+байна|мэнд\s+(?:хүргэе|ээ)|hi|hello|hey|good\s+(?:morning|afternoon|evening))(?:[\s,]+(?:cosmo|космо))?)[\s.!?]*$/iu;

/** words about the body, health, measurements or medicine (EN + MN): a question with any of these is a health question */
const HEALTH_TOPIC =
  /\b(?:blood|pressure|sugar|glucose|heart|pulse|bpm|temperature|fever|oxygen|spo2|saturation|sleep|slept|mood|headache|dizz\w*|nause\w*|symptom\w*|hydrat\w*|water|drink\w*|exercis\w*|workout|vision|eye\w*|medic\w*|dose|drug\w*|pill\w*|mg|mmhg|weight|calorie\w*|panel|il-?\d+|urine|lab|health\w*|body|pain|sick|ill|disease|diagnos\w*|vital\w*|stress|tired|fatigue)\b|цус|даралт|сахар|глюкоз|зүрх|судас|лугшилт|температур|халуу|хүчилтөрөгч|унт|нойр|сэтгэл|толгой|дотор\s+муу|бие|шингэн|дасгал|хараа|нүд|(?<![\p{L}])(?:ус|эм|эмийн)(?![\p{L}])|жин|илчлэг|шинжилгээ|шээс|өвд|өвчин|онош|эрүүл|ядар|стресс/iu;

/** which check-in question a question back is about, by its words (EN + MN); first match wins */
const QUESTION_TOPICS: Array<{ id: QuestionId; re: RegExp }> = [
  { id: "blood_pressure", re: /blood\s+pressure|\bbp\b|даралт/iu },
  { id: "glucose", re: /blood\s+sugar|glucose|sugar|сахар|глюкоз/iu },
  { id: "heart_rate", re: /heart\s*rate|pulse|\bbpm\b|лугшилт|зүрхний\s+цохилт|зүрх/iu },
  { id: "temperature", re: /temperature|fever|температур|халуу/iu },
  { id: "sleep", re: /\bsleep|\bslept|унт|нойр/iu },
  { id: "mood", re: /\bmood|сэтгэл/iu },
  { id: "symptoms", re: /headache|dizz|nause|symptom|толгой|дотор\s+муу/iu },
  { id: "water", re: /\bwater|drink|hydrat|(?<![\p{L}])ус(?![\p{L}])|шингэн/iu },
  { id: "exercise", re: /exercis|workout|дасгал/iu },
  { id: "vision", re: /vision|eyesight|\beye|хараа|нүд/iu },
  { id: "workload", re: /workload|ачаалал/iu },
];

/** the check-in question a question back names ("how many hours should I SLEEP?" -> sleep), or null */
export function questionTopicOf(text: string): QuestionId | null {
  return QUESTION_TOPICS.find((t) => t.re.test(text))?.id ?? null;
}

/** true when the words are about health, the body or a measurement; numbers in answers to these must come from data */
export function isHealthTopic(text: string): boolean {
  return HEALTH_TOPIC.test(text);
}

/** The astronaut asked something (instead of answering), and what kind of thing; null when it is not a question. */
export function detectAskedQuestion(text: string, lang: Lang): AskedKind | null {
  const t = text.trim();
  if (!t) return null;
  if (GREETING_ONLY.test(t)) return "greeting";
  const isQuestion =
    QUESTION_MARK.test(t) || MN_QUESTION.test(t) || EN_QUESTION.test(t) || KIND_PATTERNS.some((k) => k.mn.test(t) || k.en.test(t));
  if (!isQuestion) return null;
  for (const k of KIND_PATTERNS) {
    if (k[lang].test(t) || k[lang === "mn" ? "en" : "mn"].test(t)) return k.kind;
  }
  return "other";
}

/* ───────────── what each question is for, and how to measure it (fixed text, no numbers invented) ───────────── */

const WHY: Record<QuestionId, { en: string; mn: string }> = {
  sleep: {
    en: "Sleep is the first thing to drift on a mission, and it affects focus and mood the next day.",
    mn: "Нойр нь нислэгийн үед хамгийн түрүүнд алдагддаг бөгөөд маргаашийн анхаарал, сэтгэл санаанд нөлөөлдөг.",
  },
  mood: {
    en: "Mood over several days shows how you are coping with isolation and workload.",
    mn: "Хэд хоногийн сэтгэл санаа нь тусгаарлалт, ачааллыг хэрхэн даван туулж байгааг харуулдаг.",
  },
  symptoms: {
    en: "Headache, dizziness and nausea are common early signs of fluid shift and space adaptation.",
    mn: "Толгой өвдөх, эргэх, дотор муухайрах нь шингэн шилжих, сансарт дасах үеийн түгээмэл анхны шинж юм.",
  },
  blood_pressure: {
    en: "In weightlessness fluids move towards the head, so blood pressure is watched every day.",
    mn: "Жингүйдэлд шингэн толгой руу шилждэг тул цусны даралтыг өдөр бүр хянадаг.",
  },
  heart_rate: {
    en: "Resting pulse shows how your heart is adapting and how rested you are.",
    mn: "Тайван үеийн пульс нь зүрх хэрхэн дасаж, та хэр амарсныг харуулдаг.",
  },
  temperature: {
    en: "Body temperature is a simple early sign of infection or overheating in a closed cabin.",
    mn: "Биеийн температур нь хаалттай орчинд халдвар эсвэл хэт халалтын энгийн анхны шинж юм.",
  },
  glucose: {
    en: "Blood sugar shows how your body handles food and exercise on the station diet.",
    mn: "Цусны сахар нь станцын хоолны дэглэм, дасгалыг бие хэрхэн тэсвэрлэж байгааг харуулдаг.",
  },
  water: {
    en: "In space you feel less thirsty, so it is easy to drink too little.",
    mn: "Сансарт цангах мэдрэмж багасдаг тул ус бага уух нь амархан.",
  },
  exercise: {
    en: "Daily exercise protects bones and muscles, which weaken quickly in weightlessness.",
    mn: "Өдөр бүрийн дасгал нь жингүйдэлд хурдан суладаг яс, булчинг хамгаалдаг.",
  },
  vision: {
    en: "Some astronauts get vision changes in space, so a quick daily check catches them early.",
    mn: "Зарим сансрын нисгэгчийн хараа сансарт өөрчлөгддөг тул өдөр бүрийн богино шалгалт эрт илрүүлдэг.",
  },
  workload: {
    en: "Workload together with sleep and mood shows when you need more rest.",
    mn: "Ажлын ачаалал нь нойр, сэтгэл санаатай хамт хэзээ илүү амрах хэрэгтэйг харуулдаг.",
  },
  day_note: {
    en: "A short note helps the crew medical officer understand the numbers.",
    mn: "Богино тэмдэглэл нь багийн эмчид тоонуудыг ойлгоход тусалдаг.",
  },
};

const HOW: Record<QuestionId, { en: string; mn: string }> = {
  sleep: { en: "Count from when you fell asleep to when you woke up; a rough number is fine.", mn: "Унтсанаасаа сэрэх хүртэлх хугацааг тооцоорой, ойролцоо тоо хангалттай." },
  mood: { en: "1 means very low, 5 means very good; say the number that fits today.", mn: "1 бол маш муу, 5 бол маш сайн; өнөөдөрт тохирох тоог хэлээрэй." },
  symptoms: { en: "Just say yes or no for headache, dizziness and nausea.", mn: "Толгой өвдөх, эргэх, дотор муухайрах эсэхийг тийм эсвэл үгүй гэж хэлээрэй." },
  blood_pressure: { en: "Use the cuff while seated and at rest, then read both numbers, for example 120 over 80.", mn: "Тайван сууж байгаад ханцуйвчаар хэмжээд хоёр тоог нь хэлээрэй, жишээ нь 120 дээр 80." },
  heart_rate: { en: "Read it from the cuff or your watch, or count beats for a minute while resting.", mn: "Ханцуйвч эсвэл цагнаасаа уншаарай, эсвэл тайван үедээ нэг минутын цохилтыг тоолоорой." },
  temperature: { en: "Read the thermometer in degrees Celsius.", mn: "Халуун хэмжигчийг Цельсийн хэмээр уншаарай." },
  glucose: { en: "Read the glucose meter after a finger prick; the number is in mg/dL.", mn: "Хуруунаас дусал цус аваад глюкометрээ уншаарай; тоо нь mg/dL-ээр гарна." },
  water: { en: "Add up your drink bags today; one bag is usually written on its label.", mn: "Өнөөдөр уусан ундааны уутнуудаа нэмээрэй; нэг уутны хэмжээ шошгон дээр нь бичээстэй байдаг." },
  exercise: { en: "Add up today's minutes on the treadmill, bike and resistance device.", mn: "Өнөөдөр гүйлтийн зам, дугуй, хүчний дасгалын төхөөрөмж дээрх минутаа нэмээрэй." },
  vision: { en: "Cover one eye, read the lines on the screen, then the other eye.", mn: "Нэг нүдээ таглаад дэлгэц дээрх мөрүүдийг уншаад, дараа нь нөгөө нүдээрээ." },
  workload: { en: "1 means very light, 5 means very heavy.", mn: "1 бол маш хөнгөн, 5 бол маш хүнд." },
  day_note: { en: "Anything you want the crew medical officer to know, in your own words.", mn: "Багийн эмчид мэдэгдэх хүссэн зүйлээ өөрийнхөө үгээр хэлээрэй." },
};

function join(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(" ");
}

/** the card text "Normal 70-140 mg/dL · demo parameter" without its card-only suffix (the sentence says "demo" itself) */
function bareRange(key: KpiKey): { en: string; mn: string } | null {
  const r = rangeText(key);
  if (!r) return null;
  const strip = (s: string) => s.replace(/\s*·\s*(?:demo parameter|демо параметр)\s*$/iu, "");
  return { en: strip(r.en), mn: strip(r.mn) };
}

/* ───────────── general reference ranges (src/lib/health/vitalReference.ts) ───────────── */

/** the check-in questions that have a general resting-adult reference range */
const REFERENCE_OF: Partial<Record<QuestionId, ReferenceTopic>> = {
  heart_rate: "heart_rate",
  blood_pressure: "blood_pressure",
  temperature: "temperature",
  glucose: "glucose",
};

const QUESTION_OF: Partial<Record<ReferenceTopic, QuestionId>> = {
  heart_rate: "heart_rate",
  blood_pressure: "blood_pressure",
  temperature: "temperature",
  glucose: "glucose",
};

/** which vital a question names, including the two the check-in does not ask (breathing, oxygen); first match wins */
const REFERENCE_TOPICS: Array<{ topic: ReferenceTopic; re: RegExp }> = [
  // "is 120 over 80 ok?", "120/80 хэвийн үү?": a pair said the blood-pressure way names it without the word
  { topic: "blood_pressure", re: /blood\s+pressure|\bbp\b|даралт|\d{2,3}\s*(?:\/|over|дээр)\s*\d{2,3}/iu },
  { topic: "spo2", re: /spo2|sp\s*o2|oxygen|saturation|хүчилтөрөгч|сатураци/iu },
  { topic: "breathing_rate", re: /\bbreath\w*|respirat\w*|амьсгал/iu },
  { topic: "glucose", re: /blood\s+sugar|glucose|\bsugar|сахар|глюкоз/iu },
  { topic: "heart_rate", re: /heart\s*rate|heartbeat|\bpulse|\bbpm\b|зүрх|пульс|лугшилт/iu },
  { topic: "temperature", re: /temperature|fever|температур|халуу/iu },
];

export function referenceTopicOf(text: string): ReferenceTopic | null {
  return REFERENCE_TOPICS.find((t) => t.re.test(text))?.topic ?? null;
}

/** a question that judges a value ("is 85 a good pulse?", "is my blood pressure ok?", "миний пульс их байна уу?") */
const JUDGE_RE =
  /\b(?:ok(?:ay)?|good|bad|fine|high|low|dangerous|worr\w*|concern\w*|safe)\b|хэвийн|сайн|муу|өндөр|бага|(?<![\p{L}])их(?![\p{L}])|нам|аюул|санаа\s+зов/iu;

/**
 * The general reference topic a question asks about ("what is a normal heart rate?", "зүрхний цохилт хэд байх ёстой
 * вэ?", "is 85 a good pulse?", "what should my oxygen be?"), or null: "why / how / say again" questions and questions
 * that do not name a vital are not reference questions.
 */
export function referenceQuestionTopic(text: string, lang: Lang): ReferenceTopic | null {
  const kind = detectAskedQuestion(text, lang);
  if (kind === null || kind === "greeting" || kind === "repeat" || kind === "why" || kind === "how") return null;
  // a statement ("my blood pressure is normal today") is not a question, even with a "normal" word in it
  const t = text.trim();
  if (!QUESTION_MARK.test(t) && !MN_QUESTION.test(t) && !EN_QUESTION.test(t)) return null;
  const topic = referenceTopicOf(text);
  if (!topic) return null;
  return kind === "normal" || JUDGE_RE.test(text) ? topic : null;
}

const BAND_WORDS: Record<ReferenceBand, { en: string; mn: string }> = {
  normal: { en: "which is within that general range", mn: "энэ нь ерөнхий хэвийн хүрээнд байна" },
  outside: { en: "which is outside that general range, though not at the urgent level", mn: "энэ нь ерөнхий хэвийн хүрээнээс гадуур, гэхдээ яаралтай түвшинд хүрээгүй байна" },
  danger: {
    en: "which is past the urgent threshold, so please tell the crew medical officer now",
    mn: "энэ нь яаралтай босгоос давсан тул багийн эмнэлгийн офицерт одоо мэдэгдээрэй",
  },
};

/** the numbers a question can mean for each vital (registry units: bpm, mmHg, breaths/min, %, °C, mg/dL) */
const PLAUSIBLE: Record<ReferenceTopic, readonly [number, number]> = {
  heart_rate: [20, 250],
  blood_pressure: [30, 260],
  breathing_rate: [3, 60],
  spo2: [50, 100],
  temperature: [30, 45],
  glucose: [20, 600],
};

const OTHER_UNITS: Partial<Record<ReferenceTopic, { en: string; mn: string }>> = {
  breathing_rate: { en: "breaths a minute", mn: "удаа/мин" },
  spo2: { en: "%", mn: "%" },
};

/** a bare body temperature this high is Fahrenheit (as in interpret.ts) */
const FAHRENHEIT_MIN = 86;
const FAHRENHEIT_MAX = 113;

/**
 * A number in a question, in the registry's unit: "is 98.6 a normal temperature?" is 37 °C (from 98.6 °F) and "is 5.5
 * good for blood sugar?" is 99 mg/dL (from 5.5 mmol/L), the same readings the check-in takes (interpret.ts).
 */
function inRegistryUnit(topic: ReferenceTopic, value: number, text: string, lang: Lang): { value: number; from: string | null } {
  if (topic === "temperature" && value >= FAHRENHEIT_MIN && value <= FAHRENHEIT_MAX) {
    return { value: Math.round((((value - 32) * 5) / 9) * 10) / 10, from: `${formatNumber(value, 1)} °F` };
  }
  if (topic === "glucose" && !/mg|мг/iu.test(text)) {
    const mmol =
      /mmol|ммоль/iu.test(text) || (Number.isInteger(value) ? value >= 2 && value <= 15 : value > 1 && value <= 33);
    if (mmol) return { value: Math.round(value * MGDL_PER_MMOL), from: `${formatNumber(value, 2)} ${lang === "mn" ? "ммоль/л" : "mmol/L"}` };
  }
  return { value, from: null };
}

/** "Today you told me 68 bpm, which is within that general range." / the number in the question, judged the same way */
function valueSentence(
  topic: ReferenceTopic,
  lang: Lang,
  text: string,
  today: Partial<Record<KpiKey, MeasurementValue>>,
): string | null {
  // only numbers that can be this vital count ("is my pulse ok after 2 hours of exercise?" asks about today's value):
  // never an age, a count of times or a time span ("a normal pulse for a 30 year old?", "after 30 minutes")
  const [lo, hi] = PLAUSIBLE[topic];
  const read = extractNumbers(text)
    .filter((n) => !isNotAVitalValue(text, n))
    .map((n) => inRegistryUnit(topic, n.value, text, lang))
    .filter((r) => r.value >= lo && r.value <= hi);
  const nums = read.map((r) => r.value);
  const asked = nums.length > 0;
  let shown: string;
  let band: ReferenceBand;
  if (topic === "blood_pressure") {
    let sys: number | null = null;
    let dia: number | null = null;
    if (nums.length >= 2 && nums[0] > nums[1]) [sys, dia] = nums;
    else if (!asked) [sys, dia] = [asNumber(today.bp_systolic), asNumber(today.bp_diastolic)];
    if (sys === null || dia === null) return null;
    shown = lang === "mn" ? `${formatNumber(sys, 0)} дээр ${formatNumber(dia, 0)}` : `${formatNumber(sys, 0)} over ${formatNumber(dia, 0)}`;
    band = referenceBand(topic, sys, dia);
  } else {
    const key: KpiKey | null =
      topic === "heart_rate" ? "heart_rate" : topic === "temperature" ? "temperature_c" : topic === "glucose" ? "glucose_mgdl" : null;
    const n = asked ? nums[0] : key ? asNumber(today[key]) : null;
    if (n === null) return null;
    const from = asked ? read[0].from : null;
    shown = key ? formatValue(key, n, lang) : `${formatNumber(n, 1)} ${OTHER_UNITS[topic]?.[lang] ?? ""}`.trim();
    if (from) shown = `${shown} (${from})`;
    band = referenceBand(topic, n);
  }
  const words = BAND_WORDS[band][lang];
  if (asked) return `${shown}: ${words}.`;
  return lang === "mn" ? `Өнөөдөр ${shown} гэж хэлсэн, ${words}.` : `Today you told me ${shown}, ${words}.`;
}

/**
 * The answer to a general reference question at any point (small talk, the check-in, after it): the general resting
 * range and its urgent thresholds, the value asked about or today's value judged against it, the person's own 14-day
 * average, and the "general reference, not a diagnosis" caveat. Every number comes from the reference workbook, the
 * registry, the baseline, today's stored values or the astronaut's own words. Null when the text is not such a question.
 */
export function answerReferenceQuestion(
  text: string,
  lang: Lang,
  ctx: { baselines: Partial<Record<KpiKey, Baseline>>; today: Partial<Record<KpiKey, MeasurementValue>> },
): { topic: ReferenceTopic; questionId: QuestionId | null; text: string; brief: string } | null {
  const topic = referenceQuestionTopic(text, lang);
  if (!topic) return null;
  const questionId = QUESTION_OF[topic] ?? null;
  const value = valueSentence(topic, lang, text, ctx.today);
  return {
    topic,
    questionId,
    // after a value that was recorded from the same words ("is 85 a good pulse?"): the range, the judgement and a
    // short form of the caveat (a judgement is never said without "not a diagnosis")
    brief: join([referenceSentence(topic, lang), value, REFERENCE_CAVEAT_SHORT[lang]]),
    text: join([
      referenceSentence(topic, lang),
      value,
      questionId ? demoBandSentence(questionId, lang) : null,
      questionId ? baselineSentence(questionId, ctx.baselines, lang) : null,
      REFERENCE_CAVEAT[lang],
    ]),
  };
}

const REFERENCE_CAVEAT_SHORT: Readonly<Record<Lang, string>> = {
  en: "General reference, not a diagnosis.",
  mn: "Ерөнхий лавлагаа, онош биш.",
};

/** a model-worded answer to a general reference question gets the caveat when it does not carry one */
export function withReferenceCaveat(answer: string, userText: string, lang: Lang): string {
  if (!referenceQuestionTopic(userText, lang)) return answer;
  if (/reference|judgement|лавлагаа|дүгнэлт/iu.test(answer)) return answer;
  return join([answer, REFERENCE_CAVEAT[lang]]);
}

/** "Normal 70-140 mg/dL" -> "the demo range is 70-140 mg/dL" style sentence for the question's keys */
function normalSentence(id: QuestionId, lang: Lang): string | null {
  const q = getQuestion(id);
  const ranges = q.keys
    .map((k) => ({ k, r: bareRange(k) }))
    .filter((x): x is { k: KpiKey; r: { en: string; mn: string } } => x.r !== null);
  if (ranges.length === 0) return null;
  if (id === "blood_pressure" && ranges.length === 2) {
    const [s, d] = ranges;
    return lang === "mn"
      ? `Демо параметрээр дээд даралт ${s.r.mn.replace(/^Хэвийн\s*/u, "")}, доод даралт ${d.r.mn.replace(/^Хэвийн\s*/u, "")} бол хэвийн гэж үзнэ.`
      : `As a demo parameter, the upper number ${s.r.en.replace(/^Normal\s*/u, "")} and the lower ${d.r.en.replace(/^Normal\s*/u, "")} count as normal.`;
  }
  const r = ranges[0].r;
  return lang === "mn"
    ? `Демо параметрээр ${KPI_DEFS[ranges[0].k].labels.mn.toLowerCase()}: ${r.mn.replace(/^Хэвийн:?\s*/u, "")} бол хэвийн.`
    : `As a demo parameter, ${KPI_DEFS[ranges[0].k].labels.en.toLowerCase()} of ${r.en.replace(/^Normal:?\s*/u, "")} counts as normal.`;
}

/** the dashboard card's band in a few words, after a general range: "The dashboard's demo watch band is 50-90 bpm." */
function demoBandSentence(id: QuestionId, lang: Lang): string | null {
  const q = getQuestion(id);
  const ranges = q.keys.map((k) => bareRange(k)).filter((r): r is { en: string; mn: string } => r !== null);
  if (ranges.length === 0) return null;
  const strip = (s: string) => s.replace(/^(?:Normal|Хэвийн):?\s*/u, "");
  const band =
    id === "blood_pressure" && ranges.length === 2
      ? lang === "mn"
        ? `дээд ${strip(ranges[0].mn)}, доод ${strip(ranges[1].mn)}`
        : `${strip(ranges[0].en)} upper and ${strip(ranges[1].en)} lower`
      : strip(ranges[0][lang]);
  return lang === "mn" ? `Самбар дээрх демо параметрийн хүрээ: ${band}.` : `On the dashboard, the demo parameter band is ${band}.`;
}

function baselineSentence(id: QuestionId, baselines: Partial<Record<KpiKey, Baseline>>, lang: Lang): string | null {
  const q = getQuestion(id);
  const parts: string[] = [];
  for (const k of q.keys) {
    const b = baselines[k];
    if (!b || b.mean === null) continue;
    const def = KPI_DEFS[k];
    if (def.type === "boolean" || def.type === "category" || def.type === "text") continue;
    const rounded = def.type === "integer" || def.type === "scale" ? Math.round(b.mean) : Math.round(b.mean * 10) / 10;
    parts.push(formatValue(k, rounded, lang));
  }
  if (parts.length === 0) return null;
  const v = id === "blood_pressure" && parts.length === 2 ? (lang === "mn" ? `${parts[0]} дээр ${parts[1]}` : `${parts[0]} over ${parts[1]}`) : parts[0];
  return lang === "mn" ? `Таны сүүлийн 14 хоногийн дундаж ${v}.` : `Your own 14-day average is ${v}.`;
}

/**
 * The offline answer to a question asked back, WITHOUT the re-asked question (the pipeline appends the registry prompt).
 * Every number in it comes from the registry or the baseline.
 */
export function answerAskedQuestion(
  kind: AskedKind,
  id: QuestionId,
  lang: Lang,
  baselines: Partial<Record<KpiKey, Baseline>>,
): string {
  switch (kind) {
    case "repeat":
      return lang === "mn" ? "Дахиад асууя." : "Sure, again.";
    case "greeting":
      return lang === "mn" ? "Сайн байна, баярлалаа!" : "Hi again!";
    case "normal": {
      // the general resting-adult range first (vital_reference.json), then the dashboard's demo band and the person's own
      // 14-day average; without a general range (sleep, water, mood ...) the demo band is the answer
      const topic = REFERENCE_OF[id];
      if (topic) {
        return join([referenceSentence(topic, lang), demoBandSentence(id, lang), baselineSentence(id, baselines, lang), REFERENCE_CAVEAT[lang]]);
      }
      return join([
        normalSentence(id, lang) ?? WHY[id][lang],
        baselineSentence(id, baselines, lang),
        lang === "mn" ? "Энэ нь эмчийн дүгнэлт биш." : "This is not a medical judgement.",
      ]);
    }
    case "why":
      return WHY[id][lang];
    case "how":
      return HOW[id][lang];
    case "other":
      return lang === "mn"
        ? "Сайн асуулт. Үүнийг шалгалтын дараа дэлгэрэнгүй ярилцъя."
        : "Good question. Let's talk about it properly right after the check-in.";
  }
}

/**
 * What the live model may use to answer a question asked back about the open question: the demo range, the personal
 * baseline, why it is asked and how to measure it. Numbers in the model's answer must appear here (or in the
 * astronaut's words).
 */
export function questionFacts(id: QuestionId, lang: Lang, baselines: Partial<Record<KpiKey, Baseline>>): string {
  const topic = REFERENCE_OF[id];
  return join([
    // the general resting-adult range: the model may quote these numbers (the sanity gate allows what is in the facts)
    topic ? referenceSentence(topic, lang) : null,
    normalSentence(id, lang),
    baselineSentence(id, baselines, lang),
    WHY[id][lang],
    HOW[id][lang],
  ]);
}
