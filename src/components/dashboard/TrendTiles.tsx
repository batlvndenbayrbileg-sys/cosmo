"use client";

import type { KpiKey, KpiStat } from "@/lib/types";
import { StatusGlyph } from "@/components/status";
import { useI18n } from "@/i18n/I18nProvider";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import { Sparkline } from "./Sparkline";
import { displayValue, effectiveSd, historySummary } from "./logic";

/** the main numeric indicators shown as 14-day sparklines on the Trends view */
export const TREND_KEYS: readonly KpiKey[] = [
  "sleep_hours",
  "mood",
  "heart_rate",
  "bp_systolic",
  "temperature_c",
  "glucose_mgdl",
  "water_ml",
  "exercise_min",
];

function TrendTile({ stat }: { stat: KpiStat }) {
  const { t, lang } = useI18n();
  const def = KPI_DEFS[stat.key];
  const label = def.labels[lang];
  const history = stat.history.map((h) => h.value);
  const today = typeof stat.value === "number" ? stat.value : null;
  const shown = stat.value !== null && stat.status !== "no_data" ? displayValue(stat.key, stat.value, lang) : null;
  const summary = historySummary(stat);
  const digits = def.type === "integer" || def.type === "scale" ? 0 : 1;

  return (
    <li className="glass-card flex min-h-0 min-w-0 flex-col gap-1.5 px-4 py-3 lg:gap-[clamp(2px,0.6vh,8px)] lg:px-[clamp(12px,1vw,18px)] lg:py-[clamp(8px,1.3vh,14px)]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-[13.5px] leading-tight font-medium text-[var(--aegis-label)]">{label}</h3>
        <StatusGlyph status={stat.status} size={13} />
      </div>
      <p className="flex items-baseline gap-1">
        <span className="tnum text-[clamp(20px,2.8vh,28px)] leading-none font-normal text-[var(--aegis-ink)]">
          {shown ? shown.main : "–"}
        </span>
        {shown?.unit ? <span className="text-[12px] text-[var(--aegis-label)]">{shown.unit}</span> : null}
      </p>
      {history.length > 0 || today !== null ? (
        <Sparkline
          history={history}
          today={today}
          mean={stat.baselineMean}
          sd={effectiveSd(stat.key, stat.baselineSd)}
          status={stat.status}
          label={t("dashboard.kpi.sparkAria", { label, count: history.length })}
          height={40}
          viewWidth={300}
          className="mt-auto max-w-none"
        />
      ) : (
        <p className="mt-auto text-[12px] text-[var(--aegis-label)]">{t("dashboard.highlight.noHistory")}</p>
      )}
      <p className="tnum truncate text-[11px] leading-tight text-[var(--aegis-label)]">
        {summary ? t("dashboard.trends.avg", { value: formatNumber(summary.avg, digits) }) : " "}
      </p>
    </li>
  );
}

/** 14-day sparklines of the main numeric indicators (baseline band shaded, today's dot coloured by status) */
export function TrendTiles({ byKey }: { byKey: ReadonlyMap<KpiKey, KpiStat> }) {
  const stats = TREND_KEYS.map((k) => byKey.get(k)).filter((s): s is KpiStat => s !== undefined);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-h-0 lg:flex-1 lg:auto-rows-fr lg:gap-[clamp(8px,1.2vh,14px)]">
      {stats.map((s) => (
        <TrendTile key={s.key} stat={s} />
      ))}
    </ul>
  );
}
