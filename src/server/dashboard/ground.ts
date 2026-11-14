import "server-only";
import { KPI_KEYS } from "@/lib/types";
import type { AlertRow, CrewStatusCard } from "@/lib/types";
import { now } from "@/server/clock";
import { groundListAlerts, groundListCrew } from "@/server/db/repos/ground";
import { HttpError } from "@/server/http";
import { buildDashboardPayload } from "./build";

/** The simulated link delays the Earth console offers: Live, 3 minutes, 20 minutes. */
export const GROUND_DELAYS_MS = [0, 180_000, 1_200_000] as const;
export type GroundDelayMs = (typeof GROUND_DELAYS_MS)[number];

export function isGroundDelay(n: number): n is GroundDelayMs {
  return (GROUND_DELAYS_MS as readonly number[]).includes(n);
}

/**
 * Reads `delayMs` from a query string: absent means Live (0); anything other than 0, 180000 or
 * 1200000 (including non-numbers and fractions) is a 400 BAD_INPUT.
 */
export function parseDelayMs(searchParams: URLSearchParams): GroundDelayMs {
  const raw = searchParams.get("delayMs");
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  // the canonical spelling only: "00", " 0", "1e3" and "1200000.0" are all rejected
  if (String(n) !== raw || !isGroundDelay(n)) {
    throw new HttpError(400, "BAD_INPUT", `delayMs must be one of ${GROUND_DELAYS_MS.join(", ")}`);
  }
  return n;
}

/** The instant ground can see up to: the (injectable) clock minus the simulated link delay. */
export function groundAsOf(delayMs: number): string {
  return new Date(now().getTime() - delayMs).toISOString();
}

/**
 * One card per crew member for the Earth console, from what has "arrived" by `asOf`: stars are the
 * 16 per-key statuses of the visible latest check-in (all no_data when none has arrived), overall
 * and readiness likewise, openAlerts counts visible, unacknowledged alerts. Values only: no turns,
 * notes or source text (everything goes through the ground* repos).
 */
export function buildCrewStatusCards(asOf: string, delayMs: number): CrewStatusCard[] {
  const visibleAlerts = groundListAlerts(asOf);
  return groundListCrew().map((crew): CrewStatusCard => {
    const openAlerts = visibleAlerts.filter((a) => a.crewId === crew.id && a.acknowledgedAt === null).length;
    const payload = buildDashboardPayload({ crewId: crew.id, viewer: "ground", asOf, delayMs });
    if (!payload) {
      return {
        crew,
        overall: "no_data",
        readiness: null,
        lastCheckInAt: null,
        stars: KPI_KEYS.map((key) => ({ key, status: "no_data" as const })),
        openAlerts,
      };
    }
    return {
      crew,
      overall: payload.overall,
      readiness: payload.readiness,
      lastCheckInAt: payload.checkIn.confirmedAt,
      stars: payload.kpis.map((k) => ({ key: k.key, status: k.status })),
      openAlerts,
    };
  });
}

/** Every crew member's alerts that have arrived by `asOf`, newest first. */
export function listGroundAlerts(asOf: string): AlertRow[] {
  return groundListAlerts(asOf);
}
