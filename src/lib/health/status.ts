/**
 * Per-indicator status (docs/DASHBOARD_PLAN.md section 2, steps 1-3).
 * Every threshold is a demo parameter, never a clinical limit. No LLM involved.
 */

import type { KpiDef, KpiKey, MeasurementValue, Status, StatusReason } from "../types";
import { KPI_KEYS } from "../types";
import { KPI_DEFS, asNumber } from "../kpi/registry";
import { zScore, type Baseline } from "./baseline";

export type IndicatorEval = {
  status: Status;
  reason: StatusReason;
  z: number | null;
  /** value - baseline mean; null without a baseline (and for yes/no symptoms) */
  delta: number | null;
};

/** higher = worse; no_data ranks lowest so it never hides a real status */
export const STATUS_RANK: Record<Status, number> = { no_data: 0, green: 1, yellow: 2, red: 3 };

/** the worst status in the list; no_data when the list is empty or holds only no_data */
export function worstStatus(statuses: Iterable<Status>): Status {
  let worst: Status = "no_data";
  for (const s of statuses) if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  return worst;
}

/** a value counts as present when it is a finite number or a non-blank string */
export function isPresent(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return false;
}

/** step 2: fixed demo-parameter range (strict comparisons, yellow bounds inclusive-green), maxLevel clamp applied */
export function fixedRangeStatus(def: KpiDef, v: number): "green" | "yellow" | "red" {
  const th = def.thresholds;
  let status: "green" | "yellow" | "red" = "green";
  if (th?.low) {
    if (v < th.low.red) status = "red";
    else if (v < th.low.yellow) status = "yellow";
  }
  if (th?.high && status !== "red") {
    if (v > th.high.red) status = "red";
    else if (v > th.high.yellow) status = "yellow";
  }
  if (status === "red" && def.maxLevel === "yellow") status = "yellow";
  return status;
}

const Z_LIMIT = 2;

/**
 * Evaluates one indicator.
 *  1. no value -> no_data / missing (never rendered as normal)
 *  2. fixed range -> yellow / red (fixed_range), clamped to yellow for lifestyle keys
 *  3. personal baseline -> green with |z| > 2 becomes yellow (baseline); never red; numeric scales only
 * Text keys: present -> green, missing -> no_data. Yes/no symptoms never use the baseline step.
 */
export function evaluateIndicator(
  key: KpiKey,
  value: MeasurementValue | null | undefined,
  baseline?: Baseline | null,
): IndicatorEval {
  const def = KPI_DEFS[key];
  const missing: IndicatorEval = { status: "no_data", reason: "missing", z: null, delta: null };

  if (def.type === "text") {
    return isPresent(value) ? { status: "green", reason: "fixed_range", z: null, delta: null } : missing;
  }

  const v = asNumber(value);
  if (v === null) return missing;

  let status: Status = fixedRangeStatus(def, v);
  let reason: StatusReason = "fixed_range";

  let z: number | null = null;
  let delta: number | null = null;
  if (def.type !== "boolean" && baseline && baseline.mean !== null) {
    z = zScore(v, baseline, def.sdFloor ?? 0);
    delta = v - baseline.mean;
    if (status === "green" && z !== null && Math.abs(z) > Z_LIMIT) {
      status = "yellow";
      reason = "baseline";
    }
  }
  return { status, reason, z, delta };
}

/** evaluates all 16 keys of one day against the given baselines (pass {} for a fixed-range-only evaluation) */
export function evaluateIndicators(
  values: Partial<Record<KpiKey, MeasurementValue>>,
  baselines: Partial<Record<KpiKey, Baseline>>,
): Record<KpiKey, IndicatorEval> {
  const out = {} as Record<KpiKey, IndicatorEval>;
  for (const key of KPI_KEYS) out[key] = evaluateIndicator(key, values[key] ?? null, baselines[key]);
  return out;
}
