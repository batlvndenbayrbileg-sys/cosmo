import { describe, expect, it } from "vitest";
import { POST_TIMEPOINTS, REFERENCE_CREW, RETEST_MAX, RETEST_MIN } from "@/lib/signature/config";
import { scorePanel } from "@/lib/signature/engine";
import {
  etaDays,
  halfLifeBound,
  halfLifeBoundsR1toR45,
  recoveryFor,
  referenceHalfLifeBand,
  round1,
} from "@/lib/signature/recovery";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import type { PanelResult } from "@/lib/signature/types";
import { getLabData } from "@/server/signature/files";

const { matrix } = getLabData();
const panels: Record<string, PanelResult> = {};
for (const c of REFERENCE_CREW) {
  for (const t of POST_TIMEPOINTS) panels[`${c}_${t}`] = scorePanel(matrix, c, t);
}
const r1fri = (id: string) => round1(panels[id].fri as number);

describe("signature T4: half-life bound", () => {
  it("R+1 -> R+45 (dt 44): C001 8.07, C003 17.92, C004 21.47; C002 returns null (FRI rose)", () => {
    const h = (c: string) => halfLifeBound(r1fri(`${c}_R+1`), r1fri(`${c}_R+45`), 44);
    expect(Math.abs((h("C001") as number) - 8.07)).toBeLessThanOrEqual(0.3);
    expect(Math.abs((h("C003") as number) - 17.92)).toBeLessThanOrEqual(0.3);
    expect(Math.abs((h("C004") as number) - 21.47)).toBeLessThanOrEqual(0.3);
    expect(h("C002")).toBeNull();
  });

  it("computed from the scored panels equals the fixture to two decimals", () => {
    const got = halfLifeBoundsR1toR45(Object.values(panels));
    const want = SIGNATURE_REFERENCE.recovery.half_life_upper_bound_days;
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    expect(Object.keys(got).sort()).toEqual(["C001", "C003", "C004"]);
    for (const [c, v] of Object.entries(want)) expect(Math.abs(got[c] - v), c).toBeLessThanOrEqual(0.005);
    // the reference band [8.07, 21.47] is the min / max of the bounds
    const all = Object.values(got);
    expect(Math.abs(Math.min(...all) - SIGNATURE_REFERENCE.recovery.reference_band_all[0])).toBeLessThanOrEqual(0.005);
    expect(Math.abs(Math.max(...all) - SIGNATURE_REFERENCE.recovery.reference_band_all[1])).toBeLessThanOrEqual(0.005);
  });

  it("uses FRI rounded to one decimal (C001 48.2 -> 1.1)", () => {
    expect(r1fri("C001_R+1")).toBe(48.2);
    expect(r1fri("C001_R+45")).toBe(1.1);
    expect(halfLifeBound(48.2, 1.1, 44)).toBeCloseTo((44 * Math.LN2) / Math.log(48.2 / 1.1), 12);
  });

  it("is null when a value is missing, FRI did not fall, or the later FRI is not positive", () => {
    expect(halfLifeBound(null, 10, 44)).toBeNull();
    expect(halfLifeBound(50, null, 44)).toBeNull();
    expect(halfLifeBound(36.9, 53.4, 44)).toBeNull();
    expect(halfLifeBound(30, 30, 44)).toBeNull();
    expect(halfLifeBound(30, 0, 44)).toBeNull();
  });
});

describe("signature T4: ETA and re-test", () => {
  it("reference half-life bands: leave own value out for C001..C004, the full band for anyone else", () => {
    expect(referenceHalfLifeBand("C003")).toEqual([8.07, 21.47]);
    expect(referenceHalfLifeBand("C001")).toEqual([17.92, 21.47]);
    for (const c of REFERENCE_CREW) {
      expect(referenceHalfLifeBand(c)).toEqual(SIGNATURE_REFERENCE.recovery.eta[c].loo_half_life_band);
    }
    expect(referenceHalfLifeBand("bat")).toEqual(SIGNATURE_REFERENCE.recovery.reference_band_all);
    expect(referenceHalfLifeBand("X001")).toEqual([8.07, 21.47]);
  });

  it("C003 R+1: ETA 14.1-37.4 days after the panel, first re-test offset 15 (mission day 16)", () => {
    const r = recoveryFor(panels["C003_R+1"]);
    expect(r).not.toBeNull();
    expect(r!.fri0).toBe(66.9);
    expect(r!.halfLifeBand).toEqual([8.07, 21.47]);
    expect(Math.abs(r!.etaDays[0] - 14.1)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(r!.etaDays[1] - 37.4)).toBeLessThanOrEqual(0.05);
    expect(r!.retestOffset).toBe(15);
    expect(r!.retestMissionDay).toBe(16);
  });

  it("C001 R+1: ETA 22.7-27.2, raw re-test 23 clipped to 21", () => {
    const r = recoveryFor(panels["C001_R+1"])!;
    expect(Math.abs(r.etaDays[0] - 22.7)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(r.etaDays[1] - 27.2)).toBeLessThanOrEqual(0.05);
    expect(r.retestOffsetRaw).toBe(23);
    expect(r.retestOffset).toBe(21);
    expect(r.retestMissionDay).toBe(22);
  });

  it("matches the fixture eta for every crew (fri0, LOO band, ETA, first re-test)", () => {
    for (const c of REFERENCE_CREW) {
      const want = SIGNATURE_REFERENCE.recovery.eta[c];
      expect(r1fri(`${c}_R+1`), c).toBe(want.fri0);
      const [tLo, tHi] = want.loo_half_life_band;
      const e = etaDays(want.fri0, tLo, tHi);
      expect(Math.abs(e.lo - want.eta_days_after_panel[0]), c).toBeLessThanOrEqual(0.05);
      expect(Math.abs(e.hi - want.eta_days_after_panel[1]), c).toBeLessThanOrEqual(0.05);
      expect(e.retest, c).toBe(want.first_retest_day_offset);
    }
  });

  it("etaDays: L = log2(FRI / 20) (C003 L = 1.742) and the re-test clip [3, 21]", () => {
    expect(Math.log2(66.9 / 20)).toBeCloseTo(1.742, 3);
    const e = etaDays(66.9, 8.07, 21.47);
    expect(e.lo).toBeCloseTo(8.07 * Math.log2(66.9 / 20), 12);
    expect(e.retestRaw).toBe(15);
    expect(etaDays(20.5, 1, 2).retest).toBe(RETEST_MIN);
    expect(etaDays(100, 30, 40).retest).toBe(RETEST_MAX);
  });

  it("is only produced for EXPECTED_FLIGHT_RESPONSE panels (non-EXPECTED -> null)", () => {
    for (const [id, p] of Object.entries(panels)) {
      const r = recoveryFor(p);
      if (p.cls === "EXPECTED_FLIGHT_RESPONSE") expect(r, id).not.toBeNull();
      else expect(r, id).toBeNull();
    }
    expect(recoveryFor(panels["C002_R+45"])).toBeNull(); // UNEXPECTED_ACTIVATION
    expect(recoveryFor(panels["C004_R+1"])).toBeNull(); // INDETERMINATE
    expect(recoveryFor({ ...panels["C003_R+1"], fri: null, band: null, cls: "INSUFFICIENT" })).toBeNull();
  });

  it("an explicit half-life band overrides the reference one", () => {
    const r = recoveryFor(panels["C003_R+1"], [10, 20])!;
    expect(r.halfLifeBand).toEqual([10, 20]);
    expect(r.etaDays[0]).toBeCloseTo(10 * Math.log2(66.9 / 20), 12);
  });
});
