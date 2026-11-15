/**
 * Every sentence Cosmo says that is produced by code, in English and Mongolian.
 *
 * Tone: warm, calm, concise (1-2 sentences), professional, never cute-silly, no emojis, and never a diagnosis,
 * a drug or a treatment ("alert" or "watch", never "diagnosis"). The numbers always come from stored values
 * through the registry formatter; the wording around them is fixed here.
 *
 * Pure TypeScript: no I/O. The Mongolian wording is natural but needs a native-speaker review.
 */

import type { CrewPublic, KpiKey, Lang, MeasurementValue, QuestionDef, RedFlag, SummaryFindings } from "@/lib/types";
import { KPI_DEFS, QUESTIONS, asNumber, formatValue } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import type { InterpretedRecord } from "./interpret";
import { ASSUMPTION_CHECK, answerExample, assumptionNote } from "./assumptions";
import { dangerNotice } from "./valueChecks";

export type ClarifyReason = "range" | "type" | "unclear";

/* ───────────── helpers ───────────── */

const MN_NAMES: Readonly<Record<string, string>> = {
  bat: "Бат",
  saraa: "Сараа",
  alex: "Алекс",
  mira: "Мира",
};

function lowerLabel(key: KpiKey, lang: Lang): string {
  const label = KPI_DEFS[key].labels[lang];
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function sentence(text: string): string {
  const t = text.trim();
  if (t.length === 0) return "";
  return /[.!?]$/u.test(t) ? t : `${t}.`;
}

function join(parts: string[]): string {
  return parts.filter((p) => p.trim().length > 0).join(" ");
}

/** spoken units: "7 hours" rather than "7 h" (the TTS reads abbreviations badly); Mongolian units are already words */
const EN_SPOKEN_UNITS: Readonly<Record<string, readonly [string, string]>> = {
  h: ["hour", "hours"],
  min: ["minute", "minutes"],
  ml: ["millilitre", "millilitres"],
  bpm: ["beat per minute", "beats per minute"],
  "°C": ["degree", "degrees"],
  "mg/dL": ["milligram per decilitre", "milligrams per decilitre"],
};

/**
 * Mongolian spoken forms of the displayed units (the speech engine reads "удаа/мин", "°C" and "mg/dL" badly).
 * Keyed by the unit suffix that formatValue prints in Mongolian.
 */
const MN_SPOKEN_UNITS: Readonly<Record<string, (base: string) => string>> = {
  "удаа/мин": (b) => `минутад ${b} удаа`,
  "°C": (b) => `${b} хэм`,
  "mg/dL": (b) => b,
  "мл": (b) => `${b} миллилитр`,
  "мин": (b) => `${b} минут`,
};

function spokenValue(key: KpiKey, value: MeasurementValue, lang: Lang): string {
  const def = KPI_DEFS[key];
  const n = asNumber(value);
  if (def.type === "text") return String(value);
  if (def.type === "scale" && n !== null) {
    const max = def.max ?? 5;
    return lang === "mn" ? `${max}-аас ${formatNumber(n, 1)}` : `${formatNumber(n, 1)} out of ${max}`;
  }
  const formatted = formatValue(key, value, lang);
  // inside a sentence ("Got it, clear." / "Ойлголоо, тод.") the display label loses its capital
  if (def.type === "category" || def.type === "boolean") return formatted.charAt(0).toLowerCase() + formatted.slice(1);
  if (lang === "mn") {
    for (const [suffix, speak] of Object.entries(MN_SPOKEN_UNITS)) {
      if (formatted.endsWith(` ${suffix}`)) return speak(formatted.slice(0, formatted.length - suffix.length - 1));
    }
  }
  if (lang === "en" && def.unit && n !== null) {
    const words = EN_SPOKEN_UNITS[def.unit];
    if (words && formatted.endsWith(` ${def.unit}`)) {
      const base = formatted.slice(0, formatted.length - def.unit.length - 1);
      return `${base} ${n === 1 ? words[0] : words[1]}`;
    }
  }
  return formatted;
}

/* ───────────── greeting and small talk ───────────── */

/** the name as Cosmo says it: Mongolian Cyrillic for the four known crew, the name as is otherwise */
export function greetingName(crew: CrewPublic, lang: Lang): string {
  if (lang === "mn") {
    return MN_NAMES[crew.id.toLowerCase()] ?? MN_NAMES[crew.name.toLowerCase()] ?? crew.name;
  }
  return crew.name;
}

export function greeting(crew: CrewPublic, lang: Lang): string {
  const name = greetingName(crew, lang);
  return lang === "mn"
    ? `Сайн уу, ${name}! Би Cosmo байна. Өнөөдөр ямар байна даа?`
    : `Hi ${name}, I'm Cosmo. How are you feeling today?`;
}

type Mood = "tired" | "stressed" | "low" | "positive" | "neutral";

const MOOD_PATTERNS: ReadonlyArray<readonly [Mood, RegExp]> = [
  ["tired", /(?<![\p{L}])(?:tired|exhausted|sleepy|drained|worn out|ядар[\p{L}]*|нойр[\p{L}]*|унтаагүй)/iu],
  ["stressed", /(?<![\p{L}])(?:stress[\p{L}]*|anxious|worried|tense|overwhelmed|стресс[\p{L}]*|түгш[\p{L}]*|дарамт[\p{L}]*|санаа\s+зов[\p{L}]*)/iu],
  [
    "low",
    /(?<![\p{L}])(?:bad|terrible|awful|rough|sad|down|low|unwell|sick|not\s+(?:so\s+|very\s+|that\s+|too\s+)?(?:good|great|well)|муу|гунигтай|тааламжгүй|сайн\s+биш|сайн\s+бус|өвд[\p{L}]*)/iu,
  ],
  [
    "positive",
    /(?<![\p{L}])(?:good|great|fine|well|happy|rested|energetic|ok|okay|awesome|wonderful|excellent|amazing|ready|сайн|сайхан|гайхалтай|жаргалтай|амарсан|эрч\s+хүчтэй|баяртай|зүгээр|дажгүй)(?![\p{L}])/iu,
  ],
];

const SMALL_TALK: Record<Lang, Record<Mood, readonly string[]>> = {
  en: {
    tired: [
      "Sorry to hear you're tired, so let's keep this quick and gentle.",
      "That sounds like a long stretch, and thank you for telling me.",
    ],
    stressed: [
      "I hear you, so let's take it one step at a time.",
      "Thanks for telling me, and we'll go at your pace.",
    ],
    low: [
      "I'm sorry it's not an easy day, and I'm glad you told me.",
      "Thank you for being open about it, and let's take today gently.",
    ],
    positive: ["That's good to hear.", "Glad you're feeling well today."],
    neutral: ["Thanks for sharing that with me.", "It's good to hear from you."],
  },
  mn: {
    tired: [
      "Ядарсан байна гэж ойлголоо, өнөөдөр бүгдийг хөнгөн хийцгээе.",
      "Хэцүү өдөр байсан бололтой, хэлсэнд баярлалаа.",
    ],
    stressed: [
      "Ойлголоо, нэг нэгээр нь аажмаар хийцгээе.",
      "Хэлсэнд баярлалаа, таны хурдаар явъя.",
    ],
    low: [
      "Амар өдөр биш байна гэж ойлголоо, хэлсэнд баярлалаа.",
      "Нээрэн хэлсэнд баярлалаа, өнөөдрийг зөөлөн өнгөрүүлье.",
    ],
    positive: ["Сайн байгаа нь таатай байна.", "Сайхан сонсогдлоо."],
    neutral: ["Хуваалцсанд баярлалаа.", "Тантай ярилцахад таатай байна."],
  },
};

/** one warm sentence; the wording follows the mood words in the reply and varies with the turn number */
export function smallTalkReply(lang: Lang, turnIndex: number, userText: string): string {
  let mood: Mood = "neutral";
  for (const [m, re] of MOOD_PATTERNS) {
    if (re.test(userText)) {
      mood = m;
      break;
    }
  }
  const variants = SMALL_TALK[lang][mood];
  const index = ((Math.trunc(turnIndex) % variants.length) + variants.length) % variants.length;
  return variants[index];
}

export function proposeMeasurements(lang: Lang): string {
  return lang === "mn" ? "Хоёулаа өнөөдрийн хэмжилтүүдээ хийх үү?" : "Shall we log today's measurements together?";
}

/* ───────────── questions ───────────── */

const SYMPTOM_KEYS: KpiKey[] = ["symptom_headache", "symptom_dizziness", "symptom_nausea"];
const SYMPTOM_NAMES: Record<Lang, Record<string, string>> = {
  en: { symptom_headache: "a headache", symptom_dizziness: "dizziness", symptom_nausea: "nausea" },
  mn: { symptom_headache: "толгой өвдөлт", symptom_dizziness: "толгой эргэлт", symptom_nausea: "дотор муухайрах" },
};

/** short acknowledgement of what was just recorded: "Got it, 7 hours." */
function acknowledgement(ack: InterpretedRecord[], lang: Lang): string {
  if (ack.length === 0) return "";
  const byKey = new Map<KpiKey, InterpretedRecord>(ack.map((r) => [r.key, r]));
  const opener = lang === "mn" ? "Ойлголоо" : "Got it";

  const symptomRecords = SYMPTOM_KEYS.filter((k) => byKey.has(k));
  if (symptomRecords.length > 0) {
    const present = symptomRecords.filter((k) => asNumber(byKey.get(k)?.value) === 1);
    if (present.length === 0) {
      return lang === "mn" ? "Шинж тэмдэг алга гэж тэмдэглэлээ." : "No symptoms, noted.";
    }
    const names = present.map((k) => SYMPTOM_NAMES[lang][k]);
    return lang === "mn" ? `Тэмдэглэлээ: ${names.join(", ")}.` : `Noted: ${names.join(" and ")}.`;
  }

  const parts: string[] = [];
  const sys = byKey.get("bp_systolic");
  const dia = byKey.get("bp_diastolic");
  if (sys && dia) {
    const s = formatNumber(asNumber(sys.value) ?? 0, 0);
    const d = formatNumber(asNumber(dia.value) ?? 0, 0);
    parts.push(lang === "mn" ? `${s} дээр ${d}` : `${s} over ${d}`);
  }
  let assumed = false;
  for (const r of ack) {
    if (r.key === "bp_systolic" || r.key === "bp_diastolic" || r.key === "symptom_note") continue;
    if (KPI_DEFS[r.key].type === "text") {
      return lang === "mn" ? "Тэмдэглэлээ." : "Noted.";
    }
    const spoken = spokenValue(r.key, r.value, lang);
    // a loose answer read with a rule of thumb ("3 glasses", "6-7 hours") says that reading (assumptions.ts)
    const note = assumptionNote(r, lang, spoken);
    if (note?.check) assumed = true;
    parts.push(note?.text ?? spoken);
  }
  if (parts.length === 0) return lang === "mn" ? "Тэмдэглэлээ." : "Noted.";
  // a value past a general danger threshold is never acknowledged blandly (valueChecks.ts)
  return join([`${opener}, ${parts.join(", ")}.`, assumed ? ASSUMPTION_CHECK[lang] : "", dangerNotice(ack, lang)]);
}

/** the registry prompt for q, preceded by a short acknowledgement of what was just recorded */
export function askQuestion(q: QuestionDef, lang: Lang, ack?: InterpretedRecord[]): string {
  return join([acknowledgement(ack ?? [], lang), wellbeingNote(ack ?? [], lang), q.prompts[lang]]);
}

/* ───────────── the wellbeing check: a warm, non-diagnostic word after a low answer ───────────── */

/** the wellbeing answer counts as low (a yellow "watch" on the dashboard) */
export function isLowWellbeing(key: KpiKey, value: MeasurementValue): boolean {
  const n = asNumber(value);
  if (n === null) return false;
  if (key === "stress") return n >= 4;
  if (key === "mood" || key === "sleep_quality" || key === "energy" || key === "connection") return n <= 2;
  return false;
}

const WELLBEING_WORDS: Readonly<Record<string, Record<Lang, string>>> = {
  mood: {
    en: "Thank you for telling me honestly, that matters.",
    mn: "Үнэнээ хэлсэнд баярлалаа, энэ чухал.",
  },
  sleep_quality: {
    en: "A rough night makes everything feel harder.",
    mn: "Муу унтсан шөнийн дараа бүх зүйл хэцүү санагддаг.",
  },
  energy: {
    en: "It sounds like you are running low today.",
    mn: "Өнөөдөр хүч тамир тань бага байгаа бололтой.",
  },
  stress: {
    en: "That sounds like a lot to carry.",
    mn: "Их ачаа үүрч байгаа юм шиг сонсогдож байна.",
  },
  connection: {
    en: "Feeling far from people is hard up here.",
    mn: "Хүмүүсээс хол байгаа мэдрэмж энд үнэхээр хэцүү.",
  },
};

const WELLBEING_SUGGESTION: Readonly<Record<string, Record<Lang, string>>> = {
  mood: {
    en: "A short break or a talk with a crewmate can help, and the flight surgeon and the support team on Earth are always there to listen.",
    mn: "Богино завсарлага эсвэл багийн гишүүнтэйгээ ярилцах нь тусалж болно, нислэгийн эмч болон Дэлхий дээрх дэмжлэгийн баг үргэлж сонсоход бэлэн.",
  },
  sleep_quality: {
    en: "If you can, keep tonight's wind-down quiet and the lights low.",
    mn: "Боломжтой бол өнөө орой тайван, гэрлээ бүдэг байлгаж амраарай.",
  },
  energy: {
    en: "Short rests between tasks and enough water can help.",
    mn: "Ажлын хооронд богино амрах, хангалттай ус уух нь тусалж болно.",
  },
  stress: {
    en: "A few slow breaths or a short pause can help, and the flight surgeon or the support team on Earth are there if you want to talk.",
    mn: "Хэдэн удаа удаан амьсгалах эсвэл түр завсарлах нь тусалж болно, ярилцмаар байвал нислэгийн эмч эсвэл Дэлхий дээрх дэмжлэгийн баг бэлэн байна.",
  },
  connection: {
    en: "A chat with a crewmate or a call home could help, and the support team on Earth can set one up.",
    mn: "Багийн гишүүнтэйгээ ярилцах эсвэл гэр лүүгээ залгах нь тусалж болно, Дэлхий дээрх дэмжлэгийн баг үүнийг зохион байгуулж өгнө.",
  },
};

/**
 * After a low wellbeing answer (mood or sleep quality, energy, feeling connected at 1-2, stress at 4-5): one warm
 * sentence and one practical suggestion, never a diagnosis or a drug. Only the first low answer of the turn is
 * spoken to. Empty for everything else. (The crisis path is separate and always wins: companion.ts detectCrisis.)
 */
export function wellbeingNote(ack: ReadonlyArray<{ key: KpiKey; value: MeasurementValue }>, lang: Lang): string {
  const low = ack.find((r) => WELLBEING_WORDS[r.key] && isLowWellbeing(r.key, r.value));
  if (!low) return "";
  return join([WELLBEING_WORDS[low.key][lang], WELLBEING_SUGGESTION[low.key][lang]]);
}

/* ───────────── the sensor feed: what Cosmo says before the first question ───────────── */

type SensorFlagText = { key: KpiKey; value: number; usual: number | null; direction: "high" | "low" };

const SENSOR_NAMES: Readonly<Partial<Record<KpiKey, Record<Lang, string>>>> = {
  heart_rate: { en: "your resting heart rate", mn: "тайван үеийн пульс" },
  bp_systolic: { en: "your blood pressure", mn: "цусны даралт" },
  bp_diastolic: { en: "your blood pressure", mn: "цусны даралт" },
  temperature_c: { en: "your temperature", mn: "биеийн температур" },
  glucose_mgdl: { en: "your glucose patch", mn: "сахарын мэдрэгч" },
  sleep_hours: { en: "your sleep watch", mn: "нойрны цаг" },
  water_ml: { en: "your drink log", mn: "усны бүртгэл" },
  exercise_min: { en: "your exercise log", mn: "дасгалын бүртгэл" },
};

/** "your resting heart rate was 82 beats per minute, higher than your usual 64" */
function sensorFlagSentence(f: SensorFlagText, values: Partial<Record<KpiKey, MeasurementValue>>, lang: Lang): string {
  const name = SENSOR_NAMES[f.key]?.[lang] ?? lowerLabel(f.key, lang);
  let shown: string;
  if (f.key === "bp_systolic" || f.key === "bp_diastolic") {
    const s = asNumber(values.bp_systolic);
    const d = asNumber(values.bp_diastolic);
    shown =
      s !== null && d !== null
        ? lang === "mn"
          ? `${formatNumber(s, 0)} дээр ${formatNumber(d, 0)}`
          : `${formatNumber(s, 0)} over ${formatNumber(d, 0)}`
        : spokenValue(f.key, f.value, lang);
  } else {
    shown = spokenValue(f.key, f.value, lang);
  }
  // the usual level as a bare number (the unit was just said); for blood pressure it is the upper number
  const bp = f.key === "bp_systolic" || f.key === "bp_diastolic";
  const usualNum = f.usual !== null ? formatNumber(roundUsual(f.key, f.usual), KPI_DEFS[f.key].type === "number" ? 1 : 0) : null;
  const usual = usualNum === null ? null : bp ? (lang === "mn" ? `дээд даралт ${usualNum}` : `upper number of ${usualNum}`) : usualNum;
  const high = f.direction === "high";
  if (lang === "mn") {
    const verb =
      f.key === "sleep_hours" ? `${shown} унтсан гэж бүртгэсэн` : f.key === "water_ml" || f.key === "exercise_min" ? `${shown} гэж бүртгэсэн` : `${shown} байна`;
    const cmp = usual
      ? `ердийнхөөсөө ${high ? "их" : "бага"} байна (таны дундаж ${usual})`
      : `демо хүрээнээс ${high ? "дээгүүр" : "доогуур"} байна`;
    return `${name.charAt(0).toLocaleUpperCase("mn")}${name.slice(1)} ${verb}, ${cmp}.`;
  }
  const verb =
    f.key === "sleep_hours"
      ? `logged ${shown} of sleep`
      : f.key === "water_ml"
        ? `shows ${shown} in the last day`
        : f.key === "exercise_min"
          ? `shows ${shown}`
          : f.key === "glucose_mgdl"
            ? `reads ${shown}`
            : `was ${shown}`;
  const cmp = usual ? `${high ? "higher" : "lower"} than your usual ${usual}` : `${high ? "above" : "below"} the demo range`;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${verb}, ${cmp}.`;
}

function roundUsual(key: KpiKey, v: number): number {
  const def = KPI_DEFS[key];
  if (def.type === "number") return Math.round(v * 10) / 10;
  if (key === "water_ml") return Math.round(v / 50) * 50;
  return Math.round(v);
}

/**
 * Said before the first question of the check-in when the sensor feed filled values: that the sensors already logged
 * sleep and the morning vitals (so they are not asked), then the unusual readings, or that everything looks usual.
 * Every number comes from the stored values and the person's own baseline. Empty without a feed.
 */
export function sensorIntro(
  sensor: { keys: readonly KpiKey[]; flagged: readonly SensorFlagText[] } | null,
  values: Partial<Record<KpiKey, MeasurementValue>>,
  lang: Lang,
): string {
  if (!sensor || sensor.keys.length === 0) return "";
  const lead =
    lang === "mn"
      ? "Таны мэдрэгчүүд нойр, пульс, даралт, температур, дасгал, усыг аль хэдийн бүртгэсэн тул хэдхэн зүйл л асууя."
      : "Your sensors already logged your sleep, heart rate, blood pressure, temperature, exercise and water, so I only have a few questions.";
  if (sensor.flagged.length === 0) {
    return join([lead, lang === "mn" ? "Бүгд таны ердийн хүрээнд байна." : "Everything looks within your usual range."]);
  }
  return join([lead, ...sensor.flagged.map((f) => sensorFlagSentence(f, values, lang))]);
}

/** the unusual body readings again, said before the sensor follow-up question when it is asked later (resume) */
export function sensorCheckLead(
  sensor: { flagged: readonly SensorFlagText[] } | null,
  values: Partial<Record<KpiKey, MeasurementValue>>,
  lang: Lang,
): string {
  if (!sensor || sensor.flagged.length === 0) return "";
  return join(sensor.flagged.map((f) => sensorFlagSentence(f, values, lang)));
}

/** the allowed range for a single-number question, in words: "between 0 and 14 hours" */
function rangeHint(q: QuestionDef, lang: Lang): string {
  if (q.keys.length !== 1) return "";
  const def = KPI_DEFS[q.keys[0]];
  if (def.min === undefined || def.max === undefined) return "";
  if (def.type === "boolean" || def.type === "category" || def.type === "text") return "";
  const lo = def.min;
  const hi = def.max;
  const unit = def.unit ? (lang === "en" ? (EN_SPOKEN_UNITS[def.unit]?.[1] ?? def.unit) : formatValue(def.key, 1, "mn").replace(/^[\d.,]+\s*/u, "")) : "";
  const u = unit ? ` ${unit}` : "";
  return lang === "mn"
    ? `${formatNumber(lo, 2)}-${formatNumber(hi, 2)}${u} хооронд хэлнэ үү.`
    : `Please give a value between ${formatNumber(lo, 2)} and ${formatNumber(hi, 2)}${u}.`;
}

/**
 * A short re-ask after an answer that could not be used. `attempt` counts clarifications already made for this
 * question: 0 and 1 re-ask, 2 or more tell the person it can be added at the confirmation step instead.
 */
export function clarify(q: QuestionDef, lang: Lang, reason: ClarifyReason, attempt: number): string {
  const prompt = q.prompts[lang];
  if (attempt >= 2) {
    return lang === "mn"
      ? "Зүгээр, баталгаажуулах үедээ нэмж болно. Цааш үргэлжлүүлье."
      : "That's fine, we can add it when we confirm. Let's move on.";
  }
  const second = attempt >= 1;
  if (reason === "range") {
    const hint = rangeHint(q, lang);
    if (lang === "mn") {
      return join([second ? "Энэ утга хүрээнээс гадуур хэвээр байна." : "Энэ утга хэвийн хүрээнээс гадуур байна.", hint, "Дахин хэлнэ үү?"]);
    }
    return join([second ? "That still looks outside the range." : "That looks outside the expected range.", hint, "Could you say it again?"]);
  }
  // an example of an answer that works makes the second try easy (assumptions.ts)
  const example = answerExample(q.id, lang);
  if (reason === "type") {
    return lang === "mn"
      ? join([second ? "Тоо дахиад сонсогдсонгүй." : "Тоо сонсогдсонгүй.", prompt, example])
      : join([second ? "I still didn't catch a number." : "I didn't catch a number.", prompt, example]);
  }
  if (lang === "mn") {
    return second
      ? join(["Дахин сайн сонссонгүй.", prompt, example, "Эсвэл «алгасъя» гэж хэлбэл дараа нэмж болно."])
      : join(["Уучлаарай, сайн сонссонгүй.", prompt, example]);
  }
  return second
    ? join(["I still didn't catch that.", prompt, example, "Or say skip and we can add it later."])
    : join(["Sorry, I didn't catch that.", prompt, example]);
}

/* ───────────── confirmation ───────────── */

function shortNote(text: string): string {
  const t = text.trim();
  return t.length > 80 ? `${t.slice(0, 80).replace(/\s+\S*$/u, "")}…` : t;
}

/**
 * The compact read-back of everything stored, followed by the confirmation question. With `sources`, the readings
 * that came from the sensor feed are not read out one by one (they are on the dashboard): one sentence says they are
 * saved too, so the read-back holds only what the astronaut said.
 */
export function readBack(
  values: Partial<Record<KpiKey, MeasurementValue>>,
  lang: Lang,
  sources?: Partial<Record<KpiKey, string>>,
): string {
  const parts: string[] = [];
  const fromSensor = (k: KpiKey): boolean => sources?.[k] === "sensor";
  const sensorCount = (Object.keys(values) as KpiKey[]).filter(fromSensor).length;
  const present = (k: KpiKey): MeasurementValue | undefined => {
    if (fromSensor(k)) return undefined;
    const v = values[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim().length === 0) ? undefined : v;
  };

  for (const q of QUESTIONS) {
    // what the astronaut said about a sensor reading is an explanation, not a value to confirm
    if (q.id === "sensor_check") continue;
    if (q.id === "symptoms" && SYMPTOM_KEYS.every((k) => present(k) !== undefined)) {
      // one short phrase for the symptom answer: "no symptoms", or the ones that are present (and the note)
      const yes = SYMPTOM_KEYS.filter((k) => asNumber(present(k) as MeasurementValue) === 1);
      const vision = asNumber(present("vision_check") ?? null);
      const blurred = vision !== null && vision > 0;
      if (yes.length === 0 && !blurred) parts.push(lang === "mn" ? "шинж тэмдэг алга" : "no symptoms");
      else if (yes.length > 0) parts.push(yes.map((k) => SYMPTOM_NAMES[lang][k]).join(lang === "mn" ? ", " : " and "));
      const note = present("symptom_note");
      if (note !== undefined) parts.push(`${lowerLabel("symptom_note", lang)} ${shortNote(String(note))}`);
      continue;
    }
    // vision is asked inside the symptom question: "clear" is already said by "no symptoms"
    if (q.id === "vision" && asNumber(present("vision_check") ?? null) === 0 && SYMPTOM_KEYS.every((k) => present(k) !== undefined)) continue;
    if (q.id === "blood_pressure") {
      const s = present("bp_systolic");
      const d = present("bp_diastolic");
      if (s !== undefined && d !== undefined) {
        const label = lang === "mn" ? "цусны даралт" : "blood pressure";
        parts.push(`${label} ${formatValue("bp_systolic", s, lang)} ${lang === "mn" ? "дээр" : "over"} ${formatValue("bp_diastolic", d, lang)}`);
        continue;
      }
    }
    for (const key of q.keys) {
      const v = present(key);
      if (v === undefined) continue;
      const text = KPI_DEFS[key].type === "text" ? shortNote(String(v)) : formatValue(key, v, lang);
      parts.push(`${lowerLabel(key, lang)} ${text}`);
    }
  }

  const question = lang === "mn" ? "Бүгд зөв үү?" : "Is everything correct?";
  const sensorLine =
    sensorCount > 0 ? (lang === "mn" ? "Мэдрэгчийн үзүүлэлтүүд ч хадгалагдсан." : "Your sensor readings are saved too.") : "";
  if (parts.length === 0) return join([sensorLine, question]);
  const lead = sensorCount > 0 ? (lang === "mn" ? "Таны хэлснээр" : "Here is what you told me") : lang === "mn" ? "Миний тэмдэглэснээр" : "Here is what I have";
  return join([`${lead}: ${parts.join(", ")}.`, sensorLine, question]);
}

/** confirms a single corrected value, then asks again */
export function correctionAck(key: KpiKey, value: MeasurementValue, lang: Lang): string {
  const text = KPI_DEFS[key].type === "text" ? shortNote(String(value)) : formatValue(key, value, lang);
  const danger = dangerNotice([{ key, value }], lang);
  return lang === "mn"
    ? join([`Заслаа: ${lowerLabel(key, lang)} ${text}.`, danger, "Одоо бүгд зөв үү?"])
    : join([`Updated: ${lowerLabel(key, lang)} ${text}.`, danger, "Is everything correct now?"]);
}

export function askWhatToChange(lang: Lang): string {
  return lang === "mn" ? "За, юуг засах вэ?" : "Of course. What would you like to change?";
}

/* ───────────── summary ───────────── */

/** calm notice for a red flag: an alert, people are informed, never a diagnosis */
export function redFlagNotice(flags: RedFlag[], lang: Lang): string {
  if (flags.length === 0) return "";
  return lang === "mn"
    ? "Энэ нь анхааруулга. Багийн эмнэлгийн офицер болон газрын хяналтад мэдэгдэж байна, эмнэлгийн офицертойгоо удахгүй ярилцахыг зөвлөе."
    : "I've marked this as an alert. Your crew medical officer and ground are being informed, and I'd suggest speaking with the medical officer soon.";
}

const MAX_SPOKEN_FINDINGS = 2;
const MAX_SPOKEN_RECOMMENDATIONS = 2;

/**
 * What Cosmo says after the confirmation: one line of overall status, up to two findings, up to two suggestions,
 * the red-flag notice when there is one, and the disclaimer. Everything is decided by code; this only words it.
 */
export function summarySpeech(summary: SummaryFindings, lang: Lang): string {
  const parts: string[] = [sentence(summary.headline[lang])];

  for (const finding of summary.findings.slice(0, MAX_SPOKEN_FINDINGS)) {
    parts.push(sentence(finding.text[lang]));
  }

  const titles = summary.recommendations
    .slice(0, MAX_SPOKEN_RECOMMENDATIONS)
    .map((t) => t.title[lang].replace(/[.!?]+$/u, ""));
  if (titles.length > 0) {
    const lead = titles.length === 1 ? "One suggestion" : "Two suggestions";
    parts.push(
      lang === "mn"
        ? `Өнөөдөр санал болгох зүйл: ${titles.join("; ")}.`
        : `${lead} for today: ${titles.join("; ")}.`,
    );
  }

  if (summary.redFlags.length > 0) parts.push(redFlagNotice(summary.redFlags, lang));
  parts.push(sentence(summary.disclaimer[lang]));
  return join(parts);
}

export function closing(lang: Lang): string {
  return lang === "mn"
    ? "Баярлалаа. Өнөөдөр өөрийгөө сайн арчлаарай, надад хэрэг болвол би энд байна."
    : "Thank you. Take care of yourself today, and I'm here whenever you need me.";
}

/** the avatar emotion that goes with each kind of line */
export function emotionFor(
  kind: "greeting" | "question" | "clarify" | "confirm" | "summary" | "redflag",
): "neutral" | "happy" | "concerned" {
  switch (kind) {
    case "greeting":
      return "happy";
    case "redflag":
      return "concerned";
    default:
      return "neutral";
  }
}
