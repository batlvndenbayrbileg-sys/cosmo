/**
 * Gaze maths for "Cosmo looks at you" (opt-in camera face following). Pure: no DOM, no React, no camera;
 * unit-tested in tests/cosmo.gaze.test.ts.
 *
 * Pipeline, once per detected camera frame (about 12 per second):
 *   face boxes (normalised 0..1 in the RAW camera frame) -> largest face -> its centre, mirrored like a
 *   selfie -> raw gaze in -1..1 -> dead zone -> clamp -> exponential smoothing -> GazeState.gaze.
 * When no face has been seen for FACE_LOST_MS the target becomes the centre and the gaze drifts back.
 *
 * Gaze axes are SCREEN axes as Cosmo is drawn: x -1 = Cosmo looks to the left edge of the screen,
 * +1 = the right edge; y -1 = up, +1 = down. A person who steps to THEIR left appears on the RIGHT of
 * the raw (unmirrored) camera image but is on the LEFT of the screen as they see it, hence the mirror.
 */

export interface Gaze {
  x: number;
  y: number;
}

/** what the renderers read every animation frame; null = no face following (idle look) */
export interface GazeSource {
  readonly current: Gaze | null;
}

/** a detected face, normalised 0..1 to the camera frame (x right, y down), as the camera saw it */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const GAZE_CENTRE: Gaze = Object.freeze({ x: 0, y: 0 });

export interface GazeOptions {
  /** selfie camera: flip x so Cosmo looks where the person is as they see the screen */
  mirror: boolean;
  /** inside this radius (per axis, in -1..1 units) small head jitter maps to 0 */
  deadZone: number;
  /** a face rarely reaches the frame edge: the offset from the centre is multiplied by this */
  gainX: number;
  gainY: number;
  /** where a face "looking straight" usually sits vertically (the webcam is above the screen) */
  centreY: number;
  /** smoothing time constant while a face is seen, ms */
  followMs: number;
  /** after this long without a face the gaze returns to the centre, ms */
  lostAfterMs: number;
  /** smoothing time constant of that return, ms */
  returnMs: number;
}

export const FACE_LOST_MS = 1500;

export const DEFAULT_GAZE_OPTIONS: GazeOptions = {
  mirror: true,
  deadZone: 0.08,
  gainX: 1.6,
  gainY: 1.4,
  centreY: 0.45,
  followMs: 160,
  lostAfterMs: FACE_LOST_MS,
  returnMs: 650,
};

export const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

/** the face with the biggest area; boxes with a non-finite or non-positive size are ignored */
export function largestFace(faces: readonly FaceBox[]): FaceBox | null {
  let best: FaceBox | null = null;
  let bestArea = 0;
  for (const f of faces) {
    if (![f.x, f.y, f.w, f.h].every(Number.isFinite) || f.w <= 0 || f.h <= 0) continue;
    const area = f.w * f.h;
    if (area > bestArea) {
      best = f;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Dead zone that stays continuous: |v| <= dz gives 0, the rest is rescaled so the edge (1) still maps to 1.
 */
export function applyDeadZone(v: number, dz: number): number {
  if (!Number.isFinite(v)) return 0;
  const zone = clamp(dz, 0, 0.95);
  const a = Math.abs(v);
  if (a <= zone) return 0;
  return (Math.sign(v) * (a - zone)) / (1 - zone);
}

/** raw gaze target (dead zone and clamp applied, not smoothed) for one face */
export function faceToGaze(face: FaceBox, opts: GazeOptions = DEFAULT_GAZE_OPTIONS): Gaze {
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const sx = opts.mirror ? 1 - cx : cx;
  const rawX = (sx - 0.5) * 2 * opts.gainX;
  const rawY = (cy - opts.centreY) * 2 * opts.gainY;
  return {
    x: clamp(applyDeadZone(clamp(rawX, -1, 1), opts.deadZone), -1, 1),
    y: clamp(applyDeadZone(clamp(rawY, -1, 1), opts.deadZone), -1, 1),
  };
}

/** frame-rate independent exponential approach: the share of the gap closed after `dtMs` */
export function smoothingFactor(dtMs: number, tauMs: number): number {
  if (!(dtMs > 0)) return 0;
  if (!(tauMs > 0)) return 1;
  return 1 - Math.exp(-dtMs / tauMs);
}

export function lerpGaze(a: Gaze, b: Gaze, k: number): Gaze {
  const t = clamp(k, 0, 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface GazeState {
  /** smoothed gaze, what Cosmo shows */
  gaze: Gaze;
  /** the last raw target */
  target: Gaze;
  /** time of the last frame with a face, ms; null = none yet */
  lastFaceAt: number | null;
  /** time of the previous step, ms; null before the first */
  lastStepAt: number | null;
}

export function initialGazeState(): GazeState {
  return { gaze: { ...GAZE_CENTRE }, target: { ...GAZE_CENTRE }, lastFaceAt: null, lastStepAt: null };
}

/** true while the gaze follows a face; false once it has been lost for `lostAfterMs` (or never seen) */
export function isFollowing(state: GazeState, nowMs: number, opts: GazeOptions = DEFAULT_GAZE_OPTIONS): boolean {
  return state.lastFaceAt !== null && nowMs - state.lastFaceAt < opts.lostAfterMs;
}

/**
 * One detection step. `faces` = every face found in this frame (may be empty). Holds the last target for
 * up to `lostAfterMs` without a face (a blink of the detector must not jerk the eyes), then drifts home.
 */
export function stepGaze(
  state: GazeState,
  faces: readonly FaceBox[],
  nowMs: number,
  opts: GazeOptions = DEFAULT_GAZE_OPTIONS,
): GazeState {
  const dt = state.lastStepAt === null ? 0 : Math.min(Math.max(nowMs - state.lastStepAt, 0), 500);
  const face = largestFace(faces);
  let target = state.target;
  let lastFaceAt = state.lastFaceAt;
  if (face) {
    target = faceToGaze(face, opts);
    lastFaceAt = nowMs;
  }
  const following = lastFaceAt !== null && nowMs - lastFaceAt < opts.lostAfterMs;
  if (!following) target = GAZE_CENTRE;
  // the very first face snaps half way so Cosmo reacts at once, everything after glides
  const k = state.lastStepAt === null && face ? 0.5 : smoothingFactor(dt, following ? opts.followMs : opts.returnMs);
  const gaze = lerpGaze(state.gaze, target, k);
  return {
    gaze: { x: clamp(gaze.x, -1, 1), y: clamp(gaze.y, -1, 1) },
    target: { ...target },
    lastFaceAt,
    lastStepAt: nowMs,
  };
}

// --------------------------------------------------------------------------------------------
// How the gaze is drawn
// --------------------------------------------------------------------------------------------

/** furthest the drawn eyes move, in eye units (1 u = width of the baked-in eye, see image-face.ts) */
export const GAZE_EYE_X_U = 0.17;
export const GAZE_EYE_Y_U = 0.11;

export function gazeEyeShiftU(g: Gaze): { dx: number; dy: number } {
  return { dx: clamp(g.x, -1, 1) * GAZE_EYE_X_U, dy: clamp(g.y, -1, 1) * GAZE_EYE_Y_U };
}

/** whole-mascot lean toward the person: a few degrees and a few px; none with reduced motion */
export const LEAN_MAX_DEG = 3;
export const LEAN_MAX_X_PX = 10;
export const LEAN_MAX_Y_PX = 4;

export interface Lean {
  /** degrees about the feet; negative = the head goes left */
  rotateDeg: number;
  /** image px */
  dx: number;
  dy: number;
}

export const NO_LEAN: Lean = Object.freeze({ rotateDeg: 0, dx: 0, dy: 0 });

export function gazeLean(g: Gaze | null, reduced: boolean): Lean {
  if (!g || reduced) return NO_LEAN;
  const x = clamp(g.x, -1, 1);
  const y = clamp(g.y, -1, 1);
  return { rotateDeg: x * LEAN_MAX_DEG, dx: x * LEAN_MAX_X_PX, dy: y * LEAN_MAX_Y_PX };
}

// --------------------------------------------------------------------------------------------
// Keep the shifted eyes inside the visor
// --------------------------------------------------------------------------------------------

export interface EyeFootprint {
  /** eye centre in px, already including any non-gaze drift */
  cx: number;
  cy: number;
  /** half extents of the drawn eye in px (stroke and scale included) */
  halfW: number;
  halfH: number;
}

/** ray casting point-in-polygon test (same as mascot-poses.ts, duplicated to keep this module dependency-free) */
function inside(x: number, y: number, polygon: readonly (readonly [number, number])[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const RING = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as const);

function outsideCount(
  eyes: readonly EyeFootprint[],
  shiftPx: readonly { dx: number; dy: number }[],
  s: number,
  polygon: readonly (readonly [number, number])[],
): number {
  let n = 0;
  eyes.forEach((e, i) => {
    const ox = e.cx + (shiftPx[i]?.dx ?? 0) * s;
    const oy = e.cy + (shiftPx[i]?.dy ?? 0) * s;
    for (const [c, sn] of RING) if (!inside(ox + c * e.halfW, oy + sn * e.halfH, polygon)) n++;
  });
  return n;
}

/** bisection steps: the scale is found to 1/1024, so the eye offset changes smoothly with the gaze */
const SCALE_STEPS = 10;

/**
 * How much of the wanted gaze shift (0..1) the eyes can take without leaving the visor polygon. The same
 * factor is used for both eyes so they never cross. Sampled on an ellipse around each eye; if the eyes at
 * rest already touch the edge (the clip path hides that), the shift may not make it any worse.
 *
 * Continuous, not a few fixed steps: near the edge the eyes come to rest against it instead of jumping back
 * by a whole step as the gaze moves on outward (bisection between a safe and an unsafe factor).
 */
export function safeGazeScale(
  eyes: readonly EyeFootprint[],
  shiftPx: readonly { dx: number; dy: number }[],
  polygon: readonly (readonly [number, number])[],
): number {
  if (polygon.length < 3 || eyes.length === 0) return 0;
  if (shiftPx.every((p) => p.dx === 0 && p.dy === 0)) return 1;
  const baseline = outsideCount(eyes, shiftPx, 0, polygon);
  if (outsideCount(eyes, shiftPx, 1, polygon) <= baseline) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < SCALE_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (outsideCount(eyes, shiftPx, mid, polygon) <= baseline) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The scale used this frame: it drops to a smaller safe value at once (the eyes never leave the visor) and
 * rises back gently, so detector noise near the edge or an eye-shape change cannot make the eyes flicker.
 */
export function easeGazeScale(current: number, target: number, dtMs: number, tauMs = 120): number {
  if (!(target < current)) return current + (target - current) * smoothingFactor(dtMs, tauMs);
  return target;
}

/** a gaze this close to the centre is the centre (so the per-frame visor test can stop once the camera is off) */
export function settleGaze(g: Gaze, epsilon = 1e-3): Gaze {
  return Math.abs(g.x) < epsilon && Math.abs(g.y) < epsilon ? GAZE_CENTRE : g;
}
