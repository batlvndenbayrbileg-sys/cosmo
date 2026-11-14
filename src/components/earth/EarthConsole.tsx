"use client";

import { useState } from "react";
import type { AlertRow, CrewStatusCard } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/I18nProvider";
import { AlertsFeed } from "./AlertsFeed";
import { CrewCard } from "./CrewCard";
import { DelaySelector } from "./DelaySelector";
import { ErrorNotice } from "./ErrorNotice";
import { delayMsFor, parseDelayId, type DelayId } from "./delay";
import { useResource } from "./useResource";

function CrewSkeletons() {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("earth.loading")} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-72 rounded-xl" />
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
    <div data-slot="earth-console" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t("earth.title")}</h1>
          <p className="text-lg text-muted-foreground">{t("earth.subtitle")}</p>
        </div>
        <Badge variant="outline" className="h-6 border-dashed px-2.5 text-xs">
          {t("earth.simulatedBadge")}
        </Badge>
      </header>

      <section aria-label={t("earth.delay.label")} className="flex flex-col gap-1.5">
        <DelaySelector value={delayId} onChange={setDelayId} />
        <p className="text-sm text-muted-foreground">{t("earth.delay.hint")}</p>
        <p className="text-xs text-muted-foreground">{t("earth.delay.notNasa")}</p>
      </section>

      <section aria-labelledby="earth-crew-title" className="flex flex-col gap-3">
        <h2 id="earth-crew-title" className="text-xl font-semibold text-foreground">
          {t("earth.crew.title")}
        </h2>
        {crew.status === "loading" ? <CrewSkeletons /> : null}
        {crew.status === "error" ? (
          <ErrorNotice title={t("earth.error")} detail={crew.error.message} onRetry={retry} />
        ) : null}
        {crew.status === "ready" ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {crewCards.map((card) => (
              <li key={card.crew.id}>
                <CrewCard card={card} delayId={delayId} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {alerts.status === "loading" ? (
        <Skeleton role="status" aria-label={t("earth.loading")} className="h-32 rounded-xl" />
      ) : null}
      {alerts.status === "error" ? (
        <ErrorNotice title={t("earth.error")} detail={alerts.error.message} onRetry={retry} />
      ) : null}
      {alerts.status === "ready" ? (
        <AlertsFeed alerts={alerts.data ?? []} crew={crewCards} delayId={delayId} />
      ) : null}

      <aside
        aria-labelledby="earth-privacy-title"
        className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3"
      >
        <h2 id="earth-privacy-title" className="text-sm font-medium text-foreground">
          {t("earth.privacy.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("earth.privacy.note")}</p>
        <p className="text-sm text-muted-foreground">{t("earth.privacy.noText")}</p>
      </aside>
    </div>
  );
}
