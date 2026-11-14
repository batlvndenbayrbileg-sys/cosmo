/**
 * Pure helpers behind the dashboard UI (no React, no DOM, no I/O) so they can be unit-tested in node.
 * Everything here only arranges and formats values the server already computed: no medical number,
 * status or comparison is decided in this file. The one exception is the timeline (buildTimeline), which
 * re-runs the shared health engine (src/lib/health) on the recorded history days, exactly as the server would.
 */

import type {
  AxisKey,
  AxisScore,
  DayArcSlot,
  HazardKey,
  HazardStat,
  KpiKey,
  KpiStat,
  Lang,
  MeasurementValue,
  SlotKey,
  Status,
  Task,
} from "@/lib/types";
import { KPI_KEYS } from "@/lib/types";
import { KPI_DEFS, asNumber, formatValue } from "@/lib/kpi/registry";
import { formatNumber } from "@/lib/health/format";
import { MIN_AXES_FOR_READINESS, computeOverall } from "@/lib/health/scores";
import { computeBaselines, type HistoryDay } from "@/lib/health/baseline";
import { evaluateIndicators } from "@/lib/health/status";
import { evaluateRedFlags } from "@/lib/health/flags";
import { dictionaries } from "@/i18n/dictionary";
import { translate } from "@/i18n/translate";

export type Viewer = "crew" | "ground";

/* ───────────── units and values ───────────── */

const MN_UNITS: Record<string, string> = { h: "цаг", min: "мин", ml: "мл", bpm: "удаа/мин" };

/** unit as shown next to a number; Mongolian renders the few word-like units in Cyrillic */
export function unitLabel(unit: string | null, lang: Lang): string {
  if (!unit) return "";
  return lang === "mn" ? (MN_UNITS[unit] ?? unit) : unit;
}

export interface DisplayValue {
  /** the big part, e.g. "5.5", "124", "Clear", "4" */
  main: string;
  /** the small part, e.g. "h", "mmHg", "/5"; empty when there is none */
  unit: string;
}

/** big-number text for a stored value; text keys come back as the raw string */
export function displayValue(key: KpiKey, value: MeasurementValue, lang: Lang): DisplayValue {
  const def = KPI_DEFS[key];
  if (def.type === "text") return { main: String(value), unit: "" };
  const n = asNumber(value);
  if (n === null) return { main: String(value), unit: "" };
  if (def.type === "boolean" || def.type === "category") {
    return { main: formatValue(key, n, lang), unit: "" };
  }
  if (def.type === "scale") return { main: formatNumber(n, 1), unit: `/${def.max ?? 5}` };
  return {
    main: formatNumber(n, def.type === "integer" ? 0 : 2),
    unit: unitLabel(def.unit, lang),
  };
}

/* ───────────── "vs your usual" delta line ───────────── */

export type DeltaKind = "below" | "above" | "same" | "none";

export interface DeltaText {
  kind: DeltaKind;
  text: string;
}

const t = (lang: Lang, key: string, vars?: Record<string, string | number>) =>
  translate(dictionaries[lang], key, vars);

/**
 * "1.7 h below your usual" / "Ердийнхөөс 1.7 цаг бага". Only for numeric, scale and integer keys with a personal
 * baseline; booleans and categories have no meaningful gap ("none" with no text); a missing baseline gives the
 * "no personal baseline yet" line.
 */
export function formatDeltaText(stat: KpiStat, lang: Lang): DeltaText {
  const def = KPI_DEFS[stat.key];
  if (def.type === "text" || def.type === "boolean" || def.type === "category") {
    return { kind: "none", text: "" };
  }
  if (stat.status === "no_data" || stat.value === null) return { kind: "none", text: "" };
  if (stat.delta === null || stat.baselineMean === null) {
    return { kind: "none", text: t(lang, "dashboard.delta.none") };
  }
  const digits = def.type === "integer" ? 0 : 1;
  const gap = formatNumber(Math.abs(stat.delta), digits);
  if (gap === "0") return { kind: "same", text: t(lang, "dashboard.delta.same") };
  const unit = unitLabel(def.unit, lang);
  const amount = unit ? `${gap} ${unit}` : gap;
  return stat.delta < 0
    ? { kind: "below", text: t(lang, "dashboard.delta.below", { amount }) }
    : { kind: "above", text: t(lang, "dashboard.delta.above", { amount }) };
}

export interface ReadinessDelta {
  kind: DeltaKind;
  /** whole points, absolute */
  points: number;
}

/** readiness minus the person's own usual readiness, in whole points */
export function readinessDelta(readiness: number, baseline: number | null): ReadinessDelta {
  if (baseline === null) return { kind: "none", points: 0 };
  const diff = Math.round(readiness) - Math.round(baseline);
  if (diff === 0) return { kind: "same", points: 0 };
  return { kind: diff < 0 ? "below" : "above", points: Math.abs(diff) };
}

/* ───────────── status helpers ───────────── */

const SEVERITY: Record<Status, number> = { red: 3, yellow: 2, green: 1, no_data: 0 };

/** worst status among members that have data; no_data only when none has */
export function worstOf(statuses: readonly Status[]): Status {
  let worst: Status = "no_data";
  for (const s of statuses) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

/**
 * Readiness to show for a crew status card. The card carries no axes, so availability is derived from its stars
 * with the same rule as isReadinessAvailable: at least MIN_AXES_FOR_READINESS distinct axes that have data
 * (a star whose status is not "no_data"). Below that the engine's bare 0 is hidden: null means "not available".
 */
export function crewCardReadiness(card: {
  readiness: number | null;
  stars: ReadonlyArray<{ key: KpiKey; status: Status }>;
}): number | null {
  if (card.readiness === null) return null;
  const axes = new Set<AxisKey>();
  for (const star of card.stars) {
    const axis = KPI_DEFS[star.key].axis;
    if (star.status !== "no_data" && axis !== null) axes.add(axis);
  }
  return axes.size >= MIN_AXES_FOR_READINESS ? card.readiness : null;
}

/** CSS colour variable of a status, for SVG strokes and chart fills (always paired with a glyph in the UI) */
export function statusColorVar(status: Status): string {
  switch (status) {
    case "green":
      return "var(--status-ok)";
    case "yellow":
      return "var(--status-watch)";
    case "red":
      return "var(--status-alert)";
    case "no_data":
      return "var(--status-nodata)";
  }
}

/* ───────────── vital cards: BP and symptoms collapse into one card each ───────────── */

export type KpiCardId = KpiKey | "bp" | "symptoms";

export interface KpiCardModel {
  id: KpiCardId;
  kind: "single" | "bp" | "symptoms" | "note";
  /** the numeric/boolean keys shown on the card (hazard mapping looks at these) */
  keys: KpiKey[];
  /** free-text key shown on the card for the crew viewer only */
  noteKey: KpiKey | null;
}

const SYMPTOM_KEYS: KpiKey[] = ["symptom_headache", "symptom_dizziness", "symptom_nausea"];

/**
 * Card list in slot order: one card per indicator, except Symptoms (headache + dizziness + nausea + note)
 * and Blood pressure (systolic + diastolic), which are one card each. Free-text keys are dropped
 * entirely for the ground viewer. Keys missing from the payload are skipped.
 */
export function buildKpiCards(kpis: readonly KpiStat[], viewer: Viewer): KpiCardModel[] {
  const present = new Set<KpiKey>(kpis.map((k) => k.key));
  const cards: KpiCardModel[] = [];
  for (const key of KPI_KEYS) {
    if (!present.has(key)) continue;
    if (key === "symptom_headache") {
      cards.push({
        id: "symptoms",
        kind: "symptoms",
        keys: SYMPTOM_KEYS.filter((k) => present.has(k)),
        noteKey: viewer === "crew" && present.has("symptom_note") ? "symptom_note" : null,
      });
    } else if (key === "symptom_dizziness" || key === "symptom_nausea" || key === "symptom_note") {
      continue; // folded into the symptoms card
    } else if (key === "bp_systolic") {
      cards.push({
        id: "bp",
        kind: "bp",
        keys: (["bp_systolic", "bp_diastolic"] as KpiKey[]).filter((k) => present.has(k)),
        noteKey: null,
      });
    } else if (key === "bp_diastolic") {
      continue; // folded into the blood-pressure card
    } else if (KPI_DEFS[key].type === "text") {
      if (viewer === "ground") continue; // day_note: never shown to ground
      cards.push({ id: key, kind: "note", keys: [key], noteKey: null });
    } else {
      cards.push({ id: key, kind: "single", keys: [key], noteKey: null });
    }
  }
  return cards;
}

/** worst member status of a card (the card's pill) */
export function cardStatus(card: KpiCardModel, byKey: ReadonlyMap<KpiKey, KpiStat>): Status {
  return worstOf(card.keys.map((k) => byKey.get(k)?.status ?? "no_data"));
}

/** ids of the cards whose indicators are linked to the hazard */
export function cardsRelatedToHazard(
  cards: readonly KpiCardModel[],
  hazard: HazardStat | null,
): Set<KpiCardId> {
  const related = new Set<KpiCardId>();
  if (!hazard) return related;
  for (const card of cards) {
    if (card.keys.some((k) => hazard.keys.includes(k))) related.add(card.id);
  }
  return related;
}

/** related cards first (original order kept inside each group); no hazard -> unchanged order */
export function sortCardsForHazard(
  cards: readonly KpiCardModel[],
  hazard: HazardStat | null,
): KpiCardModel[] {
  if (!hazard) return [...cards];
  const related = cardsRelatedToHazard(cards, hazard);
  return [...cards.filter((c) => related.has(c.id)), ...cards.filter((c) => !related.has(c.id))];
}

/** a task is related to the selected hazard by its own hazard tag or by a shared indicator */
export function isTaskRelated(task: Task, hazard: HazardStat | null): boolean {
  if (!hazard) return false;
  return task.hazard === hazard.hazard || task.relatedKeys.some((k) => hazard.keys.includes(k));
}

/* ───────────── sparkline geometry ───────────── */

export interface SparklineInput {
  /** past days, oldest first */
  history: readonly number[];
  today: number | null;
  /** personal baseline mean and the sd to shade (callers pass max(sd, sdFloor), like the status model) */
  mean: number | null;
  sd: number | null;
  width: number;
  height: number;
  /** inner padding in px (default 4) */
  pad?: number;
}

export interface SparklineGeometry {
  points: Array<{ x: number; y: number; value: number }>;
  /** SVG path of the past days only; empty with fewer than 2 points */
  linePath: string;
  /** y range of the mean +/- 2 sd band (top < bottom on screen) */
  band: { top: number; bottom: number } | null;
  /** today's dot, always the last x position */
  today: { x: number; y: number } | null;
  domain: { min: number; max: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** the sd used for the band: never below the indicator's sdFloor, same rule as the z-score */
export function effectiveSd(key: KpiKey, sd: number | null): number | null {
  if (sd === null) return null;
  return Math.max(sd, KPI_DEFS[key].sdFloor ?? 0);
}

/**
 * Maps a history, today's point and the mean +/- 2 sd band into a width x height box.
 * The y domain always contains the band and every point, so the band is never clipped.
 */
export function sparklineGeometry(input: SparklineInput): SparklineGeometry {
  const { history, today, mean, sd, width, height } = input;
  const pad = input.pad ?? 4;
  const hasBand = mean !== null && sd !== null && Number.isFinite(mean) && Number.isFinite(sd);
  const bandLow = hasBand ? (mean as number) - 2 * (sd as number) : null;
  const bandHigh = hasBand ? (mean as number) + 2 * (sd as number) : null;

  const values: number[] = [...history];
  if (today !== null) values.push(today);
  if (bandLow !== null && bandHigh !== null) values.push(bandLow, bandHigh);

  if (values.length === 0) {
    return { points: [], linePath: "", band: null, today: null, domain: { min: 0, max: 1 } };
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-9) {
    const slack = Math.max(Math.abs(max) * 0.1, 1);
    min -= slack;
    max += slack;
  }
  const margin = (max - min) * 0.06;
  min -= margin;
  max += margin;

  const innerW = Math.max(width - 2 * pad, 0);
  const innerH = Math.max(height - 2 * pad, 0);
  const total = history.length + (today !== null ? 1 : 0);
  const xAt = (i: number) => (total <= 1 ? width / 2 : pad + (i * innerW) / (total - 1));
  const yAt = (v: number) => height - pad - ((v - min) / (max - min)) * innerH;

  const points = history.map((value, i) => ({ x: r2(xAt(i)), y: r2(yAt(value)), value }));
  const linePath =
    points.length < 2 ? "" : points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const band =
    bandLow !== null && bandHigh !== null
      ? { top: r2(yAt(bandHigh)), bottom: r2(yAt(bandLow)) }
      : null;
  const todayPoint = today !== null ? { x: r2(xAt(total - 1)), y: r2(yAt(today)) } : null;

  return { points, linePath, band, today: todayPoint, domain: { min, max } };
}

/* ───────────── day arc ───────────── */

export type NextSlot = SlotKey | "bedtime";

/** first slot that is not done; "bedtime" when all four check-in slots are done */
export function nextSlot(dayArc: readonly DayArcSlot[]): NextSlot {
  const open = dayArc.find((s) => s.state !== "done");
  return open ? open.slot : "bedtime";
}

/* ───────────── clock text (UTC, so server and browser always agree) ───────────── */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "14:07" from an ISO instant, in UTC; "-" when the instant is not valid */
export function formatClockUtc(iso: string | null): string {
  if (iso === null) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** "{time} UTC" in the given language */
export function formatClockLabel(iso: string | null, lang: Lang): string {
  return t(lang, "dashboard.time.utc", { time: formatClockUtc(iso) });
}

/** the instant `ms` after `iso`, as ISO; null when `iso` is not valid */
export function addMs(iso: string | null, ms: number): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + ms).toISOString();
}

/* ───────────── history helpers ───────────── */

/**
 * Past days on which at least one of the given boolean indicators was reported (value 1), out of the
 * number of past days that have any history for them.
 */
export function symptomDays(stats: readonly KpiStat[]): { count: number; total: number } {
  const dates = new Set<string>();
  const reported = new Set<string>();
  for (const stat of stats) {
    for (const point of stat.history) {
      dates.add(point.date);
      if (point.value === 1) reported.add(point.date);
    }
  }
  return { count: reported.size, total: dates.size };
}

/* ───────────── summary audio ───────────── */

/** same-origin URL of the summary turn's audio (no text travels in the URL) */
export function summaryAudioUrl(checkInId: string, turnId: string): string {
  return `/api/checkins/${encodeURIComponent(checkInId)}/turns/${encodeURIComponent(turnId)}/audio`;
}

/* ───────────── entrance animation ───────────── */

const MAX_DELAY_S = 0.7;
const STEP_S = 0.06;

/** Delay in seconds for the n-th card of the staggered entrance (capped so late cards do not wait). */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0) * STEP_S, MAX_DELAY_S);
}

/* ═════════════ design v2 (docs/DESIGN_V2.md section 2) ═════════════ */

/* ───────────── body map ───────────── */

export interface BodyHotspot {
  axis: AxisKey;
  /** normalised position on public/body/body-figure.png (0..1 of width / height) */
  x: number;
  y: number;
}

/**
 * One hotspot per radar axis, head to knee (also the ‹ › cycling order). Positions were checked against the
 * 1020x1536 render: head centre, forehead side, the glowing heart, the figure's right shoulder, the navel, the
 * figure's right knee.
 */
export const BODY_HOTSPOTS: readonly BodyHotspot[] = [
  { axis: "neuro_ocular", x: 0.5, y: 0.085 },
  { axis: "sleep", x: 0.565, y: 0.05 },
  { axis: "cardio", x: 0.515, y: 0.245 },
  { axis: "behavioral", x: 0.37, y: 0.205 },
  { axis: "metabolic", x: 0.5, y: 0.37 },
  { axis: "musculoskeletal", x: 0.425, y: 0.665 },
];

const AXIS_CYCLE: readonly AxisKey[] = BODY_HOTSPOTS.map((h) => h.axis);

/** next / previous axis in the head-to-knee order (wraps); null starts at the first */
export function cycleAxis(current: AxisKey | null, step: 1 | -1): AxisKey {
  if (current === null) return step === 1 ? AXIS_CYCLE[0] : AXIS_CYCLE[AXIS_CYCLE.length - 1];
  const i = AXIS_CYCLE.indexOf(current);
  const n = AXIS_CYCLE.length;
  return AXIS_CYCLE[(((i + step) % n) + n) % n];
}

/** indicators (non-text) that feed a body axis, registry order */
export function axisKeys(axis: AxisKey): KpiKey[] {
  return KPI_KEYS.filter((k) => KPI_DEFS[k].axis === axis && KPI_DEFS[k].type !== "text");
}

/** the NASA hazard most of an axis's indicators are linked to (ties: registry order) */
export function axisHazard(axis: AxisKey): HazardKey | null {
  const counts = new Map<HazardKey, number>();
  for (const key of axisKeys(axis)) {
    for (const h of KPI_DEFS[key].hazards) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  let best: HazardKey | null = null;
  let bestN = 0;
  for (const [h, n] of counts) {
    if (n > bestN) {
      best = h;
      bestN = n;
    }
  }
  return best;
}

/** up to `max` indicator stats of an axis, worst status first (values before missing ones), registry order inside */
export function axisIndicators(axis: AxisKey, kpis: readonly KpiStat[], max = 3): KpiStat[] {
  const keys = axisKeys(axis);
  const stats = kpis.filter((k) => keys.includes(k.key));
  return [...stats]
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || keys.indexOf(a.key) - keys.indexOf(b.key))
    .slice(0, max);
}

/** the axis with the worst status today (first in head-to-knee order on ties); null when none has data */
export function worstAxis(axes: readonly AxisScore[]): AxisKey | null {
  let best: AxisScore | null = null;
  for (const axis of AXIS_CYCLE) {
    const a = axes.find((x) => x.axis === axis);
    if (!a || a.status === "no_data") continue;
    if (!best || SEVERITY[a.status] > SEVERITY[best.status]) best = a;
  }
  return best ? best.axis : null;
}

/* ───────────── highlight vital ───────────── */

const CHARTABLE = new Set(["number", "integer", "scale"]);

/** true for indicators that can be drawn as bars (numbers, integers, scales) */
export function isChartable(key: KpiKey): boolean {
  return CHARTABLE.has(KPI_DEFS[key].type);
}

/**
 * The indicator of the highlight card: the first summary finding that can be charted, else the chartable indicator
 * furthest from the person's usual among the non-green ones, else heart rate.
 */
export function highlightKey(
  findings: ReadonlyArray<{ key: KpiKey }>,
  kpis: readonly KpiStat[],
): KpiKey {
  for (const f of findings) if (isChartable(f.key)) return f.key;
  let best: KpiStat | null = null;
  for (const k of kpis) {
    if (!isChartable(k.key) || k.status === "green" || k.status === "no_data") continue;
    const score = SEVERITY[k.status] * 100 + Math.abs(k.z ?? 0);
    const bestScore = best ? SEVERITY[best.status] * 100 + Math.abs(best.z ?? 0) : -1;
    if (score > bestScore) best = k;
  }
  return best ? best.key : "heart_rate";
}

export interface HistorySummary {
  /** the personal 14-day mean (baselineMean, else the mean of the history) */
  avg: number;
  min: number;
  max: number;
  n: number;
}

/** AVG and RANGE of a stat's past days; null without history */
export function historySummary(stat: KpiStat): HistorySummary | null {
  const values = stat.history.map((h) => h.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    avg: stat.baselineMean ?? mean,
    min: Math.min(...values),
    max: Math.max(...values),
    n: values.length,
  };
}

export interface Bar {
  date: string | null;
  value: number;
  today: boolean;
}

/** the last `count` bars: past days oldest first, then today when it has a number */
export function recentBars(stat: KpiStat, count: number): Bar[] {
  const today = stat.value === null ? null : asNumber(stat.value);
  const pastCount = Math.max(count - (today === null ? 0 : 1), 0);
  const past = stat.history.slice(-pastCount).map((h) => ({ date: h.date, value: h.value, today: false }));
  return today === null ? past : [...past, { date: null, value: today, today: true }];
}

/** progress of a value towards a target, 0..1 (null value -> null) */
export function targetFraction(value: number | null, target: number): number | null {
  if (value === null || !Number.isFinite(value) || target <= 0) return null;
  return Math.min(Math.max(value / target, 0), 1);
}

/** the "low / yellow" demo-parameter threshold of a key, used as the daily target on the mini donuts */
export function demoTarget(key: KpiKey): number | null {
  return KPI_DEFS[key].thresholds?.low?.yellow ?? null;
}

/* ───────────── timeline ───────────── */

export interface TimelineDay {
  /** YYYY-MM-DD (UTC) */
  date: string;
  status: Status;
  /** axis of the day's worst indicator; null for normal days and days without data */
  axis: AxisKey | null;
  /** at least one value was recorded that day */
  hasData: boolean;
  today: boolean;
}

const DAY_MS = 86_400_000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The last `days` days ending today (UTC dates). Past days are re-evaluated with the same health engine the
 * server uses (src/lib/health), from the values recorded that day against the days before it; nothing is
 * invented: a day without recorded values is "no_data". Today takes the payload's overall status.
 */
export function buildTimeline(
  input: { kpis: readonly KpiStat[]; overall: Status; axes: readonly AxisScore[]; confirmedAt: string },
  days = 15,
): TimelineDay[] {
  const end = new Date(input.confirmedAt);
  const endMs = Number.isNaN(end.getTime()) ? Date.now() : end.getTime();
  const todayIso = isoDate(endMs);
  const todayStart = Date.parse(`${todayIso}T00:00:00.000Z`);

  const byDate = new Map<string, Partial<Record<KpiKey, MeasurementValue>>>();
  for (const k of input.kpis) {
    for (const p of k.history) {
      const values = byDate.get(p.date) ?? {};
      values[k.key] = p.value;
      byDate.set(p.date, values);
    }
  }
  const allPast: HistoryDay[] = [...byDate.entries()]
    .filter(([date]) => date < todayIso)
    .map(([date, values]) => ({ date, values }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const out: TimelineDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = isoDate(todayStart - i * DAY_MS);
    if (date === todayIso) {
      const axis = input.overall === "green" || input.overall === "no_data" ? null : worstAxis(input.axes);
      out.push({ date, status: input.overall, axis, hasData: input.overall !== "no_data", today: true });
      continue;
    }
    const values = byDate.get(date);
    if (!values || Object.keys(values).length === 0) {
      out.push({ date, status: "no_data", axis: null, hasData: false, today: false });
      continue;
    }
    const prior = allPast.filter((d) => d.date < date);
    const indicators = evaluateIndicators(values, computeBaselines(prior));
    const status = computeOverall(indicators, evaluateRedFlags(values, indicators));
    let axis: AxisKey | null = null;
    if (status === "yellow" || status === "red") {
      let worst = 0;
      for (const key of KPI_KEYS) {
        const s = SEVERITY[indicators[key].status];
        const a = KPI_DEFS[key].axis;
        if (a !== null && s > worst) {
          worst = s;
          axis = a;
        }
      }
    }
    out.push({ date, status, axis, hasData: true, today: false });
  }
  return out;
}
