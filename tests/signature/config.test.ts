import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_CREW_REFERENCE_PANELS,
  CORE_SIGNATURE,
  D2_N3,
  DSS_CALM,
  DSS_TRIGGER,
  DSS_TRIGGER_DAYS,
  KITS_TOTAL,
  KPI_DIR,
  KPI_FLOOR,
  MIN_DAYS_BETWEEN_DRAWS,
  MIN_EFFECT,
  POST_TIMEPOINTS,
  PRE_TIMEPOINTS,
  REFERENCE_CREW,
  RETEST_MAX,
  RETEST_MIN,
  ROUTINE_DAYS,
  S_FLOOR,
  SUPPORTING_SIGNATURE,
  TIMEPOINTS,
  TIMEPOINT_DAY,
  T_HIGH,
  T_LOW,
  UNEXPECTED_RETEST_DAYS,
  WINDOW_DAYS,
  W_CORE,
  W_SUPP,
  Z_CAP,
} from "@/lib/signature/config";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import type { SignatureReference, Timepoint } from "@/lib/signature/types";
import fixtureCopy from "@/data/signature_reference.json";

const DOCS_FIXTURE = path.join(process.cwd(), "docs", "signature_reference", "expected_values.json");

describe("signature T0: fixture copy", () => {
  it("src/data/signature_reference.json is an exact copy of the docs fixture", () => {
    const docs = JSON.parse(fs.readFileSync(DOCS_FIXTURE, "utf8"));
    expect(fixtureCopy).toEqual(docs);
  });

  it("imports with types: the typed reference is the fixture", () => {
    const ref: SignatureReference = SIGNATURE_REFERENCE;
    expect(ref).toBe(fixtureCopy);
    expect(Object.keys(ref.panels)).toHaveLength(16);
    expect(ref.qc_log).toHaveLength(12);
    expect(ref.panels["C003_R+1"].fri).toBe(66.9);
    expect(ref.recovery.eta.C003.loo_half_life_band).toEqual([8.07, 21.47]);
  });
});

describe("signature T0: config constants", () => {
  it("match the build prompt and the fixture constants", () => {
    const c = SIGNATURE_REFERENCE.constants;
    expect(D2_N3).toBe(1.693);
    expect(D2_N3).toBe(c.D2_N3);
    expect(S_FLOOR).toBeCloseTo(Math.log(1.1), 12);
    expect(MIN_EFFECT).toBeCloseTo(Math.log(1.1), 12);
    expect(S_FLOOR).toBeCloseTo(c.S_FLOOR, 4);
    expect(MIN_EFFECT).toBeCloseTo(c.MIN_EFFECT, 4);
    expect([Z_CAP, W_CORE, W_SUPP, T_LOW, T_HIGH, WINDOW_DAYS]).toEqual([
      c.Z_CAP,
      c.W_CORE,
      c.W_SUPP,
      c.T_LOW,
      c.T_HIGH,
      c.WINDOW_DAYS,
    ]);
    expect([Z_CAP, W_CORE, W_SUPP, T_LOW, T_HIGH, WINDOW_DAYS]).toEqual([4, 1, 0.5, 20, 40, 7]);
    expect([RETEST_MIN, RETEST_MAX, UNEXPECTED_RETEST_DAYS]).toEqual([3, 21, 3]);
    expect([DSS_TRIGGER, DSS_TRIGGER_DAYS, DSS_CALM]).toEqual([50, 3, 25]);
    expect([MIN_DAYS_BETWEEN_DRAWS, ROUTINE_DAYS, KITS_TOTAL]).toEqual([7, 30, 8]);
  });

  it("KPI directions and floors are spec section 4.9", () => {
    expect(KPI_DIR).toEqual({ sleep_hours: -1, sleep_quality: -1, resting_hr: 1, fatigue: 1, mood: -1 });
    expect(KPI_FLOOR).toEqual({ sleep_hours: 0.5, sleep_quality: 0.5, resting_hr: 3, fatigue: 0.5, mood: 0.5 });
  });

  it("timepoints, mission days and the reference crew", () => {
    expect(PRE_TIMEPOINTS).toEqual(["L-92", "L-44", "L-3"]);
    expect(POST_TIMEPOINTS).toEqual(["R+1", "R+45", "R+82", "R+194"]);
    expect(TIMEPOINTS).toEqual([...PRE_TIMEPOINTS, ...POST_TIMEPOINTS]);
    const days = TIMEPOINTS.map((t: Timepoint) => TIMEPOINT_DAY[t]);
    expect(days).toEqual([-92, -44, -3, 1, 45, 82, 194]);
    expect(REFERENCE_CREW).toEqual(["C001", "C002", "C003", "C004"]);
  });

  it("the fixed signature list equals the fixture signature", () => {
    expect([...CORE_SIGNATURE].sort()).toEqual(["immune:il_10", "immune:il_6", "immune:mcp_1"]);
    expect([...SUPPORTING_SIGNATURE].sort()).toEqual(["cbc:monocytes", "cmp:glucose", "immune:il_27"]);
    const bare = (keys: readonly string[]) => keys.map((k) => k.split(":")[1]).sort();
    expect(bare(CORE_SIGNATURE)).toEqual(Object.keys(SIGNATURE_REFERENCE.signature.core).sort());
    expect(bare(SUPPORTING_SIGNATURE)).toEqual(Object.keys(SIGNATURE_REFERENCE.signature.supporting).sort());
  });

  it("links each app crew member to exactly one Inspiration4 reference panel set", () => {
    expect(APP_CREW_REFERENCE_PANELS).toEqual({ bat: "C001", saraa: "C002", alex: "C003", mira: "C004" });
    expect(new Set(Object.values(APP_CREW_REFERENCE_PANELS)).size).toBe(4);
  });
});
