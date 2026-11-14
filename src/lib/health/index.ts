/**
 * Health logic entry point: one pure call turns today's values plus the confirmed history into everything the
 * dashboard and the summary need. Deterministic: dates are injected through the history, no clock is read.
 */

import type {
  AxisScore,
  DayArcSlot,
  HazardStat,
  KpiKey,
  KpiStat,
  MeasurementSource,
  MeasurementValue,
  RedFlag,
  Status,
  SummaryFindings,
  Task,
} from "../types";
import { KPI_KEYS } from "../types";
import { KPI_DEFS, asNumber, rangeText } from "../kpi/registry";
import { BASELINE_WINDOW_DAYS, computeBaselines, recentHistory, type HistoryDay } from "./baseline";
import { evaluateRedFlags } from "./flags";
import { computeDayArc } from "./dayArc";
import { computeAxes, computeHazards, computeOverall, computeReadiness, isReadinessAvailable } from "./scores";
import { evaluateIndicators, type IndicatorEval } from "./status";
import { composeSummaryFindings } from "./summary";
import { buildTasks } from "./tasks";

export * from "./baseline";
export * from "./status";
export * from "./flags";
export * from "./scores";
export * from "./dayArc";
export * from "./tasks";
export * from "./summary";

export interface DayEvaluation {
  indicators: Record<KpiKey, IndicatorEval>;
  redFlags: RedFlag[];
  overall: Status;
  readiness: number;
  axes: AxisScore[];
  hazards: HazardStat[];
  dayArc: DayArcSlot[];
  tasks: Task[];
  summary: SummaryFindings;
}

/**
 * Evaluates one day. `history` holds the person's confirmed past days and must not contain today;
 * only the last 14 days count towards baselines.
 */
export function evaluateDay(
  today: Partial<Record<KpiKey, MeasurementValue>>,
  history: HistoryDay[],
): DayEvaluation {
  const baselines = computeBaselines(history);
  const indicators = evaluateIndicators(today, baselines);
  const redFlags = evaluateRedFlags(today, indicators);
  const overall = computeOverall(indicators, redFlags);
  const axes = computeAxes(today, history, indicators);
  const readiness = computeReadiness(axes, redFlags);
  const hazards = computeHazards(indicators);
  const dayArc = computeDayArc(today);
  const tasks = buildTasks({ today, indicators, baselines, redFlags });
  const summary = composeSummaryFindings({
    today,
    indicators,
    baselines,
    redFlags,
    overall,
    readiness,
    readinessAvailable: isReadinessAvailable(axes),
    tasks,
  });
  return { indicators, redFlags, overall, readiness, axes, hazards, dayArc, tasks, summary };
}

/**
 * One KpiStat per key (all 16, KPI_KEYS order) for the dashboard cards.
 * `history` in each stat is up to 14 {date, value} points of past days (numeric keys only, today excluded).
 */
export function buildKpiStats(
  today: Partial<Record<KpiKey, MeasurementValue>>,
  history: HistoryDay[],
  sourceByKey: Partial<Record<KpiKey, MeasurementSource>>,
): KpiStat[] {
  const baselines = computeBaselines(history);
  const indicators = evaluateIndicators(today, baselines);
  const window = recentHistory(history, BASELINE_WINDOW_DAYS);

  return KPI_KEYS.map((key): KpiStat => {
    const def = KPI_DEFS[key];
    const ev = indicators[key];
    const raw = today[key];
    const present = ev.status !== "no_data";
    const baseline = baselines[key];

    let value: MeasurementValue | null = null;
    if (present) value = def.type === "text" ? String(raw) : (asNumber(raw) as number);

    const points: KpiStat["history"] = [];
    if (def.type !== "text") {
      for (const day of window) {
        const n = asNumber(day.values[key]);
        if (n !== null) points.push({ date: day.date, value: n });
      }
    }

    return {
      key,
      value,
      unit: def.unit,
      status: ev.status,
      reason: ev.reason,
      z: ev.z,
      baselineMean: baseline?.mean ?? null,
      baselineSd: baseline?.sd ?? null,
      delta: ev.delta,
      history: points,
      source: present ? (sourceByKey[key] ?? null) : null,
      rangeText: rangeText(key),
    };
  });
}
