import "server-only";
import { z } from "zod";
import { KPI_KEYS } from "@/lib/types";
import type {
  AlertRow,
  CrewPublic,
  DashboardPayload,
  KpiKey,
  Lang,
  MeasurementRow,
  MeasurementSource,
  MeasurementValue,
  Status,
  SummaryPayload,
} from "@/lib/types";
import { buildKpiStats, evaluateDay, STATUS_RANK, type HistoryDay } from "@/lib/health";
import { isTextKey } from "@/lib/kpi/registry";
import { now } from "@/server/clock";
import { getEnv } from "@/server/env";
import { listAlerts } from "@/server/db/repos/alert";
import { getCheckIn, latestConfirmedCheckIn, listHistoryDays } from "@/server/db/repos/checkin";
import { getCrewPublic } from "@/server/db/repos/crew";
import {
  groundGetCrew,
  groundLatestConfirmedCheckIn,
  groundListAlerts,
  groundListHistoryDays,
  groundListMeasurements,
} from "@/server/db/repos/ground";
import { listMeasurements } from "@/server/db/repos/measurement";
import { assertDateISO, localDateISO, toIso } from "@/server/db/shared";
import { historyHasSimulated } from "./sources";
import { composeTemplateSummary, templateSpokenText } from "./template";

/** days of confirmed history behind baselines, sparklines and the radar "usual" polygon */
export const HISTORY_DAYS = 14;

export interface BuildDashboardOptions {
  /** crew viewer: whose dashboard (from the signed session). Ground viewer: the crew member shown. */
  crewId: string;
  /** crew viewer only: a specific check-in; default is the latest confirmed one. Ignored for ground. */
  checkInId?: string;
  viewer: "crew" | "ground";
  /**
   * Ground viewer only: ISO instant; only check-ins confirmed at or before it are visible
   * (clock.now() minus the simulated link delay). Defaults to clock.now(). Ignored for crew.
   */
  asOf?: string;
  /** Ground viewer only: simulated link delay shown in `link`; default is clock.now() - asOf. */
  delayMs?: number;
}

/* ───────────── stored summary ───────────── */

const bilingual = z.object({ mn: z.string(), en: z.string() });
const kpiKey = z.enum(KPI_KEYS);
const hazardKey = z.enum([
  "radiation",
  "isolation_confinement",
  "distance_from_earth",
  "gravity",
  "hostile_closed_environment",
]);

const storedSummarySchema = z.object({
  overall: z.enum(["green", "yellow", "red", "no_data"]),
  readiness: z.number(),
  headline: bilingual,
  findings: z.array(
    z.object({
      key: kpiKey,
      status: z.enum(["yellow", "red"]),
      reason: z.enum(["fixed_range", "baseline", "combo_rule", "keyword_rule", "missing"]),
      value: z.union([z.number(), z.string()]),
      unit: z.string().nullable(),
      baselineMean: z.number().nullable(),
      z: z.number().nullable(),
      direction: z.enum(["high", "low"]).nullable(),
      text: bilingual,
    }),
  ),
  recommendations: z.array(
    z.object({
      id: z.string(),
      hazard: hazardKey.nullable(),
      relatedKeys: z.array(kpiKey),
      title: bilingual,
      why: bilingual,
    }),
  ),
  redFlags: z.array(
    z.object({
      rule: z.enum(["VITAL_RED", "HEADACHE_PLUS_VISION", "SERIOUS_SYMPTOM_WORD"]),
      keys: z.array(kpiKey),
      text: bilingual,
    }),
  ),
  disclaimer: bilingual,
  spoken: z.object({ language: z.enum(["mn", "en"]), text: z.string() }),
  audioTurnId: z.string().nullable(),
});

/** The stored SummaryPayload, or null when absent, not JSON or not shaped like one. */
function parseStoredSummary(summaryJson: string | null): SummaryPayload | null {
  if (summaryJson === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(summaryJson);
  } catch {
    return null;
  }
  const parsed = storedSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* ───────────── helpers ───────────── */

const DAY_MS = 86_400_000;

/**
 * Mission day: whole local calendar days between MISSION_START_DATE and the injected clock's local
 * date, plus one (launch day is day 1). Never below 1.
 */
export function missionDayAt(at: Date, missionStartDate: string = getEnv().missionStartDate): number {
  const start = assertDateISO(missionStartDate, "MISSION_START_DATE");
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ty, tm, td] = localDateISO(at).split("-").map(Number);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(sy, sm - 1, sd)) / DAY_MS);
  return Math.max(1, days + 1);
}

function valuesOf(
  rows: MeasurementRow[],
  omitText: boolean,
): { values: Partial<Record<KpiKey, MeasurementValue>>; sources: Partial<Record<KpiKey, MeasurementSource>> } {
  const values: Partial<Record<KpiKey, MeasurementValue>> = {};
  const sources: Partial<Record<KpiKey, MeasurementSource>> = {};
  for (const row of rows) {
    if (omitText && isTextKey(row.key)) continue;
    values[row.key] = row.value;
    sources[row.key] = row.source;
  }
  return { values, sources };
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

interface Loaded {
  crew: CrewPublic;
  checkIn: { id: string; confirmedAt: string; language: Lang; localDate: string; summaryJson: string | null };
  measurements: MeasurementRow[];
  history: HistoryDay[];
  alerts: AlertRow[];
  asOf: string | undefined;
}

/** Crew viewer: everything through the crewId-scoped repos. */
function loadForCrew(opts: BuildDashboardOptions): Loaded | null {
  const { crewId } = opts;
  const crew = getCrewPublic(crewId);
  const rec = opts.checkInId !== undefined ? getCheckIn(crewId, opts.checkInId) : latestConfirmedCheckIn(crewId);
  if (!rec || rec.confirmedAt === null) return null;
  return {
    crew,
    checkIn: {
      id: rec.id,
      confirmedAt: rec.confirmedAt,
      language: rec.language,
      localDate: rec.localDate,
      summaryJson: rec.summaryJson,
    },
    measurements: listMeasurements(crewId, rec.id),
    history: listHistoryDays(crewId, { before: rec.localDate, days: HISTORY_DAYS }),
    alerts: listAlerts(crewId).filter((a) => a.checkInId === rec.id),
    asOf: undefined,
  };
}

/** Ground viewer: ground* repos only (confirmed and visible at asOf, free text already removed). */
function loadForGround(opts: BuildDashboardOptions, asOf: string): Loaded | null {
  const { crewId } = opts;
  const crew = groundGetCrew(crewId);
  if (!crew) return null;
  const rec = groundLatestConfirmedCheckIn(crewId, asOf);
  if (!rec || rec.confirmedAt === null) return null;
  return {
    crew,
    checkIn: {
      id: rec.id,
      confirmedAt: rec.confirmedAt,
      language: rec.language,
      localDate: rec.localDate,
      // already redacted by the ground repo (spoken text and free-text findings blanked)
      summaryJson: rec.summaryJson,
    },
    measurements: groundListMeasurements(crewId, rec.id, asOf),
    history: groundListHistoryDays(crewId, { before: rec.localDate, days: HISTORY_DAYS, asOf }),
    alerts: groundListAlerts(asOf).filter((a) => a.crewId === crewId && a.checkInId === rec.id),
    asOf,
  };
}

/* ───────────── the payload ───────────── */

/**
 * Builds the dashboard for one crew member's confirmed check-in, or null when there is none to show
 * (no confirmed check-in, an unconfirmed one was asked for, unknown crew for the ground viewer, or
 * nothing has "arrived" at ground yet). A crew-viewer request for another member's check-in id
 * throws NotFoundError (the repos refuse it). All numbers and statuses come from src/lib/health.
 *
 * Ground viewer: text-key values are null, `summary.spoken.text` is a template text built from the
 * code-made findings (never Claude's phrasing, which may echo notes), and no sourceText exists
 * anywhere in the payload.
 */
export function buildDashboardPayload(opts: BuildDashboardOptions): DashboardPayload | null {
  const ground = opts.viewer === "ground";
  const clockNow = now();
  const asOf = ground ? toIso(opts.asOf ?? clockNow, "asOf") : undefined;

  const loaded = ground ? loadForGround(opts, asOf as string) : loadForCrew(opts);
  if (!loaded) return null;
  const { crew, checkIn, measurements, history, alerts } = loaded;

  const { values: today, sources } = valuesOf(measurements, ground);
  const evaluation = evaluateDay(today, history);
  const kpis = buildKpiStats(today, history, sources);

  // summary: the stored one (written by the turn pipeline or the seed), else a template one
  const stored = parseStoredSummary(checkIn.summaryJson);
  let summary: SummaryPayload;
  if (ground) {
    // never Claude's phrasing: template text from the code-made findings, in the check-in language
    const base = stored ?? { ...evaluation.summary, spoken: { language: checkIn.language, text: "" }, audioTurnId: null };
    summary = {
      ...base,
      spoken: { language: checkIn.language, text: templateSpokenText(base, checkIn.language) },
      audioTurnId: null,
    };
  } else {
    summary = stored ?? composeTemplateSummary(evaluation.summary, checkIn.language);
  }

  // Ground cannot see notes, so a keyword red flag raised from them exists only in the stored
  // summary: take the worse of both so ground never shows less than the crew member's own screen.
  let overall: Status = evaluation.overall;
  let readiness = evaluation.readiness;
  if (ground && stored) {
    overall = STATUS_RANK[stored.overall] > STATUS_RANK[overall] ? stored.overall : overall;
    if (stored.redFlags.length > 0) readiness = Math.min(readiness, stored.readiness);
  }

  const readinessBaselineRaw = mean(evaluation.axes.map((a) => a.baseline).filter((b): b is number => b !== null));

  const oldestHistory = history.length > 0 ? history[0].date : null;
  const simulatedHistory =
    oldestHistory !== null &&
    historyHasSimulated(crew.id, { fromDate: oldestHistory, beforeDate: checkIn.localDate, asOf: loaded.asOf });

  const delayMs = ground ? Math.max(0, opts.delayMs ?? clockNow.getTime() - new Date(asOf as string).getTime()) : 0;

  return {
    crew,
    missionDay: missionDayAt(clockNow),
    checkIn: { id: checkIn.id, confirmedAt: checkIn.confirmedAt, language: checkIn.language },
    overall,
    readiness,
    readinessBaseline: readinessBaselineRaw === null ? null : Math.round(readinessBaselineRaw),
    kpis,
    axes: evaluation.axes,
    hazards: evaluation.hazards,
    dayArc: evaluation.dayArc,
    tasks: evaluation.tasks,
    alerts,
    summary,
    link: {
      state: delayMs > 0 ? "delayed" : "online",
      delayMs,
      lastSentAt: checkIn.confirmedAt,
      simulated: true,
    },
    simulatedHistory,
  };
}
