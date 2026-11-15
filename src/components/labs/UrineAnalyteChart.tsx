"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useDashboardAnimate } from "@/components/dashboard/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { formatDecimal, type UrineAnalyte, type UrinePointKind } from "@/lib/labs/urine";
import { cn } from "@/lib/utils";

const INK = "var(--cosmo-ink)";
const LABEL = "#5b6678";
const BAND = "var(--cosmo-accent)";
/** dot colours per kind; pre-flight samples are hollow (they set the baseline) */
const KIND_FILL: Record<UrinePointKind, string> = {
  baseline: "#ffffff",
  normal: "var(--status-ok)",
  borderline: "var(--status-watch)",
  abnormal: "var(--status-alert)",
  insufficient: "var(--status-nodata)",
};

interface Row {
  day: number;
  npq: number | null;
  tp: string;
  kind: UrinePointKind;
}

interface DotProps {
  index?: number;
  cx?: number;
  cy?: number;
  payload?: Row;
}

interface TickProps {
  index?: number;
  x?: number | string;
  y?: number | string;
  payload?: { value: unknown };
}

function renderDot({ cx, cy, payload, index }: DotProps, selected: string) {
  const key = `dot-${index ?? payload?.tp ?? "x"}`;
  if (cx === undefined || cy === undefined || !payload || payload.npq === null) return <g key={key} />;
  const isSel = payload.tp === selected;
  const pre = payload.kind === "baseline";
  return (
    <g key={key}>
      {isSel ? <circle cx={cx} cy={cy} r={8.5} fill="none" stroke={INK} strokeOpacity={0.35} strokeWidth={1.5} /> : null}
      <circle
        cx={cx}
        cy={cy}
        r={isSel ? 5 : 4}
        fill={KIND_FILL[payload.kind]}
        stroke={pre ? LABEL : "#ffffff"}
        strokeWidth={pre ? 1.6 : 1.2}
      />
    </g>
  );
}

/** L-3 and R+1 sit four days apart: their labels are anchored away from each other */
function renderTick({ x, y, payload, index }: TickProps, label: ReadonlyMap<number, string>) {
  const key = `tick-${index ?? "x"}`;
  const px = Number(x);
  const py = Number(y);
  const v = Number(payload?.value);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(v)) return <g key={key} />;
  const anchor = v === -3 ? "end" : v === 1 ? "start" : "middle";
  return (
    <text key={key} x={px} y={py + 12} textAnchor={anchor} fontSize={11} fill={LABEL}>
      {label.get(v) ?? v}
    </text>
  );
}

/**
 * One analyte over time: x = day (L-92 .. R+82), y = NPQ (log2). The personal range (Normal_low .. Normal_high) is
 * shaded, the pre-flight mean is the dashed line, pre-flight samples are hollow dots, post-flight dots take the colour
 * of their status, and the selected time point's dot is ringed. The chart is decorative for screen readers; the
 * wrapper's label and the caption under it carry the same numbers as text.
 */
export function UrineAnalyteChart({
  analyte,
  selected,
  fill = false,
  className,
}: {
  analyte: UrineAnalyte;
  /** the time point chosen in the selector */
  selected: string;
  /** desktop one-screen layout: take the height the card gives */
  fill?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const animate = useDashboardAnimate();
  const rows: Row[] = analyte.points.map((p) => ({ day: p.day, npq: p.npq, tp: p.timepoint, kind: p.kind }));
  const label = new Map(rows.map((r) => [r.day, r.tp]));
  const values = rows.map((r) => r.npq).filter((v): v is number => v !== null);
  const span = [...values, analyte.low, analyte.high, analyte.baseline].filter((v): v is number => v !== null);
  const lo = span.length ? Math.floor(Math.min(...span) - 0.5) : 0;
  const hi = span.length ? Math.ceil(Math.max(...span) + 0.5) : 1;
  const hasBand = analyte.low !== null && analyte.high !== null;

  const config = {
    npq: { label: t("dashboard.labs.chart.axisY"), color: INK },
  } satisfies ChartConfig;

  const fmt = (v: number | null) => formatDecimal(v, 1);
  const points = analyte.points
    .map((p) => t("dashboard.labs.chart.point", { tp: p.timepoint, value: p.npq === null ? t("dashboard.labs.chart.notDetected") : fmt(p.npq) }))
    .join(", ");
  const rangeText = hasBand
    ? t("dashboard.labs.chart.range", { low: fmt(analyte.low), high: fmt(analyte.high), baseline: fmt(analyte.baseline) })
    : t("dashboard.labs.chart.noRange");

  return (
    <div className={cn("flex min-h-0 flex-col gap-1.5", fill && "lg:flex-1", className)}>
      <div
        role="img"
        aria-label={`${t("dashboard.labs.chart.title", { analyte: analyte.analyte })}. ${rangeText} ${points}`}
        className={cn(fill && "lg:relative lg:min-h-[120px] lg:flex-1")}
      >
        <ChartContainer
          config={config}
          className={cn("aspect-[1.7] w-full", fill && "lg:absolute lg:inset-0 lg:aspect-auto lg:h-full")}
        >
          <ComposedChart data={rows} margin={{ top: 12, right: 14, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(15,27,45,0.06)" />
            {hasBand ? (
              <ReferenceArea y1={analyte.low!} y2={analyte.high!} fill={BAND} fillOpacity={0.12} stroke="none" ifOverflow="hidden" />
            ) : null}
            {analyte.baseline !== null ? (
              <ReferenceLine y={analyte.baseline} stroke={LABEL} strokeDasharray="5 4" strokeWidth={1.2} />
            ) : null}
            <ReferenceLine x={0} stroke="rgba(15,27,45,0.18)" strokeWidth={1} />
            <XAxis
              dataKey="day"
              type="number"
              domain={[-100, 90]}
              ticks={rows.map((r) => r.day)}
              tickLine={false}
              axisLine={false}
              tick={(p: TickProps) => renderTick(p, label)}
              height={24}
            />
            <YAxis
              domain={[lo, hi]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={30}
              tick={{ fontSize: 11, fill: LABEL }}
            />
            <Line
              dataKey="npq"
              stroke="rgba(15,27,45,0.35)"
              strokeWidth={1.4}
              connectNulls
              dot={(p: DotProps) => renderDot(p, selected)}
              activeDot={false}
              isAnimationActive={animate}
              animationDuration={500}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
      <ul aria-hidden="true" className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] leading-tight text-[var(--cosmo-label)]">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[3px] bg-[var(--cosmo-accent)]/15 ring-1 ring-[var(--cosmo-accent)]/25" />
          {t("dashboard.labs.chart.band")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="w-4 border-t-[1.5px] border-dashed border-[var(--cosmo-label)]" />
          {t("dashboard.labs.chart.baseline")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-[1.5px] border-[var(--cosmo-label)] bg-white" />
          {t("dashboard.labs.chart.pre")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="flex gap-0.5">
            <span className="size-2 rounded-full bg-status-ok" />
            <span className="size-2 rounded-full bg-status-watch" />
            <span className="size-2 rounded-full bg-status-alert" />
          </span>
          {t("dashboard.labs.chart.post")}
        </li>
      </ul>
      {/* the numbers behind the band, for screen readers; the chart shows them */}
      <p className="sr-only">
        {rangeText} {t("dashboard.labs.chart.axisX")}.
      </p>
    </div>
  );
}
