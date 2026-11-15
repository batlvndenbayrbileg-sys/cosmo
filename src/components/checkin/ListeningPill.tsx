"use client";

/**
 * The small pill at the bottom of the check-in stage that says what Cosmo is doing with the person's voice: listening
 * (with a live level meter), heard you (with a "Done" button that sends at once), writing it down, thinking (quoting
 * the words that were understood). It appears the moment the state changes, so the end of speaking is never followed
 * by a silent, unexplained wait. See listening.ts for when each mode shows.
 */
import { useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import type { LevelStore } from "@/hooks/useRecorder";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { ListeningPillMode } from "./listening";
import { GLASS } from "./StageControls";

const BAR_WEIGHTS = [0.45, 0.75, 1, 0.75, 0.45];

function LevelBars({ level }: { level: LevelStore }) {
  const value = useSyncExternalStore(level.subscribe, level.get, () => 0);
  return (
    <span aria-hidden="true" className="flex h-5 items-center gap-[3px]">
      {BAR_WEIGHTS.map((w, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-[var(--cosmo-accent)] transition-[height] duration-100 ease-out"
          style={{ height: `${Math.round(4 + Math.min(1, value * 1.6) * 16 * w)}px` }}
        />
      ))}
    </span>
  );
}

function ThinkingDots() {
  // reduced motion: three still dots (MotionConfig "user" stops movement but not an endless opacity pulse)
  const reduced = useReducedMotion();
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {[0, 1, 2].map((i) =>
        reduced ? (
          <span key={i} className="size-1.5 rounded-full bg-[var(--cosmo-accent)] opacity-70" />
        ) : (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-[var(--cosmo-accent)]"
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ),
      )}
    </span>
  );
}

export function ListeningPill({
  mode,
  quote,
  level,
  onDone,
}: {
  mode: ListeningPillMode | null;
  /** the words understood, shown while Cosmo thinks */
  quote: string | null;
  level: LevelStore;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const ear = mode === "listening" || mode === "heard";
  return (
    <div
      data-slot="listening-pill"
      className="pointer-events-none fixed inset-x-0 bottom-28 z-20 flex justify-center px-4 sm:bottom-20"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {mode ? (
          <motion.div
            key={ear ? "ear" : "mind"}
            layout
            role="status"
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={cn(
              GLASS,
              "pointer-events-auto flex h-11 max-w-[min(26rem,calc(100vw-2rem))] items-center gap-2.5 rounded-full pr-1.5 pl-4 text-[14.5px] text-[var(--cosmo-ink)]",
              mode !== "heard" && "pr-4",
            )}
          >
            {ear ? <LevelBars level={level} /> : <ThinkingDots />}
            <motion.span layout="position" className="min-w-0 truncate">
              {mode === "thinking" && quote ? (
                <span className="font-medium">“{quote}”</span>
              ) : (
                t(
                  mode === "writing"
                    ? "checkin.listen.writing"
                    : mode === "thinking"
                      ? "checkin.listen.thinking"
                      : "checkin.listen.listening",
                )
              )}
            </motion.span>
            <AnimatePresence initial={false}>
              {mode === "heard" ? (
                <motion.button
                  key="done"
                  type="button"
                  data-slot="listening-done"
                  onClick={onDone}
                  aria-label={t("checkin.listen.doneLabel")}
                  initial={{ opacity: 0, scale: 0.8, width: 0 }}
                  animate={{ opacity: 1, scale: 1, width: "auto" }}
                  exit={{ opacity: 0, scale: 0.8, width: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                  className="flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-full bg-[var(--cosmo-ink)] px-3.5 text-[13.5px] font-semibold whitespace-nowrap text-white outline-none focus-visible:ring-4 focus-visible:ring-[var(--cosmo-accent)]/40"
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  {t("checkin.listen.done")}
                </motion.button>
              ) : null}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
