/** Blink timing for the placeholder character. Pure, unit-tested. */

export const BLINK_MIN_MS = 2500;
export const BLINK_MAX_MS = 6000;
export const BLINK_DURATION_MS = 140;

/**
 * Delay until the next blink, uniformly random within BLINK_MIN_MS..BLINK_MAX_MS.
 * `random` is injectable for tests; a misbehaving source (NaN, out of range) is clamped.
 */
export function nextBlinkDelay(random: () => number = Math.random): number {
  const r = random();
  const unit = Number.isFinite(r) ? Math.min(Math.max(r, 0), 1) : 0.5;
  return BLINK_MIN_MS + unit * (BLINK_MAX_MS - BLINK_MIN_MS);
}

/**
 * How closed the eyes are, 0 (open) to 1 (shut), `elapsedMs` after a blink started.
 * Smooth close-and-open over BLINK_DURATION_MS; 0 outside that window.
 */
export function blinkClosure(elapsedMs: number, durationMs = BLINK_DURATION_MS): number {
  if (!(elapsedMs >= 0) || elapsedMs >= durationMs || durationMs <= 0) return 0;
  return Math.sin((Math.PI * elapsedMs) / durationMs);
}
