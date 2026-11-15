"use client";

import { useEffect, useRef, useState } from "react";
import { LifeBuoy } from "lucide-react";
import type { EmergencyScenario } from "@/lib/emergency";
import type { Lang } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { GuideGrid, guideCardId } from "./GuideGrid";
import { GuideStepView } from "./GuideStepView";

/**
 * Window event the dashboard tab sends for "call for help". The check-in screen listens (it opens the SOS overlay
 * and raises the alert for the crew medical officer and ground) and calls preventDefault() to say it handled it.
 * Where nobody listens (the /dev/dashboard playground, the Earth console) the tab opens "get help now" in place.
 */
export const EMERGENCY_REQUEST_EVENT = "cosmo:emergency-request";

export function requestEmergency(scenarioId: string): boolean {
  const e = new CustomEvent(EMERGENCY_REQUEST_EVENT, { detail: { scenarioId }, cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/**
 * The dashboard's "Emergency guide" tab: the scenario grid, and a guide opened in place, inside the one-screen
 * layout (the panel takes the frame's height on desktop). `openId` is owned by DashboardView so the overview's
 * "If it gets worse" card can open a guide here.
 */
export function EmergencyGuidePanel({
  scenarios,
  lang,
  openId,
  onOpenId,
  suggested,
}: {
  scenarios: EmergencyScenario[];
  lang: Lang;
  openId: string | null;
  onOpenId: (id: string | null) => void;
  suggested: readonly string[];
}) {
  const { t } = useI18n();
  const active = scenarios.find((s) => s.id === openId) ?? null;
  const [step, setStep] = useState(0);
  const [stepFor, setStepFor] = useState<string | null>(openId);
  const lastOpened = useRef<string | null>(openId);
  if (stepFor !== openId) {
    setStepFor(openId);
    setStep(0);
  }

  // back on the grid: focus the card of the guide that was open
  useEffect(() => {
    if (openId) {
      lastOpened.current = openId;
      return;
    }
    if (lastOpened.current) document.getElementById(guideCardId("tab", lastOpened.current))?.focus();
  }, [openId]);

  const callHelp = () => {
    if (!requestEmergency("call-for-help")) onOpenId("call-for-help");
  };
  const titleOf = (id: string) => scenarios.find((s) => s.id === id)?.title[lang] ?? null;

  return (
    <section aria-labelledby="guide-title" data-slot="emergency-guide" className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      <div className="flex flex-col gap-0.5 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-4">
        <h2 id="guide-title" className="flex items-center gap-2.5 text-[26px] leading-tight text-[var(--cosmo-ink)] lg:text-[clamp(20px,2.8vh,26px)]">
          <span className="icon-chip bg-[#C53030]! lg:size-[clamp(28px,3.8vh,38px)]!" aria-hidden="true">
            <LifeBuoy className="size-[18px]" strokeWidth={1.8} />
          </span>
          <span>
            <span className="font-light">{t("dashboard.guide.titleLight")}</span>{" "}
            <span className="font-medium">{t("dashboard.guide.titleStrong")}</span>
          </span>
        </h2>
        <p className="text-[13px] text-[var(--cosmo-label)] lg:text-[12px]">{t("dashboard.guide.subtitle")}</p>
        <p className="text-[13px] font-medium text-[#975A16] lg:text-[12px]">{t("emergency.pending")}</p>
      </div>

      {active ? (
        <div className="glass-card p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:p-[clamp(10px,1.6vh,18px)]">
          <GuideStepView
            key={active.id}
            scenario={active}
            lang={lang}
            step={step}
            onStep={setStep}
            onBack={() => onOpenId(null)}
            onCallHelp={callHelp}
            onOpenGuide={(id) => onOpenId(id)}
            titleOf={titleOf}
            headingLevel={3}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1">
          <p className="text-[13px] text-[var(--cosmo-label)]">{t("emergency.grid.hint")}</p>
          <div className="lg:min-h-0 lg:flex-1">
            <GuideGrid scenarios={scenarios} lang={lang} onOpen={(id) => onOpenId(id)} suggested={suggested} scope="tab" dense />
          </div>
        </div>
      )}
    </section>
  );
}
