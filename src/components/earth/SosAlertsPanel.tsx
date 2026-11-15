"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BellOff, BellRing, CameraOff, Check, Eye, ImageIcon, SatelliteDish, Volume2 } from "lucide-react";
import type { GroundSosAlert } from "@/lib/sos";
import { formatClockLabel } from "@/components/dashboard/logic";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { DelayId } from "./delay";
import { createSiren, type Siren } from "./siren";
import { useSosAlerts } from "./useSosAlerts";

/** how many SOS alerts the panel shows (unseen first, then the most recent seen ones) */
const MAX_SHOWN = 4;

function reasonText(a: GroundSosAlert, t: ReturnType<typeof useI18n>["t"]): string {
  if (a.reason === "button") return t("emergency.sos.earth.reasonButton");
  return a.phrase ? t("emergency.sos.earth.reasonVoice", { phrase: a.phrase }) : t("emergency.sos.earth.reasonVoicePlain");
}

function Photo({ alert, delayQuery }: { alert: GroundSosAlert; delayQuery: string }) {
  const { t } = useI18n();
  if (alert.photoStatus === "attached") {
    return (
      // served by the authenticated ground route; next/image would proxy and cache it
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/ground/sos/${encodeURIComponent(alert.id)}/photo?${delayQuery}&v=${encodeURIComponent(alert.photoAt ?? "")}`}
        alt={t("emergency.sos.earth.photoAlt", { name: alert.crewName })}
        className="size-28 shrink-0 rounded-2xl object-cover ring-2 ring-white shadow-[0_10px_30px_-12px_rgba(120,20,20,0.7)] sm:size-32"
      />
    );
  }
  const pending = alert.photoStatus === "pending";
  return (
    <span className="flex size-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/70 px-2 text-center text-[12px] leading-tight text-[#742A2A] ring-1 ring-[#C53030]/25 sm:size-32">
      {pending ? (
        <ImageIcon className="size-6 motion-safe:animate-pulse" aria-hidden />
      ) : (
        <CameraOff className="size-6" aria-hidden />
      )}
      {pending
        ? t("emergency.sos.earth.photoPending")
        : alert.photoStatus === "denied"
          ? t("emergency.sos.earth.photoDenied")
          : t("emergency.sos.earth.photoUnavailable")}
    </span>
  );
}

/**
 * The Earth console's SOS strip, at the top of the page: each SOS from the crew in red with the face photo, the time,
 * the reason (pressed SOS / the words heard) and the emergency signal. An unseen SOS flashes (slowly, about once a
 * second, and not at all with reduced motion) and sounds a WebAudio siren until someone presses "Mark seen". New
 * alerts arrive by polling (useSosAlerts). Renders nothing while there is no SOS.
 */
export function SosAlertsPanel({ delayMs, delayId, crewId }: { delayMs: number; delayId: DelayId; crewId?: string }) {
  const { t, lang } = useI18n();
  const { alerts, markSeen, delayQuery } = useSosAlerts(delayMs, crewId);
  const shown = useMemo(() => {
    const unseen = alerts.filter((a) => !a.seenAt);
    const seen = alerts.filter((a) => a.seenAt);
    return [...unseen, ...seen].slice(0, MAX_SHOWN);
  }, [alerts]);
  const ringing = alerts.some((a) => !a.seenAt);

  const sirenRef = useRef<Siren | null>(null);
  const [muted, setMuted] = useState(false);
  const [soundState, setSoundState] = useState<"running" | "suspended" | "unsupported">("running");

  useEffect(() => {
    const siren = createSiren();
    sirenRef.current = siren;
    // any click or key on the page lets the browser play the alarm
    const unlock = () => {
      void siren.unlock().then(() => setSoundState(siren.state()));
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      siren.dispose();
      sirenRef.current = null;
    };
  }, []);

  useEffect(() => {
    const siren = sirenRef.current;
    if (!siren) return;
    if (ringing && !muted) {
      siren.start();
      // read once the alarm is asked for; the browser may keep it suspended until a click
      const id = window.setTimeout(() => setSoundState(siren.state()), 0);
      return () => window.clearTimeout(id);
    }
    siren.stop();
  }, [ringing, muted]);

  if (shown.length === 0) return null;

  return (
    <section
      data-slot="sos-panel"
      aria-labelledby="sos-panel-title"
      className="relative overflow-hidden rounded-[var(--aegis-radius-card)] border border-[#C53030]/40 bg-gradient-to-br from-[#FFF5F5] via-white to-[#FED7D7] p-4 shadow-[0_30px_80px_-40px_rgba(197,48,48,0.8)] sm:p-5"
    >
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <span className="relative flex size-10 items-center justify-center">
          {ringing ? <span aria-hidden className="absolute inset-0 rounded-full bg-[#C53030]/40 motion-safe:animate-ping" /> : null}
          <span className="relative flex size-10 items-center justify-center rounded-full bg-[#C53030] text-white">
            <SatelliteDish className="size-5" aria-hidden />
          </span>
        </span>
        <h2 id="sos-panel-title" className="text-[20px] font-semibold tracking-tight text-[#742A2A]">
          {t("emergency.sos.earth.title")}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {ringing && !muted && soundState === "suspended" ? (
            <button
              type="button"
              onClick={() => void sirenRef.current?.unlock().then(() => setSoundState(sirenRef.current?.state() ?? "unsupported"))}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-[#742A2A] ring-1 ring-[#C53030]/30 outline-none focus-visible:ring-3 focus-visible:ring-[#C53030]/40"
            >
              <Volume2 className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("emergency.sos.earth.soundBlocked")} · </span>
              {t("emergency.sos.earth.soundEnable")}
            </button>
          ) : null}
          {ringing ? (
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-pressed={muted}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white/80 px-4 text-[13px] font-medium text-[#742A2A] ring-1 ring-[#C53030]/20 outline-none focus-visible:ring-3 focus-visible:ring-[#C53030]/40"
          >
            {muted ? <BellRing className="size-4" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
            {muted ? t("emergency.sos.earth.unmute") : t("emergency.sos.earth.mute")}
          </button>
          ) : null}
        </div>
      </header>

      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {shown.map((a) => {
            const unseen = !a.seenAt;
            return (
              <motion.li
                key={a.id}
                layout
                data-sos={a.id}
                data-seen={unseen ? "false" : "true"}
                initial={{ opacity: 0, y: -18, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 220, damping: 24 }}
                role={unseen ? "alert" : undefined}
                className={cn(
                  "relative flex flex-col gap-3 overflow-hidden rounded-[22px] p-3 sm:flex-row sm:items-center sm:p-4",
                  unseen ? "bg-[#C53030] text-white ring-2 ring-[#9B2C2C]" : "bg-white/85 text-[#0F1B2D] ring-1 ring-[#C53030]/25",
                )}
              >
                {unseen ? (
                  <span aria-hidden className="pointer-events-none absolute inset-0 bg-[#FC8181]/45 motion-safe:animate-pulse" style={{ animationDuration: "1s" }} />
                ) : null}
                <div className="relative flex items-center gap-3 sm:contents">
                  <Photo alert={a} delayQuery={delayQuery} />
                </div>
                <div className="relative flex min-w-0 flex-1 flex-col gap-1">
                  <p className={cn("text-[12px] font-bold tracking-[0.14em] uppercase", unseen ? "text-white/90" : "text-[#C53030]")}>
                    SOS · {t("emergency.sos.earth.signal")}
                  </p>
                  <Link
                    href={`/earth/${encodeURIComponent(a.crewId)}?delay=${delayId}`}
                    aria-label={t("emergency.sos.earth.openCrew", { name: a.crewName })}
                    className="w-fit rounded text-[22px] leading-tight font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    {a.crewName}
                  </Link>
                  <p className={cn("text-[15px]", unseen ? "text-white/95" : "text-[#2D3748]")}>{reasonText(a, t)}</p>
                  <p className={cn("tnum text-[13px]", unseen ? "text-white/85" : "text-[var(--aegis-label)]")}>
                    {t("emergency.sos.earth.at", { time: formatClockLabel(a.createdAt, lang) })}
                    {a.seenAt ? ` · ${t("emergency.sos.earth.seenAt", { time: formatClockLabel(a.seenAt, lang) })}` : ""}
                  </p>
                </div>
                <div className="relative flex shrink-0 items-center">
                  {unseen ? (
                    <button
                      type="button"
                      onClick={() => void markSeen(a.id)}
                      className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-[#9B2C2C] shadow-[0_10px_24px_-12px_rgba(0,0,0,0.5)] outline-none focus-visible:ring-3 focus-visible:ring-white/70"
                    >
                      <Eye className="size-4" aria-hidden />
                      {t("emergency.sos.earth.markSeen")}
                    </button>
                  ) : (
                    <span className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#F0FFF4] px-4 text-[14px] font-medium text-[#22543D] ring-1 ring-[#9AE6B4]">
                      <Check className="size-4" aria-hidden />
                      {t("emergency.sos.earth.seen")}
                    </span>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
