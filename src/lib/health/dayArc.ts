/**
 * Day arc: which parts of the day are logged (docs/DASHBOARD_PLAN.md section 3, element 6).
 * A slot is "done" when every non-optional key of its questions has a value, "partial" when some key has one.
 */

import type { DayArcSlot, KpiKey, MeasurementValue, SlotKey } from "../types";
import { OPTIONAL_KEYS, QUESTIONS } from "../kpi/registry";
import { isPresent } from "./status";

export const SLOT_ORDER: SlotKey[] = ["morning", "midday", "afternoon", "evening"];

export function computeDayArc(today: Partial<Record<KpiKey, MeasurementValue>>): DayArcSlot[] {
  return SLOT_ORDER.map((slot) => {
    const keys = QUESTIONS.filter((q) => q.slot === slot).flatMap((q) => q.keys);
    const logged = keys.filter((k) => isPresent(today[k]));
    const missing = keys.filter((k) => !OPTIONAL_KEYS.has(k) && !isPresent(today[k]));
    const state: DayArcSlot["state"] = missing.length === 0 ? "done" : logged.length > 0 ? "partial" : "pending";
    return { slot, state, logged, missing };
  });
}
