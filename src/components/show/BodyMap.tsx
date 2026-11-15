"use client";

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import type { KpiKey, Lang, Status } from "@/lib/types";
import { BODY_CALLOUTS, worstShowStatus, type BodyCallout, type ShowVital } from "@/lib/show";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { StatusGlyph } from "@/components/status";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { statusColorVar } from "@/components/dashboard/logic";
import { valueText } from "./format";

/** width / height of the body-figure.png render */
const FIG_RATIO = 1020 / 1536;
/** where a left label's right edge (and a right label's left edge) sits, as a fraction of the figure width */
const LABEL_EDGE = 0.17;
/** where the leader line bends, as a fraction of the figure width from the label edge towards the body */
const ELBOW = 0.3;

export interface BodyLine {
  key: KpiKey | "bp";
  text: string;
  status: Status;
}

/**
 * The value lines of one site: blood pressure as one "118/76 mmHg" line, keys without a value left out. A scale value
 * ("4/5") has no unit to say what it is, so it carries a short name (`name`, default the indicator's label): "Mood 4/5".
 */
export function calloutLines(
  callout: BodyCallout,
  byKey: ReadonlyMap<KpiKey, ShowVital>,
  lang: Lang,
  name: (key: KpiKey) => string = (key) => KPI_DEFS[key].labels[lang],
): BodyLine[] {
  const lines: BodyLine[] = [];
  const keys = callout.keys;
  for (const key of keys) {
    if (key === "bp_diastolic") continue;
    if (key === "bp_systolic") {
      const sys = byKey.get("bp_systolic");
      const dia = byKey.get("bp_diastolic");
      if (sys?.value == null || dia?.value == null) continue;
      lines.push({
        key: "bp",
        text: `${valueText("bp_systolic", sys.value, lang, false)}/${valueText("bp_diastolic", dia.value, lang, true)}`,
        status: worstShowStatus([sys.status, dia.status]),
      });
      continue;
    }
    const v = byKey.get(key);
    if (!v || v.value === null) continue;
    const text = valueText(key, v.value, lang, true);
    lines.push({ key, text: KPI_DEFS[key].type === "scale" ? `${name(key)} ${text}` : text, status: v.status });
  }
  return lines;
}

/**
 * The body figure with callouts: each value drawn beside the part of the body it belongs to (head: sleep and mood,
 * forehead: temperature, eyes: vision, heart: pulse and blood pressure, lungs: SpO2 (not measured here), abdomen:
 * glucose and water, legs: exercise), with its status (shape + colour) and a leader line to the spot. Animated in
 * (labels slide in one after the other, the lines draw themselves) unless `animate` is false.
 *
 * Sizing: the parent gives this box a height (and a width); the figure is as tall as the box allows while leaving
 * room for the labels on both sides (CSS container units, no measuring).
 */
export function BodyMap({
  vitals,
  size = "full",
  animate = true,
  className,
  style,
}: {
  vitals: readonly ShowVital[];
  size?: "panel" | "full";
  animate?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { t, lang } = useI18n();
  const byKey = new Map(vitals.map((v) => [v.key, v]));
  // the short name a scale value carries on the figure ("Mood 4/5"), short enough for a phone
  const shortName = (key: KpiKey) => (key === "mood" ? t("dashboard.bodyMap.name.mood") : KPI_DEFS[key].labels[lang]);
  const small = size === "panel";
  // the figure: as tall as the box, but never wider than about half of it (the labels need the rest)
  const boxStyle = {
    ...style,
    containerType: "size",
    "--fh": `min(100cqh, calc(100cqw * ${small ? 0.74 : 0.9}))`,
    "--fw": `calc(var(--fh) * ${FIG_RATIO.toFixed(4)})`,
  } as CSSProperties;

  return (
    <div
      data-slot="body-map"
      role="group"
      aria-label={t("dashboard.bodyMap.figure")}
      className={cn("relative w-full", className)}
      style={boxStyle}
    >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: "var(--fw)", height: "var(--fh)" }}
      >
        {/* soft glow and floor */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-25%] top-[4%] bottom-[8%] rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgba(150,190,255,0.5), rgba(190,214,255,0.22) 60%, rgba(230,239,255,0) 100%)",
            filter: "blur(4px)",
          }}
        />
        <motion.div
          className="absolute inset-0"
          initial={animate ? { opacity: 0, y: 10, scale: 0.97 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 22 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- transparent render sized by the box */}
          <img
            src="/body/body-figure.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none h-full w-full select-none"
            style={{ filter: "drop-shadow(0 14px 24px rgba(40,80,160,0.18))" }}
          />
          {/* a slow scanning light over the figure (off with reduced motion) */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[40%]">
            <div
              className="aegis-sweep absolute inset-0"
              style={{
                background: "linear-gradient(180deg, rgba(79,134,247,0) 40%, rgba(79,134,247,0.16) 50%, rgba(79,134,247,0) 60%)",
                animation: animate ? "aegis-sweep 5.5s ease-in-out 1.2s infinite" : "none",
                opacity: animate ? undefined : 0,
              }}
            />
          </div>
        </motion.div>

        {/* leader lines (figure-box units, so they stay attached to the body at any size) */}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          {BODY_CALLOUTS.map((c, i) => {
            const left = c.side === "left";
            const edge = left ? LABEL_EDGE * 100 : (1 - LABEL_EDGE) * 100;
            const elbow = left ? (LABEL_EDGE + ELBOW * (c.x - LABEL_EDGE)) * 100 : (1 - LABEL_EDGE - ELBOW * (1 - LABEL_EDGE - c.x)) * 100;
            const d = `M ${(c.x * 100).toFixed(1)} ${(c.y * 100).toFixed(1)} L ${elbow.toFixed(1)} ${(c.labelY * 100).toFixed(1)} L ${edge.toFixed(1)} ${(c.labelY * 100).toFixed(1)}`;
            const lines = calloutLines(c, byKey, lang);
            const status = c.keys.length === 0 ? "no_data" : worstShowStatus(lines.map((l) => l.status));
            return (
              <motion.path
                key={c.site}
                d={d}
                fill="none"
                stroke={status === "no_data" ? "rgba(91,102,120,0.45)" : statusColorVar(status)}
                strokeOpacity={0.75}
                strokeWidth={1.2}
                strokeDasharray={status === "no_data" ? "3 3" : undefined}
                vectorEffect="non-scaling-stroke"
                initial={animate ? { pathLength: 0, opacity: 0 } : false}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.25 + i * 0.08, ease: "easeOut" }}
              />
            );
          })}
        </svg>

        {/* anchor dots on the body */}
        {BODY_CALLOUTS.map((c, i) => {
          const lines = calloutLines(c, byKey, lang);
          const status = c.keys.length === 0 ? "no_data" : worstShowStatus(lines.map((l) => l.status));
          const pulse = status === "yellow" || status === "red";
          return (
            <motion.span
              key={c.site}
              aria-hidden="true"
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
              initial={animate ? { scale: 0, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 + i * 0.08 }}
            >
              {pulse ? (
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: statusColorVar(status),
                    animation: animate ? `aegis-pulse ${status === "red" ? 1.8 : 2.6}s cubic-bezier(0.2,0.6,0.3,1) infinite` : "none",
                  }}
                />
              ) : null}
              <span
                className={cn("relative block rounded-full border-2 border-white", small ? "size-2.5" : "size-3")}
                style={{ background: statusColorVar(status), boxShadow: "0 1px 4px rgba(15,27,45,0.35)" }}
              />
            </motion.span>
          );
        })}

        {/* the labels */}
        {BODY_CALLOUTS.map((c, i) => {
          const left = c.side === "left";
          const lines = calloutLines(c, byKey, lang, shortName);
          const empty = c.keys.length > 0 && lines.length === 0;
          return (
            <motion.div
              key={c.site}
              data-site={c.site}
              className={cn(
                "absolute flex -translate-y-1/2 flex-col rounded-xl border border-white/90 bg-white/80 shadow-[0_8px_20px_-12px_rgba(40,80,160,0.5)] backdrop-blur-md",
                small ? "gap-0 px-1.5 py-1" : "gap-0 px-2 py-1",
                left ? "items-end text-right" : "items-start text-left",
              )}
              style={{
                top: `${c.labelY * 100}%`,
                ...(left ? { right: `${(1 - LABEL_EDGE) * 100}%` } : { left: `${(1 - LABEL_EDGE) * 100}%` }),
                maxWidth: `calc((100cqw - var(--fw)) / 2 + var(--fw) * ${LABEL_EDGE} - 4px)`,
              }}
              initial={animate ? { opacity: 0, x: left ? 10 : -10 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.35 + i * 0.08, ease: "easeOut" }}
            >
              <span
                className={cn(
                  "font-semibold tracking-[0.08em] whitespace-nowrap text-[var(--aegis-label)] uppercase",
                  small ? "text-[8.5px] leading-[1.1]" : "text-[clamp(8px,2.8cqw,10px)] leading-tight",
                )}
              >
                {t(`dashboard.bodyMap.site.${c.site}`)}
              </span>
              {c.keys.length === 0 ? (
                <span className={cn("leading-tight text-[var(--aegis-label)]", small ? "text-[10px]" : "text-[clamp(10px,3.4cqw,12px)]")}>
                  {t("dashboard.bodyMap.spo2")}
                </span>
              ) : empty ? (
                <span className={cn("leading-tight text-[var(--aegis-label)]", small ? "text-[10px]" : "text-[clamp(10px,3.4cqw,12px)]")}>
                  {t("dashboard.bodyMap.none")}
                </span>
              ) : (
                lines.map((l) => (
                  <span
                    key={l.key}
                    className={cn(
                      "tnum flex items-center gap-1 leading-tight font-medium whitespace-nowrap text-[var(--aegis-ink)]",
                      small ? "text-[10.5px]" : "text-[clamp(10px,3.6cqw,12.5px)]",
                      left && "flex-row-reverse",
                    )}
                  >
                    <StatusGlyph status={l.status} size={small ? 9 : 11} />
                    {l.text}
                  </span>
                ))
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
