/**
 * Pure helpers of the Signature Triage cards (docs/SIGNATURE_SPEC.md section 7.2; build prompt T7-T8). No React, no
 * fetching: the cards render what these return, and tests/signature/ui.*.test.ts check them against the fixture.
 * Every number comes from the engine (via SignatureViewData) or from the fixture; nothing is computed in JSX.
 */

import type { Lang } from "@/lib/types";
import { dictionaries } from "@/i18n/dictionary";
import { translate } from "@/i18n/translate";
import { T_HIGH, T_LOW, TIMEPOINTS, TIMEPOINT_DAY, WINDOW_DAYS, Z_CAP } from "@/lib/signature/config";
import { baseline as baselineOf, preVals } from "@/lib/signature/engine";
import { glucoseRemoved, markerLabel, spokenFold, spokenInt } from "@/lib/signature/facts";
import { SIGNATURE_REFERENCE } from "@/lib/signature/reference";
import type { SignatureMarkerInfo, SignatureViewData } from "@/lib/signature/view";
import type { Envelope, MarkerTier, PanelResult, Timepoint, TriageClass } from "@/lib/signature/types";

/** UI string outside a React tree (the cards use the same keys through useI18n) */
export function tr(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  return translate(dictionaries[lang], key, vars);
}

/* ───────────── shared ───────────── */

/** the 0-100 scale of the index */
export const FRI_MAX = 100;

/** clamp a value on the 0-100 track to a CSS percentage */
export function trackPct(x: number): number {
  return Math.min(Math.max((x / FRI_MAX) * 100, 0), 100);
}

/** lab value as shown: at most two decimals, no trailing zeros (7.6, 2.67, 103, 1456.38) */
export function formatLabValue(x: number): string {
  return String(Number(x.toFixed(2)));
}

/** an FRI with one decimal, as the fixture and the spec tables print it (66.9, 30.0) */
export function formatFri(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1);
}

/** the selected panel of a crew member, or the first one */
export function panelOf(view: SignatureViewData, crew: string, tp: Timepoint): PanelResult {
  const panels = view.panels[crew] ?? view.panels[view.crew[0]];
  return panels.find((p) => p.timepoint === tp) ?? panels[0];
}

/** inside the transition window after landing (spec section 4.7) */
export function insideFlightWindow(panel: Pick<PanelResult, "missionDay">): boolean {
  return panel.missionDay <= WINDOW_DAYS;
}

/* ───────────── Triage card (spec section 7.2 item 1) ───────────── */

export type ZoneTone = "slate" | "amber" | "teal" | "red";

export interface TrackZone {
  from: number;
  to: number;
  tone: ZoneTone;
}

export interface TriageTrack {
  /** FRI with one decimal, null when INSUFFICIENT */
  fri: number | null;
  /** as shown: integer */
  friLabel: string | null;
  band: [number, number] | null;
  bandLabel: [string, string] | null;
  /** 0-20 slate, 20-40 amber tint, 40-100 teal inside the flight window / red tint outside it */
  zones: TrackZone[];
  /** tick values under the track */
  ticks: number[];
}

export function triageTrack(panel: PanelResult): TriageTrack {
  const high: ZoneTone = insideFlightWindow(panel) ? "teal" : "red";
  return {
    fri: panel.fri,
    friLabel: panel.fri === null ? null : spokenInt(panel.fri),
    band: panel.band,
    bandLabel: panel.band ? [spokenInt(panel.band[0]), spokenInt(panel.band[1])] : null,
    zones: [
      { from: 0, to: T_LOW, tone: "slate" },
      { from: T_LOW, to: T_HIGH, tone: "amber" },
      { from: T_HIGH, to: FRI_MAX, tone: high },
    ],
    ticks: [0, T_LOW, T_HIGH, FRI_MAX],
  };
}

export type BadgeTone = "teal" | "red" | "amber" | "slate";

export function classTone(cls: TriageClass): BadgeTone {
  if (cls === "EXPECTED_FLIGHT_RESPONSE") return "teal";
  if (cls === "UNEXPECTED_ACTIVATION") return "red";
  if (cls === "INDETERMINATE") return "amber";
  return "slate";
}

export function classLabel(cls: TriageClass, lang: Lang): string {
  return tr(lang, `dashboard.signature.class.${cls}`);
}

/** one-line reason under the badge ("Day 1 after landing: inside the flight window") */
export function reasonText(panel: PanelResult, lang: Lang): string {
  if (panel.cls === "INSUFFICIENT") return tr(lang, "dashboard.signature.reason.insufficient");
  const vars = { day: panel.missionDay, window: WINDOW_DAYS };
  return tr(lang, insideFlightWindow(panel) ? "dashboard.signature.reason.inside" : "dashboard.signature.reason.outside", vars);
}

export interface NoiseStrip {
  /** the 12 control scores, sorted (fixture `noise_floor.sorted`) */
  dots: number[];
  n: number;
  median: number;
  max: number;
  /** controls at or above T_LOW (outside the baseline zone with no flight) */
  above: { count: number; lo: number; hi: number } | null;
}

/** "How sure are we?": the no-flight control panels of spec section 4.6, read from the fixture */
export function noiseStrip(nf: { sorted: number[]; median: number; max: number } = SIGNATURE_REFERENCE.noise_floor): NoiseStrip {
  const dots = [...nf.sorted];
  const above = dots.filter((d) => d >= T_LOW);
  return {
    dots,
    n: dots.length,
    median: nf.median,
    max: nf.max,
    above: above.length ? { count: above.length, lo: Math.trunc(Math.min(...above)), hi: Math.trunc(Math.max(...above)) } : null,
  };
}

export function noiseCaption(strip: NoiseStrip, lang: Lang): string {
  if (!strip.above) return tr(lang, "dashboard.signature.sure.captionNone", { n: strip.n, t: T_LOW });
  return tr(lang, "dashboard.signature.sure.caption", {
    count: strip.above.count,
    n: strip.n,
    lo: strip.above.lo,
    hi: strip.above.hi,
  });
}

/* ───────────── Fingerprint card (spec section 7.2 item 2) ───────────── */

export function clipZ(z: number): number {
  return Math.min(Math.max(z, -Z_CAP), Z_CAP);
}

export interface FingerprintRow {
  name: string;
  label: string;
  tier: MarkerTier;
  unit: string;
  /** z of this panel (null: the marker did not score, e.g. removed by QC) */
  z: number | null;
  /** z clipped to [-Z_CAP, Z_CAP] (the bar) */
  bar: number | null;
  capped: boolean;
  /** min-max z of the other three Inspiration4 crew at R+1 (raw) */
  envelope: [number, number] | null;
  value: number | null;
  baseline: number | null;
  fold: number | null;
  position: Envelope | null;
  /** why there is no bar */
  missing: "qc" | "absent" | null;
}

/** marker name as shown (IL-6, MCP-1, ..., Glucose, Monocytes %) */
export function markerName(name: string, lang: Lang): string {
  if (name === "glucose" || name === "monocytes") return tr(lang, `dashboard.signature.marker.${name}`);
  return markerLabel(name);
}

/** Inspiration4 envelope for `crew`: min-max z at R+1 of the other reference crew (computed from the matrix) */
export function envelopeFor(marker: SignatureMarkerInfo, crew: string): [number, number] | null {
  const zs = Object.entries(marker.zR1)
    .filter(([c, z]) => c !== crew && z !== null)
    .map(([, z]) => z as number);
  return zs.length ? [Math.min(...zs), Math.max(...zs)] : null;
}

export function fingerprintRows(view: SignatureViewData, panel: PanelResult, lang: Lang): FingerprintRow[] {
  return view.markers.map((m) => {
    const r = panel.markers[m.name];
    const qc = !r && m.name === "glucose" && glucoseRemoved(panel, view.qcLog);
    return {
      name: m.name,
      label: markerName(m.name, lang),
      tier: m.tier,
      unit: m.unit,
      z: r ? r.z : null,
      bar: r ? clipZ(r.z) : null,
      capped: r ? Math.abs(r.z) > Z_CAP : false,
      envelope: envelopeFor(m, panel.crew),
      value: r ? r.value : null,
      baseline: r ? r.baseline : null,
      fold: r ? r.fold : null,
      position: r ? r.envelope : null,
      missing: r ? null : qc ? "qc" : "absent",
    };
  });
}

/** the tooltip line of a bar: value + unit, own baseline, fold, above all pre-flight values yes / no */
export function markerTooltip(row: FingerprintRow, lang: Lang): string {
  if (row.value === null || row.baseline === null || row.fold === null || row.position === null) {
    return tr(lang, row.missing === "qc" ? "dashboard.signature.fp.qcRemoved" : "dashboard.signature.fp.missing");
  }
  return tr(lang, "dashboard.signature.fp.tooltip", {
    value: formatLabValue(row.value),
    unit: row.unit,
    baseline: formatLabValue(row.baseline),
    fold: spokenFold(row.fold),
    position: tr(lang, `dashboard.signature.fp.pos.${row.position}`),
  });
}

export interface OtherChange {
  label: string;
  fold: string;
  direction: "up" | "down";
}

/**
 * Display label of any analyte column name: a short head is an acronym (il_12p40 -> IL-12p40, tarc -> TARC), a long one
 * a word (eotaxin_3 -> Eotaxin-3); TNFα / IFNγ keep their Greek letter.
 */
export function analyteLabel(analyte: string): string {
  if (/^(tnf|ifn)/u.test(analyte)) return markerLabel(analyte);
  const [head, ...rest] = analyte.split("_");
  const h = head.length <= 5 ? head.toUpperCase() : head.charAt(0).toUpperCase() + head.slice(1);
  return [h, ...rest].join("-");
}

/** "Other large changes" (information only): label and fold as shown */
export function otherChanges(panel: PanelResult): OtherChange[] {
  return panel.otherLargeChanges.map((o) => ({
    label: analyteLabel(o.analyte),
    fold: spokenFold(o.fold),
    direction: o.fold >= 1 ? "up" : "down",
  }));
}

export interface DrawerPoint {
  tp: Timepoint;
  day: number;
  value: number | null;
  /** post-flight draw (vs the three pre-flight baseline draws) */
  post: boolean;
}

/** the analyte drawer: one marker over the seven draws of one crew member, plus the own pre-flight baseline */
export function drawerSeries(
  view: SignatureViewData,
  name: string,
  crew: string,
): { points: DrawerPoint[]; baseline: number | null; unit: string } | null {
  const m = view.markers.find((x) => x.name === name);
  if (!m) return null;
  const s = m.series[crew] ?? {};
  const points = TIMEPOINTS.map((tp) => ({ tp, day: TIMEPOINT_DAY[tp], value: s[tp] ?? null, post: TIMEPOINT_DAY[tp] > 0 }));
  const pre = preVals(s);
  return { points, baseline: pre.length ? baselineOf(pre) : null, unit: m.unit };
}
