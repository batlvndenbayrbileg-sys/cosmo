/**
 * Pure amplitude maths for Cosmo. No DOM, no React: unit-tested in tests/cosmo.test.ts.
 */

/** Clamp to 0..1. NaN, undefined-like and non-finite negatives collapse to 0; +Infinity to 1. */
export function clampAmplitude(value: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Typical speech RMS sits around 0.05-0.3 of full scale, so the hook boosts it before clamping. */
export const SPEECH_GAIN = 3;

/**
 * Root-mean-square level of an analyser buffer, scaled by `gain` and clamped to 0..1.
 *  - Uint8Array: `AnalyserNode.getByteTimeDomainData` layout, 128 is silence, 0 and 255 are full scale.
 *  - Float32Array: `getFloatTimeDomainData` layout, 0 is silence, -1 and 1 are full scale.
 * An empty buffer is silence. With the default gain of 1 the result is the plain RMS.
 */
export function rmsToAmplitude(samples: Uint8Array | Float32Array, gain = 1): number {
  const n = samples.length;
  if (n === 0) return 0;
  const isFloat = samples instanceof Float32Array;
  let sumSquares = 0;
  for (let i = 0; i < n; i++) {
    const v = isFloat ? samples[i] : (samples[i] - 128) / 128;
    sumSquares += v * v;
  }
  return clampAmplitude(Math.sqrt(sumSquares / n) * gain);
}

/** Small deadzone so analyser noise floor does not make a closed mouth tremble. */
export const MOUTH_DEADZONE = 0.04;

/** amplitude 0..1 to mouth opening 0..1; everything under the deadzone is a closed mouth. */
export function mouthOpenFromAmplitude(amplitude: number, deadzone = MOUTH_DEADZONE): number {
  const a = clampAmplitude(amplitude);
  const dz = Math.min(Math.max(deadzone, 0), 0.99);
  if (a <= dz) return 0;
  return clampAmplitude((a - dz) / (1 - dz));
}

export interface SmoothingTimes {
  attackMs: number;
  releaseMs: number;
}

export const MOUTH_SMOOTHING: SmoothingTimes = { attackMs: 45, releaseMs: 110 };

/**
 * Frame-rate independent exponential smoothing. Opens fast (attack), closes slower (release),
 * never overshoots the target.
 */
export function smoothAmplitude(
  previous: number,
  target: number,
  dtMs: number,
  times: SmoothingTimes = MOUTH_SMOOTHING,
): number {
  if (!(dtMs > 0)) return previous;
  const tau = target > previous ? times.attackMs : times.releaseMs;
  const alpha = tau <= 0 ? 1 : 1 - Math.exp(-dtMs / tau);
  return previous + (target - previous) * alpha;
}

export const SIM_MIN = 0.15;
export const SIM_MAX = 0.9;

/**
 * A speech-like loudness envelope: a syllable-rate sine (about 4 Hz), a faster flutter, a slow
 * phrase swell and a little noise. Output is always within SIM_MIN..SIM_MAX.
 * @param tSeconds time since the envelope started
 * @param noise a random number in 0..1 (injected so the function stays pure)
 */
export function simulatedSpeechEnvelope(tSeconds: number, noise: number): number {
  const t = Number.isFinite(tSeconds) ? tSeconds : 0;
  const n = clampAmplitude(noise);
  const tau = Math.PI * 2;
  const raw =
    0.5 +
    0.2 * Math.sin(tau * 4.1 * t) +
    0.14 * Math.sin(tau * 7.3 * t + 1.1) +
    0.12 * Math.sin(tau * 1.3 * t + 0.5) +
    0.1 * (n * 2 - 1);
  return Math.min(SIM_MAX, Math.max(SIM_MIN, raw));
}
