import type { Bilingual, Lang } from "../types";
import type {
  OnsetKind,
  PainItem,
  PainLocation,
  PainOnset,
  PainScriptPart,
  PainSeverity,
  PainSosStatus,
  SeverityWord,
} from "./types";

/**
 * Everything Cosmo says and the screen writes about a pain, in both languages. Code text only (no model wording), so
 * every number in it is the person's own (what they said, or a stored value) and no line names a condition or a
 * treatment. The data line always ends with "This is not a diagnosis."
 */

export const LOCATION_LABEL: Readonly<Record<PainLocation, Bilingual>> = {
  head: { en: "Head", mn: "Толгой" },
  eye: { en: "Eyes", mn: "Нүд" },
  ear: { en: "Ears", mn: "Чих" },
  tooth: { en: "Teeth and jaw", mn: "Шүд, эрүү" },
  throat: { en: "Throat and neck", mn: "Хоолой, хүзүү" },
  chest: { en: "Chest", mn: "Цээж" },
  abdomen: { en: "Abdomen", mn: "Хэвлий, гэдэс" },
  side: { en: "Side (flank)", mn: "Хажуу тал" },
  back: { en: "Back", mn: "Нуруу" },
  arm: { en: "Arms and shoulders", mn: "Гар, мөр" },
  leg: { en: "Legs and feet", mn: "Хөл" },
  joint: { en: "Joints", mn: "Үе мөч" },
  whole_body: { en: "Whole body", mn: "Бүх бие" },
};

/** "your head hurts" / "толгой тань өвдөж" */
const HURTS: Readonly<Record<PainLocation, Bilingual>> = {
  head: { en: "your head hurts", mn: "Толгой тань өвдөж байгааг" },
  eye: { en: "your eyes hurt", mn: "Нүд тань өвдөж байгааг" },
  ear: { en: "your ear hurts", mn: "Чих тань өвдөж байгааг" },
  tooth: { en: "your teeth or jaw hurt", mn: "Шүд, эрүү тань өвдөж байгааг" },
  throat: { en: "your throat or neck hurts", mn: "Хоолой, хүзүү тань өвдөж байгааг" },
  chest: { en: "your chest hurts", mn: "Цээж тань өвдөж байгааг" },
  abdomen: { en: "your stomach area hurts", mn: "Хэвлий, гэдэс тань өвдөж байгааг" },
  side: { en: "your side hurts", mn: "Хажуу тал тань өвдөж байгааг" },
  back: { en: "your back hurts", mn: "Нуруу тань өвдөж байгааг" },
  arm: { en: "your arm hurts", mn: "Гар тань өвдөж байгааг" },
  leg: { en: "your leg hurts", mn: "Хөл тань өвдөж байгааг" },
  joint: { en: "your joints hurt", mn: "Үе мөч тань өвдөж байгааг" },
  whole_body: { en: "your whole body hurts", mn: "Бүх бие тань өвдөж байгааг" },
};

const SEVERITY_WORD: Readonly<Record<SeverityWord, Bilingual>> = {
  mild: { en: "mild", mn: "бага зэрэг" },
  moderate: { en: "moderate", mn: "дунд зэрэг" },
  severe: { en: "severe", mn: "хүчтэй" },
};

/** "7 out of 10" / "10-аас 7"; the word when no number was said */
export function severityText(s: PainSeverity | null, lang: Lang): string {
  if (!s) return "";
  if (s.value !== null) return lang === "mn" ? `10-аас ${s.value}` : `${s.value} out of 10`;
  return s.word ? SEVERITY_WORD[s.word][lang] : "";
}

const ONSET_FIXED: Readonly<Partial<Record<OnsetKind, Bilingual>>> = {
  just_now: { en: "it just started", mn: "саяхан эхэлсэн" },
  this_morning: { en: "since this morning", mn: "өглөөнөөс хойш" },
  last_night: { en: "since last night", mn: "өчигдөр шөнөөс хойш" },
  today: { en: "since earlier today", mn: "өнөөдрөөс хойш" },
  yesterday: { en: "since yesterday", mn: "өчигдрөөс хойш" },
};

const ONSET_UNIT: Readonly<Record<"minutes" | "hours" | "days" | "weeks", { en: [string, string]; mn: string; few: Bilingual }>> = {
  minutes: { en: ["minute", "minutes"], mn: "минут", few: { en: "for a few minutes", mn: "хэдэн минут" } },
  hours: { en: ["hour", "hours"], mn: "цаг", few: { en: "for a few hours", mn: "хэдэн цаг" } },
  days: { en: ["day", "days"], mn: "хоног", few: { en: "for a few days", mn: "хэд хоног" } },
  weeks: { en: ["week", "weeks"], mn: "долоо хоног", few: { en: "for a few weeks", mn: "хэдэн долоо хоног" } },
};

function amountText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** "since this morning", "for about 2 hours" / "өглөөнөөс хойш", "2 цаг орчим" */
export function onsetText(o: PainOnset | null, lang: Lang): string {
  if (!o) return "";
  const fixed = ONSET_FIXED[o.kind];
  if (fixed) return fixed[lang];
  const unit = ONSET_UNIT[o.kind as keyof typeof ONSET_UNIT];
  if (o.amount === null) return unit.few[lang];
  if (lang === "mn") return `${amountText(o.amount)} ${unit.mn} орчим`;
  return `for about ${amountText(o.amount)} ${o.amount === 1 ? unit.en[0] : unit.en[1]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** the first sentence: what Cosmo understood */
function ackLine(location: PainLocation | null, severity: PainSeverity | null, onset: PainOnset | null, lang: Lang): string {
  const sev = severityText(severity, lang);
  const since = onsetText(onset, lang);
  if (lang === "mn") {
    const head = location ? `${HURTS[location].mn} ойлголоо` : "Өвдөж байгааг тань ойлголоо";
    const extra = [sev, since].filter(Boolean).join(", ");
    return `${head}${extra ? ` (${extra})` : ""}.`;
  }
  const head = location ? `I understand, ${HURTS[location].en}` : "I'm sorry it hurts";
  const extra = [sev, since].filter(Boolean).join(", ");
  return `${head}${extra ? `, ${extra}` : ""}.`;
}

/** the data line: up to two unusual items by name and number, then "not a diagnosis" */
function dataLine(items: readonly PainItem[], lang: Lang): string {
  const spoken = items.slice(0, 2).map((i) => {
    const how = i.band === "reported" || i.band === "flagged" ? "" : i.direction === "high" ? (lang === "mn" ? ", ердийнхөөс их" : ", higher than usual") : lang === "mn" ? ", ердийнхөөс бага" : ", lower than usual";
    const urgent = i.band === "danger" ? (lang === "mn" ? ", яаралтай түвшинд" : ", at an urgent level") : "";
    return `${i.spoken[lang]}${urgent || how}`;
  });
  if (items.length === 0) {
    return lang === "mn"
      ? "Энэ хэсэгтэй холбоотой таны бүртгэсэн үзүүлэлтүүд ердийн хэмжээнд байна. Энэ онош биш."
      : "Your recorded values for this area look usual. This is not a diagnosis.";
  }
  const more = items.length > 2 ? (lang === "mn" ? ` Нийт ${items.length} зүйлийг дэлгэцэнд харууллаа.` : ` All ${items.length} are on screen.`) : "";
  if (lang === "mn") return `Таны өгөгдөлд холбоотой байж болох зүйл: ${spoken.join("; ")}.${more} Энэ онош биш.`;
  return `In your data, this may be related: ${spoken.join("; and ")}.${more} This is not a diagnosis.`;
}

/** the guide names as Cosmo says them (src/lib/emergency built-in ids) */
const GUIDE_NAME: Readonly<Record<string, Bilingual>> = {
  "chest-pain": { en: "chest pain", mn: "цээжний өвдөлтийн" },
  "head-injury": { en: "head injury", mn: "толгойн гэмтлийн" },
  fainting: { en: "fainting", mn: "ухаан алдалтын" },
  choking: { en: "choking", mn: "хахалтын" },
  burns: { en: "burns", mn: "түлэгдэлтийн" },
  "severe-bleeding": { en: "bleeding", mn: "цус алдалтын" },
  anaphylaxis: { en: "allergic reaction", mn: "харшлын" },
  seizure: { en: "seizure", mn: "таталтын" },
  "not-breathing": { en: "not breathing", mn: "амьсгалгүй үеийн" },
  "call-for-help": { en: "get help", mn: "тусламж дуудах" },
};

function guideLine(guideId: string | null, urgent: boolean, lang: Lang): string {
  const name = guideId ? GUIDE_NAME[guideId] : undefined;
  if (urgent) {
    const open = name
      ? lang === "mn"
        ? `${cap(name.mn)} зааврыг дэлгэцэнд гаргалаа.`
        : `I'm opening the ${name.en} guide.`
      : "";
    const call =
      lang === "mn"
        ? "Багийн эмнэлгийн офицертой яг одоо холбогдоорой."
        : "Please contact the crew medical officer now.";
    return [open, call].filter(Boolean).join(" ");
  }
  if (!name) return "";
  return lang === "mn" ? `${cap(name.mn)} заавар хэрэгтэй бол дэлгэцэнд байна.` : `The ${name.en} guide is on screen if you need it.`;
}

function earthLine(p: { urgent: boolean; reportSent: boolean; sos: PainSosStatus | null; updated: boolean }, lang: Lang): string {
  if (p.urgent) {
    if (p.sos === "sent") {
      return lang === "mn"
        ? "Дэлхий рүү яаралтай мэдэгдэл энэ мэдээлэлтэй хамт илгээлээ. Камер зөвшөөрвөл нүүрний тань нэг зургийг хамт илгээнэ."
        : "I've sent an urgent alert to Earth with this report. If the camera allows, I'll send them one photo of your face.";
    }
    if (p.sos === "duplicate") {
      return lang === "mn"
        ? "Таны яаралтай мэдэгдэл Дэлхийд очсон байгаа, энэ мэдээллийг нэмж илгээлээ."
        : "Earth already has your urgent alert, and I've added this report.";
    }
    return lang === "mn"
      ? "Дэлхий рүү мэдэгдэл илгээж чадсангүй. Станцын өөрийн холбоогоор яг одоо холбогдоорой."
      : "I couldn't send the alert to Earth. Please use the station's own comms right now.";
  }
  if (!p.reportSent) {
    return lang === "mn" ? "Мэдээг Дэлхий рүү одоогоор илгээж чадсангүй." : "I couldn't send the report to Earth just now.";
  }
  if (p.updated) {
    return lang === "mn" ? "Дэлхийд илгээсэн мэдээг шинэчиллээ." : "I've updated your report on the Earth console.";
  }
  return lang === "mn" ? "Өвдөлтийн мэдээг Дэлхийн удирдлагын дэлгэц рүү илгээлээ." : "I've sent a pain report to the Earth console.";
}

export const WHERE_LINE: Bilingual = {
  en: "Where does it hurt? Tap the place on the body, or tell me.",
  mn: "Хаана өвдөж байна вэ? Биен дээрх газрыг дарах эсвэл надад хэлээрэй.",
};

export type DetailsAsk = "both" | "severity" | "onset";

const DETAILS_LINES: Readonly<Record<DetailsAsk, Bilingual>> = {
  both: {
    en: "How strong is it from 0 to 10, and since when?",
    mn: "0-ээс 10-ын хооронд хэр хүчтэй вэ, хэзээнээс эхэлсэн бэ?",
  },
  severity: { en: "How strong is it, from 0 to 10?", mn: "0-ээс 10-ын хооронд хэр хүчтэй вэ?" },
  onset: { en: "Since when has it hurt?", mn: "Хэзээнээс өвдөж эхэлсэн бэ?" },
};

/** what is still missing: both, the severity, or since when; null when both are known */
export function detailsAsk(severity: PainSeverity | null, onset: PainOnset | null): DetailsAsk | null {
  if (!severity && !onset) return "both";
  if (!severity) return "severity";
  if (!onset) return "onset";
  return null;
}

export function detailsLine(ask: DetailsAsk, lang: Lang): string {
  return DETAILS_LINES[ask][lang];
}

export const THANKS_LINE: Bilingual = { en: "Thank you.", mn: "Баярлалаа." };

export interface ScriptInput {
  lang: Lang;
  location: PainLocation | null;
  severity: PainSeverity | null;
  onset: PainOnset | null;
  items: readonly PainItem[];
  guideId: string | null;
  urgent: boolean;
  reportSent: boolean;
  sos: PainSosStatus | null;
  awaiting: "location" | "details" | null;
  /** a follow-up answer updated an earlier report */
  updated: boolean;
  /** the open check-in question, asked again at the end (mid check-in, when nothing else is asked) */
  resume: string | null;
}

/** Cosmo's line in parts, in the order she says them */
export function painScript(p: ScriptInput): PainScriptPart[] {
  const { lang } = p;
  const parts: PainScriptPart[] = [];
  if (p.updated) {
    const said = [severityText(p.severity, lang), onsetText(p.onset, lang)].filter(Boolean).join(", ");
    parts.push({ step: "ack", text: `${THANKS_LINE[lang]}${said ? (lang === "mn" ? ` ${cap(said)}.` : ` ${cap(said)}.`) : ""}` });
  } else {
    parts.push({ step: "ack", text: ackLine(p.location, p.severity, p.onset, lang) });
  }
  if (p.awaiting === "location") {
    parts.push({ step: "where", text: WHERE_LINE[lang] });
    // urgent words without a place still go to Earth at once
    if (p.urgent) {
      const g = guideLine(p.guideId, true, lang);
      if (g) parts.push({ step: "guide", text: g });
      parts.push({ step: "earth", text: earthLine(p, lang) });
    }
    return parts;
  }
  if (!p.updated) parts.push({ step: "data", text: dataLine(p.items, lang) });
  const g = guideLine(p.guideId, p.urgent, lang);
  if (g) parts.push({ step: "guide", text: g });
  parts.push({ step: "earth", text: earthLine(p, lang) });
  if (p.awaiting === "details") parts.push({ step: "ask", text: detailsLine(detailsAsk(p.severity, p.onset) ?? "both", lang) });
  else if (p.resume) parts.push({ step: "resume", text: p.resume });
  return parts;
}

export function scriptText(parts: readonly PainScriptPart[]): string {
  return parts.map((p) => p.text.trim()).filter(Boolean).join(" ");
}

/* ───────────── what a tap on the screen says ───────────── */

/**
 * A tapped place on the body map is sent as these words (in the check-in's language), so it takes the same path as
 * saying it: tests check that each one is read back as its place.
 */
export const TAP_PHRASE: Readonly<Record<PainLocation, Bilingual>> = {
  head: { en: "My head hurts", mn: "Толгой өвдөж байна" },
  eye: { en: "My eyes hurt", mn: "Нүд өвдөж байна" },
  ear: { en: "My ear hurts", mn: "Чих өвдөж байна" },
  tooth: { en: "My tooth hurts", mn: "Шүд өвдөж байна" },
  throat: { en: "My throat hurts", mn: "Хоолой өвдөж байна" },
  chest: { en: "My chest hurts", mn: "Цээж өвдөж байна" },
  abdomen: { en: "My stomach hurts", mn: "Гэдэс өвдөж байна" },
  side: { en: "My side hurts", mn: "Хажуу өвдөж байна" },
  back: { en: "My back hurts", mn: "Нуруу өвдөж байна" },
  arm: { en: "My arm hurts", mn: "Гар өвдөж байна" },
  leg: { en: "My leg hurts", mn: "Хөл өвдөж байна" },
  joint: { en: "My joints hurt", mn: "Үе мөч өвдөж байна" },
  whole_body: { en: "My whole body hurts", mn: "Бүх бие өвдөж байна" },
};

/** the "since when" choices of the answer card; each is read back by readPainOnset */
export const ONSET_CHOICES: ReadonlyArray<{ id: string; label: Bilingual; say: Bilingual }> = [
  { id: "now", label: { en: "Just now", mn: "Саяхан" }, say: { en: "it just started", mn: "саяхан эхэлсэн" } },
  { id: "hours", label: { en: "A few hours", mn: "Хэдэн цаг" }, say: { en: "for a few hours", mn: "хэдэн цаг болж байна" } },
  { id: "morning", label: { en: "This morning", mn: "Өглөөнөөс" }, say: { en: "since this morning", mn: "өглөөнөөс хойш" } },
  { id: "yesterday", label: { en: "Yesterday", mn: "Өчигдрөөс" }, say: { en: "since yesterday", mn: "өчигдрөөс хойш" } },
  { id: "days", label: { en: "A few days", mn: "Хэд хоног" }, say: { en: "for a few days", mn: "хэд хоног болж байна" } },
];

/** the answer card's words: "6 out of 10, since this morning" / "10-аас 6, өглөөнөөс хойш" */
export function answerPhrase(severity: number | null, onsetId: string | null, lang: Lang): string {
  const onset = ONSET_CHOICES.find((o) => o.id === onsetId)?.say[lang] ?? "";
  const sev = severity === null ? "" : lang === "mn" ? `10-аас ${severity}` : `${severity} out of 10`;
  return [sev, onset].filter(Boolean).join(", ");
}
