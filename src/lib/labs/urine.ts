/**
 * Urine panel (dashboard "Labs" tab): types and pure helpers over src/data/urine_panel.json.
 *
 * The JSON is generated from data/urine/urine_panel_personal_results.xlsx by scripts/urine_xlsx_to_json.py (a
 * teammate's derived analysis of NASA OSDR OSD-656, Inspiration4 urine, Alamar NULISA panel, NPQ = log2 units). It is
 * display only: the labels describe change against the person's own pre-flight samples, not clinical reference ranges.
 *
 * This module never imports the JSON itself, so client code that uses it does not bundle the data. The server reads
 * the file (src/server/labs/urine.ts) and sends one person's slice (GET /api/labs/urine?person=C002).
 */

import { REFERENCE_CREW, type ReferenceCrewId } from "@/lib/signature/config";

/* ───────────── file shape (src/data/urine_panel.json) ───────────── */

export interface UrineSource {
  file: string;
  sha256: string;
  dataset: string;
  assay: string;
  unit: string;
  rows: { results: number; flagged: number; summary: number };
  generatedBy: string;
}

export interface UrineTimepointDef {
  id: string;
  day: number;
  phase: string;
}

export interface UrineStatusDef {
  /** the sheet's Status, e.g. "Abnormal high" */
  label: string;
  /** the sheet's Status_group, e.g. "Abnormal" ("Not" for "Not detected") */
  group: string;
}

/** [timepoint index, NPQ, Change_log2, Fold_change, Z_score, Change_log2_sample_adjusted, status index, note index] */
export type UrinePointRow = [number, number | null, number | null, number | null, number | null, number | null, number, number];

export interface UrineAnalyteBlock {
  analyte: string;
  baseline: number | null;
  low: number | null;
  high: number | null;
  nBaseline: number | null;
  points: UrinePointRow[];
}

export interface UrinePersonBlock {
  person: string;
  /** the time points this person has a urine sample for */
  timepoints: string[];
  analytes: UrineAnalyteBlock[];
}

/** [Person, Timepoint, Normal, Borderline, Abnormal, Insufficient] */
export type UrineSummaryRow = [string, string, number, number, number, number];

export interface UrinePanelFile {
  source: UrineSource;
  method: [string, string][];
  timepoints: UrineTimepointDef[];
  statuses: UrineStatusDef[];
  notes: string[];
  pointColumns: string[];
  persons: UrinePersonBlock[];
  flagged: [string, string, string][];
  summary: { columns: string[]; rows: UrineSummaryRow[] };
}

/** what GET /api/labs/urine sends: the shared tables plus one person's block and summary rows */
export interface UrinePersonSlice {
  source: UrineSource;
  timepoints: UrineTimepointDef[];
  statuses: UrineStatusDef[];
  notes: string[];
  person: UrinePersonBlock;
  summary: UrineSummaryRow[];
}

export function isReferencePerson(id: unknown): id is ReferenceCrewId {
  return typeof id === "string" && (REFERENCE_CREW as readonly string[]).includes(id);
}

export function sliceForPerson(file: UrinePanelFile, person: string): UrinePersonSlice | null {
  const block = file.persons.find((p) => p.person === person);
  if (!block) return null;
  return {
    source: file.source,
    timepoints: file.timepoints,
    statuses: file.statuses,
    notes: file.notes,
    person: block,
    summary: file.summary.rows.filter((r) => r[0] === person),
  };
}

/* ───────────── decoded view ───────────── */

/** the four groups the Labs tab counts and colours (sheet "Not detected" counts as Insufficient) */
export type UrineGroup = "normal" | "borderline" | "abnormal" | "insufficient";
export type UrinePointKind = UrineGroup | "baseline";

export const URINE_GROUPS: readonly UrineGroup[] = ["normal", "borderline", "abnormal", "insufficient"];
export const POST_FLIGHT_TIMEPOINTS = ["R+1", "R+45", "R+82"] as const;

export interface UrinePoint {
  timepoint: string;
  day: number;
  preflight: boolean;
  npq: number | null;
  change: number | null;
  fold: number | null;
  z: number | null;
  adjusted: number | null;
  /** the sheet's Status text */
  status: string;
  kind: UrinePointKind;
  /** "up" / "down" for Borderline and Abnormal (from the status label, else the sign of the change) */
  direction: "up" | "down" | null;
  /** the sheet's Note ("" when none) */
  note: string;
}

export interface UrineAnalyte {
  analyte: string;
  baseline: number | null;
  low: number | null;
  high: number | null;
  nBaseline: number | null;
  points: UrinePoint[];
}

export type UrineCounts = Record<UrineGroup, number>;

export interface UrineTimepointSummary {
  timepoint: string;
  day: number;
  /** false: no urine sample for this person at this time point (C001 has no R+1 urine) */
  sampled: boolean;
  /** the Person_summary sheet's counts; null when there is no sample */
  counts: UrineCounts | null;
}

export interface UrinePersonView {
  person: string;
  source: UrineSource;
  post: UrineTimepointSummary[];
  analytes: UrineAnalyte[];
}

export function kindOf(status: UrineStatusDef, preflight: boolean): UrinePointKind {
  switch (status.group) {
    case "Baseline":
      return "baseline";
    case "Normal":
      return "normal";
    case "Borderline":
      return "borderline";
    case "Abnormal":
      return "abnormal";
    default:
      // "Insufficient" and "Not" (detected); a pre-flight sample that was not detected is still a baseline-phase point
      return preflight ? "baseline" : "insufficient";
  }
}

function directionOf(label: string, change: number | null, kind: UrinePointKind): "up" | "down" | null {
  if (kind !== "borderline" && kind !== "abnormal") return null;
  if (/\bhigh$/i.test(label)) return "up";
  if (/\blow$/i.test(label)) return "down";
  if (change === null || change === 0) return null;
  return change > 0 ? "up" : "down";
}

export function decodePerson(slice: UrinePersonSlice): UrinePersonView {
  const { timepoints, statuses, notes } = slice;
  const analytes: UrineAnalyte[] = slice.person.analytes.map((a) => ({
    analyte: a.analyte,
    baseline: a.baseline,
    low: a.low,
    high: a.high,
    nBaseline: a.nBaseline,
    points: a.points.map(([ti, npq, change, fold, z, adjusted, si, ni]) => {
      const tp = timepoints[ti];
      const status = statuses[si];
      const preflight = tp.day < 0;
      const kind = kindOf(status, preflight);
      return {
        timepoint: tp.id,
        day: tp.day,
        preflight,
        npq,
        change,
        fold,
        z,
        adjusted,
        status: status.label,
        kind,
        direction: directionOf(status.label, change, kind),
        note: notes[ni] ?? "",
      };
    }),
  }));
  const day = (id: string) => timepoints.find((t) => t.id === id)?.day ?? Number.NaN;
  const post = POST_FLIGHT_TIMEPOINTS.map((tp): UrineTimepointSummary => {
    const row = slice.summary.find((r) => r[1] === tp);
    const sampled = slice.person.timepoints.includes(tp);
    return {
      timepoint: tp,
      day: day(tp),
      sampled,
      counts: row && sampled ? { normal: row[2], borderline: row[3], abnormal: row[4], insufficient: row[5] } : null,
    };
  });
  return { person: slice.person.person, source: slice.source, post, analytes };
}

/** counts of the four groups at one time point, computed from the rows (the tests check them against the sheet) */
export function countAt(view: UrinePersonView, timepoint: string): UrineCounts {
  const counts: UrineCounts = { normal: 0, borderline: 0, abnormal: 0, insufficient: 0 };
  for (const a of view.analytes) {
    const p = a.points.find((x) => x.timepoint === timepoint);
    if (p && p.kind !== "baseline") counts[p.kind] += 1;
  }
  return counts;
}

export interface FlaggedAnalyte {
  analyte: UrineAnalyte;
  point: UrinePoint;
}

/** Borderline and Abnormal analytes at one time point: Abnormal first, then by |sample-adjusted change|, then name */
export function flaggedAt(view: UrinePersonView, timepoint: string): FlaggedAnalyte[] {
  const out: FlaggedAnalyte[] = [];
  for (const analyte of view.analytes) {
    const point = analyte.points.find((p) => p.timepoint === timepoint);
    if (point && (point.kind === "abnormal" || point.kind === "borderline")) out.push({ analyte, point });
  }
  const rank = (k: UrinePointKind) => (k === "abnormal" ? 0 : 1);
  return out.sort(
    (a, b) =>
      rank(a.point.kind) - rank(b.point.kind) ||
      Math.abs(b.point.adjusted ?? 0) - Math.abs(a.point.adjusted ?? 0) ||
      a.analyte.analyte.localeCompare(b.analyte.analyte),
  );
}

/** |v| * 10^digits with the binary noise snapped off (2.55 * 10 is 25.499999999999996 as a float; this gives 25.5) */
function scaledOf(v: number, digits: number): number {
  return Number((Math.abs(v) * 10 ** digits).toPrecision(12));
}

function fixed(sign: number, rounded: number, digits: number): string {
  return ((sign < 0 && rounded !== 0 ? -rounded : rounded) / 10 ** digits).toFixed(digits);
}

/**
 * Decimal rounding (half away from zero) of a sheet value, which the workbook stores with 3 decimals. Plain
 * Number.prototype.toFixed rounds the binary float, so 2.55 -> "2.5" and 0.495 -> "0.49"; this gives "2.6" and "0.50".
 */
export function formatDecimal(v: number | null, digits: number): string {
  if (v === null || !Number.isFinite(v)) return "–";
  return fixed(Math.sign(v), Math.round(scaledOf(v, digits)), digits);
}

/**
 * "x15.1": one decimal; below 1 two decimals, so a drop to 0.14 does not read as 0.1. The sheet's Fold_change has 3
 * decimals, so a fold that sits exactly half-way at the shown precision (2.55, 0.495, 0.075) cannot say which way it
 * rounds; the sheet's Change_log2 (fold = 2^change) breaks the tie when it is given (2^1.351 = 2.551 -> "x2.6").
 */
export function formatFold(fold: number | null, change?: number | null): string {
  if (fold === null || !Number.isFinite(fold)) return "–";
  const digits = fold >= 1 ? 1 : 2;
  const scaled = scaledOf(fold, digits);
  let rounded = Math.round(scaled);
  if (scaled % 1 === 0.5 && typeof change === "number" && Number.isFinite(change)) {
    rounded = 2 ** change * 10 ** digits >= scaled ? Math.ceil(scaled) : Math.floor(scaled);
  }
  return `x${fixed(1, rounded, digits)}`;
}

/** i18n key suffix of a sheet Status ("Abnormal high" -> "abnormal_high"); null for text the app does not know */
export function statusKey(status: string): string | null {
  const known = [
    "Baseline",
    "Normal",
    "Borderline high",
    "Borderline low",
    "Abnormal high",
    "Abnormal low",
    "Not detected",
    "Insufficient data",
  ];
  return known.includes(status) ? status.toLowerCase().replace(/\s+/g, "_") : null;
}

/** i18n key suffix of a sheet Note; null for "" and for text the app does not know (shown as written) */
export function noteKey(note: string): string | null {
  const known: Record<string, string> = {
    "Used to set personal baseline": "baseline",
    "Not detected in this sample": "not_detected",
    "Moderate change; confirm before acting": "moderate",
    "Outside range only before sample-level adjustment (possible dilution effect)": "dilution",
    "Outside personal range, also after sample-level adjustment": "outside_both",
    "Baseline has fewer than 2 detected values": "few_baseline",
  };
  return known[note] ?? null;
}
