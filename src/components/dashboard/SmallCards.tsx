"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { Droplet, Dumbbell, GlassWater, HeartPulse, Moon, type LucideIcon } from "lucide-react";
import type { KpiKey, KpiStat } from "@/lib/types";
import { StatusGlyph } from "@/components/status";
import { useI18n } from "@/i18n/I18nProvider";
import { asNumber } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import { demoTarget, sparklineGeometry, targetFraction, unitLabel } from "./logic";
import { useDashboardAnimate } from "./motion";
import { IconChip } from "./parts";

const W = 150;
const H = 54;

function numeric(stat: KpiStat | undefined): number | null {
  if (!stat || stat.value === null) return null;
  return asNumber(stat.value);
}

/** Heart rate: big number + bpm, gradient area sparkline of the past days and today, usual level as a green line */
export function HeartCard({ stat }: { stat: KpiStat | undefined }) {
  const { t, lang } = useI18n();
  const gradId = useId();
  const animate = useDashboardAnimate();
  const value = numeric(stat);
  const history = stat?.history.map((h) => h.value) ?? [];
  const mean = stat?.baselineMean ?? null;
  const g = sparklineGeometry({ history, today: value, mean, sd: mean === null ? null : 0, width: W, height: H, pad: 4 });
  const pts = [...g.points, ...(g.today ? [g.today] : [])];
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x} ${H} L${pts[0].x} ${H} Z` : "";
  const baseY = g.band ? g.band.top : null;

  return (
    <section aria-labelledby="heart-card-title" className="glass-card flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:gap-[clamp(4px,1vh,12px)] lg:p-[clamp(10px,1.5vh,16px)] lg:[&_.num-xl]:text-[clamp(22px,3.3vh,36px)]">
      <header className="flex items-center gap-2.5">
        <IconChip icon={HeartPulse} size={30} className="dash-short:size-[26px]!" />
        <h3 id="heart-card-title" className="min-w-0 truncate text-[14px] leading-tight text-[var(--aegis-ink)]">
          {t("dashboard.heart.title")}
        </h3>
      </header>
      <p className="flex items-baseline gap-1.5">
        <span className="num-xl">{value === null ? "–" : formatNumber(value, 0)}</span>
        <span className="unit-label whitespace-nowrap">{unitLabel("bpm", lang)}</span>
        {stat ? <StatusGlyph status={stat.status} size={13} className="ml-auto self-center" /> : null}
      </p>
      {pts.length > 1 ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full overflow-visible lg:h-[clamp(24px,4.6vh,56px)] dash-short:h-auto dash-short:min-h-[14px] dash-short:flex-1" aria-hidden="true" focusable="false" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--aegis-accent)" stopOpacity="0.42" />
              <stop offset="100%" stopColor="var(--aegis-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={area}
            fill={`url(#${gradId})`}
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--aegis-accent)"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={animate ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }}
          />
          {baseY !== null ? (
            <line x1={0} x2={W} y1={baseY} y2={baseY} stroke="var(--status-ok)" strokeWidth={1.4} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
      ) : (
        <div className="h-14 lg:h-[clamp(24px,4.6vh,56px)] dash-short:h-auto dash-short:flex-1" />
      )}
      <p className="flex items-center gap-1.5 text-[11px] leading-tight text-[var(--aegis-label)] dash-tight:sr-only">
        <span aria-hidden="true" className="inline-block h-0 w-4 border-t-[1.5px] border-dashed border-status-ok" />
        {t("dashboard.heart.usual")}
        {mean !== null ? <span className="tnum">{formatNumber(mean, 0)}</span> : null}
      </p>
    </section>
  );
}

interface DonutSpec {
  key: KpiKey;
  labelKey: string;
  icon: LucideIcon;
  color: string;
  track: string;
}

const DONUTS: DonutSpec[] = [
  { key: "water_ml", labelKey: "dashboard.hydration.water", icon: Droplet, color: "#4f86f7", track: "#dce9ff" },
  { key: "exercise_min", labelKey: "dashboard.hydration.exercise", icon: Dumbbell, color: "#f47a5f", track: "#ffe3db" },
  { key: "sleep_hours", labelKey: "dashboard.hydration.sleep", icon: Moon, color: "#9b7bf0", track: "#ede3ff" },
];

function Donut({ spec, stat }: { spec: DonutSpec; stat: KpiStat | undefined }) {
  const { t, lang } = useI18n();
  const animate = useDashboardAnimate();
  const value = numeric(stat);
  const target = demoTarget(spec.key) ?? 1;
  const fraction = targetFraction(value, target);
  const r = 17;
  const c = 2 * Math.PI * r;
  const label = t(spec.labelKey);
  const unit = unitLabel(stat?.unit ?? null, lang);
  const aria =
    value === null
      ? t("dashboard.hydration.donutNone", { label })
      : t("dashboard.hydration.donut", {
          label,
          value: formatNumber(value, spec.key === "sleep_hours" ? 1 : 0),
          target: formatNumber(target, 0),
          unit,
        });
  const Icon = spec.icon;
  return (
    <li className="flex flex-col items-center gap-1" role="img" aria-label={aria}>
      <span className="relative size-11 lg:size-[clamp(30px,4.4vh,44px)] dash-tight:size-[28px]">
        <svg viewBox="0 0 44 44" className="size-full -rotate-90" aria-hidden="true" focusable="false">
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            stroke={spec.track}
            strokeWidth="5"
            strokeDasharray={fraction === null ? "3 3" : undefined}
          />
          {fraction !== null ? (
            <motion.circle
              cx="22"
              cy="22"
              r={r}
              fill="none"
              stroke={spec.color}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={c}
              initial={animate ? { strokeDashoffset: c } : false}
              animate={{ strokeDashoffset: c * (1 - fraction) }}
              transition={{ type: "spring", stiffness: 120, damping: 24, delay: 0.3 }}
            />
          ) : null}
        </svg>
        <Icon aria-hidden="true" className="absolute inset-0 m-auto size-3.5 text-[var(--aegis-ink)]" strokeWidth={2} />
      </span>
      <span className="text-[10px] leading-tight text-[var(--aegis-label)] dash-tight:sr-only">{label}</span>
    </li>
  );
}

/** Water and activity: today's water as the big number, three mini donuts (water, exercise, sleep) vs demo targets */
export function HydrationCard({ byKey }: { byKey: ReadonlyMap<KpiKey, KpiStat> }) {
  const { t, lang } = useI18n();
  const water = numeric(byKey.get("water_ml"));
  return (
    <section aria-labelledby="hydration-card-title" className="glass-card flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:gap-[clamp(4px,1vh,12px)] lg:p-[clamp(10px,1.5vh,16px)] lg:[&_.num-xl]:text-[clamp(22px,3.3vh,36px)]">
      <header className="flex items-center gap-2.5">
        <IconChip icon={GlassWater} size={30} className="dash-short:size-[26px]!" />
        <h3 id="hydration-card-title" className="min-w-0 truncate text-[14px] leading-tight text-[var(--aegis-ink)]">
          {t("dashboard.hydration.title")}
        </h3>
      </header>
      <p className="flex items-baseline gap-1.5">
        <span className="num-xl">{water === null ? "–" : formatNumber(water, 0)}</span>
        <span className="unit-label">{unitLabel("ml", lang)}</span>
      </p>
      <ul className="flex items-start justify-between gap-1" title={t("dashboard.hydration.note")}>
        {DONUTS.map((d) => (
          <Donut key={d.key} spec={d} stat={byKey.get(d.key)} />
        ))}
      </ul>
      <p className="text-[11px] leading-tight text-[var(--aegis-label)] lg:line-clamp-1 dash-tight:sr-only">{t("dashboard.hydration.note")}</p>
    </section>
  );
}
