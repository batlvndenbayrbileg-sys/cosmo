"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import type { AlertRow, CrewStatusCard } from "@/lib/types";
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
  className,
}: {
  alerts: AlertRow[];
  crew: CrewStatusCard[];
  delayId: DelayId;
  className?: string;
}) {
  const { t, pick, lang } = useI18n();
  const names = new Map(crew.map((c) => [c.crew.id, c.crew.name]));
  const sorted = sortAlertsNewestFirst(alerts);
  const open = sorted.filter((a) => !a.acknowledgedAt).length;

  return (
    <section
      data-slot="alerts-feed"
      aria-labelledby="alerts-feed-title"
      className={cn("glass-card flex flex-col gap-4 p-4 sm:p-5", className)}
    >
      <header className="flex items-center gap-3">
        <span className="icon-chip">
          <Bell className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <h2 id="alerts-feed-title" className="text-[18px] text-[color:var(--aegis-ink)]">
            {t("earth.alerts.title")}
          </h2>
          <p className="text-[13px] text-[color:var(--aegis-label)]">{t("earth.alerts.subtitle")}</p>
        </div>
        <span className="pill tnum !min-h-8 !px-3 text-[14px]" aria-hidden="true">
          {open}
          <span className="unit-label">/ {sorted.length}</span>
        </span>
      </header>

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[color:var(--aegis-hairline)] bg-white/50 px-4 py-4 text-[15px] text-[color:var(--aegis-label)]">
          {t("earth.alerts.empty")}
        </p>
      ) : (
        <ul className="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-0.5">
          {sorted.map((alert) => (
            <li
              key={alert.id}
              data-alert={alert.id}
              className={cn(
                "flex items-start gap-3 rounded-2xl bg-white px-3.5 py-3 ring-1 ring-[color:var(--aegis-hairline)]",
                alert.acknowledgedAt && "opacity-75",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  statusClasses(alert.level).soft,
                )}
              >
                <StatusGlyph status={alert.level} size={16} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-[15px] leading-snug text-[color:var(--aegis-ink)]">{pick(alert.text)}</p>
                <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-[color:var(--aegis-label)]">
                  <span className={cn("font-medium", statusClasses(alert.level).ink)}>
                    {t(statusWordKey(alert.level))}
                  </span>
                  <span aria-hidden="true">·</span>
                  <Link
                    href={`/earth/${encodeURIComponent(alert.crewId)}?delay=${delayId}`}
                    className="rounded font-medium text-[color:var(--aegis-ink)] underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[color:var(--aegis-accent)]/45"
                  >
                    {names.get(alert.crewId) ?? alert.crewId}
                  </Link>
                  <span aria-hidden="true">·</span>
                  <span className="tnum">{formatClockLabel(alert.createdAt, lang)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{alert.acknowledgedAt ? t("earth.alerts.acknowledged") : t("earth.alerts.open")}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
