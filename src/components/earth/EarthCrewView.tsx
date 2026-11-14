"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { DashboardMotionProvider } from "@/components/dashboard/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { DelaySelector } from "./DelaySelector";
import { ErrorNotice } from "./ErrorNotice";
import { delayMsFor, parseDelayId, type DelayId } from "./delay";
import { useResource } from "./useResource";

function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("earth.crewPage.loading")} className="flex flex-col gap-4">
      <Skeleton className="h-16 w-1/2 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * /earth/[crewId] (client): the same DashboardView, read-only, from
 * GET /api/ground/crew/[crewId]/dashboard?delayMs=. A 404 (or an empty answer) means the simulated delay
 * hides every check-in, shown as a calm "No data visible yet" state.
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
    <div data-slot="earth-crew" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <Link
          href={`/earth?delay=${delayId}`}
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
        >
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          {t("earth.crewPage.back")}
        </Link>
        <DelaySelector value={delayId} onChange={setDelayId} />
      </div>
      <p className="text-sm text-muted-foreground">{t("earth.delay.hint")}</p>

      {dashboard.status === "loading" ? <DashboardSkeleton /> : null}

      {dashboard.status === "error" && !empty ? (
        <ErrorNotice
          title={t("earth.crewPage.error")}
          detail={dashboard.error.message}
          onRetry={dashboard.reload}
        />
      ) : null}

      {empty ? (
        <div
          role="status"
          className="flex max-w-xl flex-col gap-1 rounded-xl border border-dashed border-border bg-card px-5 py-6"
        >
          <p className="text-xl font-semibold text-foreground">{t("earth.crewPage.emptyTitle")}</p>
          <p className="text-base text-muted-foreground">{t("earth.crewPage.emptyBody")}</p>
        </div>
      ) : null}

      {dashboard.status === "ready" && dashboard.data ? (
        <DashboardMotionProvider animate>
          <DashboardView
            key={`${crewId}:${delayId}`}
            payload={dashboard.data}
            viewer="ground"
          />
        </DashboardMotionProvider>
      ) : null}
    </div>
  );
}
