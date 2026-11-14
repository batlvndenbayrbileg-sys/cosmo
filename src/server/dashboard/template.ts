import type { Lang, SummaryFindings, SummaryPayload } from "@/lib/types";

/**
 * Template (non-LLM) summary wording. Used when no stored summary exists, by the seed, and for the
 * ground role, which must never receive text phrased from the crew member's own words.
 * Pure: everything it prints was decided by src/lib/health (headline, findings, tasks, flags).
 */

const SUGGESTIONS_LABEL: Record<Lang, string> = {
  en: "Suggestions for today:",
  mn: "Өнөөдрийн санал:",
};

/** Joins sentences with single spaces, adding a full stop where a sentence has none. */
function sentence(text: string): string {
  const t = text.trim();
  if (t.length === 0) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Headline, red-flag alerts, up to 2 findings, up to 2 suggestions and the disclaimer, in one
 * short paragraph in the requested language.
 */
export function templateSpokenText(summary: SummaryFindings, lang: Lang): string {
  const parts: string[] = [sentence(summary.headline[lang])];
  for (const flag of summary.redFlags) parts.push(sentence(flag.text[lang]));
  for (const finding of summary.findings) parts.push(sentence(finding.text[lang]));
  if (summary.recommendations.length > 0) {
    const titles = summary.recommendations.map((t) => t.title[lang].replace(/[.!?]+$/, ""));
    parts.push(`${SUGGESTIONS_LABEL[lang]} ${titles.join("; ")}.`);
  }
  parts.push(sentence(summary.disclaimer[lang]));
  return parts.filter((p) => p.length > 0).join(" ");
}

/** A full SummaryPayload whose spoken text is the template text. */
export function composeTemplateSummary(
  findings: SummaryFindings,
  lang: Lang,
  audioTurnId: string | null = null,
): SummaryPayload {
  return {
    ...findings,
    spoken: { language: lang, text: templateSpokenText(findings, lang) },
    audioTurnId,
  };
}
