import { describe, expect, it } from "vitest";
import { CONFIRM_LOG2, POST_TIMEPOINTS, PRE_TIMEPOINTS, REFERENCE_CREW, SECOND_ASSAY_PAIRS } from "@/lib/signature/config";
import { scorePanel } from "@/lib/signature/engine";
import { assertNumbersGrounded, buildFacts } from "@/lib/signature/facts";
import { SECOND_ASSAY_REFERENCE, SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import {
  devPrimary,
  devSecond,
  scorePanelWithSecondAssay,
  secondAssayBadge,
  secondAssayCheck,
  secondAssayStatus,
} from "@/lib/signature/secondAssay";
import type { PanelResult } from "@/lib/signature/types";
import { getLabData, loadSecondAssay } from "@/server/signature/files";

const { matrix, qcLog } = getLabData();
const second = loadSecondAssay().matrix;
const ids = REFERENCE_CREW.flatMap((c) => POST_TIMEPOINTS.map((t) => `${c}_${t}`));
const panels: Record<string, PanelResult> = {};
for (const c of REFERENCE_CREW) for (const t of POST_TIMEPOINTS) panels[`${c}_${t}`] = scorePanelWithSecondAssay(matrix, second, c, t);

const r2 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const il6 = (id: string) => panels[id].secondAssay!.il6;
const il8 = (id: string) => panels[id].secondAssay!.il8;

describe("signature T12: second-assay cross-check engine", () => {
  it("CONFIRM_LOG2 = 0.5 lives in config.ts and equals the second fixture; the two pairs are IL-6 / il6 and IL-8 / cxcl8", () => {
    expect(CONFIRM_LOG2).toBe(0.5);
    expect(CONFIRM_LOG2).toBe(SECOND_ASSAY_REFERENCE.CONFIRM_LOG2);
    expect(SECOND_ASSAY_PAIRS).toEqual({
      il6: { primary: "immune:il_6", second: "il6" },
      il8: { primary: "immune:il_8", second: "cxcl8" },
    });
  });

  it("status rule: missing -> NO_SECOND_ASSAY, |d1| < 0.5 -> NOT_APPLICABLE, same sign and |d2| >= 0.5 -> CONFIRMED", () => {
    expect(secondAssayStatus(null, 1)).toBe("NO_SECOND_ASSAY");
    expect(secondAssayStatus(1, null)).toBe("NO_SECOND_ASSAY");
    expect(secondAssayStatus(0.49, 2)).toBe("NOT_APPLICABLE");
    expect(secondAssayStatus(-0.49, -2)).toBe("NOT_APPLICABLE");
    expect(secondAssayStatus(0.5, 0.5)).toBe("CONFIRMED");
    expect(secondAssayStatus(-1, -0.6)).toBe("CONFIRMED");
    expect(secondAssayStatus(1, 0.49)).toBe("NOT_CONFIRMED");
    expect(secondAssayStatus(1, -1)).toBe("NOT_CONFIRMED");
    expect(secondAssayBadge("EXPECTED_FLIGHT_RESPONSE", "CONFIRMED")).toBe("TWO_ASSAY_CONFIRMED");
    expect(secondAssayBadge("UNEXPECTED_ACTIVATION", "NOT_APPLICABLE")).toBe("SINGLE_ASSAY");
    for (const cls of ["BASELINE", "INDETERMINATE", "INSUFFICIENT"] as const) expect(secondAssayBadge(cls, "CONFIRMED")).toBeNull();
  });

  it("IL-6 status and folds (primary / second) of the addendum panels", () => {
    const cases: [string, string, number, number][] = [
      ["C001_R+1", "CONFIRMED", 2.39, 1.46],
      ["C003_R+1", "NOT_CONFIRMED", 2.85, 1.06],
      ["C002_R+45", "CONFIRMED", 2.69, 1.98],
      ["C003_R+194", "NOT_CONFIRMED", 2.16, 0.54],
      ["C004_R+1", "CONFIRMED", 1.6, 1.69],
    ];
    for (const [id, status, p, s] of cases) {
      expect(il6(id).status, id).toBe(status);
      expect(r2(il6(id).primaryFold), id).toBe(p);
      expect(r2(il6(id).secondFold), id).toBe(s);
    }
    expect(il6("C002_R+1").status).toBe("NOT_APPLICABLE");
  });

  it("IL-8 C002 R+45 CONFIRMED (47.04 / 40.11)", () => {
    expect(il8("C002_R+45").status).toBe("CONFIRMED");
    expect(r2(il8("C002_R+45").primaryFold)).toBe(47.04);
    expect(r2(il8("C002_R+45").secondFold)).toBe(40.11);
  });

  it("badges: two TWO_ASSAY_CONFIRMED (C001 R+1, C002 R+45), two SINGLE_ASSAY (C003 R+1, C003 R+194), twelve null", () => {
    const by = (b: string | null) => ids.filter((id) => panels[id].secondAssay!.badge === b);
    expect(by("TWO_ASSAY_CONFIRMED")).toEqual(["C001_R+1", "C002_R+45"]);
    expect(by("SINGLE_ASSAY")).toEqual(["C003_R+1", "C003_R+194"]);
    expect(by(null)).toHaveLength(12);
  });

  it("over the 16 panels IL-6 status counts: 4 CONFIRMED, 7 NOT_CONFIRMED, 5 NOT_APPLICABLE", () => {
    const count = (s: string) => ids.filter((id) => il6(id).status === s).length;
    expect([count("CONFIRMED"), count("NOT_CONFIRMED"), count("NOT_APPLICABLE"), count("NO_SECOND_ASSAY")]).toEqual([4, 7, 5, 0]);
  });

  it("C003 baseline on the second assay uses two draws (L-92, L-3)", () => {
    const pre = PRE_TIMEPOINTS.filter((t) => second.il6.C003[t] !== undefined);
    expect(pre).toEqual(["L-92", "L-3"]);
    const mean = (second.il6.C003["L-92"]! + second.il6.C003["L-3"]!) / 2;
    expect(devSecond(second, "il6", "C003", "R+1")).toBeCloseTo(second.il6.C003["R+1"]! - mean, 10);
    // two draws are the minimum: with one left there is no baseline
    const one = { il6: { C003: { "L-92": 10, "R+1": 11 } } };
    expect(devSecond(one, "il6", "C003", "R+1")).toBeNull();
  });

  it("every panel and both markers equal the second fixture (log2 and folds to 2 decimals, status, class, badge)", () => {
    for (const id of ids) {
      const [c, t] = id.split("_") as [string, (typeof POST_TIMEPOINTS)[number]];
      const f = SECOND_ASSAY_REFERENCE.panels[id];
      for (const [m, pair, fm] of [
        ["il6", SECOND_ASSAY_PAIRS.il6, f.il_6],
        ["il8", SECOND_ASSAY_PAIRS.il8, f.il_8],
      ] as const) {
        const ch = secondAssayCheck(matrix, second, pair, c, t);
        expect(ch.primaryLog2!, `${id} ${m}`).toBeCloseTo(fm.primary_log2, 2);
        expect(ch.secondLog2!, `${id} ${m}`).toBeCloseTo(fm.second_log2, 2);
        expect(ch.primaryFold!, `${id} ${m}`).toBeCloseTo(fm.primary_fold, 2);
        expect(ch.secondFold!, `${id} ${m}`).toBeCloseTo(fm.second_fold, 2);
        expect(ch.status, `${id} ${m}`).toBe(fm.status);
      }
      expect(panels[id].cls, id).toBe(f.class);
      expect(panels[id].cls, id).toBe(SIGNATURE_REFERENCE.panels[id].class);
      expect(panels[id].secondAssay!.badge, id).toBe(f.badge);
    }
  });

  it("R+1 change of the four signature cytokines on both platforms equals the fixture", () => {
    const pairs = { il_6: "il6", mcp_1: "ccl2", il_10: "il10", il_27: "il27" } as const;
    for (const [m, a] of Object.entries(pairs)) {
      const f = SECOND_ASSAY_REFERENCE.signature_cytokines_R1[m];
      REFERENCE_CREW.forEach((c, i) => {
        expect(devPrimary(matrix, `immune:${m}`, c, "R+1")!, `${m} ${c}`).toBeCloseTo(f.primary_log2[i], 2);
        expect(devSecond(second, a, c, "R+1")!, `${a} ${c}`).toBeCloseTo(f.second_log2[i], 2);
      });
    }
  });

  it("FRI, band and class are unchanged by the cross-check (primary platform only)", () => {
    for (const id of ids) {
      const [c, t] = id.split("_") as [string, (typeof POST_TIMEPOINTS)[number]];
      const { secondAssay, ...rest } = panels[id];
      expect(secondAssay).toBeDefined();
      expect(rest, id).toEqual(scorePanel(matrix, c, t));
    }
    expect(scorePanel(matrix, "C001", "R+1").secondAssay).toBeUndefined();
  });

  it("buildFacts carries the cross-check with spoken folds, and allowedNumbers include them", () => {
    const a = buildFacts(panels["C001_R+1"], { lang: "en", qcLog });
    expect(a.secondAssay).toEqual({
      lead: { marker: "IL-6", status: "CONFIRMED", primaryFoldRounded: "2.4", secondFoldRounded: "1.5" },
      chemokine: { marker: "IL-8", status: "NOT_APPLICABLE", primaryFoldRounded: "1.1", secondFoldRounded: "0.4" },
      badge: "TWO_ASSAY_CONFIRMED",
    });
    for (const n of ["2.4", "1.5", "1.1", "0.4"]) expect(a.allowedNumbers, n).toContain(n);
    const c2 = buildFacts(panels["C002_R+45"], { lang: "en", previous: panels["C002_R+1"], qcLog });
    expect([c2.secondAssay!.chemokine.primaryFoldRounded, c2.secondAssay!.chemokine.secondFoldRounded, c2.secondAssay!.badge]).toEqual([
      "47",
      "40",
      "TWO_ASSAY_CONFIRMED",
    ]);
    for (const n of ["47", "40", "2.7", "2.0"]) expect(c2.allowedNumbers, n).toContain(n);
    const d = buildFacts(panels["C003_R+194"], { lang: "en", qcLog });
    expect([d.secondAssay!.lead.primaryFoldRounded, d.secondAssay!.lead.secondFoldRounded, d.secondAssay!.badge]).toEqual([
      "2.2",
      "0.5",
      "SINGLE_ASSAY",
    ]);
    // every number in the facts JSON is allowed (for C003 R+194 the second-assay part: its other large changes list
    // I-309, a one-letter analyte label the T6 token list does not strip); without the second assay: null
    for (const f of [a, c2]) {
      const { allowedNumbers, ...rest } = f;
      expect(assertNumbersGrounded(JSON.stringify(rest), { allowedNumbers })).toBe(true);
    }
    expect(assertNumbersGrounded(JSON.stringify(d.secondAssay), d)).toBe(true);
    expect(buildFacts(scorePanel(matrix, "C001", "R+1"), { lang: "en" }).secondAssay).toBeNull();
  });
});
