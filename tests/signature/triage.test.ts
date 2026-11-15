import { describe, expect, it } from "vitest";
import { POST_TIMEPOINTS, REFERENCE_CREW, T_HIGH, T_LOW } from "@/lib/signature/config";
import {
  classify,
  DEFAULT_SIGNATURE,
  fri,
  friBand,
  isBorderline,
  noiseFloor,
  otherLargeChanges,
  scalesFor,
  scorePanel,
  selectSignature,
} from "@/lib/signature/engine";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import type { LabMatrix, PanelResult, Timepoint, TriageClass } from "@/lib/signature/types";
import { getLabData } from "@/server/signature/files";

const { matrix } = getLabData();

const panels: Record<string, PanelResult> = {};
for (const c of REFERENCE_CREW) {
  for (const t of POST_TIMEPOINTS) panels[`${c}_${t}`] = scorePanel(matrix, c, t);
}

const sortedKeys = (g: object) => Object.keys(g).sort();

describe("signature T3: selection rule", () => {
  it("selectSignature on C001..C004 returns core {il_10, il_6, mcp_1}, supporting {monocytes, glucose, il_27}, all +1", () => {
    const sig = selectSignature(matrix, ["C001", "C002", "C003", "C004"]);
    expect(sortedKeys(sig.core)).toEqual(["immune:il_10", "immune:il_6", "immune:mcp_1"]);
    expect(sortedKeys(sig.supporting)).toEqual(["cbc:monocytes", "cmp:glucose", "immune:il_27"]);
    for (const d of [...Object.values(sig.core), ...Object.values(sig.supporting)]) expect(d).toBe(1);
  });

  it("re-derives exactly the fixed signature of config.ts and of the fixture", () => {
    const sig = selectSignature(matrix, REFERENCE_CREW);
    expect(sortedKeys(sig.core)).toEqual(sortedKeys(DEFAULT_SIGNATURE.core));
    expect(sortedKeys(sig.supporting)).toEqual(sortedKeys(DEFAULT_SIGNATURE.supporting));
    const bare = (g: object) => Object.keys(g).map((k) => k.split(":")[1]).sort();
    expect(bare(sig.core)).toEqual(Object.keys(SIGNATURE_REFERENCE.signature.core).sort());
    expect(bare(sig.supporting)).toEqual(Object.keys(SIGNATURE_REFERENCE.signature.supporting).sort());
  });

  it("leave-one-crew-out folds reproduce the fixture (selected markers and held-out FRI)", () => {
    for (const held of REFERENCE_CREW) {
      const train = REFERENCE_CREW.filter((c) => c !== held);
      const sig = selectSignature(matrix, train);
      const fold = SIGNATURE_REFERENCE.loco.folds[held];
      expect(Object.keys(sig.core).map((k) => k.split(":")[1]).sort(), held).toEqual(fold.core);
      expect(Object.keys(sig.supporting).map((k) => k.split(":")[1]).sort(), held).toEqual(fold.supporting);
      const S = scalesFor(matrix, sig, train);
      for (const t of POST_TIMEPOINTS) {
        const got = fri(matrix, sig, S, held, t).value;
        const want = fold.heldout_fri[t];
        if (want === null) expect(got, `${held} ${t}`).toBeNull();
        else expect(Math.abs((got as number) - want), `${held} ${t}`).toBeLessThanOrEqual(0.05);
      }
    }
  });
});

describe("signature T3: FRI, band and class for all 16 panels", () => {
  const table: [string, number, number, number, TriageClass][] = [
    ["C001_R+1", 48.2, 39.7, 60.4, "EXPECTED_FLIGHT_RESPONSE"],
    ["C001_R+45", 1.1, 0.7, 2.8, "BASELINE"],
    ["C001_R+82", 14.2, 13.2, 21.4, "BASELINE"],
    ["C001_R+194", 17.5, 4.1, 22.3, "BASELINE"],
    ["C002_R+1", 36.9, 32.6, 46.4, "INDETERMINATE"],
    ["C002_R+45", 53.4, 49.7, 62.0, "UNEXPECTED_ACTIVATION"],
    ["C002_R+82", 18.2, 13.8, 27.6, "BASELINE"],
    ["C002_R+194", 13.3, 11.0, 13.8, "BASELINE"],
    ["C003_R+1", 66.9, 65.1, 68.2, "EXPECTED_FLIGHT_RESPONSE"],
    ["C003_R+45", 12.2, 11.6, 14.2, "BASELINE"],
    ["C003_R+82", 30.0, 30.0, 34.9, "INDETERMINATE"],
    ["C003_R+194", 56.6, 56.6, 57.4, "UNEXPECTED_ACTIVATION"],
    ["C004_R+1", 36.0, 33.2, 55.0, "INDETERMINATE"],
    ["C004_R+45", 8.7, 8.7, 20.4, "BASELINE"],
    ["C004_R+82", 35.2, 34.6, 48.1, "INDETERMINATE"],
    ["C004_R+194", 10.7, 10.7, 27.2, "BASELINE"],
  ];

  for (const [id, f, lo, hi, cls] of table) {
    it(`${id}: ${f} [${lo}-${hi}] ${cls}`, () => {
      const p = panels[id];
      expect(p.fri).not.toBeNull();
      expect(Math.abs((p.fri as number) - f)).toBeLessThanOrEqual(0.05);
      expect(p.band).not.toBeNull();
      expect(Math.abs(p.band![0] - lo)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.band![1] - hi)).toBeLessThanOrEqual(0.05);
      expect(p.cls).toBe(cls);
    });
  }

  it("the table equals the fixture panels (FRI, band, class) and carries crew, timepoint and mission day", () => {
    expect(Object.keys(SIGNATURE_REFERENCE.panels).sort()).toEqual(Object.keys(panels).sort());
    for (const [id, want] of Object.entries(SIGNATURE_REFERENCE.panels)) {
      const p = panels[id];
      expect(Math.abs((p.fri as number) - (want.fri as number)), id).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.band![0] - (want.band[0] as number)), id).toBeLessThanOrEqual(0.05);
      expect(Math.abs(p.band![1] - (want.band[1] as number)), id).toBeLessThanOrEqual(0.05);
      expect(p.cls, id).toBe(want.class);
      const [crew, tp] = id.split("_");
      expect(p.crew).toBe(crew);
      expect(p.timepoint).toBe(tp);
      expect(p.missionDay).toBe(Number(tp.slice(2)));
    }
  });

  it("per-marker parts (fold, z, q, weight, envelope) match the fixture for every panel", () => {
    for (const [id, want] of Object.entries(SIGNATURE_REFERENCE.panels)) {
      const got = panels[id].markers;
      expect(Object.keys(got).sort(), id).toEqual(Object.keys(want.markers).sort());
      for (const [name, m] of Object.entries(want.markers)) {
        const g = got[name];
        expect(g.tier, `${id} ${name}`).toBe(m.tier);
        expect(g.value, `${id} ${name}`).toBe(m.value);
        expect(Math.abs(g.fold - m.fold), `${id} ${name} fold`).toBeLessThanOrEqual(0.00005);
        expect(Math.abs(g.z - m.z), `${id} ${name} z`).toBeLessThanOrEqual(0.0005);
        expect(Math.abs(g.q - m.q), `${id} ${name} q`).toBeLessThanOrEqual(0.0005);
        expect(g.weight, `${id} ${name}`).toBe(m.weight);
        expect(g.envelope, `${id} ${name}`).toBe(m.envelope);
      }
    }
  });

  it("C003 R+1 marker q: il_6 1.000, mcp_1 0.967, il_10 0.174, monocytes 0.767, glucose 0.669, il_27 0.303", () => {
    const m = panels["C003_R+1"].markers;
    const want: Record<string, number> = {
      il_6: 1.0,
      mcp_1: 0.967,
      il_10: 0.174,
      monocytes: 0.767,
      glucose: 0.669,
      il_27: 0.303,
    };
    for (const [name, q] of Object.entries(want)) expect(Math.abs(m[name].q - q), name).toBeLessThanOrEqual(0.0005);
    // worked example of spec section 4.4
    const byHand = (100 * (1.0 + 0.967 + 0.174 + 0.5 * (0.767 + 0.669 + 0.303))) / 4.5;
    expect(Math.abs((panels["C003_R+1"].fri as number) - byHand)).toBeLessThanOrEqual(0.05);
  });

  it("C003 R+45 has no glucose (QC-2) and still scores 12.2 with renormalised weights", () => {
    const p = panels["C003_R+45"];
    expect(p.markers.glucose).toBeUndefined();
    expect(Object.keys(p.markers)).toHaveLength(5);
    const m = Object.values(p.markers);
    const byHand = (100 * m.reduce((s, x) => s + x.weight * x.q, 0)) / m.reduce((s, x) => s + x.weight, 0);
    expect(m.reduce((s, x) => s + x.weight, 0)).toBe(4);
    expect(p.fri as number).toBeCloseTo(byHand, 9);
    expect(Math.abs((p.fri as number) - 12.2)).toBeLessThanOrEqual(0.05);
  });

  it("friBand is the min / max of the full baseline and the three drop-one-draw baselines", () => {
    const S = scalesFor(matrix, DEFAULT_SIGNATURE);
    const band = friBand(matrix, DEFAULT_SIGNATURE, S, "C004", "R+1")!;
    expect(Math.abs(band[0] - 33.2)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(band[1] - 55.0)).toBeLessThanOrEqual(0.05);
    const full = fri(matrix, DEFAULT_SIGNATURE, S, "C004", "R+1").value as number;
    expect(band[0]).toBeLessThanOrEqual(full);
    expect(band[1]).toBeGreaterThanOrEqual(full);
  });
});

describe("signature T3: classify", () => {
  it("zones at 20 and 40, flight window of 7 days", () => {
    expect(classify(null, 1)).toBe("INSUFFICIENT");
    expect(classify(19.99, 1)).toBe("BASELINE");
    expect(classify(T_LOW, 1)).toBe("INDETERMINATE");
    expect(classify(39.99, 100)).toBe("INDETERMINATE");
    expect(classify(T_HIGH, 7)).toBe("EXPECTED_FLIGHT_RESPONSE");
    expect(classify(T_HIGH, 8)).toBe("UNEXPECTED_ACTIVATION");
  });

  it("a panel with only one core marker returns fri = null, class INSUFFICIENT", () => {
    const strip = (m: LabMatrix, key: "immune:il_6" | "immune:mcp_1", crew: string, t: Timepoint): LabMatrix => {
      const series = { ...m[key][crew] };
      delete series[t];
      return { ...m, [key]: { ...m[key], [crew]: series } };
    };
    const oneCore = strip(strip(matrix, "immune:il_6", "C003", "R+1"), "immune:mcp_1", "C003", "R+1");
    const p = scorePanel(oneCore, "C003", "R+1");
    expect(Object.values(p.markers).filter((m) => m.tier === "core")).toHaveLength(1);
    expect(p.fri).toBeNull();
    expect(p.band).toBeNull();
    expect(p.cls).toBe("INSUFFICIENT");
    expect(p.borderline).toBe(false);
    // the shared matrix is untouched
    expect(matrix["immune:il_6"].C003["R+1"]).toBe(7.6);
  });

  it("a crew member with fewer than two baseline draws is INSUFFICIENT", () => {
    const guest: LabMatrix = {};
    for (const [key, byCrew] of Object.entries(matrix) as [keyof LabMatrix, LabMatrix[keyof LabMatrix]][]) {
      const c = byCrew.C003;
      guest[key] = { ...byCrew, X001: { "L-3": c["L-3"], "R+1": c["R+1"] } };
    }
    expect(scorePanel(guest, "X001", "R+1").cls).toBe("INSUFFICIENT");
  });
});

describe("signature T3: noise floor", () => {
  it("12 control panels, sorted 0.0, 1.2, 4.4, 6.0, 7.8, 7.9, 9.0, 9.3, 18.1, 18.9, 36.5, 37.4", () => {
    const nf = noiseFloor(matrix);
    const want = [0.0, 1.2, 4.4, 6.0, 7.8, 7.9, 9.0, 9.3, 18.1, 18.9, 36.5, 37.4];
    expect(nf.sorted).toHaveLength(12);
    nf.sorted.forEach((v, i) => expect(Math.abs(v - want[i]), `index ${i}`).toBeLessThanOrEqual(0.05));
    for (const [id, v] of Object.entries(SIGNATURE_REFERENCE.noise_floor.pseudo_panels)) {
      expect(Math.abs((nf.pseudoPanels[id] as number) - (v as number)), id).toBeLessThanOrEqual(0.05);
    }
    expect(Math.max(...nf.sorted)).toBeLessThan(T_HIGH);
  });
});

describe("signature T3: borderline", () => {
  const BORDERLINE = [
    "C001_R+1",
    "C001_R+82",
    "C001_R+194",
    "C002_R+1",
    "C002_R+82",
    "C004_R+1",
    "C004_R+45",
    "C004_R+82",
    "C004_R+194",
  ];

  it("is true for exactly nine panels", () => {
    const got = Object.entries(panels)
      .filter(([, p]) => p.borderline)
      .map(([id]) => id)
      .sort();
    expect(got).toEqual([...BORDERLINE].sort());
  });

  it("is false for C003 R+1 and C002 R+45", () => {
    expect(panels["C003_R+1"].borderline).toBe(false);
    expect(panels["C002_R+45"].borderline).toBe(false);
  });

  it("uses band low < T <= band high", () => {
    expect(isBorderline([19, 20])).toBe(true);
    expect(isBorderline([20, 25])).toBe(false);
    expect(isBorderline([39.9, 40])).toBe(true);
    expect(isBorderline([40, 60])).toBe(false);
    expect(isBorderline(null)).toBe(false);
  });
});

describe("signature T3: other large changes", () => {
  it("C002 R+45 -> exactly one entry, il_8, fold 47.04", () => {
    const o = panels["C002_R+45"].otherLargeChanges;
    expect(o).toHaveLength(1);
    expect(o[0].analyte).toBe("il_8");
    expect(Math.abs(o[0].fold - 47.04)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(o[0].fold - SIGNATURE_REFERENCE.c002_il8.fold)).toBeLessThanOrEqual(0.005);
  });

  it("C003 R+1 -> il_13 (8.01), il_22 (4.04)", () => {
    const o = panels["C003_R+1"].otherLargeChanges;
    expect(o.map((x) => x.analyte)).toEqual(["il_13", "il_22"]);
    expect(Math.abs(o[0].fold - 8.01)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(o[1].fold - 4.04)).toBeLessThanOrEqual(0.005);
  });

  it("never lists signature or excluded markers, at most three, sorted by |ln fold|", () => {
    for (const p of Object.values(panels)) {
      expect(p.otherLargeChanges.length).toBeLessThanOrEqual(3);
      const lnf = p.otherLargeChanges.map((x) => Math.abs(Math.log(x.fold)));
      expect(lnf).toEqual([...lnf].sort((a, b) => b - a));
      for (const x of p.otherLargeChanges) {
        expect(["il_6", "mcp_1", "il_10", "il_27", "haptoglobin"]).not.toContain(x.analyte);
        expect(x.fold >= 3 || x.fold <= 1 / 3).toBe(true);
      }
    }
    expect(otherLargeChanges(matrix, "C009", "R+1")).toEqual([]);
  });
});
