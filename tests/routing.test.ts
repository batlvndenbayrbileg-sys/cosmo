/**
 * Workbook R-37 (routing / isolation): every ground payload is keyed by crewId, crew X's rows never
 * appear in crew Y's payload, and crew X's distinctive values (Mira's headache flag, Alex's rising
 * systolic) are absent from everyone else's.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardPayload } from "@/lib/types";
import { setClockForTests } from "@/server/clock";
import { buildDashboardPayload } from "@/server/dashboard/build";
import { buildCrewStatusCards, listGroundAlerts } from "@/server/dashboard/ground";
import { getDb } from "@/server/db/client";
import { latestConfirmedCheckIn } from "@/server/db/repos/checkin";
import { groundListHistoryDays, groundListMeasurements } from "@/server/db/repos/ground";
import { listAlerts } from "@/server/db/repos/alert";
import { NotFoundError } from "@/server/http";
import { addConfirmedCheckIn } from "./helpers/dashboard";
import { freshSeededDb, TEST_TODAY } from "./helpers/db";
import { batDemoToday } from "./helpers/health";

const NOW = TEST_TODAY;
const AS_OF = NOW.toISOString();
const CREW_IDS = ["bat", "saraa", "alex", "mira"] as const;
const NAMES: Record<string, string> = { bat: "Bat", saraa: "Saraa", alex: "Alex", mira: "Mira" };

const ground = async (crewId: string): Promise<DashboardPayload> =>
  (await buildDashboardPayload({ crewId, viewer: "ground", asOf: AS_OF }))!;

/** every member's ground payload as JSON, keyed by crew id */
async function groundJsonById(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of CREW_IDS) out[id] = JSON.stringify(await ground(id));
  return out;
}

/** the systolic series of a payload, oldest first, today last */
function systolic(p: DashboardPayload): number[] {
  const k = p.kpis.find((x) => x.key === "bp_systolic")!;
  return [...k.history.map((h) => h.value), k.value as number];
}

/** true when `needle` appears as a contiguous run inside `hay` */
function containsRun(hay: number[], needle: number[]): boolean {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((v, j) => hay[i + j] === v)) return true;
  }
  return false;
}

beforeEach(async () => {
  await freshSeededDb();
  setClockForTests(NOW);
});
afterEach(() => {
  setClockForTests(null);
});

describe("R-37: every id in a ground payload belongs to the crew member it is keyed by", () => {
  it.each(CREW_IDS)("%s: crew, check-in, alert and measurement rows are all that member's", async (id) => {
    const p = await ground(id);
    expect(p.crew.id).toBe(id);
    expect(p.crew.name).toBe(NAMES[id]);

    const db = await getDb();
    const owner = (await db.get<{ crew_id: string }>("SELECT crew_id FROM check_in WHERE id = ?", p.checkIn.id))!;
    expect(owner.crew_id).toBe(id);

    for (const a of p.alerts) {
      expect(a.crewId).toBe(id);
      const row = (await db.get<{
        crew_id: string;
        check_in_id: string;
      }>("SELECT crew_id, check_in_id FROM alert WHERE id = ?", a.id))!;
      expect(row.crew_id).toBe(id);
      expect(row.check_in_id).toBe(p.checkIn.id);
    }

    // the measurements behind the payload: today's check-in and the whole history window
    const todayRows = await db.all<{
      crew_id: string;
    }>("SELECT crew_id FROM measurement WHERE check_in_id = ?", p.checkIn.id);
    expect(todayRows.length).toBeGreaterThan(0);
    expect(new Set(todayRows.map((r) => r.crew_id))).toEqual(new Set([id]));
    const oldest = p.kpis.find((k) => k.key === "sleep_hours")!.history[0].date;
    const windowRows = await db.all<{ crew_id: string }>(
      `SELECT DISTINCT m.crew_id FROM measurement m JOIN check_in c ON c.id = m.check_in_id
        WHERE c.local_date >= ? AND c.local_date <= ? AND c.crew_id = ?`,
      oldest,
      "2026-11-13",
      id,
    );
    expect(windowRows).toEqual([{ crew_id: id }]);

    // and nothing in the JSON names another crew member or carries their seed
    const json = JSON.stringify(p);
    for (const other of CREW_IDS.filter((c) => c !== id)) {
      expect(json, `${id} payload mentions ${other}`).not.toContain(`"${other}"`);
      expect(json).not.toContain(NAMES[other]);
      expect(json).not.toContain(`${other}-`); // avatar seeds and ci-<id>- check-in ids
    }
  });

  it("ground repo reads refuse a check-in id that belongs to another crew member", async () => {
    for (const x of CREW_IDS) {
      for (const y of CREW_IDS.filter((c) => c !== x)) {
        const xCheckIn = (await ground(x)).checkIn.id;
        expect(await groundListMeasurements(y, xCheckIn, AS_OF), `${y} reading ${x}'s check-in`).toEqual([]);
        // the crew viewer path is stricter still: NotFoundError, not an empty payload
        await expect(buildDashboardPayload({ crewId: y, checkInId: xCheckIn, viewer: "crew" })).rejects.toThrow(NotFoundError);
      }
    }
  });

  it("the ground history of one member holds only that member's dates and values", async () => {
    for (const id of CREW_IDS) {
      const days = await groundListHistoryDays(id, { before: "2026-11-14", days: 14, asOf: AS_OF });
      expect(days).toHaveLength(14);
      const series = days.map((d) => d.values.heart_rate);
      for (const other of CREW_IDS.filter((c) => c !== id)) {
        const otherSeries = (await groundListHistoryDays(other, { before: "2026-11-14", days: 14, asOf: AS_OF })).map(
          (d) => d.values.heart_rate,
        );
        expect(series, `${id} vs ${other}`).not.toEqual(otherSeries);
      }
    }
  });
});

describe("R-37: crew X's distinctive values never appear in crew Y's payload", () => {
  it("Mira's headache flag, alert and vision finding exist only in Mira's payload", async () => {
    const mira = await ground("mira");
    expect(mira.summary.redFlags.map((f) => f.rule)).toEqual(["HEADACHE_PLUS_VISION"]);
    const miraAlert = (await listAlerts("mira"))[0];
    const miraFlagText = mira.summary.redFlags[0].text.en;

    for (const id of CREW_IDS.filter((c) => c !== "mira")) {
      const p = await ground(id);
      const json = JSON.stringify(p);
      expect(json, id).not.toContain("HEADACHE_PLUS_VISION");
      expect(json).not.toContain(miraAlert.id);
      expect(json).not.toContain(miraFlagText);
      expect(p.alerts).toEqual([]);
      expect(p.summary.redFlags).toEqual([]);
      expect(p.kpis.find((k) => k.key === "symptom_headache")!.value).toBe(0);
      expect(p.kpis.find((k) => k.key === "vision_check")!.value).toBe(0);
      for (const key of ["symptom_headache", "vision_check"] as const) {
        const hist = p.kpis.find((k) => k.key === key)!.history;
        expect(hist.every((h) => h.value === 0), `${id} ${key} history`).toBe(true);
      }
      expect(p.overall).not.toBe("red");
    }
  });

  it("Alex's rising systolic series and its yellow status exist only in Alex's payload", async () => {
    const alex = await ground("alex");
    const alexSys = systolic(alex);
    const creep = alexSys.slice(-6);
    expect(creep[creep.length - 1]).toBeGreaterThan(creep[0] + 6); // really rising
    expect(alex.kpis.find((k) => k.key === "bp_systolic")!.status).toBe("yellow");

    for (const id of CREW_IDS.filter((c) => c !== "alex")) {
      const p = await ground(id);
      const sys = systolic(p);
      expect(sys, id).not.toEqual(alexSys);
      expect(containsRun(sys, creep), `${id} contains Alex's last six systolic values`).toBe(false);
      expect(p.kpis.find((k) => k.key === "bp_systolic")!.status, id).toBe("green");
      expect(p.kpis.find((k) => k.key === "bp_diastolic")!.status, id).toBe("green");
      // no 130+ reading anywhere in their series (Alex's creep ends at 133)
      expect(Math.max(...sys), id).toBeLessThan(130);
    }
  });

  it("holds after live data lands: a new check-in of one member changes only that member's payload", async () => {
    const before = await groundJsonById();
    await addConfirmedCheckIn({
      crewId: "bat",
      language: "mn",
      values: { ...batDemoToday(), symptom_headache: 1, vision_check: 2 },
      confirmedAt: new Date(NOW.getTime() - 5 * 60_000),
    });
    const after = await groundJsonById();
    expect(after.bat).not.toBe(before.bat);
    expect(JSON.parse(after.bat).overall).toBe("red");
    for (const id of ["saraa", "alex", "mira"]) expect(after[id], id).toBe(before[id]);
    // Bat's new red flag stays out of everyone else's payload
    for (const id of ["saraa", "alex", "mira"]) expect(after[id]).not.toContain("VITAL_RED");
  });
});

describe("R-37: ground cards and the alert list are keyed per crew member", () => {
  it("each card's stars come from that member's own check-in", async () => {
    const cards = await buildCrewStatusCards(AS_OF, 0);
    expect(cards.map((c) => c.crew.id)).toEqual([...CREW_IDS]);
    for (const c of cards) {
      const own = await ground(c.crew.id);
      expect(c.lastCheckInAt).toBe(own.checkIn.confirmedAt);
      expect(c.stars).toEqual(own.kpis.map((k) => ({ key: k.key, status: k.status })));
      expect(c.readiness).toBe(own.readiness);
      expect(c.overall).toBe(own.overall);
    }
    const nonMira = cards.filter((c) => c.crew.id !== "mira");
    for (const c of nonMira) {
      expect(c.stars.find((s) => s.key === "symptom_headache")!.status, c.crew.id).toBe("green");
      expect(c.openAlerts, c.crew.id).toBe(0);
    }
    expect(cards.find((c) => c.crew.id === "mira")!.openAlerts).toBe(1);
  });

  it("the alert list carries only alerts whose crewId and check-in belong together", async () => {
    const alerts = await listGroundAlerts(AS_OF);
    expect(alerts.map((a) => a.crewId)).toEqual(["mira"]);
    const db = await getDb();
    for (const a of alerts) {
      const row = (await db.get<{ crew_id: string }>("SELECT crew_id FROM check_in WHERE id = ?", a.checkInId))!;
      expect(row.crew_id).toBe(a.crewId);
      expect(a.checkInId).toBe((await latestConfirmedCheckIn(a.crewId))!.id);
    }
  });
});
