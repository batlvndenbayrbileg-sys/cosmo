/**
 * Signature Triage constants and thresholds (docs/SIGNATURE_SPEC.md section 4, docs/PROMPT_SIGNATURE_BUILD.md
 * "Constants"). Build rule 5: every threshold the spec marks ASSUMPTION lives here and nowhere else.
 * Values mirror docs/signature_reference/reference_engine.py; tests/signature/config.test.ts pins them.
 *
 * Tags: A = ASSUMPTION (chosen, not fitted), D = derived from the data.
 */

import type { KpiKey } from "../types";
import type { LabFileKind, MarkerKey, Timepoint } from "./types";

/* ───────────── timepoints and crew ───────────── */

export const PRE_TIMEPOINTS = ["L-92", "L-44", "L-3"] as const satisfies readonly Timepoint[];
export const POST_TIMEPOINTS = ["R+1", "R+45", "R+82", "R+194"] as const satisfies readonly Timepoint[];
export const TIMEPOINTS: readonly Timepoint[] = [...PRE_TIMEPOINTS, ...POST_TIMEPOINTS];

/** timepoint -> mission day (spec section 3); R+N is also "days since landing" */
export const TIMEPOINT_DAY: Record<Timepoint, number> = {
  "L-92": -92,
  "L-44": -44,
  "L-3": -3,
  "R+1": 1,
  "R+45": 45,
  "R+82": 82,
  "R+194": 194,
};

/** the Inspiration4 reference crew (NASA OSDR OSD-569 / OSD-575). `scale` is always computed on these four. */
export const REFERENCE_CREW = ["C001", "C002", "C003", "C004"] as const;
export type ReferenceCrewId = (typeof REFERENCE_CREW)[number];

/**
 * Explicit, labelled link from the app's fictional crew to one Inspiration4 reference panel set (integration map
 * section 4.3, seed order). The engine only ever computes on C001..C004; wherever a linked panel is shown or spoken it
 * is labelled as Inspiration4 reference data, never as blood of the app crew member.
 */
export const APP_CREW_REFERENCE_PANELS: Readonly<Record<string, ReferenceCrewId>> = {
  bat: "C001",
  saraa: "C002",
  alex: "C003",
  mira: "C004",
};

/* ───────────── data files (spec section 3) ───────────── */

/** file kind -> file-name fragment; files are found by fragment under the data folder */
export const FILE_HINTS: Record<LabFileKind, string> = {
  cbc: "CBC",
  cmp: "Metabolic_Panel",
  cardio: "cardiovascular",
  immune: "serum_immune",
};

/** analytes never scored (QC-3 haptoglobin ceiling; derived ratios; basophils / eosinophils) */
export const EXCLUDED_MARKERS: ReadonlySet<MarkerKey> = new Set<MarkerKey>([
  "cardio:haptoglobin",
  "cmp:bun_to_creatinine_ratio",
  "cmp:egfr_african_american",
  "cmp:egfr_non_african_american",
  "cbc:absolute_basophils",
  "cbc:basophils",
  "cbc:absolute_eosinophils",
  "cbc:eosinophils",
]);

/** QC-1: the five CBC differentials as [absolute count, percent] analyte pairs */
export const CBC_DIFFERENTIALS: readonly (readonly [string, string])[] = [
  ["absolute_neutrophils", "neutrophils"],
  ["absolute_lymphocytes", "lymphocytes"],
  ["absolute_monocytes", "monocytes"],
  ["absolute_eosinophils", "eosinophils"],
  ["absolute_basophils", "basophils"],
];

/** QC-1: values deleted from a shifted CBC row */
export const CBC_SUSPECT_NULL: readonly string[] = ["mch", "mchc", "mpv", "platelet_count", "rdw"];

/** QC-1: relative mismatch between absolute and percent x WBC x 10 that marks a shifted row */
export const QC1_MAX_REL_DIFF = 0.15;
/** QC-2 (A): glucose below this (mg/dL) ... */
export const QC2_GLUCOSE_MIN = 50;
/** QC-2 (A): ... in at least this many crew at one timepoint is a pre-analytical artefact */
export const QC2_MIN_CREW = 2;

/* ───────────── signature (spec section 4.3; re-derived by selectSignature in a test) ───────────── */

export const CORE_SIGNATURE: readonly MarkerKey[] = ["immune:il_6", "immune:mcp_1", "immune:il_10"];
export const SUPPORTING_SIGNATURE: readonly MarkerKey[] = ["immune:il_27", "cmp:glucose", "cbc:monocytes"];

/* ───────────── scale, z and FRI (spec sections 4.2-4.7) ───────────── */

/** E[range] / sigma for 3 normal draws (control-chart constant d2) */
export const D2_N3 = 1.693;
/** A: within-person scale never below 10 % (assay imprecision) */
export const S_FLOOR = Math.log(1.1);
/** A: selection needs >= 10 % change in every crew member */
export const MIN_EFFECT = Math.log(1.1);
/** A: 4 scale units = full response for one marker */
export const Z_CAP = 4;
/** A: evidence-tier weights (not fitted) */
export const W_CORE = 1;
export const W_SUPP = 0.5;
/** D: zone thresholds from the pre-flight noise floor (p75 = 18.5, max = 37.4) */
export const T_LOW = 20;
export const T_HIGH = 40;
/** A: transition window after a gravity transition (days) */
export const WINDOW_DAYS = 7;

/** A: "other large changes" (build prompt T3): fold >= this or <= 1 / this, top N by |ln fold| */
export const OTHER_LARGE_FOLD = 3;
export const OTHER_LARGE_TOP = 3;

/* ───────────── recovery and re-test (spec section 4.8) ───────────── */

/** A: clip for the first re-test day after a panel */
export const RETEST_MIN = 3;
export const RETEST_MAX = 21;
/** A5 (A): an UNEXPECTED_ACTIVATION panel sets a re-test this many days later */
export const UNEXPECTED_RETEST_DAYS = 3;

/* ───────────── daily strain score and draw advisor (spec sections 4.9-4.10, all A) ───────────── */

/** the five DSS inputs of the spec */
export type StrainKpi = "sleep_hours" | "sleep_quality" | "resting_hr" | "fatigue" | "mood";

/** +1: higher is worse, -1: lower is worse */
export const KPI_DIR: Readonly<Record<StrainKpi, 1 | -1>> = {
  sleep_hours: -1,
  sleep_quality: -1,
  resting_hr: 1,
  fatigue: 1,
  mood: -1,
};

/** A: scale floors per KPI (0.5 h, 0.5 pt, 3 bpm, 0.5 pt, 0.5 pt) */
export const KPI_FLOOR: Readonly<Record<StrainKpi, number>> = {
  sleep_hours: 0.5,
  sleep_quality: 0.5,
  resting_hr: 3,
  fatigue: 0.5,
  mood: 0.5,
};

/**
 * DSS input -> app check-in KPI (integration map section 4.6). The app has no sleep-quality and no fatigue field;
 * those inputs stay missing for app crew (daily strain skips a KPI with no data). `workload` is not fatigue.
 */
export const STRAIN_KPI_SOURCE: Readonly<Record<StrainKpi, KpiKey | null>> = {
  sleep_hours: "sleep_hours",
  sleep_quality: null,
  resting_hr: "heart_rate",
  fatigue: null,
  mood: "mood",
};

/** previous days that form the DSS reference, and the minimum needed */
export const DSS_HISTORY_DAYS = 14;
export const DSS_MIN_HISTORY = 5;
/** robust SD from the MAD */
export const MAD_TO_SD = 1.4826;
/** per-KPI z clip before averaging */
export const DSS_Z_CAP = 3;

/** A2: DSS >= DSS_TRIGGER on DSS_TRIGGER_DAYS consecutive days and last panel >= MIN_DAYS_BETWEEN_DRAWS ago */
export const DSS_TRIGGER = 50;
export const DSS_TRIGGER_DAYS = 3;
export const MIN_DAYS_BETWEEN_DRAWS = 7;
/** A3: DSS below this on each of the last CALM_DAYS days */
export const DSS_CALM = 25;
export const CALM_DAYS = 7;
/** A3 / A4: a routine draw is due this many days after the last panel */
export const ROUTINE_DAYS = 30;
/** A3: after a skip, re-check in this many days */
export const SKIP_RECHECK_DAYS = 7;
/** kit budget (one kit per imported panel) */
export const KITS_TOTAL = 8;
