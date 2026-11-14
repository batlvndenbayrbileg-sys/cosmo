import type { Status } from "@/lib/types";

export interface StatusClassSet {
  /** glyph / icon colour (text-*) */
  text: string;
  /** solid background */
  bg: string;
  /** pale tint background */
  soft: string;
  /** border colour */
  border: string;
  /** dark text colour that stays readable on the tint */
  ink: string;
  /** SVG fill colour */
  fill: string;
  /** SVG stroke colour */
  stroke: string;
  /** ready-made pill look: tint background, ink text, soft border */
  pill: string;
}

// Full literal class names so Tailwind can see them at build time.
const CLASSES: Record<Status, StatusClassSet> = {
  green: {
    text: "text-status-ok",
    bg: "bg-status-ok",
    soft: "bg-status-ok-soft",
    border: "border-status-ok",
    ink: "text-status-ok-ink",
    fill: "fill-status-ok",
    stroke: "stroke-status-ok",
    pill: "bg-status-ok-soft text-status-ok-ink border-status-ok/30",
  },
  yellow: {
    text: "text-status-watch",
    bg: "bg-status-watch",
    soft: "bg-status-watch-soft",
    border: "border-status-watch",
    ink: "text-status-watch-ink",
    fill: "fill-status-watch",
    stroke: "stroke-status-watch",
    pill: "bg-status-watch-soft text-status-watch-ink border-status-watch/30",
  },
  red: {
    text: "text-status-alert",
    bg: "bg-status-alert",
    soft: "bg-status-alert-soft",
    border: "border-status-alert",
    ink: "text-status-alert-ink",
    fill: "fill-status-alert",
    stroke: "stroke-status-alert",
    pill: "bg-status-alert-soft text-status-alert-ink border-status-alert/30",
  },
  no_data: {
    text: "text-status-nodata",
    bg: "bg-status-nodata",
    soft: "bg-status-nodata-soft",
    border: "border-status-nodata",
    ink: "text-status-nodata-ink",
    fill: "fill-status-nodata",
    stroke: "stroke-status-nodata",
    pill: "bg-status-nodata-soft text-status-nodata-ink border-status-nodata/30",
  },
};

/** Tailwind class strings for a status (green = Normal, yellow = Watch, red = Alert, no_data). */
export function statusClasses(status: Status): StatusClassSet {
  return CLASSES[status];
}

/** i18n key of the status word ("Normal" / "Watch" / "Alert" / "No data"). */
export function statusWordKey(status: Status): string {
  return `shell.status.${status}`;
}
