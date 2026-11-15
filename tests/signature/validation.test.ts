import { describe, expect, it } from "vitest";
import { POST_TIMEPOINTS, REFERENCE_CREW } from "@/lib/signature/config";
import { scorePanel } from "@/lib/signature/engine";
import { buildEvidence } from "@/lib/signature/evidence";
import { halfLifeBoundsR1toR45, looHalfLifeBands, recoveryFor } from "@/lib/signature/recovery";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import { l44BatchCheck, leaveOneCrewOut, noiseFloorSummary, selectionStats } from "@/lib/signature/validation";
import type { PanelResult } from "@/lib/signature/types";
import { getLabData } from "@/server/signature/files";

/**
 * T10 fix: the Evidence numbers the cards read from the fixture are recomputed by the engine here and must equal it
 * (leave-one-crew-out hits, noise-floor median / p75, selection statistics, L-44 batch check, leave-own-out half-life
 * bands).
 */

const { matrix } = getLabData();
const REF = SIGNATURE_REFERENCE;

describe("signature T10 fix: leave-one-crew-out hit counts recomputed", () => {
  const loco = leaveOneCrewOut(matrix);

  it("direction hits 24 (6, 6, 6, 6), envelope hits 21 (6, 6, 5, 4), selected 36 (8, 10, 10, 8)", () => {
    expect(loco.totalDirectionHits).toBe(24);
    expect(loco.totalEnvelopeHits).toBe(21);
    expect(loco.totalSelected).toBe(36);
    expect(REFERENCE_CREW.map((c) => loco.folds[c].directionHits)).toEqual([6, 6, 6, 6]);
    expect(REFERENCE_CREW.map((c) => loco.folds[c].envelopeHits)).toEqual([6, 6, 5, 4]);
    expect(REFERENCE_CREW.map((c) => loco.folds[c].nSelected)).toEqual([8, 10, 10, 8]);
  });

  it("every fold and total equals fixture `loco`", () => {
    expect(loco.totalDirectionHits).toBe(REF.loco.total_direction_hits);
    expect(loco.totalEnvelopeHits).toBe(REF.loco.total_envelope_hits);
    expect(loco.totalSelected).toBe(REF.loco.total_selected);
    for (const c of REFERENCE_CREW) {
      const want = REF.loco.folds[c];
      const got = loco.folds[c];
      expect(got.core, c).toEqual(want.core);
      expect(got.supporting, c).toEqual(want.supporting);
      expect(got.nSelected, c).toBe(want.n_selected);
      expect(got.directionHits, c).toBe(want.heldout_ge10pct_predicted_direction);
      expect(got.envelopeHits, c).toBe(want.heldout_beyond_own_range);
      for (const t of POST_TIMEPOINTS) {
        const w = want.heldout_fri[t];
        const g = got.heldoutFri[t];
        if (w === null) expect(g, `${c} ${t}`).toBeNull();
        else expect(Math.abs((g as number) - w), `${c} ${t}`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("markers selected in all four folds: glucose, IL-10, IL-27, IL-6, MCP-1, monocytes (= fixture)", () => {
    expect(loco.selectedInAllFolds).toEqual(["glucose", "il_10", "il_27", "il_6", "mcp_1", "monocytes"]);
    expect(loco.selectedInAllFolds).toEqual(REF.loco.markers_selected_in_all_4_folds);
  });

  it("the Evidence card's held-out, noise and chance numbers equal the recomputed ones", () => {
    const ev = buildEvidence();
    expect(ev.loco.directionHits).toBe(loco.totalDirectionHits);
    expect(ev.loco.envelopeHits).toBe(loco.totalEnvelopeHits);
    expect(ev.loco.selections).toBe(loco.totalSelected);
    expect(ev.loco.markersInAllFolds).toEqual(loco.selectedInAllFolds);
    const nf = noiseFloorSummary(matrix);
    expect(ev.noise).toEqual({ n: nf.sorted.length, median: nf.median, max: nf.max });
    const s = selectionStats(matrix);
    expect(ev.core.candidates).toBe(s.candidatesTested);
    expect(ev.core.chance).toBeCloseTo(s.expectedCoreByChance, 2);
    expect(ev.core.chanceIfL44Uninformative).toBeCloseTo(s.expectedCoreByChanceIfL44Uninformative, 2);
  });
});

describe("signature T10 fix: noise-floor summary recomputed", () => {
  const nf = noiseFloorSummary(matrix);

  it("median 8.4, p75 18.5, max 37.4 over the 12 control panels", () => {
    expect(nf.sorted).toHaveLength(12);
    expect(nf.median).toBe(8.4);
    expect(nf.p75).toBe(18.5);
    expect(nf.max).toBe(37.4);
  });

  it("equals fixture `noise_floor` (sorted, median, p75, max)", () => {
    expect(nf.sorted).toEqual(REF.noise_floor.sorted);
    expect(nf.median).toBe(REF.noise_floor.median);
    expect(nf.p75).toBe(REF.noise_floor.p75);
    expect(nf.max).toBe(REF.noise_floor.max);
  });
});

describe("signature T10 fix: selection statistics recomputed", () => {
  const s = selectionStats(matrix);

  it("106 candidates tested; 0.83 core markers expected by chance, 2.62 if L-44 is uninformative", () => {
    expect(s.candidatesTested).toBe(106);
    expect(s.expectedCoreByChance).toBeCloseTo(0.83, 2);
    expect(s.expectedCoreByChanceIfL44Uninformative).toBeCloseTo(2.62, 2);
  });

  it("equals fixture `selection`", () => {
    expect(s.candidatesTested).toBe(REF.selection.candidates_tested);
    expect(s.expectedCoreByChance).toBeCloseTo(REF.selection.expected_core_by_chance_exchangeable, 2);
    expect(s.expectedCoreByChanceIfL44Uninformative).toBeCloseTo(REF.selection.expected_core_by_chance_if_L44_uninformative, 2);
  });
});

describe("signature T10 fix: L-44 batch check recomputed", () => {
  it("cardiovascular 28 of 35 (0.8), immune 187 of 279 (0.67), = fixture `L44_batch_check`", () => {
    const cardio = l44BatchCheck(matrix, "cardio");
    const immune = l44BatchCheck(matrix, "immune");
    expect([cardio.l44Lowest, cardio.n]).toEqual([28, 35]);
    expect([immune.l44Lowest, immune.n]).toEqual([187, 279]);
    expect(cardio.share).toBeCloseTo(0.8, 3);
    expect(immune.share).toBeCloseTo(0.67, 2);
    for (const [kind, got] of [
      ["cardio", cardio],
      ["immune", immune],
    ] as const) {
      const want = REF.L44_batch_check[kind];
      expect(got.n, kind).toBe(want.n);
      expect(got.l44Lowest, kind).toBe(want.L44_is_lowest);
      expect(got.share, kind).toBeCloseTo(want.share, 3);
    }
  });
});

describe("signature T10 fix: leave-own-out half-life bands derived from the computed bounds", () => {
  const panels: PanelResult[] = [];
  for (const c of REFERENCE_CREW) for (const t of POST_TIMEPOINTS) panels.push(scorePanel(matrix, c, t));
  const bands = looHalfLifeBands(halfLifeBoundsR1toR45(panels));

  it("C001 [17.92, 21.47], C002 [8.07, 21.47], C003 [8.07, 21.47], C004 [8.07, 17.92]", () => {
    expect(bands).toEqual({
      C001: [17.92, 21.47],
      C002: [8.07, 21.47],
      C003: [8.07, 21.47],
      C004: [8.07, 17.92],
    });
  });

  it("equal fixture `recovery.eta[crew].loo_half_life_band` and the band recoveryFor uses", () => {
    for (const c of REFERENCE_CREW) {
      expect(bands[c], c).toEqual(REF.recovery.eta[c].loo_half_life_band);
    }
    for (const p of panels) {
      const rec = recoveryFor(p);
      if (rec) expect(rec.halfLifeBand, `${p.crew} ${p.timepoint}`).toEqual(bands[p.crew]);
    }
  });
});
