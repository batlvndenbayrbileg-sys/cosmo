import { describe, expect, it } from "vitest";
import { CORE_SIGNATURE, PRE_TIMEPOINTS, REFERENCE_CREW, S_FLOOR, SUPPORTING_SIGNATURE } from "@/lib/signature/config";
import {
  baseline,
  envelope,
  median,
  pctChange,
  preVals,
  scale,
  signatureScales,
  zscore,
} from "@/lib/signature/engine";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import type { LabMatrix, MarkerKey } from "@/lib/signature/types";
import { getLabData } from "@/server/signature/files";

const { matrix } = getLabData();
const SIGNATURE: readonly MarkerKey[] = [...CORE_SIGNATURE, ...SUPPORTING_SIGNATURE];
const keyOf = (bare: string): MarkerKey => {
  const k = SIGNATURE.find((m) => m.split(":")[1] === bare);
  if (!k) throw new Error(bare);
  return k;
};

/** z at R+1 for C001..C004 */
const zR1 = (key: MarkerKey) => {
  const s = scale(matrix, key);
  return REFERENCE_CREW.map((c) => zscore(matrix, key, c, "R+1", s));
};
const pctR1 = (key: MarkerKey) =>
  REFERENCE_CREW.map((c) => pctChange(matrix[key][c]["R+1"]!, baseline(preVals(matrix[key][c]))));

function expectClose(actual: (number | null)[], expected: number[], tol: number) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((a, i) => {
    expect(a, `index ${i}`).not.toBeNull();
    expect(Math.abs((a as number) - expected[i]), `index ${i}: ${a} vs ${expected[i]}`).toBeLessThanOrEqual(tol);
  });
}

describe("signature T2: baseline helpers", () => {
  it("median follows Python statistics.median (odd: middle, even: mean of the two middle)", () => {
    expect(median([2.67, 2.69, 2.51])).toBe(2.67);
    expect(median([3, 1])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it("preVals reads the three pre-flight draws in order, or the given baseline timepoints", () => {
    const series = matrix["immune:il_6"].C003;
    expect(preVals(series)).toEqual(PRE_TIMEPOINTS.map((t) => series[t]));
    expect(preVals(series)).toEqual([2.67, 2.69, 2.51]);
    expect(preVals(series, ["L-92", "L-3"])).toEqual([2.67, 2.51]);
    expect(preVals({ "L-92": 1, "R+1": 2 })).toEqual([1]);
    expect(baseline(preVals(series))).toBe(2.67);
    expect(baseline([2.67, 2.51])).toBeCloseTo(2.59, 12);
  });
});

describe("signature T2: scale", () => {
  it("scales: il_6 0.1592, mcp_1 0.2694, il_10 0.4436, il_27 0.2091, glucose 0.1185, monocytes 0.1056", () => {
    const expected: Record<string, number> = {
      "immune:il_6": 0.1592,
      "immune:mcp_1": 0.2694,
      "immune:il_10": 0.4436,
      "immune:il_27": 0.2091,
      "cmp:glucose": 0.1185,
      "cbc:monocytes": 0.1056,
    };
    for (const [key, s] of Object.entries(expected)) {
      const got = scale(matrix, key as MarkerKey);
      expect(got, key).not.toBeNull();
      expect(Math.abs((got as number) - s), key).toBeLessThanOrEqual(0.0005);
    }
  });

  it("signatureScales matches the fixture scales_ln for all six markers", () => {
    const S = signatureScales(matrix);
    expect(Object.keys(S).sort()).toEqual([...SIGNATURE].sort());
    for (const [bare, s] of Object.entries(SIGNATURE_REFERENCE.scales_ln)) {
      expect(Math.abs((S[keyOf(bare)] as number) - s), bare).toBeLessThanOrEqual(0.0005);
    }
  });

  it("is always computed on the four reference crew, never on the person being scored", () => {
    // a fifth person with a wild baseline must not change the scale
    const withGuest: LabMatrix = {
      ...matrix,
      "immune:il_6": { ...matrix["immune:il_6"], X999: { "L-92": 1, "L-44": 50, "L-3": 2, "R+1": 3 } },
    };
    expect(scale(withGuest, "immune:il_6")).toBe(scale(matrix, "immune:il_6"));
    // ... and a scale on fewer crew is only used when asked for (leave-one-crew-out)
    expect(scale(matrix, "immune:il_6", ["C001", "C002", "C003"])).not.toBe(scale(matrix, "immune:il_6"));
  });

  it("is floored at ln 1.10 and needs two crew with three positive pre-flight draws", () => {
    const flat: LabMatrix = {
      "immune:x": {
        C001: { "L-92": 10, "L-44": 10, "L-3": 10 },
        C002: { "L-92": 10, "L-44": 10.1, "L-3": 10 },
        C003: { "L-92": 10, "L-3": 10 },
        C004: {},
      },
    };
    expect(scale(flat, "immune:x")).toBe(S_FLOOR);
    const one: LabMatrix = { "immune:x": { C001: { "L-92": 1, "L-44": 2, "L-3": 3 }, C002: { "L-92": 1, "L-3": 2 } } };
    expect(scale(one, "immune:x")).toBeNull();
    const zero: LabMatrix = {
      "immune:x": { C001: { "L-92": 0, "L-44": 2, "L-3": 3 }, C002: { "L-92": 1, "L-44": 2, "L-3": 3 } },
    };
    expect(scale(zero, "immune:x")).toBeNull();
  });
});

describe("signature T2: z at R+1", () => {
  const cases: [MarkerKey, number[]][] = [
    ["immune:il_6", [5.47, 1.56, 6.57, 2.94]],
    ["immune:mcp_1", [1.66, 1.87, 3.87, 0.53]],
    ["immune:il_10", [1.19, 0.29, 0.7, 0.65]],
    ["cbc:monocytes", [1.34, 3.26, 3.07, 1.11]],
    ["cmp:glucose", [0.99, 1.2, 2.68, 1.31]],
    ["immune:il_27", [1.32, 1.4, 1.21, 2.31]],
  ];
  for (const [key, expected] of cases) {
    it(`${key} (C001, C002, C003, C004) = ${expected.join(", ")}`, () => {
      expectClose(zR1(key), expected, 0.01);
    });
  }

  it("matches the fixture evidence z_R1 for all six markers and four crew", () => {
    for (const [bare, ev] of Object.entries(SIGNATURE_REFERENCE.evidence)) {
      expectClose(zR1(keyOf(bare)), REFERENCE_CREW.map((c) => ev.z_R1[c]), 0.01);
    }
  });

  it("returns null without a value, without two baseline draws, without a scale, or for a non-positive value", () => {
    const s = scale(matrix, "immune:il_6");
    expect(zscore(matrix, "immune:il_6", "C003", "R+1", null)).toBeNull();
    expect(zscore(matrix, "cmp:glucose", "C003", "R+45", scale(matrix, "cmp:glucose"))).toBeNull(); // QC-2
    expect(zscore(matrix, "immune:il_6", "C003", "R+1", s, ["L-92"])).toBeNull();
    const m: LabMatrix = { "immune:x": { C001: { "L-92": 1, "L-44": 2, "L-3": 3, "R+1": 0 } } };
    expect(zscore(m, "immune:x", "C001", "R+1", 0.2)).toBeNull();
    expect(zscore(m, "immune:x", "C009", "R+1", 0.2)).toBeNull();
  });

  it("uses the given baseline timepoints (drop-one-draw)", () => {
    const s = scale(matrix, "immune:il_6") as number;
    const ser = matrix["immune:il_6"].C003;
    const z = zscore(matrix, "immune:il_6", "C003", "R+1", s, ["L-44", "L-3"]) as number;
    expect(z).toBeCloseTo(Math.log(ser["R+1"]! / ((ser["L-44"]! + ser["L-3"]!) / 2)) / s, 12);
  });
});

describe("signature T2: % change vs own pre-flight median", () => {
  it("il_6 at R+1: +139.0, +28.3, +184.6, +59.7", () => {
    expectClose(pctR1("immune:il_6"), [139.0, 28.3, 184.6, 59.7], 0.1);
  });

  it("glucose at R+1: +12.5, +15.3, +37.3, +16.9", () => {
    expectClose(pctR1("cmp:glucose"), [12.5, 15.3, 37.3, 16.9], 0.1);
  });

  it("matches the fixture evidence pct_change_R1_vs_median for all six markers", () => {
    for (const [bare, ev] of Object.entries(SIGNATURE_REFERENCE.evidence)) {
      expectClose(pctR1(keyOf(bare)), REFERENCE_CREW.map((c) => ev.pct_change_R1_vs_median[c]), 0.1);
    }
  });
});

describe("signature T2: envelope", () => {
  it("R+1 is hi for il_6, mcp_1, il_10 in all four crew", () => {
    for (const key of CORE_SIGNATURE) {
      for (const c of REFERENCE_CREW) expect(envelope(matrix, key, c, "R+1"), `${key} ${c}`).toBe("hi");
    }
  });

  it("R+1: il_27 is in for C003; glucose and monocytes are in for C004", () => {
    expect(envelope(matrix, "immune:il_27", "C003", "R+1")).toBe("in");
    expect(envelope(matrix, "cmp:glucose", "C004", "R+1")).toBe("in");
    expect(envelope(matrix, "cbc:monocytes", "C004", "R+1")).toBe("in");
  });

  it("is lo below all pre-flight values and null without a value or two baseline draws", () => {
    expect(envelope(matrix, "immune:il_6", "C003", "R+45")).toBe("lo");
    expect(envelope(matrix, "cmp:glucose", "C003", "R+45")).toBeNull();
    expect(envelope(matrix, "immune:il_6", "C003", "R+1", ["L-3"])).toBeNull();
  });

  it("beyond-own-range counts at R+1 match the fixture evidence (core 4 of 4, supporting 3 of 4)", () => {
    for (const [bare, ev] of Object.entries(SIGNATURE_REFERENCE.evidence)) {
      const side = ev.direction > 0 ? "hi" : "lo";
      const n = REFERENCE_CREW.filter((c) => envelope(matrix, keyOf(bare), c, "R+1") === side).length;
      expect(n, bare).toBe(ev.beyond_own_range);
    }
  });
});

describe("signature T2: every marker of the 16 fixture panels", () => {
  it("baseline, fold, z and envelope match the fixture", () => {
    const S = signatureScales(matrix);
    let checked = 0;
    for (const [id, panel] of Object.entries(SIGNATURE_REFERENCE.panels)) {
      const [crew, tp] = id.split("_") as [string, "R+1" | "R+45" | "R+82" | "R+194"];
      for (const [bare, m] of Object.entries(panel.markers)) {
        const key = keyOf(bare);
        const series = matrix[key][crew];
        const b = baseline(preVals(series));
        expect(series[tp], `${id} ${bare} value`).toBe(m.value);
        expect(b, `${id} ${bare} baseline`).toBeCloseTo(m.baseline, 9);
        expect(Math.abs(series[tp]! / b - m.fold), `${id} ${bare} fold`).toBeLessThanOrEqual(0.00005);
        expect(Math.abs((zscore(matrix, key, crew, tp, S[key]) as number) - m.z), `${id} ${bare} z`).toBeLessThanOrEqual(
          0.0005,
        );
        expect(envelope(matrix, key, crew, tp), `${id} ${bare} envelope`).toBe(m.envelope);
        checked += 1;
      }
    }
    expect(checked).toBe(16 * 6 - 3); // QC-2 removed glucose at R+45 for C002, C003, C004
  });
});

describe("signature T2: context markers (not in the index)", () => {
  const lym = "cbc:absolute_lymphocytes" as const;

  it("absolute lymphocytes R+1 vs own median = -26.8, -27.3, +0.1, +20.7 %", () => {
    expectClose(pctR1(lym), [-26.8, -27.3, 0.1, 20.7], 0.1);
  });

  it("absolute lymphocytes R+1 vs L-3 = -38.5, -46.4, -33.9, -26.9 %", () => {
    const got = REFERENCE_CREW.map((c) => pctChange(matrix[lym][c]["R+1"]!, matrix[lym][c]["L-3"]!));
    expectClose(got, [-38.5, -46.4, -33.9, -26.9], 0.1);
    expectClose(got, REFERENCE_CREW.map((c) => SIGNATURE_REFERENCE.lymphocytes[c]["pct_vs_L-3"]), 0.1);
  });

  it("CRP z at R+1 = 0.59, 0.03, 0.54, 0.20 and envelope as in the fixture", () => {
    const key = "cardio:crp" as const;
    const s = scale(matrix, key);
    const got = REFERENCE_CREW.map((c) => zscore(matrix, key, c, "R+1", s));
    expectClose(got, [0.59, 0.03, 0.54, 0.2], 0.01);
    for (const c of REFERENCE_CREW) expect(envelope(matrix, key, c, "R+1"), c).toBe(SIGNATURE_REFERENCE.crp[c].envelope_R1);
  });
});
