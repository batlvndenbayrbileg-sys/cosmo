"use client";

import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sparklineGeometry, statusColorVar } from "./logic";

const DEFAULT_WIDTH = 240;

/**
 * 14-day sparkline with the personal baseline band (mean plus or minus 2 sd, shaded) and today's point.
 * Plain SVG driven by the pure `sparklineGeometry` helper, so the geometry is unit-tested.
 */
export function Sparkline({
  history,
  today,
  mean,
  sd,
  status,
  label,
  height = 48,
  viewWidth = DEFAULT_WIDTH,
  className,
}: {
  history: readonly number[];
  today: number | null;
  mean: number | null;
  sd: number | null;
  /** colours today's dot; the status word itself is printed by the card */
  status: Status;
  /** accessible name */
  label: string;
  height?: number;
  /** width of the drawing in viewBox units; a wider box suits wide, flat cards */
  viewWidth?: number;
  className?: string;
}) {
  const WIDTH = viewWidth;
  const g = sparklineGeometry({ history, today, mean, sd, width: WIDTH, height, pad: 6 });
  if (g.points.length === 0 && g.today === null) return null;

  return (
    <svg
      role="img"
      aria-label={label}
      data-slot="sparkline"
      viewBox={`0 0 ${WIDTH} ${height}`}
      className={cn("block w-full max-w-64", className)}
      style={{ height }}
    >
      <title>{label}</title>
      {g.band ? (
        <rect
          data-slot="sparkline-band"
          x={0}
          y={g.band.top}
          width={WIDTH}
          height={Math.max(g.band.bottom - g.band.top, 1)}
          rx={3}
          className="fill-primary/12"
        />
      ) : null}
      {g.linePath ? (
        <path
          d={g.linePath}
          fill="none"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-muted-foreground"
        />
      ) : null}
      {g.today ? (
        <circle
          data-slot="sparkline-today"
          cx={g.today.x}
          cy={g.today.y}
          r={4.5}
          strokeWidth={2.5}
          className="fill-card"
          style={{ stroke: statusColorVar(status) }}
        />
      ) : null}
    </svg>
  );
}
