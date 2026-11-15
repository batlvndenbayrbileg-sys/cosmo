"use client";

import { useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import { Info, ShieldCheck } from "lucide-react";
import type { AlertRow, CrewStatusCard } from "@/lib/types";
import { PageFrame } from "@/components/shell/PageFrame";
import { TopBar } from "@/components/shell/TopBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/I18nProvider";
import { AlertsFeed } from "./AlertsFeed";
import { CrewCard } from "./CrewCard";
import { DelaySelector } from "./DelaySelector";
import { SosAlertsPanel } from "./SosAlertsPanel";
import { PainReportsPanel } from "./PainReportsPanel";
import { EarthTitle } from "./EarthTitle";
import { ErrorNotice } from "./ErrorNotice";
import { delayMsFor, parseDelayId, type DelayId } from "./delay";
import { useResource } from "./useResource";

const CREW_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2";

function CrewSkeletons() {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("earth.loading")} className={CREW_GRID}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[268px] rounded-[var(--cosmo-radius-card)] bg-white/60" />
      ))}
    </div>
  );
}

/**
 * Earth console (client). On mount it starts the ground session (POST /api/session { role: "ground" }), then
 * reads GET /api/ground/crew and /api/ground/alerts with the simulated delay. The delay is a simulation
 * setting: changing it refetches, and check-ins newer than the delay disappear.
 */
export function EarthConsole({ initialDelay }: { initialDelay?: string }) {
  const { t } = useI18n();
  const [delayId, setDelayId] = useState<DelayId>(() => parseDelayId(initialDelay));
  const delayMs = delayMsFor(delayId);

  const crew = useResource<CrewStatusCard[]>(`/api/ground/crew?delayMs=${delayMs}`, "ground");
  const alerts = useResource<AlertRow[]>(`/api/ground/alerts?delayMs=${delayMs}`, "ground");

  const crewCards = crew.status === "ready" ? (crew.data ?? []) : [];
  const retry = () => {
    if (crew.status === "error") crew.reload();
    if (alerts.status === "error") alerts.reload();
  };

  return (
    <MotionConfig reducedMotion="user">
      <PageFrame data-slot="earth-console">
        <TopBar center={<EarthTitle />} />

        {/* SOS from the crew: always first, live (polled), with photo, alarm and "seen" */}
        <SosAlertsPanel delayMs={delayMs} delayId={delayId} />
        {/* what the crew told Cosmo hurts (the pain check), with the related values */}
        <PainReportsPanel delayMs={delayMs} delayId={delayId} />

        {/* heading + delay */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[30px] leading-tight font-light tracking-tight text-[color:var(--cosmo-ink)] sm:text-[34px]">
              {t("earth.heading.lead")} <span className="font-medium">{t("earth.heading.accent")}</span>
            </h1>
            <p className="max-w-xl text-[16px] text-[color:var(--cosmo-label)]">{t("earth.subtitle")}</p>
          </div>
          <section aria-label={t("earth.delay.label")} className="flex flex-col items-start gap-1.5 lg:items-end">
            <DelaySelector value={delayId} onChange={setDelayId} />
            <p className="flex items-center gap-1.5 text-[12px] text-[color:var(--cosmo-label)]">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              {t("earth.delay.hint")}
            </p>
            <p className="text-[11px] text-[color:var(--cosmo-label)]/80">{t("earth.delay.notNasa")}</p>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <section aria-labelledby="earth-crew-title" className="flex min-w-0 flex-col gap-3">
            <h2 id="earth-crew-title" className="sr-only">
              {t("earth.crew.title")}
            </h2>
            {crew.status === "loading" ? <CrewSkeletons /> : null}
            {crew.status === "error" ? (
              <ErrorNotice title={t("earth.error")} detail={crew.error.message} onRetry={retry} />
            ) : null}
            {crew.status === "ready" ? (
              <ul className={CREW_GRID}>
                {crewCards.map((card, i) => (
                  <motion.li
                    key={card.crew.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 150, damping: 22, delay: i * 0.06 }}
                  >
                    <CrewCard card={card} delayId={delayId} />
                  </motion.li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="flex min-w-0 flex-col gap-5">
            {alerts.status === "loading" ? (
              <Skeleton
                role="status"
                aria-label={t("earth.loading")}
                className="h-48 rounded-[var(--cosmo-radius-card)] bg-white/60"
              />
            ) : null}
            {alerts.status === "error" ? (
              <ErrorNotice title={t("earth.error")} detail={alerts.error.message} onRetry={retry} />
            ) : null}
            {alerts.status === "ready" ? (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 150, damping: 22, delay: 0.15 }}
              >
                <AlertsFeed alerts={alerts.data ?? []} crew={crewCards} delayId={delayId} />
              </motion.div>
            ) : null}

            <aside
              aria-labelledby="earth-privacy-title"
              className="glass-card flex items-start gap-3 !bg-white/60 p-4 sm:p-5"
            >
              <span className="icon-chip !size-9">
                <ShieldCheck className="size-[18px]" aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id="earth-privacy-title" className="text-[15px] font-medium text-[color:var(--cosmo-ink)]">
                  {t("earth.privacy.title")}
                </h2>
                <p className="text-[13px] leading-snug text-[color:var(--cosmo-label)]">{t("earth.privacy.note")}</p>
                <p className="text-[13px] leading-snug text-[color:var(--cosmo-label)]">{t("earth.privacy.noText")}</p>
              </div>
            </aside>
          </div>
        </div>
      </PageFrame>
    </MotionConfig>
  );
}
