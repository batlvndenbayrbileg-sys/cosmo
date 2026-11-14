/**
 * Variant mapping for Cosmo (the render-based ImageCosmo and the SVG PlaceholderCosmo).
 *
 * One character, four looks. `variant` comes from CrewPublic.mascotVariant; any integer is safe and
 * wraps modulo 4 (negative numbers wrap too, NaN / Infinity / non-numbers fall back to 0).
 *
 *  index | accent colour      | face detail
 *  ------+--------------------+----------------------------------
 *    0   | deep teal          | freckles (three per cheek)
 *    1   | indigo             | small ear dot (left side)
 *    2   | rose               | sparkle mark (forehead, right)
 *    3   | sky blue           | round glasses outline
 *
 * The Rive file receives the same wrapped index through its `variant` input.
 *
 * ImageCosmo (the team's PNG render) uses `hueDeg` instead of the accent / body colours: the neon
 * parts of the render (ear rings, collar, feet, and the face overlay's gradient) are hue-rotated by
 * that many degrees, the white body is left alone. It is the same colour matrix as CSS
 * `hue-rotate()` / SVG `feColorMatrix type="hueRotate"` (see image-face.ts, applyHueRotate), so the
 * overlay gradient matches the rotated render exactly. The original render is cyan (#17F1F8) to
 * violet (#AF63F6), collar blue (#44ABF5):
 *
 *  index | hueDeg | face gradient (cyan end -> violet end) | collar
 *  ------+--------+---------------------------------------+--------
 *    0   |    0   | #17F1F8 -> #AF63F6  (the render as is)| #44ABF5
 *    1   |  -40   | #1DFC7D -> #567DFA  (mint to blue)    | #1EBEA8
 *    2   |   50   | #7DC7FF -> #FA55A5  (sky to pink)     | #A88AFF
 *    3   |   90   | #F8A2FF -> #F65F4D  (orchid to coral) | #F577F1
 */

export const VARIANT_COUNT = 4;

export type FaceDetail = "freckles" | "earDot" | "sparkle" | "glasses";

export interface CosmoVariant {
  /** wrapped index, 0..3 */
  index: number;
  name: string;
  /** halo, feet and detail colour */
  accent: string;
  /** main body fill (a light tint of the accent) */
  body: string;
  /** soft shading and rim */
  bodyShade: string;
  detail: FaceDetail;
  /** ImageCosmo: hue rotation of the neon parts of the render, degrees (0 = the render as is) */
  hueDeg: number;
  /** ImageCosmo: what the rotated face gradient looks like (cyan end - violet end) */
  neon: string;
}

export const VARIANTS: readonly CosmoVariant[] = [
  { index: 0, name: "Teal", accent: "#0B6E7F", body: "#DDF1F4", bodyShade: "#BFE2E8", detail: "freckles", hueDeg: 0, neon: "cyan - violet" },
  { index: 1, name: "Indigo", accent: "#5B54C8", body: "#E6E4FA", bodyShade: "#CFCBF3", detail: "earDot", hueDeg: -40, neon: "mint - blue" },
  { index: 2, name: "Rose", accent: "#C8466D", body: "#FBE3EA", bodyShade: "#F3C8D4", detail: "sparkle", hueDeg: 50, neon: "sky - pink" },
  { index: 3, name: "Sky", accent: "#2E7FC0", body: "#DDEBF8", bodyShade: "#BFD8F0", detail: "glasses", hueDeg: 90, neon: "orchid - coral" },
];

/** Wrap any number into 0..3. Fractions are floored. */
export function wrapVariantIndex(index: number): number {
  if (typeof index !== "number" || !Number.isFinite(index)) return 0;
  const whole = Math.floor(index);
  return ((whole % VARIANT_COUNT) + VARIANT_COUNT) % VARIANT_COUNT;
}

/** Safe for any integer, including negatives. */
export function variantFor(index: number): CosmoVariant {
  return VARIANTS[wrapVariantIndex(index)];
}
