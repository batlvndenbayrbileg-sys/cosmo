import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { CosmoConfigProvider, useCosmoConfig } from "@/components/cosmo/CosmoConfig";
import { ImageCosmo } from "@/components/cosmo/ImageCosmo";
import { resolveImplementation } from "@/components/cosmo/implementation";
import {
  BREATH_PERIOD_MS,
  COLLAR_PULSE_MS,
  EAR_PULSE_MS,
  EYE_SHAPES,
  FLOAT_PERIOD_MS,
  FLOAT_PX,
  MOUTH_LOOKS,
  MOUTH_MAX_OPEN_U,
  POSE_MIN_DWELL_MS,
  applyHueRotate,
  breathScale,
  browPath,
  collarGlowTarget,
  earGlowTarget,
  eyeModsFor,
  eyeParamsFor,
  eyePath,
  eyeShapeFor,
  eyeTransform,
  floatOffset,
  glowMouthPath,
  hueRotateMatrix,
  lerpEye,
  mascotNeon,
  mouthLookFor,
  nextDisplayedPose,
  resolvePoseChoice,
  targetPoseFor,
  tiltTargetFor,
  wave01,
} from "@/components/cosmo/image-face";
import {
  MASCOT_POSES,
  MASCOT_POSE_IDS,
  boxToPx,
  mascotPose,
  outlinePoints,
  outlineToPx,
  pointInPolygon,
  poseGeometry,
  type MascotPose,
  type NormBox,
} from "@/components/cosmo/mascot-poses";
import { COSMO_EMOTIONS, COSMO_STATES } from "@/components/cosmo/types";
import { VARIANTS, variantFor } from "@/components/cosmo/variants";

// the provider's props type demands `children`; React.createElement takes children as arguments
const Provider = CosmoConfigProvider as unknown as ComponentType<{
  rive: boolean;
  mascotMode?: "image" | "placeholder";
  faceOverlay?: boolean;
}>;

const poses = MASCOT_POSE_IDS.map((id) => MASCOT_POSES[id]);

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
const HEX = /^#[0-9A-F]{6}$/i;

function inside01(b: Pick<NormBox, "x" | "y" | "w" | "h">) {
  return b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1 && b.y + b.h <= 1;
}
function corners(b: Pick<NormBox, "x" | "y" | "w" | "h">): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
}

describe("mascot pose measurements", () => {
  it.each(poses.map((p) => [p.id, p] as const))("%s: everything is normalised and inside the image", (_id, pose) => {
    const { visor } = pose;
    expect(visor.cx).toBeGreaterThan(0);
    expect(visor.cx).toBeLessThan(1);
    expect(visor.cy).toBeGreaterThan(0);
    expect(visor.cy).toBeLessThan(1);
    expect(visor.cx - visor.rx).toBeGreaterThan(0);
    expect(visor.cx + visor.rx).toBeLessThan(1);
    expect(visor.cy - visor.ry).toBeGreaterThan(0);
    expect(visor.cy + visor.ry).toBeLessThan(1);
    expect(Math.abs(visor.rotationDeg)).toBeLessThanOrEqual(45);
    expect(visor.fitIoU).toBeGreaterThan(0.9);
    expect(visor.outline).toHaveLength(36);
    for (const [x, y] of visor.outline) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
    const parts: (NormBox | null)[] = [...pose.eyes, pose.earLeft, pose.earRight, pose.collar, pose.footLeft, pose.footRight];
    for (const b of parts) if (b) expect(inside01(b)).toBe(true);
  });

  it.each(poses.map((p) => [p.id, p] as const))("%s: the visor ellipse and the outline describe the same shape", (_id, pose) => {
    const { visor } = pose;
    // the centre of the fitted ellipse is inside the measured outline, and every outline point lies
    // close to the ellipse (the glass of a three-quarter view is egg shaped, so allow some slack)
    expect(pointInPolygon(visor.cx, visor.cy, visor.outline)).toBe(true);
    const rot = (visor.rotationDeg * Math.PI) / 180;
    for (const [x, y] of visor.outline) {
      const dx = (x - visor.cx) * pose.width;
      const dy = (y - visor.cy) * pose.height;
      const u = (dx * Math.cos(rot) + dy * Math.sin(rot)) / (visor.rx * pose.width);
      const v = (-dx * Math.sin(rot) + dy * Math.cos(rot)) / (visor.ry * pose.height);
      expect(Math.hypot(u, v)).toBeGreaterThan(0.8);
      expect(Math.hypot(u, v)).toBeLessThan(1.2);
    }
  });

  it.each(poses.map((p) => [p.id, p] as const))("%s: both baked-in eyes sit inside the visor, left to right", (_id, pose) => {
    const [left, right] = pose.eyes;
    for (const eye of pose.eyes) {
      for (const [x, y] of corners(eye)) expect(pointInPolygon(x, y, pose.visor.outline)).toBe(true);
    }
    expect(left.x + left.w).toBeLessThan(right.x);
    // the eyes share one eye line
    expect(Math.abs(left.y + left.h / 2 - (right.y + right.h / 2))).toBeLessThan(0.02);
    // and their glow patch (see EYE_GLOW_PAD) stays near the glass
    const g = poseGeometry(pose);
    for (const p of g.patches) {
      expect(pointInPolygon(p.cx / pose.width, p.cy / pose.height, pose.visor.outline)).toBe(true);
    }
  });

  it("the front pose is symmetric: the eyes are centred on the visor", () => {
    const f = MASCOT_POSES.front;
    const mid = (f.eyes[0].x + f.eyes[0].w / 2 + f.eyes[1].x + f.eyes[1].w / 2) / 2;
    expect(Math.abs(mid - f.visor.cx)).toBeLessThan(0.02);
    expect(Math.abs(f.eyes[0].w - f.eyes[1].w)).toBeLessThan(0.01);
  });

  it.each(poses.map((p) => [p.id, p] as const))("%s: the neon parts are where the body says they are", (_id, pose) => {
    const cx = pose.visor.cx;
    const vTop = pose.visor.cy - pose.visor.ry;
    const vBottom = pose.visor.cy + pose.visor.ry;
    expect(pose.earLeft).not.toBeNull();
    const earL = pose.earLeft as NormBox;
    expect(earL.x + earL.w / 2).toBeLessThan(cx - 0.15);
    if (pose.earRight) expect(pose.earRight.x + pose.earRight.w / 2).toBeGreaterThan(cx + 0.15);
    // ear rings at head height
    expect(earL.y).toBeGreaterThan(vTop - 0.08);
    expect(earL.y + earL.h).toBeLessThan(vBottom + 0.1);
    // collar under the head, feet at the bottom, both under the visor
    expect(pose.collar.y).toBeGreaterThan(vBottom);
    expect(pose.footLeft.y).toBeGreaterThan(pose.collar.y + 0.2);
    expect(pose.footRight.y).toBeGreaterThan(pose.collar.y + 0.2);
    expect(pose.footLeft.x + pose.footLeft.w).toBeLessThan(pose.footRight.x + 0.0001);
    expect(Math.abs(pose.collar.x + pose.collar.w / 2 - cx)).toBeLessThan(0.1);
  });

  it.each(poses.map((p) => [p.id, p] as const))("%s: colours are valid; the glass is dark and gets lighter toward the top", (_id, pose) => {
    expect(pose.visor.darkColor).toMatch(HEX);
    expect(luminance(pose.visor.darkColor)).toBeLessThan(60);
    const [top, mid, bottom] = pose.visor.glass;
    for (const stop of pose.visor.glass) {
      expect(stop.color).toMatch(HEX);
      expect(luminance(stop.color)).toBeLessThan(60);
    }
    expect(top.y).toBeLessThan(mid.y);
    expect(mid.y).toBeLessThan(bottom.y);
    // the three stops bracket the eye line (the gradient must cover the baked-in eyes)
    const eyeTop = Math.min(...pose.eyes.map((e) => e.y));
    const eyeBottom = Math.max(...pose.eyes.map((e) => e.y + e.h));
    expect(top.y).toBeLessThan(eyeTop);
    expect(bottom.y).toBeGreaterThan(eyeBottom);
    expect(luminance(top.color)).toBeGreaterThanOrEqual(luminance(bottom.color));
    for (const e of pose.eyeEnds) {
      expect(e.from).toMatch(HEX);
      expect(e.to).toMatch(HEX);
      // cyan end: green and blue dominate; violet end: red and blue dominate
      const f = parseInt(e.from.slice(1), 16);
      const t = parseInt(e.to.slice(1), 16);
      expect(((f >> 8) & 255) > ((f >> 16) & 255)).toBe(true);
      expect(((t >> 16) & 255) > ((t >> 8) & 255)).toBe(true);
    }
  });

  it("the shipped PNG copies exist, are 32-bit RGBA and match the size the measurements were taken on", () => {
    for (const pose of poses) {
      const file = readFileSync(path.join(process.cwd(), "public", pose.src.replace(/^\//, "")));
      expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(file.readUInt32BE(16)).toBe(pose.width);
      expect(file.readUInt32BE(20)).toBe(pose.height);
      expect(file[24]).toBe(8); // bit depth
      expect(file[25]).toBe(6); // colour type 6 = RGBA, the transparent background is kept
      expect(Math.max(pose.width, pose.height)).toBeLessThanOrEqual(900);
      expect(file.length).toBeLessThan(1_500_000);
    }
  });
});

describe("pose geometry in pixels", () => {
  it("boxToPx scales by the image size and keeps the centre", () => {
    const px = boxToPx({ width: 800, height: 400 }, { x: 0.25, y: 0.5, w: 0.5, h: 0.25, color: "#FFFFFF" });
    expect(px).toMatchObject({ x: 200, y: 200, w: 400, h: 100, cx: 400, cy: 250 });
  });

  it("outlineToPx / outlinePoints follow the image size; an inset moves every point toward the centre", () => {
    const pose = mascotPose("front");
    const pts = outlineToPx(pose);
    expect(pts).toHaveLength(36);
    expect(pts[0][0]).toBeCloseTo(pose.visor.outline[0][0] * pose.width, 6);
    const flat = outlinePoints(pose).split(" ");
    const inset = outlinePoints(pose, 10).split(" ");
    expect(flat).toHaveLength(36);
    const cx = pose.visor.cx * pose.width;
    const cy = pose.visor.cy * pose.height;
    flat.forEach((p, i) => {
      const [x, y] = p.split(",").map(Number);
      const [ix, iy] = inset[i].split(",").map(Number);
      expect(Math.hypot(ix - cx, iy - cy)).toBeLessThan(Math.hypot(x - cx, y - cy));
    });
  });

  it("pointInPolygon", () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(pointInPolygon(0.5, 0.5, square)).toBe(true);
    expect(pointInPolygon(1.5, 0.5, square)).toBe(false);
    expect(pointInPolygon(0.5, -0.1, square)).toBe(false);
  });

  it.each(poses.map((p) => [p.id, p] as const))("%s: the drawn mouth, even fully open, stays inside the glass", (_id, pose: MascotPose) => {
    const g = poseGeometry(pose);
    const u = g.mouth.u;
    expect(u).toBeGreaterThan(40);
    const [left, right] = g.eyes;
    expect(g.mouth.cx).toBeGreaterThan(left.cx);
    expect(g.mouth.cx).toBeLessThan(right.cx);
    expect(g.mouth.cy).toBeGreaterThan(left.cy + left.h / 2);
    const bottom = g.mouth.cy + (MOUTH_MAX_OPEN_U + 0.12) * u + 0.05 * u;
    for (const [x, y] of [
      [g.mouth.cx, bottom],
      [g.mouth.cx - 0.3 * u, g.mouth.cy],
      [g.mouth.cx + 0.3 * u, g.mouth.cy],
    ]) {
      expect(pointInPolygon(x / pose.width, y / pose.height, pose.visor.outline)).toBe(true);
    }
  });

  it.each(poses.map((p) => [p.id, p] as const))("%s: ear rings and collar overlays are valid shapes inside the image", (_id, pose) => {
    const g = poseGeometry(pose);
    expect(g.ears[0]).not.toBeNull();
    for (const r of g.ears) {
      if (!r) continue;
      expect(r.rx).toBeGreaterThan(0);
      expect(r.ry).toBeGreaterThan(0);
      expect(r.cx - r.rx).toBeGreaterThan(0);
      expect(r.cx + r.rx).toBeLessThan(pose.width);
      expect(r.cy - r.ry).toBeGreaterThan(0);
      expect(r.cy + r.ry).toBeLessThan(pose.height);
    }
    expect(g.collar.d).toMatch(/^M[\d. ]+Q[\d. ]+$/);
    expect(g.collar.strokeW).toBeGreaterThan(0);
    // ears, collar and both feet are what the hue mask covers
    expect(g.neonBoxes.length).toBe([pose.earLeft, pose.earRight, pose.footLeft, pose.footRight, pose.collar].filter(Boolean).length);
  });
});

describe("which render is shown", () => {
  it("talking and happy use the front render, the rest the three-quarter one", () => {
    expect(targetPoseFor("talking", "neutral")).toBe("front");
    expect(targetPoseFor("talking", "concerned")).toBe("front");
    expect(targetPoseFor("idle", "happy")).toBe("front");
    expect(targetPoseFor("listening", "happy")).toBe("front");
    for (const state of ["idle", "listening", "thinking"] as const) {
      expect(targetPoseFor(state, "neutral")).toBe("three-quarter");
      expect(targetPoseFor(state, "concerned")).toBe("three-quarter");
    }
  });

  it("an explicit pose wins, `auto` and anything unknown follow the state", () => {
    expect(resolvePoseChoice("front", "idle", "neutral")).toBe("front");
    expect(resolvePoseChoice("three-quarter", "talking", "happy")).toBe("three-quarter");
    expect(resolvePoseChoice("auto", "talking", "neutral")).toBe("front");
    expect(resolvePoseChoice(undefined, "thinking", "neutral")).toBe("three-quarter");
  });

  it("a pose stays at least the minimum dwell before it switches", () => {
    expect(POSE_MIN_DWELL_MS).toBeGreaterThanOrEqual(400);
    expect(nextDisplayedPose("front", "three-quarter", 100)).toBe("front");
    expect(nextDisplayedPose("front", "three-quarter", POSE_MIN_DWELL_MS - 1)).toBe("front");
    expect(nextDisplayedPose("front", "three-quarter", POSE_MIN_DWELL_MS)).toBe("three-quarter");
    expect(nextDisplayedPose("front", "front", 0)).toBe("front");
    expect(nextDisplayedPose("front", "three-quarter", Infinity)).toBe("three-quarter");
  });
});

describe("hue rotation of the neon parts", () => {
  it("0 and 360 degrees are the identity, grey stays grey", () => {
    for (const hex of ["#17F1F8", "#AF63F6", "#44ABF5", "#102030"]) {
      expect(applyHueRotate(hex, 0)).toBe(hex);
      expect(applyHueRotate(hex, 360)).toBe(hex);
    }
    for (const deg of [-40, 50, 90, 200]) {
      expect(applyHueRotate("#808080", deg)).toBe("#808080");
      expect(applyHueRotate("#FFFFFF", deg)).toBe("#FFFFFF");
      expect(applyHueRotate("#000000", deg)).toBe("#000000");
    }
  });

  it("each matrix row sums to 1 (brightness of grey is preserved) and the matrix is a rotation of the hue", () => {
    for (const deg of [0, 30, 90, 180, 270]) {
      for (const row of hueRotateMatrix(deg)) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 6);
    }
    // 120 degrees three times is a full turn
    // (a muted colour, so nothing clamps on the way)
    const thrice = applyHueRotate(applyHueRotate(applyHueRotate("#6080A0", 120), 120), 120);
    for (const k of [1, 3, 5]) {
      expect(Math.abs(parseInt(thrice.slice(k, k + 2), 16) - parseInt("6080A0".slice(k - 1, k + 1), 16))).toBeLessThanOrEqual(2);
    }
  });

  it("matches the browser's hue-rotate(): the colours documented in variants.ts", () => {
    expect(applyHueRotate("#17F1F8", -40)).toBe("#1DFC7D");
    expect(applyHueRotate("#AF63F6", -40)).toBe("#567DFA");
    expect(applyHueRotate("#17F1F8", 50)).toBe("#7DC7FF");
    expect(applyHueRotate("#AF63F6", 50)).toBe("#FA55A5");
    expect(applyHueRotate("#17F1F8", 90)).toBe("#F8A2FF");
    expect(applyHueRotate("#AF63F6", 90)).toBe("#F65F4D");
    expect(applyHueRotate("#44ABF5", 90)).toBe("#F577F1");
  });

  it("non-hex input comes back unchanged, a non-finite angle is 0", () => {
    expect(applyHueRotate("red", 90)).toBe("red");
    expect(applyHueRotate("#FFF", 90)).toBe("#FFF");
    expect(applyHueRotate("#17F1F8", Number.NaN)).toBe("#17F1F8");
  });

  it("every crew variant has its own hue and its own face gradient; variant 0 is the render as it is", () => {
    expect(variantFor(0).hueDeg).toBe(0);
    expect(new Set(VARIANTS.map((v) => v.hueDeg)).size).toBe(4);
    expect(new Set(VARIANTS.map((v) => v.neon)).size).toBe(4);
    const pose = mascotPose("front");
    const originals = mascotNeon(0, pose);
    expect(originals.eyes[0]).toEqual({ from: "#17F1F8", to: "#AF63F6" });
    expect(originals.collar).toBe(pose.collar.color.toUpperCase());
    const gradients = new Set(VARIANTS.map((v) => JSON.stringify(mascotNeon(v.index, pose).eyes)));
    expect(gradients.size).toBe(4);
    // any integer wraps like variantFor
    expect(mascotNeon(5, pose)).toEqual(mascotNeon(1, pose));
    expect(mascotNeon(-1, pose)).toEqual(mascotNeon(3, pose));
  });
});

describe("drawn eyes", () => {
  it("every emotion has a shape; happy is an arc, neutral an oval, concerned tilts with raised brows", () => {
    for (const e of COSMO_EMOTIONS) expect(eyeShapeFor(e)).toBe(EYE_SHAPES[e]);
    const happy = EYE_SHAPES.happy;
    const neutral = EYE_SHAPES.neutral;
    const concerned = EYE_SHAPES.concerned;
    // happy: the curve bows upward (apex above the ends) and is long
    const apex = (happy.endY + happy.ctrlY) / 2;
    expect(apex).toBeLessThan(happy.endY - 0.2);
    expect(happy.halfW).toBeGreaterThan(0.3);
    expect(happy.tiltDeg).toBe(0);
    // neutral: a short, thick, vertically stretched stroke = an oval taller than wide
    expect(neutral.halfW).toBeLessThan(0.1);
    expect(neutral.scaleY).toBeGreaterThan(1);
    expect(neutral.strokeW * neutral.scaleY).toBeGreaterThan(neutral.strokeW + 2 * neutral.halfW);
    // concerned: tilted and with visible brows; the others have none
    expect(concerned.tiltDeg).toBeGreaterThan(8);
    expect(concerned.browOpacity).toBeGreaterThan(0.5);
    expect(happy.browOpacity).toBe(0);
    expect(neutral.browOpacity).toBe(0);
  });

  it("listening enlarges the eyes, thinking drifts them up and to the left", () => {
    expect(eyeModsFor("listening").scale).toBeGreaterThan(1);
    expect(eyeModsFor("idle")).toEqual({ scale: 1, dx: 0, dy: 0 });
    expect(eyeModsFor("talking")).toEqual({ scale: 1, dx: 0, dy: 0 });
    const t = eyeModsFor("thinking");
    expect(t.dx).toBeLessThan(0);
    expect(t.dy).toBeLessThan(0);
    const p = eyeParamsFor("thinking", "concerned");
    expect(p.tiltDeg).toBe(EYE_SHAPES.concerned.tiltDeg);
    expect(p.dx).toBe(t.dx);
  });

  it("lerpEye blends every parameter and clamps t", () => {
    const a = eyeParamsFor("idle", "neutral");
    const b = eyeParamsFor("listening", "happy");
    expect(lerpEye(a, b, 0)).toEqual(a);
    expect(lerpEye(a, b, 1)).toEqual(b);
    expect(lerpEye(a, b, -3)).toEqual(a);
    expect(lerpEye(a, b, 9)).toEqual(b);
    const mid = lerpEye(a, b, 0.5);
    expect(mid.halfW).toBeCloseTo((a.halfW + b.halfW) / 2, 9);
    expect(mid.scale).toBeCloseTo((a.scale + b.scale) / 2, 9);
  });

  it("eyePath and browPath are finite paths scaled by the eye width", () => {
    for (const e of COSMO_EMOTIONS) {
      const d = eyePath(EYE_SHAPES[e], 124);
      expect(d).toMatch(/^M-?[\d.]+ -?[\d.]+Q-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+$/);
      expect(d).not.toMatch(/NaN|Infinity/);
    }
    expect(eyePath(EYE_SHAPES.happy, 200)).not.toBe(eyePath(EYE_SHAPES.happy, 100));
    // the happy arc ends are +-halfW * u apart
    expect(eyePath({ halfW: 0.5, endY: 0, ctrlY: -1 }, 100)).toBe("M-50 0Q0 -100 50 0");
    expect(browPath(100)).toBe("M-30 -62L30 -62");
  });

  it("eyeTransform: blink squashes the eye to about 8 %, tilt is mirrored per side", () => {
    const params = { scale: 1, dx: 0, dy: 0, scaleY: 1.25, tiltDeg: 13 };
    const open = eyeTransform(100, 50, 124, params, -1, 0);
    const shut = eyeTransform(100, 50, 124, params, -1, 1);
    expect(open).toBe("translate(100 50) rotate(-13) scale(1 1.25)");
    expect(shut).toBe("translate(100 50) rotate(-13) scale(1 0.1)");
    expect(eyeTransform(100, 50, 124, params, 1, 0)).toContain("rotate(13)");
    expect(eyeTransform(100, 50, 124, params, 1, 7)).toBe(eyeTransform(100, 50, 124, params, 1, 1));
    expect(eyeTransform(100, 50, 124, params, 1, -1)).toBe(eyeTransform(100, 50, 124, params, 1, 0));
    // drift is in eye units
    expect(eyeTransform(100, 50, 100, { ...params, dx: -0.1, dy: -0.2 }, 1, 0)).toContain("translate(90 30)");
  });
});

describe("drawn mouth", () => {
  it("emotions change the curve: happy smiles widest, concerned is the narrowest and turns down", () => {
    for (const e of COSMO_EMOTIONS) expect(mouthLookFor(e)).toBe(MOUTH_LOOKS[e]);
    expect(MOUTH_LOOKS.happy.smileU).toBeGreaterThan(MOUTH_LOOKS.neutral.smileU);
    expect(MOUTH_LOOKS.neutral.smileU).toBeGreaterThan(0);
    expect(MOUTH_LOOKS.concerned.smileU).toBeLessThan(0);
    expect(MOUTH_LOOKS.happy.widthU).toBeGreaterThan(MOUTH_LOOKS.neutral.widthU);
    expect(MOUTH_LOOKS.concerned.widthU).toBeLessThan(MOUTH_LOOKS.neutral.widthU);
  });

  it("glowMouthPath is a finite closed path whose lower lip drops with the opening", () => {
    const depth = (open: number) => {
      const d = glowMouthPath(MOUTH_LOOKS.neutral, open, 100);
      expect(d).not.toMatch(/NaN|Infinity/);
      expect(d.startsWith("M")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      // second quadratic control point = lower lip
      const controls = [...d.matchAll(/Q0 (-?[\d.]+)/g)].map((m) => Number(m[1]));
      expect(controls).toHaveLength(2);
      return controls[1] - controls[0];
    };
    expect(depth(0)).toBe(0);
    expect(depth(0.5)).toBeCloseTo(2 * 0.5 * MOUTH_MAX_OPEN_U * 100, 1);
    expect(depth(1)).toBeGreaterThan(depth(0.5));
    // out-of-range and NaN openings clamp
    expect(glowMouthPath(MOUTH_LOOKS.happy, 5, 100)).toBe(glowMouthPath(MOUTH_LOOKS.happy, 1, 100));
    expect(glowMouthPath(MOUTH_LOOKS.happy, Number.NaN, 100)).toBe(glowMouthPath(MOUTH_LOOKS.happy, 0, 100));
  });

  it("the corners draw in a little as the mouth opens, the closed mouth is the full width", () => {
    const x0 = (open: number) => Number(/^M(-?[\d.]+) 0/.exec(glowMouthPath(MOUTH_LOOKS.neutral, open, 100))?.[1]);
    expect(x0(0)).toBeCloseTo(-MOUTH_LOOKS.neutral.widthU * 50, 1);
    expect(x0(1)).toBeGreaterThan(x0(0));
  });
});

describe("glows and body motion", () => {
  it("wave01 is 0..1, starts at 0, peaks half a period later", () => {
    expect(wave01(0, 1000)).toBe(0);
    expect(wave01(500, 1000)).toBeCloseTo(1, 9);
    expect(wave01(1000, 1000)).toBeCloseTo(0, 9);
    for (let t = 0; t < 5000; t += 37) {
      expect(wave01(t, 1300)).toBeGreaterThanOrEqual(0);
      expect(wave01(t, 1300)).toBeLessThanOrEqual(1);
    }
    expect(wave01(Number.NaN, 1000)).toBe(0);
    expect(wave01(100, 0)).toBe(0);
  });

  it("the ear rings glow only while listening, and pulse unless motion is reduced", () => {
    for (const s of COSMO_STATES) if (s !== "listening") expect(earGlowTarget(s, false, 700)).toBe(0);
    const values = [0, 0.25, 0.5, 0.75].map((f) => earGlowTarget("listening", false, f * EAR_PULSE_MS));
    expect(Math.max(...values)).toBeGreaterThan(0.9);
    expect(Math.min(...values)).toBeLessThan(0.3);
    expect(Math.min(...values)).toBeGreaterThan(0);
    expect(earGlowTarget("listening", true, 0)).toBe(earGlowTarget("listening", true, EAR_PULSE_MS / 2));
    expect(earGlowTarget("listening", true, 0)).toBeGreaterThan(0.5);
  });

  it("the collar glows only while thinking, slowly", () => {
    for (const s of COSMO_STATES) if (s !== "thinking") expect(collarGlowTarget(s, false, 900)).toBe(0);
    expect(COLLAR_PULSE_MS).toBeGreaterThan(EAR_PULSE_MS);
    const lo = collarGlowTarget("thinking", false, 0);
    const hi = collarGlowTarget("thinking", false, COLLAR_PULSE_MS / 2);
    expect(hi).toBeGreaterThan(0.95);
    expect(lo).toBeLessThan(0.3);
    expect(collarGlowTarget("thinking", true, 0)).toBe(collarGlowTarget("thinking", true, COLLAR_PULSE_MS / 2));
  });

  it("only listening tilts", () => {
    expect(tiltTargetFor("listening")).toBeGreaterThan(0);
    expect(tiltTargetFor("listening")).toBeLessThan(6);
    for (const s of ["idle", "thinking", "talking"] as const) expect(tiltTargetFor(s)).toBe(0);
  });

  it("float is a gentle upward bob (never down, never more than FLOAT_PX) and absent with reduced motion", () => {
    for (let t = 0; t < 2 * FLOAT_PERIOD_MS; t += 53) {
      const v = floatOffset(t, false);
      expect(v).toBeLessThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(-FLOAT_PX);
      expect(floatOffset(t, true)).toBe(0);
    }
    expect(floatOffset(FLOAT_PERIOD_MS / 2, false)).toBeCloseTo(-FLOAT_PX, 9);
    expect(floatOffset(Number.NaN, false)).toBe(0);
  });

  it("breathing: only while idle, at most 1.2 %, none with reduced motion", () => {
    for (let t = 0; t < 2 * BREATH_PERIOD_MS; t += 71) {
      const v = breathScale(t, "idle", false);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(1.0121);
      expect(breathScale(t, "idle", true)).toBe(1);
      for (const s of ["listening", "thinking", "talking"] as const) expect(breathScale(t, s, false)).toBe(1);
    }
    expect(breathScale(BREATH_PERIOD_MS / 2, "idle", false)).toBeCloseTo(1.012, 9);
  });
});

describe("implementation order: Rive, then the PNG render, then the placeholder", () => {
  const base = { rive: false, riveFailed: false, mascotMode: "image" as const, imageFailed: false };

  it("Rive wins when it is available and has not failed", () => {
    expect(resolveImplementation({ ...base, rive: true })).toBe("rive");
    expect(resolveImplementation({ ...base, rive: true, mascotMode: "placeholder" })).toBe("rive");
    expect(resolveImplementation({ ...base, rive: true, imageFailed: true })).toBe("rive");
  });

  it("without Rive (or after it failed) the PNG render is the default", () => {
    expect(resolveImplementation(base)).toBe("image");
    expect(resolveImplementation({ ...base, rive: true, riveFailed: true })).toBe("image");
  });

  it("the placeholder is used when asked for, or when the PNG could not be loaded", () => {
    expect(resolveImplementation({ ...base, mascotMode: "placeholder" })).toBe("placeholder");
    expect(resolveImplementation({ ...base, imageFailed: true })).toBe("placeholder");
    expect(resolveImplementation({ ...base, rive: true, riveFailed: true, imageFailed: true })).toBe("placeholder");
    expect(resolveImplementation({ ...base, rive: true, riveFailed: true, mascotMode: "placeholder" })).toBe("placeholder");
  });
});

describe("CosmoConfig", () => {
  function Probe() {
    const c = useCosmoConfig();
    return createElement("p", null, JSON.stringify(c));
  }
  const text = (html: string) => JSON.parse(html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"'));

  it("defaults to the PNG render with the face overlay and no Rive", () => {
    expect(text(renderToStaticMarkup(createElement(Probe)))).toEqual({ rive: false, mascotMode: "image", faceOverlay: true });
    expect(text(renderToStaticMarkup(createElement(Provider, { rive: true }, createElement(Probe))))).toEqual({
      rive: true,
      mascotMode: "image",
      faceOverlay: true,
    });
  });

  it("the provider carries mascotMode and faceOverlay", () => {
    const html = renderToStaticMarkup(
      createElement(Provider, { rive: false, mascotMode: "placeholder", faceOverlay: false }, createElement(Probe)),
    );
    expect(text(html)).toEqual({ rive: false, mascotMode: "placeholder", faceOverlay: false });
  });
});

describe("rendering (server markup)", () => {
  const props = { variant: 0, state: "idle", emotion: "neutral", amplitude: 0 } as const;
  const render = (extra: Record<string, unknown> = {}, wrapper?: { mascotMode?: "image" | "placeholder"; faceOverlay?: boolean }) => {
    const avatar = createElement(CosmoAvatar, { ...props, ...extra });
    return renderToStaticMarkup(wrapper ? createElement(Provider, { rive: false, ...wrapper }, avatar) : avatar);
  };

  it("CosmoAvatar renders the PNG render by default: three-quarter while idle, the front render while talking or happy", () => {
    expect(render()).toContain('href="/mascot/cosmo-three-quarter.png"');
    expect(render({ state: "talking" })).toContain('href="/mascot/cosmo-front.png"');
    expect(render({ emotion: "happy" })).toContain('href="/mascot/cosmo-front.png"');
    expect(render({ pose: "front" })).toContain('href="/mascot/cosmo-front.png"');
    expect(render({ state: "talking", pose: "three-quarter" })).toContain('href="/mascot/cosmo-three-quarter.png"');
  });

  it("the picture and the face share one SVG whose viewBox is the pixel size of the render", () => {
    const html = render();
    expect(html).toContain('viewBox="0 0 822 900"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Cosmo, resting, looking calm"');
    expect(render({ label: "Cosmo robot" })).toContain('aria-label="Cosmo robot"');
    expect(html.match(/<svg /g)).toHaveLength(1);
  });

  it("the face overlay can be switched off by prop or by config: the render stays, the face is gone", () => {
    const on = render();
    expect(on).toContain("<clipPath");
    for (const off of [render({ face: false }), render({}, { faceOverlay: false })]) {
      expect(off).toContain('href="/mascot/cosmo-three-quarter.png"');
      expect(off).not.toContain("<clipPath");
      expect(off).not.toContain("linearGradient");
    }
    // the prop overrides the provider
    expect(render({ face: true }, { faceOverlay: false })).toContain("<clipPath");
  });

  it("mascotMode 'placeholder' (prop or config) draws the SVG character instead", () => {
    for (const html of [render({ mascotMode: "placeholder" }), render({}, { mascotMode: "placeholder" })]) {
      expect(html).toContain('viewBox="0 0 200 200"');
      expect(html).not.toContain("/mascot/");
    }
    expect(render({ mascotMode: "image" }, { mascotMode: "placeholder" })).toContain("/mascot/");
  });

  it("variants rotate the neon with an sRGB hue filter and a mask; variant 0 needs neither", () => {
    expect(render({ variant: 0 })).not.toContain("feColorMatrix");
    for (const v of VARIANTS.slice(1)) {
      const html = render({ variant: v.index });
      expect(html).toContain("feColorMatrix");
      expect(html).toContain(`values="${v.hueDeg}"`);
      expect(html).toContain('color-interpolation-filters="sRGB"');
      expect(html).toContain("<mask");
    }
    // the overlay gradient uses the same rotated colours as documented
    expect(render({ variant: 1, pose: "front" })).toContain('stop-color="#1DFC7D"');
    expect(render({ variant: 3, pose: "front" })).toContain('stop-color="#F8A2FF"');
    expect(render({ variant: 0, pose: "front" })).toContain('stop-color="#17F1F8"');
  });

  it("debug draws the measured geometry, normal rendering does not", () => {
    expect(render({ debug: true })).toContain('data-debug="geometry"');
    expect(render()).not.toContain("data-debug");
  });

  it("size sets the edge, otherwise the avatar fills its container", () => {
    expect(render({ size: 180 })).toContain("width:180px;height:180px");
    expect(render()).toContain("width:100%;height:100%");
  });

  it("ImageCosmo alone behaves the same and survives odd props", () => {
    const html = renderToStaticMarkup(
      createElement(ImageCosmo, { variant: -7.5, state: "talking", emotion: "concerned", amplitude: Number.NaN }),
    );
    expect(html).toContain("/mascot/cosmo-front.png");
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it("every state / emotion / variant renders without NaN", () => {
    for (const state of COSMO_STATES) {
      for (const emotion of COSMO_EMOTIONS) {
        for (const variant of [0, 1, 2, 3, 9]) {
          const html = renderToStaticMarkup(createElement(ImageCosmo, { variant, state, emotion, amplitude: 0.5 }));
          expect(html).not.toMatch(/NaN|Infinity/);
        }
      }
    }
  });
});
