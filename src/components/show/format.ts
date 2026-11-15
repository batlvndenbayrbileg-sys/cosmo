import type { KpiKey, Lang, MeasurementValue } from "@/lib/types";
import { KPI_DEFS, asNumber, formatValue } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import { unitLabel } from "@/components/dashboard/logic";

/** digits shown for a key's numbers (the same as the dashboard cards: whole numbers except hours and degrees) */
export function digitsOf(key: KpiKey): number {
  const def = KPI_DEFS[key];
  if (def.type !== "number") return 0;
  return key === "sleep_hours" || key === "temperature_c" ? 1 : 0;
}

/** a value as a panel prints it: "72 bpm", "7.5 h", "Clear", "4/5"; `withUnit` false drops the unit ("118" of "118/76") */
export function valueText(key: KpiKey, value: MeasurementValue, lang: Lang, withUnit: boolean): string {
  const def = KPI_DEFS[key];
  const n = asNumber(value);
  if (def.type === "text" || n === null || def.type === "boolean" || def.type === "category" || def.type === "scale") {
    return formatValue(key, value, lang);
  }
  const num = formatNumber(n, digitsOf(key));
  const unit = unitLabel(def.unit, lang);
  return withUnit && unit ? `${num} ${unit}` : num;
}

/** a plain number with the key's digits ("Usual 68") */
export function numberText(key: KpiKey, n: number): string {
  return formatNumber(n, digitsOf(key));
}
