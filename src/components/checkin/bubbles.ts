/**
 * Pure helpers for the Siri-style check-in stage (docs/DESIGN_V2.md section 3): which glass bubbles
 * exist (one per captured measurement, blood pressure merged into one), the order they were first
 * written in, and where the mascot, its floor ring and every bubble slot sit for a viewport size.
 * No React, no DOM: unit-tested in tests/checkin.client.test.ts.
 */
import type { KpiKey, Status } from "@/lib/types";
import type { CaptureCard } from "./state";

/* ───────────── bubble items ───────────── */

export interface BubbleItem {
  /** stable id: the first key of the bubble ("bp" for the merged blood pressure bubble) */
  id: string;
  /** the key that picks the icon and the label */
  key: KpiKey;
  /** the cards behind this bubble, in display order (systolic before diastolic) */
  cards: CaptureCard[];
  /** worst status of the cards */
  status: Status;
  /** sum of the cards' correction counters: changes whenever any of them is re-captured */
  flash: number;
}

const STATUS_RANK: Record<Status, number> = { no_data: 0, green: 1, yellow: 2, red: 3 };

export function worstStatus(statuses: Status[]): Status {
  let worst: Status = "no_data";
  for (const s of statuses) if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  return worst;
}

const BP_KEYS: ReadonlySet<KpiKey> = new Set<KpiKey>(["bp_systolic", "bp_diastolic"]);

/**
 * Bubbles in the order their first value was captured. `cards` is newest first (the reducer prepends
 * new keys and corrects existing ones in place), so the reversed list is the capture order.
 * Systolic and diastolic share one "blood pressure" bubble.
 */
export function bubbleItems(cards: readonly CaptureCard[]): BubbleItem[] {
  const ordered = [...cards].reverse();
  const items: BubbleItem[] = [];
  let bp: BubbleItem | null = null;
  for (const card of ordered) {
    if (BP_KEYS.has(card.key)) {
      if (!bp) {
        bp = { id: "bp", key: "bp_systolic", cards: [], status: "no_data", flash: 0 };
        items.push(bp);
      }
      bp.cards.push(card);
      continue;
    }
    items.push({ id: card.key, key: card.key, cards: [card], status: card.status, flash: card.flash });
  }
  if (bp) {
    bp.cards.sort((a, b) => (a.key === "bp_systolic" ? -1 : b.key === "bp_systolic" ? 1 : 0));
    bp.status = worstStatus(bp.cards.map((c) => c.status));
    bp.flash = bp.cards.reduce((sum, c) => sum + c.flash, 0);
  }
  return items;
}

/* ───────────── stage geometry ───────────── */

export interface Point {
  x: number;
  y: number;
}

export interface BubbleSlot extends Point {
  /** which side of the mascot; the pen trail leaves from the side facing the mascot */
  side: "left" | "right" | "below";
}

export interface StageLayout {
  mode: "wide" | "narrow";
  width: number;
  /** total stage height: the viewport height, or more on a phone when the bubbles run below */
  height: number;
  /** top-left corner and edge length of the square mascot box */
  mascot: { x: number; y: number; size: number };
  /** where bubbles fly out of (the chest badge) */
  chest: Point;
  /** anchor next to the head for the clarification bubble */
  head: Point;
  /** floor ellipse under the feet */
  floor: { cx: number; cy: number; rx: number; ry: number };
  /** top of the caption line under the floor */
  captionY: number;
  bubbleWidth: number;
  bubbleHeight: number;
  /** top-left corner of each bubble slot, in capture order */
  slots: BubbleSlot[];
}

/** at most this many bubbles per side before the rows get tighter */
export const ROWS_PER_SIDE = 7;
const WIDE_MIN_WIDTH = 900;
const WIDE_MIN_HEIGHT = 520;
const EDGE = 16;
/** the visible robot fills about 86% of its square box: half of that is the body's half width */
const BODY_HALF = 0.43;
const GAP = 18;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function mascotPoints(x: number, y: number, size: number) {
  const cx = x + size / 2;
  const floor = { cx, cy: y + size * 0.985, rx: size * 0.34, ry: Math.max(10, size * 0.055) };
  return {
    chest: { x: cx + size * 0.03, y: y + size * 0.62 },
    head: { x: cx + size * 0.3, y: y + size * 0.06 },
    floor,
    captionY: floor.cy + floor.ry + 14,
  };
}

/**
 * Where everything goes for a viewport of `width` x `height` with `count` bubbles.
 * Wide screens: mascot centred at about 70% of the height, bubbles in two columns hugging it
 * (left, right, left, ... top to bottom, a slight outward bulge in the middle rows), never over it.
 * Narrow screens: mascot on top, bubbles in a two-column grid underneath (the stage may scroll).
 */
export function computeStageLayout(width: number, height: number, count: number): StageLayout {
  const w = Math.max(320, width);
  const h = Math.max(480, height);

  if (w >= WIDE_MIN_WIDTH && h >= WIDE_MIN_HEIGHT) {
    // keep room for the corner controls above and the floor, caption and ribbon below
    let size = Math.min(h * 0.7, h - 56 - 120, w * 0.46, 860);
    // the side columns need at least 200 px each
    const minBubble = 200;
    const maxForColumns = (w - 2 * (minBubble + GAP + EDGE)) / (2 * BODY_HALF);
    size = Math.max(260, Math.min(size, maxForColumns));
    const x = (w - size) / 2;
    const y = Math.max(52, (h - size) / 2 - 30);
    const pts = mascotPoints(x, y, size);

    const side = w / 2 - size * BODY_HALF - GAP - EDGE;
    const bubbleWidth = Math.round(clamp(side, minBubble, 300));
    const rows = Math.max(ROWS_PER_SIDE, Math.ceil(count / 2));
    const top = y + size * 0.02;
    const bottom = y + size * 0.97;
    const bubbleHeight = (bottom - top) / rows >= 64 ? 58 : 50;
    const step = rows > 1 ? (bottom - top - bubbleHeight) / (rows - 1) : 0;
    const bulge = size * 0.05;

    const slots: BubbleSlot[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = Math.floor(i / 2);
      const t = rows > 1 ? row / (rows - 1) : 0.5;
      const out = Math.sin(Math.PI * t) * bulge;
      const left = i % 2 === 0;
      const rawX = left
        ? w / 2 - size * BODY_HALF - GAP - bubbleWidth - out
        : w / 2 + size * BODY_HALF + GAP + out;
      slots.push({
        x: Math.round(clamp(rawX, EDGE, w - EDGE - bubbleWidth)),
        y: Math.round(top + row * step),
        side: left ? "left" : "right",
      });
    }
    return { mode: "wide", width: w, height: h, mascot: { x, y, size }, ...pts, bubbleWidth, bubbleHeight, slots };
  }

  // narrow: mascot on top, bubbles below in two columns
  const size = Math.min(w * 0.84, h * 0.5, 460);
  const x = (w - size) / 2;
  const y = 72;
  const pts = mascotPoints(x, y, size);
  const colGap = 10;
  const bubbleWidth = Math.floor((w - 2 * EDGE - colGap) / 2);
  const bubbleHeight = 52;
  const top = pts.captionY + 44;
  const slots: BubbleSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / 2);
    slots.push({
      x: EDGE + (i % 2) * (bubbleWidth + colGap),
      y: Math.round(top + row * (bubbleHeight + 8)),
      side: "below",
    });
  }
  const needed = count > 0 ? top + Math.ceil(count / 2) * (bubbleHeight + 8) + 96 : h;
  return {
    mode: "narrow",
    width: w,
    height: Math.max(h, Math.round(needed)),
    mascot: { x, y, size },
    ...pts,
    bubbleWidth,
    bubbleHeight,
    slots,
  };
}

/** Point on the bubble edge that faces the mascot: where the pen trail ends. */
export function trailEnd(slot: BubbleSlot, width: number, height: number): Point {
  if (slot.side === "left") return { x: slot.x + width, y: slot.y + height / 2 };
  if (slot.side === "right") return { x: slot.x, y: slot.y + height / 2 };
  return { x: slot.x + width / 2, y: slot.y };
}

/** A gently curved quadratic path from `from` to `to` (SVG "d"). */
export function trailPath(from: Point, to: Point): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // bend upward (perpendicular to the line), proportional to its length
  const bend = Math.min(90, len * 0.22);
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M ${r(from.x)} ${r(from.y)} Q ${r(cx)} ${r(cy)} ${r(to.x)} ${r(to.y)}`;
}

/**
 * Split a formatted value ("124 mmHg", "5.5 h", "4/5", "Yes") into the number and its unit, so the
 * unit can be drawn small and muted. Only a trailing unit the KPI actually has is split off.
 */
export function splitValueUnit(text: string, unit: string | null): { value: string; unit: string } {
  if (!unit) return { value: text, unit: "" };
  const i = text.lastIndexOf(" ");
  if (i <= 0) return { value: text, unit: "" };
  return { value: text.slice(0, i), unit: text.slice(i + 1) };
}
