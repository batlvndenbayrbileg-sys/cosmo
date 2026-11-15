/**
 * Signature Triage loader: CSV text -> LabMatrix + qcLog (docs/SIGNATURE_SPEC.md sections 1.5 and 3; port of
 * `read_table` / `load_all` in docs/signature_reference/reference_engine.py).
 *
 * Pure: takes file contents, never touches the file system (src/server/signature/files.ts reads data/nasa). The data
 * files are read-only; QC-1 and QC-2 are re-applied in code on every load and every change is returned in `qcLog`.
 */

import {
  CBC_DIFFERENTIALS,
  CBC_SUSPECT_NULL,
  QC1_MAX_REL_DIFF,
  QC2_GLUCOSE_MIN,
  QC2_MIN_CREW,
  REFERENCE_CREW,
  TIMEPOINTS,
} from "./config";
import type { LabFileKind, LabMatrix, MarkerKey, MarkerSeries, QcEntry, Timepoint } from "./types";

/** the four lab files the engine reads, as text */
export type LabFiles = Record<LabFileKind, string>;

export interface LabTableRow {
  crew: string;
  timepoint: Timepoint;
}

/** one parsed file: analyte (without the file prefix) -> crew -> timepoint -> value, plus the sample rows read */
export interface LabTable {
  analytes: Record<string, Record<string, MarkerSeries>>;
  rows: LabTableRow[];
}

export interface LabData {
  matrix: LabMatrix;
  qcLog: QcEntry[];
}

const TIMEPOINT_SET: ReadonlySet<string> = new Set(TIMEPOINTS);

/**
 * Minimal RFC 4180 reader with the behaviour of Python's `csv.reader` on these files: a leading UTF-8 BOM is dropped
 * (`encoding='utf-8-sig'`), rows end at `\n` or `\r\n`, double-quoted fields may contain commas, quotes ("") and
 * line breaks. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    field = "";
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r" && src[i + 1] === "\n") {
      endRow();
      i += 2;
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** a cell that is not a plain number ('NA', 'N/A', empty) is missing (null), never 0 */
export function parseNumericCell(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const s = cell.trim();
  if (!NUMERIC.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** column name -> analyte name, or null when the column is not a value column (spec section 3) */
function analyteOf(column: string, kind: LabFileKind): string | null {
  const m = kind === "cbc" || kind === "cmp" ? /^(.+?)_value(?:_.+)?$/.exec(column) : /^(.+)_concentration_.+$/.exec(column);
  return m ? m[1] : null;
}

/**
 * Parse one lab file. First column `Sample Name` = `<crew>_<matrix>_<timepoint>[_<suffix>]`
 * (`C001_whole-blood_R+1_cbc`, `C001_serum_R+1`). CBC/CMP use `*_value*` columns, the multiplex files
 * `*_concentration_*` columns (their `*_percent` columns are relative values and are ignored). When two columns map to
 * the same analyte the later one wins (as in the reference engine).
 */
export function parseLabTable(text: string, kind: LabFileKind): LabTable {
  const [header, ...body] = parseCsv(text);
  const cols = new Map<string, number>();
  header.forEach((c, i) => {
    if (i === 0 || !c) return;
    const a = analyteOf(c, kind);
    if (a !== null) cols.set(a, i);
  });
  const analytes: LabTable["analytes"] = {};
  for (const a of cols.keys()) {
    analytes[a] = {};
    for (const crew of REFERENCE_CREW) analytes[a][crew] = {};
  }
  const rows: LabTableRow[] = [];
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
      (analytes[a][crew] ??= {})[timepoint] = v;
    }
  }
  return { analytes, rows };
}

/** Python's round(): half to even (QC-1 rebuilds counts with it) */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const FILE_ORDER: readonly LabFileKind[] = ["cbc", "cmp", "cardio", "immune"];

/** series of `key` for `crew`, created empty when absent (keeps QC code free of undefined checks) */
function seriesOf(matrix: LabMatrix, key: MarkerKey, crew: string): MarkerSeries {
  const byCrew = (matrix[key] ??= {});
  return (byCrew[crew] ??= {});
}

/** parse the four files, then apply QC-1 and QC-2; returns a fresh matrix and the QC log */
export function buildLabMatrix(files: LabFiles): LabData {
  const matrix: LabMatrix = {};
  for (const kind of FILE_ORDER) {
    const { analytes } = parseLabTable(files[kind], kind);
    for (const [a, byCrew] of Object.entries(analytes)) matrix[`${kind}:${a}`] = byCrew;
  }
  const qcLog: QcEntry[] = [];

  // QC-1  CBC row integrity: an absolute differential must equal percent x WBC x 10 (cells/uL)
  for (const crew of REFERENCE_CREW) {
    const w = matrix["cbc:white_blood_cell_count"]?.[crew] ?? {};
    for (const t of TIMEPOINTS) {
      const wv = w[t];
      if (wv === undefined) continue;
      let bad = false;
      for (const [abs, pct] of CBC_DIFFERENTIALS) {
        const av = matrix[`cbc:${abs}`]?.[crew]?.[t];
        const pv = matrix[`cbc:${pct}`]?.[crew]?.[t];
        if (av === undefined || pv === undefined) continue;
        const expected = pv * wv * 10;
        if (expected > 0 && Math.abs(av - expected) / expected > QC1_MAX_REL_DIFF) bad = true;
      }
      if (!bad) continue;
      for (const [abs, pct] of CBC_DIFFERENTIALS) {
        const pv = matrix[`cbc:${pct}`]?.[crew]?.[t];
        if (pv === undefined) continue;
        const s = seriesOf(matrix, `cbc:${abs}`, crew);
        const old = s[t] ?? null;
        const next = roundHalfEven(pv * wv * 10);
        s[t] = next;
        qcLog.push({ rule: "QC1_cbc_row_shift", crew, timepoint: t, analyte: abs, old, new: next });
      }
      for (const a of CBC_SUSPECT_NULL) {
        const s = matrix[`cbc:${a}`]?.[crew];
        if (s === undefined || s[t] === undefined) continue;
        qcLog.push({ rule: "QC1_cbc_row_shift", crew, timepoint: t, analyte: a, old: s[t], new: null });
        delete s[t];
      }
    }
  }

  // QC-2  glucose < 50 mg/dL in >= 2 crew at the same timepoint -> pre-analytical artefact, drop those values
  const glucose = matrix["cmp:glucose"];
  if (glucose) {
    for (const t of TIMEPOINTS) {
      const low = REFERENCE_CREW.filter((c) => {
        const v = glucose[c]?.[t];
        return v !== undefined && v < QC2_GLUCOSE_MIN;
      });
      if (low.length < QC2_MIN_CREW) continue;
      for (const c of low) {
        qcLog.push({ rule: "QC2_glucose_artifact", crew: c, timepoint: t, analyte: "glucose", old: glucose[c][t] ?? null, new: null });
        delete glucose[c][t];
      }
    }
  }
  return { matrix, qcLog };
}
