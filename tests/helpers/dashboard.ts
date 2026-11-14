import { evaluateDay, type HistoryDay } from "@/lib/health";
import type { KpiKey, Lang, MeasurementValue } from "@/lib/types";
import { composeTemplateSummary } from "@/server/dashboard/template";
import { insertAlert } from "@/server/db/repos/alert";
import { confirmCheckIn, createCheckIn, listHistoryDays } from "@/server/db/repos/checkin";
import { upsertMeasurement } from "@/server/db/repos/measurement";
import { localDateISO } from "@/server/db/shared";
import { KPI_DEFS } from "@/lib/kpi/registry";

export interface AddCheckInOptions {
  crewId: string;
  language: Lang;
  /** every key to store; text keys take strings */
  values: Partial<Record<KpiKey, MeasurementValue>>;
  /** confirmed_at (the check-in started 6 minutes earlier) */
  confirmedAt: Date;
  source?: "typed" | "voice" | "simulated";
  /** verbatim snippet stored as sourceText on every measurement (ground must never see it) */
  sourceText?: string;
  /** replaces the template spoken text of the stored summary (as Claude's phrasing would) */
  spokenText?: string;
  /** store NO summary_json at all */
  noSummary?: boolean;
  /** extra fields merged into the stored summary JSON (for example redFlags from a note keyword) */
  summaryExtras?: Record<string, unknown>;
  id?: string;
}

/**
 * Creates, fills and confirms a check-in through the repos, as the turn pipeline would, with a
 * stored SummaryPayload computed from the crew member's real history. Returns its id.
 */
export async function addConfirmedCheckIn(opts: AddCheckInOptions): Promise<string> {
  const startedAt = new Date(opts.confirmedAt.getTime() - 6 * 60_000);
  const ci = await createCheckIn(opts.crewId, { language: opts.language, startedAt, id: opts.id });
  for (const [key, value] of Object.entries(opts.values) as Array<[KpiKey, MeasurementValue]>) {
    await upsertMeasurement(opts.crewId, ci.id, {
      key,
      value,
      unit: KPI_DEFS[key].unit,
      sourceText: opts.sourceText ?? null,
      confidence: opts.sourceText ? 0.9 : null,
      source: opts.source ?? "typed",
      createdAt: startedAt,
    });
  }
  let summaryJson: string | null = null;
  if (!opts.noSummary) {
    const history: HistoryDay[] = await listHistoryDays(opts.crewId, { before: localDateISO(startedAt), days: 14 });
    const evaluation = evaluateDay(opts.values, history);
    const summary = composeTemplateSummary(evaluation.summary, opts.language);
    if (opts.spokenText !== undefined) summary.spoken.text = opts.spokenText;
    summaryJson = JSON.stringify({ ...summary, ...opts.summaryExtras });
  }
  await confirmCheckIn(opts.crewId, ci.id, { confirmedAt: opts.confirmedAt, summaryJson });
  return ci.id;
}

/** Adds a red alert row (as the turn pipeline does on SUMMARY) for a check-in. */
export async function addAlert(
  crewId: string,
  checkInId: string,
  createdAt: Date,
  text = { en: "Alert: test alert, not a diagnosis.", mn: "Анхааруулга: туршилтын анхааруулга." },
) {
  return insertAlert(crewId, { checkInId, level: "red", rule: "VITAL_RED", text, createdAt });
}
