/**
 * Signature Triage validation statistics (docs/SIGNATURE_SPEC.md sections 4.3, 4.6, 5; port of the "report" part of
 * docs/signature_reference/reference_engine.py `main`). Pure and deterministic.
 *
 * The Evidence card reads these numbers from the fixture (build prompt T8 allows it); this module recomputes them from
 * the lab matrix so a test can check that the fixture and the engine agree (T10 fix): leave-one-crew-out hit counts,
 * the noise-floor summary (median, p75, max), the selection statistics (candidates tested, core markers expected by
 * chance) and the L-44 batch check.
 */

import { EXCLUDED_MARKERS, MIN_EFFECT, POST_TIMEPOINTS, PRE_TIMEPOINTS, REFERENCE_CREW } from "./config";
import {
  DEFAULT_SIGNATURE,
  bareName,
  baseline,
  envelope,
  fri,
  median,
  noiseFloor,
  preVals,
  scalesFor,
  selectSignature,
  type ScaleMap,
  type Signature,
} from "./engine";
import { round1 } from "./recovery";
import type { Direction, LabFileKind, LabMatrix, MarkerKey, Timepoint } from "./types";

/* ───────────── leave-one-crew-out (spec section 5) ───────────── */

export interface LocoFold {
  /** bare names, sorted */
  core: string[];
  supporting: string[];
  /** selected markers the held-out crew member can be checked on (two baseline draws and an R+1 value) */
  nSelected: number;
  /** ... of which the held-out crew member moved >= 10 % in the predicted direction at R+1 */
  directionHits: number;
  /** ... of which the held-out R+1 is beyond the own pre-flight range on the predicted side */
  envelopeHits: number;
  /** FRI of the held-out crew member with the fold's signature and scales (unrounded) */
  heldoutFri: Record<Timepoint, number | null>;
}

export interface LocoResult {
  folds: Record<string, LocoFold>;
  totalSelected: number;
  totalDirectionHits: number;
  totalEnvelopeHits: number;
  /** bare names selected (core or supporting) in every fold, sorted */
  selectedInAllFolds: string[];
}

const groupEntries = (g: Signature["core"]) => Object.entries(g) as [MarkerKey, Direction][];

/** reference `loco`: select on three crew, check the fourth (selection, direction, envelope, held-out FRI) */
export function leaveOneCrewOut(matrix: LabMatrix, crew: readonly string[] = REFERENCE_CREW): LocoResult {
  const folds: Record<string, LocoFold> = {};
  let totalSelected = 0;
  let totalDirectionHits = 0;
  let totalEnvelopeHits = 0;
  for (const held of crew) {
    const train = crew.filter((c) => c !== held);
    const sig = selectSignature(matrix, train);
    const scales = scalesFor(matrix, sig, train);
    let n = 0;
    let hd = 0;
    let he = 0;
    for (const group of [sig.core, sig.supporting]) {
      for (const [key, sgn] of groupEntries(group)) {
        const series = matrix[key]?.[held];
        const p = preVals(series);
        const x = series?.["R+1"];
        if (p.length < 2 || x === undefined) continue;
        n += 1;
        if (sgn * Math.log(x / baseline(p)) >= MIN_EFFECT) hd += 1;
        if (envelope(matrix, key, held, "R+1") === (sgn > 0 ? "hi" : "lo")) he += 1;
      }
    }
    totalSelected += n;
    totalDirectionHits += hd;
    totalEnvelopeHits += he;
    const heldoutFri = {} as Record<Timepoint, number | null>;
    for (const t of POST_TIMEPOINTS) heldoutFri[t] = fri(matrix, sig, scales, held, t).value;
    folds[held] = {
      core: Object.keys(sig.core).map((k) => bareName(k as MarkerKey)).sort(),
      supporting: Object.keys(sig.supporting).map((k) => bareName(k as MarkerKey)).sort(),
      nSelected: n,
      directionHits: hd,
      envelopeHits: he,
      heldoutFri,
    };
  }
  const sets = Object.values(folds).map((f) => new Set([...f.core, ...f.supporting]));
  const selectedInAllFolds = sets.length
    ? [...sets[0]].filter((m) => sets.every((s) => s.has(m))).sort()
    : [];
  return { folds, totalSelected, totalDirectionHits, totalEnvelopeHits, selectedInAllFolds };
}

/* ───────────── noise floor summary (spec section 4.6) ───────────── */

export interface NoiseFloorSummary {
  /** the 12 control panels, one decimal, sorted */
  sorted: number[];
  /** median of the one-decimal values, one decimal */
  median: number;
  /** mean of the 9th and 10th of the 12 sorted values (reference `p75`), one decimal */
  p75: number;
  max: number;
}

/**
 * Python `round(x, digits)` for the summary values: rounds the exact decimal value of the double, so the median of
 * 7.9 and 9.0 (8.45 as a double is 8.4499...) gives 8.4 as in the fixture, where `Math.round(x * 10) / 10` gives 8.5.
 * (`toFixed` rounds an exact tie up where Python rounds it to even; no summary value here is an exact tie.)
 */
export function pyRound(x: number, digits: number): number {
  return Number(x.toFixed(digits));
}

/** reference `noise_floor` summary: each pre-flight draw scored against the other two, then median / p75 / max */
export function noiseFloorSummary(
  matrix: LabMatrix,
  sig: Signature = DEFAULT_SIGNATURE,
  scales: ScaleMap = scalesFor(matrix, sig),
): NoiseFloorSummary {
  const sorted = noiseFloor(matrix, sig, scales).sorted.map(round1).sort((a, b) => a - b);
  if (sorted.length < 10) throw new Error("signature: noise floor needs the 12 control panels");
  return {
    sorted,
    median: pyRound(median(sorted), 1),
    p75: pyRound((sorted[8] + sorted[9]) / 2, 1),
    max: sorted[sorted.length - 1],
  };
}

/* ───────────── selection statistics (spec section 4.3) ───────────── */

export interface SelectionStats {
  /** analytes not excluded with three positive pre-flight draws and an R+1 value in every crew member */
  candidatesTested: number;
  /** candidates x 2 directions / 4^4: each crew member's R+1 is the highest of four exchangeable draws with 1/4 */
  expectedCoreByChance: number;
  /** candidates x 2 / 3^4: the same with L-44 uninformative (batch-shifted low), 1/3 per crew member */
  expectedCoreByChanceIfL44Uninformative: number;
}

/** reference `selection`; the two chance values unrounded (the fixture rounds to two decimals) */
export function selectionStats(matrix: LabMatrix, crew: readonly string[] = REFERENCE_CREW): SelectionStats {
  let n = 0;
  for (const key of Object.keys(matrix) as MarkerKey[]) {
    if (EXCLUDED_MARKERS.has(key)) continue;
    const ok = crew.every((c) => {
      const series = matrix[key]?.[c];
      const p = preVals(series);
      return p.length === 3 && series?.["R+1"] !== undefined && Math.min(...p) > 0;
    });
    if (ok) n += 1;
  }
  return {
    candidatesTested: n,
    expectedCoreByChance: (n * 2) / 4 ** crew.length,
    expectedCoreByChanceIfL44Uninformative: (n * 2) / 3 ** crew.length,
  };
}

/* ───────────── L-44 batch check (spec section 1.5) ───────────── */

export interface L44Check {
  /** crew x analyte series with three distinct pre-flight values */
  n: number;
  /** ... in which the L-44 draw is the lowest of the three */
  l44Lowest: number;
  /** l44Lowest / n, unrounded */
  share: number;
}

/** reference `L44_batch_check` for one file kind (cardio, immune) */
export function l44BatchCheck(matrix: LabMatrix, kind: LabFileKind, crew: readonly string[] = REFERENCE_CREW): L44Check {
  let n = 0;
  let low = 0;
  for (const key of Object.keys(matrix) as MarkerKey[]) {
    if (!key.startsWith(`${kind}:`)) continue;
    for (const c of crew) {
      const series = matrix[key]?.[c];
      const v = PRE_TIMEPOINTS.map((t) => series?.[t]);
      if (v.some((x) => x === undefined)) continue;
      const vals = v as number[];
      if (new Set(vals).size < 3) continue;
      n += 1;
      if (vals[1] === Math.min(...vals)) low += 1;
    }
  }
  return { n, l44Lowest: low, share: n === 0 ? 0 : low / n };
}
