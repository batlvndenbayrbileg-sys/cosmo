"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Keyboard, Mic, SkipForward, Square, Send } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type TalkStatus = "touring" | "listening" | "thinking" | "speaking" | "idle";

/**
 * After the check-in: a slim glass bar at the bottom of the dashboard (left of Cosmo's card) for talking with Cosmo
 * about today's results. It shows what Cosmo is doing, the last question and Cosmo's answer, a talk button, an
 * optional text field, and "Skip tour" while the spoken walkthrough runs.
 */
export function DashboardTalk({
  status,
  question,
  answer,
  micUsable,
  onMic,
  onSkipTour,
  onSendText,
}: {
  status: TalkStatus;
  question: string | null;
  answer: string | null;
  micUsable: boolean;
  onMic: () => void;
  onSkipTour: () => void;
  onSendText: (text: string) => void;
}) {
  const { t } = useI18n();
  const [typing, setTyping] = useState(!micUsable);
  const [draft, setDraft] = useState("");

  const statusText =
    status === "touring"
      ? t("checkin.talk.touring")
      : status === "listening"
        ? t("checkin.talk.listening")
        : status === "thinking"
          ? t("checkin.talk.thinking")
          : status === "speaking"
            ? t("checkin.talk.speaking")
            : t("checkin.talk.idle");

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSendText(text);
    setDraft("");
  };

  return (
    <motion.section
      role="region"
      aria-label={t("checkin.talk.region")}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 160, damping: 22 }}
      className="fixed bottom-9 left-1/2 z-40 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 md:left-[calc(50%-11rem)]"
    >
      <div className="flex flex-col gap-1.5 rounded-[24px] border border-white/80 bg-white/85 p-2.5 shadow-[0_30px_70px_-30px_rgba(40,80,160,0.55)] backdrop-blur-xl">
        <AnimatePresence initial={false}>
          {question || answer ? (
            <motion.div
              key={`${question ?? ""}|${answer ?? ""}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              // compact so the bar stays inside the dashboard's bottom reserve: the question on one line, the answer on
              // at most two (Cosmo also says the whole answer aloud; the full text is in the title tooltip)
              className="flex flex-col gap-0.5 px-1.5 text-[14px] leading-snug"
              aria-live="polite"
            >
              {question ? (
                <p className="line-clamp-1 text-[var(--cosmo-muted,#5B6678)]" title={question}>
                  <span className="unit-label mr-2">{t("checkin.talk.you")}</span>
                  {question}
                </p>
              ) : null}
              {answer ? (
                <p className="line-clamp-2 text-[var(--cosmo-ink,#0F1B2D)]" title={answer}>
                  <span className="unit-label mr-2">{t("checkin.talk.cosmo")}</span>
                  {answer}
                </p>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMic}
            disabled={!micUsable || status === "touring"}
            aria-pressed={status === "listening"}
            aria-label={status === "listening" ? t("checkin.talk.stop") : t("checkin.talk.mic")}
            className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0F1B2D] text-white transition-transform focus-visible:ring-4 focus-visible:ring-[#4F86F7]/40 focus-visible:outline-none disabled:opacity-40"
          >
            {status === "listening" ? <Square className="size-4" aria-hidden /> : <Mic className="size-5" aria-hidden />}
            {status === "listening" ? (
              <span className="absolute inset-0 animate-ping rounded-full bg-[#4F86F7]/30" aria-hidden />
            ) : null}
          </button>

          {typing ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("checkin.talk.type")}
                aria-label={t("checkin.talk.type")}
                className="h-11 min-w-0 flex-1 rounded-full border border-[rgba(15,27,45,0.08)] bg-white px-4 text-[15px] outline-none focus-visible:ring-4 focus-visible:ring-[#4F86F7]/30"
              />
              <button
                type="submit"
                aria-label={t("checkin.talk.send")}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#4F86F7] text-white disabled:opacity-40"
                disabled={draft.trim() === ""}
              >
                <Send className="size-4" aria-hidden />
              </button>
            </form>
          ) : (
            <p className="min-w-0 flex-1 truncate px-1 text-[15px] text-[var(--cosmo-muted,#5B6678)]" role="status">
              {statusText}
            </p>
          )}

          {status === "touring" ? (
            <button
              type="button"
              onClick={onSkipTour}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.08)] bg-white px-3 text-sm"
            >
              <SkipForward className="size-4" aria-hidden />
              {t("checkin.talk.skipTour")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setTyping((v) => !v)}
              aria-pressed={typing}
              aria-label={t("checkin.talk.type")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[rgba(15,27,45,0.08)] bg-white"
            >
              <Keyboard className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}
