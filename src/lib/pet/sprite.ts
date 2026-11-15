/**
 * Timing of lil cosmo's 12-frame running cycle (public/mascot/run, src/components/pet/RunSprite.tsx). The frame comes from
 * the time since the run started, not from counting animation callbacks, so a slow or skipped frame never makes the
 * legs drift out of step with the window's movement.
 */

export const RUN_FRAME_COUNT = 12;
/** one full stride (12 frames) in 0.6 s: matches the window's top speed of ~440 px/s */
export const RUN_FPS = 20;
/** the run sprite and the standing Cosmo cross-fade over this long */
export const RUN_FADE_MS = 140;

export const RUN_FRAMES: readonly string[] = Array.from(
  { length: RUN_FRAME_COUNT },
  (_, i) => `/mascot/run/run-${String(i + 1).padStart(2, "0")}.png`,
);

/** the frame to show `elapsedMs` after the run started; reduced motion holds a single mid-stride frame */
export function runFrameAt(elapsedMs: number, opts: { fps?: number; count?: number; reducedMotion?: boolean } = {}): number {
  const count = Math.max(1, Math.floor(opts.count ?? RUN_FRAME_COUNT));
  if (opts.reducedMotion) return Math.min(count - 1, Math.floor(count / 4));
  const fps = opts.fps ?? RUN_FPS;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !(fps > 0)) return 0;
  return Math.floor((elapsedMs * fps) / 1000) % count;
}
