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
  if (lang === "mn") {
    if (def.type === "category" || def.type === "boolean") return formatted.charAt(0).toLowerCase() + formatted.slice(1);
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
  for (const r of ack) {
    if (r.key === "bp_systolic" || r.key === "bp_diastolic" || r.key === "symptom_note") continue;
    if (KPI_DEFS[r.key].type === "text") {
      return lang === "mn" ? "Тэмдэглэлээ." : "Noted.";
    }
    parts.push(spokenValue(r.key, r.value, lang));
  }
  if (parts.length === 0) return lang === "mn" ? "Тэмдэглэлээ." : "Noted.";
  return `${opener}, ${parts.join(", ")}.`;
}

/** the registry prompt for q, preceded by a short acknowledgement of what was just recorded */
export function askQuestion(q: QuestionDef, lang: Lang, ack?: InterpretedRecord[]): string {
  return join([acknowledgement(ack ?? [], lang), q.prompts[lang]]);
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
  if (reason === "type") {
    return lang === "mn"
      ? join([second ? "Тоо дахиад сонсогдсонгүй." : "Тоо сонсогдсонгүй.", prompt])
      : join([second ? "I still didn't catch a number." : "I didn't catch a number.", prompt]);
  }
  if (lang === "mn") {
    return second
      ? join(["Дахин сайн сонссонгүй.", prompt, "Эсвэл «алгасъя» гэж хэлбэл дараа нэмж болно."])
      : join(["Уучлаарай, сайн сонссонгүй.", prompt]);
  }
  return second
    ? join(["I still didn't catch that.", prompt, "Or say skip and we can add it later."])
    : join(["Sorry, I didn't catch that.", prompt]);
}

/* ───────────── confirmation ───────────── */

function shortNote(text: string): string {
  const t = text.trim();
  return t.length > 80 ? `${t.slice(0, 80).replace(/\s+\S*$/u, "")}…` : t;
}

/** the compact read-back of everything stored, followed by the confirmation question */
export function readBack(values: Partial<Record<KpiKey, MeasurementValue>>, lang: Lang): string {
  const parts: string[] = [];
  const present = (k: KpiKey): MeasurementValue | undefined => {
    const v = values[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim().length === 0) ? undefined : v;
  };

  for (const q of QUESTIONS) {
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
  if (parts.length === 0) return question;
  const lead = lang === "mn" ? "Миний тэмдэглэснээр" : "Here is what I have";
  return `${lead}: ${parts.join(", ")}. ${question}`;
}

/** confirms a single corrected value, then asks again */
export function correctionAck(key: KpiKey, value: MeasurementValue, lang: Lang): string {
  const text = KPI_DEFS[key].type === "text" ? shortNote(String(value)) : formatValue(key, value, lang);
  return lang === "mn"
    ? `Заслаа: ${lowerLabel(key, lang)} ${text}. Одоо бүгд зөв үү?`
    : `Updated: ${lowerLabel(key, lang)} ${text}. Is everything correct now?`;
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
