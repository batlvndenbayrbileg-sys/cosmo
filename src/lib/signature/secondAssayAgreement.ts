/**
 * Second-assay agreement statistics (docs/SIGNATURE_ADDENDUM_SECOND_ASSAY.md section 1; port of the agreement part of
 * docs/signature_reference/reference_second_assay.py `main`). Pure and deterministic.
 *
 * The Evidence card reads these numbers from the second fixture (addendum T13 allows it); this module recomputes them
 * from the two matrices so a test can check that the fixture and the engine agree (T10 fix): matched pairs, median
 * within-person Spearman rho, pairs with rho >= 0.5, per-marker rho, the 4-of-4 same-direction list, the L-44 check on
 * the second assay and the IL-6 16-panel Spearman with its same-sign count.
 */

import { POST_TIMEPOINTS, PRE_TIMEPOINTS, REFERENCE_CREW, SECOND_ASSAY_MAP_ALL, SECOND_ASSAY_PAIRS, TIMEPOINTS } from "./config";
import { median } from "./engine";
import { AGREEMENT_RHO_GOOD } from "./evidence";
import { devPrimary, devSecond } from "./secondAssay";
import { pyRound } from "./validation";
import type { LabMatrix, MarkerKey, SecondAssayMatrix } from "./types";

/**
 * Reference `spearman`: ranks by a stable sort (ties keep their order, as Python's `sorted`), then the Pearson
 * correlation of the ranks with the mean rank (n - 1) / 2 for both; null when n < 2.
 */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  const rank = (v: readonly number[]) => {
    const order = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
    const r = new Array<number>(v.length).fill(0);
    order.forEach((i, pos) => {
      r[i] = pos;
    });
    return r;
  };
  const rx = rank(x);
  const ry = rank(y);
  const mx = (x.length - 1) / 2;
  let den = 0;
  let num = 0;
  for (let i = 0; i < rx.length; i++) {
    den += (rx[i] - mx) ** 2;
    num += (rx[i] - mx) * (ry[i] - mx);
  }
  return den ? num / den : null;
}

const primaryKey = (m: string) => `immune:${m}` as MarkerKey;

export interface SecondAssayAgreement {
  /** analytes on both platforms with at least one crew member scored (five or more shared draws, > 2 distinct values) */
  matchedPairs: number;
  /** median of the per-analyte mean within-person rho (two decimals, as the fixture) */
  medianRho: number;
  /** analytes with rho >= 0.5 */
  pairsWithGoodRho: number;
  /** per-analyte mean within-person rho over the crew, two decimals */
  rho: Record<string, number>;
}

/** reference `agreement`: per analyte, Spearman of the raw values over each crew member's shared draws, mean over crew */
export function secondAssayAgreement(
  matrix: LabMatrix,
  second: SecondAssayMatrix,
  crew: readonly string[] = REFERENCE_CREW,
): SecondAssayAgreement {
  const rho: Record<string, number> = {};
  for (const [m, a] of Object.entries(SECOND_ASSAY_MAP_ALL)) {
    const e = matrix[primaryKey(m)];
    const s = second[a];
    if (!e || !s) continue;
    const rs: number[] = [];
    for (const c of crew) {
      const tps = TIMEPOINTS.filter((t) => e[c]?.[t] !== undefined && s[c]?.[t] !== undefined);
      const ys = tps.map((t) => s[c][t] as number);
      if (tps.length >= 5 && new Set(ys).size > 2) {
        const r = spearman(
          tps.map((t) => e[c][t] as number),
          ys,
        );
        if (r !== null) rs.push(r);
      }
    }
    if (rs.length) rho[m] = pyRound(rs.reduce((x, y) => x + y, 0) / rs.length, 2);
  }
  const vals = Object.values(rho).sort((x, y) => x - y);
  return {
    matchedPairs: vals.length,
    medianRho: vals.length ? pyRound(median(vals), 2) : 0,
    pairsWithGoodRho: vals.filter((v) => v >= AGREEMENT_RHO_GOOD).length,
    rho,
  };
}

/** reference `same_direction_4of4_on_both_assays_at_R1`: analytes whose R+1 deviation has one sign in all crew on both */
export function sameDirectionOnBothAssays(
  matrix: LabMatrix,
  second: SecondAssayMatrix,
  crew: readonly string[] = REFERENCE_CREW,
): string[] {
  const out: string[] = [];
  for (const [m, a] of Object.entries(SECOND_ASSAY_MAP_ALL)) {
    if (!matrix[primaryKey(m)] || !second[a]) continue;
    const d1 = crew.map((c) => devPrimary(matrix, primaryKey(m), c, "R+1"));
    const d2 = crew.map((c) => devSecond(second, a, c, "R+1"));
    if (d1.some((x) => x === null) || d2.some((x) => x === null)) continue;
    const up = (d: (number | null)[]) => d.every((x) => (x as number) > 0);
    const down = (d: (number | null)[]) => d.every((x) => (x as number) < 0);
    if ((up(d1) && up(d2)) || (down(d1) && down(d2))) out.push(m);
  }
  return out;
}

/** reference `L44_lowest_on_second_assay`: crew x analyte series with three distinct pre-flight NPQ values, L-44 lowest */
export function l44LowestOnSecondAssay(
  second: SecondAssayMatrix,
  crew: readonly string[] = REFERENCE_CREW,
): { n: number; lowest: number; share: number } {
  let n = 0;
  let low = 0;
  for (const a of Object.keys(second)) {
    for (const c of crew) {
      const v = PRE_TIMEPOINTS.map((t) => second[a]?.[c]?.[t]);
      if (v.some((x) => x === undefined)) continue;
      const vals = v as number[];
      if (new Set(vals).size < 3) continue;
      n += 1;
      if (vals[1] === Math.min(...vals)) low += 1;
    }
  }
  return { n, lowest: low, share: n === 0 ? 0 : low / n };
}

/** reference `il6_16_panels`: Spearman of the IL-6 deviations on the two platforms over the 16 panels, and same-sign count */
export function il6SixteenPanels(
  matrix: LabMatrix,
  second: SecondAssayMatrix,
  crew: readonly string[] = REFERENCE_CREW,
): { spearman: number | null; sameSign: number; n: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of crew) {
    for (const t of POST_TIMEPOINTS) {
      const d1 = devPrimary(matrix, SECOND_ASSAY_PAIRS.il6.primary, c, t);
      const d2 = devSecond(second, SECOND_ASSAY_PAIRS.il6.second, c, t);
      if (d1 === null || d2 === null) continue;
      xs.push(d1);
      ys.push(d2);
    }
  }
  return {
    spearman: spearman(xs, ys),
    sameSign: xs.filter((x, i) => x > 0 === ys[i] > 0).length,
    n: xs.length,
  };
}
