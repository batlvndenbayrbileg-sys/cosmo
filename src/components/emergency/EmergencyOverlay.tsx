"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, X } from "lucide-react";
import type { EmergencyScenario } from "@/lib/emergency";
import type { Lang } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { GuideGrid, guideCardId } from "./GuideGrid";
import { GuideStepView } from "./GuideStepView";

/**
 * Full-screen emergency guide, opened by the SOS button or by what is said: the scenario grid, then one guide step by
 * step (read aloud by Cosmo). Calm, high-contrast, large type and touch targets. The first line says when the crew
 * medical officer and ground were alerted. Escape closes; focus returns to where it was (the SOS button).
 */
export function EmergencyOverlay({
  scenarios,
  activeId,
  lang,
  alerted,
  onSelect,
  onClose,
  onCallHelp,
}: {
  scenarios: EmergencyScenario[];
  /** null = the grid: let the person choose */
  activeId: string | null;
  lang: Lang;
  alerted: boolean;
  /** open a guide (raises the alert) or go back to the grid (null) */
  onSelect: (id: string | null) => void;
  onClose: () => void;
  /** the always-visible "call for help" (defaults to opening the "get help now" card) */
  onCallHelp?: () => void;
}) {
  const { t } = useI18n();
  const active = scenarios.find((s) => s.id === activeId) ?? null;
  const [step, setStep] = useState(0);
  const [stepFor, setStepFor] = useState<string | null>(activeId);
  const lastOpened = useRef<string | null>(activeId);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  // a new scenario starts at its first step (reset during render, no effect needed)
  if (stepFor !== activeId) {
    setStepFor(activeId);
    setStep(0);
  }

  // focus: into the dialog on open, back to the opener on close
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!activeId) titleRef.current?.focus();
    return () => opener?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, []);

  // back on the grid: focus the card of the guide that was open
  useEffect(() => {
    if (activeId) {
      lastOpened.current = activeId;
      return;
    }
    if (lastOpened.current) document.getElementById(guideCardId("sos", lastOpened.current))?.focus();
  }, [activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const titleOf = (id: string) => scenarios.find((s) => s.id === id)?.title[lang] ?? null;
  const callHelp = onCallHelp ?? (() => onSelect("call-for-help"));

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,27,45,0.35)] p-2 backdrop-blur-md sm:p-4"
    >
      <motion.div
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 170, damping: 22 }}
        className="flex max-h-[calc(100dvh-1rem)] w-[min(76rem,100%)] flex-col overflow-hidden rounded-[30px] border border-white/80 bg-white/92 shadow-[0_40px_100px_-30px_rgba(150,30,30,0.45)] sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex items-start gap-3 border-b border-[rgba(15,27,45,0.06)] px-4 pt-4 pb-3 sm:px-6">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#C53030] text-white">
            <ShieldAlert className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="unit-label">{t("checkin.emergency.title")}</p>
            <h2 id="emergency-title" ref={titleRef} tabIndex={-1} className="text-[24px] leading-tight font-medium text-[#0F1B2D] outline-none">
              {active ? active.title[lang] : t("emergency.grid.title")}
            </h2>
            {alerted ? (
              <p className="mt-1 text-[15px] font-medium text-[#C53030]" role="status">
                {t("checkin.emergency.alerted")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("checkin.emergency.close")}
            className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[rgba(15,27,45,0.08)] bg-white outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {active ? (
            <GuideStepView
              key={active.id}
              scenario={active}
              lang={lang}
              step={step}
              onStep={setStep}
              onBack={() => onSelect(null)}
              onCallHelp={callHelp}
              onOpenGuide={(id) => onSelect(id)}
              titleOf={titleOf}
              autoSpeak
              headingLevel={3}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] text-[var(--aegis-label)]">{t("emergency.grid.hint")}</p>
              <GuideGrid scenarios={scenarios} lang={lang} onOpen={(id) => onSelect(id)} scope="sos" />
              <p className="text-[12px] text-[var(--aegis-label)]">
                {t("emergency.pending")} {t("emergency.offline")}
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
