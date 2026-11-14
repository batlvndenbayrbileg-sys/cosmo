"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts";
import type { AxisScore } from "@/lib/types";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { useDashboardAnimate } from "./motion";

/**
 * Health radar: six body areas, today (solid accent) against the person's own 14-day polygon (dashed grey).
 * Areas without data are drawn at the centre and marked "no data" on their label.
 */
export function HealthRadar({
  axes,
  fill = false,
  className,
}: {
  axes: AxisScore[];
  /** desktop single-screen layout: the chart takes the height it is given instead of a fixed aspect ratio */
  fill?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const animate = useDashboardAnimate();

  const rows = axes.map((a) => ({
    axis: a.axis,
    label: t(`dashboard.axis.${a.axis}`) + (a.score === null ? " (–)" : ""),
    today: a.score ?? 0,
    usual: a.baseline ?? 0,
    score: a.score,
    baseline: a.baseline,
  }));
  const anyUsual = axes.some((a) => a.baseline !== null);
  const anyMissing = axes.some((a) => a.score === null);

  const config = {
    today: { label: t("dashboard.radar.today"), color: "var(--aegis-accent)" },
    usual: { label: t("dashboard.radar.usual"), color: "#9aa6b8" },
  } satisfies ChartConfig;

  const summary = rows
    .map((r) => `${t(`dashboard.axis.${r.axis}`)}: ${r.score === null ? t("dashboard.radar.noData") : Math.round(r.score)}`)
    .join(", ");

  return (
    <div data-slot="health-radar" className={cn("flex flex-col gap-1", fill && "lg:min-h-0 lg:flex-1", className)}>
      <div
        role="img"
        aria-label={`${t("dashboard.radar.title")}. ${summary}`}
        className={cn(fill && "lg:relative lg:min-h-[96px] lg:flex-1")}
      >
        <ChartContainer
          config={config}
          className={cn(
            "mx-auto aspect-[1.25] w-full max-w-[24rem]",
            fill && "lg:absolute lg:inset-0 lg:aspect-auto lg:h-full lg:max-w-none lg:[&_svg]:overflow-visible",
          )}
        >
          <RadarChart
            data={rows}
            outerRadius={fill ? "80%" : "74%"}
            margin={fill ? { top: 10, right: 58, bottom: 10, left: 58 } : { top: 14, right: 74, bottom: 14, left: 74 }}
          >
            <PolarGrid stroke="rgba(15,27,45,0.08)" />
            <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6678" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            {anyUsual ? (
              <Radar
                name={t("dashboard.radar.usual")}
                dataKey="usual"
                stroke="#9aa6b8"
                strokeWidth={2}
                strokeDasharray="6 4"
                fill="none"
                isAnimationActive={animate}
              />
            ) : null}
            <Radar
              name={t("dashboard.radar.today")}
              dataKey="today"
              stroke="var(--aegis-accent)"
              strokeWidth={2.5}
              fill="var(--aegis-accent)"
              fillOpacity={0.22}
              isAnimationActive={animate}
            />
          </RadarChart>
        </ChartContainer>
      </div>

      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[12px] leading-tight text-[var(--aegis-label)]">
        <li className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true" focusable="false">
            <line x1="1" y1="4" x2="27" y2="4" strokeWidth="3" strokeLinecap="round" stroke="var(--aegis-accent)" />
          </svg>
          {t("dashboard.radar.today")}
        </li>
        {anyUsual ? (
          <li className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden="true" focusable="false">
              <line
                x1="1"
                y1="4"
                x2="27"
                y2="4"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="5 4"
                stroke="#9aa6b8"
              />
            </svg>
            {t("dashboard.radar.usual")}
          </li>
        ) : null}
      </ul>
      {anyMissing ? (
        <p className={cn("text-center text-[11px] leading-tight text-muted-foreground", fill && "dash-short:sr-only")}>
          {t("dashboard.radar.noteNoData")}
        </p>
      ) : null}

      {/* the wrapper (not the table) is visually hidden: a table ignores the 1px width of .sr-only and would widen the page */}
      <div className="sr-only">
        <table>
          <caption>{t("dashboard.radar.table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("dashboard.radar.table")}</th>
              <th scope="col">{t("dashboard.radar.today")}</th>
              <th scope="col">{t("dashboard.radar.usual")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.axis}>
                <th scope="row">{t(`dashboard.axis.${r.axis}`)}</th>
                <td>{r.score === null ? t("dashboard.radar.noData") : Math.round(r.score)}</td>
                <td>{r.baseline === null ? t("dashboard.radar.noData") : Math.round(r.baseline)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
