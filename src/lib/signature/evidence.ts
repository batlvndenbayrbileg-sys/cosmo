/**
 * Evidence card data (docs/SIGNATURE_SPEC.md sections 1, 1.5 and 8; build prompt T8). Every number is read from the
 * fixture (`evidence`, `loco`, `noise_floor`, `selection`, `lymphocytes`, `crp`, `L44_batch_check`, `qc_log`) or
 * derived from config constants; nothing is hard-coded in the card. The few literature facts that the fixture does not
 * carry (Kim et al. coverage, the urine result, dataset DOIs) are typed constants here with their spec section.
 */

import { CORE_SIGNATURE, EXCLUDED_MARKERS, MIN_EFFECT, PRE_TIMEPOINTS, SUPPORTING_SIGNATURE } from "./config";
import { bareName } from "./engine";
import { SECOND_ASSAY_REFERENCE, SIGNATURE_REFERENCE } from "./reference";
import type { MarkerTier, SecondAssayReference, SignatureReference } from "./types";

/** spec section 1.1: markers reported as significantly increased at R+1 by Kim et al. 2024 (ref. [4]) */
export const KIM_2024_COVERED: ReadonlySet<string> = new Set(["il_6", "mcp_1", "il_10", "il_27"]);

/**
 * spec section 1.4 (OSD-656 urine, not in data/nasa and not used by the engine; the fixture has no urine section):
 * urine IL-6 beyond the own pre-flight range in 1 of the 3 crew with an R+1 urine sample.
 */
export const URINE_PROXY = { beyondOwnRange: 1, crewWithR1: 3 } as const;

/** spec section 11, datasets 1-3 */
export const SIGNATURE_DATASETS: readonly { id: string; doi: string }[] = [
  { id: "OSD-569", doi: "10.26030/e0rx-sh52" },
  { id: "OSD-575", doi: "10.26030/mc5d-p710" },
  { id: "OSD-656", doi: "10.26030/7cax-yj10" },
];

/** spec section 11, paper 4 */
export const KIM_2024_DOI = "10.1038/s41467-024-49211-2";

export interface Share {
  k: number;
  n: number;
}

export interface EvidenceRow {
  name: string;
  tier: MarkerTier;
  /** crew whose R+1 change has the signature's direction */
  direction: Share;
  /** crew with R+1 beyond all own pre-flight values */
  beyond: Share;
  /** leave-one-crew-out folds that selected the marker */
  folds: Share;
  kim: boolean;
}

export interface QcRow {
  id: "QC-1" | "QC-2";
  crew: string;
  timepoint: string;
  analyte: string;
  old: number | null;
  new: number | null;
}

export interface EvidenceView {
  crewCount: number;
  rows: EvidenceRow[];
  core: { observed: number; candidates: number; chance: number; chanceIfL44Uninformative: number };
  loco: {
    selections: number;
    directionHits: number;
    envelopeHits: number;
    /** percent change the selection rule requires (10) */
    minEffectPct: number;
    /** chance of landing beyond all three pre-flight values on one side: 1 / (3 + 1) = 25 % */
    chancePct: number;
    heldoutR1: number[];
    inSampleR1: number[];
    markersInAllFolds: string[];
  };
  noise: { n: number; median: number; max: number };
  lymphocytes: { pctVsMedian: number[]; pctVsL3: number[]; fellVsMedian: number; l3Highest: number };
  crp: { zR1: number[]; insideOwnRange: number };
  urine: typeof URINE_PROXY;
  qc: QcRow[];
  haptoglobinExcluded: boolean;
  l44: { kind: string; lowest: number; n: number; sharePct: number }[];
  /** chance that L-44 is the lowest of three draws: 33 % */
  l44ChancePct: number;
}

const DISPLAY_ORDER = [...CORE_SIGNATURE, ...SUPPORTING_SIGNATURE].map(bareName);

export function buildEvidence(ref: SignatureReference = SIGNATURE_REFERENCE): EvidenceView {
  const folds = Object.values(ref.loco.folds);
  const crew = Object.keys(ref.lymphocytes);
  const tierOf = (name: string): MarkerTier => (name in ref.signature.core ? "core" : "supporting");

  const rows: EvidenceRow[] = DISPLAY_ORDER.filter((name) => name in ref.evidence).map((name) => {
    const ev = ref.evidence[name];
    const pct = Object.values(ev.pct_change_R1_vs_median);
    return {
      name,
      tier: tierOf(name),
      direction: { k: pct.filter((p) => Math.sign(p) === Math.sign(ev.direction)).length, n: pct.length },
      beyond: { k: ev.beyond_own_range, n: pct.length },
      folds: { k: folds.filter((f) => f.core.includes(name) || f.supporting.includes(name)).length, n: folds.length },
      kim: KIM_2024_COVERED.has(name),
    };
  });

  const panelFri = (c: string) => ref.panels[`${c}_R+1`]?.fri ?? null;
  return {
    crewCount: crew.length,
    rows,
    core: {
      observed: Object.keys(ref.signature.core).length,
      candidates: ref.selection.candidates_tested,
      chance: ref.selection.expected_core_by_chance_exchangeable,
      chanceIfL44Uninformative: ref.selection.expected_core_by_chance_if_L44_uninformative,
    },
    loco: {
      selections: ref.loco.total_selected,
      directionHits: ref.loco.total_direction_hits,
      envelopeHits: ref.loco.total_envelope_hits,
      minEffectPct: Math.round((Math.exp(MIN_EFFECT) - 1) * 100),
      chancePct: Math.round(100 / (PRE_TIMEPOINTS.length + 1)),
      heldoutR1: Object.keys(ref.loco.folds).map((c) => ref.loco.folds[c].heldout_fri["R+1"]).filter((x): x is number => x !== null),
      inSampleR1: Object.keys(ref.loco.folds).map(panelFri).filter((x): x is number => x !== null),
      markersInAllFolds: [...ref.loco.markers_selected_in_all_4_folds],
    },
    noise: { n: ref.noise_floor.sorted.length, median: ref.noise_floor.median, max: ref.noise_floor.max },
    lymphocytes: {
      pctVsMedian: crew.map((c) => ref.lymphocytes[c].pct_vs_median),
      pctVsL3: crew.map((c) => ref.lymphocytes[c]["pct_vs_L-3"]),
      fellVsMedian: crew.filter((c) => ref.lymphocytes[c].pct_vs_median < 0).length,
      l3Highest: crew.filter((c) => ref.lymphocytes[c].highest_preflight_draw === "L-3").length,
    },
    crp: {
      zR1: Object.keys(ref.crp).map((c) => ref.crp[c].z_R1),
      insideOwnRange: Object.values(ref.crp).filter((x) => x.envelope_R1 === "in").length,
    },
    urine: URINE_PROXY,
    qc: ref.qc_log.map((q) => ({
      id: q.rule.startsWith("QC1") ? "QC-1" : "QC-2",
      crew: q.crew,
      timepoint: q.timepoint,
      analyte: q.analyte,
      old: q.old,
      new: q.new,
    })),
    haptoglobinExcluded: EXCLUDED_MARKERS.has("cardio:haptoglobin"),
    l44: Object.entries(ref.L44_batch_check).map(([kind, b]) => ({
      kind,
      lowest: b.L44_is_lowest,
      n: b.n,
      sharePct: Math.round(b.share * 100),
    })),
    l44ChancePct: Math.round(100 / PRE_TIMEPOINTS.length),
  };
}

/* ───────────── second assay (addendum sections 1 and 3.2; read from src/data/signature_second_assay.json) ───────────── */

/** the rank-correlation level the second fixture counts pairs at (`agreement["pairs_with_rho_ge_0.5"]`) */
export const AGREEMENT_RHO_GOOD = 0.5;

/** "Second assay" column: agrees (same direction in 4/4 at R+1 on both platforms), not confirmed, or no second method */
export type SecondAssayEvidenceKind = "agrees" | "not_confirmed" | "clinical";

export interface SecondAssayEvidenceRow {
  name: string;
  kind: SecondAssayEvidenceKind;
  /** mean within-person rank correlation between the two platforms; null without a second platform */
  rho: number | null;
}

export interface SecondAssayEvidence {
  rows: SecondAssayEvidenceRow[];
  /** analytes measured on both platforms */
  matchedPairs: number;
  /** typical (median) within-person agreement */
  medianRho: number;
  pairsAtGoodRho: number;
  /** markers moving the same way in all crew at R+1 on both platforms (bare names) */
  sameDirectionBoth: string[];
  l44: { lowest: number; n: number; sharePct: number };
  il6Panels: { sameSign: number; n: number; spearman: number };
}

export function buildSecondAssayEvidence(
  ref: SecondAssayReference = SECOND_ASSAY_REFERENCE,
  base: SignatureReference = SIGNATURE_REFERENCE,
): SecondAssayEvidence {
  const both = new Set(ref.same_direction_4of4_on_both_assays_at_R1);
  const rows: SecondAssayEvidenceRow[] = DISPLAY_ORDER.filter((name) => name in base.evidence).map((name) => {
    const rho = ref.agreement.rho[name];
    if (rho === undefined) return { name, kind: "clinical", rho: null };
    return { name, kind: both.has(name) ? "agrees" : "not_confirmed", rho };
  });
  return {
    rows,
    matchedPairs: ref.agreement.matched_pairs,
    medianRho: ref.agreement.median_within_person_rho,
    pairsAtGoodRho: ref.agreement["pairs_with_rho_ge_0.5"],
    sameDirectionBoth: [...ref.same_direction_4of4_on_both_assays_at_R1],
    l44: {
      lowest: ref.L44_lowest_on_second_assay.lowest,
      n: ref.L44_lowest_on_second_assay.n,
      sharePct: Math.round(ref.L44_lowest_on_second_assay.share * 100),
    },
    il6Panels: { sameSign: ref.il6_16_panels.same_sign, n: Object.keys(ref.panels).length, spearman: ref.il6_16_panels.spearman },
  };
}
