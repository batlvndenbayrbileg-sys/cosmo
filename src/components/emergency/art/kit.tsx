import type { ReactNode } from "react";

/**
 * Drawing kit for the step illustrations: soft, rounded line figures in the app's glass style. Every limb is a
 * capsule (a thick white stroke inside a thin ink outline); the person being helped is white, the helper pastel blue.
 * All art uses one 240 x 180 canvas with the floor at y = 150. No bitmaps.
 */

export type Tone = "patient" | "helper";

const TONES: Record<Tone, { fill: string; line: string }> = {
  patient: { fill: "#ffffff", line: "var(--cosmo-ink)" },
  helper: { fill: "var(--cosmo-pastel-blue)", line: "var(--cosmo-accent-deep)" },
};

export const INK = "var(--cosmo-ink)";
export const ACCENT = "var(--cosmo-accent)";
export const ACCENT_DEEP = "var(--cosmo-accent-deep)";
export const ALERT = "#C53030";
export const FLOOR_Y = 150;

/** the canvas: transparent, with a soft halo and the floor line */
export function Canvas({ children, floor = true }: { children: ReactNode; floor?: boolean }) {
  return (
    <svg
      viewBox="0 0 240 180"
      aria-hidden="true"
      focusable="false"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="120" cy="96" rx="104" ry="70" fill="#ffffff" opacity="0.55" />
      {floor ? <path d={`M18 ${FLOOR_Y} H222`} stroke={INK} strokeOpacity="0.14" strokeWidth="2" /> : null}
      {children}
    </svg>
  );
}

/** one limb or the torso: a white capsule along `d` with an ink outline */
export function Limb({ d, tone = "patient", w = 11 }: { d: string; tone?: Tone; w?: number }) {
  const c = TONES[tone];
  return (
    <g>
      <path d={d} stroke={c.line} strokeWidth={w + 3.2} />
      <path d={d} stroke={c.fill} strokeWidth={w} />
    </g>
  );
}

export function Head({ cx, cy, r = 11, tone = "patient" }: { cx: number; cy: number; r?: number; tone?: Tone }) {
  const c = TONES[tone];
  return <circle cx={cx} cy={cy} r={r} fill={c.fill} stroke={c.line} strokeWidth="1.8" />;
}

/** a soft cushion / pad / block */
export function Pad({ x, y, w, h, fill = "var(--cosmo-pastel-lilac)" }: { x: number; y: number; w: number; h: number; fill?: string }) {
  return <rect x={x} y={y} width={w} height={h} rx={Math.min(h, w) / 2.4} fill={fill} stroke={INK} strokeOpacity="0.35" strokeWidth="1.5" />;
}

/** an action arrow (direction of a push, a pull, a move) */
export function Arrow({ d, color = ACCENT }: { d: string; color?: string }) {
  return (
    <g stroke={color} strokeWidth="3">
      <path d={d} />
      <ArrowHead d={d} color={color} />
    </g>
  );
}

/** a small arrow head at the end of a straight "M x y L x y" segment */
function ArrowHead({ d, color }: { d: string; color: string }) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 4) return null;
  const [x1, y1, x2, y2] = nums.slice(-4);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const l = 8;
  const p = (da: number) => `${x2 - l * Math.cos(a + da)} ${y2 - l * Math.sin(a + da)}`;
  return <path d={`M${p(0.5)} L${x2} ${y2} L${p(-0.5)}`} stroke={color} strokeWidth="3" />;
}

/** "don't": a red circle with a bar over something */
export function NoSign({ cx, cy, r = 20 }: { cx: number; cy: number; r?: number }) {
  const k = r * 0.7;
  return (
    <g stroke={ALERT} strokeWidth="4">
      <circle cx={cx} cy={cy} r={r} />
      <path d={`M${cx - k} ${cy - k} L${cx + k} ${cy + k}`} />
    </g>
  );
}

/** short curved lines: breath, sound, air */
export function Waves({ x, y, color = ACCENT, flip = false }: { x: number; y: number; color?: string; flip?: boolean }) {
  const s = flip ? -1 : 1;
  return (
    <g stroke={color} strokeWidth="2.6" opacity="0.85">
      <path d={`M${x} ${y - 8} q${6 * s} 8 0 16`} />
      <path d={`M${x + 8 * s} ${y - 13} q${9 * s} 13 0 26`} />
    </g>
  );
}

/**
 * A person lying on the back, head on the left. legs: flat, raised on a cushion, or knees bent. x is the head centre;
 * the body rests on the floor.
 */
export function LyingPerson({ x = 52, legs = "flat", tone = "patient" }: { x?: number; legs?: "flat" | "raised" | "bent"; tone?: Tone }) {
  const y = FLOOR_Y - 9;
  const hip = x + 78;
  const legPath =
    legs === "raised"
      ? `M${hip} ${y} L${hip + 36} ${y - 26} L${hip + 70} ${y - 30}`
      : legs === "bent"
        ? `M${hip} ${y} L${hip + 28} ${y - 30} L${hip + 52} ${y}`
        : `M${hip} ${y} L${hip + 72} ${y + 1}`;
  return (
    <g>
      {legs === "raised" ? <Pad x={hip + 30} y={y - 24} w={46} h={30} /> : null}
      <Limb d={legPath} tone={tone} w={12} />
      <Limb d={`M${x + 16} ${y - 2} L${hip} ${y}`} tone={tone} w={20} />
      <Limb d={`M${x + 24} ${y + 3} L${x + 64} ${y + 4}`} tone={tone} w={8} />
      <Head cx={x} cy={y - 4} tone={tone} />
    </g>
  );
}
