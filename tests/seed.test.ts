import { beforeEach, describe, expect, it } from "vitest";
import { evaluateDay } from "@/lib/health";
import { openDb } from "@/server/db/client";
import { seedDatabase, SEED_CREW, SEED_KEYS } from "@/server/db/seed";
import { localDateISO, shiftDate } from "@/server/db/shared";
import { listAlerts } from "@/server/db/repos/alert";
import { listHistoryDays, latestConfirmedCheckIn } from "@/server/db/repos/checkin";
import { listCrewPublic } from "@/server/db/repos/crew";
import { groundListAlerts } from "@/server/db/repos/ground";
import { listMeasurements } from "@/server/db/repos/measurement";
import { freshSeededDb, TEST_TODAY } from "./helpers/db";

/** docs/DASHBOARD_PLAN.md section 1 hard ranges, hard-coded on purpose (registry is a separate module). */
const HARD: Record<string, [number, number]> = {
  sleep_hours: [0, 14],
  mood: [1, 5],
  symptom_headache: [0, 1],
  symptom_dizziness: [0, 1],
  symptom_nausea: [0, 1],
  bp_systolic: [70, 220],
  bp_diastolic: [40, 140],
  heart_rate: [30, 200],
  temperature_c: [34, 42],
  glucose_mgdl: [40, 400],
  water_ml: [0, 6000],
  exercise_min: [0, 240],
  vision_check: [0, 2],
  workload: [1, 5],
};

const TODAY = localDateISO(TEST_TODAY);
const EXPECTED_DATES = Array.from({ length: 14 }, (_, i) => shiftDate(TODAY, i - 14));

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function series(crewId: string, key: string): number[] {
  return listHistoryDays(crewId, { before: TODAY, days: 14 }).map((d) => {
    const v = d.values[key as keyof typeof d.values];
    if (typeof v !== "number") throw new Error(`${crewId} ${key} missing on ${d.date}`);
    return v;
  });
}

/** least-squares slope per index step */
function slope(ys: number[]): number {
  const xs = ys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
}

describe("seed: shape", () => {
  beforeEach(() => {
    freshSeededDb();
  });

  it("creates the 4 crew members from the brief, in order", () => {
    expect(listCrewPublic()).toEqual([
      { id: "bat", name: "Bat", role: "Flight engineer", preferredLanguage: "mn", mascotVariant: 0, avatarSeed: "bat-0" },
      { id: "saraa", name: "Saraa", role: "Mission specialist", preferredLanguage: "mn", mascotVariant: 1, avatarSeed: "saraa-1" },
      { id: "alex", name: "Alex", role: "Commander", preferredLanguage: "en", mascotVariant: 2, avatarSeed: "alex-2" },
      { id: "mira", name: "Mira", role: "Medical officer", preferredLanguage: "en", mascotVariant: 3, avatarSeed: "mira-3" },
    ]);
  });

  it("gives every crew member 14 confirmed history days: the 14 days before today, none for today", () => {
    for (const crew of listCrewPublic()) {
      const days = listHistoryDays(crew.id, { before: TODAY, days: 14 });
      expect(days.map((d) => d.date)).toEqual(EXPECTED_DATES);
      expect(listHistoryDays(crew.id, { before: shiftDate(TODAY, 1), days: 14 }).at(-1)?.date).toBe(
        shiftDate(TODAY, -1),
      );
    }
  });

  it("confirms each check-in around 08:30 local with the matching language and state DONE", () => {
    const db = freshSeededDb();
    const rows = db
      .prepare("SELECT crew_id, confirmed_at, started_at, language, state FROM check_in")
      .all() as Array<{ crew_id: string; confirmed_at: string; started_at: string; language: string; state: string }>;
    expect(rows).toHaveLength(56);
    const lang = new Map(listCrewPublic().map((c) => [c.id, c.preferredLanguage]));
    for (const r of rows) {
      const c = new Date(r.confirmed_at);
      expect(c.getHours()).toBe(8);
      expect(c.getMinutes()).toBeGreaterThanOrEqual(22);
      expect(c.getMinutes()).toBeLessThanOrEqual(42);
      expect(new Date(r.started_at).getTime()).toBeLessThan(c.getTime());
      expect(r.language).toBe(lang.get(r.crew_id));
      expect(r.state).toBe("DONE");
    }
  });

  it("stores all 14 numeric/boolean keys every day, always simulated, inside the hard ranges", () => {
    const db = freshSeededDb();
    for (const crew of listCrewPublic()) {
      const days = listHistoryDays(crew.id, { before: TODAY, days: 14 });
      for (const day of days) {
        for (const key of SEED_KEYS) {
          const v = day.values[key];
          expect(typeof v, `${crew.id} ${day.date} ${key}`).toBe("number");
          const [lo, hi] = HARD[key];
          expect(v as number, `${crew.id} ${day.date} ${key}`).toBeGreaterThanOrEqual(lo);
          expect(v as number, `${crew.id} ${day.date} ${key}`).toBeLessThanOrEqual(hi);
        }
      }
    }
    const bad = db
      .prepare("SELECT COUNT(*) AS n FROM measurement WHERE source != 'simulated'")
      .get() as { n: number };
    expect(bad.n).toBe(0);
  });

  it("integer-valued keys are whole numbers and booleans are 0/1", () => {
    for (const crew of listCrewPublic()) {
      for (const key of ["mood", "workload", "bp_systolic", "bp_diastolic", "heart_rate", "glucose_mgdl", "water_ml", "exercise_min"]) {
        for (const v of series(crew.id, key)) expect(Number.isInteger(v), `${crew.id} ${key}`).toBe(true);
      }
      for (const key of ["symptom_headache", "symptom_dizziness", "symptom_nausea"]) {
        for (const v of series(crew.id, key)) expect([0, 1]).toContain(v);
      }
    }
  });

  it("adds a short free-text day_note on exactly 3 days per crew member and omits the row otherwise", () => {
    const db = freshSeededDb();
    for (const crew of listCrewPublic()) {
      const notes = db
        .prepare("SELECT value, value_text FROM measurement WHERE crew_id = ? AND key = 'day_note'")
        .all(crew.id) as Array<{ value: number | null; value_text: string }>;
      expect(notes).toHaveLength(3);
      for (const n of notes) {
        expect(n.value).toBeNull();
        expect(n.value_text.length).toBeGreaterThan(5);
        expect(n.value_text.length).toBeLessThan(80);
      }
      const symptomNotes = db
        .prepare("SELECT COUNT(*) AS n FROM measurement WHERE crew_id = ? AND key = 'symptom_note'")
        .get(crew.id) as { n: number };
      expect(symptomNotes.n).toBe(0);
    }
  });

  it("writes notes in the crew member's language (Cyrillic for mn, Latin for en)", () => {
    const db = freshSeededDb();
    for (const crew of listCrewPublic()) {
      const notes = db
        .prepare("SELECT value_text FROM measurement WHERE crew_id = ? AND key = 'day_note'")
        .all(crew.id) as Array<{ value_text: string }>;
      for (const n of notes) {
        const cyrillic = /[Ѐ-ӿ]/.test(n.value_text);
        expect(cyrillic).toBe(crew.preferredLanguage === "mn");
      }
    }
  });

  it("is additive and idempotent without wipe, and wipe resets", () => {
    const db = freshSeededDb();
    const count = () =>
      (db.prepare("SELECT (SELECT COUNT(*) FROM check_in) + (SELECT COUNT(*) FROM measurement) + (SELECT COUNT(*) FROM alert) AS n").get() as { n: number }).n;
    const before = count();
    seedDatabase(db, { today: TEST_TODAY });
    expect(count()).toBe(before);
    seedDatabase(db, { today: TEST_TODAY, wipe: true });
    expect(count()).toBe(before);
  });
});

describe("seed: determinism", () => {
  const dump = (db: ReturnType<typeof openDb>) =>
    JSON.stringify(
      ["crew_member", "check_in", "measurement", "turn", "alert"].map((t) =>
        db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(),
      ),
    );

  it("two seeds with the same today give byte-identical rows", () => {
    const a = openDb(":memory:");
    const b = openDb(":memory:");
    seedDatabase(a, { today: TEST_TODAY });
    seedDatabase(b, { today: TEST_TODAY });
    expect(dump(a)).toBe(dump(b));
    expect(dump(a).length).toBeGreaterThan(10_000);
    a.close();
    b.close();
  });

  it("a different today shifts the dates but keeps the values (values depend only on avatarSeed)", () => {
    const a = openDb(":memory:");
    const b = openDb(":memory:");
    seedDatabase(a, { today: TEST_TODAY });
    seedDatabase(b, { today: new Date(2026, 10, 20, 12) });
    const values = (db: ReturnType<typeof openDb>) =>
      db
        .prepare(
          "SELECT crew_id, key, value, value_text FROM measurement ORDER BY crew_id, substr(check_in_id, -10), key",
        )
        .all();
    expect(values(a)).toEqual(values(b));
    const lastDate = (db: ReturnType<typeof openDb>) =>
      (db.prepare("SELECT MAX(local_date) AS d FROM check_in").get() as { d: string }).d;
    expect(lastDate(a)).toBe("2026-11-13");
    expect(lastDate(b)).toBe("2026-11-19");
    a.close();
    b.close();
  });

  it("different crew members get different series", () => {
    freshSeededDb();
    expect(series("bat", "heart_rate")).not.toEqual(series("saraa", "heart_rate"));
  });
});

describe("seed: stories", () => {
  beforeEach(() => {
    freshSeededDb();
  });

  it("Bat has the documented normal baseline (14-day means)", () => {
    expect(mean(series("bat", "sleep_hours"))).toBeCloseTo(7.2, 1);
    expect(mean(series("bat", "heart_rate"))).toBeCloseTo(66, 0);
    expect(Math.abs(mean(series("bat", "bp_systolic")) - 120)).toBeLessThan(0.6);
    expect(Math.abs(mean(series("bat", "bp_diastolic")) - 78)).toBeLessThan(0.6);
    expect(Math.abs(mean(series("bat", "water_ml")) - 2300)).toBeLessThan(15);
    expect(Math.abs(mean(series("bat", "temperature_c")) - 36.6)).toBeLessThan(0.05);
    expect(series("bat", "vision_check").every((v) => v === 0)).toBe(true);
  });

  it("Bat and Saraa have no symptoms and clear vision on any day", () => {
    for (const id of ["bat", "saraa"]) {
      for (const key of ["symptom_headache", "symptom_dizziness", "symptom_nausea", "vision_check"]) {
        expect(series(id, key).every((v) => v === 0)).toBe(true);
      }
    }
  });

  it("Saraa is steady: yesterday inside the fixed demo ranges", () => {
    const y = listHistoryDays("saraa", { before: TODAY, days: 14 }).at(-1)!.values;
    expect(y.sleep_hours as number).toBeGreaterThanOrEqual(7);
    expect(y.bp_systolic as number).toBeLessThanOrEqual(129);
    expect(y.water_ml as number).toBeGreaterThanOrEqual(2000);
    expect(y.exercise_min as number).toBeGreaterThanOrEqual(45);
    expect(y.workload as number).toBeLessThanOrEqual(3);
  });

  it("Alex: systolic creeps about +2/day over the last 6 days, yesterday about 134/86", () => {
    const sys = series("alex", "bp_systolic");
    const dia = series("alex", "bp_diastolic");
    const early = sys.slice(0, 8);
    expect(Math.abs(mean(early) - 122)).toBeLessThan(2);
    expect(slope(sys.slice(8))).toBeGreaterThan(1.5);
    expect(slope(sys.slice(8))).toBeLessThan(2.6);
    expect(slope(early)).toBeLessThan(1);
    expect(sys.at(-1)!).toBeGreaterThanOrEqual(131);
    expect(sys.at(-1)!).toBeLessThanOrEqual(137);
    expect(dia.at(-1)!).toBeGreaterThanOrEqual(83);
    expect(dia.at(-1)!).toBeLessThanOrEqual(89);
    // yesterday is above the (demo) yellow bound of 129, the pre-creep days are not
    expect(sys.at(-1)!).toBeGreaterThan(129);
    expect(Math.max(...early)).toBeLessThanOrEqual(129);
  });

  it("Mira: yesterday headache=1 and vision_check=1, everything else normal; earlier days normal", () => {
    const days = listHistoryDays("mira", { before: TODAY, days: 14 });
    const y = days.at(-1)!;
    expect(y.date).toBe(shiftDate(TODAY, -1));
    expect(y.values.symptom_headache).toBe(1);
    expect(y.values.vision_check).toBe(1);
    expect(y.values.symptom_dizziness).toBe(0);
    expect(y.values.symptom_nausea).toBe(0);
    const v = y.values as Record<string, number>;
    expect(v.sleep_hours).toBeGreaterThanOrEqual(7);
    expect(v.mood).toBeGreaterThanOrEqual(3);
    expect(v.heart_rate).toBeGreaterThanOrEqual(50);
    expect(v.heart_rate).toBeLessThanOrEqual(90);
    expect(v.bp_systolic).toBeLessThanOrEqual(129);
    expect(v.bp_diastolic).toBeLessThanOrEqual(84);
    expect(v.temperature_c).toBeGreaterThanOrEqual(36.0);
    expect(v.temperature_c).toBeLessThanOrEqual(37.5);
    expect(v.glucose_mgdl).toBeGreaterThanOrEqual(70);
    expect(v.glucose_mgdl).toBeLessThanOrEqual(140);
    expect(v.water_ml).toBeGreaterThanOrEqual(2000);
    expect(v.exercise_min).toBeGreaterThanOrEqual(45);
    expect(v.workload).toBeLessThanOrEqual(3);

    for (const d of days.slice(0, -1)) {
      expect(d.values.symptom_headache).toBe(0);
      expect(d.values.vision_check).toBe(0);
    }
    // nobody else has a symptom on any day
    for (const id of ["bat", "saraa", "alex"]) {
      expect(series(id, "symptom_headache").every((x) => x === 0)).toBe(true);
    }
  });

  it("Mira's confirmed check-in from yesterday carries a red HEADACHE_PLUS_VISION alert that ground sees", () => {
    const alerts = listAlerts("mira");
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.level).toBe("red");
    expect(a.rule).toBe("HEADACHE_PLUS_VISION");
    expect(a.acknowledgedAt).toBeNull();
    // the alert text is the red flag wording produced by src/lib/health for her last day
    const days = listHistoryDays("mira", { before: TODAY, days: 14 });
    const flag = evaluateDay(days.at(-1)!.values, days.slice(0, -1)).redFlags.find(
      (f) => f.rule === "HEADACHE_PLUS_VISION",
    );
    expect(flag).toBeDefined();
    expect(a.text).toEqual(flag!.text);
    expect(a.text.en).toMatch(/alert/i);
    expect(a.text.en.toLowerCase()).not.toContain("diagnos");
    expect(a.checkInId).toBe(latestConfirmedCheckIn("mira")!.id);
    for (const id of ["bat", "saraa", "alex"]) expect(listAlerts(id)).toHaveLength(0);

    const ground = groundListAlerts(new Date(TEST_TODAY).toISOString());
    expect(ground.map((g) => g.crewId)).toEqual(["mira"]);
  });

  it("Bat's latest seeded day (the demo user) evaluates green overall, and so does Saraa's", () => {
    for (const id of ["bat", "saraa"]) {
      const days = listHistoryDays(id, { before: TODAY, days: 14 });
      const ev = evaluateDay(days.at(-1)!.values, days.slice(0, -1));
      expect(ev.overall, id).toBe("green");
      expect(ev.redFlags, id).toEqual([]);
    }
    // the cap only touches the last day: the rest of Bat's story (workload around 3) is unchanged
    expect(series("bat", "workload").at(-1)!).toBeLessThanOrEqual(3);
  });

  it("stores a SummaryPayload (template spoken text in the crew language) on the LAST check-in of every crew member only", () => {
    const db = freshSeededDb();
    for (const crew of listCrewPublic()) {
      const latest = latestConfirmedCheckIn(crew.id)!;
      expect(latest.summaryJson, crew.id).not.toBeNull();
      const summary = JSON.parse(latest.summaryJson!);
      expect(summary.spoken.language).toBe(crew.preferredLanguage);
      expect(summary.spoken.text.length).toBeGreaterThan(20);
      expect(summary.audioTurnId).toBeNull();
      expect(summary.disclaimer[crew.preferredLanguage]).toBeTruthy();
      // Cyrillic for mn, Latin for en
      expect(/[Ѐ-ӿ]/.test(summary.spoken.text)).toBe(crew.preferredLanguage === "mn");
      const withSummary = db
        .prepare("SELECT COUNT(*) AS n FROM check_in WHERE crew_id = ? AND summary_json IS NOT NULL")
        .get(crew.id) as { n: number };
      expect(withSummary.n).toBe(1);
    }
    expect(JSON.parse(latestConfirmedCheckIn("mira")!.summaryJson!).overall).toBe("red");
    expect(JSON.parse(latestConfirmedCheckIn("bat")!.summaryJson!).overall).toBe("green");
  });

  it("every seeded measurement row is readable through listMeasurements with numeric values for numeric keys", () => {
    const latest = latestConfirmedCheckIn("bat")!;
    const rows = listMeasurements("bat", latest.id);
    expect(rows.filter((r) => typeof r.value === "number").length).toBeGreaterThanOrEqual(14);
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(["simulated"]));
    expect(SEED_CREW.map((c) => c.id)).toEqual(["bat", "saraa", "alex", "mira"]);
  });
});
