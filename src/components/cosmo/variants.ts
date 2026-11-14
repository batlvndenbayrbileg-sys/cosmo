/**
 * Variant mapping for the placeholder Cosmo.
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
}

export const VARIANTS: readonly CosmoVariant[] = [
  { index: 0, name: "Teal", accent: "#0B6E7F", body: "#DDF1F4", bodyShade: "#BFE2E8", detail: "freckles" },
  { index: 1, name: "Indigo", accent: "#5B54C8", body: "#E6E4FA", bodyShade: "#CFCBF3", detail: "earDot" },
  { index: 2, name: "Rose", accent: "#C8466D", body: "#FBE3EA", bodyShade: "#F3C8D4", detail: "sparkle" },
  { index: 3, name: "Sky", accent: "#2E7FC0", body: "#DDEBF8", bodyShade: "#BFD8F0", detail: "glasses" },
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
