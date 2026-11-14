import type { Lang, QuestionId } from "@/lib/types";

/**
 * Words the speech recogniser should expect (ElevenLabs Scribe `keyterms`).
 *
 * Measured 2026-11-15 on short Mongolian answers voiced by the app's Mongolian voice (scratchpad stt-short): without
 * hints scribe_v3 returned "Totven." for "Тод байна.", "Team." for "Тийм.", "उगुई।" for "Үгүй." and "Jarang Name." for
 * "Жаран найм."; with these hints it returned all of them correctly in Cyrillic. Long sentences were already fine.
 * The API allows up to 1000 terms of at most 5 words / 50 characters; the lists stay well under 100.
 */

/** Mongolian number words and the words every answer uses */
const MN_COMMON = [
  "тийм", "үгүй", "байхгүй", "байна", "алгасъя", "мэдэхгүй",
  "нэг", "хоёр", "гурав", "дөрөв", "тав", "зургаа", "долоо", "найм", "ес", "арав",
  "арван", "хорин", "гучин", "дөчин", "тавин", "жаран", "далан", "наян", "ерэн",
  "зуу", "зуун", "мянга", "хагас", "цэг",
];

const MN_BY_QUESTION: Record<QuestionId, string[]> = {
  sleep: ["цаг", "унтсан", "цаг хагас"],
  mood: ["сэтгэл санаа", "сайн", "муу", "дунд зэрэг"],
  symptoms: ["толгой өвдөх", "толгой эргэх", "дотор муухайрах", "өвдөхгүй"],
  blood_pressure: ["дээр", "даралт", "зуун хорин", "наян"],
  heart_rate: ["пульс", "минутад", "удаа"],
  temperature: ["градус", "хэм", "гучин зургаа", "гучин долоо"],
  glucose: ["сахар", "цусны сахар"],
  water: ["литр", "миллилитр", "мл", "аяга", "ус"],
  exercise: ["минут", "дасгал", "цаг", "хийгээгүй"],
  vision: ["тод", "тод байна", "бага зэрэг бүдэг", "бүдэг", "хоёр нүд"],
  workload: ["ачаалал", "хөнгөн", "хүнд", "дунд зэрэг"],
  day_note: ["нэмэх зүйл алга", "юу ч үгүй", "тэмдэглэл"],
};

const EN_COMMON = ["yes", "no", "skip", "nothing", "over"];

const EN_BY_QUESTION: Record<QuestionId, string[]> = {
  sleep: ["hours", "half"],
  mood: ["out of five"],
  symptoms: ["headache", "dizziness", "nausea"],
  blood_pressure: ["blood pressure", "over"],
  heart_rate: ["beats per minute", "pulse"],
  temperature: ["degrees", "Celsius", "point"],
  glucose: ["milligrams per decilitre", "glucose"],
  water: ["millilitres", "litres", "cups"],
  exercise: ["minutes", "treadmill", "cycle"],
  vision: ["clear", "slightly blurred", "blurred", "sharp"],
  workload: ["light", "heavy", "medium"],
  day_note: ["nothing to add"],
};

/** hint words for one recording: the language's common words plus those of the question Cosmo is waiting for */
export function sttKeyterms(lang: Lang, expected: QuestionId | null): string[] {
  const common = lang === "mn" ? MN_COMMON : EN_COMMON;
  const specific = expected ? (lang === "mn" ? MN_BY_QUESTION : EN_BY_QUESTION)[expected] : [];
  return [...new Set([...specific, ...common])].filter((t) => t.length <= 50 && t.split(/\s+/).length <= 5);
}
