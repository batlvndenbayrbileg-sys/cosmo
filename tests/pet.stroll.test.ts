import { describe, expect, it } from "vitest";
import {
  MIN_RUN_PX,
  STAND_MAX_MS,
  STAND_MIN_MS,
  STROLL_MARGIN,
  WANDER_EDGE,
  WANDER_MIN_STEP,
  clampStroll,
  nextStroll,
  nextWanderFrac,
  wanderRestMs,
  runDurationMs,
  strollBounds,
  strollHiddenOn,
} from "@/lib/pet/stroll";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("lil cosmo on the web page: stroll planning", () => {
  it("keeps her fully on screen", () => {
    expect(strollBounds(1280, 72)).toEqual({ min: STROLL_MARGIN, max: 1280 - 72 - STROLL_MARGIN });
    expect(clampStroll(-50, 1280, 72)).toBe(STROLL_MARGIN);
    expect(clampStroll(5000, 1280, 72)).toBe(1280 - 72 - STROLL_MARGIN);
    expect(clampStroll(Number.NaN, 1280, 72)).toBe(1280 - 72 - STROLL_MARGIN);
  });

  it("stands after every run, for 1.8 to 5.2 s", () => {
    for (const r of [0, 0.5, 0.999]) {
      const plan = nextStroll(400, 1280, 72, seq(r), true);
      expect(plan.kind).toBe("stand");
      if (plan.kind === "stand") {
        expect(plan.ms).toBeGreaterThanOrEqual(STAND_MIN_MS);
        expect(plan.ms).toBeLessThanOrEqual(STAND_MAX_MS);
      }
    }
  });

  it("runs at least MIN_RUN_PX to a spot inside the screen", () => {
    const { min, max } = strollBounds(1280, 72);
    for (const r of [0, 0.1, 0.33, 0.5, 0.77, 0.999]) {
      const plan = nextStroll(600, 1280, 72, seq(r, 0.9, 0.05), false);
      expect(plan.kind).toBe("run");
      if (plan.kind === "run") {
        expect(plan.to).toBeGreaterThanOrEqual(min);
        expect(plan.to).toBeLessThanOrEqual(max);
        expect(Math.abs(plan.to - 600)).toBeGreaterThanOrEqual(MIN_RUN_PX);
      }
    }
  });

  it("falls back to the farther end when every random spot is too close", () => {
    const plan = nextStroll(600, 1280, 72, seq((600 - STROLL_MARGIN) / (1280 - 72 - 2 * STROLL_MARGIN)), false);
    // from 600 the right end (1196) is farther than the left end (12)
    expect(plan).toEqual({ kind: "run", to: 1280 - 72 - STROLL_MARGIN });
  });

  it("only stands when the screen is too narrow to run", () => {
    expect(nextStroll(20, 150, 72, seq(0.9), false).kind).toBe("stand");
  });

  it("times a run from the distance", () => {
    expect(runDurationMs(100, 400, 150)).toBe(2000);
    expect(runDurationMs(400, 100, 150)).toBe(2000);
    expect(runDurationMs(0, 100, 0)).toBe(0);
  });

  it("desktop pet: wanders to a spot at least WANDER_MIN_STEP away, inside the screen", () => {
    for (const r of [0, 0.2, 0.5, 0.8, 0.999]) {
      const to = nextWanderFrac(0.5, seq(r, 0.95, 0.02));
      expect(to).toBeGreaterThanOrEqual(WANDER_EDGE);
      expect(to).toBeLessThanOrEqual(1 - WANDER_EDGE);
      expect(Math.abs(to - 0.5)).toBeGreaterThanOrEqual(WANDER_MIN_STEP);
    }
    // every random spot too close: the farther end
    expect(nextWanderFrac(0.6, seq(0.6))).toBe(WANDER_EDGE);
    expect(nextWanderFrac(Number.NaN, seq(0.9))).toBeGreaterThan(0.5);
  });

  it("desktop pet: rests 4 to 10 s, now and then 25 to 45 s", () => {
    expect(wanderRestMs(seq(0.5, 0))).toBe(4000);
    expect(wanderRestMs(seq(0.5, 0.999))).toBeLessThanOrEqual(10_000);
    expect(wanderRestMs(seq(0.1, 0))).toBe(25_000);
    expect(wanderRestMs(seq(0.1, 0.999))).toBeLessThanOrEqual(45_000);
  });

  it("is not shown on the desktop pet's page, the ground console or developer pages", () => {
    expect(strollHiddenOn("/pet")).toBe(true);
    expect(strollHiddenOn("/earth")).toBe(true);
    expect(strollHiddenOn("/dev/dashboard")).toBe(true);
    expect(strollHiddenOn("/")).toBe(false);
    expect(strollHiddenOn("/crew")).toBe(false);
    expect(strollHiddenOn(null)).toBe(false);
  });
});
