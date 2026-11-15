/**
 * Pure geometry of the walkthrough's chart (src/components/explain/ExplainerStage.tsx): the person's past days and
 * today on one line, the shaded personal band and the general (or demo) normal range. No React, no DOM.
 */
import type { ExplainPanel } from "@/lib/explain";
import { formatNumber } from "@/lib/health/format";

type ChartPanel = Extract<ExplainPanel, { kind: "chart" }>;

export interface ChartDot {
  x: number;
  y: number;
  value: number;
  date: string | null;
}

export interface ChartGeometry {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  series: Array<{ key: string; path: string; dots: ChartDot[]; today: ChartDot | null }>;
  /** the personal band as a y span (top < bottom), null without a baseline */
  personal: { top: number; bottom: number } | null;
  /** the normal range's lines (y of its low and high bound when present) */
  normal: { low: number | null; high: number | null } | null;
  yTicks: Array<{ y: number; label: string }>;
  /** the first day and "today" under the axis */
  xFirst: { x: number; date: string } | null;
  xToday: number;
}

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export function chartGeometry(panel: ChartPanel, width: number, height: number, digits: number): ChartGeometry {
  const left = 40;
  const right = width - 14;
  const top = 14;
  const bottom = height - 26;

  const values: number[] = [];
  for (const s of panel.series) {
    for (const p of s.points) values.push(p.value);
    if (finite(s.today)) values.push(s.today);
  }
  for (const n of [panel.personal?.low, panel.personal?.high, panel.normal?.low, panel.normal?.high]) if (finite(n)) values.push(n);
  let min = values.length > 0 ? Math.min(...values) : 0;
  let max = values.length > 0 ? Math.max(...values) : 1;
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const padY = (max - min) * 0.1;
  min -= padY;
  max += padY;
  const y = (v: number) => Math.round((bottom - ((v - min) / (max - min)) * (bottom - top)) * 10) / 10;

  const slots = Math.max(2, ...panel.series.map((s) => s.points.length + 1));
  const x = (i: number) => Math.round((left + (i * (right - left)) / (slots - 1)) * 10) / 10;

  const series = panel.series.map((s) => {
    const offset = slots - 1 - s.points.length;
    const dots: ChartDot[] = s.points.map((p, i) => ({ x: x(i + offset), y: y(p.value), value: p.value, date: p.date }));
    const today: ChartDot | null = finite(s.today) ? { x: x(slots - 1), y: y(s.today), value: s.today, date: null } : null;
    const all = today ? [...dots, today] : dots;
    const path = all.map((d, i) => `${i === 0 ? "M" : "L"}${d.x} ${d.y}`).join(" ");
    return { key: s.key, path, dots, today };
  });

  const personal =
    panel.personal && finite(panel.personal.low) && finite(panel.personal.high)
      ? { top: y(panel.personal.high), bottom: y(panel.personal.low) }
      : null;
  const normal = panel.normal
    ? { low: finite(panel.normal.low) ? y(panel.normal.low) : null, high: finite(panel.normal.high) ? y(panel.normal.high) : null }
    : null;

  const lo = min + padY;
  const hi = max - padY;
  const mid = (lo + hi) / 2;
  const yTicks = [hi, mid, lo].map((v) => ({ y: y(v), label: formatNumber(v, digits) }));
  const firstSeries = panel.series[0];
  const first = firstSeries?.points[0];
  const xFirst = first ? { x: x(slots - 1 - firstSeries.points.length), date: first.date } : null;

  return { width, height, left, right, top, bottom, series, personal, normal, yTicks, xFirst, xToday: x(slots - 1) };
}

/** "2026-10-31" -> "31 Oct" / "10-31" (Mongolian keeps the month number) */
export function shortDate(iso: string, lang: "en" | "mn"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = Number(m[2]);
  const day = Number(m[3]);
  return lang === "mn" ? `${month}/${day}` : `${day} ${months[month - 1] ?? ""}`.trim();
}
