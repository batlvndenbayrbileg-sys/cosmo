import type { Lang } from "@/lib/types";
import type { ResultsFacts } from "./resultsFacts";

/**
 * Cosmo's spoken walkthrough of the dashboard, built by code from the computed facts (no model, no invented numbers).
 * Each step names the dashboard section the client highlights while Cosmo says it.
 */

export type TourFocus = "overall" | "alerts" | "body" | "vital" | "radar" | "plan" | "timeline" | "ask";

export interface TourStep {
  focus: TourFocus;
  text: string;
}

function list(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join("");
  const and = lang === "mn" ? " болон " : " and ";
  return `${items.slice(0, -1).join(", ")}${and}${items[items.length - 1]}`;
}

export function buildTour(facts: ResultsFacts, lang: Lang): TourStep[] {
  const mn = lang === "mn";
  const steps: TourStep[] = [];

  steps.push({
    focus: "overall",
    text: mn
      ? `Энэ бол таны өнөөдрийн хяналтын самбар. Ерөнхий байдал: ${facts.overall.word}, бэлэн байдал 100-аас ${facts.readiness}.`
      : `Here is your dashboard for today. Overall you are at ${facts.overall.word}, with a readiness of ${facts.readiness} out of 100.`,
  });

  if (facts.alerts.length > 0) {
    steps.push({ focus: "alerts", text: facts.alerts[0] });
  }

  const attention = facts.bodyAreas.filter((a) => a.status !== (mn ? "хэвийн" : "normal") && a.score !== null).map((a) => a.name);
  steps.push({
    focus: "body",
    text:
      attention.length === 0
        ? mn
          ? "Голд байгаа биеийн зураг зургаан хэсгийг харуулна. Бүгд таны ердийн түвшинд байна."
          : "The body in the middle shows six areas. All of them look like your usual."
        : mn
          ? `Голд байгаа биеийн зураг зургаан хэсгийг харуулна. ${list(attention, lang)} хэсэгт анхаарах зүйл байна, бусад нь ердийн түвшинд.`
          : `The body in the middle shows six areas. ${capitalise(list(attention, lang))} need a look; the others are like your usual.`,
  });

  if (facts.findings.length > 0) {
    steps.push({ focus: "vital", text: (mn ? "Зүүн талд: " : "On the left: ") + facts.findings[0] });
  }

  steps.push({
    focus: "radar",
    text: mn
      ? "Баруун талын радар өнөөдрийг таны өөрийн сүүлийн хоёр долоо хоногтой харьцуулна."
      : "The radar on the right compares today with your own last two weeks.",
  });

  if (facts.plan.length > 0) {
    const titles = facts.plan.slice(0, 2).map((p) => p.title.replace(/[.!]$/u, ""));
    steps.push({
      focus: "plan",
      text: mn ? `Өнөөдрийн төлөвлөгөө: ${list(titles, lang)}.` : `Your plan for today: ${list(titles, lang)}.`,
    });
  }

  steps.push({
    focus: "timeline",
    text: mn ? "Доод хэсэгт таны сүүлийн 14 хоног харагдана." : "Along the bottom you can see your last 14 days.",
  });

  steps.push({
    focus: "ask",
    text: mn
      ? `Ингээд боллоо. Эдгээр үр дүнгийн талаар юу ч асууж болно. ${facts.disclaimer}`
      : `That's everything. Ask me anything about these results. ${facts.disclaimer}`,
  });

  return steps;
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
