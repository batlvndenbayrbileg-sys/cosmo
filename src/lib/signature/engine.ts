/**
 * Signature Triage engine (docs/SIGNATURE_SPEC.md section 4; port of the "core maths" of
 * docs/signature_reference/reference_engine.py). Pure and deterministic: every number the UI shows or Cosmo speaks
 * comes from here (build rule 3), checked against the fixture in tests/signature/engine.test.ts.
 *
 * T2: personal baseline, pooled scale, z and envelope (spec sections 4.1-4.2).
 * T3: selection rule, FRI, uncertainty band, noise floor, class, borderline, other large changes (sections 4.3-4.7).
 */

import {
  CORE_SIGNATURE,
  D2_N3,
  EXCLUDED_MARKERS,
  MIN_EFFECT,
  OTHER_LARGE_FOLD,
  OTHER_LARGE_TOP,
  PRE_TIMEPOINTS,
  REFERENCE_CREW,
  S_FLOOR,
  SUPPORTING_SIGNATURE,
  T_HIGH,
  T_LOW,
  TIMEPOINT_DAY,
  W_CORE,
  W_SUPP,
  WINDOW_DAYS,
  Z_CAP,
} from "./config";
import type {
  Direction,
  Envelope,
  LabMatrix,
  MarkerKey,
  MarkerResult,
  MarkerSeries,
  MarkerTier,
  PanelResult,
  Timepoint,
  TriageClass,
} from "./types";

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

/* ───────────── T3: selection rule, FRI, band, class (spec sections 4.3-4.7) ───────────── */

/** marker -> direction of the flight response; insertion order = sorted key order, as the reference engine */
export type SignatureGroup = Partial<Record<MarkerKey, Direction>>;

export interface Signature {
  core: SignatureGroup;
  supporting: SignatureGroup;
}

/** pooled scale per signature marker (null = no scale; the marker then never scores) */
export type ScaleMap = Partial<Record<MarkerKey, number | null>>;

/** the fixed signature of config.ts (all six markers rise); `selectSignature` re-derives it from the data */
export const DEFAULT_SIGNATURE: Signature = {
  core: Object.fromEntries(CORE_SIGNATURE.map((k) => [k, 1 as Direction])) as SignatureGroup,
  supporting: Object.fromEntries(SUPPORTING_SIGNATURE.map((k) => [k, 1 as Direction])) as SignatureGroup,
};

/** analyte name without the file prefix: 'immune:il_6' -> 'il_6' (the fixture's marker names) */
export function bareName(key: MarkerKey): string {
  return key.slice(key.indexOf(":") + 1);
}

const groupEntries = (g: SignatureGroup) => Object.entries(g) as [MarkerKey, Direction][];

/** every marker of the signature, core first */
export function signatureKeys(sig: Signature): MarkerKey[] {
  return [...groupEntries(sig.core), ...groupEntries(sig.supporting)].map(([k]) => k);
}

/** pooled scales of every marker of `sig`, on `crew` (default C001..C004; three crew for leave-one-crew-out) */
export function scalesFor(matrix: LabMatrix, sig: Signature, crew: readonly string[] = REFERENCE_CREW): ScaleMap {
  const out: ScaleMap = {};
  for (const key of signatureKeys(sig)) out[key] = scale(matrix, key, crew);
  return out;
}

/**
 * `select_signature` (spec section 4.3): every analyte not excluded, with three positive pre-flight draws and an R+1
 * value in all `crew`, that (1) moves the same way against the own pre-flight median in all crew and (2) by at least
 * 10 % in each; (3) core = R+1 beyond the own pre-flight range on that side in all crew, supporting = in all but one.
 */
export function selectSignature(matrix: LabMatrix, crew: readonly string[]): Signature {
  const core: SignatureGroup = {};
  const supporting: SignatureGroup = {};
  for (const key of (Object.keys(matrix) as MarkerKey[]).sort()) {
    if (EXCLUDED_MARKERS.has(key)) continue;
    const lrs: number[] = [];
    const envs: (Envelope | null)[] = [];
    let complete = true;
    for (const c of crew) {
      const series = matrix[key]?.[c];
      const p = preVals(series);
      const x = series?.["R+1"];
      if (p.length < 3 || x === undefined || Math.min(...p) <= 0 || x <= 0) {
        complete = false;
        break;
      }
      lrs.push(Math.log(x / baseline(p)));
      envs.push(envelope(matrix, key, c, "R+1"));
    }
    if (!complete) continue;
    for (const [sgn, side] of [
      [1, "hi"],
      [-1, "lo"],
    ] as const) {
      if (lrs.every((l) => sgn * l >= MIN_EFFECT)) {
        const k = envs.filter((e) => e === side).length;
        if (k === crew.length) core[key] = sgn;
        else if (k === crew.length - 1) supporting[key] = sgn;
      }
    }
  }
  return { core, supporting };
}

export interface FriResult {
  /** Flight Response Index 0..100, null with fewer than two scored core markers */
  value: number | null;
  /** scored markers by bare name (a marker without a value, scale or two baseline draws is absent) */
  markers: Record<string, MarkerResult>;
}

/**
 * `fri` (spec section 4.4): q = clip(direction x z, 0, 4) / 4; FRI = 100 x sum(w q) / sum(w) over the available
 * markers (weights renormalise when one is missing), w = 1 core, 0.5 supporting. Fewer than two core markers -> null.
 */
export function fri(
  matrix: LabMatrix,
  sig: Signature,
  scales: ScaleMap,
  crew: string,
  t: Timepoint,
  baseTps?: readonly Timepoint[],
): FriResult {
  let num = 0;
  let den = 0;
  let ncore = 0;
  const markers: Record<string, MarkerResult> = {};
  const groups: [SignatureGroup, number, MarkerTier][] = [
    [sig.core, W_CORE, "core"],
    [sig.supporting, W_SUPP, "supporting"],
  ];
  for (const [group, w, tier] of groups) {
    for (const [key, sgn] of groupEntries(group)) {
      const z = zscore(matrix, key, crew, t, scales[key] ?? null, baseTps);
      if (z === null) continue;
      const q = Math.min(Math.max(sgn * z, 0), Z_CAP) / Z_CAP;
      num += w * q;
      den += w;
      if (tier === "core") ncore += 1;
      const series = matrix[key][crew];
      const value = series[t] as number;
      const b = baseline(preVals(series, baseTps));
      markers[bareName(key)] = {
        tier,
        value,
        baseline: b,
        fold: value / b,
        z,
        q,
        weight: w,
        envelope: envelope(matrix, key, crew, t, baseTps) ?? "in",
      };
    }
  }
  return { value: ncore < 2 ? null : (100 * num) / den, markers };
}

/** `fri_band` (spec section 4.5): [min, max] of FRI with the full baseline and with each pre-flight draw left out */
export function friBand(
  matrix: LabMatrix,
  sig: Signature,
  scales: ScaleMap,
  crew: string,
  t: Timepoint,
): [number, number] | null {
  const vals = [fri(matrix, sig, scales, crew, t).value];
  for (const d of PRE_TIMEPOINTS) {
    vals.push(fri(matrix, sig, scales, crew, t, PRE_TIMEPOINTS.filter((x) => x !== d)).value);
  }
  const ok = vals.filter((v): v is number => v !== null);
  return ok.length ? [Math.min(...ok), Math.max(...ok)] : null;
}

/** `classify` (spec section 4.7) */
export function classify(value: number | null, daysSinceTransition: number): TriageClass {
  if (value === null) return "INSUFFICIENT";
  if (value < T_LOW) return "BASELINE";
  if (value < T_HIGH) return "INDETERMINATE";
  return daysSinceTransition <= WINDOW_DAYS ? "EXPECTED_FLIGHT_RESPONSE" : "UNEXPECTED_ACTIVATION";
}

/** spec section 4.7: the band contains a zone threshold, band low < T <= band high for T = 20 or 40 */
export function isBorderline(band: readonly [number, number] | null): boolean {
  if (!band) return false;
  return [T_LOW, T_HIGH].some((T) => band[0] < T && T <= band[1]);
}

/**
 * "Other large changes" (build prompt T3, spec section 7.2; information only): `immune:*` and `cardio:*` analytes not in
 * the signature and not excluded, with fold >= 3 and above every own pre-flight value, or fold <= 1/3 and below every
 * one; sorted by |ln fold| (largest first), top 3.
 */
export function otherLargeChanges(
  matrix: LabMatrix,
  crew: string,
  t: Timepoint,
  sig: Signature = DEFAULT_SIGNATURE,
): { analyte: string; fold: number }[] {
  const inSig = new Set(signatureKeys(sig));
  const hits: { analyte: string; fold: number }[] = [];
  for (const key of (Object.keys(matrix) as MarkerKey[]).sort()) {
    if (!(key.startsWith("immune:") || key.startsWith("cardio:"))) continue;
    if (inSig.has(key) || EXCLUDED_MARKERS.has(key)) continue;
    const series = matrix[key][crew];
    const x = series?.[t];
    const p = preVals(series);
    if (x === undefined || p.length < 2 || Math.min(...p) <= 0 || x <= 0) continue;
    const fold = x / baseline(p);
    const env = envelope(matrix, key, crew, t);
    if ((fold >= OTHER_LARGE_FOLD && env === "hi") || (fold <= 1 / OTHER_LARGE_FOLD && env === "lo")) {
      hits.push({ analyte: bareName(key), fold });
    }
  }
  return hits.sort((a, b) => Math.abs(Math.log(b.fold)) - Math.abs(Math.log(a.fold))).slice(0, OTHER_LARGE_TOP);
}

export interface ScorePanelOptions {
  /** default: the fixed signature of config.ts */
  signature?: Signature;
  /** default: scales of the signature on C001..C004 */
  scales?: ScaleMap;
  /** default: the panel's mission day (R+N = N days since landing) */
  daysSinceTransition?: number;
}

/** one panel, end to end: FRI, band, class, borderline, per-marker parts and other large changes */
export function scorePanel(
  matrix: LabMatrix,
  crew: string,
  t: Timepoint,
  options: ScorePanelOptions = {},
): PanelResult {
  const sig = options.signature ?? DEFAULT_SIGNATURE;
  const scales = options.scales ?? scalesFor(matrix, sig);
  const missionDay = TIMEPOINT_DAY[t];
  const { value, markers } = fri(matrix, sig, scales, crew, t);
  const band = value === null ? null : friBand(matrix, sig, scales, crew, t);
  return {
    crew,
    timepoint: t,
    missionDay,
    fri: value,
    band,
    cls: classify(value, options.daysSinceTransition ?? missionDay),
    borderline: isBorderline(band),
    markers,
    otherLargeChanges: otherLargeChanges(matrix, crew, t, sig),
  };
}

/**
 * Noise floor (spec section 4.6): each pre-flight draw scored as a new panel against the other two draws (12 control
 * panels for C001..C004, no spaceflight involved). `sorted` drops nulls.
 */
export function noiseFloor(
  matrix: LabMatrix,
  sig: Signature = DEFAULT_SIGNATURE,
  scales: ScaleMap = scalesFor(matrix, sig),
  crew: readonly string[] = REFERENCE_CREW,
): { pseudoPanels: Record<string, number | null>; sorted: number[] } {
  const pseudoPanels: Record<string, number | null> = {};
  for (const c of crew) {
    for (const t of PRE_TIMEPOINTS) {
      pseudoPanels[`${c}_${t}`] = fri(matrix, sig, scales, c, t, PRE_TIMEPOINTS.filter((x) => x !== t)).value;
    }
  }
  const sorted = Object.values(pseudoPanels)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return { pseudoPanels, sorted };
}
