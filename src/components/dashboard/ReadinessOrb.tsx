"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import type { Status } from "@/lib/types";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { StatusPill } from "@/components/status";
import { useI18n } from "@/i18n/I18nProvider";
import { readinessDelta, statusColorVar } from "./logic";
import { useDashboardAnimate } from "./motion";

/**
 * Readiness orb: radial chart, big number, "vs your usual" delta. When readiness is not available
 * (fewer than 3 axes with data) it shows an explicit no-data state and never a 0 as if it were real.
 */
export function ReadinessOrb({
  readiness,
  baseline,
  available,
  overall,
}: {
  readiness: number;
  baseline: number | null;
  /** isReadinessAvailable(payload.axes) */
  available: boolean;
  overall: Status;
}) {
  const { t } = useI18n();
  const animate = useDashboardAnimate();
  const color = statusColorVar(available ? overall : "no_data");
  const value = Math.max(0, Math.min(100, Math.round(readiness)));
  const config = { readiness: { label: t("dashboard.readiness.title"), color } } satisfies ChartConfig;
  const delta = available ? readinessDelta(readiness, baseline) : null;

  const deltaText =
    delta === null
      ? ""
      : delta.kind === "none"
        ? t("dashboard.readiness.vsUsual.none")
        : delta.kind === "same"
          ? t("dashboard.readiness.vsUsual.same")
          : delta.kind === "above"
            ? t("dashboard.readiness.vsUsual.above", { n: delta.points })
            : t("dashboard.readiness.vsUsual.below", { n: delta.points });
  const DeltaIcon = delta?.kind === "below" ? ArrowDown : delta?.kind === "above" ? ArrowUp : Minus;

  return (
    <div data-slot="readiness-orb" className="flex flex-col items-center gap-2">
      <div
        className="relative size-44"
        role="img"
        aria-label={
          available
            ? t("dashboard.readiness.aria", { value })
            : `${t("dashboard.readiness.title")}: ${t("dashboard.readiness.unavailableShort")}`
        }
      >
        <ChartContainer config={config} className="aspect-square size-44">
          <RadialBarChart
            data={[{ name: "readiness", value: available ? value : 0, fill: color }]}
            startAngle={90}
            endAngle={-270}
            innerRadius="78%"
            outerRadius="100%"
            barSize={14}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              dataKey="value"
              background
              cornerRadius={8}
              fill={color}
              isAnimationActive={animate}
            />
          </RadialBarChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {available ? (
            <>
              <span className="tnum text-5xl leading-none font-semibold text-foreground">{value}</span>
              <span className="mt-1 text-sm text-muted-foreground">{t("dashboard.readiness.outOf")}</span>
            </>
          ) : (
            <>
              <span className="text-4xl leading-none font-semibold text-muted-foreground" aria-hidden="true">
                –
              </span>
              <span className="mt-1 px-5 text-sm text-muted-foreground">
                {t("dashboard.readiness.unavailableShort")}
              </span>
            </>
          )}
        </div>
      </div>

      <StatusPill status={available ? overall : "no_data"} size="lg" />

      {available ? (
        <p className="flex items-center gap-1.5 text-base text-foreground">
          <DeltaIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span>{deltaText}</span>
        </p>
      ) : (
        <p className="max-w-56 text-center text-sm text-muted-foreground">
          {t("dashboard.readiness.unavailable")}
        </p>
      )}
    </div>
  );
}
