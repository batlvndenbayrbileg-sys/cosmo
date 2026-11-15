/**
 * Signature Triage types (docs/PROMPT_SIGNATURE_BUILD.md "Core types", docs/SIGNATURE_SPEC.md sections 3-4).
 * Pure type module: no runtime code, safe for server and client.
 */

/** blood-draw timepoints of the Inspiration4 panels: launch-relative (L-) and landing-relative (R+) days */
export type Timepoint = "L-92" | "L-44" | "L-3" | "R+1" | "R+45" | "R+82" | "R+194";

/** source file of an analyte (spec section 3) */
export type LabFileKind = "cbc" | "cmp" | "cardio" | "immune";

/** analyte key, e.g. 'immune:il_6', 'cmp:glucose', 'cbc:monocytes' */
export type MarkerKey = `${LabFileKind}:${string}`;

/** one analyte series per crew member: timepoint -> value (missing timepoints are absent, never 0) */
export type MarkerSeries = Partial<Record<Timepoint, number>>;

/** every parsed analyte: marker -> crew -> timepoint -> value */
export type LabMatrix = Record<MarkerKey, Record<string /* crew */, MarkerSeries>>;

export type TriageClass =
  | "INSUFFICIENT"
  | "BASELINE"
  | "INDETERMINATE"
  | "EXPECTED_FLIGHT_RESPONSE"
  | "UNEXPECTED_ACTIVATION";

/** position of a value against the crew member's own pre-flight values */
export type Envelope = "hi" | "in" | "lo";

export type MarkerTier = "core" | "supporting";

/** +1: the marker rises in the flight response, -1: it falls */
export type Direction = 1 | -1;

export interface MarkerResult {
  tier: MarkerTier;
  value: number;
  baseline: number;
  fold: number;
  z: number;
  q: number;
  weight: number;
  envelope: Envelope;
}

export interface PanelResult {
  crew: string;
  timepoint: Timepoint;
  missionDay: number;
  fri: number | null;
  band: [number, number] | null;
  cls: TriageClass;
  borderline: boolean;
  markers: Record<string, MarkerResult>;
  otherLargeChanges: { analyte: string; fold: number }[];
  /**
   * second-assay cross-check (addendum T12); present only when the panel was scored with the second-assay matrix
   * (`scorePanelWithSecondAssay`). Absent = no second assay was looked at, the spec templates apply unchanged.
   */
  secondAssay?: SecondAssayResult;
}

/** one change made by QC-1 / QC-2 (spec section 1.5); `new: null` = value deleted */
export interface QcEntry {
  rule: "QC1_cbc_row_shift" | "QC2_glucose_artifact";
  crew: string;
  timepoint: Timepoint;
  analyte: string;
  old: number | null;
  new: number | null;
}

/* ───────────── fixture shape (docs/signature_reference/expected_values.json) ─────────────
 * Raw JSON shape as the reference engine writes it. Enum-like fields stay `string` and pairs stay `number[]`
 * because a JSON import infers those types; typed accessors narrow them where needed. */

export interface FixtureMarker {
  tier: string;
  value: number;
  baseline: number;
  fold: number;
  z: number;
  q: number;
  weight: number;
  envelope: string;
}

export interface FixturePanel {
  fri: number | null;
  band: (number | null)[];
  class: string;
  markers: Record<string, FixtureMarker>;
}

export interface FixtureQcEntry {
  rule: string;
  crew: string;
  timepoint: string;
  analyte: string;
  old: number | null;
  new: number | null;
}

export interface FixtureEvidence {
  file: string;
  direction: number;
  pct_change_R1_vs_median: Record<string, number>;
  beyond_own_range: number;
  z_R1: Record<string, number>;
}

export interface FixtureLocoFold {
  core: string[];
  supporting: string[];
  n_selected: number;
  heldout_ge10pct_predicted_direction: number;
  heldout_beyond_own_range: number;
  heldout_fri: Record<string, number | null>;
}

export interface FixtureEta {
  fri0: number;
  loo_half_life_band: number[];
  eta_days_after_panel: number[];
  first_retest_day_offset: number;
}

export interface FixtureLymphocytes {
  pre: number[];
  median: number;
  "R+1": number;
  pct_vs_median: number;
  "pct_vs_L-3": number;
  highest_preflight_draw: string;
}

export interface FixtureCrp {
  mg_per_L: Record<string, number>;
  z_R1: number;
  envelope_R1: string;
}

export interface FixtureStrainDay {
  input: { sleep_hours: number; sleep_quality: number; resting_hr: number; fatigue: number; mood: number };
  dss: number | null;
}

export interface SignatureReference {
  _readme: string;
  constants: {
    D2_N3: number;
    S_FLOOR: number;
    MIN_EFFECT: number;
    Z_CAP: number;
    W_CORE: number;
    W_SUPP: number;
    T_LOW: number;
    T_HIGH: number;
    WINDOW_DAYS: number;
  };
  qc_log: FixtureQcEntry[];
  signature: { core: Record<string, number>; supporting: Record<string, number> };
  scales_ln: Record<string, number>;
  selection: {
    candidates_tested: number;
    expected_core_by_chance_exchangeable: number;
    expected_core_by_chance_if_L44_uninformative: number;
  };
  evidence: Record<string, FixtureEvidence>;
  panels: Record<string, FixturePanel>;
  noise_floor: {
    pseudo_panels: Record<string, number | null>;
    sorted: number[];
    median: number;
    p75: number;
    max: number;
  };
  loco: {
    folds: Record<string, FixtureLocoFold>;
    total_selected: number;
    total_direction_hits: number;
    total_envelope_hits: number;
    markers_selected_in_all_4_folds: string[];
  };
  recovery: {
    half_life_upper_bound_days: Record<string, number>;
    reference_band_all: number[];
    eta: Record<string, FixtureEta>;
  };
  lymphocytes: Record<string, FixtureLymphocytes>;
  crp: Record<string, FixtureCrp>;
  L44_batch_check: Record<string, { n: number; L44_is_lowest: number; share: number }>;
  c002_il8: { "R+45": number; baseline: number; fold: number };
  daily_strain_test: {
    history_rule: string;
    calm_day: FixtureStrainDay;
    strained_day: FixtureStrainDay;
  };
}

/* ───────────── second assay (docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md, tasks T11-T13) ───────────── */

/**
 * The second, independent serum platform of OSD-575 (Alamar NULISAseq, NPQ = log2 units): analyte (bare name of the
 * `<name>_concentration_npq` column, e.g. 'il6', 'cxcl8') -> crew -> timepoint -> NPQ. Missing samples are absent.
 */
export type SecondAssayMatrix = Record<string /* analyte */, Record<string /* crew */, MarkerSeries>>;

/** addendum section 2: the two-key confirmation of one marker */
export type SecondAssayStatus = "NO_SECOND_ASSAY" | "NOT_APPLICABLE" | "CONFIRMED" | "NOT_CONFIRMED";

/** addendum section 2: panel badge, only for EXPECTED_FLIGHT_RESPONSE and UNEXPECTED_ACTIVATION */
export type SecondAssayBadge = "TWO_ASSAY_CONFIRMED" | "SINGLE_ASSAY";

export interface SecondAssayCheck {
  /** 2^d1 = value / own primary pre-flight median; null when d1 is missing */
  primaryFold: number | null;
  /** 2^d2, d2 = NPQ - own second-assay pre-flight median; null when d2 is missing */
  secondFold: number | null;
  status: SecondAssayStatus;
}

/** `PanelResult.secondAssay` (addendum T12) */
export interface SecondAssayResult {
  il6: SecondAssayCheck;
  il8: SecondAssayCheck;
  /** null for classes other than EXPECTED_FLIGHT_RESPONSE / UNEXPECTED_ACTIVATION */
  badge: SecondAssayBadge | null;
}

/** one marker of one panel in docs/signature_reference/expected_second_assay.json */
export interface FixtureSecondAssayMarker {
  primary_log2: number;
  second_log2: number;
  primary_fold: number;
  second_fold: number;
  status: string;
}

/** raw shape of the second fixture (docs/signature_reference/expected_second_assay.json) */
export interface SecondAssayReference {
  _readme: string;
  CONFIRM_LOG2: number;
  second_assay_analytes: number;
  missing_second_assay_samples: string[];
  panels: Record<string, { il_6: FixtureSecondAssayMarker; il_8: FixtureSecondAssayMarker; class: string; badge: string | null }>;
  signature_cytokines_R1: Record<string, { primary_log2: number[]; second_log2: number[] }>;
  agreement: {
    matched_pairs: number;
    median_within_person_rho: number;
    "pairs_with_rho_ge_0.5": number;
    rho: Record<string, number>;
  };
  same_direction_4of4_on_both_assays_at_R1: string[];
  L44_lowest_on_second_assay: { n: number; lowest: number; share: number };
  il6_16_panels: { spearman: number; same_sign: number };
}
