/**
 * Signature Triage second-assay cross-check (docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md; port of `read_alamar` in
 * docs/signature_reference/reference_second_assay.py).
 *
 * OSD-575 measured the same serum samples on a second, independent platform (Alamar NULISAseq, 203 proteins, NPQ =
 * log2 units). T11: parse that file into a SecondAssayMatrix. Pure: takes the file contents, never touches the file
 * system (src/server/signature/files.ts reads data/nasa). The main LabMatrix is not touched.
 */

import { CONFIRM_LOG2, REFERENCE_CREW, SECOND_ASSAY_PAIRS, TIMEPOINTS } from "./config";
import { median, preVals, scorePanel, type ScorePanelOptions } from "./engine";
import { parseCsv, parseNumericCell } from "./load";
import type {
  LabMatrix,
  MarkerKey,
  PanelResult,
  SecondAssayBadge,
  SecondAssayCheck,
  SecondAssayMatrix,
  SecondAssayResult,
  SecondAssayStatus,
  Timepoint,
  TriageClass,
} from "./types";

/** file-name fragment of the second-assay CSV (addendum T11) */
export const SECOND_ASSAY_FILE_HINT = "Alamar";

/** value columns of the second assay: `<analyte>_concentration_npq` (the `*_percent_normalized_value` columns are ignored) */
const NPQ_COLUMN = /^(.+)_concentration_npq$/;

const TIMEPOINT_SET: ReadonlySet<string> = new Set(TIMEPOINTS);

export interface SecondAssayTable {
  /** analyte -> crew -> timepoint -> NPQ */
  matrix: SecondAssayMatrix;
  /** the sample rows read (`C001_serum_L-92`: part 0 crew, part 2 timepoint) */
  rows: { crew: string; timepoint: Timepoint }[];
}

/**
 * `loadSecondAssay` / `read_alamar`: BOM dropped, first column `Sample ID` (`C001_serum_L-92`), every
 * `^(.+)_concentration_npq$` column; a cell that is not a number is missing, never 0.
 */
export function parseSecondAssay(text: string): SecondAssayTable {
  const [header, ...body] = parseCsv(text);
  const cols = new Map<string, number>();
  header.forEach((c, i) => {
    if (i === 0) return;
    const m = NPQ_COLUMN.exec(c);
    if (m) cols.set(m[1], i);
  });
  const matrix: SecondAssayMatrix = {};
  for (const a of cols.keys()) {
    matrix[a] = {};
    for (const crew of REFERENCE_CREW) matrix[a][crew] = {};
  }
  const rows: SecondAssayTable["rows"] = [];
  for (const r of body) {
    const parts = (r[0] ?? "").split("_");
    const crew = parts[0];
    const tp = parts[2];
    if (!crew || !tp || !TIMEPOINT_SET.has(tp)) continue;
    const timepoint = tp as Timepoint;
    rows.push({ crew, timepoint });
    for (const [a, i] of cols) {
      const v = parseNumericCell(r[i]);
      if (v === null) continue;
      (matrix[a][crew] ??= {})[timepoint] = v;
    }
  }
  return { matrix, rows };
}

/* ───────────── T12: cross-check engine (port of dev_primary, dev_second, status and the badge rule) ───────────── */

/**
 * `dev_primary`: d1 = log2(value / own primary pre-flight median); null without a value at `t`, fewer than two
 * pre-flight draws, or a non-positive value / median (log undefined).
 */
export function devPrimary(matrix: LabMatrix, key: MarkerKey, crew: string, t: Timepoint): number | null {
  const series = matrix[key]?.[crew];
  const x = series?.[t];
  const p = preVals(series);
  if (x === undefined || p.length < 2) return null;
  const b = median(p);
  if (x <= 0 || b <= 0) return null;
  return Math.log2(x / b);
}

/** `dev_second`: d2 = NPQ - own second-assay pre-flight median (NPQ is already log2); null as for d1 */
export function devSecond(second: SecondAssayMatrix, analyte: string, crew: string, t: Timepoint): number | null {
  const series = second[analyte]?.[crew];
  const x = series?.[t];
  const p = preVals(series);
  if (x === undefined || p.length < 2) return null;
  return x - median(p);
}

/** `status` (addendum section 2) */
export function secondAssayStatus(d1: number | null, d2: number | null): SecondAssayStatus {
  if (d1 === null || d2 === null) return "NO_SECOND_ASSAY";
  if (Math.abs(d1) < CONFIRM_LOG2) return "NOT_APPLICABLE";
  return d1 > 0 === d2 > 0 && Math.abs(d2) >= CONFIRM_LOG2 ? "CONFIRMED" : "NOT_CONFIRMED";
}

/** the badge: only for EXPECTED_FLIGHT_RESPONSE and UNEXPECTED_ACTIVATION; TWO_ASSAY_CONFIRMED iff IL-6 is CONFIRMED */
export function secondAssayBadge(cls: TriageClass, il6: SecondAssayStatus): SecondAssayBadge | null {
  if (cls !== "EXPECTED_FLIGHT_RESPONSE" && cls !== "UNEXPECTED_ACTIVATION") return null;
  return il6 === "CONFIRMED" ? "TWO_ASSAY_CONFIRMED" : "SINGLE_ASSAY";
}

/** one marker's two-key check: folds 2^d1 / 2^d2 (unrounded) and the status */
export function secondAssayCheck(
  matrix: LabMatrix,
  second: SecondAssayMatrix,
  pair: { primary: MarkerKey; second: string },
  crew: string,
  t: Timepoint,
): SecondAssayCheck & { primaryLog2: number | null; secondLog2: number | null } {
  const d1 = devPrimary(matrix, pair.primary, crew, t);
  const d2 = devSecond(second, pair.second, crew, t);
  return {
    primaryLog2: d1,
    secondLog2: d2,
    primaryFold: d1 === null ? null : 2 ** d1,
    secondFold: d2 === null ? null : 2 ** d2,
    status: secondAssayStatus(d1, d2),
  };
}

const strip = ({ primaryFold, secondFold, status }: SecondAssayCheck): SecondAssayCheck => ({ primaryFold, secondFold, status });

/** `PanelResult.secondAssay` of one panel (the class decides whether a badge is given) */
export function secondAssayFor(
  matrix: LabMatrix,
  second: SecondAssayMatrix,
  crew: string,
  t: Timepoint,
  cls: TriageClass,
): SecondAssayResult {
  const il6 = strip(secondAssayCheck(matrix, second, SECOND_ASSAY_PAIRS.il6, crew, t));
  const il8 = strip(secondAssayCheck(matrix, second, SECOND_ASSAY_PAIRS.il8, crew, t));
  return { il6, il8, badge: secondAssayBadge(cls, il6.status) };
}

/** `scorePanel` plus the second-assay cross-check; FRI, band and class are unchanged (primary platform only) */
export function scorePanelWithSecondAssay(
  matrix: LabMatrix,
  second: SecondAssayMatrix,
  crew: string,
  t: Timepoint,
  options: ScorePanelOptions = {},
): PanelResult {
  const panel = scorePanel(matrix, crew, t, options);
  return { ...panel, secondAssay: secondAssayFor(matrix, second, crew, t, panel.cls) };
}
