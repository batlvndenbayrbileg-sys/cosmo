/**
 * Axes, hazards, readiness and overall status (docs/DASHBOARD_PLAN.md section 2, steps 5-8).
 * A transparent heuristic for decision support - not a validated clinical score.
 */

import type {
  AxisKey,
  AxisScore,
  HazardKey,
  HazardStat,
  KpiKey,
  MeasurementValue,
  RedFlag,
  Status,
} from "../types";
import { KPI_KEYS } from "../types";
import { CHECKIN_TARGET_KEYS, KPI_DEFS } from "../kpi/registry";
import { computeBaselines, recentHistory, type HistoryDay } from "./baseline";
import { evaluateIndicators, worstStatus, type IndicatorEval } from "./status";

export const AXIS_KEYS: AxisKey[] = [
  "sleep",
  "cardio",
  "metabolic",
  "neuro_ocular",
  "behavioral",
  "musculoskeletal",
];

export const HAZARD_KEYS: HazardKey[] = [
  "radiation",
  "isolation_confinement",
  "distance_from_earth",
  "gravity",
  "hostile_closed_environment",
];

/** indicator sub-score by status; no_data is ignored (undefined) */
export const SUB_SCORE: Record<Exclude<Status, "no_data">, number> = { green: 100, yellow: 60, red: 20 };

/** readiness is capped here while any red flag is active */
export const RED_FLAG_READINESS_CAP = 60;

/** fewer axes with data than this -> readiness 0 */
export const MIN_AXES_FOR_READINESS = 3;

/** overall green needs at least this many of the 14 non-text keys to have values */
export const MIN_VALUES_FOR_GREEN = 10;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function keysOfAxis(axis: AxisKey): KpiKey[] {
  return KPI_KEYS.filter((k) => KPI_DEFS[k].axis === axis);
}

/** mean sub-score and worst status of one axis for one set of evaluations */
function axisFromEvals(
  evals: Record<KpiKey, IndicatorEval>,
  axis: AxisKey,
): { score: number | null; status: Status } {
  const withData = keysOfAxis(axis)
    .map((k) => evals[k].status)
    .filter((s): s is Exclude<Status, "no_data"> => s !== "no_data");
  if (withData.length === 0) return { score: null, status: "no_data" };
  const score = withData.reduce((sum, s) => sum + SUB_SCORE[s], 0) / withData.length;
  return { score: round1(score), status: worstStatus(withData) };
}

/**
 * The six axis scores. Today uses the full status model (including the personal baseline).
 * The axis baseline is the mean of the person's daily axis scores over the (last 14) history days that have data;
 * history days are scored with the fixed demo ranges only. Pass `evals` to reuse an evaluation already made.
 */
export function computeAxes(
  today: Partial<Record<KpiKey, MeasurementValue>>,
  history: HistoryDay[],
  evals?: Record<KpiKey, IndicatorEval>,
): AxisScore[] {
  const todayEvals = evals ?? evaluateIndicators(today, computeBaselines(history));
  const pastEvals = recentHistory(history).map((day) => evaluateIndicators(day.values, {}));

  return AXIS_KEYS.map((axis) => {
    const { score, status } = axisFromEvals(todayEvals, axis);
    const daily = pastEvals
      .map((e) => axisFromEvals(e, axis).score)
      .filter((s): s is number => s !== null);
    const baseline = daily.length > 0 ? round1(daily.reduce((a, b) => a + b, 0) / daily.length) : null;
    return { axis, score, baseline, status };
  });
}

/** five hazards, linked indicators from the registry; worst status among linked indicators that have data */
export function computeHazards(evals: Record<KpiKey, IndicatorEval>): HazardStat[] {
  return HAZARD_KEYS.map((hazard) => {
    const keys = KPI_KEYS.filter((k) => KPI_DEFS[k].hazards.includes(hazard));
    if (keys.length === 0) return { hazard, status: "not_monitored" as const, keys };
    return { hazard, status: worstStatus(keys.map((k) => evals[k].status)), keys };
  });
}

/** true when enough axes have data for a readiness number to mean something (otherwise readiness is a bare 0) */
export function isReadinessAvailable(axes: AxisScore[]): boolean {
  return axes.filter((a) => a.score !== null).length >= MIN_AXES_FOR_READINESS;
}

/** mean of the axis scores that have data, rounded; 0 with fewer than 3 axes; capped at 60 with a red flag */
export function computeReadiness(axes: AxisScore[], redFlags: RedFlag[]): number {
  if (!isReadinessAvailable(axes)) return 0;
  const scores = axes.map((a) => a.score).filter((s): s is number => s !== null);
  const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return redFlags.length > 0 ? Math.min(mean, RED_FLAG_READINESS_CAP) : mean;
}

/**
 * red: any red flag or red indicator; else yellow: any yellow; else green when >= 10 of the 14 non-text keys have
 * values; else no_data. A red or yellow result is never hidden by sparse data.
 */
export function computeOverall(evals: Record<KpiKey, IndicatorEval>, redFlags: RedFlag[]): Status {
  const statuses = KPI_KEYS.map((k) => evals[k].status);
  if (redFlags.length > 0 || statuses.includes("red")) return "red";
  if (statuses.includes("yellow")) return "yellow";
  const filled = CHECKIN_TARGET_KEYS.filter((k) => evals[k].status !== "no_data").length;
  return filled >= MIN_VALUES_FOR_GREEN ? "green" : "no_data";
}
