import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAZE_OPTIONS,
  FACE_LOST_MS,
  GAZE_CENTRE,
  GAZE_EYE_X_U,
  GAZE_EYE_Y_U,
  LEAN_MAX_DEG,
  applyDeadZone,
  easeGazeScale,
  faceToGaze,
  gazeEyeShiftU,
  gazeLean,
  initialGazeState,
  isFollowing,
  largestFace,
  lerpGaze,
  safeGazeScale,
  settleGaze,
  smoothingFactor,
  stepGaze,
  type FaceBox,
  type GazeState,
} from "@/components/cosmo/gaze";
import { ImageCosmo } from "@/components/cosmo/ImageCosmo";
import { PlaceholderCosmo } from "@/components/cosmo/PlaceholderCosmo";
import { eyeExtentU, eyeParamsFor } from "@/components/cosmo/image-face";
import { MASCOT_POSES, outlineToPx, poseGeometry } from "@/components/cosmo/mascot-poses";
import { COSMO_EMOTIONS, COSMO_STATES } from "@/components/cosmo/types";

/** a face box whose centre is (cx, cy), normalised */
const faceAt = (cx: number, cy: number, size = 0.2): FaceBox => ({ x: cx - size / 2, y: cy - size / 2, w: size, h: size });
const NO_DZ = { ...DEFAULT_GAZE_OPTIONS, deadZone: 0, gainX: 1, gainY: 1, centreY: 0.5 };

/** run detection steps every `dt` ms with the same faces */
function run(state: GazeState, faces: FaceBox[], fromMs: number, toMs: number, dt = 80, opts = DEFAULT_GAZE_OPTIONS) {
  let s = state;
  for (let t = fromMs; t <= toMs; t += dt) s = stepGaze(s, faces, t, opts);
  return s;
}

describe("largestFace", () => {
  it("picks the biggest box and ignores broken ones", () => {
    const small = faceAt(0.2, 0.5, 0.1);
    const big = faceAt(0.7, 0.5, 0.3);
    expect(largestFace([small, big])).toBe(big);
    expect(largestFace([small, { x: NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0, h: 0.5 }])).toBe(small);
    expect(largestFace([])).toBeNull();
  });
});

describe("faceToGaze: mirroring", () => {
  it("a face centred in the frame means looking straight ahead", () => {
    expect(faceToGaze(faceAt(0.5, 0.5), NO_DZ)).toEqual({ x: 0, y: 0 });
  });

  it("mirrors x like a selfie: a face on the RIGHT of the raw frame is on the LEFT of the screen", () => {
    expect(faceToGaze(faceAt(0.75, 0.5), NO_DZ).x).toBeCloseTo(-0.5, 5);
    expect(faceToGaze(faceAt(0.25, 0.5), NO_DZ).x).toBeCloseTo(0.5, 5);
    // without the mirror the sign flips
    expect(faceToGaze(faceAt(0.75, 0.5), { ...NO_DZ, mirror: false }).x).toBeCloseTo(0.5, 5);
  });

  it("y is not mirrored: a face higher in the frame makes Cosmo look up", () => {
    expect(faceToGaze(faceAt(0.5, 0.25), NO_DZ).y).toBeCloseTo(-0.5, 5);
    expect(faceToGaze(faceAt(0.5, 0.75), NO_DZ).y).toBeCloseTo(0.5, 5);
  });

  it("clamps to -1..1 however far the face is", () => {
    const g = faceToGaze(faceAt(0.02, 0.98, 0.04), { ...NO_DZ, gainX: 5, gainY: 5 });
    expect(g).toEqual({ x: 1, y: 1 });
    const d = faceToGaze(faceAt(0.98, 0.02, 0.04));
    expect(d.x).toBeGreaterThanOrEqual(-1);
    expect(d.y).toBeGreaterThanOrEqual(-1);
  });
});

describe("dead zone", () => {
  it("small offsets map to exactly 0, larger ones are rescaled continuously", () => {
    expect(applyDeadZone(0.05, 0.08)).toBe(0);
    expect(applyDeadZone(-0.08, 0.08)).toBe(0);
    expect(applyDeadZone(0.09, 0.08)).toBeGreaterThan(0);
    expect(applyDeadZone(0.09, 0.08)).toBeLessThan(0.02);
    expect(applyDeadZone(1, 0.08)).toBeCloseTo(1, 10);
    expect(applyDeadZone(-1, 0.08)).toBeCloseTo(-1, 10);
    expect(applyDeadZone(NaN, 0.08)).toBe(0);
  });

  it("head jitter around the centre does not move the eyes", () => {
    const opts = DEFAULT_GAZE_OPTIONS;
    for (const dx of [-0.02, -0.01, 0, 0.01, 0.02]) {
      expect(faceToGaze(faceAt(0.5 + dx, opts.centreY + dx), opts)).toEqual({ x: 0, y: 0 });
    }
  });
});

describe("smoothing", () => {
  it("the factor is frame-rate independent and bounded", () => {
    expect(smoothingFactor(0, 100)).toBe(0);
    expect(smoothingFactor(100, 0)).toBe(1);
    const once = smoothingFactor(160, 160);
    const twice = 1 - (1 - smoothingFactor(80, 160)) ** 2;
    expect(twice).toBeCloseTo(once, 10);
    expect(lerpGaze({ x: 0, y: 0 }, { x: 1, y: -1 }, 2)).toEqual({ x: 1, y: -1 });
  });

  it("the gaze glides toward the face instead of jumping, and gets there", () => {
    const face = [faceAt(0.2, 0.45)]; // left in the raw frame -> right on the screen
    let s = stepGaze(initialGazeState(), face, 0);
    const target = s.target.x;
    expect(target).toBeGreaterThan(0.5);
    // the very first face snaps half way
    expect(s.gaze.x).toBeCloseTo(target / 2, 5);
    s = stepGaze(s, face, 80);
    expect(s.gaze.x).toBeGreaterThan(target / 2);
    expect(s.gaze.x).toBeLessThan(target);
    s = run(s, face, 160, 2000);
    expect(s.gaze.x).toBeCloseTo(target, 3);
    expect(isFollowing(s, 2000)).toBe(true);
  });

  it("never leaves -1..1", () => {
    let s = initialGazeState();
    for (let t = 0; t < 3000; t += 70) s = stepGaze(s, [faceAt(t % 140 === 0 ? 0.01 : 0.99, 0.01, 0.02)], t);
    expect(Math.abs(s.gaze.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.gaze.y)).toBeLessThanOrEqual(1);
  });
});

describe("no face: hold, then return to the centre", () => {
  it("holds the last target for a moment (a missed detection must not jerk the eyes)", () => {
    const face = [faceAt(0.15, 0.45)];
    let s = run(initialGazeState(), face, 0, 1600);
    const held = s.gaze.x;
    s = run(s, [], 1680, 1680 + FACE_LOST_MS - 200);
    expect(s.gaze.x).toBeCloseTo(held, 2);
    expect(isFollowing(s, 1680 + FACE_LOST_MS - 200)).toBe(true);
  });

  it("after ~1.5 s without a face the gaze drifts back to the centre", () => {
    const face = [faceAt(0.15, 0.2)];
    let s = run(initialGazeState(), face, 0, 1600);
    expect(Math.abs(s.gaze.x)).toBeGreaterThan(0.5);
    const lostAt = 1600 + FACE_LOST_MS + 80;
    s = run(s, [], 1680, lostAt);
    expect(isFollowing(s, lostAt)).toBe(false);
    const justAfter = Math.abs(s.gaze.x);
    s = run(s, [], lostAt + 80, lostAt + 4000);
    expect(Math.abs(s.gaze.x)).toBeLessThan(justAfter);
    expect(Math.abs(s.gaze.x)).toBeLessThan(0.01);
    expect(Math.abs(s.gaze.y)).toBeLessThan(0.01);
  });

  it("a face that comes back is followed again", () => {
    let s = run(initialGazeState(), [], 0, 3000);
    expect(s.gaze).toEqual({ x: 0, y: 0 });
    s = run(s, [faceAt(0.85, 0.45)], 3080, 5000);
    expect(s.gaze.x).toBeLessThan(-0.5);
  });
});

describe("drawing the gaze", () => {
  it("eye shift and lean scale with the gaze and are clamped", () => {
    expect(gazeEyeShiftU({ x: 1, y: -1 })).toEqual({ dx: GAZE_EYE_X_U, dy: -GAZE_EYE_Y_U });
    expect(gazeEyeShiftU({ x: 5, y: 0 }).dx).toBe(GAZE_EYE_X_U);
    const lean = gazeLean({ x: -1, y: 0 }, false);
    expect(lean.rotateDeg).toBe(-LEAN_MAX_DEG);
    expect(lean.dx).toBeLessThan(0);
    expect(Math.abs(gazeLean({ x: 0.5, y: 0.5 }, false).rotateDeg)).toBeLessThanOrEqual(LEAN_MAX_DEG);
  });

  it("no lean with reduced motion or without a gaze (the eyes still follow: gazeEyeShiftU has no reduced flag)", () => {
    expect(gazeLean({ x: 1, y: 1 }, true)).toEqual({ rotateDeg: 0, dx: 0, dy: 0 });
    expect(gazeLean(null, false)).toEqual({ rotateDeg: 0, dx: 0, dy: 0 });
  });
});

describe("safeGazeScale: the eyes stay inside the visor", () => {
  const square: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];

  it("allows the full shift when there is room and scales it down near the edge", () => {
    const eye = [{ cx: 50, cy: 50, halfW: 10, halfH: 10 }];
    expect(safeGazeScale(eye, [{ dx: 20, dy: 0 }], square)).toBe(1);
    const nearEdge = [{ cx: 80, cy: 50, halfW: 10, halfH: 10 }];
    const s = safeGazeScale(nearEdge, [{ dx: 20, dy: 0 }], square);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
    expect(80 + 20 * s + 10).toBeLessThanOrEqual(100);
    expect(safeGazeScale(eye, [{ dx: 0, dy: 0 }], square)).toBe(1);
  });

  it("is continuous: as the gaze moves outward the eye comes to rest at the edge, never jumps back", () => {
    let lastX = -Infinity;
    for (let shift = 0; shift <= 40; shift += 0.5) {
      const s = safeGazeScale([{ cx: 70, cy: 50, halfW: 10, halfH: 10 }], [{ dx: shift, dy: 0 }], square);
      const x = 70 + shift * s;
      expect(x + 10).toBeLessThanOrEqual(100);
      // never moves back by more than a hair
      expect(x).toBeGreaterThanOrEqual(lastX - 0.1);
      lastX = Math.max(lastX, x);
    }
    expect(lastX).toBeGreaterThan(89);
  });

  it("the applied scale drops at once and rises gently; a gaze near the centre settles on it", () => {
    expect(easeGazeScale(1, 0.6, 16)).toBe(0.6);
    const up = easeGazeScale(0.6, 1, 16);
    expect(up).toBeGreaterThan(0.6);
    expect(up).toBeLessThan(1);
    expect(settleGaze({ x: 0.0004, y: -0.0002 })).toEqual(GAZE_CENTRE);
    expect(settleGaze({ x: 0.2, y: 0 })).toEqual({ x: 0.2, y: 0 });
  });

  for (const id of Object.keys(MASCOT_POSES) as (keyof typeof MASCOT_POSES)[]) {
    it(`${id} render: every state / emotion and every gaze direction keeps both eyes on the glass`, () => {
      const pose = MASCOT_POSES[id];
      const geo = poseGeometry(pose);
      const visor = outlineToPx(pose);
      let shifted = 0;
      for (const state of COSMO_STATES) {
        for (const emotion of COSMO_EMOTIONS) {
          const p = eyeParamsFor(state, emotion);
          const ext = eyeExtentU(p);
          for (const gx of [-1, -0.5, 0, 0.5, 1]) {
            for (const gy of [-1, 0, 1]) {
              const shiftU = gazeEyeShiftU({ x: gx, y: gy });
              const eyes = geo.eyes.map((e) => ({
                cx: e.cx + p.dx * e.u,
                cy: e.cy + p.dy * e.u,
                halfW: ext.halfW * e.u,
                halfH: ext.halfH * e.u,
              }));
              const shifts = geo.eyes.map((e) => ({ dx: shiftU.dx * e.u, dy: shiftU.dy * e.u }));
              const s = safeGazeScale(eyes, shifts, visor);
              expect(s).toBeGreaterThanOrEqual(0);
              expect(s).toBeLessThanOrEqual(1);
              if (s > 0 && (gx !== 0 || gy !== 0)) shifted++;
              // the centre of every shifted eye is still on the visor
              eyes.forEach((e, i) => {
                const x = e.cx + shifts[i].dx * s;
                const y = e.cy + shifts[i].dy * s;
                const xs = visor.map(([vx]) => vx);
                const ys = visor.map(([, vy]) => vy);
                expect(x).toBeGreaterThan(Math.min(...xs));
                expect(x).toBeLessThan(Math.max(...xs));
                expect(y).toBeGreaterThan(Math.min(...ys));
                expect(y).toBeLessThan(Math.max(...ys));
              });
            }
          }
        }
      }
      // and the eyes really do move in most cases
      expect(shifted).toBeGreaterThan(COSMO_STATES.length * COSMO_EMOTIONS.length * 10);
    });
  }
});

describe("renderers accept a gaze source", () => {
  it("ImageCosmo and PlaceholderCosmo render the same markup with or without one (the loop applies it)", () => {
    const gaze = { current: { x: 0.6, y: -0.3 } };
    const base = { variant: 0, state: "listening", emotion: "happy", amplitude: 0, size: 200 } as const;
    expect(renderToStaticMarkup(createElement(ImageCosmo, { ...base, gaze }))).toBe(
      renderToStaticMarkup(createElement(ImageCosmo, base)),
    );
    expect(renderToStaticMarkup(createElement(PlaceholderCosmo, { ...base, gaze }))).toBe(
      renderToStaticMarkup(createElement(PlaceholderCosmo, base)),
    );
  });
});
