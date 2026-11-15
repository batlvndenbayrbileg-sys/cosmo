/**
 * Signature Triage second-assay cross-check (docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md; port of `read_alamar` in
 * docs/signature_reference/reference_second_assay.py).
 *
 * OSD-575 measured the same serum samples on a second, independent platform (Alamar NULISAseq, 203 proteins, NPQ =
 * log2 units). T11: parse that file into a SecondAssayMatrix. Pure: takes the file contents, never touches the file
 * system (src/server/signature/files.ts reads data/nasa). The main LabMatrix is not touched.
 */

import { REFERENCE_CREW, TIMEPOINTS } from "./config";
import { parseCsv, parseNumericCell } from "./load";
import type { SecondAssayMatrix, Timepoint } from "./types";

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
