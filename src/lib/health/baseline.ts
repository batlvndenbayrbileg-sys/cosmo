/**
 * Personal baseline (docs/DASHBOARD_PLAN.md section 2, step 3).
 * Pure: history is injected, nothing reads the clock.
 */

import type { KpiKey, MeasurementValue } from "../types";
import { KPI_KEYS } from "../types";
import { KPI_DEFS, asNumber } from "../kpi/registry";

/** one confirmed past day: ISO date (YYYY-MM-DD) and its values */
export type HistoryDay = { date: string; values: Partial<Record<KpiKey, MeasurementValue>> };

export type Baseline = { mean: number | null; sd: number | null; n: number };

/** days of history that count towards the baseline (today is never part of it) */
export const BASELINE_WINDOW_DAYS = 14;

/** a baseline needs at least this many values */
export const MIN_BASELINE_N = 5;

/** the last `window` days of history in ascending date order; input is not mutated */
export function recentHistory(history: HistoryDay[], window: number = BASELINE_WINDOW_DAYS): HistoryDay[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.slice(Math.max(0, sorted.length - window));
}

/** mean and sample standard deviation (n - 1) of the key over the history; n < 5 -> mean/sd null */
export function computeBaseline(history: HistoryDay[], key: KpiKey): Baseline {
  const values: number[] = [];
  for (const day of recentHistory(history)) {
    const n = asNumber(day.values[key]);
    if (n !== null) values.push(n);
  }
  const n = values.length;
  if (n < MIN_BASELINE_N) return { mean: null, sd: null, n };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, sd: Math.sqrt(variance), n };
}

/** baselines for every non-text key */
export function computeBaselines(history: HistoryDay[]): Partial<Record<KpiKey, Baseline>> {
  const out: Partial<Record<KpiKey, Baseline>> = {};
  for (const key of KPI_KEYS) {
    if (KPI_DEFS[key].type === "text") continue;
    out[key] = computeBaseline(history, key);
  }
  return out;
}

/**
 * z = (value - mean) / max(sd, sdFloor). Null when there is no baseline or the spread is zero
 * (so a missing floor can never divide by zero).
 */
export function zScore(value: number, baseline: Baseline | null | undefined, sdFloor = 0): number | null {
  if (!baseline || baseline.mean === null) return null;
  const sd = Math.max(baseline.sd ?? 0, sdFloor);
  if (!(sd > 0)) return null;
  return (value - baseline.mean) / sd;
}
