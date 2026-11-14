import type { KpiKey, Lang, QuestionId } from "@/lib/types";
import type { Baseline } from "@/lib/health/baseline";
import { KPI_DEFS, formatValue, getQuestion, rangeText } from "@/lib/kpi/registry";
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

export type AskedKind = "normal" | "why" | "how" | "repeat" | "other";

const QUESTION_MARK = /[?？]\s*$/u;

// Mongolian question particles and words. "юу ч" ("anything / nothing") is an answer, not a question.
const MN_QUESTION =
  /(?<![\p{L}])(?:вэ|бэ|уу|үү|юу(?!\s*ч(?![\p{L}])|\s*ч\s)|юуг|юунд|яагаад|яаж|хэрхэн|хэд\s+байх|хэр\s+байх|ямар\s+байх|хэдэн\s+байх|хэдтэй\s+байх|байх\s+ёстой|хэвийн\s+(?:нь|хэд|юу|уу)|асуух\s+зүйл|ойлгосонгүй|ойлгохгүй)(?![\p{L}])/iu;
const EN_QUESTION =
  /^(?:what|why|how|should|is|are|am|can|could|do|does|did|which|when|where|would|will|who|tell\s+me|explain)\b|\b(?:what|why|how)\b.*\b(?:should|normal|mean|means|for|measure|do)\b/iu;

const KIND_PATTERNS: Array<{ kind: AskedKind; mn: RegExp; en: RegExp }> = [
  {
    kind: "repeat",
    mn: /(?:дахиад|дахин)\s+(?:хэл|асуу|давт)|давтаж|юу\s+гэсэн|сонсогдсонгүй|сонссонгүй|ойлгосонгүй|ойлгохгүй\s+байна/iu,
    en: /\b(?:repeat|say\s+(?:it|that)\s+again|again\?|pardon|what\s+was\s+the\s+question|didn'?t\s+(?:hear|get)|come\s+again)\b/iu,
  },
  {
    kind: "normal",
    mn: /(?:байх\s+ёстой|хэвийн|норм|хэд\s+байвал|хэд\s+байх|хэр\s+байх|ямар\s+байх|хэдэн\s+байх|хэдтэй\s+байх|зөв\s+хэмжээ|сайн\s+нь)/iu,
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

/** The astronaut asked something (instead of answering), and what kind of thing; null when it is not a question. */
export function detectAskedQuestion(text: string, lang: Lang): AskedKind | null {
  const t = text.trim();
  if (!t) return null;
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
    case "normal":
      return join([
        normalSentence(id, lang) ?? WHY[id][lang],
        baselineSentence(id, baselines, lang),
        lang === "mn" ? "Энэ нь эмчийн дүгнэлт биш." : "This is not a medical judgement.",
      ]);
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
  return join([
    normalSentence(id, lang),
    baselineSentence(id, baselines, lang),
    WHY[id][lang],
    HOW[id][lang],
  ]);
}
