/**
 * Measured geometry of the team's Cosmo renders (public/mascot/*.png).
 *
 * The numbers below come from `scripts/prepare-mascot.ps1 -Measure`, which analyses the DOWNSCALED
 * copies with System.Drawing: visor = connected set of near-black opaque pixels grown from a seed
 * inside the visor (the bright eyes and the glare are holes that are filled row by row), then a
 * second-moment ellipse fit and a 36-point outline; eyes / ear rings / collar / feet = bounding boxes
 * of the saturated bright ("neon") pixel blobs inside a search window. Everything is NORMALISED
 * (0..1 of the image width for x / w, of the image height for y / h) so it survives any rescale of
 * the same render. Replace a render, re-run the script, paste the new numbers.
 *
 * Why these two renders (out of the seven the team supplied):
 *  - "front" = Waving-5: front view with the largest, most symmetric visor, arm raised. The wave
 *    reads as friendly, so it is the greeting / talking / happy pose. Waving-1 is the same pose with
 *    a smaller visor, so the eyes would be smaller, which is worse for lip sync.
 *  - "three-quarter" = "Neon Glow-4": three-quarter view, calm and attentive, arms down. Both of its
 *    ear rings and the whole visor are readable and it has exactly the same canvas (1199x1312) and
 *    body scale as Waving-5, so switching pose does not make the body jump. "Mascot-2" is nearly
 *    identical but on a square canvas; the side (-8), rear (-7) and dark-background (-6) renders
 *    have no usable visor face.
 */

export type MascotPoseId = "front" | "three-quarter";
export const MASCOT_POSE_IDS: readonly MascotPoseId[] = ["front", "three-quarter"];

/** normalised bounding box of a glowing part; `color` is the average neon colour inside it */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface GlassStop {
  y: number;
  color: string;
}

export interface MascotPose {
  id: MascotPoseId;
  /** public URL of the downscaled render */
  src: string;
  /** pixel size of the shipped file (also the overlay SVG viewBox) */
  width: number;
  height: number;
  visor: {
    /** fitted ellipse (normalised); rx is relative to the width, ry to the height */
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    /** rotation of the horizontal axis, degrees, clockwise (y down) */
    rotationDeg: number;
    /** how well the ellipse matches the measured visor (intersection over union) */
    fitIoU: number;
    /** median colour of the dark glass away from the eyes */
    darkColor: string;
    /**
     * The glass is a vertical gradient (lighter at the top). Colour of the glass at the top of the
     * eyes' glow, on the eye line and at the bottom of the glow (y normalised): the patch over the
     * baked-in eyes is painted with this gradient so it leaves no seam.
     */
    glass: readonly [GlassStop, GlassStop, GlassStop];
    /** measured outline, 36 points counter-clockwise from the right-most point (normalised) */
    outline: readonly (readonly [number, number])[];
  };
  /** the two baked-in smiling eyes, left to right as seen on screen */
  eyes: readonly [NormBox, NormBox];
  /** cyan (left end) to violet (right end) colours of each baked-in eye */
  eyeEnds: readonly [{ from: string; to: string }, { from: string; to: string }];
  earLeft: NormBox | null;
  earRight: NormBox | null;
  collar: NormBox;
  footLeft: NormBox;
  footRight: NormBox;
}

const FRONT: MascotPose = {
  id: "front",
  src: "/mascot/cosmo-front.png",
  width: 822,
  height: 900,
  visor: {
    cx: 0.5119,
    cy: 0.2768,
    rx: 0.2579,
    ry: 0.1778,
    rotationDeg: 0.724,
    fitIoU: 0.9583,
    darkColor: "#1A1B23",
    glass: [
      { y: 0.2056, color: "#191A23" },
      { y: 0.2856, color: "#15151A" },
      { y: 0.3656, color: "#101014" },
    ],
    outline: [
      [0.7638, 0.2768], [0.7635, 0.3173], [0.752, 0.3566], [0.7247, 0.389], [0.6899, 0.4132], [0.6519, 0.4291],
      [0.6135, 0.4375], [0.5785, 0.4438], [0.5445, 0.4453], [0.5119, 0.4468], [0.4794, 0.4453], [0.4462, 0.4417],
      [0.4116, 0.4355], [0.3743, 0.4266], [0.3367, 0.411], [0.3012, 0.3879], [0.2741, 0.3558], [0.2579, 0.3177],
      [0.2552, 0.2768], [0.2663, 0.2372], [0.2867, 0.2019], [0.3128, 0.1718], [0.3423, 0.1468], [0.3743, 0.127],
      [0.4085, 0.1132], [0.4429, 0.1034], [0.4773, 0.0973], [0.5119, 0.0957], [0.5466, 0.0973], [0.581, 0.1034],
      [0.6159, 0.1122], [0.6503, 0.1261], [0.6825, 0.1461], [0.7121, 0.1712], [0.736, 0.2023], [0.7539, 0.2378],
    ],
  },
  eyes: [
    { x: 0.3321, y: 0.25, w: 0.1509, h: 0.0711, color: "#5DB8F7" },
    { x: 0.5572, y: 0.2522, w: 0.1484, h: 0.07, color: "#67B1F7" },
  ],
  eyeEnds: [
    { from: "#17F1F8", to: "#AF63F6" },
    { from: "#27ECF7", to: "#BC5FF6" },
  ],
  earLeft: { x: 0.1545, y: 0.2389, w: 0.0572, h: 0.1789, color: "#7493EC" },
  earRight: { x: 0.7968, y: 0.2467, w: 0.0596, h: 0.1833, color: "#738CEB" },
  collar: { x: 0.3637, y: 0.5044, w: 0.2749, h: 0.0467, color: "#44ABF5" },
  footLeft: { x: 0.3102, y: 0.89, w: 0.1156, h: 0.0311, color: "#23BAF9" },
  footRight: { x: 0.5693, y: 0.89, w: 0.1156, h: 0.0322, color: "#24B8F9" },
};

const THREE_QUARTER: MascotPose = {
  id: "three-quarter",
  src: "/mascot/cosmo-three-quarter.png",
  width: 822,
  height: 900,
  visor: {
    cx: 0.5971,
    cy: 0.2719,
    rx: 0.213,
    ry: 0.1722,
    rotationDeg: 17.7864,
    fitIoU: 0.9508,
    darkColor: "#171723",
    glass: [
      { y: 0.2033, color: "#151623" },
      { y: 0.2811, color: "#0D0D15" },
      { y: 0.3589, color: "#0B0C15" },
    ],
    outline: [
      [0.799, 0.2719], [0.8032, 0.3051], [0.8006, 0.3395], [0.7878, 0.3725], [0.7648, 0.4005], [0.7324, 0.4192],
      [0.6981, 0.4316], [0.6628, 0.4369], [0.6294, 0.4393], [0.5971, 0.4375], [0.5656, 0.4349], [0.5347, 0.4285],
      [0.504, 0.4191], [0.4743, 0.4055], [0.4461, 0.3876], [0.4211, 0.3647], [0.4005, 0.3373], [0.3886, 0.3055],
      [0.3842, 0.2719], [0.3898, 0.2385], [0.4027, 0.2073], [0.4201, 0.1786], [0.4424, 0.1533], [0.4688, 0.1323],
      [0.4979, 0.1151], [0.5301, 0.1038], [0.5633, 0.0968], [0.5971, 0.0941], [0.6309, 0.0968], [0.6632, 0.1059],
      [0.6938, 0.1189], [0.7214, 0.1366], [0.7443, 0.1591], [0.7636, 0.1841], [0.7789, 0.2115], [0.7912, 0.2406],
    ],
  },
  eyes: [
    { x: 0.4745, y: 0.2478, w: 0.1472, h: 0.0678, color: "#69C5F6" },
    { x: 0.6703, y: 0.2478, w: 0.1119, h: 0.0633, color: "#6FC1F5" },
  ],
  eyeEnds: [
    { from: "#35F2F7", to: "#B673F5" },
    { from: "#45F0F6", to: "#C072F4" },
  ],
  earLeft: { x: 0.1825, y: 0.2411, w: 0.129, h: 0.1944, color: "#5A7DE1" },
  // the far ear is a thin sliver behind the visor in this view: nothing to animate
  earRight: null,
  collar: { x: 0.4002, y: 0.4978, w: 0.2664, h: 0.0478, color: "#4FA0F6" },
  footLeft: { x: 0.3771, y: 0.89, w: 0.1046, h: 0.0333, color: "#2BBDF9" },
  footRight: { x: 0.6156, y: 0.8833, w: 0.0925, h: 0.0322, color: "#26BAF8" },
};

export const MASCOT_POSES: Record<MascotPoseId, MascotPose> = {
  front: FRONT,
  "three-quarter": THREE_QUARTER,
};

export function mascotPose(id: MascotPoseId): MascotPose {
  return MASCOT_POSES[id] ?? FRONT;
}

/** what the avatar shows, and when. `auto` follows state / emotion. */
export type MascotPoseChoice = MascotPoseId | "auto";

// --------------------------------------------------------------------------------------------
// Pixel-space helpers: the overlay SVG uses the image's own pixel size as its viewBox, so circles
// stay circles although the render is not square.
// --------------------------------------------------------------------------------------------

export interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  color: string;
}

export function boxToPx(pose: Pick<MascotPose, "width" | "height">, box: NormBox): PxBox {
  const x = box.x * pose.width;
  const y = box.y * pose.height;
  const w = box.w * pose.width;
  const h = box.h * pose.height;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, color: box.color };
}

export function outlineToPx(pose: MascotPose): [number, number][] {
  return pose.visor.outline.map(([x, y]) => [x * pose.width, y * pose.height]);
}

/** SVG `points` attribute for the visor outline */
export function outlinePoints(pose: MascotPose, inset = 0): string {
  const pts = outlineToPx(pose);
  const cx = pose.visor.cx * pose.width;
  const cy = pose.visor.cy * pose.height;
  return pts
    .map(([x, y]) => {
      if (inset === 0) return `${round1(x)},${round1(y)}`;
      const dx = x - cx;
      const dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.max(0, len - inset) / len;
      return `${round1(cx + dx * k)},${round1(cy + dy * k)}`;
    })
    .join(" ");
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** ray casting point-in-polygon test */
export function pointInPolygon(x: number, y: number, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// --------------------------------------------------------------------------------------------
// Overlay geometry of a pose, in image pixels
// --------------------------------------------------------------------------------------------

export interface EyeGeo {
  /** centre of the baked-in eye */
  cx: number;
  cy: number;
  /** width of the baked-in eye = 1 "eye unit" (see image-face.ts) */
  u: number;
  w: number;
  h: number;
}

export interface RingGeo {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface PoseGeometry {
  eyes: readonly [EyeGeo, EyeGeo];
  /** dark patches that hide the baked-in eyes (and their glow) */
  patches: readonly [RingGeo, RingGeo];
  /** where the drawn mouth sits: centre between the eyes, a little below them */
  mouth: { cx: number; cy: number; u: number };
  ears: readonly [RingGeo | null, RingGeo | null];
  /** collar glow: a curved stroke */
  collar: { d: string; strokeW: number };
  /** pixel boxes of every neon part (ears, collar, feet): the hue-rotation mask and the debug view */
  neonBoxes: readonly PxBox[];
}

/** how far the baked-in eye's halo reaches beyond its bright core, px */
export const EYE_GLOW_PAD = 30;
/** the drawn mouth sits this many eye units below the eye centres */
export const MOUTH_DROP_U = 0.62;
/** ring overlay is inset from the measured blob (which includes the halo) by this share of its short side */
export const RING_INSET_FRAC = 0.2;

function ringFromBox(box: PxBox): RingGeo {
  const inset = RING_INSET_FRAC * Math.min(box.w, box.h);
  return { cx: box.cx, cy: box.cy, rx: Math.max(1, box.w / 2 - inset), ry: Math.max(1, box.h / 2 - inset) };
}

export function poseGeometry(pose: MascotPose): PoseGeometry {
  const eyeBoxes = pose.eyes.map((b) => boxToPx(pose, b));
  const eyes = eyeBoxes.map((b) => ({ cx: b.cx, cy: b.cy, u: b.w, w: b.w, h: b.h })) as unknown as [EyeGeo, EyeGeo];
  const patches = eyeBoxes.map((b) => ({
    cx: b.cx,
    cy: b.cy,
    rx: b.w / 2 + EYE_GLOW_PAD,
    ry: b.h / 2 + EYE_GLOW_PAD,
  })) as unknown as [RingGeo, RingGeo];
  const u = (eyes[0].u + eyes[1].u) / 2;
  const mouth = {
    cx: (eyes[0].cx + eyes[1].cx) / 2,
    cy: (eyes[0].cy + eyes[1].cy) / 2 + MOUTH_DROP_U * u,
    u,
  };
  const earL = pose.earLeft ? ringFromBox(boxToPx(pose, pose.earLeft)) : null;
  const earR = pose.earRight ? ringFromBox(boxToPx(pose, pose.earRight)) : null;

  const c = boxToPx(pose, pose.collar);
  const x0 = c.x + 0.06 * c.w;
  const x1 = c.x + 0.94 * c.w;
  const yEnd = c.y + 0.3 * c.h;
  const yCtrl = c.y + 1.14 * c.h;
  const collar = {
    d: `M${round1(x0)} ${round1(yEnd)}Q${round1(c.cx)} ${round1(yCtrl)} ${round1(x1)} ${round1(yEnd)}`,
    strokeW: round1(0.34 * c.h),
  };

  const parts = [pose.earLeft, pose.earRight, pose.collar, pose.footLeft, pose.footRight].filter(
    (b): b is NormBox => b !== null,
  );
  return { eyes, patches, mouth, ears: [earL, earR], collar, neonBoxes: parts.map((b) => boxToPx(pose, b)) };
}
