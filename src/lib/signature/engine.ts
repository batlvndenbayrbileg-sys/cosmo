/**
 * Signature Triage engine (docs/SIGNATURE_SPEC.md section 4; port of the "core maths" of
 * docs/signature_reference/reference_engine.py). Pure and deterministic: every number the UI shows or Cosmo speaks
 * comes from here (build rule 3), checked against the fixture in tests/signature/engine.test.ts.
 *
 * T2: personal baseline, pooled scale, z and envelope (spec sections 4.1-4.2).
 */

import { CORE_SIGNATURE, D2_N3, PRE_TIMEPOINTS, REFERENCE_CREW, S_FLOOR, SUPPORTING_SIGNATURE } from "./config";
import type { Envelope, LabMatrix, MarkerKey, MarkerSeries, Timepoint } from "./types";

/** Python `statistics.median`: middle value, or the mean of the two middle values; throws on no data */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("signature: median of no data");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** `pre_vals`: the values at the baseline timepoints (default: the three pre-flight draws), in order, missing skipped */
export function preVals(series: MarkerSeries | undefined, baseTps: readonly Timepoint[] = PRE_TIMEPOINTS): number[] {
  const out: number[] = [];
  if (!series) return out;
  for (const t of baseTps) {
    const v = series[t];
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** `baseline` b(c,m): median of the baseline values (two values: their mean) */
export function baseline(values: readonly number[]): number {
  return median(values);
}

/** percent change of `value` against `reference`: 100 x (value / reference - 1) */
export function pctChange(value: number, reference: number): number {
  return 100 * (value / reference - 1);
}

/**
 * `scale` s(m), ln units: median over `crew` of ln(max / min) of their three pre-flight draws / d2, floored at
 * ln 1.10. Only crew with three positive pre-flight draws count; fewer than two such crew -> null. Always computed on
 * the reference crew C001..C004 (also when scoring anyone else); a smaller `crew` is for leave-one-crew-out only.
 */
export function scale(matrix: LabMatrix, key: MarkerKey, crew: readonly string[] = REFERENCE_CREW): number | null {
  const ranges: number[] = [];
  for (const c of crew) {
    const p = preVals(matrix[key]?.[c]);
    if (p.length === 3 && Math.min(...p) > 0) ranges.push((Math.log(Math.max(...p)) - Math.log(Math.min(...p))) / D2_N3);
  }
  return ranges.length >= 2 ? Math.max(median(ranges), S_FLOOR) : null;
}

/** scales of the six signature markers, on the reference crew */
export function signatureScales(matrix: LabMatrix): Record<MarkerKey, number | null> {
  const out: Record<MarkerKey, number | null> = {};
  for (const key of [...CORE_SIGNATURE, ...SUPPORTING_SIGNATURE]) out[key] = scale(matrix, key);
  return out;
}

/**
 * `zscore` z(c,m,t) = ln(x / b) / s. Null when there is no scale, no value at `t`, fewer than two baseline values, or
 * a non-positive value or baseline.
 */
export function zscore(
  matrix: LabMatrix,
  key: MarkerKey,
  crew: string,
  t: Timepoint,
  s: number | null,
  baseTps?: readonly Timepoint[],
): number | null {
  const series = matrix[key]?.[crew];
  const x = series?.[t];
  const p = preVals(series, baseTps);
  if (s === null || x === undefined || p.length < 2 || Math.min(...p) <= 0 || x <= 0) return null;
  return Math.log(x / baseline(p)) / s;
}

/** `envelope`: 'hi' above every baseline value, 'lo' below every one, else 'in'; null without a value or 2 baselines */
export function envelope(
  matrix: LabMatrix,
  key: MarkerKey,
  crew: string,
  t: Timepoint,
  baseTps?: readonly Timepoint[],
): Envelope | null {
  const series = matrix[key]?.[crew];
  const x = series?.[t];
  const p = preVals(series, baseTps);
  if (x === undefined || p.length < 2) return null;
  if (x > Math.max(...p)) return "hi";
  if (x < Math.min(...p)) return "lo";
  return "in";
}
