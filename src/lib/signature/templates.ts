/**
 * Signature Triage templates, EN and MN (docs/SIGNATURE_SPEC.md section 7.1, build prompt T6). The sentences of the
 * four situations (a) new panel EXPECTED, (b) check-in suggests a draw (A2), (c1) recovery BASELINE, (c2)
 * off-trajectory UNEXPECTED are copied verbatim from the spec, numbers replaced by placeholders filled from the facts;
 * the Mongolian is not re-translated. Where the facts of a panel do not fit a spec sentence (two folds that differ, no
 * previous panel, no other large change, a class the spec has no dialogue for, advice rules A1 / A3 / A4 / A6), the
 * variant is assembled from the same spec sentences (recorded in docs/SIGNATURE_BUILD_NOTES.md, T6).
 *
 * These are also the fallback whenever the model's wording fails `assertNumbersGrounded` or lacks the disclaimer.
 */

import type { Lang } from "../types";
import { DSS_TRIGGER, UNEXPECTED_RETEST_DAYS } from "./config";
import {
  FOLLOW_UP_DAY,
  SCALE_MAX,
  SIGNATURE_DISCLAIMER,
  type DrawFacts,
  type FactsMarker,
  type SignatureFacts,
} from "./facts";

/* ───────────── Mongolian case endings after a numeral ───────────── */

/**
 * Ablative (-аас/-оос/-өөс/-ээс/-иос/-иас) and instrumental (-аар/...) endings written after digits follow the vowel of
 * the last spoken word of the number: 1 нэг, 2 хоёр, 3 гурав, 4 дөрөв, 5 тав, 6 зургаа, 7 долоо, 8 найм, 9 ес; tens
 * арав, хорь, гуч, дөч, тавь, жар, дал, ная, ер; зуу, мянга. Spec examples: 100-аас, 67-оос, 65-аас, 37-оос, 8-аас, 8-аар,
 * 40-өөс (addendum).
 */
const ABL_UNIT: Record<number, string> = { 1: "ээс", 2: "оос", 3: "аас", 4: "өөс", 5: "аас", 6: "аас", 7: "оос", 8: "аас", 9: "өөс" };
const ABL_TEN: Record<number, string> = { 1: "аас", 2: "иос", 3: "аас", 4: "өөс", 5: "иас", 6: "аас", 7: "аас", 8: "аас", 9: "ээс" };

function lastSpoken(n: string): { kind: "unit" | "ten" | "big" | "zero"; d: number } {
  const v = Math.abs(Math.trunc(Number(n)));
  if (v === 0) return { kind: "zero", d: 0 };
  if (v % 10 !== 0) return { kind: "unit", d: v % 10 };
  if (v % 100 !== 0) return { kind: "ten", d: (v % 100) / 10 };
  return { kind: "big", d: 0 };
}

/** "67" -> "67-оос" */
export function mnAbl(n: string): string {
  const s = lastSpoken(n);
  const end = s.kind === "unit" ? ABL_UNIT[s.d] : s.kind === "ten" ? ABL_TEN[s.d] : s.kind === "zero" ? "ээс" : "аас";
  return `${n}-${end}`;
}

/** "8" -> "8-аар" */
export function mnInst(n: string): string {
  const abl = mnAbl(n);
  return abl.replace(/с$/u, "р");
}

/* ───────────── helpers ───────────── */

function join(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(" ");
}

/** "IL-6 and MCP-1 are about 2.8 times your baseline." (spec (a)); variants when the folds differ or one marker only */
function markersSentence(top: readonly FactsMarker[], lang: Lang): string | null {
  const [m1, m2] = top;
  if (!m1) return null;
  if (lang === "mn") {
    if (!m2) return `${m1.marker} таны суурь түвшнээс ойролцоогоор ${m1.foldRounded} дахин өндөр байна.`;
    if (m1.foldRounded === m2.foldRounded) {
      return `${m1.marker} болон ${m2.marker} таны суурь түвшнээс ойролцоогоор ${m1.foldRounded} дахин өндөр байна.`;
    }
    return `${m1.marker} таны суурь түвшнээс ойролцоогоор ${m1.foldRounded} дахин, ${m2.marker} нь ${m2.foldRounded} дахин өндөр байна.`;
  }
  if (!m2) return `${m1.marker} is about ${m1.foldRounded} times your baseline.`;
  if (m1.foldRounded === m2.foldRounded) return `${m1.marker} and ${m2.marker} are about ${m1.foldRounded} times your baseline.`;
  return `${m1.marker} is about ${m1.foldRounded} times your baseline and ${m2.marker} is about ${m2.foldRounded} times.`;
}

/* ───────────── (a) new panel, EXPECTED_FLIGHT_RESPONSE ───────────── */

function templateA(f: SignatureFacts, lang: Lang): string {
  const [lo, hi] = f.band ?? [f.fri ?? "", f.fri ?? ""];
  const retest = f.recovery?.retestInDays;
  if (lang === "mn") {
    return join([
      "Таны цусны шинэ шинжилгээ ирлээ.",
      `Нислэгийн өмнөх өөрийн тань түвшинтэй харьцуулдаг зургаан үзүүлэлт нислэгийн дараах хариу урвалын хэв маягийг тод харуулж байна: Нислэгийн хариу урвалын индекс ${SCALE_MAX}-аас ${f.fri}, хэлбэлзэл нь ${mnAbl(lo)} ${hi}.`,
      markersSentence(f.topMarkers, lang),
      "Inspiration4-ийн дөрвөн гишүүнд газардсаны маргааш мөн ийм чиглэлийн өөрчлөлт гарсан тул энэ бол хүлээгдэж буй дүр зураг, шинэ асуудал биш.",
      `Тэдний дөрвөөс гурвынх нь ${FOLLOW_UP_DAY} дахь өдрийн дараагийн шинжилгээгээр суурь түвшиндээ буцсан байсан.`,
      "Миний санал: шингэнээ хэвийн ууж, шөнөдөө бүтэн унтаарай.",
      retest
        ? `Энэ долоо хоногт нэмэлт цус авах шаардлагагүй, ${retest} хоногийн дараа давтан шинжилгээ өгье.`
        : "Энэ долоо хоногт нэмэлт цус авах шаардлагагүй.",
      "Тэр хүртэл халуурах, хоолой өвдөх, арьсанд тууралт гарах шинж илэрвэл надад хэлээрэй.",
      SIGNATURE_DISCLAIMER.mn,
    ]);
  }
  return join([
    "Your new blood panel is in.",
    `The six markers I compare with your own pre-flight values show a clear flight-response pattern: Flight Response Index ${f.fri} out of ${SCALE_MAX}, range ${lo} to ${hi}.`,
    markersSentence(f.topMarkers, lang),
    "All four Inspiration4 crew moved in this direction one day after landing, so this is the expected picture, not a new problem.",
    `Three of the four were back in their baseline zone by the next sample at day ${FOLLOW_UP_DAY}.`,
    retest
      ? `My suggestion: normal fluids and a full night's sleep, no extra draw this week, and a re-test in ${retest} days.`
      : "My suggestion: normal fluids and a full night's sleep, and no extra draw this week.",
    "Tell me if you notice fever, a sore throat or a rash before then.",
    SIGNATURE_DISCLAIMER.en,
  ]);
}

/* ───────────── (c1) recovery, BASELINE after an elevated panel ───────────── */

function il6Sentence(f: SignatureFacts, lang: Lang): string | null {
  const il6 = f.leadMarker;
  if (!il6) return null;
  const fold = Number(il6.foldRounded);
  if (lang === "mn") {
    if (il6.foldRounded === "0.5") return "IL-6 одоо нислэгийн өмнөх суурь түвшний тань тал орчим байна.";
    if (fold < 1) return "IL-6 одоо нислэгийн өмнөх суурь түвшнээс тань доогуур байна.";
    return `IL-6 таны суурь түвшнээс ойролцоогоор ${il6.foldRounded} дахин өндөр байна.`;
  }
  if (il6.foldRounded === "0.5") return "IL-6 is now about half of your pre-flight baseline.";
  if (fold < 1) return "IL-6 is now below your pre-flight baseline.";
  return `IL-6 is about ${il6.foldRounded} times your baseline.`;
}

function hasGlucoseNote(f: SignatureFacts): boolean {
  return f.qcNotes.some((n) => /glucose|глюкоз/u.test(n));
}

function templateC1(f: SignatureFacts, lang: Lang): string {
  if (lang === "mn") {
    return join([
      "Давтан шинжилгээний мэдээ сайн байна.",
      `Таны индекс ${mnAbl(f.previousFri ?? "")} ${f.fri} болж буурсан тул эдгээр үзүүлэлт суурь түвшиндээ буцжээ.`,
      il6Sentence(f, lang),
      `Энэ нь Inspiration4-ийн дөрвөн гишүүний гуравт нь ${FOLLOW_UP_DAY} дахь өдөр ажиглагдсантай таарч байна.`,
      hasGlucoseNote(f) && "Нэг тэмдэглэл: энэ дээжийн глюкозын утга чанарын шалгалтад тэнцээгүй тул тооцоонд оруулаагүй.",
      "Энэ удаагийн хувьд дахин цус авах шаардлагагүй.",
      SIGNATURE_DISCLAIMER.mn,
    ]);
  }
  return join([
    "Good news from your re-test.",
    `Your index is ${f.fri}, down from ${f.previousFri}, so these markers are back in your baseline zone.`,
    il6Sentence(f, lang),
    `That matches what three of the four Inspiration4 crew showed by day ${FOLLOW_UP_DAY}.`,
    hasGlucoseNote(f) && "One note: the glucose value in this sample failed a quality check and was left out.",
    "No further draw is needed for this episode.",
    SIGNATURE_DISCLAIMER.en,
  ]);
}

/* ───────────── (c2) off-trajectory, UNEXPECTED_ACTIVATION ───────────── */

function templateC2(f: SignatureFacts, lang: Lang): string {
  const rose = f.previousFri !== null && f.fri !== null && Number(f.previousFri) < Number(f.fri);
  const m1 = f.topMarkers[0];
  const other = f.otherLargeChanges[0];
  const days = f.unexpectedRetestInDays ?? String(UNEXPECTED_RETEST_DAYS);
  if (lang === "mn") {
    const markers = m1
      ? other
        ? `${m1.marker} таны суурь түвшнээс ${m1.foldRounded} дахин, ${other.marker} нь ${other.foldRounded} дахин өндөр байна.`
        : `${m1.marker} таны суурь түвшнээс ${m1.foldRounded} дахин өндөр байна.`
      : null;
    return join([
      "Энэ бол миний хүлээж байсан сэргэлт биш байна.",
      rose
        ? `Таны индекс ${mnAbl(f.previousFri as string)} ${f.fri} болж өссөн, газардсанаас хойш ${f.daysSinceLanding} хоног өнгөрсөн тул нислэгийн нөлөөний хугацаанаас гадуур байна.`
        : `Таны индекс ${f.fri} байна, газардсанаас хойш ${f.daysSinceLanding} хоног өнгөрсөн тул нислэгийн нөлөөний хугацаанаас гадуур байна.`,
      markers,
      "Шалтгааныг цусны үзүүлэлтээр тодорхойлох боломжгүй.",
      "Одоо шинж тэмдгээ хамт шалгаад биеийн температураа хэмжье.",
      `${days} хоногийн дараа давтан шинжилгээ өгч, дараагийн холболтоор нислэгийн эмчид мэдэгдэхийг зөвлөж байна.`,
      SIGNATURE_DISCLAIMER.mn,
    ]);
  }
  const markers = m1
    ? other
      ? `${m1.marker} is ${m1.foldRounded} times your baseline and ${other.marker} is ${other.foldRounded} times.`
      : `${m1.marker} is ${m1.foldRounded} times your baseline.`
    : null;
  return join([
    "This is not the recovery I expected.",
    rose
      ? `Your index went up from ${f.previousFri} to ${f.fri}, and we are ${f.daysSinceLanding} days past landing, outside the flight window.`
      : `Your index is ${f.fri}, and we are ${f.daysSinceLanding} days past landing, outside the flight window.`,
    markers,
    "Blood markers cannot tell me the cause.",
    `Let's do a quick symptom check and take your temperature now, and I recommend a re-test in ${days} days and a note to the flight surgeon at the next contact.`,
    SIGNATURE_DISCLAIMER.en,
  ]);
}

/* ───────────── other classes (no spec dialogue; assembled from the spec sentences and the section 7.3 actions) ───────────── */

function templateOther(f: SignatureFacts, lang: Lang): string {
  const [lo, hi] = f.band ?? ["", ""];
  if (lang === "mn") {
    if (f.class === "INSUFFICIENT" || f.fri === null) {
      return join([
        "Таны цусны шинэ шинжилгээ ирлээ, гэвч зургаан үзүүлэлтийн хэт цөөн нь ашиглагдах боломжтой байсан тул индекс тооцоолох боломжгүй.",
        "Үүний тулд нэмэлт цус авах шаардлагагүй, дараагийн шинжилгээгээр дахин харъя.",
        SIGNATURE_DISCLAIMER.mn,
      ]);
    }
    if (f.class === "INDETERMINATE") {
      return join([
        "Таны цусны шинэ шинжилгээ ирлээ.",
        `Таны индекс ${SCALE_MAX}-аас ${f.fri}, хэлбэлзэл нь ${mnAbl(lo)} ${hi}: суурь түвшин болон нислэгийн дараах тод хариу урвалын хооронд байна.`,
        "Миний санал: нэмэлт цус авах шаардлагагүй, нойр болон шингэнээ тогтмол байлгаад дараагийн шинжилгээгээр дахин харъя.",
        SIGNATURE_DISCLAIMER.mn,
      ]);
    }
    return join([
      "Таны цусны шинэ шинжилгээ ирлээ.",
      `Таны индекс ${SCALE_MAX}-аас ${f.fri}, хэлбэлзэл нь ${mnAbl(lo)} ${hi} тул эдгээр үзүүлэлт суурь түвшиндээ байна.`,
      "Одоогоор нэмэлт цус авах шаардлагагүй, дараагийн ээлжит шинжилгээг цус авах зөвлөгөөний дагуу өгнө.",
      SIGNATURE_DISCLAIMER.mn,
    ]);
  }
  if (f.class === "INSUFFICIENT" || f.fri === null) {
    return join([
      "Your new blood panel is in, but too few of the six markers could be used to compute an index.",
      "No extra draw is needed for this; we look again at the next panel.",
      SIGNATURE_DISCLAIMER.en,
    ]);
  }
  if (f.class === "INDETERMINATE") {
    return join([
      "Your new blood panel is in.",
      `Your index is ${f.fri} out of ${SCALE_MAX}, range ${lo} to ${hi}: between your baseline zone and a clear flight-response pattern.`,
      "My suggestion: no extra draw, keep sleep and fluids regular, and we look again at the next panel.",
      SIGNATURE_DISCLAIMER.en,
    ]);
  }
  return join([
    "Your new blood panel is in.",
    `Your index is ${f.fri} out of ${SCALE_MAX}, range ${lo} to ${hi}, so these markers are in your baseline zone.`,
    "No extra draw is needed now; the next routine check follows the draw advice.",
    SIGNATURE_DISCLAIMER.en,
  ]);
}

export type TriageSituation = "a" | "c1" | "c2" | "other";

/** which spec situation a panel's facts fall in */
export function triageSituation(f: SignatureFacts): TriageSituation {
  if (f.fri === null) return "other";
  if (f.class === "EXPECTED_FLIGHT_RESPONSE") return "a";
  if (f.class === "UNEXPECTED_ACTIVATION") return "c2";
  if (
    f.class === "BASELINE" &&
    f.previousFri !== null &&
    f.previousClass !== null &&
    f.previousClass !== "BASELINE" &&
    Number(f.previousFri) > Number(f.fri)
  ) {
    return "c1";
  }
  return "other";
}

/** the deterministic triage answer for a panel's facts */
export function renderTriageTemplate(f: SignatureFacts, lang: Lang = f.lang): string {
  switch (triageSituation(f)) {
    case "a":
      return templateA(f, lang);
    case "c1":
      return templateC1(f, lang);
    case "c2":
      return templateC2(f, lang);
    case "other":
      return templateOther(f, lang);
  }
}

/* ───────────── (b) and the other draw-advice rules ───────────── */

function strainDetail(f: DrawFacts, lang: Lang): string | null {
  const sleep = f.sleepHours;
  const hr = f.restingHrAboveUsual;
  if (lang === "mn") {
    if (sleep && hr) return `Та ${sleep} орчим цаг унтсан, амралтын үеийн зүрхний цохилт тань ердийнхөөсөө ${mnInst(hr)} өндөр байна.`;
    if (sleep) return `Та ${sleep} орчим цаг унтсан.`;
    if (hr) return `Амралтын үеийн зүрхний цохилт тань ердийнхөөсөө ${mnInst(hr)} өндөр байна.`;
    return null;
  }
  if (sleep && hr) return `You slept about ${sleep} hours and your resting heart rate is ${hr} beats above your usual.`;
  if (sleep) return `You slept about ${sleep} hours.`;
  if (hr) return `Your resting heart rate is ${hr} beats above your usual.`;
  return null;
}

function sinceSentence(f: DrawFacts, lang: Lang): string {
  if (f.daysSinceLastPanel === null) return lang === "mn" ? "Одоогоор цусны шинжилгээ алга." : "There is no blood panel yet.";
  return lang === "mn"
    ? `Сүүлийн цусны шинжилгээнээс хойш ${f.daysSinceLastPanel} хоног өнгөрчээ.`
    : `Your last blood panel was ${f.daysSinceLastPanel} days ago.`;
}

function kitsSentence(f: DrawFacts, lang: Lang): string {
  return lang === "mn"
    ? `Танд ${mnAbl(f.kitsTotal)} ${f.kitsLeft} багц үлдсэн байна.`
    : `You have ${f.kitsLeft} of ${f.kitsTotal} kits left.`;
}

/** the deterministic draw-advice line; (b) is the spec's A2 dialogue */
export function renderDrawTemplate(f: DrawFacts, lang: Lang = f.lang): string {
  const opener = lang === "mn" ? "Баярлалаа, өнөөдрийн хэмжилтүүдийг бүртгэлээ." : "Thanks, that's today's check-in logged.";
  const disclaimer = SIGNATURE_DISCLAIMER[lang];
  switch (f.rule) {
    case "A2":
      if (lang === "mn") {
        return join([
          opener,
          `Нэг зүйл анзаарлаа: таны ачааллын оноо гурван өдөр дараалан ${DSS_TRIGGER}-аас дээш байна.`,
          strainDetail(f, lang),
          f.daysSinceLastPanel !== null && sinceSentence(f, lang),
          "Яг ийм үед цус авах нь нэг багцыг зарцуулах үнэ цэнтэй.",
          kitsSentence(f, lang),
          "Маргааш өглөө өглөөний цайны өмнө авахаар төлөвлөх үү?",
          disclaimer,
        ]);
      }
      return join([
        opener,
        `One thing I noticed: your strain score has been above ${DSS_TRIGGER} for three days in a row.`,
        strainDetail(f, lang),
        f.daysSinceLastPanel !== null && sinceSentence(f, lang),
        `This is the kind of moment where a draw is worth a kit; you have ${f.kitsLeft} of ${f.kitsTotal} left.`,
        "Shall I plan it for tomorrow morning before breakfast?",
        disclaimer,
      ]);
    case "A1":
      return join([
        opener,
        lang === "mn" ? "Төлөвлөсөн давтан шинжилгээ өгөх хугацаа боллоо." : "Your planned re-test is due now.",
        sinceSentence(f, lang),
        kitsSentence(f, lang),
        lang === "mn" ? "Өнөөдөр авахаар төлөвлөх үү?" : "Shall I plan the draw for today?",
        disclaimer,
      ]);
    case "A3":
      return join([
        opener,
        sinceSentence(f, lang),
        lang === "mn"
          ? "Тэр шинжилгээний хариу суурь түвшинд байсан, таны ачааллын оноо ч бага хэвээр байна."
          : "That panel was in your baseline zone and your strain score has stayed low.",
        lang === "mn"
          ? "Энэ удаа цус авах шаардлагагүй тул нэг багц хэмнэлээ."
          : "No draw is needed this time, so we save a kit.",
        kitsSentence(f, lang),
        f.dueInDays !== null &&
          (lang === "mn" ? `${f.dueInDays} хоногийн дараа дахин шалгая.` : `I will check again in ${f.dueInDays} days.`),
        disclaimer,
      ]);
    case "A4":
      return join([
        lang === "mn" ? "Ээлжит цус авах хугацаа боллоо." : "A routine blood draw is due.",
        sinceSentence(f, lang),
        kitsSentence(f, lang),
        disclaimer,
      ]);
    case "A6":
      return join([
        lang === "mn" ? "Өнөөдөр цус авах шаардлагагүй." : "No blood draw is needed today.",
        sinceSentence(f, lang),
        kitsSentence(f, lang),
        disclaimer,
      ]);
  }
}

/** rules whose advice Cosmo voices on its own after the daily summary (build prompt T6) */
export const SPOKEN_DRAW_RULES: ReadonlySet<DrawFacts["rule"]> = new Set(["A1", "A2", "A3"]);

/* ───────────── the offer after the check-in ───────────── */

/** "a new panel is in, ask me": said after the daily summary when a panel arrived since the last check-in */
export function renderTriageOffer(crew: string, lang: Lang): string {
  return lang === "mn"
    ? `Цусны шинэ шинжилгээ ирлээ: Inspiration4-ийн жишиг өгөгдөл, ${crew}. Юу гэсэн үг болохыг асуувал тайлбарлаж өгье.`
    : `A new blood panel is in: Inspiration4 reference data, crew ${crew}. Ask me what it means and I will walk you through it.`;
}
