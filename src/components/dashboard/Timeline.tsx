"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import type { DashboardPayload, Lang } from "@/lib/types";
import { StatusGlyph } from "@/components/status";
import { statusWordKey } from "@/components/status/statusClasses";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { buildTimeline, type TimelineDay } from "./logic";
import { AXIS_ICON } from "./parts";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RAISED = 4;

function monthLabel(date: string, lang: Lang): string {
  const m = Number(date.slice(5, 7));
  return lang === "mn" ? `${m}-р сар` : MONTHS_EN[m - 1] ?? "";
}

function dateLabel(date: string, lang: Lang): string {
  const d = Number(date.slice(8, 10));
  return lang === "mn" ? `${Number(date.slice(5, 7))}-р сарын ${d}` : `${MONTHS_EN[Number(date.slice(5, 7)) - 1]} ${d}`;
}

const BADGE: Record<TimelineDay["status"], string> = {
  green: "bg-[#eef1f5] text-[#5b6678]",
  yellow: "bg-status-watch-soft text-status-watch-ink ring-1 ring-status-watch/35",
  red: "bg-status-alert-soft text-status-alert-ink ring-1 ring-status-alert/35",
  no_data: "border-[1.5px] border-dashed border-status-nodata/60 bg-transparent text-status-nodata",
};

/**
 * Bottom strip: one badge per day (worst body area icon, coloured and shaped by the day's status, hollow when
 * nothing was recorded), month labels above, day numbers below, the last four days on a raised white pill.
 */
export function Timeline({
  payload,
  size = "strip",
}: {
  payload: DashboardPayload;
  /** strip: the overview's bottom strip (title beside the days on desktop); large: the Trends view */
  size?: "strip" | "large";
}) {
  const large = size === "large";
  const { t, lang } = useI18n();
  const days = useMemo(
    () =>
      buildTimeline({
        kpis: payload.kpis,
        overall: payload.overall,
        axes: payload.axes,
        confirmedAt: payload.checkIn.confirmedAt,
      }),
    [payload.kpis, payload.overall, payload.axes, payload.checkIn.confirmedAt],
  );
  const split = Math.max(days.length - RAISED, 0);
  const past = days.slice(0, split);
  const recent = days.slice(split);

  const renderDay = (day: TimelineDay, i: number, offset: number) => {
    const prev = offset + i === 0 ? null : days[offset + i - 1];
    const showMonth = prev === null || prev.date.slice(5, 7) !== day.date.slice(5, 7);
    const Icon = day.axis ? AXIS_ICON[day.axis] : Check;
    const status = t(statusWordKey(day.status));
    const label = day.axis
      ? t("dashboard.timeline.dayAxis", { date: dateLabel(day.date, lang), status, axis: t(`dashboard.axis.${day.axis}`) })
      : t("dashboard.timeline.day", { date: dateLabel(day.date, lang), status });
    return (
      <li
        key={day.date}
        className={cn(
          "flex shrink-0 flex-col items-center gap-1.5",
          large ? "w-11 lg:w-[clamp(44px,3.6vw,64px)]" : "w-11 lg:w-[clamp(36px,2.9vw,44px)] lg:gap-1",
        )} data-status={day.status} data-today={day.today ? "true" : undefined}>
        <span aria-hidden="true" className="h-4 text-[11px] font-medium whitespace-nowrap text-[var(--aegis-label)]">
          {showMonth ? monthLabel(day.date, lang) : ""}
        </span>
        <span
          role="img"
          aria-label={day.today ? `${t("dashboard.timeline.today")}. ${label}` : label}
          className={cn(
            "relative inline-flex size-10 items-center justify-center rounded-full",
            large ? "lg:size-[clamp(40px,3.2vw,54px)]" : "lg:size-[clamp(32px,4.4vh,40px)]",
            BADGE[day.status],
            day.today && "ring-2 ring-[var(--aegis-accent)] ring-offset-2 ring-offset-white",
          )}
        >
          {day.status === "no_data" ? null : (
            <Icon aria-hidden="true" className={cn("size-4", large && "lg:size-5")} strokeWidth={1.9} />
          )}
          {day.status === "yellow" || day.status === "red" ? (
            <span className="absolute -right-0.5 -bottom-0.5 inline-flex size-4 items-center justify-center rounded-full bg-white shadow-sm">
              <StatusGlyph status={day.status} size={10} labelled={false} />
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "tnum text-[12px]",
            day.today ? "font-semibold text-[var(--aegis-ink)]" : "text-[var(--aegis-label)]",
          )}
        >
          {Number(day.date.slice(8, 10))}
        </span>
      </li>
    );
  };

  return (
    <section
      data-slot="timeline"
      aria-labelledby="timeline-title"
      className={cn(
        "glass-card flex flex-col gap-3 px-5 pt-4 pb-3",
        large
          ? "lg:gap-[clamp(8px,1.6vh,16px)] lg:px-6 lg:py-[clamp(12px,2vh,20px)]"
          : "lg:flex-row lg:items-center lg:gap-5 lg:px-5 lg:py-[clamp(6px,1vh,12px)]",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1",
          !large && "lg:w-[clamp(150px,14vw,220px)] lg:shrink-0 lg:flex-col lg:items-start lg:justify-center lg:gap-1",
        )}
      >
        <h2
          id="timeline-title"
          className={cn("text-[18px] leading-tight font-normal text-[var(--aegis-ink)]", large && "lg:text-[22px]")}
        >
          {t("dashboard.timeline.title")}
        </h2>
        <p className={cn("text-[11px] leading-snug text-[var(--aegis-label)]", !large && "lg:line-clamp-3")}>
          {t("dashboard.timeline.caption")}
          {payload.simulatedHistory ? ` · ${t("dashboard.simulatedHistory")}` : ""}
        </p>
      </div>
      <div
        className="aegis-noscrollbar -mx-2 min-w-0 overflow-x-auto px-2 pb-1 lg:flex-1 lg:py-1"
        tabIndex={0}
        aria-label={t("dashboard.timeline.title")}
      >
        <div className="flex w-max min-w-full items-center justify-between gap-3">
          <ol className={cn("flex items-center gap-2.5", !large && "lg:gap-[clamp(4px,0.5vw,10px)]", large && "lg:flex-1 lg:justify-between")}>
            {past.map((d, i) => renderDay(d, i, 0))}
          </ol>
          <ol
            className={cn(
              "flex items-center gap-2.5 rounded-full bg-white px-4 py-2 shadow-[0_14px_30px_-16px_rgba(40,80,160,0.45)] ring-1 ring-[var(--aegis-hairline)]",
              !large && "lg:gap-[clamp(4px,0.5vw,10px)] lg:px-3 lg:py-1.5",
            )}
          >
            {recent.map((d, i) => renderDay(d, i, split))}
          </ol>
        </div>
      </div>
    </section>
  );
}
