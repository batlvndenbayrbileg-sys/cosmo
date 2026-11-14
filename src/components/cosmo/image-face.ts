/**
 * Pure maths for ImageCosmo (the team's PNG render with a drawn face on its visor). No DOM, no
 * React: unit-tested in tests/cosmo.image.test.ts.
 *
 * Eye shapes are expressed in "eye units": 1 u = the width of the baked-in eye of the current pose,
 * so the same numbers fit the front render and the narrower far eye of the three-quarter render.
 */
import { clampAmplitude } from "./amplitude";
import type { MascotPoseId, MascotPose } from "./mascot-poses";
import type { CosmoEmotion, CosmoState } from "./types";
import { variantFor } from "./variants";

// --------------------------------------------------------------------------------------------
// Which render to show
// --------------------------------------------------------------------------------------------

/**
 * Greeting, talking and happy use the front render (arm raised, biggest visor); idle, listening,
 * thinking use the calmer three-quarter render.
 */
export function targetPoseFor(state: CosmoState, emotion: CosmoEmotion): MascotPoseId {
  return state === "talking" || emotion === "happy" ? "front" : "three-quarter";
}

export function resolvePoseChoice(
  choice: MascotPoseId | "auto" | undefined,
  state: CosmoState,
  emotion: CosmoEmotion,
): MascotPoseId {
  if (choice === "front" || choice === "three-quarter") return choice;
  return targetPoseFor(state, emotion);
}

/** A pose stays on screen at least this long, so state flicker does not make Cosmo flip back and forth. */
export const POSE_MIN_DWELL_MS = 700;

export function nextDisplayedPose(
  displayed: MascotPoseId,
  target: MascotPoseId,
  msSinceSwitch: number,
  minDwellMs = POSE_MIN_DWELL_MS,
): MascotPoseId {
  if (displayed === target) return displayed;
  return msSinceSwitch >= minDwellMs ? target : displayed;
}

// --------------------------------------------------------------------------------------------
// Colour: the same hue rotation the browser applies, so the overlay matches the rotated render
// --------------------------------------------------------------------------------------------

/** The 3x3 matrix of CSS hue-rotate() / SVG feColorMatrix type="hueRotate" (Filter Effects spec). */
export function hueRotateMatrix(deg: number): number[][] {
  const a = ((Number.isFinite(deg) ? deg : 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
  ];
}

const HEX6 = /^#([0-9a-f]{6})$/i;

/** Rotates the hue of "#RRGGBB" by `deg` with the browser's own matrix. Anything else is returned unchanged. */
export function applyHueRotate(hex: string, deg: number): string {
  const m = HEX6.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mat = hueRotateMatrix(deg);
  const out = mat.map((row) => {
    const v = Math.round(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
    return Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0");
  });
  return `#${out.join("").toUpperCase()}`;
}

export interface MascotNeon {
  hueDeg: number;
  /** gradient of each drawn eye, cyan end to violet end, already hue-rotated for the variant */
  eyes: readonly [{ from: string; to: string }, { from: string; to: string }];
  mouth: { from: string; to: string };
  collar: string;
  ear: string;
}

export function mascotNeon(variant: number, pose: Pick<MascotPose, "eyeEnds" | "collar" | "earLeft">): MascotNeon {
  const hueDeg = variantFor(variant).hueDeg;
  const rot = (hex: string) => applyHueRotate(hex, hueDeg);
  const [l, r] = pose.eyeEnds;
  return {
    hueDeg,
    eyes: [
      { from: rot(l.from), to: rot(l.to) },
      { from: rot(r.from), to: rot(r.to) },
    ],
    mouth: { from: rot(l.from), to: rot(r.to) },
    collar: rot(pose.collar.color),
    ear: rot(pose.earLeft?.color ?? "#7493EC"),
  };
}

// --------------------------------------------------------------------------------------------
// Eyes
// --------------------------------------------------------------------------------------------

/**
 * One eye is a stroked quadratic curve with round caps. A long curved stroke reads as a happy arc
 * (like the render), a very short thick stroke squashed vertically reads as a soft oval, so every
 * emotion is the same kind of shape with different numbers and can be blended frame by frame.
 * Units: eye widths. y grows downward, the eye is centred on (0, 0).
 */
export interface EyeShape {
  /** half length of the chord between the two ends */
  halfW: number;
  /** y of both ends */
  endY: number;
  /** y of the control point (the apex of the curve sits half way between endY and ctrlY) */
  ctrlY: number;
  strokeW: number;
  /** vertical stretch, makes ovals taller than wide */
  scaleY: number;
  /** outer corner down, degrees (mirrored for the right eye) */
  tiltDeg: number;
  /** a short brow above the eye, inner end raised by tiltDeg; 0 = none */
  browOpacity: number;
}

export const EYE_SHAPES: Record<CosmoEmotion, EyeShape> = {
  // arcs like the render: stroke 0.235 u, ends 0.3825 u from the centre, apex 0.1325 u above centre
  happy: { halfW: 0.3825, endY: 0.1325, ctrlY: -0.3975, strokeW: 0.235, scaleY: 1, tiltDeg: 0, browOpacity: 0 },
  neutral: { halfW: 0.02, endY: 0, ctrlY: 0, strokeW: 0.46, scaleY: 1.25, tiltDeg: 0, browOpacity: 0 },
  concerned: { halfW: 0.02, endY: 0.02, ctrlY: 0.02, strokeW: 0.42, scaleY: 1.15, tiltDeg: 13, browOpacity: 0.9 },
};

export function eyeShapeFor(emotion: CosmoEmotion): EyeShape {
  return EYE_SHAPES[emotion] ?? EYE_SHAPES.neutral;
}

export interface EyeMods {
  scale: number;
  /** drift in eye units (x right, y down) */
  dx: number;
  dy: number;
}

/** listening: slightly bigger eyes; thinking: eyes drift up and to the left, a touch smaller */
export function eyeModsFor(state: CosmoState): EyeMods {
  switch (state) {
    case "listening":
      return { scale: 1.12, dx: 0, dy: 0 };
    case "thinking":
      return { scale: 0.96, dx: -0.07, dy: -0.1 };
    default:
      return { scale: 1, dx: 0, dy: 0 };
  }
}

export type EyeParams = EyeShape & EyeMods;

export function eyeParamsFor(state: CosmoState, emotion: CosmoEmotion): EyeParams {
  return { ...eyeShapeFor(emotion), ...eyeModsFor(state) };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpEye(a: EyeParams, b: EyeParams, t: number): EyeParams {
  const k = Math.min(1, Math.max(0, t));
  return {
    halfW: lerp(a.halfW, b.halfW, k),
    endY: lerp(a.endY, b.endY, k),
    ctrlY: lerp(a.ctrlY, b.ctrlY, k),
    strokeW: lerp(a.strokeW, b.strokeW, k),
    scaleY: lerp(a.scaleY, b.scaleY, k),
    tiltDeg: lerp(a.tiltDeg, b.tiltDeg, k),
    browOpacity: lerp(a.browOpacity, b.browOpacity, k),
    scale: lerp(a.scale, b.scale, k),
    dx: lerp(a.dx, b.dx, k),
    dy: lerp(a.dy, b.dy, k),
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Half extents of the drawn eye in eye units (stroke, scale and vertical stretch included, tilt ignored):
 * what has to stay inside the visor when the eyes follow a face.
 */
export function eyeExtentU(
  p: Pick<EyeParams, "halfW" | "endY" | "ctrlY" | "strokeW" | "scale" | "scaleY">,
): { halfW: number; halfH: number } {
  const apex = (p.endY + p.ctrlY) / 2;
  return {
    halfW: (p.halfW + p.strokeW / 2) * p.scale,
    halfH: (Math.max(Math.abs(apex), Math.abs(p.endY)) + p.strokeW / 2) * p.scale * p.scaleY,
  };
}

/** SVG path of an eye in pixels, centred on (0, 0); `u` = eye width in px */
export function eyePath(shape: Pick<EyeShape, "halfW" | "endY" | "ctrlY">, u: number): string {
  const hw = shape.halfW * u;
  const ey = shape.endY * u;
  const cy = shape.ctrlY * u;
  return `M${r2(-hw)} ${r2(ey)}Q0 ${r2(cy)} ${r2(hw)} ${r2(ey)}`;
}

/** short brow above an eye, in px, centred on (0, 0) of the eye group */
export function browPath(u: number): string {
  return `M${r2(-0.3 * u)} ${r2(-0.62 * u)}L${r2(0.3 * u)} ${r2(-0.62 * u)}`;
}

/** transform of one eye group: `side` -1 = left eye, +1 = right eye (mirrors the tilt) */
export function eyeTransform(
  cx: number,
  cy: number,
  u: number,
  p: Pick<EyeParams, "scale" | "dx" | "dy" | "scaleY" | "tiltDeg">,
  side: -1 | 1,
  closure: number,
): string {
  const closed = Math.min(1, Math.max(0, closure));
  const sy = p.scale * p.scaleY * (1 - 0.92 * closed);
  const tilt = side === -1 ? -p.tiltDeg : p.tiltDeg;
  return (
    `translate(${r2(cx + p.dx * u)} ${r2(cy + p.dy * u)}) rotate(${r2(tilt)}) ` + `scale(${r2(p.scale)} ${r2(sy)})`
  );
}

// --------------------------------------------------------------------------------------------
// Mouth
// --------------------------------------------------------------------------------------------

export interface MouthLook {
  /** width of the closed mouth, eye units */
  widthU: number;
  /** how far the middle sits below the corners (negative = a frown), eye units */
  smileU: number;
}

export const MOUTH_LOOKS: Record<CosmoEmotion, MouthLook> = {
  neutral: { widthU: 0.4, smileU: 0.06 },
  happy: { widthU: 0.5, smileU: 0.12 },
  concerned: { widthU: 0.32, smileU: -0.04 },
};

export function mouthLookFor(emotion: CosmoEmotion): MouthLook {
  return MOUTH_LOOKS[emotion] ?? MOUTH_LOOKS.neutral;
}

/** deepest opening, eye units */
export const MOUTH_MAX_OPEN_U = 0.3;

export function lerpMouth(a: MouthLook, b: MouthLook, t: number): MouthLook {
  return { widthU: lerp(a.widthU, b.widthU, t), smileU: lerp(a.smileU, b.smileU, t) };
}

/**
 * Mouth path in px, corners on y = 0, centred on x = 0. `open` is 0..1. At 0 it is a single curve
 * (the stroke draws it); above 0 the lower lip drops and the corners draw in a little.
 */
export function glowMouthPath(look: MouthLook, open: number, u: number): string {
  const o = clampAmplitude(open);
  const w = look.widthU * u * (1 - 0.16 * o);
  const x0 = -w / 2;
  const x1 = w / 2;
  const top = 2 * look.smileU * u;
  const bottom = top + 2 * o * MOUTH_MAX_OPEN_U * u;
  return `M${r2(x0)} 0Q0 ${r2(top)} ${r2(x1)} 0Q0 ${r2(bottom)} ${r2(x0)} 0Z`;
}

// --------------------------------------------------------------------------------------------
// Glows and body motion
// --------------------------------------------------------------------------------------------

/** 0..1, starts at 0, one full cycle per `periodMs` */
export function wave01(tMs: number, periodMs: number): number {
  if (!Number.isFinite(tMs) || !(periodMs > 0)) return 0;
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * tMs) / periodMs);
}

export const EAR_PULSE_MS = 1600;
export const COLLAR_PULSE_MS = 2600;

/** opacity of the ear-ring glow overlay: pulses while listening, steady (not pulsing) with reduced motion */
export function earGlowTarget(state: CosmoState, reduced: boolean, tMs: number): number {
  if (state !== "listening") return 0;
  return reduced ? 0.7 : 0.25 + 0.75 * wave01(tMs, EAR_PULSE_MS);
}

/** opacity of the collar glow overlay: slow pulse while thinking */
export function collarGlowTarget(state: CosmoState, reduced: boolean, tMs: number): number {
  if (state !== "thinking") return 0;
  return reduced ? 0.6 : 0.2 + 0.8 * wave01(tMs, COLLAR_PULSE_MS);
}

/** listening: a tiny attentive tilt, degrees (a pose, so it stays with reduced motion) */
export function tiltTargetFor(state: CosmoState): number {
  return state === "listening" ? 2.4 : 0;
}

export const FLOAT_PX = 4;
export const FLOAT_PERIOD_MS = 3800;
export const BREATH_PERIOD_MS = 4200;

/** gentle vertical float in image px (negative = up); none with reduced motion */
export function floatOffset(tMs: number, reduced: boolean): number {
  if (reduced || !Number.isFinite(tMs)) return 0;
  return -FLOAT_PX * (0.5 - 0.5 * Math.cos((2 * Math.PI * tMs) / FLOAT_PERIOD_MS));
}

/** breathing scale about the feet: 1 .. 1.012 while idle, exactly 1 otherwise or with reduced motion */
export function breathScale(tMs: number, state: CosmoState, reduced: boolean): number {
  if (reduced || state !== "idle" || !Number.isFinite(tMs)) return 1;
  return 1 + 0.012 * wave01(tMs, BREATH_PERIOD_MS);
}
