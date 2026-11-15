"use client";

/**
 * Small shared pieces of the v2 "glass clinic" dashboard (docs/DESIGN_V2.md): black icon chips, two-tone titles,
 * the per-axis icon set and the mascot render used as a picture (profile card, avatar crop).
 */
import type { CSSProperties, ReactNode } from "react";
import {
  Dumbbell,
  Droplet,
  Eye,
  HeartPulse,
  Moon,
  Smile,
  type LucideIcon,
} from "lucide-react";
import type { AxisKey } from "@/lib/types";
import { variantFor } from "@/components/cosmo/variants";
import { cn } from "@/lib/utils";

export const AXIS_ICON: Record<AxisKey, LucideIcon> = {
  neuro_ocular: Eye,
  sleep: Moon,
  cardio: HeartPulse,
  behavioral: Smile,
  metabolic: Droplet,
  musculoskeletal: Dumbbell,
};

export function IconChip({
  icon: Icon,
  size = 38,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("icon-chip", className)}
      style={{ width: size, height: size }}
    >
      <Icon className="size-[45%]" strokeWidth={1.8} />
    </span>
  );
}

/** "Health" light + "Radar" medium, optionally after a black icon chip */
export function TwoToneTitle({
  light,
  strong,
  icon,
  id,
  as: Tag = "h2",
  className,
}: {
  light: string;
  strong: string;
  icon?: LucideIcon;
  id?: string;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {icon ? <IconChip icon={icon} /> : null}
      <Tag id={id} className="text-[26px] leading-tight font-light tracking-tight text-[var(--cosmo-ink)]">
        {light} <span className="font-medium">{strong}</span>
      </Tag>
    </div>
  );
}

/** the team's front render with the crew variant hue; decorative unless `alt` is given */
export function MascotPicture({
  variant,
  alt = "",
  className,
  style,
}: {
  variant: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const hue = variantFor(variant).hueDeg;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static transparent render, sized by CSS
    <img
      src="/mascot/cosmo-front.png"
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      draggable={false}
      className={cn("pointer-events-none select-none", className)}
      style={{ filter: hue ? `hue-rotate(${hue}deg)` : undefined, ...style }}
    />
  );
}

/** small uppercase label + big number + unit, the reference's "AVG 72 bpm" block */
export function BigStat({
  label,
  value,
  unit,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="unit-label">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="num-xl">{value}</span>
        {unit ? <span className="text-[12px] text-[var(--cosmo-label)]">{unit}</span> : null}
      </span>
    </div>
  );
}
