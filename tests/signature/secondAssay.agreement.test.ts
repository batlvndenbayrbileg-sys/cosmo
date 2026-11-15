import { describe, expect, it } from "vitest";
import { buildSecondAssayEvidence } from "@/lib/signature/evidence";
import { SECOND_ASSAY_REFERENCE } from "@/lib/signature/reference";
import {
  il6SixteenPanels,
  l44LowestOnSecondAssay,
  sameDirectionOnBothAssays,
  secondAssayAgreement,
  spearman,
} from "@/lib/signature/secondAssayAgreement";
import { getLabData, loadSecondAssay } from "@/server/signature/files";

/**
 * T10 fix: the second-assay agreement numbers the Evidence card reads from the second fixture are recomputed from the
 * two CSV matrices here and must equal it.
 */

const { matrix } = getLabData();
const second = loadSecondAssay().matrix;
const REF = SECOND_ASSAY_REFERENCE;

describe("signature T10 fix: spearman (port of the reference)", () => {
  it("ranks by a stable sort and correlates the ranks", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
    expect(spearman([1], [1])).toBeNull();
  });
});

describe("signature T10 fix: second-assay agreement recomputed", () => {
  const agr = secondAssayAgreement(matrix, second);

  it("55 matched pairs, median rho 0.09, 4 pairs with rho >= 0.5", () => {
    expect(agr.matchedPairs).toBe(55);
    expect(agr.medianRho).toBe(0.09);
    expect(agr.pairsWithGoodRho).toBe(4);
  });

  it("per-marker rho: IL-6 0.65, IL-8 0.39, MCP-1 0.37, IL-10 -0.02, IL-27 -0.12", () => {
    expect(agr.rho.il_6).toBe(0.65);
    expect(agr.rho.il_8).toBe(0.39);
    expect(agr.rho.mcp_1).toBe(0.37);
    expect(agr.rho.il_10).toBe(-0.02);
    expect(agr.rho.il_27).toBe(-0.12);
  });

  it("equals fixture `agreement`", () => {
    expect(agr.matchedPairs).toBe(REF.agreement.matched_pairs);
    expect(agr.medianRho).toBe(REF.agreement.median_within_person_rho);
    expect(agr.pairsWithGoodRho).toBe(REF.agreement["pairs_with_rho_ge_0.5"]);
    for (const [m, r] of Object.entries(REF.agreement.rho)) expect(agr.rho[m], m).toBe(r);
  });

  it("same direction 4 of 4 on both assays at R+1: only IL-6 (= fixture)", () => {
    const both = sameDirectionOnBothAssays(matrix, second);
    expect(both).toEqual(["il_6"]);
    expect(both).toEqual(REF.same_direction_4of4_on_both_assays_at_R1);
  });

  it("L-44 lowest on the second assay: 109 of 609 (0.18) (= fixture)", () => {
    const l44 = l44LowestOnSecondAssay(second);
    expect([l44.lowest, l44.n]).toEqual([109, 609]);
    expect(l44.share).toBeCloseTo(0.18, 2);
    expect(l44.n).toBe(REF.L44_lowest_on_second_assay.n);
    expect(l44.lowest).toBe(REF.L44_lowest_on_second_assay.lowest);
    expect(l44.share).toBeCloseTo(REF.L44_lowest_on_second_assay.share, 2);
  });

  it("IL-6 over the 16 panels: Spearman 0.63, 13 same-sign panels (= fixture)", () => {
    const il6 = il6SixteenPanels(matrix, second);
    expect(il6.n).toBe(16);
    expect(il6.spearman as number).toBeCloseTo(0.63, 2);
    expect(il6.sameSign).toBe(13);
    expect(il6.spearman as number).toBeCloseTo(REF.il6_16_panels.spearman, 2);
    expect(il6.sameSign).toBe(REF.il6_16_panels.same_sign);
  });

  it("the Evidence card's second-assay numbers equal the recomputed ones", () => {
    const ev = buildSecondAssayEvidence();
    expect(ev.matchedPairs).toBe(agr.matchedPairs);
    expect(ev.medianRho).toBe(agr.medianRho);
    expect(ev.pairsAtGoodRho).toBe(agr.pairsWithGoodRho);
    for (const row of ev.rows) if (row.rho !== null) expect(row.rho, row.name).toBe(agr.rho[row.name]);
    expect(ev.sameDirectionBoth).toEqual(sameDirectionOnBothAssays(matrix, second));
    const l44 = l44LowestOnSecondAssay(second);
    expect(ev.l44).toEqual({ lowest: l44.lowest, n: l44.n, sharePct: Math.round(l44.share * 100) });
    const il6 = il6SixteenPanels(matrix, second);
    expect(ev.il6Panels.sameSign).toBe(il6.sameSign);
    expect(ev.il6Panels.n).toBe(il6.n);
    expect(ev.il6Panels.spearman).toBeCloseTo(il6.spearman as number, 2);
  });
});
