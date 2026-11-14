"use client";

import type { KpiKey, Status } from "@/lib/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { StatusShape } from "./StatusShape";
import { countByStatus, orderStars, placeStars } from "./constellationLayout";
import { statusWordKey } from "./statusClasses";

const VIEW = 100;
const CENTER = VIEW / 2;
const RING_RADIUS = 38;
const STAR_RADIUS = 4.4;
const STATUS_ORDER: Status[] = ["green", "yellow", "red", "no_data"];

/**
 * Vitals Constellation: one star per indicator on a ring (shape = status), readiness number in
 * the centre. Layout is deterministic: star i of n at angle 2*PI*i/n, ordered by KPI_KEYS.
 */
export function ConstellationGlyph({
  stars,
  readiness,
  size = 240,
  label,
  className,
}: {
  stars: Array<{ key: KpiKey; status: Status }>;
  /** 0-100, or null when there is no check-in yet */
  readiness: number | null;
  /** pixel width and height */
  size?: number;
  /** accessible name; defaults to "Vitals constellation" */
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();

  const ordered = orderStars(stars);
  const placed = placeStars(stars, CENTER, CENTER, RING_RADIUS);
  const counts = countByStatus(ordered);

  const countText =
    ordered.length === 0
      ? t("shell.constellation.empty")
      : STATUS_ORDER.filter((s) => counts[s] > 0)
          .map((s) =>
            t("shell.constellation.count", { status: t(statusWordKey(s)), count: counts[s] }),
          )
          .join(", ");
  const readinessText =
    readiness === null
      ? t("shell.constellation.readinessNone")
      : t("shell.constellation.readiness", { value: Math.round(readiness) });
  const ariaLabel = `${label ?? t("shell.constellation.label")}. ${readinessText}. ${countText}.`;

  const showCaption = size >= 120;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      data-slot="constellation-glyph"
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={cn("shrink-0", className)}
    >
      <title>{ariaLabel}</title>
      {/* subtle ring and inner halo */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={1}
        className="stroke-border"
      />
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RING_RADIUS - 9}
        fill="none"
        strokeWidth={0.6}
        strokeDasharray="1 3"
        className="stroke-border"
      />
      {placed.map((star) => (
        <g key={star.key} data-key={star.key} data-status={star.status}>
          <StatusShape status={star.status} cx={star.x} cy={star.y} r={STAR_RADIUS} />
        </g>
      ))}
      <text
        x={CENTER}
        y={showCaption ? CENTER + 2 : CENTER}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={readiness === null ? 20 : 25}
        fontWeight={600}
        className="tnum fill-foreground"
      >
        {readiness === null ? "–" : Math.round(readiness)}
      </text>
      {showCaption ? (
        <text
          x={CENTER}
          y={CENTER + 16}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={5.4}
          className="fill-muted-foreground"
        >
          {t("shell.readiness")}
        </text>
      ) : null}
    </svg>
  );
}
