"use client";

import { Activity, Package } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, ErrorBar, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { IconChip } from "@/components/dashboard/parts";
import { useI18n } from "@/i18n/I18nProvider";
import { DSS_TRIGGER, T_HIGH, T_LOW, TIMEPOINT_DAY } from "@/lib/signature/config";
import { spokenInt } from "@/lib/signature/facts";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import type { SignatureViewData } from "@/lib/signature/view";
import type { Timepoint } from "@/lib/signature/types";
import { CardLimits } from "./CardLimits";
import { FRI_MAX, drawView, formatFri, recoveryTimeline } from "./logic";

const POINT = "var(--cosmo-ink)";
const FAN = "#4f86f7";

/** chart rows: one per panel and one per fan day, merged on the day axis */
interface ChartRow {
  day: number;
  fri?: number | null;
  err?: [number, number] | null;
  fan?: [number, number];
  fast?: number;
  slow?: number;
}

function DssSparkline({ values }: { values: readonly (number | null)[] }) {
  const { t } = useI18n();
  const W = 160;
  const H = 36;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? W / 2 : 4 + (i / (n - 1)) * (W - 8));
  const y = (v: number) => H - 3 - (Math.min(Math.max(v, 0), FRI_MAX) / FRI_MAX) * (H - 6);
  const pts = values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter((p): p is string => p !== null);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-9 w-40"
      role="img"
      aria-label={t("dashboard.signature.draw.dssAria", { list: values.map((v) => (v === null ? "–" : spokenInt(v))).join(", ") })}
    >
      <line x1={0} x2={W} y1={y(DSS_TRIGGER)} y2={y(DSS_TRIGGER)} stroke="#b7791f" strokeDasharray="3 3" strokeWidth={1} />
      <polyline points={pts.join(" ")} fill="none" stroke={FAN} strokeWidth={1.8} strokeLinejoin="round" />
      {values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={1.8} fill={FAN} />))}
    </svg>
  );
}

/**
 * Recovery & next draw card (spec section 7.2 item 3): Flight Response Index of the four post-flight panels with band
 * error bars over days after landing, dashed threshold at 20, after the last expected flight response the fast and slow
 * decay curves with the range shaded between, and a marker at the first re-test day. Right: the draw advisor on the
 * selected panel's day (rule, last panel, next re-test, kit chips, strain sparkline when check-ins are linked).
 */
export function RecoveryCard({
  view,
  crew,
  timepoint,
  dss = [],
  simulated = false,
  today,
}: {
  view: SignatureViewData;
  crew: string;
  timepoint: Timepoint;
  /** daily strain scores of linked check-ins, oldest first (the demo passes simulated ones) */
  dss?: readonly (number | null)[];
  simulated?: boolean;
  /** draw-advisor clock (day after landing) when it is not the panel's day (the demo's check-in beat) */
  today?: number;
}) {
  const { t } = useI18n();
  const tl = recoveryTimeline(view, crew, timepoint);
  const draw = drawView(view, crew, timepoint, dss, today);
  const a = draw.advice;
  const rec = SIGNATURE_REFERENCE.recovery;
  const caption = t("dashboard.signature.rec.caption", {
    n: Object.keys(rec.half_life_upper_bound_days).length,
    from: TIMEPOINT_DAY["R+1"],
    to: TIMEPOINT_DAY["R+45"],
  });

  const rows: ChartRow[] = [
    ...tl.points.map((p) => ({ day: p.day, fri: p.fri, err: p.err })),
    ...tl.fan.map((f) => ({ day: f.day, fan: [f.fast, f.slow] as [number, number], fast: f.fast, slow: f.slow })),
  ].sort((x, y) => x.day - y.day);
  const ticks = tl.points.map((p) => p.day);
  const config = {
    fri: { label: t("dashboard.signature.rec.index"), color: POINT },
    fan: { color: FAN },
  } satisfies ChartConfig;

  return (
    <section aria-labelledby="sig-rec-title" data-slot="signature-recovery" className="glass-card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <header className="flex items-center gap-2.5">
        <IconChip icon={Activity} size={32} />
        <h2 id="sig-rec-title" className="text-[17px] leading-tight font-medium text-[var(--cosmo-ink)]">
          {t("dashboard.signature.rec.title")}
        </h2>
        <CardLimits card="rec" />
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_200px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div aria-hidden="true">
            <ChartContainer config={config} className="aspect-[1.6] w-full">
              <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(15,27,45,0.06)" />
                <XAxis
                  dataKey="day"
                  type="number"
                  scale="sqrt"
                  domain={[0, "dataMax"]}
                  ticks={ticks}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis domain={[0, FRI_MAX]} ticks={[0, T_LOW, T_HIGH, FRI_MAX]} tickLine={false} axisLine={false} width={32} tick={{ fontSize: 11 }} />
                <ReferenceLine y={tl.threshold} stroke="#5b6678" strokeDasharray="5 4" />
                {tl.recovery ? (
                  <ReferenceLine x={tl.recovery.retestMissionDay} stroke={FAN} strokeWidth={1.5} strokeDasharray="2 3" />
                ) : null}
                {tl.fan.length ? (
                  <>
                    <Area dataKey="fan" stroke="none" fill={FAN} fillOpacity={0.14} connectNulls isAnimationActive={false} />
                    <Line dataKey="fast" stroke={FAN} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
                    <Line dataKey="slow" stroke={FAN} strokeWidth={1.2} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
                  </>
                ) : null}
                <Line dataKey="fri" stroke="none" dot={{ r: 3.5, fill: POINT, stroke: "white", strokeWidth: 1 }} isAnimationActive={false}>
                  <ErrorBar dataKey="err" direction="y" width={12} stroke={POINT} strokeWidth={1.4} />
                </Line>
              </ComposedChart>
            </ChartContainer>
          </div>
          <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--cosmo-label)]">
            <li className="flex items-center gap-1.5">
              <span className="inline-block w-5 border-t-[1.5px] border-dashed border-[#5b6678]" />
              {t("dashboard.signature.rec.threshold", { t: tl.threshold })}
            </li>
            {tl.recovery ? (
              <>
                <li className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-5 rounded-sm" style={{ background: "rgba(79,134,247,0.2)" }} />
                  {t("dashboard.signature.rec.fan", { lo: tl.recovery.halfLifeBand[0], hi: tl.recovery.halfLifeBand[1] })}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="inline-block h-3 border-l-[1.5px] border-dotted" style={{ borderColor: FAN }} />
                  {t("dashboard.signature.rec.retest", { day: tl.recovery.retestMissionDay })}
                </li>
              </>
            ) : null}
          </ul>
          <p className="text-[13px] leading-snug text-[var(--cosmo-ink)]">
            {tl.recovery && tl.from
              ? t("dashboard.signature.rec.eta", {
                  tp: tl.from.tp,
                  lo: spokenInt(tl.recovery.etaDays[0]),
                  hi: spokenInt(tl.recovery.etaDays[1]),
                  day: tl.recovery.retestMissionDay,
                })
              : t("dashboard.signature.rec.noEta")}
          </p>

          <div className="sr-only">
            <table>
              <caption>{t("dashboard.signature.rec.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("dashboard.signature.rec.col.panel")}</th>
                  <th scope="col">{t("dashboard.signature.rec.col.day")}</th>
                  <th scope="col">{t("dashboard.signature.rec.col.fri")}</th>
                  <th scope="col">{t("dashboard.signature.rec.col.band")}</th>
                </tr>
              </thead>
              <tbody>
                {tl.points.map((p) => (
                  <tr key={p.tp}>
                    <th scope="row">
                      {p.tp}
                      {p.drawn ? "" : ` (${t("dashboard.signature.rec.notYet")})`}
                    </th>
                    <td>{p.day}</td>
                    <td>{p.fri === null ? "–" : formatFri(p.fri)}</td>
                    <td>{p.band ? `${formatFri(p.band[0])}–${formatFri(p.band[1])}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside
          aria-labelledby="sig-draw-title"
          className="flex flex-col gap-2 rounded-2xl bg-white/60 p-3 ring-1 ring-[var(--cosmo-hairline)]"
        >
          <h3 id="sig-draw-title" className="flex items-center gap-2 text-[13px] font-medium text-[var(--cosmo-ink)]">
            <Package aria-hidden="true" className="size-4" strokeWidth={1.8} />
            {t("dashboard.signature.draw.title")}
          </h3>
          <p className="flex flex-col gap-0.5">
            <span className="unit-label">{t("dashboard.signature.draw.ruleId", { rule: a.rule })}</span>
            <span className="text-[14px] font-medium text-[var(--cosmo-ink)]">{t(`dashboard.signature.draw.rule.${a.rule}`)}</span>
          </p>
          <p className="text-[12px] text-[var(--cosmo-label)]">
            {a.daysSinceLastPanel === null
              ? t("dashboard.signature.draw.sinceNone")
              : a.daysSinceLastPanel === 0
                ? t("dashboard.signature.draw.sinceToday")
                : t("dashboard.signature.draw.since", { days: a.daysSinceLastPanel })}
          </p>
          {draw.nextRetestDay !== null ? (
            <p className="text-[12px] text-[var(--cosmo-ink)]">{t("dashboard.signature.draw.next", { day: draw.nextRetestDay })}</p>
          ) : null}
          <ul className="flex flex-wrap gap-1.5">
            <li className="rounded-full bg-[var(--cosmo-pastel-blue)] px-2.5 py-0.5 text-[12px] text-[var(--cosmo-ink)]">
              {t("dashboard.signature.draw.kitsLeft", { left: a.kitsLeft, total: a.kitsTotal })}
            </li>
            <li className="rounded-full bg-[var(--cosmo-pastel-mint)] px-2.5 py-0.5 text-[12px] text-[var(--cosmo-ink)]">
              {t("dashboard.signature.draw.kitsSaved", { n: a.kitsSaved })}
            </li>
          </ul>
          {draw.dss.length ? (
            <div className="flex flex-col gap-1">
              {simulated ? (
                <span className="w-fit rounded-full bg-[var(--status-watch-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-watch-ink)]">
                  {t("dashboard.signature.draw.simulated")}
                </span>
              ) : null}
              <span className="text-[11px] text-[var(--cosmo-label)]">{t("dashboard.signature.draw.dss", { n: draw.dss.length })}</span>
              <DssSparkline values={draw.dss} />
            </div>
          ) : (
            <p className="text-[11px] leading-snug text-[var(--cosmo-label)]">{t("dashboard.signature.draw.dssNone")}</p>
          )}
          <p className="text-[11px] leading-snug text-[var(--cosmo-label)]">{t("dashboard.signature.draw.protocol")}</p>
        </aside>
      </div>

      <p className="text-[11px] leading-snug text-[var(--cosmo-label)]">{caption}</p>
    </section>
  );
}
