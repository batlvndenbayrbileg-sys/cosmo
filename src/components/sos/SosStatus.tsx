"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Camera, CameraOff, Check, Earth, Loader2, RotateCw, Satellite, SatelliteDish, Trash2, X } from "lucide-react";
import type { Lang } from "@/lib/types";
import { formatClockLabel } from "@/components/dashboard/logic";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { SOS_IDLE, dismissSos, getSosState, removeSosPhoto, sendSosToEarth, subscribeSos, type SosPhotoUi, type SosUiState } from "./store";

type Sent = Extract<SosUiState, { phase: "sent" }>;
type T = ReturnType<typeof useI18n>["t"];

export function useSosState(): SosUiState {
  return useSyncExternalStore(subscribeSos, getSosState, () => SOS_IDLE);
}

/* ───────────── the signal: station → Earth ───────────── */

/** the arc between the two badges (viewBox 0 0 64 28) */
const ARC = "M 2 22 Q 32 -6 62 22";

/**
 * The station on the left, Earth on the right, a red signal travelling along the arc while the alert is on its way;
 * once Earth has it the signal rests there and Earth glows. A failed send shows a broken, grey arc. Static with
 * reduced motion. Decorative: the words next to it say the same.
 */
function SignalRoute({ phase }: { phase: "sending" | "sent" | "failed" }) {
  const reduced = usePrefersReducedMotion();
  const failed = phase === "failed";
  const arrived = phase === "sent";
  return (
    <div aria-hidden className="flex shrink-0 items-center" data-slot="sos-route" data-route={phase}>
      <span
        className={cn(
          "relative z-[1] flex size-9 items-center justify-center rounded-full text-white sm:size-10 shadow-[0_8px_22px_-10px_rgba(197,48,48,0.9)]",
          failed ? "bg-[#9B2C2C]" : "bg-[#C53030]",
        )}
      >
        {!failed && !reduced ? (
          <span className="absolute inset-0 rounded-full bg-[#C53030]/35 motion-safe:animate-ping" style={{ animationDuration: "1.8s" }} />
        ) : null}
        <Satellite className="relative size-[18px]" />
      </span>
      <svg viewBox="0 0 64 28" className="-mx-1 h-6 w-12 sm:h-7 sm:w-16" fill="none">
        <path
          d={ARC}
          stroke={failed ? "#A0AEC0" : "#C53030"}
          strokeOpacity={failed ? 0.9 : 0.45}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={failed ? "3 7" : "2 5"}
        />
        {failed ? (
          <path d="M 28 6 L 36 14 M 36 6 L 28 14" stroke="#9B2C2C" strokeWidth="2.2" strokeLinecap="round" />
        ) : reduced || arrived ? (
          // at rest: on Earth's side once it arrived, half-way while it is sent
          <circle cx={arrived ? 58 : 32} cy={arrived ? 17 : 8} r="3.2" fill="#C53030" />
        ) : (
          <circle r="3.2" fill="#C53030">
            <animateMotion dur="1.3s" repeatCount="indefinite" path={ARC} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
          </circle>
        )}
      </svg>
      <span className="relative flex size-9 items-center justify-center sm:size-10">
        {arrived ? (
          <motion.span
            className="absolute inset-0 rounded-full bg-[#4F86F7]/30"
            initial={{ scale: 0.6, opacity: 0.9 }}
            animate={reduced ? { scale: 1, opacity: 0.5 } : { scale: [0.9, 1.45], opacity: [0.6, 0] }}
            transition={reduced ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        ) : null}
        <span
          className={cn(
            "relative flex size-9 items-center justify-center rounded-full ring-2 ring-white transition-colors duration-500 sm:size-10",
            arrived ? "bg-gradient-to-br from-[#4F86F7] to-[#2F855A] text-white" : "bg-[#E2E8F0] text-[#4A5568]",
          )}
        >
          <Earth className="size-5" />
        </span>
      </span>
    </div>
  );
}

/* ───────────── the three steps ───────────── */

type StepState = "done" | "now" | "waiting" | "none" | "failed";

function photoStep(photo: SosPhotoUi): StepState {
  if (photo === "attached" || photo === "deleteFailed") return "done";
  if (photo === "waiting" || photo === "taking" || photo === "deleting") return "now";
  return "none";
}

function Step({ label, state, t }: { label: string; state: StepState; t: T }) {
  const icon =
    state === "done" ? (
      <motion.span key="done" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 18 }}>
        <Check className="size-3.5" strokeWidth={3} />
      </motion.span>
    ) : state === "now" ? (
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
    ) : state === "none" ? (
      <CameraOff className="size-3.5" />
    ) : state === "failed" ? (
      <X className="size-3.5" strokeWidth={3} />
    ) : (
      <span className="size-1.5 rounded-full bg-current" />
    );
  return (
    <li
      data-step={state}
      className={cn(
        // phones: the mark above the words (three narrow columns); wider: side by side
        "flex min-h-10 min-w-0 flex-col items-center gap-1 rounded-2xl px-1.5 py-1.5 text-center text-[12px] leading-tight font-medium ring-1 transition-colors duration-300 sm:flex-row sm:gap-2 sm:px-2.5 sm:text-left sm:text-[13px]",
        state === "done" && "bg-[#F0FFF4] text-[#22543D] ring-[#9AE6B4]",
        state === "now" && "bg-[#FFF5F5] text-[#9B2C2C] ring-[#FEB2B2]",
        state === "waiting" && "bg-white/70 text-[var(--cosmo-label)] ring-[var(--cosmo-hairline)]",
        state === "none" && "bg-[#FFFAF0] text-[#744210] ring-[#FBD38D]",
        state === "failed" && "bg-[#FFF5F5] text-[#9B2C2C] ring-[#FC8181]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          state === "done" && "bg-[#2F855A] text-white",
          state === "now" && "bg-[#C53030] text-white",
          state === "waiting" && "bg-[#EDF2F7] text-[#A0AEC0]",
          state === "none" && "bg-[#FEEBC8] text-[#744210]",
          state === "failed" && "bg-[#9B2C2C] text-white",
        )}
      >
        {icon}
      </span>
      <span className="max-w-full min-w-0 [overflow-wrap:normal] [hyphens:auto]">
        {label}
        <span className="sr-only"> ({t(`emergency.sos.step.${state}`)})</span>
      </span>
    </li>
  );
}

function Steps({ signal, earth, photo, t }: { signal: StepState; earth: StepState; photo: StepState; t: T }) {
  return (
    <ol aria-label={t("emergency.sos.steps")} className="grid min-w-0 grid-cols-3 gap-1.5" data-slot="sos-steps">
      <Step label={t("emergency.sos.step.signal")} state={signal} t={t} />
      <Step label={t("emergency.sos.step.earth")} state={earth} t={t} />
      <Step label={t("emergency.sos.step.photo")} state={photo} t={t} />
    </ol>
  );
}

/* ───────────── the photo, with "Delete photo" ───────────── */

function PhotoRow({ s, t }: { s: Sent; t: T }) {
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const deleteAsked = useRef(false);
  const shown = s.photo === "attached" || s.photo === "deleting" || s.photo === "deleteFailed";

  // the button goes away once the photo is deleted: focus moves to the line that says so (keyboard, screen reader)
  useEffect(() => {
    if (s.photo === "deleted" && deleteAsked.current) {
      deleteAsked.current = false;
      statusRef.current?.focus();
    }
  }, [s.photo]);

  const deleting = s.photo === "deleting";
  const line =
    s.photo === "attached"
      ? t("emergency.sos.photo.attached")
      : s.photo === "deleting"
        ? t("emergency.sos.photo.deleting")
        : s.photo === "deleted"
          ? t("emergency.sos.photo.deleted")
          : s.photo === "deleteFailed"
            ? t("emergency.sos.photo.deleteFailed")
            : s.photo === "taking" || s.photo === "waiting"
              ? t("emergency.sos.photo.taking")
              : t(`emergency.sos.photo.${s.photo}`);
  const tone =
    s.photo === "attached" || s.photo === "deleted"
      ? "text-[#22543D]"
      : s.photo === "deleteFailed" || s.photo === "failed"
        ? "text-[#9B2C2C]"
        : s.photo === "denied" || s.photo === "unavailable"
          ? "text-[#744210]"
          : "text-[var(--cosmo-label)]";

  return (
    <div className="flex min-w-0 items-center gap-3" data-slot="sos-photo" data-photo={s.photo}>
      <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#EDF2F7] ring-1 ring-black/5">
        {shown && s.photoUrl ? (
          // a local object URL of the still that was sent; next/image cannot optimise it
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.photoUrl}
            alt={t("emergency.sos.photo.alt")}
            className={cn("size-full object-cover transition-opacity", deleting && "opacity-40")}
          />
        ) : s.photo === "taking" || s.photo === "waiting" ? (
          <Camera className="size-6 text-[#4A5568] motion-safe:animate-pulse" aria-hidden />
        ) : shown ? (
          <Check className="size-6 text-[#2F855A]" aria-hidden />
        ) : (
          <CameraOff className="size-6 text-[#A0AEC0]" aria-hidden />
        )}
        {deleting ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-[#9B2C2C] motion-reduce:animate-none" aria-hidden />
          </span>
        ) : null}
      </span>
      <p ref={statusRef} tabIndex={-1} className={cn("min-w-0 flex-1 text-[14px] leading-snug [overflow-wrap:anywhere] outline-none", tone)}>
        {line}
      </p>
      {shown ? (
        <button
          type="button"
          data-slot="sos-photo-delete"
          aria-disabled={deleting || undefined}
          aria-label={s.photo === "deleteFailed" ? t("emergency.sos.photo.deleteRetry") : t("emergency.sos.photo.deleteAria")}
          onClick={() => {
            if (deleting) return;
            deleteAsked.current = true;
            void removeSosPhoto();
          }}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[14px] font-semibold text-[#9B2C2C] ring-1 ring-[#C53030]/35 outline-none transition-[background-color,opacity] hover:bg-[#FFF5F5] focus-visible:ring-3 focus-visible:ring-[#C53030]/40",
            deleting && "cursor-progress opacity-60",
          )}
        >
          {deleting ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : s.photo === "deleteFailed" ? (
            <RotateCw className="size-4" aria-hidden />
          ) : (
            <Trash2 className="size-4" aria-hidden />
          )}
          <span className="sm:hidden">{s.photo === "deleteFailed" ? t("emergency.sos.retry") : t("emergency.sos.photo.deleteShort")}</span>
          <span className="max-sm:hidden">
            {s.photo === "deleteFailed" ? t("emergency.sos.retry") : t("emergency.sos.photo.delete")}
          </span>
        </button>
      ) : null}
    </div>
  );
}

/* ───────────── the card ───────────── */

/**
 * The crew member's view of SOS to Earth, calm but unmistakable: the signal travelling from the station to Earth, the
 * three steps (signal sent, Earth received, photo), the time, the photo with "Delete photo", and in the emergency
 * overlay a calm line pointing at the guides below. Failed: what to do now (the station's comms) and "Try again".
 * `floating` sits above the screen; `inline` lives inside the emergency overlay, where it also offers "Send SOS to
 * Earth" when nothing was sent yet (the overlay may have been opened by symptom words).
 */
export function SosStatus({
  variant,
  checkInId,
  lang,
}: {
  variant: "floating" | "inline";
  checkInId: string | null;
  lang: Lang;
}) {
  const { t } = useI18n();
  const s = useSosState();
  const inline = variant === "inline";

  let body: ReactNode = null;
  if (s.phase === "idle") {
    body = inline ? (
      <button
        type="button"
        onClick={() => void sendSosToEarth({ checkInId, lang })}
        className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-[#C53030] px-4 py-2.5 text-left text-white shadow-[0_12px_30px_-14px_rgba(197,48,48,0.9)] outline-none transition-transform focus-visible:ring-3 focus-visible:ring-[#C53030]/40 active:scale-[0.99]"
      >
        <SatelliteDish className="size-5 shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-[16px] font-semibold">{t("emergency.sos.send")}</span>
          <span className="text-[13px] text-white/85">{t("emergency.sos.sendHint")}</span>
        </span>
      </button>
    ) : null;
  } else {
    const time = s.phase === "sent" ? formatClockLabel(s.createdAt, lang) : null;
    const headline =
      s.phase === "sending"
        ? t("emergency.sos.sending")
        : s.phase === "failed"
          ? t("emergency.sos.failed")
          : s.duplicate
            ? t("emergency.sos.duplicate", { time: time ?? "" })
            : t("emergency.sos.sent", { time: time ?? "" });
    const signal: StepState = s.phase === "failed" ? "failed" : s.phase === "sending" ? "now" : "done";
    const earth: StepState = s.phase === "sent" ? "done" : s.phase === "failed" ? "failed" : "waiting";
    const photo: StepState = s.phase === "sent" ? photoStep(s.photo) : "waiting";

    body = (
      <div className={cn("flex flex-col gap-3", inline && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center lg:gap-4")}>
        <div className={cn("flex min-w-0 items-center gap-3", variant === "floating" && "pr-9")}>
          <SignalRoute phase={s.phase} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[12px] font-bold tracking-[0.14em] text-[#C53030] uppercase">{t("emergency.sos.title")}</p>
            <p
              className={cn(
                "text-[15.5px] leading-snug font-semibold sm:text-[16px]",
                s.phase === "failed" ? "text-[#9B2C2C]" : "text-[#0F1B2D]",
              )}
            >
              {headline}
            </p>
          </div>
        </div>

        <Steps signal={signal} earth={earth} photo={photo} t={t} />

        {s.phase === "sent" ? (
          <PhotoRow s={s} t={t} />
        ) : s.phase === "failed" ? (
          <button
            type="button"
            onClick={() => void sendSosToEarth({ checkInId: s.checkInId ?? checkInId, lang: s.lang })}
            className="inline-flex h-11 w-fit items-center gap-2 rounded-full bg-[#C53030] px-5 text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(197,48,48,0.9)] outline-none focus-visible:ring-3 focus-visible:ring-[#C53030]/40 active:scale-[0.99]"
          >
            <RotateCw className="size-4" aria-hidden />
            {t("emergency.sos.retry")}
          </button>
        ) : null}

        {inline && s.phase === "sent" ? (
          <p className="flex items-center gap-2 text-[13px] text-[var(--cosmo-label)] lg:col-span-3">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#C53030] motion-safe:animate-pulse" />
            <span>
              <span className="font-semibold text-[#C53030]">{t("emergency.sos.signal")}.</span>{" "}<span className="max-sm:hidden">{t("emergency.sos.calm")}</span>
            </span>
          </p>
        ) : null}
      </div>
    );
  }

  const card =
    body === null ? null : (
      <motion.div
        key="sos-card"
        data-slot="sos-status"
        data-phase={s.phase}
        role={s.phase === "failed" ? "alert" : "status"}
        aria-live={s.phase === "failed" ? "assertive" : "polite"}
        initial={{ opacity: 0, y: -14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className={cn(
          "relative",
          s.phase !== "idle" &&
            "overflow-hidden rounded-[24px] border border-white/80 bg-white/90 p-3 shadow-[0_24px_60px_-28px_rgba(197,48,48,0.55)] ring-1 ring-[#C53030]/20 backdrop-blur-xl sm:p-4",
          variant === "floating" && "w-[min(32rem,calc(100vw-2rem))]",
        )}
      >
        {s.phase !== "idle" ? (
          // a thin red line along the top: the emergency signal is on
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-1",
              s.phase === "failed" ? "bg-[#9B2C2C]" : "bg-gradient-to-r from-[#C53030] via-[#F56565] to-[#4F86F7]",
            )}
          />
        ) : null}
        {body}
        {variant === "floating" && s.phase !== "idle" && s.phase !== "sending" ? (
          <button
            type="button"
            onClick={dismissSos}
            aria-label={t("emergency.sos.dismiss")}
            className="absolute top-2 right-2 flex size-10 items-center justify-center rounded-full text-[#0F1B2D]/60 outline-none hover:bg-black/5 focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </motion.div>
    );

  // reduced motion holds wherever the card is mounted
  if (inline) {
    return (
      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>{card}</AnimatePresence>
      </MotionConfig>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[65] flex justify-center px-4">
        <div className="pointer-events-auto">
          <AnimatePresence>{card}</AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
