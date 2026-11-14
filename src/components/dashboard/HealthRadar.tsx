"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts";
import type { AxisScore } from "@/lib/types";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useI18n } from "@/i18n/I18nProvider";
import { useDashboardAnimate } from "./motion";

/**
 * Health radar: six body areas, today (solid accent) against the person's own 14-day polygon (dashed grey).
 * Areas without data are drawn at the centre and marked "no data" on their label.
 */
export function HealthRadar({ axes }: { axes: AxisScore[] }) {
  const { t } = useI18n();
  const animate = useDashboardAnimate();

  const rows = axes.map((a) => ({
    axis: a.axis,
    label: t(`dashboard.axis.${a.axis}`) + (a.score === null ? ` (${t("dashboard.radar.noData")})` : ""),
    today: a.score ?? 0,
    usual: a.baseline ?? 0,
    score: a.score,
    baseline: a.baseline,
  }));
  const anyUsual = axes.some((a) => a.baseline !== null);
  const anyMissing = axes.some((a) => a.score === null);

  const config = {
    today: { label: t("dashboard.radar.today"), color: "var(--primary)" },
    usual: { label: t("dashboard.radar.usual"), color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const summary = rows
    .map((r) => `${r.label}: ${r.score === null ? t("dashboard.radar.noData") : Math.round(r.score)}`)
    .join(", ");

  return (
    <div data-slot="health-radar" className="flex flex-col gap-3">
      <div role="img" aria-label={`${t("dashboard.radar.title")}. ${summary}`}>
        <ChartContainer config={config} className="mx-auto aspect-square w-full max-w-[22rem]">
          <RadarChart data={rows} outerRadius="68%" margin={{ top: 18, right: 44, bottom: 18, left: 44 }}>
            <PolarGrid />
            <PolarAngleAxis dataKey="label" tick={{ fontSize: 13 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            {anyUsual ? (
              <Radar
                name={t("dashboard.radar.usual")}
                dataKey="usual"
                stroke="var(--chart-2)"
                strokeWidth={2}
                strokeDasharray="6 4"
                fill="none"
                isAnimationActive={animate}
              />
            ) : null}
            <Radar
              name={t("dashboard.radar.today")}
              dataKey="today"
              stroke="var(--primary)"
              strokeWidth={2.5}
              fill="var(--primary)"
              fillOpacity={0.2}
              isAnimationActive={animate}
            />
          </RadarChart>
        </ChartContainer>
      </div>

      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-foreground">
        <li className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true" focusable="false">
            <line x1="1" y1="4" x2="27" y2="4" strokeWidth="3" strokeLinecap="round" stroke="var(--primary)" />
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
                stroke="var(--chart-2)"
              />
            </svg>
            {t("dashboard.radar.usual")}
          </li>
        ) : null}
      </ul>
      {anyMissing ? (
        <p className="text-center text-xs text-muted-foreground">{t("dashboard.radar.noteNoData")}</p>
      ) : null}

      <table className="sr-only">
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
  );
}
