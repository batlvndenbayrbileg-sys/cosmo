import "server-only";
import type { KpiKey } from "@/lib/types";
import { KPI_DEFS } from "@/lib/kpi/registry";
import { DEMO_SENSOR_DAY, DEVICE_LABELS, FOLLOW_UP_KEYS, simulateSensorDay, unusualReadings } from "@/lib/sensors/feed";
import { getEnv } from "@/server/env";
import type { CheckInRecord } from "@/server/db/repos/checkin";
import { upsertMeasurement } from "@/server/db/repos/measurement";
import { getDb } from "@/server/db/client";
import type { MachineCtx } from "@/server/agent/machine";
import { loadHistory, saveMachineCtx } from "./service";

/** at most this many unusual readings are said before the first question (the rest are on the dashboard) */
const MAX_TOLD = 2;

let feedOverride: boolean | null = null;

/**
 * Tests: switch the sensor feed off (true = on, null = back to the environment). With the feed off, every value is
 * asked the old way, after the spoken questions: the path a crew member without a wearable would take.
 */
export function setSensorFeedForTests(on: boolean | null): void {
  feedOverride = on;
}

/** SENSOR_FEED=off: no wearable feed (every sensor value is asked). Default: the simulated feed is on. */
function feedEnabled(): boolean {
  if (feedOverride !== null) return feedOverride;
  return (process.env.SENSOR_FEED ?? "").trim().toLowerCase() !== "off";
}

/**
 * Reads the day's (simulated) sensor feed into the check-in, once: every sensor key that holds no value yet gets the
 * feed's reading (source "sensor"), the unusual readings are kept in the context for Cosmo to mention, and the
 * follow-up question (sensor_check) is skipped when no body reading looks unusual. A value the astronaut already said
 * is never replaced. A confirmed check-in, or one that has read the feed before, is returned unchanged.
 *
 * The readings, the context and the skip are written in one transaction.
 */
export async function syncSensorFeed(checkIn: CheckInRecord, ctx: MachineCtx): Promise<MachineCtx> {
  if (checkIn.confirmedAt !== null || ctx.sensor !== null || ctx.state === "DONE" || ctx.state === "SUMMARY") return ctx;
  // assistant mode records nothing on its own: the feed is read once the daily check-up itself is under way
  if (ctx.assistant) return ctx;
  const { crewId, id: checkInId } = checkIn;
  if (!feedEnabled()) {
    // no feed: nothing is filled, there is nothing to follow up, every value is asked
    const next: MachineCtx = {
      ...ctx,
      sensor: { keys: [], flagged: [], ask: false },
      skipped: ctx.skipped.includes("sensor_check") ? ctx.skipped : [...ctx.skipped, "sensor_check"],
    };
    await saveMachineCtx(crewId, checkInId, next);
    return next;
  }
  const history = await loadHistory(crewId, checkIn.localDate);
  // the scripted demo replays fixed lines, so its feed must not change with the date
  const seedKey = getEnv().demoMode === "scripted" ? DEMO_SENSOR_DAY : checkIn.localDate;
  const readings = simulateSensorDay(crewId, seedKey, history);
  const filled = new Set<KpiKey>(ctx.filled);
  const stored = readings.filter((r) => !filled.has(r.key));
  const flagged = unusualReadings(stored, history).slice(0, MAX_TOLD);
  const ask = flagged.some((f) => FOLLOW_UP_KEYS.has(f.key));
  const next: MachineCtx = {
    ...ctx,
    filled: [...ctx.filled, ...stored.map((r) => r.key)],
    sensorFilled: [...new Set([...ctx.sensorFilled, ...stored.map((r) => r.key)])],
    sensor: { keys: stored.map((r) => r.key), flagged, ask },
    skipped: ask || ctx.skipped.includes("sensor_check") ? ctx.skipped : [...ctx.skipped, "sensor_check"],
  };
  const db = await getDb();
  await db.transaction(async () => {
    for (const r of stored) {
      await upsertMeasurement(crewId, checkInId, {
        key: r.key,
        value: r.value,
        unit: KPI_DEFS[r.key].unit,
        sourceText: DEVICE_LABELS[r.device].en,
        confidence: 1,
        source: "sensor",
      });
    }
    await saveMachineCtx(crewId, checkInId, next);
  });
  return next;
}
