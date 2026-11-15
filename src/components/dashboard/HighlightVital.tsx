"use client";

import { motion } from "framer-motion";
import type { DashboardPayload, KpiStat } from "@/lib/types";
import { StatusPill } from "@/components/status";
import { useI18n } from "@/i18n/I18nProvider";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import { cn } from "@/lib/utils";
import { highlightKey, historySummary, recentBars, unitLabel } from "./logic";
import { useDashboardAnimate } from "./motion";
import { AXIS_ICON, BigStat, IconChip } from "./parts";
import { HeartPulse } from "lucide-react";

const BARS = 10;
/** room above the tallest bar for today's value pill */
const TIP_ROOM = 26;

function digitsFor(stat: KpiStat): number {
  const type = KPI_DEFS[stat.key].type;
  return type === "integer" ? 0 : 1;
}

/**
 * The reference's "Heart Rate" card for the most notable indicator today: AVG (personal 14-day mean) and RANGE
 * (14-day min-max), then rounded bars of the recent days with today's bar accented, hatched and labelled.
 */
export function HighlightVital({ payload }: { payload: DashboardPayload }) {
  const { t, lang } = useI18n();
  const animate = useDashboardAnimate();
  const key = highlightKey(payload.summary.findings, payload.kpis);
  const stat = payload.kpis.find((k) => k.key === key);
  if (!stat) return null;

  const def = KPI_DEFS[key];
  const label = def.labels[lang];
  const unit = def.type === "scale" ? `/${def.max ?? 5}` : unitLabel(def.unit, lang);
  const digits = digitsFor(stat);
  const summary = historySummary(stat);
  const bars = recentBars(stat, BARS);
  const max = Math.max(...bars.map((b) => b.value), summary?.max ?? 0, 1);
  const Icon = def.axis ? AXIS_ICON[def.axis] : HeartPulse;
  const todayBar = bars.find((b) => b.today) ?? null;

  return (
    <section data-slot="highlight-vital" aria-labelledby="highlight-title" className="glass-card flex flex-col gap-4 p-5 lg:min-h-0 lg:flex-[1.25] lg:gap-[clamp(8px,1.5vh,18px)] lg:p-[clamp(12px,1.8vh,20px)] lg:[&_.num-xl]:text-[clamp(24px,3.6vh,38px)]">
      <header className="flex items-center gap-3">
        <IconChip icon={Icon} />
        <h2 id="highlight-title" className="min-w-0 flex-1 truncate text-[18px] font-normal text-[var(--cosmo-ink)]">
          {label}
        </h2>
        <StatusPill status={stat.status} size="sm" />
      </header>

      <div className="grid grid-cols-2 gap-4">
        <BigStat
          label={t("dashboard.highlight.avg")}
          value={summary ? formatNumber(summary.avg, digits) : "–"}
          unit={unit}
        />
        <BigStat
          label={t("dashboard.highlight.range")}
          value={
            summary ? (
              <span className="tnum text-[0.82em] whitespace-nowrap">
                {formatNumber(summary.min, digits)}
                <span className="text-[0.7em] text-[var(--cosmo-label)]">–</span>
                {formatNumber(summary.max, digits)}
              </span>
            ) : (
              "–"
            )
          }
          unit={unit}
        />
      </div>

      {bars.length === 0 ? (
        <p className="text-[13px] text-[var(--cosmo-label)]">{t("dashboard.highlight.noHistory")}</p>
      ) : (
        <figure className="flex flex-col gap-2 lg:min-h-0 lg:flex-1">
          <div
            role="img"
            aria-label={t("dashboard.highlight.chartAria", { label, n: bars.length })}
            className="relative flex h-[180px] items-end gap-[6px] lg:h-auto lg:min-h-[56px] lg:flex-1"
          >
            {bars.map((b, i) => {
              // bar height as a share of the chart area (which scales with the screen height), at least 8px
              const h = `max(8px, calc((100% - ${TIP_ROOM}px) * ${(b.value / max).toFixed(4)}))`;
              return (
                <div key={b.date ?? "today"} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                  {b.today ? (
                    <span className="tnum absolute z-10 rounded-full bg-[var(--cosmo-ink)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-white shadow-md" style={{ bottom: `calc(${h} + 6px)` }}>
                      {formatNumber(b.value, digits)}
                      {unit && !unit.startsWith("/") ? ` ${unit}` : ""}
                    </span>
                  ) : null}
                  <motion.span
                    aria-hidden="true"
                    className={cn(
                      "block w-full max-w-[22px] origin-bottom rounded-full",
                      b.today ? "cosmo-hatch bg-[var(--cosmo-accent)]" : "bg-[var(--cosmo-chart)]",
                    )}
                    style={{ height: h }}
                    initial={animate ? { scaleY: 0 } : false}
                    animate={{ scaleY: 1 }}
                    transition={{ type: "spring", stiffness: 160, damping: 22, delay: animate ? 0.25 + i * 0.03 : 0 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-[6px]" aria-hidden="true">
            {bars.map((b) => (
              <span
                key={b.date ?? "today"}
                className={cn(
                  "tnum min-w-0 flex-1 text-center text-[10px]",
                  b.today ? "font-semibold text-[var(--cosmo-ink)]" : "text-[var(--cosmo-label)]",
                )}
              >
                {b.date ? b.date.slice(8) : payload.checkIn.confirmedAt.slice(8, 10)}
              </span>
            ))}
          </div>
          <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-[var(--cosmo-label)]">
            <span>{t("dashboard.highlight.days", { n: bars.length - (todayBar ? 1 : 0) })}</span>
            {stat.rangeText ? <span>{stat.rangeText[lang]}</span> : null}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
