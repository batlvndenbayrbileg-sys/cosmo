"use client";

import { useEffect, useId, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  ArrowUpRight,
  Brain,
  Briefcase,
  Droplet,
  Dumbbell,
  Eye,
  FlaskConical,
  Gauge,
  HeartPulse,
  Microscope,
  Moon,
  PersonStanding,
  Smile,
  Sparkles,
  TestTube,
  Thermometer,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import type { KpiKey, Status } from "@/lib/types";
import { KPI_DEFS, asNumber } from "@/lib/kpi/registry";
import { beatSeconds, ecgPath, worstShowStatus, type ShowPanel, type ShowVital } from "@/lib/show";
import { StatusGlyph, StatusPill } from "@/components/status";
import { sparklineGeometry, statusColorVar, unitLabel } from "@/components/dashboard/logic";
import { usePrefersReducedMotion } from "@/components/cosmo/usePrefersReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { BodyMap } from "./BodyMap";
import { numberText, valueText } from "./format";

/** window event asking the dashboard to switch to one of its tabs (DashboardView listens), detail: { section } */
export const OPEN_DASHBOARD_SECTION_EVENT = "aegis:open-dashboard-section";

/** how long the panels stay after Cosmo has finished speaking, unless the next question replaces them */
export const SHOW_LINGER_MS = 12_000;

const KEY_ICON: Partial<Record<KpiKey, LucideIcon>> = {
  sleep_hours: Moon,
  mood: Smile,
  symptom_headache: Brain,
  symptom_dizziness: Brain,
  symptom_nausea: Brain,
  bp_systolic: Gauge,
  bp_diastolic: Gauge,
  heart_rate: HeartPulse,
  temperature_c: Thermometer,
  glucose_mgdl: TestTube,
  water_ml: Droplet,
  exercise_min: Dumbbell,
  vision_check: Eye,
  workload: Briefcase,
};

const CARD =
  "relative overflow-hidden rounded-[20px] border border-white/90 bg-white/85 p-3 shadow-[0_12px_28px_-18px_rgba(40,80,160,0.6)]";

/* ───────────── small parts ───────────── */

function Chip({ icon: Icon, tone = "ink" }: { icon: LucideIcon; tone?: "ink" | "accent" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
        tone === "ink" ? "bg-[var(--aegis-ink)] text-white" : "bg-[var(--aegis-pastel-blue)] text-[var(--aegis-accent-deep)]",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2} />
    </span>
  );
}

function CardTitle({ icon, title, recorded, right }: { icon: LucideIcon; title: string; recorded?: boolean; right?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="flex items-center gap-2">
      <Chip icon={icon} />
      <h3 className="min-w-0 flex-1 truncate text-[13.5px] leading-tight font-medium text-[var(--aegis-ink)]">{title}</h3>
      {recorded ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--aegis-pastel-blue)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--aegis-accent-deep)]">
          <Sparkles className="size-3" aria-hidden="true" />
          {t("checkin.show.recorded")}
        </span>
      ) : null}
      {right}
    </header>
  );
}

function label(key: KpiKey, lang: "en" | "mn"): string {
  return KPI_DEFS[key].labels[lang];
}

/** "Usual 68 · Normal 50-90 bpm · demo parameter" under a value */
function ReferenceLine({ vital }: { vital: ShowVital }) {
  const { t, pick } = useI18n();
  const parts: string[] = [];
  parts.push(vital.mean !== null ? t("checkin.show.usual", { value: numberText(vital.key, vital.mean) }) : t("checkin.show.noBaseline"));
  if (vital.rangeText) parts.push(pick(vital.rangeText));
  return <p className="text-[11px] leading-snug text-[var(--aegis-label)]">{parts.join(" · ")}</p>;
}

/** the big value with its unit, or "not recorded today" */
function BigValue({ main, unit, status }: { main: string | null; unit: string; status: Status }) {
  const { t } = useI18n();
  return (
    <div className="flex items-end justify-between gap-2">
      {main === null ? (
        <span className="text-[13px] text-[var(--aegis-label)]">{t("checkin.show.notToday")}</span>
      ) : (
        <span className="flex items-baseline gap-1">
          <span className="tnum text-[30px] leading-none font-normal tracking-[-0.02em] text-[var(--aegis-ink)]">{main}</span>
          {unit ? <span className="unit-label">{unit}</span> : null}
        </span>
      )}
      <StatusPill status={status} size="sm" />
    </div>
  );
}

/** a small 14-day line with the personal band (mean +/- 2 sd) fading in and today's dot */
function MiniTrend({
  vital,
  height = 44,
  width = 260,
  showBandLabel = false,
}: {
  vital: ShowVital;
  height?: number;
  width?: number;
  showBandLabel?: boolean;
}) {
  const { t, lang } = useI18n();
  const reduced = usePrefersReducedMotion();
  const today = vital.value === null ? null : asNumber(vital.value);
  const g = sparklineGeometry({ history: vital.history, today, mean: vital.mean, sd: vital.sd, width, height, pad: 6 });
  if (g.points.length === 0 && g.today === null) return null;
  const all = [...g.points, ...(g.today ? [g.today] : [])];
  const line = all.length > 1 ? all.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ") : "";
  const color = statusColorVar(vital.status);
  const aria = t("checkin.show.trend", { label: label(vital.key, lang) });
  return (
    <svg
      role="img"
      aria-label={aria}
      data-slot="show-trend"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full overflow-visible"
      style={{ height }}
    >
      {g.band ? (
        <motion.rect
          data-slot="show-band"
          x={0}
          y={g.band.top}
          width={width}
          height={Math.max(g.band.bottom - g.band.top, 1)}
          rx={4}
          fill="var(--aegis-accent)"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 0.13 }}
          transition={{ duration: 0.9, delay: 0.5 }}
        />
      ) : null}
      {g.band && showBandLabel ? (
        <motion.text
          x={width - 4}
          y={Math.max(g.band.top - 3, 9)}
          textAnchor="end"
          fontSize={9}
          fill="var(--aegis-accent-deep)"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 0.9 }}
          transition={{ duration: 0.6, delay: 0.9 }}
        >
          {t("checkin.show.band")}
        </motion.text>
      ) : null}
      {line ? (
        <motion.path
          d={line}
          fill="none"
          stroke="var(--aegis-ink)"
          strokeOpacity={0.55}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }}
        />
      ) : null}
      {g.today ? (
        <motion.circle
          data-slot="show-today"
          cx={g.today.x}
          cy={g.today.y}
          r={4}
          fill="#ffffff"
          stroke={color}
          strokeWidth={2.4}
          vectorEffect="non-scaling-stroke"
          initial={reduced ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.9 }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      ) : null}
    </svg>
  );
}

/* ───────────── the panels ───────────── */

function VitalCard({ panel }: { panel: Extract<ShowPanel, { kind: "vital" }> }) {
  const { t, lang } = useI18n();
  const [first] = panel.vitals;
  const isBp = panel.vitals.length === 2 && panel.vitals.some((v) => v.key === "bp_systolic");
  const icon = KEY_ICON[first.key] ?? Gauge;

  if (panel.vitals.length > 1 && !isBp) {
    // the yes/no symptoms: one row each
    return (
      <div className={CARD} data-panel="vital">
        <CardTitle icon={icon} title={t("checkin.show.symptoms")} recorded={panel.recorded} />
        <ul className="mt-2 flex flex-col gap-1">
          {panel.vitals.map((v) => (
            <li key={v.key} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="text-[var(--aegis-label)]">{label(v.key, lang)}</span>
              <span className="flex items-center gap-1.5 font-medium text-[var(--aegis-ink)]">
                {v.value === null ? "–" : valueText(v.key, v.value, lang, true)}
                <StatusGlyph status={v.status} size={12} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const sys = isBp ? panel.vitals.find((v) => v.key === "bp_systolic") : undefined;
  const dia = isBp ? panel.vitals.find((v) => v.key === "bp_diastolic") : undefined;
  const main = isBp
    ? sys?.value != null && dia?.value != null
      ? `${valueText("bp_systolic", sys.value, lang, false)}/${valueText("bp_diastolic", dia.value, lang, false)}`
      : null
    : first.value === null
      ? null
      : valueText(first.key, first.value, lang, false);
  const def = KPI_DEFS[first.key];
  // a scale value already reads "4/5" (formatValue), so it takes no unit of its own
  const unit = def.type === "number" || def.type === "integer" ? unitLabel(def.unit, lang) : "";
  const status = worstShowStatus(panel.vitals.map((v) => v.status));
  const chartVital = sys ?? first;
  return (
    <div className={CARD} data-panel="vital" data-key={first.key}>
      <CardTitle icon={icon} title={isBp ? t("checkin.show.bp") : label(first.key, lang)} recorded={panel.recorded} />
      <div className="mt-2 flex flex-col gap-1.5">
        <BigValue main={main} unit={main === null ? "" : unit} status={status} />
        {def.type !== "boolean" && def.type !== "category" ? <MiniTrend vital={chartVital} height={36} /> : null}
        <ReferenceLine vital={chartVital} />
      </div>
    </div>
  );
}

/** heart rate with an animated, clearly labelled synthetic ECG trace */
function EcgCard({ panel }: { panel: Extract<ShowPanel, { kind: "ecg" }> }) {
  const { t, lang } = useI18n();
  const reduced = usePrefersReducedMotion();
  const v = panel.vital;
  const bpm = v.value === null ? null : asNumber(v.value);
  const period = beatSeconds(bpm);
  const beats = Math.max(2, Math.round(3 / period));
  const W = 200;
  const H = 46;
  // no pulse today: a flat, still line (a moving trace would suggest a reading that does not exist)
  const flat = bpm === null;
  const copy = flat ? `M0 ${H * 0.62} L${W} ${H * 0.62}` : ecgPath(W, H, beats);
  const still = reduced || flat;
  const color = v.status === "no_data" ? "var(--aegis-accent)" : statusColorVar(v.status);
  const gradId = useId();
  const valueStr = bpm === null ? null : numberText("heart_rate", bpm);
  return (
    <div className={CARD} data-panel="ecg">
      <CardTitle
        icon={HeartPulse}
        title={label("heart_rate", lang)}
        recorded={panel.recorded}
        right={
          flat ? null : (
            <motion.span
              aria-hidden="true"
              className="inline-block size-2 rounded-full"
              style={{ background: color }}
              animate={reduced ? undefined : { scale: [1, 1.6, 1], opacity: [1, 0.6, 1] }}
              transition={{ duration: period, repeat: Infinity, ease: "easeOut" }}
            />
          )
        }
      />
      <div className="mt-2 flex flex-col gap-1.5">
        <BigValue main={valueStr} unit={unitLabel("bpm", lang)} status={v.status} />
        <div
          role="img"
          aria-label={t("checkin.show.ecgAria", { value: valueStr === null ? "–" : `${valueStr} ${unitLabel("bpm", lang)}` })}
          className="relative h-[46px] overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(214,228,255,0.55),rgba(214,228,255,0.15))]"
          style={{ maskImage: "linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%)" } as CSSProperties}
        >
          {/* faint grid */}
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 200 46">
            {[9, 18, 27, 36].map((y) => (
              <line key={y} x1={0} x2={200} y1={y} y2={y} stroke="rgba(79,134,247,0.12)" strokeWidth={0.6} />
            ))}
          </svg>
          <div
            aria-hidden="true"
            className="aegis-ecg-scroll absolute inset-y-0 left-0 w-[200%]"
            style={{ animation: still ? "none" : `aegis-ecg-scroll ${(beats * period).toFixed(2)}s linear infinite` }}
          >
            <svg className="h-full w-full" viewBox={`0 0 ${W * 2} ${H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={color} stopOpacity={1} />
                </linearGradient>
              </defs>
              <g>
                <path
                  d={copy}
                  fill="none"
                  stroke={`url(#${gradId})`}
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                  strokeDasharray={flat ? "4 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={copy}
                  transform={`translate(${W} 0)`}
                  fill="none"
                  stroke={`url(#${gradId})`}
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                  strokeDasharray={flat ? "4 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </svg>
          </div>
          <span className="absolute top-1 right-2 rounded-full bg-white/80 px-1.5 text-[9px] font-semibold tracking-[0.1em] text-[var(--aegis-label)] uppercase">
            {t("checkin.show.ecgSimulated")}
          </span>
        </div>
        <ReferenceLine vital={v} />
      </div>
    </div>
  );
}

const RING_ICON = { water: Droplet, readiness: Gauge, spo2: Wind } as const;

function RingCard({ panel }: { panel: Extract<ShowPanel, { kind: "ring" }> }) {
  const { t, lang } = useI18n();
  const reduced = usePrefersReducedMotion();
  const r = 26;
  const c = 2 * Math.PI * r;
  const fraction = panel.value === null ? null : Math.min(Math.max(panel.value / panel.max, 0), 1);
  const color = panel.status === "no_data" ? "var(--aegis-accent)" : statusColorVar(panel.status);
  const title = t(`checkin.show.ring.${panel.metric}`);
  const center =
    panel.value === null
      ? "–"
      : panel.metric === "water"
        ? numberText("water_ml", panel.value)
        : String(Math.round(panel.value));
  const detail =
    panel.metric === "spo2"
      ? t("checkin.show.ring.spo2None")
      : panel.metric === "readiness"
        ? t("checkin.show.ring.readinessOf")
        : panel.value === null
          ? t("checkin.show.notToday")
          : t("checkin.show.ring.waterOf", { value: numberText("water_ml", panel.value), target: numberText("water_ml", panel.max) });
  return (
    <div className={CARD} data-panel="ring" data-metric={panel.metric}>
      <CardTitle icon={RING_ICON[panel.metric]} title={title} recorded={panel.recorded} />
      <div className="mt-2 flex items-center gap-3">
        <span className="relative size-[68px] shrink-0">
          <svg viewBox="0 0 68 68" className="size-full -rotate-90" aria-hidden="true" focusable="false">
            <circle cx="34" cy="34" r={r} fill="none" stroke="#dce9ff" strokeWidth="7" strokeDasharray={fraction === null ? "3 4" : undefined} />
            {fraction !== null ? (
              <motion.circle
                cx="34"
                cy="34"
                r={r}
                fill="none"
                stroke={color}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={c}
                initial={reduced ? false : { strokeDashoffset: c }}
                animate={{ strokeDashoffset: c * (1 - fraction) }}
                transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.25 }}
              />
            ) : null}
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="tnum text-[17px] font-medium text-[var(--aegis-ink)]">{center}</span>
            {panel.value !== null && panel.unit ? (
              <span className="mt-0.5 text-[9px] text-[var(--aegis-label)]">{unitLabel(panel.unit, lang)}</span>
            ) : null}
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <StatusPill status={panel.status} size="sm" className="self-start" />
          <p className="text-[12px] leading-snug text-[var(--aegis-label)]">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function TrendCard({ panel }: { panel: Extract<ShowPanel, { kind: "trend" }> }) {
  const { t, lang } = useI18n();
  const v = panel.vital;
  const series = panel.second ? [v, panel.second] : [v];
  const bp = panel.second !== undefined;
  const icon = KEY_ICON[v.key] ?? Gauge;
  const title = t("checkin.show.trend", { label: bp ? t("checkin.show.bp") : label(v.key, lang) });
  return (
    <div className={CARD} data-panel="trend" data-key={v.key}>
      <CardTitle icon={icon} title={title} right={<StatusGlyph status={worstShowStatus(series.map((s) => s.status))} size={13} />} />
      <div className="mt-2 flex flex-col gap-1.5">
        {series.map((s, i) => (
          <div key={s.key} className="flex flex-col gap-1">
            <MiniTrend vital={s} height={bp ? 46 : 78} showBandLabel={i === 0} />
            <div className="flex items-baseline justify-between gap-2 text-[11px] text-[var(--aegis-label)]">
              <span>{bp ? t(s.key === "bp_systolic" ? "checkin.show.sys" : "checkin.show.dia") : t("checkin.show.days", { n: s.history.length })}</span>
              <span className="tnum font-medium text-[var(--aegis-ink)]">
                {s.value === null ? t("checkin.show.notToday") : valueText(s.key, s.value, lang, true)}
              </span>
            </div>
            <ReferenceLine vital={s} />
          </div>
        ))}
        {bp ? <p className="text-[11px] text-[var(--aegis-label)]">{t("checkin.show.days", { n: v.history.length })}</p> : null}
      </div>
    </div>
  );
}

function BodyCard({ panel }: { panel: Extract<ShowPanel, { kind: "body" }> }) {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  return (
    <div className={CARD} data-panel="body">
      <CardTitle icon={PersonStanding} title={t("checkin.show.body")} />
      <BodyMap vitals={panel.vitals} size="panel" animate={!reduced} className="mt-1 h-[250px]" />
    </div>
  );
}

function LinkCard({
  panel,
  checkInId,
  onOpenLabs,
}: {
  panel: Extract<ShowPanel, { kind: "signature" | "labs" }>;
  checkInId: string | null;
  onOpenLabs?: () => void;
}) {
  const { t } = useI18n();
  const sig = panel.kind === "signature";
  // the same page the dashboard's Signature link opens: this crew member's linked reference panel, and back to the check-in
  const query = new URLSearchParams();
  if (panel.kind === "signature" && panel.reference) query.set("crew", panel.reference);
  if (checkInId) query.set("checkInId", checkInId);
  const qs = query.toString();
  const sigHref = `/signature${qs ? `?${qs}` : ""}`;
  const action = "inline-flex items-center gap-1 self-start rounded-full bg-[var(--aegis-ink)] px-3 py-1.5 text-[12px] font-medium text-white outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/60";
  return (
    <div className={CARD} data-panel={panel.kind}>
      <CardTitle icon={sig ? Microscope : FlaskConical} title={t(sig ? "checkin.show.signature.title" : "checkin.show.labs.title")} />
      <p className="mt-1.5 text-[12px] leading-snug text-[var(--aegis-label)]">
        {t(sig ? "checkin.show.signature.text" : "checkin.show.labs.text")}
      </p>
      <div className="mt-2">
        {sig ? (
          <a
            href={sigHref}
            target="_blank"
            rel="noopener noreferrer"
            className={action}
          >
            {t("checkin.show.signature.open")}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        ) : onOpenLabs ? (
          <button type="button" onClick={onOpenLabs} className={action}>
            {t("checkin.show.labs.open")}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </button>
        ) : (
          <p className="text-[12px] font-medium text-[var(--aegis-accent-deep)]">{t("checkin.show.labs.later")}</p>
        )}
      </div>
    </div>
  );
}

export function ShowPanelView({
  panel,
  checkInId = null,
  onOpenLabs,
}: {
  panel: ShowPanel;
  checkInId?: string | null;
  onOpenLabs?: () => void;
}) {
  switch (panel.kind) {
    case "vital":
      return <VitalCard panel={panel} />;
    case "ecg":
      return <EcgCard panel={panel} />;
    case "ring":
      return <RingCard panel={panel} />;
    case "trend":
      return <TrendCard panel={panel} />;
    case "body":
      return <BodyCard panel={panel} />;
    case "signature":
    case "labs":
      return <LinkCard panel={panel} checkInId={checkInId} onOpenLabs={onOpenLabs} />;
  }
}

/* ───────────── the glass stack beside Cosmo ───────────── */

const LIST: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.12 } },
};
const ITEM: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 210, damping: 24 } },
};

export type ShowPlacement = "wide" | "narrow" | "dashboard";

/**
 * On the check-in stage the panels sit just above the captured-value bubbles (z auto) and BELOW everything the
 * astronaut must be able to read or press: the clarification bubble (z-10), the corner controls (z-20), the notices
 * (z-30) and the vision self-check card (z-40), which can reach into the panels' column on a 1280 px screen.
 */
const PLACEMENT: Record<ShowPlacement, string> = {
  // beside Cosmo, under the top-right corner controls
  wide: "fixed z-[5] top-[4.25rem] right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100dvh-13.5rem)] overflow-y-auto overscroll-contain",
  // phones: stacked under Cosmo, in the stage's flow position given by `top`; the page scrolls (not the panel), and an
  // empty strip under it (::after) lets its last card scroll clear of the fixed answer bar and demo row at the bottom
  narrow:
    "absolute z-[5] inset-x-3 after:pointer-events-none after:absolute after:top-full after:left-0 after:h-52 after:w-px after:content-['']",
  // the dashboard: above Cosmo's dock and the conversation bar
  dashboard:
    "fixed z-40 right-3 bottom-[8.5rem] left-3 max-h-[calc(100dvh-11rem)] overflow-y-auto overscroll-contain md:left-auto md:right-[max(1.25rem,calc((100vw-1800px)/2+1.5rem))] md:w-[22rem]",
};

/**
 * The panels of the last `show` event, in a translucent glass column beside Cosmo ("HEALTH DASHBOARD" header,
 * "concept demonstration" footer). They slide in one after the other and go away by themselves SHOW_LINGER_MS after
 * Cosmo stops speaking (or at once with the close button, or when the next question starts).
 */
export function ShowStage({
  show,
  hold,
  onDismiss,
  placement,
  top,
  checkInId = null,
  onOpenLabs,
}: {
  show: { seq: number; panels: ShowPanel[] } | null;
  /** Cosmo is still speaking (or thinking): keep the panels */
  hold: boolean;
  onDismiss: () => void;
  placement: ShowPlacement;
  /** "narrow": distance from the top of the stage */
  top?: number;
  checkInId?: string | null;
  onOpenLabs?: () => void;
}) {
  const { t } = useI18n();
  const seq = show?.seq ?? null;
  // on the dashboard the labs card opens the Labs tab; during the check-in it only says where the labs are
  const openLabs =
    onOpenLabs ??
    (placement === "dashboard"
      ? () => window.dispatchEvent(new CustomEvent(OPEN_DASHBOARD_SECTION_EVENT, { detail: { section: "labs" } }))
      : undefined);
  useEffect(() => {
    if (seq === null || hold) return;
    const timer = setTimeout(onDismiss, SHOW_LINGER_MS);
    return () => clearTimeout(timer);
  }, [seq, hold, onDismiss]);

  return (
    <AnimatePresence>
      {show ? (
        <motion.section
          key={show.seq}
          data-slot="show-stage"
          data-placement={placement}
          aria-label={t("checkin.show.region")}
          aria-live="polite"
          className={cn(
            PLACEMENT[placement],
            "flex flex-col gap-2 rounded-[26px] border border-white/80 bg-white/55 p-2.5 shadow-[0_30px_70px_-30px_rgba(40,80,160,0.55)] backdrop-blur-xl backdrop-saturate-150",
          )}
          style={placement === "narrow" && top !== undefined ? { top } : undefined}
          initial={{ opacity: 0, x: placement === "wide" ? 28 : 0, y: placement === "wide" ? 0 : 16, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: placement === "wide" ? 20 : 0, y: placement === "wide" ? 0 : 10, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 170, damping: 24 }}
        >
          <div className="flex items-center gap-2 px-1.5 pt-0.5">
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--aegis-accent)] opacity-50" />
              <span className="relative size-2 rounded-full bg-[var(--aegis-accent)]" />
            </span>
            <p className="min-w-0 flex-1 text-[10.5px] leading-tight font-semibold tracking-[0.14em] text-[var(--aegis-ink)]/80 uppercase">
              {t("checkin.show.header")} <span className="text-[var(--aegis-label)]">· {t("checkin.show.tag")}</span>
            </p>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t("checkin.show.close")}
              className="inline-flex size-7 items-center justify-center rounded-full text-[var(--aegis-label)] outline-none hover:bg-black/5 focus-visible:ring-3 focus-visible:ring-ring/60"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <motion.ul className="flex flex-col gap-2" variants={LIST} initial="hidden" animate="show">
            {show.panels.map((panel) => (
              <motion.li key={panel.id} variants={ITEM}>
                <ShowPanelView panel={panel} checkInId={checkInId} onOpenLabs={openLabs} />
              </motion.li>
            ))}
          </motion.ul>
          <p className="px-1.5 pb-0.5 text-center text-[9.5px] font-medium tracking-[0.12em] text-[var(--aegis-label)] uppercase">
            {t("checkin.show.footer")}
          </p>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
