/**
 * lil cosmo on the web page: a small Cosmo strolls along the bottom of the screen (src/components/pet/LilCosmoStroll.tsx),
 * the website's twin of the desktop pet. Pure planning, so it is unit-tested: she stands for a few seconds, then runs to
 * a new spot at least MIN_RUN_PX away, always inside the screen.
 */

/** running speed in px per second (the 12-frame stride, RUN_FPS 20, reads right at this pace for a ~72 px sprite) */
export const STROLL_SPEED = 150;
/** gap kept to the screen edges */
export const STROLL_MARGIN = 12;
/** a run shorter than this looks like a twitch */
export const MIN_RUN_PX = 120;
/** how long she stands between runs */
export const STAND_MIN_MS = 1800;
export const STAND_MAX_MS = 5200;
/** below this width there is no room to stroll (phones): the pet is not shown */
export const STROLL_MIN_VIEWPORT = 640;

export type StrollPlan = { kind: "stand"; ms: number } | { kind: "run"; to: number };

/** the x range (left edge of the sprite) that keeps her fully on screen */
export function strollBounds(width: number, size: number): { min: number; max: number } {
  const min = STROLL_MARGIN;
  const max = Math.max(min, width - size - STROLL_MARGIN);
  return { min, max };
}

export function clampStroll(x: number, width: number, size: number): number {
  const { min, max } = strollBounds(width, size);
  if (!Number.isFinite(x)) return max;
  return Math.min(max, Math.max(min, x));
}

/**
 * What she does next from `x`. `rand` returns [0, 1) (Math.random in the page, a fixed sequence in tests).
 * `wasRunning` makes a stand follow a run, so she never sprints non-stop.
 */
export function nextStroll(x: number, width: number, size: number, rand: () => number, wasRunning: boolean): StrollPlan {
  const { min, max } = strollBounds(width, size);
  const standMs = () => Math.round(STAND_MIN_MS + rand() * (STAND_MAX_MS - STAND_MIN_MS));
  if (wasRunning || max - min < MIN_RUN_PX) return { kind: "stand", ms: standMs() };
  const here = clampStroll(x, width, size);
  // pick a target on either side that is far enough away; fall back to the farther end
  for (let i = 0; i < 4; i++) {
    const to = min + rand() * (max - min);
    if (Math.abs(to - here) >= MIN_RUN_PX) return { kind: "run", to: Math.round(to) };
  }
  return { kind: "run", to: here - min > max - here ? min : max };
}

/** how long a run from `from` to `to` takes, in ms */
export function runDurationMs(from: number, to: number, speed: number = STROLL_SPEED): number {
  if (!(speed > 0)) return 0;
  return Math.round((Math.abs(to - from) / speed) * 1000);
}

/**
 * The desktop pet's own wandering (src/app/pet/DesktopPet.tsx): the window runs along the bottom edge of the screen
 * to a spot given as a fraction of the screen width (the main process eases the run, electron/main.cjs pet:goto).
 * The next spot is at least WANDER_MIN_STEP away, inside [WANDER_EDGE, 1 - WANDER_EDGE].
 */
export const WANDER_EDGE = 0.03;
export const WANDER_MIN_STEP = 0.18;

export function nextWanderFrac(current: number, rand: () => number): number {
  const lo = WANDER_EDGE;
  const hi = 1 - WANDER_EDGE;
  const here = Number.isFinite(current) ? Math.min(hi, Math.max(lo, current)) : 0.5;
  for (let i = 0; i < 4; i++) {
    const to = lo + rand() * (hi - lo);
    if (Math.abs(to - here) >= WANDER_MIN_STEP) return Math.round(to * 1000) / 1000;
  }
  return here - lo > hi - here ? lo : hi;
}

/** how long she rests before the next run: usually 4 to 10 s, now and then a long 25 to 45 s break (she may doze) */
export function wanderRestMs(rand: () => number): number {
  if (rand() < 0.15) return Math.round(25_000 + rand() * 20_000);
  return Math.round(4_000 + rand() * 6_000);
}

/** routes where the strolling pet is not shown (the desktop pet itself, the ground console, developer pages) */
export function strollHiddenOn(pathname: string | null | undefined): boolean {
  const p = pathname ?? "/";
  return p.startsWith("/pet") || p.startsWith("/earth") || p.startsWith("/dev");
}
