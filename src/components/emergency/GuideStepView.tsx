"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink, Phone, Volume2 } from "lucide-react";
import { beatIntervalMs, CPR_RATE, isReviewed, type EmergencyScenario } from "@/lib/emergency";
import type { Lang } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { StepArt } from "./art";
import { GuideIconChip } from "./GuideGrid";
import { useStepSpeech } from "./hooks";
import { Metronome } from "./Metronome";

const BTN =
  "inline-flex h-12 min-w-12 items-center justify-center gap-1.5 rounded-full px-4 text-[15px] font-medium outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-ring/60 disabled:opacity-40";

/**
 * One guide, one step at a time: big step text, the step's illustration (the team's image when it has one), progress
 * (2 / 5), back / next with large touch targets, read aloud, and an always-visible "call for help". CPR steps add the
 * compression metronome and the running timer. Arrow keys move between steps while focus is inside the view.
 * Parents key it by scenario id, so a new guide starts at its first step with a fresh timer.
 */
export function GuideStepView({
  scenario,
  lang,
  step,
  onStep,
  onBack,
  onCallHelp,
  onOpenGuide,
  titleOf,
  autoSpeak = false,
  headingLevel = 2,
}: {
  scenario: EmergencyScenario;
  lang: Lang;
  step: number;
  onStep: (next: number) => void;
  onBack: () => void;
  onCallHelp: () => void;
  onOpenGuide: (id: string) => void;
  /** title of another guide (for "Open: CPR" buttons), null when it is not in the library */
  titleOf: (id: string) => string | null;
  /** Cosmo reads each step as it appears (the SOS overlay); otherwise only on "Read aloud" */
  autoSpeak?: boolean;
  headingLevel?: 2 | 3;
}) {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const total = scenario.steps.length;
  const index = Math.min(Math.max(0, step), total - 1);
  const current = scenario.steps[index];
  const { speak } = useStepSpeech(lang);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());

  // opening a guide moves focus to its title (keyboard and screen-reader users land in the guide)
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // once per step: a refreshed copy of the same guide (the server's library arriving) does not start the line again
  const scenarioId = scenario.id;
  const steps = useRef(scenario.steps);
  useEffect(() => {
    steps.current = scenario.steps;
  }, [scenario.steps]);
  useEffect(() => {
    if (autoSpeak) speak({ id: scenarioId, steps: steps.current }, index);
  }, [autoSpeak, speak, scenarioId, index]);

  const go = (n: number) => onStep(Math.min(total - 1, Math.max(0, n)));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    }
  };

  const Heading = headingLevel === 2 ? "h2" : "h3";
  const last = index >= total - 1;
  const linkTitle = current.link ? titleOf(current.link) : null;

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-3 lg:h-full lg:min-h-0" data-slot="guide-step-view">
      {/* header: back to the list, title, call for help (always visible) */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className={cn(BTN, "bg-white px-3 ring-1 ring-[var(--cosmo-hairline)]")}>
          <ChevronLeft className="size-5" aria-hidden />
          <span className="max-sm:sr-only">{t("emergency.step.list")}</span>
        </button>
        <GuideIconChip icon={scenario.icon} urgent={scenario.id === "not-breathing" || scenario.id === "call-for-help"} />
        <Heading
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 text-[22px] leading-tight font-medium text-[var(--cosmo-ink)] outline-none lg:text-[clamp(20px,2.8vh,26px)]"
        >
          {scenario.title[lang]}
        </Heading>
        <button
          type="button"
          onClick={onCallHelp}
          aria-label={t("emergency.callHelpAria")}
          className={cn(BTN, "bg-[#C53030] text-white shadow-[0_10px_24px_-12px_rgba(197,48,48,0.8)]")}
        >
          <Phone className="size-4" aria-hidden />
          {t("emergency.callHelp")}
        </button>
      </div>

      {scenario.context ? (
        <p className="rounded-2xl bg-[var(--cosmo-pastel-lilac)]/70 px-3 py-2 text-[13px] leading-snug text-[#44337a]">
          <span className="mr-1 font-semibold">{t("emergency.step.space")}:</span>
          {scenario.context[lang]}
        </p>
      ) : null}

      {/* progress */}
      <div className="flex items-center gap-3">
        <span className="tnum text-[15px] font-semibold text-[var(--cosmo-ink)]" aria-label={t("emergency.step.progressAria", { n: index + 1, total })}>
          {t("emergency.step.progress", { n: index + 1, total })}
        </span>
        <span className="flex flex-1 gap-1" aria-hidden="true">
          {scenario.steps.map((_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= index ? "bg-[var(--cosmo-accent)]" : "bg-[var(--cosmo-chart)]")} />
          ))}
        </span>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {t("emergency.step.live", { n: index + 1, total, text: current.text[lang] })}
      </p>

      {/* body: illustration + text and controls */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:min-h-0 lg:flex-1">
        <div className="relative flex aspect-[4/3] max-h-[36dvh] w-full items-center justify-center overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_50%_40%,#e6efff,#f7faff_72%)] ring-1 ring-white md:aspect-auto md:max-h-none md:min-h-[220px] lg:h-full lg:min-h-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${scenario.id}-${index}`}
              className="absolute inset-3 flex items-center justify-center"
              initial={{ opacity: 0, scale: reduced ? 1 : 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.1 : 0.25 }}
            >
              {current.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the team's step image, served by the API route
                <img src={current.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : current.art ? (
                <StepArt art={current.art} beatMs={current.metronome && running ? beatIntervalMs(CPR_RATE.default) : undefined} />
              ) : (
                <span className="text-[120px] leading-none font-light text-[#4F86F7]/70 tabular-nums" aria-hidden>
                  {index + 1}
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          {/* text and metronome may scroll on short screens; the controls below never leave the frame */}
          <div className="flex min-h-0 flex-col gap-3 lg:flex-1 lg:overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={`${scenario.id}-${index}`}
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.1 : 0.22 }}
              className="shrink-0 text-[24px] leading-snug text-[var(--cosmo-ink)] lg:text-[clamp(18px,2.7vh,30px)]"
            >
              {current.text[lang]}
            </motion.p>
          </AnimatePresence>

          {current.link && linkTitle ? (
            <button
              type="button"
              onClick={() => onOpenGuide(current.link as string)}
              className={cn(BTN, "self-start bg-[#FFF5F5] text-[#C53030] ring-1 ring-[#C53030]/30")}
            >
              {t("emergency.step.openLink", { title: linkTitle })}
              <ChevronRight className="size-4" aria-hidden />
            </button>
          ) : null}

          {current.metronome ? (
            <Metronome
              running={running}
              onToggle={() => setRunning((r) => !r)}
              startedAt={startedAt}
              onResetTimer={() => setStartedAt(Date.now())}
            />
          ) : null}
          </div>

          <div className="mt-auto flex shrink-0 flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} className={cn(BTN, "bg-white ring-1 ring-[var(--cosmo-hairline)]")}>
              <ChevronLeft className="size-5" aria-hidden />
              {t("emergency.step.prev")}
            </button>
            <button
              type="button"
              onClick={() => (last ? onBack() : go(index + 1))}
              className={cn(BTN, "min-w-32 bg-[var(--cosmo-ink)] px-6 text-white")}
            >
              {last ? t("emergency.step.done") : t("emergency.step.next")}
              {last ? null : <ChevronRight className="size-5" aria-hidden />}
            </button>
            <button type="button" onClick={() => speak(scenario, index)} className={cn(BTN, "bg-white ring-1 ring-[var(--cosmo-hairline)]")}>
              <Volume2 className="size-4" aria-hidden />
              {t("emergency.step.listen")}
            </button>
          </div>
        </div>
      </div>

      {/* review status, sources, disclaimer */}
      <footer className="flex flex-col gap-0.5 text-[12px] leading-snug text-[var(--cosmo-label)]">
        <p className={isReviewed(scenario) ? "" : "font-medium text-[#975A16]"}>
          {isReviewed(scenario) ? t("emergency.reviewed", { name: scenario.reviewedBy }) : t("emergency.pending")}{" "}
          <span className="font-normal text-[var(--cosmo-label)]">{t("emergency.disclaimer")}</span>
        </p>
        {scenario.sources.length > 0 ? (
          <p className="lg:truncate">
            {t("emergency.sources")}:{" "}
            {scenario.sources.map((s, i) => (
              <span key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                  {s.title}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                {s.checked ? ` (${t("emergency.checked", { date: s.checked })})` : null}
                {i < scenario.sources.length - 1 ? "; " : ""}
              </span>
            ))}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
