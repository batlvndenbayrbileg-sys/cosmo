/**
 * AEGIS shared contract — types only, no logic.
 * Imported by server code, client code and tests. Do NOT import server-only modules here.
 * Source of truth for the question set and the dashboard: docs/DASHBOARD_PLAN.md
 */
import type { ShowPanel } from "./show";

export type Lang = "mn" | "en";
export type Bilingual = Record<Lang, string>;

/* ───────────── question set / indicators (workbook "Data model", docs/DASHBOARD_PLAN.md §1) ───────────── */

export const KPI_KEYS = [
  "sleep_hours",
  "mood",
  "symptom_headache",
  "symptom_dizziness",
  "symptom_nausea",
  "symptom_note",
  "bp_systolic",
  "bp_diastolic",
  "heart_rate",
  "temperature_c",
  "glucose_mgdl",
  "water_ml",
  "exercise_min",
  "vision_check",
  "workload",
  "day_note",
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const QUESTION_IDS = [
  "sleep",
  "mood",
  "symptoms",
  "blood_pressure",
  "heart_rate",
  "temperature",
  "glucose",
  "water",
  "exercise",
  "vision",
  "workload",
  "day_note",
] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

export type SlotKey = "morning" | "midday" | "afternoon" | "evening";

/** number = decimal; integer; boolean stored as 0/1; scale = integer within min..max; category = integer code; text = free text */
export type ValueType = "number" | "integer" | "boolean" | "scale" | "category" | "text";

/** value as stored/transported: booleans are 0 | 1, text keys are strings */
export type MeasurementValue = number | string;

export type MeasurementSource = "typed" | "voice" | "simulated";

/* ───────────── status model (docs/DASHBOARD_PLAN.md §2) ───────────── */

export type Status = "green" | "yellow" | "red" | "no_data";
export type StatusReason = "fixed_range" | "baseline" | "combo_rule" | "keyword_rule" | "missing";

export type HazardKey =
  | "radiation"
  | "isolation_confinement"
  | "distance_from_earth"
  | "gravity"
  | "hostile_closed_environment";

export type AxisKey =
  | "sleep"
  | "cardio"
  | "metabolic"
  | "neuro_ocular"
  | "behavioral"
  | "musculoskeletal";

/**
 * Demo-parameter thresholds. Semantics (all comparisons strict):
 *   v < low.red     → red       v < low.yellow  → yellow
 *   v > high.red    → red       v > high.yellow → yellow
 *   otherwise green (inclusive of the yellow bounds).
 * NOT clinical limits — every threshold is labelled "demo parameter" in the UI.
 */
export interface ThresholdSpec {
  low?: { yellow: number; red: number };
  high?: { yellow: number; red: number };
}

export interface KpiDef {
  key: KpiKey;
  question: QuestionId;
  slot: SlotKey;
  type: ValueType;
  unit: string | null;
  /** hard plausibility range: values outside are rejected and re-asked, never stored */
  min?: number;
  max?: number;
  labels: Bilingual;
  hazards: HazardKey[];
  axis: AxisKey | null;
  thresholds?: ThresholdSpec;
  /** lifestyle indicators never reach red on their own */
  maxLevel?: "yellow";
  /** minimum sd used for z-scores so near-constant history does not flag trivia */
  sdFloor?: number;
  /** category labels for display, e.g. vision_check */
  categories?: Record<number, Bilingual>;
}

export interface QuestionDef {
  id: QuestionId;
  order: number;
  slot: SlotKey;
  keys: KpiKey[];
  /** optional questions may be skipped without clarification loops */
  optional: boolean;
  prompts: Bilingual;
}

/* ───────────── crew / check-in ───────────── */

export type CrewId = string;

export interface CrewPublic {
  id: CrewId;
  name: string;
  role: string;
  preferredLanguage: Lang;
  mascotVariant: number;
  avatarSeed: string;
}

export type ConversationState =
  | "GREETING"
  | "SMALL_TALK"
  | "KPI_CAPTURE"
  | "CONFIRM"
  | "SUMMARY"
  | "DONE";

export interface MeasurementRow {
  key: KpiKey;
  value: MeasurementValue;
  unit: string | null;
  sourceText: string | null;
  confidence: number | null;
  source: MeasurementSource;
  createdAt: string;
}

export interface TurnRow {
  id: string;
  speaker: "crew" | "cosmo" | "system";
  text: string;
  language: Lang;
  createdAt: string;
}

/* ───────────── findings / summary / tasks / alerts (all computed by code) ───────────── */

export interface Finding {
  key: KpiKey;
  status: Exclude<Status, "green" | "no_data">;
  reason: StatusReason;
  value: MeasurementValue;
  unit: string | null;
  baselineMean: number | null;
  z: number | null;
  direction: "high" | "low" | null;
  text: Bilingual;
}

export type RedFlagRule = "VITAL_RED" | "HEADACHE_PLUS_VISION" | "SERIOUS_SYMPTOM_WORD";

export interface RedFlag {
  rule: RedFlagRule;
  keys: KpiKey[];
  text: Bilingual;
}

/** lifestyle suggestion only — never a diagnosis, drug or treatment (guardrail R-21) */
export interface Task {
  id: string;
  hazard: HazardKey | null;
  relatedKeys: KpiKey[];
  title: Bilingual;
  why: Bilingual;
}

export interface SummaryFindings {
  overall: Status;
  readiness: number; // 0-100
  headline: Bilingual;
  findings: Finding[]; // max 2, most severe first
  recommendations: Task[]; // max 2 (top of the task list)
  redFlags: RedFlag[];
  disclaimer: Bilingual; // "Decision support, not a diagnosis."
}

export interface SummaryPayload extends SummaryFindings {
  /** text as phrased by Claude (or by template fallback) in the language it is spoken */
  spoken: { language: Lang; text: string };
  /** turn whose audio is replayed by the replay button */
  audioTurnId: string | null;
}

export interface AlertRow {
  id: string;
  crewId: CrewId;
  checkInId: string;
  createdAt: string;
  level: "yellow" | "red";
  rule: RedFlagRule | "VITAL_RED" | "OVERALL";
  text: Bilingual; // "alert", never "diagnosis"
  acknowledgedAt: string | null;
}

/* ───────────── dashboard payload ───────────── */

export interface KpiStat {
  key: KpiKey;
  value: MeasurementValue | null;
  unit: string | null;
  status: Status;
  reason: StatusReason;
  z: number | null;
  baselineMean: number | null;
  baselineSd: number | null;
  delta: number | null; // value - baselineMean
  history: Array<{ date: string; value: number }>; // up to 14 days, numeric keys only
  source: MeasurementSource | null;
  /** human text, e.g. "Normal 50–90 bpm (demo parameter)" — null for text keys */
  rangeText: Bilingual | null;
}

export interface AxisScore {
  axis: AxisKey;
  score: number | null; // 0-100, null when no data
  baseline: number | null; // mean of the person's own daily axis scores
  status: Status;
}

export interface HazardStat {
  hazard: HazardKey;
  status: Status | "not_monitored";
  keys: KpiKey[];
}

export interface DayArcSlot {
  slot: SlotKey;
  state: "done" | "partial" | "pending";
  logged: KpiKey[];
  missing: KpiKey[];
}

export type LinkState = "online" | "delayed" | "offline";

/** the Earth link is SIMULATED in Phase 1 — always labelled as such */
export interface EarthLink {
  state: LinkState;
  lastSentAt: string | null;
  delayMs: number;
  simulated: true;
}

export interface DashboardPayload {
  crew: CrewPublic;
  missionDay: number;
  checkIn: { id: string; confirmedAt: string; language: Lang };
  overall: Status;
  readiness: number;
  readinessBaseline: number | null;
  kpis: KpiStat[];
  axes: AxisScore[]; // exactly 6
  hazards: HazardStat[]; // exactly 5
  dayArc: DayArcSlot[]; // exactly 4
  tasks: Task[]; // 3-4
  alerts: AlertRow[];
  summary: SummaryPayload;
  link: EarthLink;
  /** true when the 14-day history is seeded demo data */
  simulatedHistory: boolean;
}

/** Earth console (ground role) */
export interface CrewStatusCard {
  crew: CrewPublic;
  overall: Status;
  readiness: number | null;
  lastCheckInAt: string | null;
  stars: Array<{ key: KpiKey; status: Status }>;
  openAlerts: number;
}

/* ───────────── API ───────────── */

export type SessionRole = "crew" | "ground";

export type SessionPayload = { role: "crew"; crewId: CrewId } | { role: "ground" };

export type ApiErrorCode =
  | "INTERNAL"
  | "NO_SESSION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_INPUT"
  | "WRONG_STATE"
  | "STT_FAILED"
  | "LLM_FAILED"
  | "TTS_FAILED";

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

export interface HealthResponse {
  mode: "live" | "scripted";
  llm: { model: string | null; available: boolean };
  stt: { model: string | null; available: boolean };
  tts: {
    mn: { model: string | null; available: boolean };
    en: { model: string | null; available: boolean };
  };
  rive: boolean;
}

export interface CheckInCreated {
  checkInId: string;
  state: ConversationState;
  language: Lang;
  greeting: { turnId: string; text: string };
  resumed: boolean;
}

export interface CheckInSnapshot {
  checkIn: { id: string; state: ConversationState; language: Lang; confirmedAt: string | null };
  measurements: Array<MeasurementRow & { status: Status; reason: StatusReason }>;
  turns: TurnRow[];
}

/** Server-sent events returned by POST /api/checkins/:id/turn (see docs/PLAN.md §5.1) */
export type TurnEvent =
  | { type: "transcript"; turnId: string; text: string; language: Lang }
  | {
      type: "state";
      state: ConversationState;
      expectedQuestion: QuestionId | null;
      /** friend mode is on (a conversation on the side; the client offers a way back to the check-in) */
      companion?: boolean;
    }
  | {
      type: "measurement";
      key: KpiKey;
      value: MeasurementValue;
      unit: string | null;
      sourceText: string;
      confidence: number;
      status: Status;
      reason: StatusReason;
      change: "recorded" | "corrected";
    }
  | { type: "clarification"; key: KpiKey; reason: string }
  | {
      type: "assistant";
      turnId: string;
      text: string;
      language: Lang;
      emotion: "neutral" | "happy" | "concerned";
    }
  | { type: "summary"; summary: SummaryPayload }
  /** small panels Cosmo shows on screen beside her (decided by code from the words and the data; src/lib/show.ts) */
  | { type: "show"; panels: ShowPanel[] }
  | { type: "timing"; sttMs: number; llmMs: number; totalMs: number }
  | { type: "error"; code: ApiErrorCode; message: string; recoverable: boolean }
  /** the crew member asked Cosmo to alert Earth (src/lib/sos): ok = the urgent alert is stored (or already was) */
  | {
      type: "sos";
      ok: boolean;
      alertId: string | null;
      createdAt: string | null;
      duplicate: boolean;
      /** SosPhotoStatus (src/lib/sos) */
      photoStatus: "pending" | "attached" | "denied" | "unavailable" | null;
    }
  | { type: "done" };
