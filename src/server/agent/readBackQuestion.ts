import type { Lang } from "@/lib/types";
import { isCorrectionWorded } from "./interpret";

/**
 * A general-range question at the read-back ("what's a normal blood pressure?", "is my blood pressure ok?", "is 98.6 a
 * normal temperature?"): it is answered and the read-back question asked again (team request 2026-11-15: "answer such
 * questions at any point of the check-in"). It is never taken for a yes ("ok" in "is my blood pressure ok?" used to
 * confirm the whole check-in) nor for a correction (the 98.6 in the question used to overwrite the stored temperature).
 * A question worded as a correction ("no, my pulse was 72, is that ok?") still takes the correction path.
 *
 * Pure: `referenceAnswer` is answerReferenceQuestion's text (questions.ts), null when the words are not such a question.
 */
const CONFIRM_AGAIN: Readonly<Record<Lang, string>> = {
  en: "Is everything in the read-back correct?",
  mn: "Тэмдэглэсэн зүйлс бүгд зөв үү?",
};

export function readBackReferenceReply(text: string, lang: Lang, referenceAnswer: string | null): string | null {
  if (!referenceAnswer || isCorrectionWorded(text)) return null;
  return `${referenceAnswer} ${CONFIRM_AGAIN[lang]}`;
}
