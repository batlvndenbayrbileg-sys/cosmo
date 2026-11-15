/**
 * Signature Triage Daily Strain Score and draw advisor (docs/SIGNATURE_SPEC.md sections 4.9-4.10; `daily_strain` is a
 * port of docs/signature_reference/reference_engine.py). Pure and deterministic. All thresholds are ASSUMPTIONS and
 * live in config.ts. A protocol, not validated: no NASA file links daily KPIs to blood markers.
 *
 * The draw-advisor state is not stored (integration map section 4.10): `drawStateFromPanels` derives it from the panel
 * list and the daily DSS values; `drawAdvice` and `importPanel` return the next state instead of mutating anything.
 * Days are integers on the panel clock (landing-relative: R+1 = day 1).
 */

import type { HistoryDay } from "../health/baseline";
import { asNumber } from "../kpi/registry";
import type { KpiKey, MeasurementValue } from "../types";
import {
  CALM_DAYS,
  DSS_CALM,
  DSS_HISTORY_DAYS,
  DSS_MIN_HISTORY,
  DSS_TRIGGER,
  DSS_TRIGGER_DAYS,
  DSS_Z_CAP,
  KITS_TOTAL,
  KPI_DIR,
  KPI_FLOOR,
  MAD_TO_SD,
  MIN_DAYS_BETWEEN_DRAWS,
  ROUTINE_DAYS,
  SKIP_RECHECK_DAYS,
  STRAIN_KPI_SOURCE,
  UNEXPECTED_RETEST_DAYS,
  type StrainKpi,
} from "./config";
import { median } from "./engine";
import { recoveryFor } from "./recovery";
import type { PanelResult, TriageClass } from "./types";

/* ───────────── Daily Strain Score (spec section 4.9) ───────────── */

/** one day of DSS inputs; a missing or null KPI is skipped */
export type StrainDay = Partial<Record<StrainKpi, number | null>>;

const STRAIN_KPIS = Object.keys(KPI_DIR) as StrainKpi[];

/**
 * `daily_strain`: `history` = previous days, oldest first (the last 14 count); `today` = the day scored. Per KPI with at
 * least 5 history values and a value today: z = direction x (today - median) / max(1.4826 x MAD, floor), clipped to
 * [0, 3] / 3; DSS = 100 x mean over those KPIs. Null with fewer than 5 history days or no scorable KPI.
 */
export function dailyStrain(history: readonly StrainDay[], today: StrainDay): number | null {
  if (history.length < DSS_MIN_HISTORY) return null;
  const recent = history.slice(-DSS_HISTORY_DAYS);
  const qs: number[] = [];
  for (const k of STRAIN_KPIS) {
    const xs = recent.map((h) => h[k]).filter((x): x is number => x !== undefined && x !== null);
    const t = today[k];
    if (xs.length < DSS_MIN_HISTORY || t === undefined || t === null) continue;
    const m = median(xs);
    const mad = median(xs.map((x) => Math.abs(x - m)));
    const s = Math.max(MAD_TO_SD * mad, KPI_FLOOR[k]);
    qs.push(Math.min(Math.max((KPI_DIR[k] * (t - m)) / s, 0), DSS_Z_CAP) / DSS_Z_CAP);
  }
  return qs.length ? (100 * qs.reduce((a, b) => a + b, 0)) / qs.length : null;
}

/** DSS of every day of `days` (oldest first) against the up to 14 days before it */
export function dssSeries(days: readonly StrainDay[]): (number | null)[] {
  return days.map((d, i) => dailyStrain(days.slice(Math.max(0, i - DSS_HISTORY_DAYS), i), d));
}

/**
 * App check-in KPIs -> DSS inputs (integration map section 4.6): sleep_hours -> sleep_hours, heart_rate -> resting_hr,
 * mood -> mood; sleep_quality and fatigue have no app field and stay missing.
 */
export function strainDayFromKpis(values: Partial<Record<KpiKey, MeasurementValue>>): StrainDay {
  const out: StrainDay = {};
  for (const k of STRAIN_KPIS) {
    const src = STRAIN_KPI_SOURCE[k];
    if (src === null) continue;
    const n = asNumber(values[src]);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** check-in history (any order) -> DSS input days, oldest first */
export function strainDaysFromHistory(history: readonly HistoryDay[]): StrainDay[] {
  return [...history]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => strainDayFromKpis(d.values));
}

/* ───────────── draw advisor (spec section 4.10; first matching rule wins) ───────────── */

export type DrawRule = "A1" | "A2" | "A3" | "A4" | "A6";

/** A1 draw today; A2 draw recommended; A3 skip (kit saved); A4 routine draw; A6 no draw needed */
export type DrawAction = "DRAW_TODAY" | "DRAW_RECOMMENDED" | "SKIP" | "DRAW" | "NO_DRAW";

export interface DrawState {
  /** today, on the panel clock */
  today: number;
  /** day of the last imported panel, null before the first */
  lastPanelDay: number | null;
  lastPanelClass: TriageClass | null;
  /** pending re-test day (spec section 4.8 or A5), null when none */
  retestDay: number | null;
  /** daily DSS, oldest first, the last entry is today (null = not computable that day) */
  dss: readonly (number | null)[];
  /** kit budget */
  kitsTotal: number;
  /** one kit per imported panel */
  panelsImported: number;
  /** A3 skips */
  kitsSaved: number;
  /** after an A3 skip: the day the skip is re-checked (the same skip is not counted twice before it) */
  skipRecheckDay: number | null;
}

export interface DrawAdvice {
  rule: DrawRule;
  action: DrawAction;
  daysSinceLastPanel: number | null;
  kitsLeft: number;
  kitsTotal: number;
  kitsSaved: number;
  /** A1: the re-test day that is due; A3: the re-check day */
  dueDay: number | null;
  /** the state after this advice (A3 increments kitsSaved once per skip) */
  state: DrawState;
}

/** a fresh state: no panel yet, full kit budget */
export function initialDrawState(today: number, kitsTotal: number = KITS_TOTAL): DrawState {
  return {
    today,
    lastPanelDay: null,
    lastPanelClass: null,
    retestDay: null,
    dss: [],
    kitsTotal,
    panelsImported: 0,
    kitsSaved: 0,
    skipRecheckDay: null,
  };
}

export function kitsLeft(state: DrawState): number {
  return Math.max(state.kitsTotal - state.panelsImported, 0);
}

/** the last `n` DSS values all satisfy `pred` (and there are at least `n`) */
function lastDaysAll(dss: readonly (number | null)[], n: number, pred: (v: number) => boolean): boolean {
  if (dss.length < n) return false;
  return dss.slice(-n).every((v) => v !== null && pred(v));
}

/**
 * Rules A1-A4, A6 of spec section 4.10, first match wins:
 * A1 a re-test day is today or past; A2 DSS >= 50 on the last 3 days and last panel >= 7 days ago (or no panel);
 * A3 last panel >= 30 days ago, last class BASELINE, DSS < 25 on each of the last 7 days -> skip, re-check in 7 days,
 * kit saved; A4 last panel >= 30 days ago (or no panel); A6 otherwise. A5 runs on import (`importPanel`).
 */
export function drawAdvice(state: DrawState): DrawAdvice {
  const since = state.lastPanelDay === null ? null : state.today - state.lastPanelDay;
  const result = (rule: DrawRule, action: DrawAction, dueDay: number | null, next: DrawState = state): DrawAdvice => ({
    rule,
    action,
    daysSinceLastPanel: since,
    kitsLeft: kitsLeft(next),
    kitsTotal: next.kitsTotal,
    kitsSaved: next.kitsSaved,
    dueDay,
    state: next,
  });

  if (state.retestDay !== null && state.retestDay <= state.today) return result("A1", "DRAW_TODAY", state.retestDay);

  if (
    lastDaysAll(state.dss, DSS_TRIGGER_DAYS, (v) => v >= DSS_TRIGGER) &&
    (since === null || since >= MIN_DAYS_BETWEEN_DRAWS)
  ) {
    return result("A2", "DRAW_RECOMMENDED", null);
  }

  if (
    since !== null &&
    since >= ROUTINE_DAYS &&
    state.lastPanelClass === "BASELINE" &&
    lastDaysAll(state.dss, CALM_DAYS, (v) => v < DSS_CALM)
  ) {
    // the same skip stays in force until its re-check day; only a new skip saves a kit
    if (state.skipRecheckDay !== null && state.today < state.skipRecheckDay) {
      return result("A3", "SKIP", state.skipRecheckDay);
    }
    const recheck = state.today + SKIP_RECHECK_DAYS;
    return result("A3", "SKIP", recheck, { ...state, kitsSaved: state.kitsSaved + 1, skipRecheckDay: recheck });
  }

  if (since === null || since >= ROUTINE_DAYS) return result("A4", "DRAW", null);

  return result("A6", "NO_DRAW", null);
}

export interface ImportResult {
  state: DrawState;
  /** "A5" when the new panel is UNEXPECTED_ACTIVATION */
  rule: "A5" | null;
  /** A5: symptom check now */
  symptomCheck: boolean;
  /** the re-test day set by this panel (A5: +3 days; EXPECTED: first re-test of section 4.8), null when none */
  retestDay: number | null;
}

/**
 * A panel was imported: one kit used, last panel day / class updated, any pending re-test consumed. A5: an
 * UNEXPECTED_ACTIVATION panel sets a re-test 3 days later plus a symptom check; an EXPECTED_FLIGHT_RESPONSE panel sets
 * its first re-test (spec section 4.8, `recoveryFor`).
 */
export function importPanel(state: DrawState, panel: PanelResult): ImportResult {
  const day = panel.missionDay;
  let retestDay: number | null = null;
  let rule: "A5" | null = null;
  if (panel.cls === "UNEXPECTED_ACTIVATION") {
    retestDay = day + UNEXPECTED_RETEST_DAYS;
    rule = "A5";
  } else if (panel.cls === "EXPECTED_FLIGHT_RESPONSE") {
    retestDay = recoveryFor(panel)?.retestMissionDay ?? null;
  }
  return {
    state: {
      ...state,
      today: Math.max(state.today, day),
      lastPanelDay: day,
      lastPanelClass: panel.cls,
      retestDay,
      panelsImported: state.panelsImported + 1,
      skipRecheckDay: null,
    },
    rule,
    symptomCheck: rule === "A5",
    retestDay,
  };
}

/**
 * The advisor state on `today`, derived from the panels drawn up to today (imported in day order) and the daily DSS
 * values (oldest first, last = today).
 */
export function drawStateFromPanels(
  panels: readonly PanelResult[],
  today: number,
  dss: readonly (number | null)[] = [],
  kitsTotal: number = KITS_TOTAL,
): DrawState {
  let state = initialDrawState(today, kitsTotal);
  for (const p of [...panels].filter((x) => x.missionDay <= today).sort((a, b) => a.missionDay - b.missionDay)) {
    state = importPanel(state, p).state;
  }
  return { ...state, today, dss };
}
