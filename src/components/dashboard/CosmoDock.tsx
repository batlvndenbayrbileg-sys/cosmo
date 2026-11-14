"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Square, Volume2 } from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import type { CosmoEmotion } from "@/components/cosmo/types";
import { useI18n } from "@/i18n/I18nProvider";
import { COSMO_LAYOUT_ID } from "@/lib/motion";
import { useSummaryAudio } from "./useSummaryAudio";

const AVATAR_PX = 64;

function emotionFor(overall: DashboardPayload["overall"]): CosmoEmotion {
  if (overall === "red") return "concerned";
  if (overall === "green") return "happy";
  return "neutral";
}

/** text spoken by the browser voice when the stored audio is unavailable: the stored phrasing, else the headline */
function fallbackSpeech(summary: DashboardPayload["summary"]): string {
  const spoken = summary.spoken.text.trim();
  if (spoken !== "") return spoken;
  return [summary.headline[summary.spoken.language], summary.disclaimer[summary.spoken.language]]
    .filter((s) => s.trim() !== "")
    .join(" ");
}

/**
 * Cosmo dock, fixed bottom-right (crew viewer only): Cosmo (the check-in screen's shared element via
 * `dockSlot`, otherwise its own avatar on the shared layout id), the summary (one status line, up to two
 * findings, up to two recommendations, the disclaimer) and a replay button.
 */
export function CosmoDock({
  payload,
  dockSlot,
}: {
  payload: DashboardPayload;
  dockSlot?: ReactNode;
}) {
  const { t, pick } = useI18n();
  // open right after the check-in hand-off (dockSlot given); collapsed on reloads so it does not cover the cards
  const [open, setOpen] = useState(dockSlot !== undefined);
  const { summary } = payload;
  const audio = useSummaryAudio({
    checkInId: payload.checkIn.id,
    audioTurnId: summary.audioTurnId,
    text: fallbackSpeech(summary),
    language: summary.spoken.language,
  });

  const findings = summary.findings.slice(0, 2);
  const recommendations = summary.recommendations.slice(0, 2);

  return (
    <aside
      data-slot="cosmo-dock"
      role="region"
      aria-label={t("dashboard.dock.region")}
      className="z-40 flex w-full flex-col overflow-hidden rounded-[24px] border border-white/80 bg-white/75 shadow-[0_30px_70px_-30px_rgba(40,80,160,0.55)] backdrop-blur-xl md:fixed md:right-5 md:bottom-12 md:w-[min(21.5rem,calc(100vw-2rem))]"
    >
      <div className="flex items-center gap-3 p-3">
        <div className="shrink-0" style={{ width: AVATAR_PX, height: AVATAR_PX }}>
          {dockSlot ?? (
            <motion.div layoutId={COSMO_LAYOUT_ID} style={{ width: AVATAR_PX, height: AVATAR_PX }}>
              <CosmoAvatar
                variant={payload.crew.mascotVariant}
                state={audio.playing ? "talking" : "idle"}
                emotion={emotionFor(payload.overall)}
                amplitude={audio.amplitude}
                size={AVATAR_PX}
                label={t("dashboard.dock.avatar")}
              />
            </motion.div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="unit-label">{t("dashboard.dock.title")}</p>
          <p data-slot="dock-headline" className="line-clamp-2 text-[15px] leading-snug font-medium text-[var(--aegis-ink)]">
            {pick(summary.headline)}
          </p>
        </div>
        <Button
          type="button"
          size="icon-lg"
          variant="ghost"
          aria-expanded={open}
          aria-label={open ? t("dashboard.dock.hide") : t("dashboard.dock.show")}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
        </Button>
      </div>

      {open ? (
        <div className="flex max-h-[min(24rem,52vh)] flex-col gap-3 overflow-y-auto border-t border-[var(--aegis-hairline)] px-4 py-3">
          <section aria-label={t("dashboard.dock.findings")} className="flex flex-col gap-1.5">
            <h3 className="unit-label">{t("dashboard.dock.findings")}</h3>
            {findings.length === 0 ? (
              <p className="text-[14px] text-[var(--aegis-ink)]">{t("dashboard.dock.noFindings")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {findings.map((f) => (
                  <li key={f.key} className="text-[14px] leading-snug text-[var(--aegis-ink)]">
                    {pick(f.text)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {recommendations.length > 0 ? (
            <section aria-label={t("dashboard.dock.recommendations")} className="flex flex-col gap-1.5">
              <h3 className="unit-label">
                {t("dashboard.dock.recommendations")}
              </h3>
              <ul className="flex flex-col gap-2">
                {recommendations.map((r) => (
                  <li key={r.id} className="flex flex-col rounded-2xl bg-[var(--aegis-pastel-blue)]/70 px-3 py-2 text-[14px] leading-snug text-[var(--aegis-ink)]">
                    <span className="font-medium">{pick(r.title)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="text-[12px] text-[var(--aegis-label)]">{pick(summary.disclaimer)}</p>

          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="rounded-full bg-white"
              disabled={!audio.canPlay}
              aria-pressed={audio.playing}
              onClick={audio.playing ? audio.stop : audio.play}
            >
              {audio.playing ? (
                <Square aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Volume2 aria-hidden="true" data-icon="inline-start" />
              )}
              {audio.playing ? t("dashboard.dock.stop") : t("dashboard.dock.replay")}
            </Button>
            {audio.mode === "speech" ? (
              <p role="status" className="text-xs text-muted-foreground">
                {t("dashboard.dock.speechFallback")}
              </p>
            ) : null}
            {!audio.canPlay ? (
              <p role="status" className="text-xs text-muted-foreground">
                {t("dashboard.dock.unavailable")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
