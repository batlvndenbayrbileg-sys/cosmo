"use client";

import Link from "next/link";
import type { AlertRow, CrewStatusCard } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusGlyph } from "@/components/status";
import { statusClasses, statusWordKey } from "@/components/status/statusClasses";
import { formatClockLabel } from "@/components/dashboard/logic";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { DelayId } from "./delay";
import { sortAlertsNewestFirst } from "./logic";

/** Alerts from GET /api/ground/alerts: level, text, time and crew name. Values and statuses only, never notes. */
export function AlertsFeed({
  alerts,
  crew,
  delayId,
}: {
  alerts: AlertRow[];
  crew: CrewStatusCard[];
  delayId: DelayId;
}) {
  const { t, pick, lang } = useI18n();
  const names = new Map(crew.map((c) => [c.crew.id, c.crew.name]));
  const sorted = sortAlertsNewestFirst(alerts);

  return (
    <Card data-slot="alerts-feed" aria-labelledby="alerts-feed-title" className="gap-3">
      <CardHeader>
        <CardTitle id="alerts-feed-title" className="text-lg">
          {t("earth.alerts.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("earth.alerts.subtitle")}</p>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-3 text-base text-muted-foreground">
            {t("earth.alerts.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sorted.map((alert) => (
              <li
                key={alert.id}
                data-alert={alert.id}
                className="flex items-start gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10"
              >
                <StatusGlyph status={alert.level} size={20} className="mt-0.5" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-base text-foreground">{pick(alert.text)}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className={cn("font-medium", statusClasses(alert.level).ink)}>
                      {t(statusWordKey(alert.level))}
                    </span>
                    {" · "}
                    <Link
                      href={`/earth/${encodeURIComponent(alert.crewId)}?delay=${delayId}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {names.get(alert.crewId) ?? alert.crewId}
                    </Link>
                    {" · "}
                    <span className="tnum">{formatClockLabel(alert.createdAt, lang)}</span>
                    {" · "}
                    {alert.acknowledgedAt ? t("earth.alerts.acknowledged") : t("earth.alerts.open")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
