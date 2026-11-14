/**
 * Mapping from CosmoProps to the Rive state machine "Cosmo" inputs (docs/BRIEF.md section 6).
 * Pure and structural (no Rive import) so it can be unit-tested with fake inputs and so that a
 * missing or differently-typed input in a designer's file can never throw.
 */
import { clampAmplitude } from "./amplitude";
import { wrapVariantIndex } from "./variants";
import type { CosmoEmotion, CosmoState } from "./types";

export const RIVE_SRC = "/cosmo.riv";
export const RIVE_STATE_MACHINE = "Cosmo";

export const EMOTION_CODE: Record<CosmoEmotion, 0 | 1 | 2> = {
  neutral: 0,
  happy: 1,
  concerned: 2,
};

export interface CosmoRiveValues {
  isTalking: boolean;
  isListening: boolean;
  isThinking: boolean;
  /** 0 neutral, 1 happy, 2 concerned */
  emotion: number;
  /** 0..100 = amplitude * 100 */
  mouthOpen: number;
  variant: number;
}

export function riveValues(input: {
  state: CosmoState;
  emotion: CosmoEmotion;
  amplitude: number;
  variant: number;
}): CosmoRiveValues {
  return {
    isTalking: input.state === "talking",
    isListening: input.state === "listening",
    isThinking: input.state === "thinking",
    emotion: EMOTION_CODE[input.emotion] ?? 0,
    mouthOpen: clampAmplitude(input.amplitude) * 100,
    variant: wrapVariantIndex(input.variant),
  };
}

/** The part of Rive's StateMachineInput that we rely on. */
export interface RiveInputLike {
  readonly name: string;
  value: number | boolean;
}

/**
 * Writes each value to the input of the same name. Inputs that are missing are skipped, and a
 * value is only written when its type matches the input's current type (boolean vs number), so a
 * file with different input types cannot throw. Returns the names that were written.
 */
export function applyRiveValues(
  inputs: readonly RiveInputLike[] | null | undefined,
  values: CosmoRiveValues,
): string[] {
  const written: string[] = [];
  if (!inputs) return written;
  for (const [name, value] of Object.entries(values)) {
    try {
      const input = inputs.find((i) => i.name === name);
      if (!input) continue;
      if (typeof input.value !== typeof value) continue;
      if (input.value !== value) input.value = value;
      written.push(name);
    } catch {
      // a broken input must never break the avatar
    }
  }
  return written;
}
