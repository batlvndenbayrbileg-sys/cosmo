"use client";

import { ChevronRight, LifeBuoy } from "lucide-react";
import type { EmergencyScenario, GuideSuggestion } from "@/lib/emergency";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * "If it gets worse: <guide>" - a small card on the overview when today's data already points to a guide (see
 * suggestGuides). It sits in the heading's meta line, so the one-screen layout does not change. Opens the guide in
 * the Emergency guide tab.
 */
export function IfWorseCard({
  suggestion,
  scenarios,
  onOpen,
}: {
  suggestion: GuideSuggestion | undefined;
  scenarios: readonly EmergencyScenario[];
  onOpen: (scenarioId: string) => void;
}) {
  const { t, lang } = useI18n();
  const scenario = suggestion ? scenarios.find((s) => s.id === suggestion.scenarioId) : undefined;
  if (!suggestion || !scenario) return null;
  const title = scenario.title[lang];
  const why = t(`dashboard.guide.why.${suggestion.reason}`);
  return (
    <button
      type="button"
      data-slot="if-worse-card"
      onClick={() => onOpen(scenario.id)}
      aria-label={t("dashboard.guide.ifWorseAria", { title, why })}
      title={why}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#FFF5F5] py-0.5 pr-2 pl-1 font-medium text-[#9B2C2C] ring-1 ring-[#C53030]/25 outline-none hover:brightness-[0.98] focus-visible:ring-3 focus-visible:ring-ring/60"
    >
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#C53030] text-white" aria-hidden="true">
        <LifeBuoy className="size-3" strokeWidth={2} />
      </span>
      <span className="truncate">{t("dashboard.guide.ifWorse", { title })}</span>
      <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
}
