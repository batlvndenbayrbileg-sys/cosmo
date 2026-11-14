/**
 * Red flags (docs/DASHBOARD_PLAN.md section 2, step 4).
 * Rules: VITAL_RED, HEADACHE_PLUS_VISION, SERIOUS_SYMPTOM_WORD. Texts are calm, say "alert", never claim a diagnosis,
 * and tell the person that the crew medical officer and ground are informed.
 */

import type { KpiKey, MeasurementValue, RedFlag } from "../types";
import { KPI_DEFS, asNumber, formatValue } from "../kpi/registry";
import type { IndicatorEval } from "./status";

/** vitals whose own red status raises VITAL_RED */
export const VITAL_RED_KEYS: KpiKey[] = [
  "bp_systolic",
  "bp_diastolic",
  "heart_rate",
  "temperature_c",
  "glucose_mgdl",
];

/** the two free-text keys scanned for serious words */
export const NOTE_KEYS: KpiKey[] = ["symptom_note", "day_note"];

/** editable keyword lists (lower case). English words match whole words; Mongolian stems match as substrings. */
export const SERIOUS_WORDS_EN: string[] = [
  "chest pain",
  "can't breathe",
  "cant breathe",
  "cannot breathe",
  "can not breathe",
  "faint",
  "fainted",
  "fainting",
  "unconscious",
  "severe pain",
];

export const SERIOUS_WORDS_MN: string[] = [
  "цээж өвд",
  "амьсгал давс",
  "амьсгал давч",
  "ухаан алд",
  "ухаан балр",
  "ухаан балар",
  "хүчтэй өвд",
];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** the serious words found in a note (empty array when none) */
export function findSeriousWords(text: string): string[] {
  const t = normalise(text);
  if (t.length === 0) return [];
  const hits: string[] = [];
  for (const word of SERIOUS_WORDS_EN) {
    const re = new RegExp(`(?:^|[^a-z'])${escapeRegExp(word)}(?:$|[^a-z'])`, "u");
    if (re.test(t)) hits.push(word);
  }
  for (const stem of SERIOUS_WORDS_MN) {
    if (t.includes(stem)) hits.push(stem);
  }
  return hits;
}

/**
 * Crisis words (companion mode, src/server/agent/companion.ts): self-harm, suicide, wanting to die, harming others.
 * Patterns, not plain words, because the phrasing varies ("I want to die", "I don't want to live anymore"). Matched on
 * the normalised text; Mongolian stems match inside words. Editable like the lists above. These never feed the
 * dashboard flags: they make Cosmo answer with the crisis template and raise a red alert at once.
 */
/** words that make a reflexive "hurt / cut / injure myself" intentional ("I want to hurt myself", not "I hurt myself on the treadmill") */
const SELF_HARM_INTENT =
  "(?:want(?:s|ed)?\\s+to|wanna|going\\s+to|gonna|thinking\\s+(?:about|of)|think\\s+(?:about|of)|thought\\s+(?:about|of)|feel(?:ing)?\\s+like|felt\\s+like|might|could|will|would|'ll|urge\\s+to|tempted\\s+to|try(?:ing)?\\s+to|tried\\s+to|plan(?:ning)?\\s+to)";
const HARM_VERB = "(?:hurt(?:ing)?|cut(?:ting)?|injur(?:e|ing)|harm(?:ing)?)";
const OTHERS = "(?:someone|somebody|him|her|them|people|everyone|everybody|a\\s+crewmate|my\\s+crewmates?|the\\s+crew)";

export const CRISIS_PATTERNS_EN: RegExp[] = [
  // killing / harming oneself counts in any form; hurting / cutting / injuring oneself is often an accident, so it needs
  // a word of intent in front, or an ongoing form that is not an accident ("I've been cutting myself")
  /\bkill(?:ing|ed)?\s+(?:my\s*self|myself)\b/u,
  /\bharm(?:ing)?\s+(?:my\s*self|myself)\b/u,
  // one word may sit in between ("might really hurt myself"), but not "have" / "never" ("could have hurt myself")
  new RegExp(`\\b${SELF_HARM_INTENT}\\s+(?:(?!have\\b|never\\b|not\\b)\\w+\\s+)?${HARM_VERB}\\s+(?:my\\s*self|myself)\\b`, "u"),
  /\b(?:hurting|cutting|injuring)\s+(?:my\s*self|myself)\b(?!\s+(?:on|while|when|with|shaving|by\s+accident|accidentally|at|during|in|again\s+on|playing|exercising|working))/u,
  /\bsuicid[a-z]*/u,
  /\bself[\s-]?harm/u,
  // "end it all", "take my own life" - never "take it all back"
  /\b(?:end(?:ing|ed)?|tak(?:e|ing))\s+my\s+(?:own\s+)?life\b/u,
  /\bend(?:ing)?\s+it\s+all\b/u,
  /\b(?:want|going|wish|like|ready|deserve)\s+to\s+die\b/u,
  /\bwanna\s+(?:to\s+)?die\b/u,
  /\bwish\s+i\s+(?:was|were)\s+dead\b/u,
  /\b(?:better\s+off|rather\s+be)\s+dead\b/u,
  /\b(?:don'?t|do\s+not|no\s+longer)\s+want\s+to\s+(?:live|be\s+alive|exist|wake\s+up)\b/u,
  /\b(?:don'?t|do\s+not|no\s+longer)\s+want\s+to\s+be\s+(?:here|around)(?:\s+any\s*more|\s+any\s+longer)?\b(?!\s+(?:for|at|doing|right\s+now|today|tonight|in\s+this))/u,
  /\bno\s+(?:reason|point)\s+(?:to|in)\s+(?:live|living|going\s+on)\b/u,
  new RegExp(
    `\\b(?:want\\s+to|wanna|going\\s+to|gonna|will|could|might|feel(?:ing)?\\s+like|felt\\s+like|thinking\\s+(?:about|of))\\s+(?:kill(?:ing)?|hurt(?:ing)?|harm(?:ing)?|attack(?:ing)?|stab(?:bing)?)\\s+${OTHERS}\\b`,
    "u",
  ),
];

/** Mongolian typed in Latin letters ("uhmeer baina", "amia horlomoor bna"): typed input is accepted, so it is checked too */
const CRISIS_PATTERNS_MN_LATIN: RegExp[] = [
  /(?<![\p{L}])[uü]+k?h(?:ch(?:i|ih)?)?m+e+r(?![\p{L}])/u,
  /(?<![\p{L}])amia?\s*k?horl/u,
  /(?<![\p{L}])[uoö]{1,2}r[iy]{1,2}g[uoö]{1,2}\s+(?:al(?:a?k?h|maar|chih|chmaar|ya|ii)|gemtee)/u,
  /(?<![\p{L}])amid?(?:a?r|ra)(?:k?h)?\s+k?h[uü]s(?:el)?(?:gui|\s+(?:alga|baihgui|bhgui|ugui))/u,
  /(?<![\p{L}])amid?a?rmaa?r\s*gui/u,
  /(?<![\p{L}])amid?ra(?:k?h)?[iy]+g\s+k?h[uü]s(?:e(?:k?h)?)?gui/u,
  /(?<![\p{L}])[uü]+k?hs[eö]n\s+(?:ni?|n)\s+deer/u,
];

export const CRISIS_PATTERNS_MN: RegExp[] = [
  /амиа\s*(?:хорло|егүүт|бусниул)/u,
  /амь\s+насаа\s+(?:хорло|егүүт|тасл)/u,
  /үхмээр|үхчихмээр|үхэхийг\s+хүс|үхье(?![\p{L}])|үхэх\s+хүсэл/u,
  /амьдрахыг\s+хүсэхгүй|амьдармааргүй|амьдрах\s+(?:хүсэл|утга)\s*(?:алга|байхгүй|үгүй)|амьдрах\s+(?:утгагүй|хүсэлгүй)/u,
  /амьд\s+байх(?:ыг)?\s+хүсэхгүй|амьд\s+байх\s+хүсэл(?:гүй|\s+(?:алга|байхгүй))/u,
  /үхсэн\s+(?:нь|минь)\s+дээр/u,
  /өөрийгөө\s+(?:гэмтээ|хорло|зүс|ал(?:ах|маар|чих|ъя))/u,
  /өөртөө\s+(?:гэмтэл|хор)\s+(?:учруул|хүргэ)/u,
  /(?:хүн|хүнийг|бусдыг|түүнийг|тэднийг|багийнхнаа|багийн\s+гишүүнийг)\s+(?:алмаар|алах\s+гэж|алчихмаар|алъя|гэмтээмээр|гэмтээх\s+гэж|зодмоор)/u,
  // without an object: "алчихмаар байна" (I want to kill [someone])
  /(?<![\p{L}])(?:алчихмаар|алмаар)(?![\p{L}])/u,
  ...CRISIS_PATTERNS_MN_LATIN,
];

/** the crisis phrases found in what was said (empty array when none) */
export function findCrisisWords(text: string): string[] {
  const t = normalise(text);
  if (t.length === 0) return [];
  const hits: string[] = [];
  for (const re of [...CRISIS_PATTERNS_EN, ...CRISIS_PATTERNS_MN]) {
    const m = re.exec(t);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function readout(key: KpiKey, value: MeasurementValue, lang: "en" | "mn"): string {
  return `${KPI_DEFS[key].labels[lang]} ${formatValue(key, value, lang)}`;
}

/**
 * Evaluates the three red-flag rules.
 * `indicatorEvals` are the per-key results of evaluateIndicator; the two value-based triggers
 * (vision_check = 2, mood = 1) read `today` directly.
 */
export function evaluateRedFlags(
  today: Partial<Record<KpiKey, MeasurementValue>>,
  indicatorEvals: Partial<Record<KpiKey, IndicatorEval>>,
): RedFlag[] {
  const flags: RedFlag[] = [];

  // VITAL_RED
  const vitalKeys: KpiKey[] = VITAL_RED_KEYS.filter((k) => indicatorEvals[k]?.status === "red");
  if (asNumber(today.vision_check) === 2) vitalKeys.push("vision_check");
  if (asNumber(today.mood) === 1) vitalKeys.push("mood");
  if (vitalKeys.length > 0) {
    const listEn = vitalKeys.map((k) => readout(k, today[k] as MeasurementValue, "en")).join(", ");
    const listMn = vitalKeys.map((k) => readout(k, today[k] as MeasurementValue, "mn")).join(", ");
    flags.push({
      rule: "VITAL_RED",
      keys: vitalKeys,
      text: {
        en: `Alert: in the alert range of the demo parameters: ${listEn}. Please tell your crew medical officer; ground is being informed too.`,
        mn: `Анхааруулга: демо параметрийн анхааруулах түвшинд байгаа заалт: ${listMn}. Багийн эмнэлгийн офицерт мэдэгдээрэй, газрын хяналтад мөн мэдэгдэнэ.`,
      },
    });
  }

  // HEADACHE_PLUS_VISION
  if (asNumber(today.symptom_headache) === 1 && (asNumber(today.vision_check) ?? 0) >= 1) {
    flags.push({
      rule: "HEADACHE_PLUS_VISION",
      keys: ["symptom_headache", "vision_check"],
      text: {
        en: "Alert: a headache together with a blurred vision check. Please tell your crew medical officer; ground is being informed too. The link between the two is suggested, not confirmed.",
        mn: "Анхааруулга: толгой өвдөлт хараа бүдгэрэлттэй хамт илэрлээ. Багийн эмнэлгийн офицерт мэдэгдээрэй, газрын хяналтад мөн мэдэгдэнэ. Хоёрын холбоо нь таамаглал бөгөөд батлагдаагүй.",
      },
    });
  }

  // SERIOUS_SYMPTOM_WORD
  const noteKeys = NOTE_KEYS.filter((k) => {
    const v = today[k];
    return typeof v === "string" && findSeriousWords(v).length > 0;
  });
  if (noteKeys.length > 0) {
    flags.push({
      rule: "SERIOUS_SYMPTOM_WORD",
      keys: noteKeys,
      text: {
        en: "Alert: your note mentions something that needs attention. Please tell your crew medical officer; ground is being informed too.",
        mn: "Анхааруулга: таны тэмдэглэлд анхаарах шаардлагатай зүйл дурдагдсан байна. Багийн эмнэлгийн офицерт мэдэгдээрэй, газрын хяналтад мөн мэдэгдэнэ.",
      },
    });
  }

  return flags;
}
