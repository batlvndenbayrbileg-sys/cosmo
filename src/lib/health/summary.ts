/**
 * Summary findings (docs/DASHBOARD_PLAN.md section 2, step 9).
 * Code decides what is said and which numbers appear; the LLM may only rephrase this object.
 */

import type {
  Bilingual,
  Finding,
  KpiKey,
  MeasurementValue,
  RedFlag,
  Status,
  SummaryFindings,
  Task,
} from "../types";
import { KPI_KEYS } from "../types";
import { KPI_DEFS, asNumber, formatValue } from "../kpi/registry";
import type { Baseline } from "./baseline";
import { formatNumber } from "./format";
import { STATUS_RANK, type IndicatorEval } from "./status";

export { formatNumber };

export const DISCLAIMER: Bilingual = {
  en: "Decision support, not a diagnosis.",
  mn: "Шийдвэр гаргахад туслах мэдээлэл, онош биш.",
};

export const MAX_FINDINGS = 2;
export const MAX_RECOMMENDATIONS = 2;

export interface SummaryContext {
  today: Partial<Record<KpiKey, MeasurementValue>>;
  indicators: Record<KpiKey, IndicatorEval>;
  baselines: Partial<Record<KpiKey, Baseline>>;
  redFlags: RedFlag[];
  overall: Status;
  readiness: number;
  /** false when fewer than 3 axes have data: the readiness 0 is then a placeholder and is never printed. Default true. */
  readinessAvailable?: boolean;
  tasks: Task[];
}

type FlaggedStatus = Finding["status"];

function directionOf(key: KpiKey, value: number, ev: IndicatorEval): "high" | "low" | null {
  const th = KPI_DEFS[key].thresholds;
  if (ev.reason === "baseline") {
    if (ev.delta === null || ev.delta === 0) return null;
    return ev.delta > 0 ? "high" : "low";
  }
  if (th?.low && value < th.low.yellow) return "low";
  if (th?.high && value > th.high.yellow) return "high";
  return null;
}

function unitSuffix(key: KpiKey, lang: "en" | "mn"): string {
  // formatValue("...") renders "<n> <unit>"; reuse it to get the unit in the right language
  const def = KPI_DEFS[key];
  if (!def.unit) return "";
  const sample = formatValue(key, 1, lang);
  const idx = sample.indexOf(" ");
  return idx >= 0 ? sample.slice(idx) : "";
}

function findingText(
  key: KpiKey,
  value: number,
  ev: IndicatorEval,
  baseline: Baseline | undefined,
  direction: "high" | "low" | null,
): Bilingual {
  const def = KPI_DEFS[key];
  const fvEn = formatValue(key, value, "en");
  const fvMn = formatValue(key, value, "mn");

  if (def.type === "boolean") {
    return {
      en: `${def.labels.en} reported today.`,
      mn: `Өнөөдөр "${def.labels.mn}" гэж тэмдэглэсэн.`,
    };
  }
  if (def.type === "category") {
    return {
      en: `${def.labels.en}: ${fvEn.toLowerCase()}.`,
      mn: `${def.labels.mn}: ${fvMn.toLowerCase()}.`,
    };
  }

  const digits = def.type === "integer" ? 0 : 1;
  const mean = baseline?.mean ?? null;
  if (mean !== null && ev.delta !== null && direction !== null) {
    const aligned = (direction === "low" && ev.delta < 0) || (direction === "high" && ev.delta > 0);
    const gap = formatNumber(Math.abs(ev.delta), digits);
    if (aligned && gap !== "0") {
      const usEn = unitSuffix(key, "en");
      const usMn = unitSuffix(key, "mn");
      const meanStr = formatNumber(mean, digits);
      const sign = direction === "low" ? "-" : "+";
      return {
        en: `${def.labels.en} was ${fvEn}, about ${gap}${usEn} ${direction === "low" ? "below" : "above"} your usual ${meanStr}${usEn}.`,
        mn: `${def.labels.mn}: ${fvMn}. Таны ердийн хэмжээ ${meanStr}${usMn}, зөрүү ${sign}${gap}${usMn}.`,
      };
    }
  }

  const th = def.thresholds;
  const unitEn = unitSuffix(key, "en");
  const unitMn = unitSuffix(key, "mn");
  if (direction === "low" && th?.low) {
    const bound = formatNumber(th.low.yellow, 2);
    return {
      en: `${def.labels.en} was ${fvEn}, below the demo range (from ${bound}${unitEn}).`,
      mn: `${def.labels.mn}: ${fvMn}. Демо мужаас доогуур байна (${bound}${unitMn}-аас).`,
    };
  }
  if (direction === "high" && th?.high) {
    const bound = formatNumber(th.high.yellow, 2);
    return {
      en: `${def.labels.en} was ${fvEn}, above the demo range (up to ${bound}${unitEn}).`,
      mn: `${def.labels.mn}: ${fvMn}. Демо мужаас дээгүүр байна (${bound}${unitMn}-ээс).`,
    };
  }
  return {
    en: `${def.labels.en} was ${fvEn}, outside your usual range.`,
    mn: `${def.labels.mn}: ${fvMn}. Ердийн хэмжээнээс зөрүүтэй байна.`,
  };
}

/** non-green indicators, red before yellow, then by |z| descending (missing z counts as 0); max 2 */
export function buildFindings(ctx: SummaryContext): Finding[] {
  const flagged = KPI_KEYS.map((key, order) => ({ key, order, ev: ctx.indicators[key] }))
    .filter((x) => x.ev.status === "yellow" || x.ev.status === "red")
    .sort(
      (a, b) =>
        STATUS_RANK[b.ev.status] - STATUS_RANK[a.ev.status] ||
        Math.abs(b.ev.z ?? 0) - Math.abs(a.ev.z ?? 0) ||
        a.order - b.order,
    );

  const findings: Finding[] = [];
  for (const { key, ev } of flagged) {
    const value = ctx.today[key];
    const n = asNumber(value);
    if (value === undefined || n === null) continue;
    const baseline = ctx.baselines[key];
    const direction = directionOf(key, n, ev);
    findings.push({
      key,
      status: ev.status as FlaggedStatus,
      reason: ev.reason,
      value: n,
      unit: KPI_DEFS[key].unit,
      baselineMean: baseline?.mean ?? null,
      z: ev.z,
      direction,
      text: findingText(key, n, ev, baseline, direction),
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings;
}

function headlineFor(ctx: SummaryContext): Bilingual {
  const r = formatNumber(ctx.readiness, 0);
  const showReadiness = ctx.readinessAvailable !== false;
  const readinessEn = showReadiness ? ` Readiness is ${r} out of 100.` : "";
  const readinessMn = showReadiness ? ` Бэлэн байдал 100-аас ${r}.` : "";
  let base: Bilingual;
  switch (ctx.overall) {
    case "red":
      base = {
        en: `Alert: a few readings need attention.${readinessEn}`,
        mn: `Анхааруулга: зарим заалт анхаарал шаардаж байна.${readinessMn}`,
      };
      break;
    case "yellow":
      base = {
        en: `A few things to keep an eye on today.${readinessEn}`,
        mn: `Өнөөдөр анхаарах хэдэн зүйл байна.${readinessMn}`,
      };
      break;
    case "green":
      base = {
        en: `Everything looks steady today.${readinessEn}`,
        mn: `Өнөөдөр бүх зүйл тогтвортой байна.${readinessMn}`,
      };
      break;
    default:
      base = {
        en: "Not enough data yet for an overall picture.",
        mn: "Нэгдсэн дүр зураг гаргахад мэдээлэл хараахан хүрэлцэхгүй байна.",
      };
  }

  const symptomCount = (["symptom_headache", "symptom_dizziness", "symptom_nausea"] as KpiKey[]).filter(
    (k) => asNumber(ctx.today[k]) === 1,
  ).length;
  if (symptomCount >= 2) {
    return {
      en: `${base.en} Several symptoms were reported, so please mention this to your crew medical officer.`,
      mn: `${base.mn} Хэд хэдэн шинж тэмдэг тэмдэглэгдсэн тул багийн эмнэлгийн офицерт хэлээрэй.`,
    };
  }
  return base;
}

/** everything the summary says, decided by code: headline, max 2 findings, max 2 recommendations, red flags, disclaimer */
export function composeSummaryFindings(ctx: SummaryContext): SummaryFindings {
  return {
    overall: ctx.overall,
    readiness: ctx.readiness,
    headline: headlineFor(ctx),
    findings: buildFindings(ctx),
    recommendations: ctx.tasks.slice(0, MAX_RECOMMENDATIONS),
    redFlags: ctx.redFlags,
    disclaimer: DISCLAIMER,
  };
}
