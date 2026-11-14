import "server-only";
import type { AlertRow, CrewPublic, MeasurementRow } from "@/lib/types";
import { getDb } from "../client";
import {
  ALERT_COLUMNS,
  CHECK_IN_COLUMNS,
  CREW_COLUMNS,
  MEASUREMENT_COLUMNS,
  mapAlert,
  mapCheckIn,
  mapCrew,
  mapMeasurement,
  type AlertDbRow,
  type CheckInDbRow,
  type CheckInRecord,
  type CrewDbRow,
  type MeasurementDbRow,
} from "../rows";
import { isTextKey, queryHistoryDays, toIso, type HistoryDayRow } from "../shared";

/**
 * Read-only reads for the Earth console (ground role). This file is the ONLY place that reads
 * across crew members; every function is named ground*, takes `asOf` (an ISO instant: a check-in is
 * visible only when confirmed_at <= asOf, which is how the simulated link delay is applied) and
 * NEVER returns turns, free text, state_json or anything that was not confirmed.
 */

/** A confirmed check-in as ground may see it: no state_json, summary free text redacted. */
export type GroundCheckIn = Omit<CheckInRecord, "stateJson">;

/**
 * Removes free text from a serialised SummaryPayload: `spoken.text` (Claude may quote the crew
 * member's notes) and any finding whose key is a text key. Unparseable input yields null.
 */
export function redactSummaryJson(summaryJson: string | null): string | null {
  if (summaryJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(summaryJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const summary = parsed as Record<string, unknown>;
  if (typeof summary.spoken === "object" && summary.spoken !== null) {
    summary.spoken = { ...(summary.spoken as Record<string, unknown>), text: "" };
  }
  if (Array.isArray(summary.findings)) {
    summary.findings = summary.findings.map((f: unknown) => {
      if (typeof f === "object" && f !== null && isTextKey(String((f as { key?: unknown }).key))) {
        return { ...(f as Record<string, unknown>), value: "" };
      }
      return f;
    });
  }
  return JSON.stringify(summary);
}

function toGround(rec: CheckInRecord): GroundCheckIn {
  const { stateJson: _stateJson, ...rest } = rec;
  void _stateJson;
  return { ...rest, summaryJson: redactSummaryJson(rec.summaryJson) };
}

/** Roster only. Not time dependent, hence no asOf. */
export function groundListCrew(): CrewPublic[] {
  const rows = getDb()
    .prepare(`SELECT ${CREW_COLUMNS} FROM crew_member ORDER BY rowid ASC`)
    .all() as CrewDbRow[];
  return rows.map(mapCrew);
}

export function groundGetCrew(crewId: string): CrewPublic | null {
  const row = getDb()
    .prepare(`SELECT ${CREW_COLUMNS} FROM crew_member WHERE id = ?`)
    .get(crewId) as CrewDbRow | undefined;
  return row ? mapCrew(row) : null;
}

export function groundLatestConfirmedCheckIn(crewId: string, asOf: string): GroundCheckIn | null {
  const row = getDb()
    .prepare(
      `SELECT ${CHECK_IN_COLUMNS} FROM check_in
        WHERE crew_id = ? AND confirmed_at IS NOT NULL AND confirmed_at <= ?
        ORDER BY confirmed_at DESC, rowid DESC LIMIT 1`,
    )
    .get(crewId, toIso(asOf, "asOf")) as CheckInDbRow | undefined;
  return row ? toGround(mapCheckIn(row)) : null;
}

/**
 * Measurements of a visible check-in; free-text keys come back with value ''. sourceText (the verbatim
 * transcript snippet) is ALWAYS null here, for every key: ground never sees conversation content.
 * An invisible, unknown or foreign check-in yields [] (it simply has not "arrived").
 */
export function groundListMeasurements(
  crewId: string,
  checkInId: string,
  asOf: string,
): MeasurementRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ${MEASUREMENT_COLUMNS.split(", ")
        .map((c) => `m.${c}`)
        .join(", ")}
         FROM measurement m
         JOIN check_in c ON c.id = m.check_in_id AND c.crew_id = m.crew_id
        WHERE m.crew_id = ? AND m.check_in_id = ?
          AND c.confirmed_at IS NOT NULL AND c.confirmed_at <= ?
        ORDER BY m.created_at ASC, m.rowid ASC`,
    )
    .all(crewId, checkInId, toIso(asOf, "asOf")) as MeasurementDbRow[];
  return rows.map((r) => mapMeasurement(r, { redactText: true }));
}

/** As listHistoryDays, restricted to visible check-ins; free-text keys are omitted entirely. */
export function groundListHistoryDays(
  crewId: string,
  opts: { before: string; days: number; asOf: string },
): HistoryDayRow[] {
  return queryHistoryDays(getDb(), crewId, {
    before: opts.before,
    days: opts.days,
    asOf: opts.asOf,
    omitText: true,
  });
}

/** All crew members' alerts whose check-in is visible at asOf, newest first. */
export function groundListAlerts(asOf: string): AlertRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ${ALERT_COLUMNS.split(", ")
        .map((c) => `a.${c}`)
        .join(", ")}
         FROM alert a
         JOIN check_in c ON c.id = a.check_in_id AND c.crew_id = a.crew_id
        WHERE c.confirmed_at IS NOT NULL AND c.confirmed_at <= ?
        ORDER BY a.created_at DESC, a.rowid DESC`,
    )
    .all(toIso(asOf, "asOf")) as AlertDbRow[];
  return rows.map(mapAlert);
}
