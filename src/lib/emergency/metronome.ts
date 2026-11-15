/**
 * CPR compression rhythm. Rate from the cited sources: St John Ambulance and the American Red Cross both give
 * 100 to 120 compressions a minute (checked 2026-11-15). The metronome runs in the middle of that range.
 */
export const CPR_RATE = { min: 100, max: 120, default: 110 } as const;

/** compressions between rescue breaths for trained helpers (30:2) */
export const COMPRESSIONS_PER_CYCLE = 30;

/** a rate inside the sourced range (whole beats a minute); anything else falls back to the default */
export function clampRate(bpm: number): number {
  if (!Number.isFinite(bpm)) return CPR_RATE.default;
  return Math.min(CPR_RATE.max, Math.max(CPR_RATE.min, Math.round(bpm)));
}

/** milliseconds between two compressions at this rate (110 a minute: about 545 ms) */
export function beatIntervalMs(bpm: number): number {
  return 60_000 / clampRate(bpm);
}

/** how many compressions have been cued after `elapsedMs` of running (the first one at 0 ms) */
export function beatsAt(elapsedMs: number, bpm: number): number {
  if (!(elapsedMs >= 0)) return 0;
  return Math.floor(elapsedMs / beatIntervalMs(bpm)) + 1;
}

/** position inside the current cycle of 30: 1..30 (0 before the first beat) */
export function cyclePosition(beats: number, perCycle = COMPRESSIONS_PER_CYCLE): number {
  if (beats <= 0) return 0;
  return ((beats - 1) % perCycle) + 1;
}

/** the running timer: "m:ss" (minutes keep counting past 59) */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
