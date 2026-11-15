import type { Lang, QuestionDef } from "@/lib/types";
import { clarify, type ClarifyReason } from "./templates";

/**
 * The re-ask after an answer that could not be used, with the "didn't catch" line kept for the SECOND unclear answer
 * to the same question (user feedback 2026-11-15: "Уучлаарай, сайн сонссонгүй" after every noise or half-heard word
 * felt broken). The first time Cosmo just asks again, gently; the second time the templates' "Sorry, I didn't catch
 * that" (with the skip hint) and from the third on the templates move on. Out-of-range values always say why
 * (templates.clarify), since the person needs the expected range. Noise never gets here: a recording with no words is
 * the quiet 422 of the speech route (hasWords in server/speech/stt.ts), which counts as no attempt at all.
 */
export function reaskAfterFailedAnswer(q: QuestionDef, lang: Lang, reason: ClarifyReason, attempt: number): string {
  if (reason === "range" || attempt >= 1) return clarify(q, lang, reason, attempt >= 1 ? attempt : 0);
  const prompt = q.prompts[lang];
  if (reason === "type") {
    return lang === "mn" ? `${prompt} Тоогоор хэлэхэд болно.` : `${prompt} Just the number is fine.`;
  }
  return lang === "mn" ? `Дахиад нэг хэлээд өгөөч? ${prompt}` : `Could you say that once more? ${prompt}`;
}
