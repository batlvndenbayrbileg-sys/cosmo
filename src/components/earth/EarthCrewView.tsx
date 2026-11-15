"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { DashboardMotionProvider } from "@/components/dashboard/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { DelaySelector } from "./DelaySelector";
import { SosAlertsPanel } from "./SosAlertsPanel";
import { EarthTitle } from "./EarthTitle";
import { ErrorNotice } from "./ErrorNotice";
import { delayMsFor, parseDelayId, type DelayId } from "./delay";
import { useResource } from "./useResource";

const SKELETON = "rounded-[var(--aegis-radius-card)] bg-white/60";

function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("earth.crewPage.loading")} className="glass-frame flex flex-col gap-4">
      <Skeleton className={`h-16 w-1/2 ${SKELETON}`} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.4fr_1fr]">
        <Skeleton className={`h-96 ${SKELETON}`} />
        <Skeleton className={`h-96 ${SKELETON}`} />
        <Skeleton className={`h-96 ${SKELETON}`} />
      </div>
      <Skeleton className={`h-24 ${SKELETON}`} />
    </div>
  );
}

/**
 * /earth/[crewId] (client): a slim glass ground bar (back to all crew, Earth title, simulated link delay) above
 * the same DashboardView, read-only, from GET /api/ground/crew/[crewId]/dashboard?delayMs=. A 404 (or an
 * empty answer) means the simulated delay hides every check-in, shown as a calm "No data visible yet"
 * state. DashboardView draws its own frame and layout (lane C2); this page only adds the ground bar.
 */
export function EarthCrewView({ crewId, initialDelay }: { crewId: string; initialDelay?: string }) {
  const { t } = useI18n();
  const [delayId, setDelayId] = useState<DelayId>(() => parseDelayId(initialDelay));
  const delayMs = delayMsFor(delayId);

  const dashboard = useResource<DashboardPayload>(
    `/api/ground/crew/${encodeURIComponent(crewId)}/dashboard?delayMs=${delayMs}`,
    "ground",
  );

  const empty =
    (dashboard.status === "ready" && dashboard.data === null) ||
    (dashboard.status === "error" && dashboard.error.code === "NOT_FOUND");

  return (
    <div
      data-slot="earth-crew"
      className="mx-auto flex w-full max-w-[1360px] flex-col gap-4 px-3 pt-3 pb-16 sm:gap-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-20"
    >
      {/* ground bar: the dashboard below brings its own frame, top bar and language toggle */}
      <nav
        aria-label={t("earth.topbar.title")}
        className="glass-frame flex flex-col gap-2.5 !rounded-[26px] !p-2.5 sm:!rounded-full sm:!p-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href={`/earth?delay=${delayId}`}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-[color:var(--aegis-hairline)] bg-white px-4 text-[14px] font-medium text-[color:var(--aegis-ink)] shadow-[0_6px_18px_-12px_rgba(40,80,160,0.45)] outline-none transition-colors hover:bg-white/80 focus-visible:ring-3 focus-visible:ring-[color:var(--aegis-accent)]/45"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("earth.crewPage.back")}
          </Link>
          <EarthTitle />
          <DelaySelector value={delayId} onChange={setDelayId} className="ml-auto" />
        </div>
      </nav>
      <p className="-mt-1 flex items-center gap-1.5 px-3 text-[12px] text-[color:var(--aegis-label)]">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        {t("earth.delay.hint")}
      </p>

      <SosAlertsPanel delayMs={delayMs} delayId={delayId} crewId={crewId} />

      {dashboard.status === "loading" ? <DashboardSkeleton /> : null}

      {dashboard.status === "error" && !empty ? (
        <ErrorNotice
          title={t("earth.crewPage.error")}
          detail={dashboard.error.message}
          onRetry={dashboard.reload}
        />
      ) : null}

      {empty ? (
        <div role="status" className="glass-card flex max-w-xl flex-col gap-1 px-6 py-6">
          <p className="text-[20px] font-medium text-[color:var(--aegis-ink)]">{t("earth.crewPage.emptyTitle")}</p>
          <p className="text-[15px] text-[color:var(--aegis-label)]">{t("earth.crewPage.emptyBody")}</p>
        </div>
      ) : null}

      {dashboard.status === "ready" && dashboard.data ? (
        <DashboardMotionProvider animate>
          <DashboardView key={`${crewId}:${delayId}`} payload={dashboard.data} viewer="ground" />
        </DashboardMotionProvider>
      ) : null}
    </div>
  );
}
