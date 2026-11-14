import "server-only";
import type {
  AlertRow,
  Bilingual,
  ConversationState,
  CrewPublic,
  KpiKey,
  Lang,
  MeasurementRow,
  MeasurementSource,
  RedFlagRule,
} from "@/lib/types";
import { isKpiKey } from "./shared";

/** Row types and mappers shared by the repos and ground reads (not itself a repo). */

export interface CheckInRecord {
  id: string;
  crewId: string;
  startedAt: string;
  confirmedAt: string | null;
  /** server-local calendar date (YYYY-MM-DD) of startedAt */
  localDate: string;
  language: Lang;
  state: ConversationState;
  /** serialised conversation context, see docs/PLAN.md section 3 */
  stateJson: string;
  /** serialised SummaryPayload; null for seeded history and for unconfirmed check-ins */
  summaryJson: string | null;
}

export interface CheckInDbRow {
  id: string;
  crew_id: string;
  started_at: string;
  confirmed_at: string | null;
  local_date: string;
  language: string;
  state: string;
  state_json: string;
  summary_json: string | null;
}

export const CHECK_IN_COLUMNS =
  "id, crew_id, started_at, confirmed_at, local_date, language, state, state_json, summary_json";

export function mapCheckIn(r: CheckInDbRow): CheckInRecord {
  return {
    id: r.id,
    crewId: r.crew_id,
    startedAt: r.started_at,
    confirmedAt: r.confirmed_at,
    localDate: r.local_date,
    language: r.language as Lang,
    state: r.state as ConversationState,
    stateJson: r.state_json,
    summaryJson: r.summary_json,
  };
}

export interface CrewDbRow {
  id: string;
  name: string;
  role: string;
  preferred_language: string;
  mascot_variant: number;
  avatar_seed: string;
}

export const CREW_COLUMNS = "id, name, role, preferred_language, mascot_variant, avatar_seed";

export function mapCrew(r: CrewDbRow): CrewPublic {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    preferredLanguage: r.preferred_language as Lang,
    mascotVariant: r.mascot_variant,
    avatarSeed: r.avatar_seed,
  };
}

export interface MeasurementDbRow {
  key: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  source_text: string | null;
  confidence: number | null;
  source: string;
  created_at: string;
}

export const MEASUREMENT_COLUMNS =
  "key, value, value_text, unit, source_text, confidence, source, created_at";

/** Text keys use value_text; everything else (booleans as 0/1) uses value. */
export function mapMeasurement(r: MeasurementDbRow, opts?: { redactText?: boolean }): MeasurementRow {
  if (!isKpiKey(r.key)) throw new Error(`Unknown measurement key in database: ${r.key}`);
  const isText = r.value_text !== null;
  const value = isText ? (opts?.redactText ? "" : (r.value_text as string)) : (r.value as number);
  return {
    key: r.key as KpiKey,
    value,
    unit: r.unit,
    // ground reads never carry the verbatim transcript snippet, for any key
    sourceText: opts?.redactText ? null : r.source_text,
    confidence: r.confidence,
    source: r.source as MeasurementSource,
    createdAt: r.created_at,
  };
}

export interface AlertDbRow {
  id: string;
  crew_id: string;
  check_in_id: string;
  created_at: string;
  level: string;
  rule: string;
  text_json: string;
  acknowledged_at: string | null;
}

export const ALERT_COLUMNS =
  "id, crew_id, check_in_id, created_at, level, rule, text_json, acknowledged_at";

export function mapAlert(r: AlertDbRow): AlertRow {
  return {
    id: r.id,
    crewId: r.crew_id,
    checkInId: r.check_in_id,
    createdAt: r.created_at,
    level: r.level as AlertRow["level"],
    rule: r.rule as RedFlagRule | "VITAL_RED" | "OVERALL",
    text: JSON.parse(r.text_json) as Bilingual,
    acknowledgedAt: r.acknowledged_at,
  };
}
