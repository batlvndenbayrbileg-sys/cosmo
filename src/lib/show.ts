/**
 * "Cosmo shows it on screen": the small animated panels that appear beside Cosmo when the astronaut asks about a value
 * ("how is my heart rate?", "миний даралт ямар байна?", "show my sleep") or when a value was just recorded.
 *
 * Shared contract only (types and pure helpers, no server imports): the server decides WHICH panels to show from the
 * words and the stored data (src/server/agent/show.ts, never the model), the client draws them
 * (src/components/show/*). Every number in a panel comes from the check-in's own values, the confirmed 14-day history
 * and its baseline; synthetic visuals (the ECG trace) are labelled as simulated.
 */
import { KPI_KEYS, type Bilingual, type KpiKey, type KpiStat, type MeasurementValue, type Status } from "./types";
import { KPI_DEFS } from "./kpi/registry";

export type ShowPanelKind = "vital" | "ecg" | "ring" | "trend" | "body" | "signature" | "labs";

/** one indicator as a panel shows it: today's value, its status, the past days and the personal baseline */
export interface ShowVital {
  key: KpiKey;
  /** today's value; null when it is not recorded (yet) */
  value: MeasurementValue | null;
  unit: string | null;
  status: Status;
  /** confirmed past days, oldest first (numeric keys only, today excluded, at most 14) */
  history: number[];
  /** personal baseline (mean of the past days) and the spread used for the band (never below the key's sdFloor) */
  mean: number | null;
  sd: number | null;
  /**
   * the reference band printed under the value: the general normal range when the data has one, otherwise the demo
   * parameter range the dashboard cards show (always labelled as such); null for keys without one
   */
  rangeText: Bilingual | null;
}

/** a dashboard KpiStat as a panel shows it (the band's spread never below the key's sdFloor, like the status model) */
export function showVitalFromStat(stat: KpiStat): ShowVital {
  const floor = KPI_DEFS[stat.key].sdFloor ?? 0;
  return {
    key: stat.key,
    value: stat.value,
    unit: stat.unit,
    status: stat.status,
    history: stat.history.map((h) => h.value),
    mean: stat.baselineMean,
    sd: stat.baselineSd === null ? null : Math.max(stat.baselineSd, floor),
    rangeText: stat.rangeText,
  };
}

/** the ring gauges: today's water against its demo target, the day's readiness score, blood oxygen */
export type RingMetric = "water" | "readiness" | "spo2";

export type ShowPanel =
  | {
      kind: "vital";
      id: string;
      /** one indicator, or the two halves of blood pressure, or the three yes/no symptoms */
      vitals: ShowVital[];
      /** true when the value was recorded in this very turn ("just recorded" tag) */
      recorded: boolean;
    }
  | { kind: "ecg"; id: string; vital: ShowVital; recorded: boolean }
  | {
      kind: "ring";
      id: string;
      metric: RingMetric;
      /** null: not measured (SpO2 is not part of this prototype's check-in) */
      value: number | null;
      /** the full ring: the water target (a demo parameter), 100 for readiness and SpO2 */
      max: number;
      unit: string | null;
      status: Status;
      recorded: boolean;
    }
  | {
      kind: "trend";
      id: string;
      vital: ShowVital;
      /** blood pressure: the diastolic series under the systolic one, in the same card */
      second?: ShowVital;
    }
  | { kind: "body"; id: string; vitals: ShowVital[] }
  | { kind: "signature"; id: string }
  | { kind: "labs"; id: string };

/** at most this many panels at once: small and readable, never a second dashboard */
export const MAX_SHOW_PANELS = 3;

/* ───────────── reading a `show` event on the client ───────────── */

const KINDS: readonly ShowPanelKind[] = ["vital", "ecg", "ring", "trend", "body", "signature", "labs"];
const STATUSES: readonly Status[] = ["green", "yellow", "red", "no_data"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readVital(raw: unknown): ShowVital | null {
  if (!isRecord(raw) || !(KPI_KEYS as readonly unknown[]).includes(raw.key)) return null;
  const value = typeof raw.value === "number" || typeof raw.value === "string" ? raw.value : null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const range = isRecord(raw.rangeText) && typeof raw.rangeText.en === "string" && typeof raw.rangeText.mn === "string"
    ? { en: raw.rangeText.en, mn: raw.rangeText.mn }
    : null;
  return {
    key: raw.key as KpiKey,
    value,
    unit: typeof raw.unit === "string" ? raw.unit : null,
    status: STATUSES.includes(raw.status as Status) ? (raw.status as Status) : "no_data",
    history: Array.isArray(raw.history) ? raw.history.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [],
    mean: num(raw.mean),
    sd: num(raw.sd),
    rangeText: range,
  };
}

/**
 * The panels of a `show` event as sent by the server (src/server/agent/show.ts). The server builds them from typed
 * code; this only drops what the screen could not draw (an unknown kind, a vital without a key), at most
 * MAX_SHOW_PANELS.
 */
export function parseShowPanels(raw: unknown): ShowPanel[] {
  if (!Array.isArray(raw)) return [];
  const out: ShowPanel[] = [];
  for (const p of raw) {
    if (!isRecord(p) || typeof p.id !== "string" || !KINDS.includes(p.kind as ShowPanelKind)) continue;
    const id = p.id;
    const recorded = p.recorded === true;
    switch (p.kind as ShowPanelKind) {
      case "vital":
      case "body": {
        const vitals = Array.isArray(p.vitals) ? p.vitals.map(readVital).filter((v): v is ShowVital => v !== null) : [];
        if (vitals.length === 0) continue;
        out.push(p.kind === "vital" ? { kind: "vital", id, vitals, recorded } : { kind: "body", id, vitals });
        break;
      }
      case "ecg":
      case "trend": {
        const vital = readVital(p.vital);
        if (!vital) continue;
        const second = p.kind === "trend" && p.second !== undefined ? readVital(p.second) : null;
        out.push(
          p.kind === "ecg"
            ? { kind: "ecg", id, vital, recorded }
            : { kind: "trend", id, vital, ...(second ? { second } : {}) },
        );
        break;
      }
      case "ring": {
        const metric = p.metric === "water" || p.metric === "readiness" || p.metric === "spo2" ? p.metric : null;
        const max = typeof p.max === "number" && p.max > 0 ? p.max : null;
        if (!metric || max === null) continue;
        out.push({
          kind: "ring",
          id,
          metric,
          value: typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null,
          max,
          unit: typeof p.unit === "string" ? p.unit : null,
          status: STATUSES.includes(p.status as Status) ? (p.status as Status) : "no_data",
          recorded,
        });
        break;
      }
      case "signature":
      case "labs":
        out.push({ kind: p.kind as "signature" | "labs", id });
        break;
    }
  }
  return out.slice(0, MAX_SHOW_PANELS);
}

/* ───────────── body map: which value sits where on the figure ───────────── */

export type BodySite = "head" | "forehead" | "eyes" | "lungs" | "heart" | "abdomen" | "legs";

export interface BodyCallout {
  site: BodySite;
  /** anchor on the figure, as a fraction of the figure box (the body-figure.png render, 1020 x 1536) */
  x: number;
  y: number;
  side: "left" | "right";
  /** where the label sits vertically, as a fraction of the figure height */
  labelY: number;
  /** the values shown at this site; empty = shown as "not measured" (lungs: SpO2 is not in this prototype) */
  keys: KpiKey[];
}

/** head -> sleep and mood, forehead -> temperature, eyes -> vision, heart -> pulse and blood pressure, ... */
export const BODY_CALLOUTS: readonly BodyCallout[] = [
  { site: "head", x: 0.47, y: 0.03, side: "left", labelY: 0.07, keys: ["sleep_hours", "mood"] },
  { site: "forehead", x: 0.53, y: 0.055, side: "right", labelY: 0.08, keys: ["temperature_c"] },
  { site: "eyes", x: 0.47, y: 0.088, side: "left", labelY: 0.25, keys: ["vision_check"] },
  { site: "heart", x: 0.51, y: 0.24, side: "right", labelY: 0.28, keys: ["heart_rate", "bp_systolic", "bp_diastolic"] },
  { site: "lungs", x: 0.42, y: 0.215, side: "left", labelY: 0.42, keys: [] },
  { site: "abdomen", x: 0.52, y: 0.37, side: "right", labelY: 0.5, keys: ["glucose_mgdl", "water_ml"] },
  { site: "legs", x: 0.43, y: 0.6, side: "left", labelY: 0.62, keys: ["exercise_min"] },
];

/** every key the body map shows */
export const BODY_KEYS: readonly KpiKey[] = BODY_CALLOUTS.flatMap((c) => c.keys);

/** the worst status among the given ones (no_data only when nothing is recorded) */
export function worstShowStatus(statuses: readonly Status[]): Status {
  const rank: Record<Status, number> = { no_data: 0, green: 1, yellow: 2, red: 3 };
  let worst: Status = "no_data";
  for (const s of statuses) if (rank[s] > rank[worst]) worst = s;
  return worst;
}

/* ───────────── ECG: a synthetic trace (labelled "simulated" wherever it is drawn) ───────────── */

/**
 * One period of a schematic PQRST complex as an SVG path, `beats` periods side by side in a `width` x `height` box.
 * Pure geometry, no data: the beat count only follows the heart-rate value so a faster pulse looks faster.
 */
export function ecgPath(width: number, height: number, beats: number): string {
  const n = Math.max(1, Math.round(beats));
  const w = width / n;
  const base = height * 0.62;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const x0 = i * w;
    const at = (fx: number, fy: number): [number, number] => [x0 + fx * w, base - fy * height];
    pts.push(
      at(0, 0),
      at(0.18, 0),
      at(0.24, 0.08), // P
      at(0.3, 0),
      at(0.38, 0),
      at(0.41, -0.1), // Q
      at(0.45, 0.55), // R
      at(0.49, -0.22), // S
      at(0.53, 0),
      at(0.64, 0),
      at(0.72, 0.14), // T
      at(0.8, 0),
      at(1, 0),
    );
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${r(x)} ${r(y)}`).join(" ");
}

/** seconds per beat for the trace animation: from the heart rate, kept between 0.4 s and 1.5 s (60 bpm when unknown) */
export function beatSeconds(bpm: number | null): number {
  if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) return 1;
  return Math.min(1.5, Math.max(0.4, 60 / bpm));
}
