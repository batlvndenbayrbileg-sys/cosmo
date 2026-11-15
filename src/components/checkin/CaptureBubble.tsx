"use client";

import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Brain,
  Briefcase,
  Droplet,
  Dumbbell,
  Eye,
  Gauge,
  GlassWater,
  HeartPulse,
  Moon,
  NotebookPen,
  Orbit,
  PenLine,
  Smile,
  Thermometer,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { StatusGlyph } from "@/components/status/StatusGlyph";
import { statusWordKey } from "@/components/status/statusClasses";
import { formatValue, getKpi, isTextKey } from "@/lib/kpi/registry";
import { useI18n } from "@/i18n/I18nProvider";
import type { KpiKey } from "@/lib/types";
import { splitValueUnit, trailEnd, trailPath, type BubbleItem, type BubbleSlot, type Point } from "./bubbles";

export const KPI_ICONS: Record<KpiKey, LucideIcon> = {
  sleep_hours: Moon,
  mood: Smile,
  symptom_headache: Brain,
  symptom_dizziness: Orbit,
  symptom_nausea: Waves,
  symptom_note: NotebookPen,
  bp_systolic: Gauge,
  bp_diastolic: Gauge,
  heart_rate: HeartPulse,
  temperature_c: Thermometer,
  glucose_mgdl: Droplet,
  water_ml: GlassWater,
  exercise_min: Dumbbell,
  vision_check: Eye,
  workload: Briefcase,
  day_note: PenLine,
};

const FLY = { type: "spring", stiffness: 150, damping: 19, mass: 0.9 } as const;

/** a step easing, so the clip reveal advances like typed characters */
function steps(n: number) {
  const k = Math.max(1, n);
  return (t: number) => Math.min(1, Math.ceil(t * k) / k);
}

export interface BubbleText {
  label: string;
  value: string;
  unit: string;
  /** whole sentence for screen readers */
  spoken: string;
}

/** Label / value / unit for a bubble, in the current UI language. */
export function useBubbleText(item: BubbleItem): BubbleText {
  const { t, lang } = useI18n();
  const status = t(statusWordKey(item.status));
  if (item.id === "bp") {
    const sys = item.cards.find((c) => c.key === "bp_systolic");
    const dia = item.cards.find((c) => c.key === "bp_diastolic");
    const label = t("checkin.bubble.bp");
    const unit = "mmHg";
    const value = sys && dia ? `${sys.value}/${dia.value}` : String((sys ?? dia)?.value ?? "");
    return { label, value, unit, spoken: t("checkin.card.captured", { label, value: `${value} ${unit}`, status }) };
  }
  const card = item.cards[0];
  const def = getKpi(item.key);
  const label = def.labels[lang];
  const formatted = formatValue(item.key, card.value, lang);
  const split = isTextKey(item.key)
    ? { value: `“${formatted}”`, unit: "" }
    : splitValueUnit(formatted, def.unit);
  return {
    label,
    ...split,
    spoken: t("checkin.card.captured", { label, value: formatted, status }),
  };
}

export interface CaptureBubbleProps {
  item: BubbleItem;
  slot: BubbleSlot;
  width: number;
  height: number;
  /** where the bubble flies out of and back into */
  chest: Point;
  /** "preparing": all bubbles drift back into the mascot */
  converge: boolean;
  /** position in capture order, staggers the converge */
  index: number;
}

/**
 * One captured value as a frosted glass bubble: black icon chip, label, value + unit, status glyph.
 * It springs out of Cosmo's chest into its slot while a glowing pen trail connects the two and the
 * value is "typed" in. A correction (flash changes) shakes it gently and retypes the value.
 */
export const CaptureBubble = memo(function CaptureBubble({
  item,
  slot,
  width,
  height,
  chest,
  converge,
  index,
}: CaptureBubbleProps) {
  const reduce = useReducedMotion();
  const text = useBubbleText(item);
  const Icon = KPI_ICONS[item.key];
  const fromX = chest.x - (slot.x + width / 2);
  const fromY = chest.y - (slot.y + height / 2);
  const chars = text.value.length + (text.unit ? text.unit.length + 1 : 0);
  const typeSeconds = reduce ? 0 : Math.min(0.9, 0.12 + chars * 0.05);

  return (
    <motion.li
      data-slot="capture-bubble"
      data-key={item.id}
      data-status={item.status}
      className="absolute list-none"
      style={{ left: slot.x, top: slot.y, width, height }}
      initial={{ x: fromX, y: fromY, scale: 0.25, opacity: 0 }}
      animate={
        converge
          ? { x: fromX, y: fromY, scale: 0.2, opacity: 0, transition: { duration: 0.55, delay: index * 0.045, ease: [0.4, 0, 0.6, 1] } }
          : { x: 0, y: 0, scale: 1, opacity: 1, transition: FLY }
      }
    >
      <span className="sr-only">{text.spoken}</span>
      <motion.div
        key={`shake-${item.flash}`}
        aria-hidden="true"
        className="size-full"
        initial={{ x: 0 }}
        animate={item.flash > 0 && !reduce ? { x: [0, -7, 6, -4, 3, 0] } : { x: 0 }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      >
        <div
          className="flex size-full items-center gap-2.5 rounded-[20px] border border-white/85 bg-white/72 pr-3 pl-2 shadow-[0_14px_34px_-16px_rgba(40,80,160,0.35)] backdrop-blur-xl backdrop-saturate-150"
          style={{ WebkitBackdropFilter: "blur(24px) saturate(150%)" }}
        >
          <span className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--cosmo-ink)] text-white">
            <Icon className="size-[17px]" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
            <span className="truncate text-[11.5px] font-medium text-[var(--cosmo-label)]">{text.label}</span>
            <motion.span
              key={`type-${item.flash}`}
              className="flex min-w-0 items-baseline gap-1 whitespace-nowrap"
              initial={{ clipPath: "inset(0 100% 0 0)" }}
              animate={{ clipPath: "inset(0 0% 0 0)" }}
              transition={{ duration: typeSeconds, delay: reduce ? 0 : 0.32, ease: steps(chars) }}
            >
              <span className="tnum truncate text-[17px] font-medium text-[var(--cosmo-ink)]">{text.value}</span>
              {text.unit ? <span className="text-[11px] text-[var(--cosmo-label)]">{text.unit}</span> : null}
            </motion.span>
          </div>
          <StatusGlyph status={item.status} size={15} labelled={false} />
        </div>
      </motion.div>
    </motion.li>
  );
});

/**
 * The glowing "pen" line from Cosmo to a bubble, drawn while it is written (and again on a correction).
 * Keyed by the bubble's flash counter so every write replays it; it fades out by itself.
 */
export const PenTrail = memo(function PenTrail({
  from,
  slot,
  width,
  height,
  writeKey,
}: {
  from: Point;
  slot: BubbleSlot;
  width: number;
  height: number;
  writeKey: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const to = trailEnd(slot, width, height);
  const d = trailPath(from, to);
  return (
    <motion.g
      key={writeKey}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: 1.5, times: [0, 0.08, 0.55, 1], ease: "easeOut" }}
    >
      <motion.path
        d={d}
        fill="none"
        stroke="#5b95ff"
        strokeWidth={7}
        strokeLinecap="round"
        filter="url(#pen-blur)"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.55, ease: [0.3, 0.7, 0.4, 1] }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.8}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.55, ease: [0.3, 0.7, 0.4, 1] }}
      />
      <motion.circle
        cx={to.x}
        cy={to.y}
        r={3.5}
        fill="#ffffff"
        filter="url(#pen-blur-sm)"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.6, 1], opacity: [0, 1, 0.8] }}
        transition={{ duration: 0.5, delay: 0.45 }}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      />
    </motion.g>
  );
});

/** Shared gradients / filters for the pen trails (one per stage). */
export function PenTrailDefs() {
  return (
    <defs>
      <filter id="pen-blur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3.5" />
      </filter>
      <filter id="pen-blur-sm" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
    </defs>
  );
}
