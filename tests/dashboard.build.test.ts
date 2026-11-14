import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KPI_KEYS } from "@/lib/types";
import { setClockForTests } from "@/server/clock";
import { buildDashboardPayload, missionDayAt } from "@/server/dashboard/build";
import type { Db } from "@/server/db/client";
import { createCheckIn, latestConfirmedCheckIn } from "@/server/db/repos/checkin";
import { NotFoundError } from "@/server/http";
import { addAlert, addConfirmedCheckIn } from "./helpers/dashboard";
import { freshEmptyDb, freshSeededDb, insertCrew, TEST_TODAY } from "./helpers/db";
import { batDemoToday } from "./helpers/health";

const MIN = 60_000;
const NOW = TEST_TODAY; // 14 Nov 2026, 12:00 local
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const NOTE = "SECRET-NOTE-the-crew-member-wrote-this-4471";
const SOURCE_TEXT = "VERBATIM-SOURCE-SNIPPET-9921";

let db: Db;

beforeEach(async () => {
  db = await freshSeededDb();
  setClockForTests(NOW);
});
afterEach(() => {
  setClockForTests(null);
});

describe("buildDashboardPayload: crew viewer on the seed", () => {
  it("Bat (the demo user) is green overall with no alert and the full payload shape", async () => {
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(p).not.toBeNull();
    expect(p.crew).toMatchObject({ id: "bat", name: "Bat", preferredLanguage: "mn" });
    expect(p.overall).toBe("green");
    expect(p.summary.overall).toBe("green");
    expect(p.summary.redFlags).toEqual([]);
    expect(p.alerts).toEqual([]);
    expect(p.readiness).toBeGreaterThanOrEqual(90);
    expect(p.checkIn.id).toBe((await latestConfirmedCheckIn("bat"))!.id);
    expect(p.checkIn.language).toBe("mn");
  });

  it("has exactly 16 kpis in KPI_KEYS order, 6 axes, 5 hazards, 4 day-arc slots and 3-4 tasks", async () => {
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(p.kpis.map((k) => k.key)).toEqual([...KPI_KEYS]);
    expect(p.axes.map((a) => a.axis)).toEqual([
      "sleep",
      "cardio",
      "metabolic",
      "neuro_ocular",
      "behavioral",
      "musculoskeletal",
    ]);
    expect(p.hazards.map((h) => h.hazard)).toEqual([
      "radiation",
      "isolation_confinement",
      "distance_from_earth",
      "gravity",
      "hostile_closed_environment",
    ]);
    expect(p.dayArc.map((s) => s.slot)).toEqual(["morning", "midday", "afternoon", "evening"]);
    expect(p.tasks.length).toBeGreaterThanOrEqual(3);
    expect(p.tasks.length).toBeLessThanOrEqual(4);
    expect(p.summary.findings.length).toBeLessThanOrEqual(2);
    expect(p.summary.recommendations.length).toBeLessThanOrEqual(2);
  });

  it("marks radiation and distance_from_earth as not monitored and the day arc as logged", async () => {
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    const byHazard = Object.fromEntries(p.hazards.map((h) => [h.hazard, h.status]));
    expect(byHazard.radiation).toBe("not_monitored");
    expect(byHazard.distance_from_earth).toBe("not_monitored");
    expect(byHazard.gravity).toBe("green");
    for (const slot of p.dayArc) expect(slot.state, slot.slot).toBe("done");
  });

  it("gives numeric kpis a 13-14 point history, a baseline, a range text and the simulated source", async () => {
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    const sleep = p.kpis.find((k) => k.key === "sleep_hours")!;
    expect(sleep.history.length).toBeGreaterThanOrEqual(13);
    expect(sleep.history.length).toBeLessThanOrEqual(14);
    expect(sleep.history.every((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && typeof h.value === "number")).toBe(true);
    expect(sleep.baselineMean).toBeCloseTo(7.2, 0);
    expect(sleep.baselineSd).not.toBeNull();
    expect(sleep.source).toBe("simulated");
    expect(sleep.rangeText?.en).toContain("demo parameter");
    // text keys carry no history and no range
    const note = p.kpis.find((k) => k.key === "symptom_note")!;
    expect(note.history).toEqual([]);
    expect(note.rangeText).toBeNull();
    expect(note.status).toBe("no_data");
  });

  it("is deterministic: two builds give the same payload", async () => {
    expect(await buildDashboardPayload({ crewId: "alex", viewer: "crew" })).toEqual(
      await buildDashboardPayload({ crewId: "alex", viewer: "crew" }),
    );
  });

  it("Mira is red with the HEADACHE_PLUS_VISION flag, her seeded alert and a capped readiness", async () => {
    const p = (await buildDashboardPayload({ crewId: "mira", viewer: "crew" }))!;
    expect(p.overall).toBe("red");
    expect(p.summary.redFlags.map((f) => f.rule)).toEqual(["HEADACHE_PLUS_VISION"]);
    expect(p.readiness).toBeLessThanOrEqual(60);
    expect(p.alerts).toHaveLength(1);
    expect(p.alerts[0]).toMatchObject({ crewId: "mira", level: "red", rule: "HEADACHE_PLUS_VISION", acknowledgedAt: null });
    expect(p.alerts[0].checkInId).toBe(p.checkIn.id);
    expect(p.alerts[0].text.en.toLowerCase()).toContain("alert");
    expect(p.kpis.find((k) => k.key === "symptom_headache")!.value).toBe(1);
  });

  it("Alex is yellow because of the creeping blood pressure, with a baseline-aware systolic series", async () => {
    const p = (await buildDashboardPayload({ crewId: "alex", viewer: "crew" }))!;
    expect(p.overall).toBe("yellow");
    const sys = p.kpis.find((k) => k.key === "bp_systolic")!;
    expect(sys.status).toBe("yellow");
    expect(sys.history.at(-1)!.value).toBeGreaterThan(sys.history[0].value);
  });

  it("flags the history as simulated (seeded) and the link as simulated, online, 0 ms", async () => {
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(p.simulatedHistory).toBe(true);
    expect(p.link).toEqual({ state: "online", delayMs: 0, lastSentAt: p.checkIn.confirmedAt, simulated: true });
  });

  it("computes readinessBaseline from the person's own axis baselines", async () => {
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(p.readinessBaseline).not.toBeNull();
    expect(p.readinessBaseline!).toBeGreaterThan(50);
    expect(p.readinessBaseline!).toBeLessThanOrEqual(100);
  });
});

describe("buildDashboardPayload: stored summary, template fallback, specific check-ins", () => {
  it("uses the stored summary (Claude's spoken phrasing) for the crew viewer", async () => {
    const id = await addConfirmedCheckIn({
      crewId: "bat",
      language: "en",
      values: batDemoToday(),
      confirmedAt: ago(5 * MIN),
      spokenText: "Claude says: sleep was short today, Bat.",
    });
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(p.checkIn.id).toBe(id);
    expect(p.summary.spoken).toEqual({ language: "en", text: "Claude says: sleep was short today, Bat." });
  });

  it("falls back to a template summary when summary_json is missing or invalid", async () => {
    const id = await addConfirmedCheckIn({
      crewId: "bat",
      language: "mn",
      values: batDemoToday(),
      confirmedAt: ago(5 * MIN),
      noSummary: true,
    });
    const missing = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(missing.summary.spoken.language).toBe("mn");
    expect(missing.summary.spoken.text).toContain(missing.summary.disclaimer.mn);
    expect(missing.summary.audioTurnId).toBeNull();
    expect(missing.summary.findings.length).toBeGreaterThan(0);

    await db.run("UPDATE check_in SET summary_json = ? WHERE id = ?", '{"not":"a summary"}', id);
    const invalid = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(invalid.summary.spoken.text).toBe(missing.summary.spoken.text);
    await db.run("UPDATE check_in SET summary_json = ? WHERE id = ?", "not json at all", id);
    expect((await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!.summary.spoken.text).toBe(
      missing.summary.spoken.text,
    );
  });

  it("the scripted-demo story: Bat with 5.5 h sleep and 1800 ml water is Watch with sleep and water findings", async () => {
    await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(5 * MIN) });
    const p = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(p.overall).toBe("yellow");
    expect(p.summary.findings.map((f) => f.key).sort()).toEqual(["sleep_hours", "water_ml"]);
    expect(p.kpis.find((k) => k.key === "sleep_hours")!.delta!).toBeLessThan(-1.2);
    expect(p.kpis.find((k) => k.key === "sleep_hours")!.source).toBe("typed");
    // today's history stops at yesterday and the typed day does not count as history
    expect(p.kpis.find((k) => k.key === "sleep_hours")!.history.at(-1)!.date).toBe("2026-11-13");
    expect(p.simulatedHistory).toBe(true);
    expect(p.tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("simulatedHistory is false when no history row is simulated", async () => {
    await insertCrew(await freshEmptyDb(), "zed");
    // 6 typed days of history, then today
    for (let d = 8; d <= 13; d++) {
      await addConfirmedCheckIn({
        crewId: "zed",
        language: "en",
        values: batDemoToday(),
        confirmedAt: new Date(2026, 10, d, 8, 30),
        source: "typed",
      });
    }
    await addConfirmedCheckIn({ crewId: "zed", language: "en", values: batDemoToday(), confirmedAt: ago(5 * MIN) });
    const p = (await buildDashboardPayload({ crewId: "zed", viewer: "crew" }))!;
    expect(p.kpis.find((k) => k.key === "sleep_hours")!.history).toHaveLength(6);
    expect(p.simulatedHistory).toBe(false);
  });

  it("builds an older check-in by id with the history before that date", async () => {
    const old = (await latestConfirmedCheckIn("bat"))!;
    const newer = await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(5 * MIN) });
    expect((await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!.checkIn.id).toBe(newer);
    const p = (await buildDashboardPayload({ crewId: "bat", checkInId: old.id, viewer: "crew" }))!;
    expect(p.checkIn.id).toBe(old.id);
    expect(p.kpis.find((k) => k.key === "sleep_hours")!.history.at(-1)!.date).toBe("2026-11-12");
  });

  it("returns null for a crew member without a confirmed check-in and for an unconfirmed one", async () => {
    await insertCrew(db, "newbie");
    expect(await buildDashboardPayload({ crewId: "newbie", viewer: "crew" })).toBeNull();
    const open = await createCheckIn("newbie", { language: "en", startedAt: ago(MIN) });
    expect(await buildDashboardPayload({ crewId: "newbie", checkInId: open.id, viewer: "crew" })).toBeNull();
    expect(await buildDashboardPayload({ crewId: "newbie", viewer: "crew" })).toBeNull();
  });

  it("refuses another crew member's check-in id (NotFoundError) and an unknown crew id", async () => {
    const miras = (await latestConfirmedCheckIn("mira"))!;
    await expect(buildDashboardPayload({ crewId: "bat", checkInId: miras.id, viewer: "crew" })).rejects.toThrow(NotFoundError);
    await expect(buildDashboardPayload({ crewId: "ghost", viewer: "crew" })).rejects.toThrow(NotFoundError);
  });

  it("ignores asOf and checkInId overrides where they do not apply (crew viewer sees its own latest data in full)", async () => {
    const crewView = (await buildDashboardPayload({ crewId: "bat", viewer: "crew", asOf: "2000-01-01T00:00:00.000Z" }))!;
    expect(crewView.checkIn.id).toBe((await latestConfirmedCheckIn("bat"))!.id);
    expect(crewView.link.delayMs).toBe(0);
  });
});

describe("buildDashboardPayload: ground redaction", () => {
  function addNoteCheckIn(): Promise<string> {
    return addConfirmedCheckIn({
      crewId: "bat",
      language: "en",
      values: { ...batDemoToday(), symptom_note: NOTE, day_note: NOTE },
      confirmedAt: ago(5 * MIN),
      sourceText: SOURCE_TEXT,
      spokenText: `You told me: ${NOTE}`,
    });
  }

  it("the crew viewer sees the notes, the ground viewer never does", async () => {
    await addNoteCheckIn();
    const crew = (await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!;
    expect(crew.kpis.find((k) => k.key === "day_note")!.value).toBe(NOTE);
    expect(crew.summary.spoken.text).toContain(NOTE);

    const ground = (await buildDashboardPayload({ crewId: "bat", viewer: "ground", asOf: NOW.toISOString() }))!;
    expect(ground.checkIn.id).toBe(crew.checkIn.id);
    for (const key of ["symptom_note", "day_note"] as const) {
      expect(ground.kpis.find((k) => k.key === key)!.value, key).toBeNull();
    }
    const json = JSON.stringify(ground);
    expect(json).not.toContain(NOTE);
    expect(json).not.toContain("You told me");
    expect(json).not.toContain(SOURCE_TEXT);
    expect(json).not.toContain("sourceText");
  });

  it("replaces the spoken text by template text built from the code-made findings, in the check-in language", async () => {
    await addNoteCheckIn();
    const ground = (await buildDashboardPayload({ crewId: "bat", viewer: "ground", asOf: NOW.toISOString() }))!;
    const s = ground.summary;
    expect(s.spoken.language).toBe("en");
    expect(s.spoken.text.length).toBeGreaterThan(20);
    expect(s.spoken.text).toContain(s.headline.en);
    expect(s.spoken.text).toContain(s.disclaimer.en);
    for (const f of s.findings) expect(s.spoken.text).toContain(f.text.en);
    expect(s.audioTurnId).toBeNull();
  });

  it("builds a template summary for ground even when none is stored", async () => {
    await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(5 * MIN), noSummary: true });
    const g = (await buildDashboardPayload({ crewId: "bat", viewer: "ground", asOf: NOW.toISOString() }))!;
    expect(g.summary.spoken.language).toBe("mn");
    expect(g.summary.spoken.text).toContain(g.summary.disclaimer.mn);
    expect(g.overall).toBe("yellow");
  });

  it("never lets ground show less than the stored summary: a note keyword red flag survives redaction", async () => {
    await addConfirmedCheckIn({
      crewId: "saraa",
      language: "mn",
      values: { ...batDemoToday(), day_note: "I have chest pain" },
      confirmedAt: ago(5 * MIN),
    });
    const crew = (await buildDashboardPayload({ crewId: "saraa", viewer: "crew" }))!;
    expect(crew.overall).toBe("red");
    expect(crew.summary.redFlags.map((f) => f.rule)).toContain("SERIOUS_SYMPTOM_WORD");

    const ground = (await buildDashboardPayload({ crewId: "saraa", viewer: "ground", asOf: NOW.toISOString() }))!;
    expect(ground.overall).toBe("red");
    expect(ground.readiness).toBeLessThanOrEqual(60);
    expect(ground.summary.redFlags.map((f) => f.rule)).toContain("SERIOUS_SYMPTOM_WORD");
    expect(JSON.stringify(ground)).not.toContain("chest pain");
  });

  it("returns null for an unknown crew member and when nothing has arrived by asOf", async () => {
    expect(await buildDashboardPayload({ crewId: "ghost", viewer: "ground", asOf: NOW.toISOString() })).toBeNull();
    // the very first seeded check-in was confirmed on 31 Oct: before that, nothing exists
    expect(await buildDashboardPayload({ crewId: "bat", viewer: "ground", asOf: "2026-10-30T00:00:00.000Z" })).toBeNull();
  });

  it("ground alerts are only the alerts of the shown check-in", async () => {
    const g = (await buildDashboardPayload({ crewId: "mira", viewer: "ground", asOf: NOW.toISOString() }))!;
    expect(g.alerts).toHaveLength(1);
    expect(g.alerts[0].crewId).toBe("mira");
    expect(g.alerts[0].checkInId).toBe(g.checkIn.id);
    const bat = (await buildDashboardPayload({ crewId: "bat", viewer: "ground", asOf: NOW.toISOString() }))!;
    expect(bat.alerts).toEqual([]);
  });
});

describe("buildDashboardPayload: simulated link delay with the injected clock", () => {
  it("hides a check-in confirmed 5 minutes ago at a 20 minute delay and shows it at Live and 3 minutes", async () => {
    const fresh = await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(5 * MIN) });
    expect((await latestConfirmedCheckIn("bat"))!.id).toBe(fresh);

    const at = async (delayMs: number) =>
      (await buildDashboardPayload({
        crewId: "bat",
        viewer: "ground",
        asOf: new Date(NOW.getTime() - delayMs).toISOString(),
        delayMs,
      }))!;
    expect((await at(0)).checkIn.id).toBe(fresh);
    expect((await at(3 * MIN)).checkIn.id).toBe(fresh);
    const lagged = await at(20 * MIN);
    expect(lagged.checkIn.id).not.toBe(fresh);
    expect(lagged.checkIn.id).toBe("ci-bat-2026-11-13");
    expect(lagged.overall).toBe("green"); // the lagging console still shows yesterday's calm picture
  });

  it("reports the delay in the link: online at 0, delayed otherwise, lastSentAt = confirmedAt, always simulated", async () => {
    await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(40 * MIN) });
    for (const delayMs of [0, 3 * MIN, 20 * MIN]) {
      const p = (await buildDashboardPayload({
        crewId: "bat",
        viewer: "ground",
        asOf: new Date(NOW.getTime() - delayMs).toISOString(),
        delayMs,
      }))!;
      expect(p.link).toEqual({
        state: delayMs > 0 ? "delayed" : "online",
        delayMs,
        lastSentAt: p.checkIn.confirmedAt,
        simulated: true,
      });
    }
  });

  it("derives the delay from clock minus asOf when delayMs is not passed", async () => {
    const p = (await buildDashboardPayload({
      crewId: "bat",
      viewer: "ground",
      asOf: new Date(NOW.getTime() - 3 * MIN).toISOString(),
    }))!;
    expect(p.link.delayMs).toBe(3 * MIN);
    expect(p.link.state).toBe("delayed");
  });

  it("alerts follow the same visibility: an alert on a check-in that has not arrived is hidden", async () => {
    const id = await addConfirmedCheckIn({ crewId: "bat", language: "mn", values: batDemoToday(), confirmedAt: ago(2 * MIN) });
    await addAlert("bat", id, ago(2 * MIN));
    const live = (await buildDashboardPayload({ crewId: "bat", viewer: "ground", asOf: NOW.toISOString() }))!;
    expect(live.alerts).toHaveLength(1);
    const delayed = (await buildDashboardPayload({
      crewId: "bat",
      viewer: "ground",
      asOf: new Date(NOW.getTime() - 3 * MIN).toISOString(),
    }))!;
    expect(delayed.alerts).toEqual([]);
    expect(delayed.checkIn.id).not.toBe(id);
  });
});

describe("mission day", () => {
  it("counts days since MISSION_START_DATE (2026-10-01 by default) plus one, with the injected clock", async () => {
    expect((await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!.missionDay).toBe(45); // 14 Nov
    setClockForTests(new Date(2026, 9, 1, 9, 0));
    expect((await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!.missionDay).toBe(1);
    setClockForTests(new Date(2026, 9, 2, 0, 5));
    expect((await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!.missionDay).toBe(2);
    setClockForTests(new Date(2026, 10, 14, 23, 59));
    expect((await buildDashboardPayload({ crewId: "bat", viewer: "crew" }))!.missionDay).toBe(45);
  });

  it("missionDayAt takes the start date as a parameter and never drops below 1", () => {
    expect(missionDayAt(new Date(2026, 10, 14, 12), "2026-11-14")).toBe(1);
    expect(missionDayAt(new Date(2026, 10, 14, 12), "2026-11-01")).toBe(14);
    expect(missionDayAt(new Date(2026, 10, 14, 12), "2027-01-01")).toBe(1);
    expect(() => missionDayAt(new Date(), "not-a-date")).toThrow();
  });
});
