"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Camera, CameraOff, Check, Loader2, RotateCw, SatelliteDish, X } from "lucide-react";
import type { Lang } from "@/lib/types";
import { formatClockLabel } from "@/components/dashboard/logic";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { SOS_IDLE, dismissSos, getSosState, sendSosToEarth, subscribeSos, type SosUiState } from "./store";

const RED = "#C53030";

export function useSosState(): SosUiState {
  return useSyncExternalStore(subscribeSos, getSosState, () => SOS_IDLE);
}

/** the pulsing beacon of an active emergency signal (static for reduced motion) */
function Beacon({ active }: { active: boolean }) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center">
      {active ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[#C53030]/35 motion-safe:animate-ping"
          style={{ animationDuration: "1.6s" }}
        />
      ) : null}
      <span className="relative flex size-11 items-center justify-center rounded-full bg-[#C53030] text-white shadow-[0_8px_24px_-8px_rgba(197,48,48,0.8)]">
        <SatelliteDish className="size-5" aria-hidden />
      </span>
    </span>
  );
}

function PhotoLine({ s }: { s: Extract<SosUiState, { phase: "sent" }> }) {
  const { t } = useI18n();
  if (s.photo === "attached") {
    return (
      <span className="flex items-center gap-2 text-[14px] text-[#22543D]">
        {s.photoUrl ? (
          // a local object URL of the still that was sent; next/image cannot optimise it
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.photoUrl} alt={t("emergency.sos.photo.alt")} className="size-10 rounded-lg object-cover ring-1 ring-black/10" />
        ) : null}
        <Check className="size-4 shrink-0" aria-hidden />
        {t("emergency.sos.photo.attached")}
      </span>
    );
  }
  if (s.photo === "taking" || s.photo === "waiting") {
    return (
      <span className="flex items-center gap-2 text-[14px] text-[var(--aegis-label)]">
        <Camera className="size-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
        {t("emergency.sos.photo.taking")}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-[14px] text-[#744210]">
      <CameraOff className="size-4 shrink-0" aria-hidden />
      {t(`emergency.sos.photo.${s.photo}`)}
    </span>
  );
}

/**
 * The crew member's view of SOS to Earth: sending, sent (time, emergency signal, the photo's fate), or failed (use the
 * station's comms, try again). `floating` sits above the screen; `inline` lives inside the emergency overlay, where
 * it also offers "Send SOS to Earth" when nothing was sent yet (the overlay may have been opened by symptom words).
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

  let body: ReactNode = null;
  if (s.phase === "idle") {
    body =
      variant === "inline" ? (
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
  } else if (s.phase === "sending") {
    body = (
      <div className="flex items-center gap-3">
        <Beacon active />
        <p className="text-[16px] font-medium text-[#0F1B2D]">{t("emergency.sos.sending")}</p>
        <Loader2 className="ml-auto size-5 shrink-0 animate-spin text-[#C53030]" aria-hidden />
      </div>
    );
  } else if (s.phase === "sent") {
    const time = formatClockLabel(s.createdAt, lang);
    body = (
      <div className="flex items-start gap-3">
        <Beacon active />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[16px] leading-snug font-semibold text-[#0F1B2D]">
            {s.duplicate ? t("emergency.sos.duplicate", { time }) : t("emergency.sos.sent", { time })}
          </p>
          <p className="text-[13px] font-medium tracking-wide text-[#C53030] uppercase">{t("emergency.sos.signal")}</p>
          <PhotoLine s={s} />
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex items-start gap-3">
        <Beacon active={false} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[16px] leading-snug font-semibold text-[#9B2C2C]">{t("emergency.sos.failed")}</p>
          <button
            type="button"
            onClick={() => void sendSosToEarth({ checkInId: s.checkInId ?? checkInId, lang: s.lang })}
            className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-[#C53030] px-4 text-[14px] font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-[#C53030]/40"
          >
            <RotateCw className="size-4" aria-hidden />
            {t("emergency.sos.retry")}
          </button>
        </div>
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
        aria-live="assertive"
        initial={{ opacity: 0, y: -14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className={cn(
          "relative rounded-[22px] border bg-white/95 p-3 pr-11 backdrop-blur",
          s.phase === "idle" ? "border-transparent !bg-transparent p-0 !pr-0" : "border-[#C53030]/30",
          s.phase !== "idle" && "shadow-[0_24px_60px_-28px_rgba(197,48,48,0.65)]",
          variant === "floating" && "w-[min(30rem,calc(100vw-2rem))]",
        )}
        style={s.phase === "idle" ? undefined : { borderColor: `${RED}4D` }}
      >
        {body}
        {variant === "floating" && s.phase !== "idle" && s.phase !== "sending" ? (
          <button
            type="button"
            onClick={dismissSos}
            aria-label={t("emergency.sos.dismiss")}
            className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full text-[#0F1B2D]/60 outline-none hover:bg-black/5 focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </motion.div>
    );

  // reduced motion holds wherever the card is mounted
  if (variant === "inline") {
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
