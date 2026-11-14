"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink, ShieldAlert, Volume2, X } from "lucide-react";
import { isReviewed, type EmergencyScenario } from "@/lib/emergency";
import type { Lang } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * Full-screen emergency guidance: the team's prepared, cited steps with one large image each, read aloud by Cosmo.
 * Calm, high-contrast, large type. The first line always says that the crew medical officer and ground were alerted.
 * Content that is not reviewed yet carries a visible "not yet reviewed" label.
 */
export function EmergencyOverlay({
  scenarios,
  activeId,
  lang,
  alerted,
  onSelect,
  onClose,
}: {
  scenarios: EmergencyScenario[];
  /** null = let the person choose */
  activeId: string | null;
  lang: Lang;
  alerted: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const active = scenarios.find((s) => s.id === activeId) ?? null;
  const [step, setStep] = useState(0);
  const [stepFor, setStepFor] = useState<string | null>(activeId);
  // a new scenario starts at its first step (reset during render, no effect needed)
  if (stepFor !== activeId) {
    setStepFor(activeId);
    setStep(0);
  }
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(
    (scenario: EmergencyScenario, index: number) => {
      const text = scenario.steps[index]?.text[lang];
      if (!text) return;
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      const audio = new Audio(`/api/emergency/${scenario.id}/steps/${index}/audio?lang=${lang}`);
      audioRef.current = audio;
      audio.play().catch(() => {
        // no ElevenLabs (offline / scripted): the browser voice, or just the text on screen
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = lang === "mn" ? "mn-MN" : "en-US";
          window.speechSynthesis?.speak(u);
        } catch {
          /* text stays on screen */
        }
      });
    },
    [lang],
  );

  // Cosmo reads each step as it appears
  useEffect(() => {
    if (active) speak(active, step);
  }, [active, step, speak]);

  // stop speaking when the overlay closes
  useEffect(
    () => () => {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  // keyboard: arrows move between steps, Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (!active) return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(active.steps.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  const current = active?.steps[step];
  const others = scenarios.filter((s) => s.id !== activeId);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,27,45,0.35)] p-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 170, damping: 22 }}
        className="flex max-h-[calc(100dvh-2rem)] w-[min(68rem,100%)] flex-col overflow-hidden rounded-[32px] border border-white/80 bg-white/90 shadow-[0_40px_100px_-30px_rgba(150,30,30,0.45)]"
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-[rgba(15,27,45,0.06)] px-6 pt-5 pb-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#C53030] text-white">
            <ShieldAlert className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="unit-label">{t("checkin.emergency.title")}</p>
            <h2 id="emergency-title" className="text-[26px] leading-tight font-medium text-[#0F1B2D]">
              {active ? active.title[lang] : t("checkin.emergency.choose")}
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
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[rgba(15,27,45,0.08)] bg-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {active && current ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* image */}
            <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_50%_40%,#e6efff,#f7faff_70%)]">
              <AnimatePresence mode="wait">
                {current.imageUrl ? (
                  <motion.img
                    key={current.imageUrl}
                    src={current.imageUrl}
                    alt=""
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="max-h-[52dvh] w-auto object-contain"
                  />
                ) : (
                  <motion.span
                    key={`n-${step}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[120px] leading-none font-light text-[#4F86F7]/70 tabular-nums"
                    aria-hidden
                  >
                    {step + 1}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* text + controls */}
            <div className="flex min-h-0 flex-col gap-4">
              <p className="unit-label">{t("checkin.emergency.step", { n: step + 1, total: active.steps.length })}</p>
              <AnimatePresence mode="wait">
                <motion.p
                  key={`${active.id}-${step}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-[28px] leading-snug font-normal text-[#0F1B2D]"
                  aria-live="assertive"
                >
                  {current.text[lang]}
                </motion.p>
              </AnimatePresence>

              <div className="flex items-center gap-1.5" aria-hidden>
                {active.steps.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-8 bg-[#4F86F7]" : "w-3 bg-[#D6E4FF]"}`} />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="flex h-11 items-center gap-1 rounded-full border border-[rgba(15,27,45,0.08)] bg-white px-4 disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  {t("checkin.emergency.prev")}
                </button>
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(active.steps.length - 1, s + 1))}
                  disabled={step >= active.steps.length - 1}
                  className="flex h-11 items-center gap-1 rounded-full bg-[#0F1B2D] px-5 text-white disabled:opacity-40"
                >
                  {t("checkin.emergency.next")}
                  <ChevronRight className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => speak(active, step)}
                  className="flex h-11 items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.08)] bg-white px-4"
                >
                  <Volume2 className="size-4" aria-hidden />
                  {t("checkin.emergency.listen")}
                </button>
              </div>

              <div className="mt-auto flex flex-col gap-1.5 text-[13px] text-[#5B6678]">
                <p className={isReviewed(active) ? "" : "font-medium text-[#B7791F]"}>
                  {isReviewed(active) ? t("checkin.emergency.reviewed", { name: active.reviewedBy }) : t("checkin.emergency.pending")}
                </p>
                {active.sources.length > 0 ? (
                  <p>
                    {t("checkin.emergency.sources")}:{" "}
                    {active.sources.map((s, i) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
                        {s.title}
                        <ExternalLink className="size-3" aria-hidden />
                        {i < active.sources.length - 1 ? ", " : ""}
                      </a>
                    ))}
                  </p>
                ) : null}
                <p>{t("checkin.emergency.disclaimer")}</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* scenario chooser (manual SOS) or the other situations */}
        {others.length > 0 ? (
          <div className="border-t border-[rgba(15,27,45,0.06)] px-6 py-4">
            {active ? <p className="unit-label mb-2">{t("checkin.emergency.others")}</p> : null}
            <div className="flex flex-wrap gap-2">
              {others.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`rounded-full border px-4 py-2 text-[15px] ${s.builtIn ? "border-[#C53030]/30 bg-[#C53030]/5 text-[#C53030]" : "border-[rgba(15,27,45,0.08)] bg-white"}`}
                >
                  {s.title[lang]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  );
}
