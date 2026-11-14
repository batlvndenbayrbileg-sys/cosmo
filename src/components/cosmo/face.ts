/**
 * Face geometry and emotion styling for the placeholder Cosmo. Pure, unit-tested.
 * Coordinates are in the 200 x 200 viewBox of PlaceholderCosmo.
 */
import type { CosmoEmotion } from "./types";
import { clampAmplitude } from "./amplitude";

export const VIEW_SIZE = 200;

export const EYE_Y = 100;
export const EYE_LEFT_X = 76;
export const EYE_RIGHT_X = 124;
export const BROW_Y = 78;
export const MOUTH_X = 100;
export const MOUTH_Y = 130;
/** deepest mouth opening, in viewBox units */
export const MOUTH_MAX_OPEN = 24;

export type EyeKind = "round" | "arc" | "soft";
export type CheekTone = "warm" | "cool";

export interface EmotionLook {
  /** round = neutral, arc = happy (curved), soft = concerned (slightly droopy) */
  eye: EyeKind;
  /** inner end of each brow is raised by this many degrees */
  browInnerRaiseDeg: number;
  /** whole brow shifts up (negative y) by this many units */
  browLift: number;
  browOpacity: number;
  /** how much the mouth centre sits below its corners (bigger = broader smile) */
  smile: number;
  mouthWidth: number;
  cheekTone: CheekTone;
  cheekOpacity: number;
  /** opacity of the cool overlay on the body; calm, never alarming */
  coolTint: number;
}

const LOOKS: Record<CosmoEmotion, EmotionLook> = {
  neutral: {
    eye: "round",
    browInnerRaiseDeg: 0,
    browLift: 0,
    browOpacity: 0.5,
    smile: 3.5,
    mouthWidth: 24,
    cheekTone: "warm",
    cheekOpacity: 0.28,
    coolTint: 0,
  },
  happy: {
    eye: "arc",
    browInnerRaiseDeg: 0,
    browLift: -3,
    browOpacity: 0.45,
    smile: 8,
    mouthWidth: 32,
    cheekTone: "warm",
    cheekOpacity: 0.6,
    coolTint: 0,
  },
  concerned: {
    eye: "soft",
    browInnerRaiseDeg: 14,
    browLift: -2,
    browOpacity: 0.85,
    smile: 0.5,
    mouthWidth: 18,
    cheekTone: "cool",
    cheekOpacity: 0.4,
    coolTint: 0.12,
  },
};

export function emotionLook(emotion: CosmoEmotion): EmotionLook {
  return LOOKS[emotion] ?? LOOKS.neutral;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * SVG path of the mouth. `open` is 0..1. At 0 the shape collapses to a line (the stroke draws it);
 * above 0 the lower lip drops and the corners draw slightly in.
 */
export function mouthPath(look: EmotionLook, open: number): string {
  const o = clampAmplitude(open);
  const width = look.mouthWidth * (1 - 0.18 * o);
  const x0 = MOUTH_X - width / 2;
  const x1 = MOUTH_X + width / 2;
  const depth = o * MOUTH_MAX_OPEN;
  const topControl = MOUTH_Y + 2 * look.smile;
  const bottomControl = MOUTH_Y + 2 * look.smile + 2 * depth;
  return (
    `M${round2(x0)} ${MOUTH_Y}` +
    `Q${MOUTH_X} ${round2(topControl)} ${round2(x1)} ${MOUTH_Y}` +
    `Q${MOUTH_X} ${round2(bottomControl)} ${round2(x0)} ${MOUTH_Y}Z`
  );
}

/** SVG matrix that scales vertically about `cy` (used for blinking eyes). */
export function scaleYAbout(cy: number, scaleY: number): string {
  const s = round2(scaleY);
  return `matrix(1 0 0 ${s} 0 ${round2(cy * (1 - s))})`;
}

/** Plain-English accessible description, e.g. "Cosmo, listening, looking concerned". */
export function describeCosmo(state: string, emotion: string): string {
  const doing: Record<string, string> = {
    idle: "resting",
    listening: "listening",
    thinking: "thinking",
    talking: "talking",
  };
  const feeling: Record<string, string> = {
    neutral: "looking calm",
    happy: "looking happy",
    concerned: "looking concerned",
  };
  return `Cosmo, ${doing[state] ?? "resting"}, ${feeling[emotion] ?? "looking calm"}`;
}
