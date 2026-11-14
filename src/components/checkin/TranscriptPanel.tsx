"use client";

import { memo, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { PendingCrewLine, TranscriptLine } from "./state";

export interface TranscriptPanelProps {
  lines: readonly TranscriptLine[];
  pending: PendingCrewLine | null;
  className?: string;
}

/**
 * Live transcript under Cosmo. `role="log"` + aria-live="polite" announces each new line once.
 * The newest line is always in view; older lines scroll above it.
 */
export const TranscriptPanel = memo(function TranscriptPanel({ lines, pending, className }: TranscriptPanelProps) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, pending?.text]);

  return (
    <div
      ref={scroller}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={t("checkin.transcript.label")}
      data-slot="transcript"
      className={cn("flex flex-col gap-3 overflow-y-auto px-1 py-1", className)}
    >
      {lines.length === 0 && !pending ? (
        <p className="m-auto text-center text-base text-muted-foreground">{t("checkin.transcript.empty")}</p>
      ) : null}

      <AnimatePresence initial={false}>
        {lines.map((line) => (
          <motion.div
            key={line.id}
           
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            lang={line.language}
            className={cn("flex flex-col gap-0.5", line.speaker === "crew" ? "items-end text-right" : "items-start")}
          >
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {line.speaker === "crew" ? t("checkin.transcript.you") : t("checkin.transcript.cosmo")}
            </span>
            <p
              className={cn(
                "max-w-[46rem] rounded-2xl px-4 py-2 leading-snug",
                line.speaker === "crew"
                  ? "bg-secondary text-lg text-foreground"
                  : "border border-border bg-card text-xl font-medium text-foreground",
              )}
            >
              {line.text}
            </p>
          </motion.div>
        ))}

        {pending ? (
          <motion.div
            key="pending"
           
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-end gap-0.5 text-right"
          >
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("checkin.transcript.you")}
            </span>
            <p className="max-w-[46rem] rounded-2xl bg-secondary/70 px-4 py-2 text-lg leading-snug text-foreground">
              {pending.text !== "" ? (
                <>
                  {pending.text}
                  <span aria-hidden="true" className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 animate-pulse bg-primary" />
                </>
              ) : (
                <span className="text-muted-foreground">{t("checkin.transcript.transcribing")}</span>
              )}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
